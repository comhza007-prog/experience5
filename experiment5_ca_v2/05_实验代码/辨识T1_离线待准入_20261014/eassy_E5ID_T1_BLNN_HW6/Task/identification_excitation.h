#ifndef E5_IDENTIFICATION_EXCITATION_H
#define E5_IDENTIFICATION_EXCITATION_H
#include "experiment5_formal_actuator.h"
/* Fixed minimum-identification protocol. No gains/limits/fault writes.
 * Symbol tables are initialized ONCE, never iterated in the1ms task.
 * Counts are NOT calibrated amperes/torque. Gating destroys nominal
 * independence/balance: actual attempted inputs must be recorded. */
typedef struct {int8_t symbol[2][32];} id_excitation_table;
static void id_excitation_init(id_excitation_table *t,uint32_t seed){
 uint32_t axis,n,state;
 for(axis=0;axis<2;axis++){
  state=(axis?3U*seed+1U:seed)&31U;if(!state)state=1U;
  for(n=0;n<31;n++){t->symbol[axis][n]=(int8_t)(state&1U?1:-1);state=(state>>1)|((((state>>0)^(state>>2))&1U)<<4);}
  t->symbol[axis][31]=-1;
 }
}
static void id_excitation_get(const id_excitation_table *t,uint32_t ms,uint32_t phase,uint32_t profile,uint32_t allowed,const int16_t rpm[2],int16_t modal[2],int16_t axis[2]){
 uint32_t local,period0,period1;int direction;
 modal[0]=modal[1]=axis[0]=axis[1]=0;
 if(!allowed||!profile||profile>2U||(phase!=2U&&phase!=4U))return;
 if(rpm[0]<-10||rpm[0]>10||rpm[1]<-10||rpm[1]>10)return;
 if(phase==2U){if(ms<4000U||ms>=8000U)return;local=ms-4000U;direction=1;}
 else{if(ms<10000U||ms>=14000U)return;local=ms-10000U;direction=-1;}
 period0=profile==1U?32U:48U;period1=profile==1U?16U:24U;
 modal[0]=(int16_t)(direction*20*t->symbol[0][(local/period0)&31U]);
 modal[1]=(int16_t)(direction*10*t->symbol[1][(local/period1)&31U]);
 axis[0]=(int16_t)(modal[0]+modal[1]);axis[1]=(int16_t)(-modal[0]+modal[1]);
}
static int id_excitation_finalize(const e5_input *in,e5_output *out,const int16_t requested[2],int16_t command[2],int16_t before[2],uint32_t *mask,int16_t shadow[2]){
 e5_output injected;int16_t shadow_before[2];uint32_t shadow_mask,ch;
 if(!e5_formal_finalize(E5_BLNN,in,out,shadow,shadow_before,&shadow_mask))return 0;
 /* Exact original arithmetic/state/diagnostics when disabled or gated off. */
 if(!requested[0]&&!requested[1]){command[0]=shadow[0];command[1]=shadow[1];before[0]=shadow_before[0];before[1]=shadow_before[1];*mask=shadow_mask;return 1;}
 injected=*out;
 for(ch=0;ch<2;ch++){
  float current=(float)out->current[ch]+(float)requested[ch];
  if(current>(float)in->limit[ch])current=(float)in->limit[ch];
  if(current<-(float)in->limit[ch])current=-(float)in->limit[ch];
  injected.current[ch]=(e5_real)current;
 }
 /* ONE original speed guard on actual command. Shadow is diagnostic only. */
 return e5_formal_finalize(E5_BLNN,in,&injected,command,before,mask);
}
static e5_real id_excitation_aw_delta(int16_t command,e5_real core_current,int16_t requested){
 if(!requested)return .001f*16.0f*((float)command-core_current);
 return .001f*16.0f*((float)command-core_current-(float)requested);
}
#endif
