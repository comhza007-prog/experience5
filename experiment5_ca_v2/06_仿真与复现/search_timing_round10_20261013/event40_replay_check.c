#include <stdio.h>
#include <string.h>
/* HOST diagnosis only, not a continuous-weight or closed-loop replay.
 * Compare old ray / new balanced allocation at the SAME recorded state,
 * using integer desired commands BEFORE the one-time speed guard.
 * Decimal-rounded sigma is used; matches are checked, never assumed. */
#define DIAG_BALANCED_CONTRACTION 0
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
#undef DIAG_BALANCED_CONTRACTION
#define DIAG_BALANCED_CONTRACTION 1
#undef e5_ca_actuation
#undef e5_ca_abs
#undef e5_ca_clip
#undef e5_ca_sector_ok
#undef e5_ca_envelope_ok
#undef e5_ca_contract_ray
#undef e5_ca_contract
#undef e5_ca_allocate
#include "experiment5_ca_actuator.h"
int main(void) {
    unsigned index,ch,j;double x[40];
    while(scanf("%u",&index)==1) {
        e5_real bi[2],correction[2],sigma[2],limits[2]={1200,1200};
        int16_t rpm[2],previous[2];e5_ca_actuation a;ref_actuation old;
        int skip=0,ok,new_match,eligible;
        for(j=0;j<40;j++)if(scanf("%lf",&x[j])!=1)return 2;
        for(ch=0;ch<2;ch++) {
            e5_real wanted=(e5_real)x[35+ch];
            bi[ch]=(e5_real)x[12+ch];sigma[ch]=(e5_real)x[10+ch];
            rpm[ch]=(int16_t)x[2+ch];previous[ch]=(int16_t)x[20+ch];
            correction[ch]=wanted+(wanted>=0?(e5_real).25:(e5_real)-.25)-bi[ch];
            if(correction[ch]>300 || correction[ch]<-300 || wanted>=1200 || wanted<=-1200)skip=1;
        }
        if(((unsigned)x[22]&1U)||((unsigned)x[32]&2U))skip=1;
        if(skip){printf("{\"index\":%u,\"excluded\":true}\n",index);continue;}
        memset(&a,0,sizeof(a));memset(&old,0,sizeof(old));
        ok=e5_ca_allocate(bi,correction,sigma,limits,rpm,previous,&a);
        if(!ok||!ref_allocate(bi,correction,sigma,limits,rpm,previous,&old))return 3;
        new_match=a.base[0]==(int)x[14]&&a.base[1]==(int)x[15]&&a.delta[0]==(int)x[18]&&
            a.delta[1]==(int)x[19]&&a.mask==(unsigned)x[22]&&a.learning_reason==(unsigned)x[32];
        eligible=(a.mask&(16U|32U))&&!a.speed_mask&&
            ((int)x[16]*(int)x[17]<0)&&previous[0]*(int)x[16]>=0&&previous[1]*(int)x[17]>=0;
        printf("{\"index\":%u,\"excluded\":false,\"newMatchesRecorded\":%d,\"balancedSearchEligible\":%d,\"newDelta\":[%d,%d],\"oldRayCounterfactualDelta\":[%d,%d],\"newMask\":%u,\"oldMask\":%u,\"newReason\":%u,\"newRho\":%.9g}\n",index,new_match,eligible,a.delta[0],a.delta[1],old.delta[0],old.delta[1],a.mask,old.mask,a.learning_reason,(double)a.admitted_fraction);
    }
    return 0;
}
