#include <assert.h>
#include <stdio.h>
#include <math.h>
#include "blnn_core.c"
int e5_r2_step(e5_state *,const e5_input *,e5_output *);
volatile float g_e5_online_nn_scale=1,g_e5_online_learning_scale=1;
static e5_state s,prior;
static unsigned seed=902571;
static unsigned rnd(void){seed=1664525U*seed+1013904223U;return seed;}
static e5_real u(double lo,double hi){return (e5_real)(lo+(hi-lo)*(rnd()&65535U)/65535.0);}
static void packet(uint8_t p[16],uint8_t op,uint16_t seq,uint8_t param,float value,uint16_t session) {
    uint16_t crc;memset(p,0,16);p[0]=0xe5;p[1]=0x54;p[2]=1;p[3]=op;
    p[4]=(uint8_t)seq;p[5]=(uint8_t)(seq>>8);p[6]=param;memcpy(p+8,&value,4);
    p[12]=(uint8_t)session;p[13]=(uint8_t)(session>>8);crc=e5_ol_crc(p,14);p[14]=(uint8_t)crc;p[15]=(uint8_t)(crc>>8);
}
int main(void) {
    e5_ol_state st,before;e5_ol_command cmd,parsed;e5_ol_parser parser;
    uint8_t bytes[16];uint32_t action;unsigned i,j,ch,n,seen=0;
    e5_input in;e5_output out,old;
    assert(E5_OL_MOTION_ENABLED==1);
    e5_ol_init(&st,12345);memset(&cmd,0,sizeof(cmd));cmd.session=12345;cmd.seq=1;cmd.op=E5_OL_ARM;
    assert(!e5_ol_apply(&st,&cmd,1,0,0,10000)&&st.status==E5_OL_DISABLED);
    cmd.seq++;cmd.op=E5_OL_PREPARE;assert(e5_ol_apply(&st,&cmd,1,0,0,10000)==E5_OL_PREPARE);
    cmd.seq++;cmd.op=E5_OL_ARM;assert(!e5_ol_apply(&st,&cmd,1,0,0,10000)&&st.status==E5_OL_DISABLED);
    for(i=0;i<10000;i++) {
        cmd.seq++;cmd.op=E5_OL_SET;cmd.param=i%2+1;cmd.value=i%2?.75f:1.1f;
        before=st;assert(!e5_ol_apply(&st,&cmd,0,0,0,10000)&&st.status==E5_OL_BUSY);
        assert(st.nn_scale==before.nn_scale&&st.learning_scale==before.learning_scale&&st.revision==before.revision);
    }
    cmd.seq++;cmd.op=E5_OL_SET;cmd.param=1;cmd.value=1.25f;assert(e5_ol_apply(&st,&cmd,1,0,0,10000)==E5_OL_SET);
    assert(st.nn_scale==1.25f&&!st.prepared);
    assert(!e5_ol_apply(&st,&cmd,1,0,0,10000)&&st.status==E5_OL_STALE);
    cmd.seq++;cmd.value=1.250001f;assert(!e5_ol_apply(&st,&cmd,1,0,0,10000)&&st.status==E5_OL_PARAMETER&&st.nn_scale==1.25f);
    cmd.seq++;cmd.value=NAN;assert(!e5_ol_apply(&st,&cmd,1,0,0,10000)&&st.status==E5_OL_PARAMETER);
    cmd.seq++;cmd.value=1;cmd.session=12344;assert(!e5_ol_apply(&st,&cmd,1,0,0,10000)&&st.status==E5_OL_SESSION);
    cmd.session=12345;cmd.op=E5_OL_ARM;cmd.param=0;cmd.value=0;cmd.seq++;
    st.prepared=0;assert(!e5_ol_apply(&st,&cmd,1,0,1,10000)&&st.status==E5_OL_STATE);
    cmd.seq++;cmd.op=E5_OL_PREPARE;assert(e5_ol_apply(&st,&cmd,1,0,1,10000));
    cmd.seq++;cmd.op=E5_OL_ARM;assert(e5_ol_apply(&st,&cmd,1,0,1,10000)==E5_OL_ARM&&!st.prepared);
    cmd.seq++;assert(!e5_ol_apply(&st,&cmd,1,0,1,10000));
    cmd.seq++;cmd.op=E5_OL_PREPARE;assert(e5_ol_apply(&st,&cmd,1,0,1,10000));
    cmd.seq++;cmd.op=E5_OL_ARM;assert(!e5_ol_apply(&st,&cmd,1,0,1,11001)&&!st.prepared);
    cmd.seq++;cmd.op=E5_OL_PREPARE;assert(e5_ol_apply(&st,&cmd,1,0,1,0xfffffe00U));
    cmd.seq++;cmd.op=E5_OL_ARM;assert(e5_ol_apply(&st,&cmd,1,0,1,0x000001e8U)==E5_OL_ARM);
    assert(!e5_ol_watchdog_expired(&st,1,0x000005d0U));
    assert(e5_ol_watchdog_expired(&st,1,0x000005d1U));
    assert(!e5_ol_watchdog_expired(&st,0,0x000005d1U));
    st.last_ping=0xfffffe00U;assert(!e5_ol_watchdog_expired(&st,1,0x000001e8U));
    assert(e5_ol_watchdog_expired(&st,1,0x000001e9U));
    cmd.seq++;cmd.op=E5_OL_PREPARE;assert(e5_ol_apply(&st,&cmd,1,0,1,12000));
    cmd.seq++;cmd.op=E5_OL_SET;cmd.param=1;cmd.value=1;assert(e5_ol_apply(&st,&cmd,1,0,1,12001)==E5_OL_SET&&!st.prepared);
    cmd.seq++;cmd.op=E5_OL_ARM;cmd.param=0;cmd.value=0;assert(!e5_ol_apply(&st,&cmd,1,0,1,12002));
    cmd.seq++;cmd.op=E5_OL_PREPARE;assert(e5_ol_apply(&st,&cmd,1,0,1,13000));
    cmd.seq++;cmd.op=E5_OL_ARM;assert(e5_ol_apply(&st,&cmd,1,0,1,14000)==E5_OL_ARM);
    cmd.seq++;cmd.op=E5_OL_SET;cmd.param=1;cmd.value=.75f;before=st;
    assert(!e5_ol_apply(&st,&cmd,0,0,1,14000)&&st.status==E5_OL_BUSY&&st.nn_scale==before.nn_scale);
    cmd.op=E5_OL_STOP;cmd.seq=0;cmd.session=0;cmd.param=0;cmd.value=0;st.prepared=1;
    assert(e5_ol_apply(&st,&cmd,0,32,0,10000)==E5_OL_STOP&&!st.prepared);
    e5_ol_init(&st,0);cmd.op=E5_OL_SET;cmd.param=1;cmd.value=1;cmd.seq=1;
    assert(!e5_ol_apply(&st,&cmd,1,0,0,10000)&&st.status==E5_OL_SESSION);
    for(i=0;i<20000;i++) {
        memset(&parser,0,sizeof(parser));packet(bytes,E5_OL_SET,123,1,1,12345);
        bytes[i%16]^=1;for(j=0;j<16;j++)assert(!e5_ol_feed(&parser,bytes[j],&parsed));
        packet(bytes,E5_OL_SET,124,1,.75f,12345);
        for(j=0;j<16;j++)seen+=(unsigned)e5_ol_feed(&parser,bytes[j],&parsed);
        assert(parsed.seq==124&&parsed.session==12345&&parsed.value==.75f);
    }
    assert(seen==20000);
    for(i=0;i<60000;i++) {
        assert(e5_reset(&s,i%5?12:11,i%3==0?4:(i%3==1?59:60)));
        memset(&in,0,sizeof(in));in.limit[0]=1200;in.limit[1]=i%4?1200:800;
        for(ch=0;ch<2;ch++) {
            in.q[ch]=u(-.0003,.0003);in.velocity[ch]=u(-.0003,.0003);in.acceleration[ch]=u(-.1,.1);
            in.raw_rpm[ch]=i%7?0:(int16_t)(rnd()%81-40);s.ca_delta[ch]=(int16_t)(rnd()%101-50);
            for(n=0;n<s.net[ch].count;n++)for(j=0;j<3;j++)s.net[ch].weight[n][j]=u(-.01,.01);
        }
        s.step=19;prior=s;g_e5_online_nn_scale=g_e5_online_learning_scale=1;
        assert(e5_step(&s,&in,&out)&&e5_r2_step(&prior,&in,&old));
        assert(!memcmp(&s,&prior,sizeof(s))&&!memcmp(&out,&old,sizeof(out)));
    }
    for(i=0;i<60000;i++) {
        assert(e5_reset(&s,12,i%3==0?4:(i%3==1?59:60)));
        memset(&in,0,sizeof(in));in.limit[0]=1200;in.limit[1]=i%4?1200:800;
        g_e5_online_nn_scale=(float)u(.5,1.25);g_e5_online_learning_scale=(float)u(.5,1);
        for(ch=0;ch<2;ch++) {
            in.q[ch]=u(-.0003,.0003);in.velocity[ch]=u(-.0003,.0003);in.acceleration[ch]=u(-.1,.1);
            in.raw_rpm[ch]=i%7?0:(int16_t)(rnd()%81-40);s.ca_delta[ch]=(int16_t)(rnd()%101-50);
            for(n=0;n<s.net[ch].count;n++)for(j=0;j<3;j++)s.net[ch].weight[n][j]=u(-.01,.01);
        }
        assert(e5_step(&s,&in,&out));assert(e5_ca_sector_ok(out.sigma,(int)out.ca_delta[0],(int)out.ca_delta[1]));
        for(ch=0;ch<2;ch++){assert(e5_ca_envelope_ok(in.raw_rpm[ch],(int)out.current[ch],(int)in.limit[ch]));assert(ABS(out.ca_delta[ch])<=300);}
    }
    assert(e5_reset(&s,12,4));g_e5_online_nn_scale=NAN;
    assert(!e5_step(&s,&in,&out)&&s.fault&&out.current[0]==0&&out.current[1]==0);
    action=e5_ol_crc((const uint8_t*)"123456789",9);assert(action==0x29b1);
    printf("PASS supervised protocol,busy10000,CRC20000,resync,session/stale/range/NaN/two-stageARM/expiry/STOP/watchdog/wrap;default60000 exactR2;parameter60000 originaloutputguards;invalidcorefailclosed.\n");return 0;
}
