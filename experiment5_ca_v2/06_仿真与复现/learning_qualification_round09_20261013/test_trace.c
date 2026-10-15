#include <assert.h>
#include <stdio.h>
#include "experiment5_event_trace.h"
static e5_event_trace trace;
static e5_event_record row;
static void push(unsigned ms,unsigned phase,unsigned mask) {
    unsigned j;
    for(j=0;j<E5_EVENT_WIDTH;j++)row.v[j]=(float)(ms*E5_EVENT_WIDTH+j);
    e5_event_push(&trace,&row,ms,phase,mask);
}
static void check_replay(unsigned first,unsigned count,unsigned trigger) {
    float frame[107]={0};unsigned i,j,chunk,repeat,completed=0xFFFFFF00U;
    assert(trace.ready&&trace.count==count);
    for(i=0;i<count;i++)for(chunk=0;chunk<E5_EVENT_CHUNKS;chunk++)for(repeat=0;repeat<E5_EVENT_REPEATS;repeat++) {
        e5_event_next(&trace,frame,completed);
        assert(frame[88]==4422&&frame[89]==3&&frame[90]==i&&frame[91]==chunk);
        assert(frame[92]==count&&frame[93]==(trace.triggered?(float)trigger:-1));
        for(j=0;j<8;j++)assert(frame[96+j]==(first+i)*E5_EVENT_WIDTH+chunk*8U+j);
        /* Failed submission/no TC must not consume a record. */
        e5_event_next(&trace,frame,completed);
        assert(frame[90]==i&&frame[91]==chunk&&frame[89]==3);
        completed++;
    }
    e5_event_next(&trace,frame,completed);
    assert(frame[89]==4&&frame[90]==count-1&&frame[91]==E5_EVENT_CHUNKS-1);
    for(i=0;i<100;i++){e5_event_next(&trace,frame,completed+i);assert(frame[89]==4&&frame[90]==count-1&&frame[91]==E5_EVENT_CHUNKS-1);}
}
int main(void) {
    unsigned ms,mask;
    assert(sizeof(e5_event_trace)<=20600U);
    for(mask=16;mask<=32;mask+=16) {
        e5_event_reset(&trace);
        for(ms=0;ms<20000;ms++)push(ms,ms<4000?1U:2U,ms==8000?mask:0);
        assert(trace.triggered&&trace.trigger_ms==8000&&trace.count==128);
        check_replay(7936,128,8000);
    }
    /* Constraint exceptions during the initial hold must not trigger. */
    e5_event_reset(&trace);for(ms=0;ms<5000;ms++)push(ms,1,16);
    assert(!trace.triggered&&!trace.ready&&trace.count==64);
    e5_event_finish(&trace);check_replay(4936,64,0);
    /* No-event run and truncated post-event capture remain explicitly sized. */
    e5_event_reset(&trace);for(ms=0;ms<20000;ms++)push(ms,2,0);
    e5_event_finish(&trace);check_replay(19936,64,0);
    e5_event_reset(&trace);for(ms=0;ms<8010;ms++)push(ms,2,ms==8000?16:0);
    e5_event_finish(&trace);assert(trace.count==74);check_replay(7936,74,8000);
    e5_event_reset(&trace);e5_event_finish(&trace);
    {float frame[107]={0};e5_event_next(&trace,frame,0);assert(frame[88]==0);}
    printf("PASS event windows, ring wrap, no-event/truncated capture, DMA retry, completion hold, TC counter wrap; RAM=%u bytes\n",(unsigned)sizeof(trace));
    return 0;
}
