#include <assert.h>
#include <stdio.h>
#include <string.h>
#include "experiment5_ca_actuator.h"
int r2_allocate(const e5_real[2],const e5_real[2],const e5_real[2],const e5_real[2],const int16_t[2],const int16_t[2],e5_ca_actuation*);
static uint32_t seed=1939U;
static uint32_t random_u(void){seed=1664525U*seed+1013904223U;return seed;}
static int rnd(int n){return (int)(random_u()%(uint32_t)(2*n+1))-n;}
int main(void){unsigned n,ch,changed=0,normal=0;for(n=0;n<100000;n++){
 e5_real bi[2],corr[2],sigma[2],limits[2],peak=0,scale=1;e5_ca_actuation a,b;
 int16_t rpm[2],previous[2],wanted;int32_t target[2],dl,dr,best_sync=0x7fffffff,best_dist=0x7fffffff,best_tie=0x7fffffff;
 int valid_a,valid_b,found=0;
 for(ch=0;ch<2;ch++){bi[ch]=(e5_real)rnd(1500);corr[ch]=(e5_real)rnd(1200);sigma[ch]=(e5_real)rnd(1000)/(e5_real)100000;limits[ch]=n%3==0?800:n%3==1?1000:1200;rpm[ch]=(int16_t)rnd(40);previous[ch]=(int16_t)rnd(300);if(corr[ch]>peak)peak=corr[ch];if(-corr[ch]>peak)peak=-corr[ch];}
 memset(&a,0,sizeof(a));memset(&b,0,sizeof(b));valid_a=e5_ca_allocate(bi,corr,sigma,limits,rpm,previous,&a);valid_b=r2_allocate(bi,corr,sigma,limits,rpm,previous,&b);assert(valid_a==valid_b);
 if(!valid_a)continue;
 if(!E5_SYNC_PRIORITY_PROJECTION)assert(memcmp(&a,&b,sizeof(a))==0);
 if(memcmp(a.delta,b.delta,sizeof(a.delta)))changed++;
 for(ch=0;ch<2;ch++){assert(e5_ca_envelope_ok(rpm[ch],a.command[ch],(int32_t)limits[ch]));assert(e5_ca_abs(a.delta[ch])<=E5_CA_MAX_DELTA);assert(a.command[ch]==a.base[ch]+a.delta[ch]);}
 assert(e5_ca_sector_ok(sigma,a.delta[0],a.delta[1]));assert(a.admitted_fraction>=0&&a.admitted_fraction<=1);assert(memcmp(a.base,b.base,sizeof(a.base))==0);assert(a.speed_mask==b.speed_mask);
 if(peak>E5_CA_MAX_DELTA)scale=(e5_real)E5_CA_MAX_DELTA/peak;
 for(ch=0;ch<2;ch++){assert(e5_motion_quantize((float)e5_ca_clip(bi[ch]+scale*corr[ch],limits[ch]),&wanted));e5_motion_speed_guard(rpm[ch],&wanted);target[ch]=wanted-a.base[ch];}
 for(dl=previous[0]-E5_CA_DELTA_STEP;dl<=previous[0]+E5_CA_DELTA_STEP;dl++)for(dr=previous[1]-E5_CA_DELTA_STEP;dr<=previous[1]+E5_CA_DELTA_STEP;dr++){
  int32_t sd,dist,tie;
  if(e5_ca_abs(dl)>E5_CA_MAX_DELTA||e5_ca_abs(dr)>E5_CA_MAX_DELTA||!e5_ca_envelope_ok(rpm[0],a.base[0]+dl,(int32_t)limits[0])||!e5_ca_envelope_ok(rpm[1],a.base[1]+dr,(int32_t)limits[1])||!e5_ca_sector_ok(sigma,dl,dr))continue;
  sd=e5_ca_abs(dl+dr-target[0]-target[1]);dist=(dl-target[0])*(dl-target[0])+(dr-target[1])*(dr-target[1]);tie=e5_ca_abs(dl)+e5_ca_abs(dr);
  if(!found||sd<best_sync||(sd==best_sync&&(dist<best_dist||(dist==best_dist&&tie<best_tie)))){found=1;best_sync=sd;best_dist=dist;best_tie=tie;}
 }
 if(found){normal++;assert(!(a.mask&(E5_CA_WITHDRAWN|E5_CA_CONTRACTED)));for(ch=0;ch<2;ch++)assert(e5_ca_abs((int)a.delta[ch]-previous[ch])<=E5_CA_DELTA_STEP);
  if(E5_SYNC_PRIORITY_PROJECTION){int32_t sd=e5_ca_abs(a.delta[0]+a.delta[1]-target[0]-target[1]),dist=(a.delta[0]-target[0])*(a.delta[0]-target[0])+(a.delta[1]-target[1])*(a.delta[1]-target[1]);assert(sd==best_sync&&dist==best_dist&&e5_ca_abs(a.delta[0])+e5_ca_abs(a.delta[1])==best_tie);assert(sd<=e5_ca_abs(b.delta[0]+b.delta[1]-target[0]-target[1]));}
 }else assert(memcmp(&a,&b,sizeof(a))==0);
 }printf("fixtures100000 changed%u normal%u exactDisabledAndFinalGuardsPassed\n",changed,normal);return 0;}
