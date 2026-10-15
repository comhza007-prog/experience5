#include <assert.h>
#include <stdio.h>
#include <math.h>
#include "blnn_core.c"
#include "experiment5_formal_actuator.h"
volatile float g_e5_online_nn_scale=1,g_e5_online_learning_scale=1;
int e5_r2_step(e5_state *,const e5_input *,e5_output *);
static e5_state s,prior;
static unsigned seed=423689;
static unsigned rnd(void){seed=1664525U*seed+1013904223U;return seed;}
static e5_real u(double lo,double hi){return (e5_real)(lo+(hi-lo)*(rnd()&65535U)/65535.0);}
int main(void){
 e5_input in;e5_output out,old;unsigned i,ch,n,j,changed=0;
 for(i=0;i<60000;i++){
  assert(e5_reset(&s,i%5?12:11,i%3==0?4:(i%3==1?59:60)));
  memset(&in,0,sizeof(in));in.limit[0]=1200;in.limit[1]=i%4?1200:800;
  in.reference[1]=i%2?R(.0005):0;
  for(ch=0;ch<2;ch++){
   in.q[ch]=u(-.0003,.0003);in.velocity[ch]=u(-.0003,.0003);in.acceleration[ch]=u(-.1,.1);
   in.raw_rpm[ch]=i%7?0:(int16_t)(rnd()%81-40);s.ca_delta[ch]=(int16_t)(rnd()%101-50);
   for(n=0;n<s.net[ch].count;n++)for(j=0;j<3;j++)s.net[ch].weight[n][j]=u(-.01,.01);
  }
  s.step=19;prior=s;assert(e5_step(&s,&in,&out)&&e5_r2_step(&prior,&in,&old));
#if !E5_MODAL_LEARNING
  assert(!memcmp(&s,&prior,sizeof(s))&&!memcmp(&out,&old,sizeof(out)));
#else
  if(s.method==E5_BLNN||old.diagnostic_reason!=DIAG_REASON_RATE_ONLY)
   assert(!memcmp(&s,&prior,sizeof(s))&&!memcmp(&out,&old,sizeof(out)));
  for(ch=0;ch<2;ch++){
   assert(out.current[ch]==old.current[ch]&&out.requested[ch]==old.requested[ch]);
   assert(out.ca_delta[ch]==old.ca_delta[ch]&&out.dhat[ch]==old.dhat[ch]);
   assert(out.sigma[ch]==old.sigma[ch]&&out.sector[ch]==old.sector[ch]);
   assert(out.repair_mode[ch]==old.repair_mode[ch]);
   assert(out.learning_axis[ch]>=0&&out.learning_axis[ch]<=old.learning_axis[ch]);
   if(out.repair_mode[ch]||(E5_MODAL_LEARNING_SCOPE==1&&ch==0))
    assert(!memcmp(&s.net[ch],&prior.net[ch],sizeof(e5_network)));
   changed+=out.learning_axis[ch]!=old.learning_axis[ch];
   assert(finite_value(out.norm[ch]));
  }
  assert(out.ca_mask==old.ca_mask&&out.diagnostic_reason==old.diagnostic_reason);
  assert(s.gate==prior.gate&&!memcmp(s.aw,prior.aw,sizeof(s.aw))&&!memcmp(s.k2,prior.k2,sizeof(s.k2)));
  if(s.method==E5_CA_BLNN)assert(e5_ca_sector_ok(out.sigma,(int)out.ca_delta[0],(int)out.ca_delta[1]));
  {int16_t command[2],pre_guard[2];uint32_t mask;
   assert(e5_formal_finalize(s.method,&in,&out,command,pre_guard,&mask));
   for(ch=0;ch<2;ch++)assert(e5_ca_envelope_ok(in.raw_rpm[ch],command[ch],(int)in.limit[ch]));}
#endif
 }
#if E5_MODAL_LEARNING
 for(i=0;i<100000;i++){
  e5_real pre=u(0,1),nominal=pre*u(0,1),d=u(1.01,500),a=u(-500,500),result;
  ch=i%2;memset(&out,0,sizeof(out));out.diagnostic_reason=1;out.ca_mask=E5_CA_PROJECTED;
  out.gate=out.sector[ch]=out.sigma[ch]=1;out.dhat[ch]=d*(ch?R(.6):2)*R(.006197916666666667);
  if(ch){out.ca_delta[0]=out.ca_delta[1]=a;}else{out.ca_delta[0]=a;out.ca_delta[1]=-a;}
  result=modal_learning_cap(ch,&out,out.dhat[ch],pre,nominal);
  assert(finite_value(result)&&result>=0&&result<=nominal);
  if(E5_MODAL_LEARNING_SCOPE==1&&ch==0)assert(result==nominal);
  assert(modal_learning_cap(ch,&out,-out.dhat[ch],pre,nominal)==nominal);
  out.diagnostic_reason=4;assert(modal_learning_cap(ch,&out,out.dhat[ch],pre,nominal)==nominal);
  out.diagnostic_reason=1;out.ca_mask=E5_CA_SPEED;assert(modal_learning_cap(ch,&out,out.dhat[ch],pre,nominal)==nominal);
  out.ca_mask=2;out.dhat[ch]=0;assert(modal_learning_cap(ch,&out,0,pre,nominal)==nominal);
 }
#endif
 printf("PASS60000 same-state output/guards, disabled exactR2, ordinary/repair unchanged;100000 bounded/eligibility helper tests when enabled. changed gradients=%u\n",changed);
 return 0;
}
