#include <assert.h>
#include <math.h>
#include <stdio.h>
#include <string.h>
#include "blnn_core.c"
int r2_reset(e5_state*,uint32_t,uint32_t);
int r2_step(e5_state*,const e5_input*,e5_output*);
int r2_allocate(const e5_real*,const e5_real*,const e5_real*,const e5_real*,const int16_t*,const int16_t*,e5_ca_actuation*);
static unsigned seed=12941,changed,checks;
static unsigned rnd(void){seed=1664525U*seed+1013904223U;return seed;}
static e5_real uniform(double lo,double hi){return (e5_real)(lo+(hi-lo)*(rnd()&65535U)/65535.0);}
static e5_state astate,bstate;
int main(void){
 e5_real base[2],corr[2],sigma[2],limit[2];int16_t rpm[2],previous[2],wanted;unsigned n,ch;
 e5_ca_actuation a,b;int target[2],ea,eb,dl,dr,best;
 for(n=0;n<100000;n++){
  memset(&a,0,sizeof(a));memset(&b,0,sizeof(b));
  for(ch=0;ch<2;ch++) {limit[ch]=ch&&n%2?800:1200;base[ch]=uniform(-1500,1500);corr[ch]=uniform(-500,500);sigma[ch]=uniform(-.02,.02);rpm[ch]=(int16_t)uniform(-110,110);previous[ch]=(int16_t)uniform(-300,300);}
  assert(r2_allocate(base,corr,sigma,limit,rpm,previous,&a));assert(e5_ca_allocate(base,corr,sigma,limit,rpm,previous,&b));
  assert(memcmp(a.base,b.base,sizeof(a.base))==0);assert(a.speed_mask==b.speed_mask);
  for(ch=0;ch<2;ch++) {assert(e5_ca_envelope_ok(rpm[ch],b.command[ch],(int)limit[ch]));assert(abs(b.delta[ch])<=300);wanted=b.before_guard[ch];(void)e5_motion_speed_guard(rpm[ch],&wanted);target[ch]=(int)wanted-b.base[ch];}
  assert(e5_ca_sector_ok(sigma,b.delta[0],b.delta[1]));
  if(a.mask&(E5_CA_CONTRACTED|E5_CA_WITHDRAWN))assert(memcmp(&a,&b,sizeof(a))==0);
  else {
   for(ch=0;ch<2;ch++)assert(abs(b.delta[ch]-previous[ch])<=2);
   if(sigma[1]*(e5_real)(target[0]+target[1])>0) {
    ea=a.delta[0]+a.delta[1]-target[0]-target[1];eb=b.delta[0]+b.delta[1]-target[0]-target[1];
    assert(eb*eb<=ea*ea);best=eb*eb;
    for(dl=previous[0]-2;dl<=previous[0]+2;dl++)for(dr=previous[1]-2;dr<=previous[1]+2;dr++) {
     if(abs(dl)>300||abs(dr)>300||!e5_ca_envelope_ok(rpm[0],b.base[0]+dl,(int)limit[0])||!e5_ca_envelope_ok(rpm[1],b.base[1]+dr,(int)limit[1])||!e5_ca_sector_ok(sigma,dl,dr))continue;
     eb=dl+dr-target[0]-target[1];
#if DIAG_SYNC_ALLOCATION
     assert(best<=eb*eb);
#else
     (void)best;
#endif
    }
   } else assert(memcmp(&a,&b,sizeof(a))==0);
  }
  if(memcmp(a.delta,b.delta,sizeof(a.delta)))changed++;
#if !DIAG_SYNC_ALLOCATION
  assert(memcmp(&a,&b,sizeof(a))==0);
#endif
  checks++;
 }
 for(ch=E5_BASE;ch<=E5_CA_BLNN;ch++){
  e5_input in;e5_output aout,bout;memset(&in,0,sizeof(in));in.limit[0]=in.limit[1]=1200;
  assert(r2_reset(&astate,ch,4));assert(e5_reset(&bstate,ch,4));
  for(n=0;n<3000;n++) {
   in.reference[0]=(e5_real)(.001+.0007*sin(n*.013));in.reference[1]=(e5_real)(.001*cos(n*.013));
   in.q[0]=in.reference[0]+uniform(-.0002,.0002);in.q[1]=uniform(-.0002,.0002);
   in.velocity[0]=uniform(-.001,.001);in.velocity[1]=uniform(-.001,.001);
   assert(r2_step(&astate,&in,&aout));assert(e5_step(&bstate,&in,&bout));
   if(ch!=E5_CA_BLNN || !DIAG_SYNC_ALLOCATION){assert(memcmp(&aout,&bout,sizeof(aout))==0);assert(memcmp(&astate,&bstate,sizeof(astate))==0);}
  }
 }
#if DIAG_SYNC_ALLOCATION
 assert(changed>0);
#else
 assert(changed==0);
#endif
 printf("allocator_checks=%u changed=%u; same-set alpha discrepancy property and disabled/ordinary equivalence passed\n",checks,changed);
 return 0;
}
