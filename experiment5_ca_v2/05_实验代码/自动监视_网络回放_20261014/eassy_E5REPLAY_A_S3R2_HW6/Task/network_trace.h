#ifndef E5_NETWORK_TRACE_H
#define E5_NETWORK_TRACE_H
#include "blnn_core.h"
#include <string.h>
#define E5_REPLAY_ROWS 360U
#define E5_REPLAY_TRIGGER_MS 5360U
#define E5_REPLAY_MAGIC 4436U
/* Diagnostic only. No gain, output, learning or actuator change.
 * Exact float32 ABI bytes: initial state,360 input/output observations,
 * final state. Capture before/after existing core+outer AW respectively.
 * Exports only after successful phase6,16 bytes/chunk as8 uint16 floats,
 * twice each, advancing only on DMA completion. CRC32 is computed in
 * bounded256-byte pieces after stop, not in the active control loop.
 * Counterfactual same-input learning replay is NOT a new closed-loop plant.
 */
typedef struct {
    uint32_t ms;
    e5_input input;
    int16_t command[2];
    float prediction[2],learning[2];
    uint32_t mask,cause;
} e5_replay_row;
typedef char e5_replay_float_must_be4[(sizeof(e5_real)==4)?1:-1];
typedef char e5_replay_row_must_be80[(sizeof(e5_replay_row)==80)?1:-1];
typedef struct {
    uint32_t version,build,method,state_bytes,input_bytes,row_bytes,count,first_ms,last_ms,nominal_dt_us;
    e5_state initial,final;
    e5_replay_row rows[E5_REPLAY_ROWS];
} e5_replay_blob;
typedef struct {
    e5_replay_blob blob;
    uint32_t started,prepared,ready,cursor,repeat,pending,last_completed,complete;
    uint32_t crc,crc_offset;
} e5_replay_trace;
static void e5_replay_reset(e5_replay_trace *t){memset(t,0,sizeof(*t));t->crc=0xffffffffU;}
static int e5_replay_before(e5_replay_trace *t,uint32_t ms,const e5_state *state,const e5_input *in,uint32_t build) {
    e5_replay_row *r;
    if(ms<E5_REPLAY_TRIGGER_MS||t->ready)return 1;
    if(t->prepared||t->blob.count>=E5_REPLAY_ROWS)return 0;
    if(!t->started){
        t->blob.version=1U;t->blob.build=build;t->blob.method=state->method;
        t->blob.state_bytes=sizeof(e5_state);t->blob.input_bytes=sizeof(e5_input);
        t->blob.row_bytes=sizeof(e5_replay_row);t->blob.first_ms=ms;t->blob.nominal_dt_us=1000U;
        memcpy(&t->blob.initial,state,sizeof(*state));t->started=1U;
    }
    r=&t->blob.rows[t->blob.count];r->ms=ms;memcpy(&r->input,in,sizeof(*in));t->prepared=1U;
    return 1;
}
static int e5_replay_after(e5_replay_trace *t,const e5_state *state,const e5_output *out,const int16_t command[2]) {
    e5_replay_row *r;uint32_t ch;
    if(!t->prepared)return 1;
    if(t->blob.count>=E5_REPLAY_ROWS)return 0;
    r=&t->blob.rows[t->blob.count];
    for(ch=0;ch<2;ch++){
        if(command[ch]<-1200||command[ch]>1200)return 0;
        r->command[ch]=command[ch];r->prediction[ch]=out->dhat[ch];r->learning[ch]=out->learning_axis[ch];
    }
    r->mask=out->ca_mask;r->cause=out->diagnostic_reason;t->blob.last_ms=r->ms;
    t->blob.count++;t->prepared=0U;
    if(t->blob.count==E5_REPLAY_ROWS){memcpy(&t->blob.final,state,sizeof(*state));t->ready=1U;}
    return 1;
}
static uint32_t e5_replay_crc_update(uint32_t crc,const uint8_t *data,uint32_t bytes){
    uint32_t i,j;for(i=0;i<bytes;i++){crc^=data[i];for(j=0;j<8;j++)crc=(crc>>1)^((crc&1U)?0xedb88320U:0U);}return crc;
}
static void e5_replay_next(e5_replay_trace *t,float v[107],uint32_t completed) {
    const uint8_t *data=(const uint8_t*)&t->blob;uint32_t bytes=sizeof(t->blob),chunks=(bytes+15U)/16U,i,offset,n,word;
    v[88]=(float)E5_REPLAY_MAGIC;v[90]=(float)t->cursor;v[92]=(float)bytes;
    if(!t->ready){v[89]=5;v[91]=0;v[93]=0;for(i=96;i<104;i++)v[i]=0;return;}
    if(t->crc_offset<bytes){
        n=bytes-t->crc_offset;if(n>256U)n=256U;
        t->crc=e5_replay_crc_update(t->crc,data+t->crc_offset,n);t->crc_offset+=n;
        v[89]=2;v[91]=0;v[93]=0;for(i=96;i<104;i++)v[i]=0;
        if(t->crc_offset==bytes)t->crc^=0xffffffffU;
        return;
    }
    if(t->pending&&completed!=t->last_completed&&!t->complete){
        if(!t->repeat)t->repeat=1U;
        else{t->repeat=0;if(t->cursor+1U<chunks)t->cursor++;else t->complete=1U;}
    }
    t->pending=1U;t->last_completed=completed;
    v[89]=t->complete?4.0f:3.0f;v[90]=(float)t->cursor;
    v[91]=(float)(t->crc&65535U);v[93]=(float)(t->crc>>16);
    for(i=0;i<8;i++){
        offset=t->cursor*16U+i*2U;word=offset<bytes?data[offset]:0U;
        if(offset+1U<bytes)word|=(uint32_t)data[offset+1U]<<8;
        v[96+i]=(float)word;
    }
}
#endif
