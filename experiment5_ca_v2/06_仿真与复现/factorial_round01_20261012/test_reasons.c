#include <assert.h>
#include <math.h>
#include <stdio.h>
#include "experiment5_ca_actuator.h"
int main(void) {
    e5_real bi[2]={0,0},corr[2]={100,-100},sigma[2]={0,0},lim[2]={1200,800};
    int16_t rpm[2]={0,0},prev[2]={0,0};e5_ca_actuation a;
    assert(e5_ca_allocate(bi,corr,sigma,lim,rpm,prev,&a));
    assert(a.mask==E5_CA_PROJECTED&&a.learning_reason==DIAG_REASON_RATE_ONLY);
    assert(fabs((double)a.admitted_fraction-E5_CA_DELTA_STEP/100.0)<1e-7);
    /* A generic PROJECTED flag must NOT conceal actual amplitude clipping. */
    bi[0]=1190;corr[0]=100;corr[1]=0;
    assert(e5_ca_allocate(bi,corr,sigma,lim,rpm,prev,&a));
    assert(a.learning_reason&DIAG_REASON_HARD_CLIP);assert(a.admitted_fraction==0);
    bi[0]=bi[1]=0;corr[0]=corr[1]=1000;
    assert(e5_ca_allocate(bi,corr,sigma,lim,rpm,prev,&a));
    assert(a.mask&E5_CA_AMPLITUDE);assert(a.learning_reason!=DIAG_REASON_RATE_ONLY);
    corr[0]=100;corr[1]=-100;sigma[0]=.00001f;
    assert(e5_ca_allocate(bi,corr,sigma,lim,rpm,prev,&a));
    assert(a.mask&E5_CA_SECTOR);assert(a.learning_reason!=DIAG_REASON_RATE_ONLY);
    sigma[0]=0;rpm[0]=60;
    assert(e5_ca_allocate(bi,corr,sigma,lim,rpm,prev,&a));
    assert(a.mask&E5_CA_SPEED);assert(a.learning_reason!=DIAG_REASON_RATE_ONLY);
    /* Reversal retained only by slew is not an excuse to learn outward. */
    rpm[0]=0;prev[0]=100;prev[1]=-100;corr[0]=-100;corr[1]=100;
    assert(e5_ca_allocate(bi,corr,sigma,lim,rpm,prev,&a));
    assert(a.learning_reason==DIAG_REASON_RATE_ONLY&&a.admitted_fraction==0);
    /* A zero CURRENT target must not learn from stale retained compensation. */
    corr[0]=corr[1]=0;
    assert(e5_ca_allocate(bi,corr,sigma,lim,rpm,prev,&a));
    assert(a.admitted_fraction==0);
    puts("PASS explicit pure-slew, hidden hard clip, amplitude, sector, speed, reversal and zero-target classification.");
    return 0;
}
