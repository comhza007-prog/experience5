#include <assert.h>
#include <stdio.h>
#include <string.h>
#include "experiment5_ca_actuator.h"
static unsigned seed=142019U;
static unsigned rnd(void){seed=1664525U*seed+1013904223U;return seed;}
static e5_real uniform(e5_real lo,e5_real hi){return lo+(hi-lo)*(e5_real)(rnd()&65535U)/(e5_real)65535;}
static int distance(const e5_ca_actuation *a,const int32_t target[2]) {
    int x=a->delta[0]-target[0],y=a->delta[1]-target[1];return x*x+y*y;
}
static void invariants(const e5_ca_actuation *a,const e5_real sigma[2],
                       const int16_t rpm[2],const int32_t lim[2],const int16_t prev[2]) {
    unsigned ch;
    for(ch=0;ch<2;ch++) {
        assert(e5_ca_abs(a->delta[ch])<=300);
        assert(e5_ca_abs(a->delta[ch])<=e5_ca_abs(prev[ch]));
        assert((int32_t)a->delta[ch]*prev[ch]>=0);
        assert(e5_ca_envelope_ok(rpm[ch],a->base[ch]+a->delta[ch],lim[ch]));
    }
    assert(e5_ca_sector_ok(sigma,a->delta[0],a->delta[1]));
}
int main(void) {
    e5_real sigma[2]={-.005593f,-.000018f};
    int16_t rpm[2]={0,0},prev[2]={28,-23};
    int32_t lim[2]={1200,1200},target[2]={26,-25};
    e5_ca_actuation old,newer;unsigned n,ch,improved=0;
    memset(&old,0,sizeof(old));old.base[0]=242;old.base[1]=-244;newer=old;
    assert(e5_ca_contract_ray(sigma,rpm,lim,prev,target,&old));
    assert(e5_ca_contract(sigma,rpm,lim,prev,target,&newer));
    assert(old.delta[0]==2&&old.delta[1]==-2);
#if DIAG_BALANCED_CONTRACTION
    assert(newer.delta[0]==23&&newer.delta[1]==-23);
    assert(distance(&newer,target)==13&&distance(&old,target)==1105);
#else
    assert(newer.delta[0]==old.delta[0]&&newer.delta[1]==old.delta[1]);
#endif
    invariants(&newer,sigma,rpm,lim,prev);
    for(n=0;n<100000;n++) {
        memset(&old,0,sizeof(old));
        for(ch=0;ch<2;ch++) {
            prev[ch]=(int16_t)((int)(rnd()%601U)-300);
            target[ch]=(int32_t)((int)(rnd()%601U)-300);
            lim[ch]=(int32_t)(200U+rnd()%1001U);
            rpm[ch]=(int16_t)((int)(rnd()%101U)-50);
            old.base[ch]=(int16_t)((int)(rnd()%(unsigned)(2*lim[ch]+1))-lim[ch]);
            if(e5_motion_speed_guard(rpm[ch],&old.base[ch]))old.speed_mask|=1U<<ch;
            sigma[ch]=uniform((e5_real)-.1,(e5_real).1);
        }
        if(n%3==0)sigma[1]=uniform((e5_real)-.0001,(e5_real).0001);
        if(n%5==0)old.speed_mask=3U;
        newer=old;
        (void)e5_ca_contract_ray(sigma,rpm,lim,prev,target,&old);
        (void)e5_ca_contract(sigma,rpm,lim,prev,target,&newer);
        invariants(&newer,sigma,rpm,lim,prev);
        assert(distance(&newer,target)<=distance(&old,target));
        if(newer.delta[0]!=old.delta[0]||newer.delta[1]!=old.delta[1]) {
            improved++;assert(newer.delta[0]==-newer.delta[1]);assert(distance(&newer,target)<distance(&old,target));
            assert(target[0]*target[1]<0&&newer.speed_mask==0);
        }
        if(old.speed_mask)assert(newer.delta[0]==0&&newer.delta[1]==0);
    }
    printf("PASS recorded contraction regression, 100000 same-state guarded cases, no-worse target distance; improvements=%u; max exceptional candidates=56\n",improved);
    return 0;
}
