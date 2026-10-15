#include <assert.h>
#include <stdio.h>
#include <string.h>
#include <math.h>
#define e5_ca_actuation ref_actuation
#define e5_ca_abs ref_abs
#define e5_ca_clip ref_clip
#define e5_ca_sector_ok ref_sector_ok
#define e5_ca_envelope_ok ref_envelope_ok
#define e5_ca_contract_ray ref_contract_ray
#define e5_ca_contract ref_contract
#define e5_ca_allocate ref_allocate
#include "experiment5_ca_actuator_reference.h"
#undef E5_CA_ACTUATOR_H
#undef e5_ca_actuation
#undef e5_ca_abs
#undef e5_ca_clip
#undef e5_ca_sector_ok
#undef e5_ca_envelope_ok
#undef e5_ca_contract_ray
#undef e5_ca_contract
#undef e5_ca_allocate
#include "experiment5_ca_actuator.h"
static unsigned seed=917631U;
static unsigned rnd(void){seed=1664525U*seed+1013904223U;return seed;}
static e5_real uniform(double l,double h){return (e5_real)(l+(h-l)*(rnd()&65535U)/65535.0);}
int main(void) {
    e5_real bi[2],correction[2],sigma[2],limits[2];
    int16_t rpm[2],previous[2];int32_t lim[2],target[2],dl,dr;
    unsigned n,ch,contracted=0,withdrawn=0,pure=0;
    int r1,r2;ref_actuation old;e5_ca_actuation next;e5_ca_sector_cache cache;
    assert(sizeof(old)==sizeof(next));
    for(n=0;n<600000U;n++) {
        for(ch=0;ch<2;ch++) {
            limits[ch]=(e5_real)(n%11==0?16000:(n%7==0?2400:1200));
            lim[ch]=(int32_t)limits[ch];bi[ch]=uniform(-1.3*lim[ch],1.3*lim[ch]);
            correction[ch]=uniform(-450,450);
            sigma[ch]=uniform(-.4,.4);
            if(n%4==0)sigma[ch]*=(e5_real)1e-5;
            if(n%19==0)sigma[ch]=ch?-(e5_real)0:(e5_real)0;
            rpm[ch]=(int16_t)(n%3==0?0:(int)(rnd()%241U)-120);
            previous[ch]=(int16_t)((int)(rnd()%601U)-300);
            target[ch]=(int32_t)((int)(rnd()%601U)-300);
        }
        dl=(int32_t)((int)(rnd()%601U)-300);dr=(int32_t)((int)(rnd()%601U)-300);
        e5_ca_sector_prepare(sigma,&cache);
        assert(e5_ca_sector_cached_ok(&cache,dl,dr)==ref_sector_ok(sigma,dl,dr));
        memset(&old,0,sizeof(old));memset(&next,0,sizeof(next));
        r1=ref_allocate(bi,correction,sigma,limits,rpm,previous,&old);
        r2=e5_ca_allocate(bi,correction,sigma,limits,rpm,previous,&next);
        assert(r1==r2 && memcmp(&old,&next,sizeof(old))==0);
        if(r2){if(next.mask&32U)contracted++;if(next.mask&16U)withdrawn++;
            if(next.learning_reason==DIAG_REASON_RATE_ONLY)pure++;}
        /* Exercise the exception directly regardless of normal-search success. */
        memset(&old,0,sizeof(old));memset(&next,0,sizeof(next));
        for(ch=0;ch<2;ch++)old.base[ch]=next.base[ch]=(int16_t)(bi[ch]);
        r1=ref_contract(sigma,rpm,lim,previous,target,&old);
        r2=e5_ca_contract(sigma,rpm,lim,previous,target,&next);
        assert(r1==r2 && memcmp(&old,&next,sizeof(old))==0);
    }
    assert(contracted&&withdrawn&&pure);
    printf("PASS 600000 exact allocator + 600000 direct-exception + 600000 sector-cache comparisons; contraction=%u withdrawal=%u pure=%u.\n",contracted,withdrawn,pure);
    return 0;
}
