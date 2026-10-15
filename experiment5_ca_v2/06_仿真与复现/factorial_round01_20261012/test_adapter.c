#include <assert.h>
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "experiment5_ca_actuator.h"
static e5_state state;
static unsigned seed=914237U,cases,withdrawals,contractions;
static unsigned rnd(void){seed=1664525U*seed+1013904223U;return seed;}
static float uniform(float l,float h){return l+(h-l)*(rnd()&65535U)/65535.0f;}
static void invariant(const e5_ca_actuation *a,const e5_real sigma[2],
    const e5_real limits[2],const int16_t rpm[2],const int16_t previous[2]) {
    unsigned ch;double w,b;
    for(ch=0;ch<2;ch++) {
        assert(abs(a->delta[ch])<=E5_CA_MAX_DELTA);
        assert((int)a->command[ch]-(int)a->base[ch]==a->delta[ch]);
        assert(e5_ca_envelope_ok(rpm[ch],a->command[ch],(int)limits[ch]));
        if(a->mask&E5_CA_WITHDRAWN) assert(a->delta[ch]==0);
        else if(a->mask&E5_CA_CONTRACTED) {
            assert(abs(a->delta[ch])<=abs(previous[ch]));
            assert((int)a->delta[ch]*previous[ch]>=0);
        } else assert(abs(a->delta[ch]-previous[ch])<=E5_CA_DELTA_STEP);
    }
    assert(e5_ca_sector_ok(sigma,a->delta[0],a->delta[1]));
    assert(!((a->mask&E5_CA_WITHDRAWN)&&(a->mask&E5_CA_CONTRACTED)));
    if(a->mask&E5_CA_CONTRACTED) {
        assert(a->delta[0]||a->delta[1]);
        assert(a->speed_mask==0);
    }
    w=(double)sigma[0]*.006197916666666667*(a->delta[0]-a->delta[1]);b=10*(double)sigma[0]*sigma[0];
    assert(w<=b+1e-7*(1+b));
    w=-(double)sigma[1]*.3*.006197916666666667*(a->delta[0]+a->delta[1]);b=6.25*(double)sigma[1]*sigma[1];
    assert(w<=b+1e-7*(1+b));
    cases++;if(a->mask&E5_CA_WITHDRAWN)withdrawals++;
    if(a->mask&E5_CA_CONTRACTED) contractions++;
}
int main(void) {
    e5_real base[2]={-198.4211598f,-174.2781802f},corr[2]={-109.936079f,136.293485f};
    e5_real sigma[2]={0,-.00798f},limits[2]={1200,1200};
    int16_t rpm[2]={-40,12},previous[2]={0,0};e5_ca_actuation a;
    unsigned n,ch;int speed;e5_real old_aw[2];e5_input in;e5_output out;
    /* Recorded same-state counterexample: no post-guard sector excess now. */
    assert(e5_ca_allocate(base,corr,sigma,limits,rpm,previous,&a));
    invariant(&a,sigma,limits,rpm,previous);assert(a.mask&E5_CA_SECTOR);
    printf("recorded_sample final=%d,%d BASE=%d,%d NN=%d,%d mask=%u\n",a.command[0],a.command[1],a.base[0],a.base[1],a.delta[0],a.delta[1],a.mask);
    /* A newly tight yaw budget must retain a feasible nonzero increment,
     * rather than v1's full zeroing when the normal +/-2 neighborhood fails. */
    base[0]=base[1]=0;corr[0]=corr[1]=100;
    previous[0]=previous[1]=100;sigma[0]=0;sigma[1]=-.002f;rpm[0]=rpm[1]=0;
    assert(e5_ca_allocate(base,corr,sigma,limits,rpm,previous,&a));
    invariant(&a,sigma,limits,rpm,previous);
    assert(a.mask&E5_CA_CONTRACTED);assert(a.delta[0]>0&&a.delta[1]>0);
    printf("tight_sector retained=%d,%d mask=%u\n",a.delta[0],a.delta[1],a.mask);
    /* Preserve the current target's direction, not the old equal-axis ray. */
    corr[0]=80;corr[1]=20;sigma[1]=-.02f;
    assert(e5_ca_allocate(base,corr,sigma,limits,rpm,previous,&a));
    invariant(&a,sigma,limits,rpm,previous);
    assert(a.mask&E5_CA_CONTRACTED);
    assert(a.delta[0]>a.delta[1]&&a.delta[1]>0);
    sigma[1]=-.002f;
    /* An obsolete compensation must not survive merely to reduce zeroing. */
    corr[0]=corr[1]=0;
    assert(e5_ca_allocate(base,corr,sigma,limits,rpm,previous,&a));
    invariant(&a,sigma,limits,rpm,previous);
    assert(a.mask&E5_CA_WITHDRAWN);assert(a.delta[0]==0&&a.delta[1]==0);
    corr[0]=corr[1]=-100;
    assert(e5_ca_allocate(base,corr,sigma,limits,rpm,previous,&a));
    invariant(&a,sigma,limits,rpm,previous);
    assert(a.mask&E5_CA_WITHDRAWN);assert(a.delta[0]==0&&a.delta[1]==0);
    /* Sudden baseline headroom loss: preserve the admissible fraction. */
    base[0]=1170;base[1]=-1150;corr[0]=100;corr[1]=-80;
    previous[0]=100;previous[1]=-80;sigma[0]=sigma[1]=0;
    assert(e5_ca_allocate(base,corr,sigma,limits,rpm,previous,&a));
    invariant(&a,sigma,limits,rpm,previous);
    assert(a.mask&E5_CA_CONTRACTED);assert(a.delta[0]>0&&a.delta[1]<0);
    printf("tight_headroom retained=%d,%d mask=%u\n",a.delta[0],a.delta[1],a.mask);
    previous[0]=previous[1]=0;
    /* With no NN history/prediction, EXACT original guarded BASE commands. */
    corr[0]=corr[1]=0;
    for(speed=-32768;speed<=32767;speed++) {
        int16_t expected[2];
        rpm[0]=(int16_t)speed;rpm[1]=(int16_t)(-speed-1);
        base[0]=uniform(-4000,4000);base[1]=uniform(-4000,4000);
        assert(e5_ca_allocate(base,corr,sigma,limits,rpm,previous,&a));
        for(ch=0;ch<2;ch++) {
            assert(e5_motion_quantize((float)e5_ca_clip(base[ch],limits[ch]),&expected[ch]));
            e5_motion_speed_guard(rpm[ch],&expected[ch]);
            assert(a.command[ch]==expected[ch]&&a.delta[ch]==0);
        }
        invariant(&a,sigma,limits,rpm,previous);
    }
    /* Huge correction reaches ONLY 300 incremental counts, not 1200. */
    base[0]=base[1]=0;corr[0]=corr[1]=12000;sigma[0]=sigma[1]=0;rpm[0]=rpm[1]=0;
    for(n=0;n<300;n++) {
        assert(e5_ca_allocate(base,corr,sigma,limits,rpm,previous,&a));
        invariant(&a,sigma,limits,rpm,previous);memcpy(previous,a.delta,sizeof(previous));
    }
    assert(a.delta[0]==300&&a.delta[1]==300);
    /* Sudden brake requirement: withdraw NN, do not limit the baseline brake. */
    rpm[0]=rpm[1]=60;
    assert(e5_ca_allocate(base,corr,sigma,limits,rpm,previous,&a));
    invariant(&a,sigma,limits,rpm,previous);assert(a.mask&E5_CA_WITHDRAWN);
    assert(a.command[0]==-200&&a.command[1]==-200);
    memcpy(previous,a.delta,sizeof(previous));
    for(n=0;n<200000;n++) {
        for(ch=0;ch<2;ch++) {
            base[ch]=uniform(-4000,4000);corr[ch]=uniform(-12000,12000);
            sigma[ch]=uniform(-.12f,.12f);limits[ch]=(e5_real)(200+rnd()%1001);
            rpm[ch]=(int16_t)(rnd()&65535U);
        }
        assert(e5_ca_allocate(base,corr,sigma,limits,rpm,previous,&a));
        invariant(&a,sigma,limits,rpm,previous);memcpy(previous,a.delta,sizeof(previous));
    }
    /* Real core, online adaptation, gates/growth/AW checked step by step. */
    assert(e5_reset(&state,E5_CA_BLNN,4));memset(&in,0,sizeof(in));
    state.net[1].weight[0][1]=5;in.limit[0]=in.limit[1]=1200;
    for(n=0;n<40000;n++) {
        in.q[0]=.001f*sinf(n*.013f);in.q[1]=.002f*sinf(n*.031f);
        in.velocity[0]=.002f*cosf(n*.013f);in.velocity[1]=.002f*cosf(n*.031f);
        in.acceleration[0]=.05f*sinf(n*.037f);in.acceleration[1]=.05f*cosf(n*.011f);
        for(ch=0;ch<2;ch++) {in.raw_rpm[ch]=(int16_t)((int)(rnd()%181)-90);previous[ch]=state.ca_delta[ch];old_aw[ch]=state.aw[ch];}
        assert(e5_step(&state,&in,&out));
        assert(out.learning_gate>=0&&out.learning_gate<=1);
#if DIAG_NEW_LEARNING
        if((out.ca_mask||out.diagnostic_reason)&&out.diagnostic_reason!=DIAG_REASON_RATE_ONLY)
            assert(out.learning_gate==0);
        if(out.diagnostic_reason==DIAG_REASON_RATE_ONLY)
            assert(out.learning_gate<=out.admitted_fraction+(e5_real)1e-6);
#else
        if(out.ca_mask) assert(out.learning_gate==0);
#endif
        if(out.learning_gate<.5f&&state.step%20==0) assert(out.novelty[0]==0&&out.novelty[1]==0);
        for(ch=0;ch<2;ch++) {
            e5_real expected=old_aw[ch]+(e5_real).001*(16*(out.current[ch]-out.requested[ch])-20*old_aw[ch]);
            a.command[ch]=(int16_t)out.current[ch];a.base[ch]=(int16_t)out.ca_guarded_base[ch];a.delta[ch]=(int16_t)out.ca_delta[ch];
            assert(out.current[ch]==(e5_real)a.command[ch]);
            assert(fabsf(state.aw[ch]-expected)<1e-5f);
            assert(fabsf((out.current[ch]-out.requested[ch])-(out.ca_guarded_base[ch]-out.ca_base[ch]))<.001f);
        }
        a.mask=out.ca_mask;a.speed_mask=out.ca_speed_mask;invariant(&a,out.sigma,in.limit,in.raw_rpm,previous);
    }
    in.q[0]=NAN;assert(!e5_step(&state,&in,&out));assert(state.fault&&out.current[0]==0&&out.current[1]==0);
    printf("PASS cases=%u explicit_NN_withdrawals=%u feasible_contractions=%u; 65536 zero-NN equivalence, 200000 signed-RPM allocation, 40000 actual-core AW/gating steps.\n",cases,withdrawals,contractions);
    puts("LIMITATION: arbitrary-input invariants only; no physical plant or hardware success prediction.");
    return 0;
}
