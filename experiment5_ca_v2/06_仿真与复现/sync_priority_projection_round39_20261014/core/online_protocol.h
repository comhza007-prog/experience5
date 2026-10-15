#ifndef E5_ONLINE_PROTOCOL_H
#define E5_ONLINE_PROTOCOL_H
#include <stdint.h>
#include <string.h>
#include <float.h>
/* Fixed16-byte little-endian frame: E5 54,version1,op,seq16,param,reserved0,
 * float32 value,session16,CRC16-CCITT(first14 bytes,initFFFF).
 * Session is a freshness check, NOT authentication. Never network-expose it.
 * Only the motor task may apply parameters. No limit/gain/guard writes. */
#define E5_OL_MOTION_ENABLED 1U
#define E5_OL_SET 1U
#define E5_OL_PREPARE 2U
#define E5_OL_ARM 3U
#define E5_OL_STOP 4U
#define E5_OL_QUERY 5U
#define E5_OL_PING 6U
#define E5_OL_OK 1U
#define E5_OL_BUSY 2U
#define E5_OL_PARAMETER 3U
#define E5_OL_STATE 4U
#define E5_OL_HEALTH 5U
#define E5_OL_STALE 6U
#define E5_OL_SESSION 7U
#define E5_OL_DISABLED 8U
#define E5_OL_WATCHDOG_MS 1000U
#define E5_OL_PREPARE_MS 1000U
extern volatile float g_e5_online_nn_scale,g_e5_online_learning_scale;
typedef struct {uint8_t op,param;uint16_t seq,session;float value;} e5_ol_command;
typedef struct {uint8_t bytes[16];uint32_t used,bad;} e5_ol_parser;
typedef struct {
    float nn_scale,learning_scale;
    uint16_t session,last_seq,ack_seq;
    uint32_t status,revision,last_ping,prepared,prepared_at;
} e5_ol_state;
static uint32_t e5_ol_watchdog_expired(const e5_ol_state *s,uint32_t active,uint32_t now) {
    return active && (uint32_t)(now-s->last_ping)>E5_OL_WATCHDOG_MS;
}
static uint16_t e5_ol_crc(const uint8_t *p,uint32_t len) {
    uint16_t crc=0xffffU;uint32_t i,j;
    for(i=0;i<len;i++){crc^=(uint16_t)p[i]<<8;for(j=0;j<8;j++)crc=(uint16_t)((crc&0x8000U)?((uint32_t)crc<<1)^0x1021U:((uint32_t)crc<<1));}
    return crc;
}
static int e5_ol_feed(e5_ol_parser *p,uint8_t b,e5_ol_command *c) {
    if(p->used==0U && b!=0xe5U)return 0;
    p->bytes[p->used++]=b;
    if(p->used==2U && p->bytes[1]!=0x54U){p->used=b==0xe5U?1U:0U;return 0;}
    if(p->used<16U)return 0;
    if(p->bytes[2]==1U && p->bytes[7]==0U &&
       e5_ol_crc(p->bytes,14)==(uint16_t)(p->bytes[14]|((uint16_t)p->bytes[15]<<8))) {
        c->op=p->bytes[3];c->seq=(uint16_t)(p->bytes[4]|((uint16_t)p->bytes[5]<<8));
        c->param=p->bytes[6];memcpy(&c->value,&p->bytes[8],4);
        c->session=(uint16_t)(p->bytes[12]|((uint16_t)p->bytes[13]<<8));p->used=0;return 1;
    }
    p->bad++;
    /* Sliding resynchronization; never apply a bad CRC/version frame. */
    memmove(p->bytes,p->bytes+1,15);p->used=15;
    while(p->used && (p->bytes[0]!=0xe5U || (p->used>1U&&p->bytes[1]!=0x54U))) {
        memmove(p->bytes,p->bytes+1,--p->used);
    }
    return 0;
}
static void e5_ol_init(e5_ol_state *s,uint16_t session) {
    memset(s,0,sizeof(*s));s->session=session;s->nn_scale=1;s->learning_scale=1;
}
/* Returns action, not an actuator command. START still needs board health,
 * stationary500ms,minimum8s boot delay,and compile-time motion permission.
 * CRC-valid STOP is accepted even with stale session/seq,then fault-latched.
 * Failed health/STOP/fault never has a software CLEAR command. */
static uint32_t e5_ol_apply(e5_ol_state *s,const e5_ol_command *c,
    uint32_t idle,uint32_t fault,uint32_t motion_allowed,uint32_t now) {
    s->ack_seq=c->seq;
    if(c->op==E5_OL_STOP && c->param==0U && c->value==0.0f) {s->prepared=0;s->status=E5_OL_OK;return E5_OL_STOP;}
    if(!s->session || c->session!=s->session){s->status=E5_OL_SESSION;return 0;}
    if(!c->seq || c->seq<=s->last_seq){s->status=E5_OL_STALE;return 0;}
    s->last_seq=c->seq;
    if(c->value!=c->value || c->value>FLT_MAX || c->value<-FLT_MAX){s->status=E5_OL_PARAMETER;return 0;}
    if(c->op==E5_OL_SET) {
        if(!idle || fault){s->status=E5_OL_BUSY;return 0;}
        if(c->param==1U && c->value>=.5f && c->value<=1.25f)s->nn_scale=c->value;
        else if(c->param==2U && c->value>=.5f && c->value<=1.0f)s->learning_scale=c->value;
        else {s->status=E5_OL_PARAMETER;return 0;}
        s->revision++;s->prepared=0;s->status=E5_OL_OK;return E5_OL_SET;
    }
    if(c->param!=0U || c->value!=0.0f){s->status=E5_OL_PARAMETER;return 0;}
    if(c->op==E5_OL_QUERY){s->status=E5_OL_OK;return E5_OL_QUERY;}
    if(c->op==E5_OL_PING){s->last_ping=now;s->status=E5_OL_OK;return E5_OL_PING;}
    if(c->op==E5_OL_PREPARE){s->status=idle&&!fault?E5_OL_OK:E5_OL_STATE;s->prepared=s->status==E5_OL_OK;s->prepared_at=now;return s->prepared?E5_OL_PREPARE:0;}
    if(c->op==E5_OL_ARM) {
        if(!motion_allowed){s->status=E5_OL_DISABLED;return 0;}
        if(!idle || fault || !s->prepared || (uint32_t)(now-s->prepared_at)>E5_OL_PREPARE_MS){s->prepared=0;s->status=E5_OL_STATE;return 0;}
        s->prepared=0;s->last_ping=now;s->status=E5_OL_OK;return E5_OL_ARM;
    }
    s->status=E5_OL_PARAMETER;return 0;
}
#endif
