#include <assert.h>
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "identification_excitation.h"
#include "identification_trace.h"
#include "online_protocol.h"
volatile float g_e5_online_nn_scale=1,g_e5_online_learning_scale=1;
int e5_original_reset(e5_state*,uint32_t,uint32_t);
int e5_original_step(e5_state*,const e5_input*,e5_output*);
static e5_state a,b;
static id_trace trace;
static int reference_symbol(unsigned seed,unsigned index){
 unsigned state=seed&31U,j;if(!state)state=1;
 if(index%32==31)return -1;
 for(j=0;j<index%32;j++)state=(state>>1)|((((state>>0)^(state>>2))&1U)<<4);
 return state&1?1:-1;
}
int main(int argc,char **argv){
 unsigned profile,ms,ch,trial,checks=0,fixtures=0;id_excitation_table table;
 for(profile=1;profile<=2;profile++){
  unsigned seed=profile==1?39:73;int sums[2]={0,0};double aa=0,bb=0,ab=0;
  id_excitation_init(&table,seed);
  for(ch=0;ch<2;ch++)for(ms=0;ms<32;ms++)assert(table.symbol[ch][ms]==reference_symbol(ch?3*seed+1:seed,ms));
  for(ms=0;ms<20000;ms++){
   float ref[3];unsigned phase=e5_motion_reference(ms,ref);int16_t rpm[2]={0,0},modal[2],axis[2];
   id_excitation_get(&table,ms,phase,profile,1,rpm,modal,axis);
   for(ch=0;ch<2;ch++)sums[ch]+=modal[ch];
   assert(abs(modal[0])<=20&&abs(modal[1])<=10&&abs(axis[0])<=30&&abs(axis[1])<=30);
   if(phase!=2&&phase!=4)assert(!axis[0]&&!axis[1]);
   else {unsigned local=ms-(phase==2?4000:10000),sign=phase==2?1:0;int d=sign?1:-1;
    assert(modal[0]==d*20*reference_symbol(seed,local/(profile==1?32:48)));
    assert(modal[1]==d*10*reference_symbol(3*seed+1,local/(profile==1?16:24)));
   }
   aa+=(double)modal[0]*modal[0];bb+=(double)modal[1]*modal[1];ab+=(double)modal[0]*modal[1];
   id_excitation_get(&table,ms,phase,profile,0,rpm,modal,axis);assert(!axis[0]&&!axis[1]);
   rpm[0]=11;id_excitation_get(&table,ms,phase,profile,1,rpm,modal,axis);assert(!axis[0]&&!axis[1]);
   rpm[0]=0;rpm[1]=-11;id_excitation_get(&table,ms,phase,profile,1,rpm,modal,axis);assert(!axis[0]&&!axis[1]);
  }
  assert(!sums[0]&&!sums[1]&&aa*bb-ab*ab>0);
 }
 /* Disabled/gated chain: same state, core outputs, final commands andAW. */
 for(trial=0;trial<5;trial++){
  e5_input in;e5_output oa,ob;float ref[3];memset(&in,0,sizeof(in));in.limit[0]=in.limit[1]=1200;
  assert(e5_reset(&a,11,4)&&e5_original_reset(&b,11,4));
  for(ms=0;ms<20000;ms++){
   int16_t ca[2],cb[2],prea[2],preb[2],shadow[2],zero[2]={0,0};uint32_t ma,mb;
   e5_motion_reference(ms,ref);for(ch=0;ch<3;ch++)in.reference[ch]=ref[ch];
   in.q[0]=(e5_real)ref[0]+(e5_real)(.00002*sin((ms+trial*3)*.003));in.q[1]=(e5_real)(.00005*sin(ms*.007));
   in.velocity[0]=ref[1];in.velocity[1]=(e5_real)(.00001*cos(ms*.007));in.acceleration[0]=ref[2];in.acceleration[1]=0;
   in.raw_rpm[0]=(int16_t)((int)(ms%241)-120);in.raw_rpm[1]=(int16_t)-in.raw_rpm[0];
   assert(e5_step(&a,&in,&oa)&&e5_original_step(&b,&in,&ob));
   assert(id_excitation_finalize(&in,&oa,zero,ca,prea,&ma,shadow)&&e5_formal_finalize(11,&in,&ob,cb,preb,&mb));
   for(ch=0;ch<2;ch++){
    a.aw[ch]+=id_excitation_aw_delta(ca[ch],oa.current[ch],0);
    b.aw[ch]+=.001f*16.0f*((float)cb[ch]-ob.current[ch]);
   }
   assert(!memcmp(&a,&b,sizeof(a))&&!memcmp(&oa,&ob,sizeof(oa))&&!memcmp(ca,cb,sizeof(ca))&&!memcmp(shadow,cb,sizeof(cb))&&!memcmp(prea,preb,sizeof(prea))&&ma==mb);checks++;
  }
 }
 /* Active same-state guard/admission/AW fixtures, not a plant simulation. */
 id_excitation_init(&table,39);
 for(ms=4000;ms<8000;ms+=23)for(int rpm=-120;rpm<=120;rpm++)for(int base=-1200;base<=1200;base+=61){
  e5_input in;e5_output out,expected;int16_t modal[2],axis[2],cmd[2],before[2],shadow[2],want[2],wantBefore[2];uint32_t mask,wantMask;
  memset(&in,0,sizeof(in));memset(&out,0,sizeof(out));in.limit[0]=in.limit[1]=1200;in.raw_rpm[0]=(int16_t)rpm;in.raw_rpm[1]=(int16_t)-rpm;
  out.current[0]=(e5_real)base;out.current[1]=(e5_real)-base;
  id_excitation_get(&table,ms,2,1,1,in.raw_rpm,modal,axis);
  expected=out;for(ch=0;ch<2;ch++){float f=(float)out.current[ch]+axis[ch];if(f>1200)f=1200;if(f<-1200)f=-1200;expected.current[ch]=f;}
  assert(e5_formal_finalize(11,&in,&expected,want,wantBefore,&wantMask));
  assert(id_excitation_finalize(&in,&out,axis,cmd,before,&mask,shadow));
  assert(!memcmp(cmd,want,sizeof(cmd))&&!memcmp(before,wantBefore,sizeof(before))&&mask==wantMask);
  for(ch=0;ch<2;ch++){
   assert(abs(cmd[ch])<=1200&&abs(cmd[ch]-shadow[ch])<=30);
   assert(id_excitation_aw_delta(cmd[ch],out.current[ch],axis[ch])==.001f*16.0f*((float)cmd[ch]-out.current[ch]-(float)axis[ch]));
  }
  fixtures++;
 }
 /* Full-motion symbol provenance plus collector; no hardware. */
 id_reset(&trace);trace.blob.header.build=E5_SELECTED_BUILD;trace.blob.header.method=11;trace.blob.symbols.seed=E5_ID_SEED;trace.blob.symbols.profile=E5_ID_PROFILE;
 trace.blob.header.reserved[1]=1;trace.blob.header.reserved[2]=2;trace.blob.header.reserved[3]=1;
 for(ms=0;ms<20000;ms++){
  float ref[3];unsigned phase=e5_motion_reference(ms,ref);int32_t enc[2]={(int32_t)ms,-(int32_t)ms};int16_t rpm[2]={0,0},modal[2],axis[2],shadow[2]={20,-20},cmd[2],esc[2]={5,-5};uint32_t age[2]={1,1};
  id_excitation_get(&table,ms,phase,1,1,rpm,modal,axis);for(ch=0;ch<2;ch++)cmd[ch]=(int16_t)(shadow[ch]+axis[ch]);
  {uint8_t code=modal[0]?(uint8_t)(1U|(modal[0]>0?2U:0U)|(modal[1]>0?4U:0U)|8U):0U;
   assert(id_collect_symbols(&trace,ms,ms+1,(ms+1)*1000,1000,enc,cmd,rpm,esc,shadow,age,3,(uint8_t)phase,1,code));
   if(phase==2||phase==4){unsigned index=trace.blob.header.fast_count-1;assert(((trace.blob.symbol[index/2]>>((index&1)*4))&15)==code);}
  }
 }
 id_seal(&trace,1,20000,0,0);assert(!trace.invalid&&trace.blob.header.quality_flags==0&&trace.blob.header.slow_count==300&&trace.blob.header.fast_count==8000&&trace.blob.symbols.row_count==8000&&trace.blob.symbols.requested_steps==8000&&trace.blob.symbols.ungated_steps==8000);
 if(argc==2){FILE *f=fopen(argv[1],"wb");assert(f&&fwrite(&trace.blob,1,sizeof(trace.blob),f)==sizeof(trace.blob)&&fclose(f)==0);}
 printf("PASS exactDisabledCoreOutputAW%u guardFixtures%u seedPhaseRPMbalanceAndNominalRank symbolIntervals8000 traceABI%u offlineOnlyNoHardware\n",checks,fixtures,(unsigned)sizeof(trace));return 0;
}
