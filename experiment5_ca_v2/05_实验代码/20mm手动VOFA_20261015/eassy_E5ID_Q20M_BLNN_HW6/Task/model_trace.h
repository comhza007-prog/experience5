#ifndef E5_MODEL_TRACE_H
#define E5_MODEL_TRACE_H
#include <stdint.h>
#include <string.h>
#define E5_MODEL_CAPACITY 2048U
#define E5_MODEL_INTERVAL_MS 10U
#define E5_MODEL_MAGIC 4435U
/* Read-only full-trajectory feedback capture, no control-policy change.
 * Each18-byte row: elapsed_ms16,relative raw encoder16*2,rpm16*2,
 * feedback current16*2,attempted queued command16*2.
 * Travel/clock checks precede capture; no interpretation as amperes.
 * Right relative encoder is raw sign, not inverted position.
 * 2048 rows at10ms cover the unchanged20s trajectory including endpoint.
 * AFTER success only: I96..103=[elapsed_ms,encL,encR,rpmL,rpmR,curL,curR,
 * packedCommand]. packed=(cmdL+1200)*2401+(cmdR+1200), exactly float32.
 * I88=4435,I89=3/4,I90=row,I91=0,I92=count,I93=10.
 * Two DMA-completed copies per row; PC must check duplicates/completeness.
 * Original fault replay takes priority; no active serial bandwidth change. */
typedef struct {uint16_t ms;int16_t encoder[2],rpm[2],current[2],command[2];} e5_model_row;
typedef char e5_model_row_size_must_be18[(sizeof(e5_model_row)==18)?1:-1];
typedef struct {e5_model_row rows[E5_MODEL_CAPACITY];uint32_t count,last_ms,ready,cursor,repeat,pending,last_completed,complete;} e5_model_trace;
static void e5_model_reset(e5_model_trace *t){memset(t,0,sizeof(*t));}
static int e5_model_push(e5_model_trace *t,uint32_t ms,const int32_t encoder[2],const int16_t rpm[2],const int16_t current[2],const int16_t command[2]) {
    e5_model_row *r;uint32_t ch;
    if(t->ready)return 1;
    if(t->count && ms-t->last_ms<E5_MODEL_INTERVAL_MS)return 1;
    if(ms>65535U || t->count>=E5_MODEL_CAPACITY)return 0;
    for(ch=0;ch<2;ch++)if(encoder[ch]<-32768||encoder[ch]>32767||command[ch]<-1200||command[ch]>1200)return 0;
    r=&t->rows[t->count++];r->ms=(uint16_t)ms;t->last_ms=ms;
    for(ch=0;ch<2;ch++){r->encoder[ch]=(int16_t)encoder[ch];r->rpm[ch]=rpm[ch];r->current[ch]=current[ch];r->command[ch]=command[ch];}
    return 1;
}
static void e5_model_finish(e5_model_trace *t){t->ready=1U;}
static void e5_model_next(e5_model_trace *t,float v[107],uint32_t completed) {
    e5_model_row *r;uint32_t ch,packed;
    if(!t->ready||!t->count)return;
    if(t->pending && completed!=t->last_completed && !t->complete) {
        if(!t->repeat)t->repeat=1;
        else {t->repeat=0;if(t->cursor+1U<t->count)t->cursor++;else t->complete=1;}
    }
    t->pending=1;t->last_completed=completed;r=&t->rows[t->cursor];
    v[88]=(float)E5_MODEL_MAGIC;v[89]=t->complete?4.0f:3.0f;
    v[90]=(float)t->cursor;v[91]=0;v[92]=(float)t->count;v[93]=(float)E5_MODEL_INTERVAL_MS;
    v[96]=(float)r->ms;
    for(ch=0;ch<2;ch++){v[97+ch]=(float)r->encoder[ch];v[99+ch]=(float)r->rpm[ch];v[101+ch]=(float)r->current[ch];}
    packed=(uint32_t)(r->command[0]+1200)*2401U+(uint32_t)(r->command[1]+1200);
    v[103]=(float)packed;
}
#endif
