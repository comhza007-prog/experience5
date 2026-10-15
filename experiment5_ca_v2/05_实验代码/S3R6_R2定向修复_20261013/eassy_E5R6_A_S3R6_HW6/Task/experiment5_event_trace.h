#ifndef E5_EVENT_TRACE_H
#define E5_EVENT_TRACE_H
#include <stdint.h>
#include <string.h>
#define E5_EVENT_CAPACITY 128U
#define E5_EVENT_PRE 64U
#define E5_EVENT_WIDTH 48U
#define E5_EVENT_CHUNKS 6U
#define E5_EVENT_REPEATS 2U
#define E5_EVENT_MAGIC 4428U
#define E5_EVENT_TRIGGER_MS 10050U
/* R6 schema4476: early-return window at elapsed10.050s.
 * v40/41 actual modal learning; v42/43 repair mode; v44/45 raw pre-update
 * predictions; v46/47 actual same-feature post-update (mode1/2/3/5).
 * Mode5=moving Y directional repair; alpha never mode5. No modal mode4.
 * Mode3=useful translation leakage paused; it is NOT mode1 contraction.
 * I25=3/v42=3 identifies retention. I26/v43 remain R1 rotation modes0/1/2.
 * Event v23 remains NOMINAL old S3 learn, not either actual modal multiplier.
 * Transmission remains107 channels/40ms;128*6*2 frames after stop.
 * Old EVENT40/schema4466 data must NOT be decoded with this mapping. */
/* Diagnostic ONLY: 64 preceding motor cycles, trigger cycle, 63 following.
 * Real cycle times are stored: nominal 1 ms is NOT assumed in decoding.
 * No motor commands, limits, network state or UART cadence are changed.
 * After successful phase 6 ONLY, serialize48 values via six8-value chunks
 * in I96..103. I88..93 identify this different AFTER-STOP field mapping.
 * R6 schema4476: return10.050s capture; stopmagic4428.
 * v37/38/39 identify variant/learning/search flags, not reserved zeros.
 * Original fault replay ALWAYS takes precedence. No malloc, no active TX.
 * Cursor advances only after the prior UART TC counter changes, so an
 * unsuccessful DMA submission retries the same chunk. UART TC is not an
 * acknowledgement from the PC: decoding still checks missing chunks. */
typedef struct {float v[E5_EVENT_WIDTH];} e5_event_record;
typedef struct {
    e5_event_record rows[E5_EVENT_CAPACITY];
    uint32_t head,count,triggered,remaining,ready,trigger_ms;
    uint32_t cursor,chunk,pending,last_completed,complete;
    uint32_t repeat;
} e5_event_trace;
static void e5_event_reset(e5_event_trace *t) {memset(t,0,sizeof(*t));}
static void e5_event_push(e5_event_trace *t,const e5_event_record *r,
                          uint32_t elapsed,uint32_t phase,uint32_t mask) {
    (void)mask; /* Common clock trigger, independent of method/constraints. */
    if(t->ready)return;
    t->rows[t->head]=*r;t->head=(t->head+1U)%E5_EVENT_CAPACITY;
    if(!t->triggered) {
        if(phase>=2U && elapsed>=E5_EVENT_TRIGGER_MS) {
            t->triggered=1U;t->trigger_ms=elapsed;t->count++;
            t->remaining=E5_EVENT_CAPACITY-t->count;
            if(!t->remaining)t->ready=1U;
        } else if(t->count<E5_EVENT_PRE)t->count++;
    } else {
        t->count++;
        if(t->remaining)t->remaining--;
        if(!t->remaining)t->ready=1U;
    }
}
static void e5_event_finish(e5_event_trace *t) {t->ready=1U;}
static void e5_event_next(e5_event_trace *t,float values[107],uint32_t completed) {
    uint32_t slot;
    if(!t->ready||!t->count)return;
    if(t->pending && completed!=t->last_completed && !t->complete) {
        /* Post-stop only: two successful TC submissions per chunk tolerate
         * one lost exported frame. Still not a PC reception acknowledgement;
         * decoder must check all chunks and equal duplicate payloads. */
        if(t->repeat+1U<E5_EVENT_REPEATS)t->repeat++;
        else {
            t->repeat=0;
            if(t->chunk+1U<E5_EVENT_CHUNKS)t->chunk++;
            else if(t->cursor+1U<t->count){t->cursor++;t->chunk=0;}
            else t->complete=1U;
        }
    }
    t->pending=1U;t->last_completed=completed;
    slot=(t->head+E5_EVENT_CAPACITY-t->count+t->cursor)%E5_EVENT_CAPACITY;
    values[88]=(float)E5_EVENT_MAGIC;
    values[89]=t->complete?4.0f:3.0f;
    values[90]=(float)t->cursor;values[91]=(float)t->chunk;
    values[92]=(float)t->count;
    values[93]=t->triggered?(float)t->trigger_ms:-1.0f;
    memcpy(&values[96],&t->rows[slot].v[t->chunk*8U],8U*sizeof(float));
}
#endif
