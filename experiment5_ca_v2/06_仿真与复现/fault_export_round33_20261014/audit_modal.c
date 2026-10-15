#include <assert.h>
#include <stdio.h>
#include <math.h>
#include "blnn_core.c"
#include "experiment5_formal_actuator.h"
#include "network_trace.h"
volatile float g_e5_online_nn_scale=1,g_e5_online_learning_scale=1;
static e5_replay_blob blob;
static e5_state state;
int main(int argc,char **argv){
 FILE *source;unsigned i,ch;int16_t command[2],before[2];uint32_t speed;e5_output out;
 assert(argc==2);source=fopen(argv[1],"rb");assert(source);
 assert(fread(&blob,1,sizeof(blob),source)==sizeof(blob));assert(fgetc(source)==EOF);assert(!fclose(source));
 assert(blob.version==1&&blob.build==67712&&blob.method==12&&blob.count==360);
 state=blob.initial;
 puts("ms,cause,mask,rho,preLearning,learningY,learningAlpha,requestY,requestAlpha,admittedY,admittedAlpha,sigmaY,sigmaAlpha,repairY,repairAlpha");
 for(i=0;i<360;i++){
  const e5_input *in=&blob.rows[i].input;float k=.006197916666666667f;
  assert(e5_step(&state,in,&out));assert(e5_formal_finalize(12,in,&out,command,before,&speed));
  assert(command[0]==blob.rows[i].command[0]&&command[1]==blob.rows[i].command[1]);
  for(ch=0;ch<2;ch++)state.aw[ch]+=.001f*16.0f*((float)command[ch]-out.current[ch]);
  printf("%u,%u,%u,%.9g,%.9g,%.9g,%.9g,%.9g,%.9g,%.9g,%.9g,%.9g,%.9g,%u,%u\n",
   blob.rows[i].ms,out.diagnostic_reason,out.ca_mask,(double)out.admitted_fraction,(double)out.learning_before_reason,
   (double)out.learning_axis[0],(double)out.learning_axis[1],(double)(-out.gate*out.sector[0]*out.dhat[0]),
   (double)(-out.gate*out.sector[1]*out.dhat[1]),(double)(k*(out.ca_delta[0]-out.ca_delta[1])),
   (double)(-.3f*k*(out.ca_delta[0]+out.ca_delta[1])),(double)out.sigma[0],(double)out.sigma[1],out.repair_mode[0],out.repair_mode[1]);
 }
 return 0;
}
