#include <stdio.h>
#include <string.h>
#include "experiment5_ca_actuator.h"
/* HOST ONLY. Reproduce the archived allocator at recorded same-state inputs.
 * Continuous NN weights/predictions are NOT reconstructed. An interior
 * quantization representative reproduces the measured integer target only.
 * Sigma is decimal-rounded; result agreement is checked, not assumed.
 * The balanced witness is NOT firmware and NOT a closed-loop prediction. */
int main(void) {
    unsigned index,j,count;double x[32];
    while(scanf("%u",&index)==1) {
        e5_real bi[2],correction[2],sigma[2],limits[2]={1200,1200};
        int16_t rpm[2],previous[2];e5_ca_actuation a;
        int32_t dl,dr,target[2],lim[2]={1200,1200};
        int32_t wl=0,wr=0,bound,center,sign,witness=0,robust=1;
        double old_distance,witness_distance;
        for(j=0;j<32;j++)if(scanf("%lf",&x[j])!=1)return 2;
        for(j=0;j<2;j++) {
            e5_real wanted=(e5_real)(x[14+j]+x[16+j]);
            bi[j]=(e5_real)x[12+j];sigma[j]=(e5_real)x[10+j];
            rpm[j]=(int16_t)x[2+j];previous[j]=(int16_t)x[20+j];
            target[j]=(int32_t)x[16+j];
            correction[j]=wanted+(wanted>=0?(e5_real).25:(e5_real)-.25)-bi[j];
        }
        memset(&a,0,sizeof(a));
        if(!e5_ca_allocate(bi,correction,sigma,limits,rpm,previous,&a))return 3;
        count=0;
        for(dl=previous[0]-2;dl<=previous[0]+2;dl++)
        for(dr=previous[1]-2;dr<=previous[1]+2;dr++) {
            if(e5_ca_abs(dl)>300||e5_ca_abs(dr)>300)continue;
            if(e5_ca_envelope_ok(rpm[0],(int32_t)x[14]+dl,lim[0])&&
               e5_ca_envelope_ok(rpm[1],(int32_t)x[15]+dr,lim[1])&&
               e5_ca_sector_ok(sigma,dl,dr))count++;
        }
        /* Concrete safety witness under existing exceptional-contraction
         * component/sign/envelope/sector bounds, but NOT target-ray restriction. */
        if(target[0]*target[1]<0&&previous[0]*target[0]>=0&&previous[1]*target[1]>=0) {
            sign=target[0]>0?1:-1;
            bound=e5_ca_abs(previous[0]);
            if(e5_ca_abs(previous[1])<bound)bound=e5_ca_abs(previous[1]);
            if(bound>300)bound=300;
            center=sign*(target[0]-target[1])/2;
            if(center<0)center=0;
            if(center>bound)center=bound;
            wl=sign*center;wr=-wl;
            witness=e5_ca_envelope_ok(rpm[0],(int32_t)x[14]+wl,lim[0])&&
                    e5_ca_envelope_ok(rpm[1],(int32_t)x[15]+wr,lim[1])&&
                    e5_ca_sector_ok(sigma,wl,wr);
            for(j=0;j<4;j++) {
                e5_real s[2]={(e5_real)(x[10]+((j&1)?.0000005:-.0000005)),
                              (e5_real)(x[11]+((j&2)?.0000005:-.0000005))};
                if(!e5_ca_sector_ok(s,wl,wr))robust=0;
            }
        } else robust=0;
        old_distance=((double)a.delta[0]-target[0])*((double)a.delta[0]-target[0])+
                     ((double)a.delta[1]-target[1])*((double)a.delta[1]-target[1]);
        witness_distance=((double)wl-target[0])*((double)wl-target[0])+
                         ((double)wr-target[1])*((double)wr-target[1]);
        printf("{\"index\":%u,\"mask\":%u,\"delta\":[%d,%d],\"base\":[%d,%d],\"normalFeasibleCount\":%u,\"witness\":[%d,%d],\"witnessFeasible\":%d,\"witnessSectorEndpointChecks\":%d,\"distanceSquared\":%.0f,\"witnessDistanceSquared\":%.0f}\n",
               index,a.mask,(int)a.delta[0],(int)a.delta[1],(int)a.base[0],(int)a.base[1],
               count,wl,wr,witness,robust,old_distance,witness_distance);
    }
    return 0;
}
