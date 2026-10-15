#ifndef E5_ID_OFFLINE_DESIGN_H
#define E5_ID_OFFLINE_DESIGN_H
/* HOST DESIGN ONLY. No motor/CAN/UART/DAP interface or runtime integration.
 * Before any future firmware use: exact Q0 regression, linker/time checks,
 * separate excitation admission and fresh onsite confirmation are required. */
#include <stdint.h>
#include <string.h>
#define ID_SLOW_RECORDS 1020U
#define ID_FAST_RECORDS 400U
typedef struct {
 uint32_t end_ms;
 int32_t encoder[2],command_sum[2],feedback_sum[2];
 int16_t command_min[2],command_max[2],rpm[2];
 uint32_t elapsed_us;
 uint8_t steps,quality_flags,max_age[2];
} id_slow_row;
typedef struct {
 uint32_t ms,actual_us;
 int32_t encoder[2];
 int16_t rpm[2],command[2],feedback[2],zero_injection_shadow[2];
 uint8_t age[2],phase,flags;
} id_fast_row;
typedef char id_slow_size[(sizeof(id_slow_row)==48)?1:-1];
typedef char id_fast_size[(sizeof(id_fast_row)==36)?1:-1];
typedef struct {
 uint32_t version,build,method,seed,profile,slow_count,fast_count,first_ms;
 uint32_t last_ms,fault,first_fault_ms,core_dt_us,slow_row_bytes,fast_row_bytes,origin[2];
 uint32_t last_encoder[2],configured_scale_bits,configured_right_sign,period_min_us,period_max_us;
 uint32_t quality_flags,source_config_crc,reserved[8];
} id_header;
typedef char id_header_size[(sizeof(id_header)==128)?1:-1];
typedef struct {id_header header;id_slow_row slow[ID_SLOW_RECORDS];id_fast_row fast[ID_FAST_RECORDS];} id_blob;
typedef struct {id_blob blob;id_slow_row accumulator;uint32_t next_step,crc,crc_offset,cursor,repeat,pending,last_completed,complete,ready,invalid,unused;} id_trace;
typedef char id_trace_budget[(sizeof(id_trace)<=64200)?1:-1];
/* Reference generator for host tests. Firmware MUST precompute lookup
 * tables at reset, not run this loop in the active1ms motor task. */
static int id_symbol(uint32_t seed,uint32_t index){
 uint32_t j,state=seed&31U;
 if(!state)state=1U;
 if(index%32U==31U)return -1; /*31-bit maximal sequence has one extra+1.*/
 for(j=0;j<index%32U;j++){uint32_t bit=((state>>0)^(state>>2))&1U;state=(state>>1)|(bit<<4);}
 return state&1U?1:-1;
}
static void id_excitation(uint32_t ms,uint32_t profile,uint32_t allowed,const int16_t rpm[2],int16_t modal[2]){
 uint32_t local,seed,period_y,period_alpha;int direction;
 modal[0]=modal[1]=0;
 if(!allowed||profile==0U||profile>2U||ms<4000U||ms>=14000U||(ms>=8000U&&ms<10000U))return;
 if(rpm[0]<-10||rpm[0]>10||rpm[1]<-10||rpm[1]>10)return;
 seed=profile==1U?39U:73U;period_y=profile==1U?32U:48U;period_alpha=profile==1U?16U:24U;
 direction=ms<8000U?1:-1;local=ms-(ms<8000U?4000U:10000U);
 modal[0]=(int16_t)(direction*20*id_symbol(seed,local/period_y));
 modal[1]=(int16_t)(direction*10*id_symbol(3U*seed+1U,local/period_alpha));
}
static uint32_t id_fast_index(uint32_t step){
 if(step>=5400U&&step<5600U)return step-5400U;
 if(step>=11400U&&step<11600U)return 200U+step-11400U;
 return 0xffffffffU;
}
static uint32_t id_crc(uint32_t crc,const uint8_t *p,uint32_t count){uint32_t i,j;for(i=0;i<count;i++){crc^=p[i];for(j=0;j<8;j++)crc=(crc>>1)^((crc&1U)?0xedb88320U:0U);}return crc;}
/* Explicit attempted-command aggregation; no controller state is touched.
 * Fault/short run must seal partial count, never silently call it complete.
 * Age255 is a representational clamp flagged as bad, not data repair. */
static int id_collect(id_trace *t,uint32_t step,uint32_t ms,uint32_t actual_us,uint32_t dt_us,const int32_t encoder[2],const int16_t command[2],const int16_t rpm[2],const int16_t feedback[2],const int16_t shadow[2],const uint32_t age[2],uint8_t fresh,uint8_t phase,uint8_t flags){
 id_slow_row *a=&t->accumulator;uint32_t ch,fi;
 if(t->ready)return 0;
 if(step!=t->next_step||step>=20400U||t->blob.header.slow_count>=ID_SLOW_RECORDS){t->invalid=1U;return 0;}
 if(!a->steps){memset(a,0,sizeof(*a));for(ch=0;ch<2;ch++)a->command_min[ch]=a->command_max[ch]=command[ch];}
 for(ch=0;ch<2;ch++){
  a->encoder[ch]=encoder[ch];a->rpm[ch]=rpm[ch];a->command_sum[ch]+=command[ch];a->feedback_sum[ch]+=feedback[ch];
  if(command[ch]<a->command_min[ch]){a->command_min[ch]=command[ch];}
  if(command[ch]>a->command_max[ch]){a->command_max[ch]=command[ch];}
  if(age[ch]>255U)a->quality_flags|=4U;
  if(age[ch]>a->max_age[ch])a->max_age[ch]=(uint8_t)(age[ch]>255U?255U:age[ch]);
 }
 a->quality_flags|=fresh&3U;
 if(dt_us<750U||dt_us>1250U)a->quality_flags|=8U;
 a->steps++;a->elapsed_us+=dt_us;a->end_ms=ms;t->next_step++;
 fi=id_fast_index(step);
 if(fi!=0xffffffffU){id_fast_row *f=&t->blob.fast[fi];if(fi!=t->blob.header.fast_count){t->invalid=1U;return 0;}f->ms=ms;f->actual_us=actual_us;for(ch=0;ch<2;ch++){f->encoder[ch]=encoder[ch];f->command[ch]=command[ch];f->rpm[ch]=rpm[ch];f->feedback[ch]=feedback[ch];f->zero_injection_shadow[ch]=shadow[ch];f->age[ch]=(uint8_t)(age[ch]>255U?255U:age[ch]);}f->phase=phase;f->flags=flags;t->blob.header.fast_count++;}
 if(a->steps==20U){t->blob.slow[t->blob.header.slow_count++]=*a;a->steps=0;}
 return 1;
}
static void id_seal(id_trace *t,uint32_t completed,uint32_t elapsed_ms,uint32_t fault,uint32_t fault_ms){
 if(t->ready)return;
 if(t->accumulator.steps){
  if(t->blob.header.slow_count<ID_SLOW_RECORDS)t->blob.slow[t->blob.header.slow_count++]=t->accumulator;
  else t->invalid=1U;
 }
 t->blob.header.last_ms=elapsed_ms;t->blob.header.fault=fault;t->blob.header.first_fault_ms=fault_ms;
 if(t->invalid)t->blob.header.quality_flags|=1U;
 if(fault)t->blob.header.quality_flags|=2U;
 if(!completed||elapsed_ms<20000U)t->blob.header.quality_flags|=4U;
 if(t->blob.header.fast_count<ID_FAST_RECORDS)t->blob.header.quality_flags|=8U;
 t->ready=1U;
}
#endif
