#ifndef E5_IDENTIFICATION_TRACE_H
#define E5_IDENTIFICATION_TRACE_H
/* Q0 recorder only: NO excitation or control-write API.
 * Interval END feedback is paired with the preceding attempted command.
 * Slow command fields are count*microsecond integrals, not sampled means.
 * Full CSV fault/timing checks remain mandatory; a stopped immutable blob
 * cannot relabel a later fault or certify actuator delivery. */
#include <stdint.h>
#include <string.h>
#define E5_ID_MAGIC 4441U
#define ID_EXPORT_PASSES 2U
#define ID_WORD_ENCODING 1U
/* Two exact integer ranges, constant float exponent within each range.
 * Low byte is always00 and third byte>=80, unlike raw uint16 floats. */
static float id_encode_word(uint32_t word){
 return (float)(word<32768U?65536U+2U*word:262144U+8U*(word-32768U));
}
#define ID_SLOW_RECORDS 1020U
#define ID_FAST_RECORDS 400U
typedef struct {
 uint32_t end_ms;
 int32_t encoder[2],command_integral[2],feedback_sum[2];
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
typedef struct {id_blob blob;id_slow_row accumulator;uint32_t next_step,crc,crc_offset,cursor,repeat,pending,last_completed,complete,ready,invalid,export_pass;} id_trace;
typedef char id_trace_budget[(sizeof(id_trace)<=64200)?1:-1];
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
  int64_t integral=(int64_t)a->command_integral[ch]+(int64_t)command[ch]*dt_us;
  if(integral>2147483647LL||integral<(-2147483647LL-1LL)){t->invalid=1U;return 0;}
  a->encoder[ch]=encoder[ch];a->rpm[ch]=rpm[ch];a->command_integral[ch]=(int32_t)integral;a->feedback_sum[ch]+=feedback[ch];t->blob.header.last_encoder[ch]=(uint32_t)encoder[ch];
  if(command[ch]<a->command_min[ch]){a->command_min[ch]=command[ch];}
  if(command[ch]>a->command_max[ch]){a->command_max[ch]=command[ch];}
  if(age[ch]>255U)a->quality_flags|=4U;
  if(age[ch]>a->max_age[ch])a->max_age[ch]=(uint8_t)(age[ch]>255U?255U:age[ch]);
 }
 a->quality_flags|=fresh&3U;
 if(dt_us<750U||dt_us>1250U)a->quality_flags|=8U;
 a->steps++;a->elapsed_us+=dt_us;a->end_ms=ms;t->next_step++;
 if(!t->blob.header.period_min_us||dt_us<t->blob.header.period_min_us)t->blob.header.period_min_us=dt_us;
 if(dt_us>t->blob.header.period_max_us)t->blob.header.period_max_us=dt_us;
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
static void id_reset(id_trace *t){memset(t,0,sizeof(*t));t->crc=0xffffffffU;t->blob.header.version=1U;t->blob.header.core_dt_us=1000U;t->blob.header.slow_row_bytes=sizeof(id_slow_row);t->blob.header.fast_row_bytes=sizeof(id_fast_row);}
static int id_allow_output(uint32_t phase,uint32_t fault,uint32_t age_ms,uint32_t cursor,uint32_t count,uint32_t ready){
 if(!ready)return 0;
 if(phase==6U&&fault==0U)return 1;
 return phase==9U&&fault!=0U&&count>0U&&cursor>=count-1U&&age_ms>=5000U;
}
/* Bounded CRC and duplicate16-byte chunks AFTER STOP ONLY.
 * Send full immutable blob ascending then descending; status4 is withheld
 * until BOTH passes finish. No motor repeat, new allocation or RX command.
 * UART TC is not PC acknowledgement: even two passes can lose bytes.
 * Decoder still requires >=2 identical copies/index and whole CRC. */
static void id_next(id_trace *t,float v[107],uint32_t completed){
 const uint8_t *data=(const uint8_t*)&t->blob;
 uint32_t bytes=sizeof(t->blob),chunks=(bytes+15U)/16U,i,offset,n,word;
 v[88]=(float)E5_ID_MAGIC;v[90]=(float)t->cursor;v[92]=(float)bytes;
 if(!t->ready){v[89]=5;v[91]=0;v[93]=0;for(i=96;i<104;i++)v[i]=0;return;}
 if(t->crc_offset<bytes){n=bytes-t->crc_offset;if(n>256U)n=256U;t->crc=id_crc(t->crc,data+t->crc_offset,n);t->crc_offset+=n;v[89]=2;v[91]=0;v[93]=0;for(i=96;i<104;i++)v[i]=0;if(t->crc_offset==bytes)t->crc^=0xffffffffU;return;}
 if(t->pending&&completed!=t->last_completed&&!t->complete){
  if(!t->repeat)t->repeat=1U;
  else{
   t->repeat=0;
   if(t->export_pass==0U){
    if(t->cursor+1U<chunks)t->cursor++;
    else t->export_pass=1U; /* reverse pass starts at the last index */
   }else{
    if(t->cursor>0U)t->cursor--;
    else t->complete=1U;
   }
  }
 }
 /* Two encoded integer ranges are exact float32. Their byte prefixes/suffixes
  * cannot generate0000807f within/between packed fields, even after zero.
  * Decoder inverts mapping BEFORE CRC/ABI checks. Blob itself is unchanged. */
 t->pending=1U;t->last_completed=completed;v[89]=t->complete?4.0f:3.0f;v[90]=(float)t->cursor;v[91]=id_encode_word(t->crc&65535U);v[93]=id_encode_word(t->crc>>16);
 for(i=0;i<8;i++){offset=t->cursor*16U+i*2U;word=offset<bytes?data[offset]:0U;if(offset+1U<bytes)word|=(uint32_t)data[offset+1U]<<8;v[96+i]=id_encode_word(word);}
}
#endif
