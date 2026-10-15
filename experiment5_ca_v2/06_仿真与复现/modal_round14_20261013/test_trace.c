#include <assert.h>
#include <stdio.h>
#include "experiment5_event_trace.h"
static e5_event_trace trace;static e5_event_record row;
static void push(unsigned ms,unsigned phase,unsigned mask) {
    unsigned j;for(j=0;j<E5_EVENT_WIDTH;j++)row.v[j]=(float)(ms*E5_EVENT_WIDTH+j);
    e5_event_push(&trace,&row,ms,phase,mask);
}
static void replay(unsigned first,unsigned count,unsigned trigger) {
    float frame[107]={0};unsigned i,c,repeat,j,tc=0xFFFFFF00U;
    assert(trace.ready&&trace.count==count);
    for(i=0;i<count;i++)for(c=0;c<E5_EVENT_CHUNKS;c++)for(repeat=0;repeat<2;repeat++) {
        e5_event_next(&trace,frame,tc);
        assert(frame[88]==4425&&frame[89]==3&&frame[90]==i&&frame[91]==c);
        assert(frame[92]==count&&frame[93]==(trace.triggered?(float)trigger:-1));
        for(j=0;j<8;j++)assert(frame[96+j]==(first+i)*E5_EVENT_WIDTH+c*8+j);
        e5_event_next(&trace,frame,tc);assert(frame[90]==i&&frame[91]==c&&frame[89]==3);tc++;
    }
    e5_event_next(&trace,frame,tc);assert(frame[89]==4);
    for(i=0;i<100;i++){e5_event_next(&trace,frame,tc+i);assert(frame[89]==4);}
}
int main(void) {
    unsigned ms,mask;
    for(mask=0;mask<=32;mask+=16) {
        e5_event_reset(&trace);
        for(ms=0;ms<20000;ms++)push(ms,ms<4000?1:5,mask);
        assert(trace.triggered&&trace.trigger_ms==5000&&trace.count==128);replay(4936,128,5000);
    }
    e5_event_reset(&trace);for(ms=0;ms<5000;ms++)push(ms,ms<4000?1:2,32);
    assert(!trace.triggered&&!trace.ready);e5_event_finish(&trace);replay(4936,64,0);
    e5_event_reset(&trace);for(ms=0;ms<5010;ms++)push(ms,ms<4000?1:2,0);
    e5_event_finish(&trace);replay(4936,74,5000);
    e5_event_reset(&trace);for(ms=0;ms<10000;ms++)push(ms,1,32);
    assert(!trace.triggered);e5_event_finish(&trace);replay(9936,64,0);
    e5_event_reset(&trace);e5_event_finish(&trace);
    {float f[107]={0};e5_event_next(&trace,f,0);assert(f[88]==0);}
    printf("PASS moving5s EVENT48/4425; full/short/empty windows, repeat2, DMA retry, TC wrap;RAM=%u.\n",(unsigned)sizeof(trace));return 0;
}
