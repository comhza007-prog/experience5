#include <assert.h>
#include <math.h>
#include <stdio.h>
#include <string.h>
#include <stdlib.h>
#include "experiment5_error_wave.h"
#include "experiment5_error_summary.h"
static void set_sample(float v[107],unsigned k) {
    memset(v,0,107U*sizeof(float));
    v[0]=12.0f+.04f*(float)k;v[79]=4.0f+.04f*(float)k;
    v[2]=k<100U?2.0f:(k<150U?3.0f:(k<250U?4.0f:5.0f));v[106]=1;
    v[3]=.002f;v[5]=.0018f;v[6]=.0016f;
}
static void end_sample(float v[107]) {
    memset(v,0,107U*sizeof(float));v[0]=40;v[2]=6;v[46]=20000;
}
static void feed(e5_error_summary *s,float v[107],unsigned sequence,unsigned *completed) {
    e5_summary_complete(s,*completed,0);e5_summary_observe(s,v);
    e5_error_wave(v);e5_summary_display(s,v);
    e5_summary_stage(s,v,sequence,*completed);(*completed)++;
}
static void fixture_tests(void) {
    e5_error_summary s;float v[107],before[107];unsigned i,j,completed=0;
    e5_summary_reset(&s);
    for(i=0;i<400U;i++) {set_sample(v,i);feed(&s,v,300U+i,&completed);}
    e5_summary_complete(&s,completed,0);end_sample(v);e5_summary_observe(&s,v);
    for(j=0;j<107U;j++)if(j!=0U&&j!=2U&&j!=22U&&j!=46U&&j!=106U)v[j]=(float)j+.25f;
    memcpy(before,v,sizeof(v));e5_summary_display(&s,v);
    assert(s.samples==400U&&s.phase_mask==15U&&e5_summary_valid(&s));
    assert(fabsf(v[53]-.3f)<.000001f&&fabsf(v[54]-.2f)<.000001f);
    for(j=0;j<107U;j++)if(j!=53U&&j!=54U)assert(memcmp(&v[j],&before[j],sizeof(float))==0);
    v[0]=39.999f;v[53]=-.8f;v[54]=-.7f;e5_summary_display(&s,v);assert(v[53]==-.8f&&v[54]==-.7f);
    v[0]=40;v[2]=5;v[53]=-.8f;v[54]=-.7f;e5_summary_display(&s,v);assert(v[53]==-.8f&&v[54]==-.7f);
    v[0]=40;v[2]=9;e5_summary_observe(&s,v);e5_summary_display(&s,v);assert(v[53]==-1&&v[54]==-1);
    e5_summary_reset(&s);end_sample(v);e5_summary_observe(&s,v);e5_summary_display(&s,v);assert(v[53]==-1&&v[54]==-1);
    e5_summary_reset(&s);completed=0;
    for(i=0;i<200U;i++){set_sample(v,i);feed(&s,v,i,&completed);}
    e5_summary_complete(&s,completed,0);end_sample(v);e5_summary_observe(&s,v);e5_summary_display(&s,v);assert(v[53]==-1&&v[54]==-1);
    e5_summary_reset(&s);set_sample(v,0);e5_summary_stage(&s,v,10,5);
    e5_summary_complete(&s,5,0);assert(s.samples==0&&s.pending);
    e5_summary_complete(&s,6,1);assert(s.samples==0&&s.invalid&&!s.pending);
    e5_summary_reset(&s);set_sample(v,0);e5_summary_stage(&s,v,10,5);e5_summary_cancel_pending(&s);assert(s.invalid&&!s.pending);
    e5_summary_reset(&s);set_sample(v,0);e5_summary_rejected(&s,v);assert(s.invalid);
    e5_summary_reset(&s);completed=0;set_sample(v,0);feed(&s,v,100,&completed);
    set_sample(v,2);feed(&s,v,102,&completed);e5_summary_complete(&s,completed,0);assert(s.invalid);
    e5_summary_reset(&s);set_sample(v,0);v[70]=1;e5_summary_observe(&s,v);assert(s.invalid);
    e5_summary_reset(&s);set_sample(v,0);v[5]=(float)NAN;e5_summary_stage(&s,v,1,0);assert(s.invalid&&!s.pending);
    /* A delayed start crosses40s during motion: never latch a partial RMS. */
    e5_summary_reset(&s);completed=0;
    for(i=0;i<400U;i++) {
        set_sample(v,i);v[0]+=30;feed(&s,v,300U+i,&completed);
        assert(!s.computed&&fabsf(v[53]+.3f)<.000001f&&fabsf(v[54]-.2f)<.000001f);
    }
    e5_summary_complete(&s,completed,0);end_sample(v);v[0]=60;
    e5_summary_observe(&s,v);e5_summary_display(&s,v);
    assert(s.computed&&e5_summary_valid(&s)&&fabsf(v[53]-.3f)<.000001f);
    /* Six-decimal metre rule versus standard decimal formatting; no binary
     * exact half-micrometre ties occur inside the actual +/-4mm envelope. */
    for(i=0;i<100000U;i++) {
        char text[80];float x=((float)i/99999.0f-.5f)*.008f;
        snprintf(text,sizeof(text),"%.6f",(double)x);
        assert(fabs(e5_summary_micro(x)-strtod(text,NULL)*1000000.0)<1e-7);
    }
}
int main(int argc,char **argv) {
    fixture_tests();
    if(argc>1&&strcmp(argv[1],"--replay")==0) {
        e5_error_summary s;float v[107];unsigned j,completed=0,rows=0;double first_summary=-1;
        e5_summary_reset(&s);
        for(;;) {
            if(scanf("%f",&v[0])!=1)break;
            for(j=1;j<107U;j++)assert(scanf("%f",&v[j])==1);
            feed(&s,v,(unsigned)v[1],&completed);rows++;
            if(s.computed&&first_summary<0)first_summary=v[0];
        }
        e5_summary_complete(&s,completed,0);
        printf("{\"fixtureTestsPassed\":true,\"rows\":%u,\"samples\":%u,\"valid\":%s,\"firstSummaryUptime_s\":%.9g,\"trackingRMSE_mm\":%.12g,\"syncRMS_mm\":%.12g}\n",
               rows,s.samples,e5_summary_valid(&s)?"true":"false",first_summary,(double)s.tracking_rms,(double)s.sync_rms);
        assert(e5_summary_valid(&s)&&s.computed);
    } else puts("PASS: six-decimal100000fixtures; all105otherchannels; TCcommit/errors; 39.999/40s boundary and delayed-motion phase6 gate.");
    return 0;
}
