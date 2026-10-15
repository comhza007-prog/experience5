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
 unsigned i,ch,n,j,blocked=0;e5_input in;e5_output out,reference;
 for(i=0;i<100000;i++){
  assert(e5_reset(&state,i%5?12:11,i%3==0?4:(i%3==1?59:60)));memset(&in,0,sizeof(in));
  in.limit[0]=1200;in.limit[1]=i%4?1200:800;in.reference[1]=i%2?R(.0005):0;
  for(ch=0;ch<2;ch++){
   in.q[ch]=u(-.0003,.0003);in.velocity[ch]=u(-.0003,.0003);in.acceleration[ch]=u(-.1,.1);
   in.raw_rpm[ch]=i%7?0:(int16_t)(rnd()%81-40);state.ca_delta[ch]=(int16_t)(rnd()%101-50);
   for(n=0;n<state.net[ch].count;n++)for(j=0;j<3;j++)state.net[ch].weight[n][j]=u(-.01,.01);
  }
  state.step=19;prior=state;assert(e5_step(&state,&in,&out)&&e5_r2_step(&prior,&in,&reference));
#if !E5_SYNC_RETENTION
  assert(!memcmp(&state,&prior,sizeof(state))&&!memcmp(&out,&reference,sizeof(out)));
#else
  if(reference.repair_mode[0]!=3U||sync_retention_ok(&in,&reference))
   assert(!memcmp(&state,&prior,sizeof(state))&&!memcmp(&out,&reference,sizeof(out)));
  else{
   blocked++;assert(out.repair_mode[0]==4&&out.learning_axis[0]==reference.learning_axis[0]);
   assert(state.net[0].count==prior.net[0].count&&state.growth==prior.growth);
   assert(!memcmp(&state.net[1],&prior.net[1],sizeof(e5_network)));
   assert(!memcmp(state.aw,prior.aw,sizeof(state.aw))&&!memcmp(state.k2,prior.k2,sizeof(state.k2)));
  }
  for(ch=0;ch<2;ch++){
   assert(out.current[ch]==reference.current[ch]&&out.requested[ch]==reference.requested[ch]);
   assert(out.dhat[ch]==reference.dhat[ch]&&out.ca_delta[ch]==reference.ca_delta[ch]);
   assert(out.learning_axis[ch]==reference.learning_axis[ch]&&finite_value(out.norm[ch]));
  }
  assert(out.ca_mask==reference.ca_mask&&out.diagnostic_reason==reference.diagnostic_reason);
#endif
  {int16_t cmd[2],before[2];uint32_t mask;assert(e5_formal_finalize(state.method,&in,&out,cmd,before,&mask));
   for(ch=0;ch<2;ch++)assert(e5_ca_envelope_ok(in.raw_rpm[ch],cmd[ch],(int)in.limit[ch]));}
  if(state.method==12)assert(e5_ca_sector_ok(out.sigma,(int)out.ca_delta[0],(int)out.ca_delta[1]));
 }
#if E5_SYNC_RETENTION
 memset(&in,0,sizeof(in));memset(&out,0,sizeof(out));
 {e5_real resolution=R(EXP3_METERS_PER_MOTOR_COUNT)*R(EXP3_ENCODER_CPR)/R(60)/R(.6);
  in.q[1]=1;in.velocity[1]=resolution;out.sigma[1]=1;out.ca_delta[0]=1;assert(sync_retention_ok(&in,&out));
  in.velocity[1]=resolution*R(1.001);assert(!sync_retention_ok(&in,&out));
  in.velocity[1]=-resolution;assert(sync_retention_ok(&in,&out));
  out.ca_delta[0]=-1;assert(!sync_retention_ok(&in,&out));
  in.q[1]=-1;in.velocity[1]=-resolution;out.sigma[1]=-1;assert(sync_retention_ok(&in,&out));
  in.velocity[1]=-resolution*R(1.001);assert(!sync_retention_ok(&in,&out));}
#endif
 printf("PASS100000 same-state commands/learning/alpha/guards;disabled exactR2;only eligible Y leakage selection changes;predicate boundaries. blocked=%u\n",blocked);return 0;
}
