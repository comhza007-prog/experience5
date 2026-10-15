#include <assert.h>
#include <stdio.h>
#include "blnn_core.c"
#include "experiment5_formal_actuator.h"
volatile float g_e5_online_nn_scale=1,g_e5_online_learning_scale=1;
int e5_r2_step(e5_state *,const e5_input *,e5_output *);
static e5_state state,prior;
static unsigned seed=423689;
static unsigned rnd(void){seed=1664525U*seed+1013904223U;return seed;}
static e5_real u(double lo,double hi){return (e5_real)(lo+(hi-lo)*(rnd()&65535U)/65535.0);}
int main(void){
 unsigned i,ch,n,j; e5_input in; e5_output out,reference;
 for(i=0;i<60000;i++){
  assert(e5_reset(&state,i%5?12:11,i%3==0?4:(i%3==1?59:60)));memset(&in,0,sizeof(in));
  in.limit[0]=1200;in.limit[1]=i%4?1200:800;in.reference[1]=i%2?R(.0005):0;
  for(ch=0;ch<2;ch++){
   in.q[ch]=u(-.0003,.0003);in.velocity[ch]=u(-.0003,.0003);in.acceleration[ch]=u(-.1,.1);
   in.raw_rpm[ch]=i%7?0:(int16_t)(rnd()%81-40);state.ca_delta[ch]=(int16_t)(rnd()%101-50);
   for(n=0;n<state.net[ch].count;n++)for(j=0;j<3;j++)state.net[ch].weight[n][j]=u(-.01,.01);
  }
  state.step=19;prior=state;assert(e5_step(&state,&in,&out)&&e5_r2_step(&prior,&in,&reference));
#if !E5_DIAG_PLAIN_LEARNING
  assert(!memcmp(&state,&prior,sizeof(state))&&!memcmp(&out,&reference,sizeof(out)));
#else
  if(state.method==11)assert(!memcmp(&state,&prior,sizeof(state))&&!memcmp(&out,&reference,sizeof(out)));
  for(ch=0;ch<2;ch++){
   assert(out.current[ch]==reference.current[ch]&&out.requested[ch]==reference.requested[ch]);
   assert(out.dhat[ch]==reference.dhat[ch]&&out.ca_delta[ch]==reference.ca_delta[ch]);
   assert(out.sector[ch]==reference.sector[ch]&&out.sigma[ch]==reference.sigma[ch]);
   assert(out.learning_axis[ch]==1&&out.repair_mode[ch]==0);
   assert(finite_value(out.norm[ch]));
  }
  assert(out.ca_mask==reference.ca_mask&&out.ca_speed_mask==reference.ca_speed_mask);
  assert(!memcmp(state.aw,prior.aw,sizeof(state.aw))&&!memcmp(state.k2,prior.k2,sizeof(state.k2)));
#endif
  {int16_t cmd[2],before[2];uint32_t mask;assert(e5_formal_finalize(state.method,&in,&out,cmd,before,&mask));
   for(ch=0;ch<2;ch++)assert(e5_ca_envelope_ok(in.raw_rpm[ch],cmd[ch],(int)in.limit[ch]));}
  if(state.method==12)assert(e5_ca_sector_ok(out.sigma,(int)out.ca_delta[0],(int)out.ca_delta[1]));
 }
 puts("PASS60000 same-state commands/guards;disabled exact source;plain learning1,ordinary unchanged. HOST DIAGNOSTIC ONLY");return 0;
}
