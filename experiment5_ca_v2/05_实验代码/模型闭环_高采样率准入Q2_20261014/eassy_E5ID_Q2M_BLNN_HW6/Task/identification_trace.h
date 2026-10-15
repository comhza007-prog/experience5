#ifndef E5_IDENTIFICATION_TRACE_H
#define E5_IDENTIFICATION_TRACE_H
/* Q2 logger ONLY. No excitation/control-write API. Previous QUEUED command
 * pairs with interval-END encoder/RPM; not a CAN acknowledgement or force.
 * Every moving interval (phase2/4) is losslessly packed; holds are40-step
 * endpoints with actual-us command integrals, NOT recovered waveforms.
 * Representational overflow invalidates the log, never changes protection.
 * Version2 ABI intentionally differs from the old sparse Q0 recorder. */
#include <stdint.h>
#include <string.h>
#define E5_ID_MAGIC 4443U
#define ID_EXPORT_PASSES 2U
#define ID_WORD_ENCODING 1U
#define ID_SLOW_RECORDS 304U
#define ID_FAST_RECORDS 8020U
#define ID_EXCEPTION_RECORDS 64U
#define ID_CHUNK_BYTES 96U
static const uint8_t id_payload_channels[48]={
 3,4,5,6,7,8,9,10,11,12,15,16,17,18,23,24,25,26,
 29,30,31,32,33,34,35,36,37,38,39,40,49,50,51,52,53,54,55,56,
 61,62,64,65,66,67,68,74,75,76};
static float id_encode_word(uint32_t w){return (float)(w<32768U?65536U+2U*w:262144U+8U*(w-32768U));}
typedef struct {uint32_t actual_us;int16_t encoder[2];int32_t command_integral[2];} id_slow_row;
typedef struct {uint32_t lo,hi;} id_fast_row;
typedef struct {
 uint32_t index,actual_us;int32_t encoder[2];int16_t command[2],rpm[2];
 uint8_t age[2],flags,pad;
} id_exception_row;
typedef struct {
 uint32_t version,build,method,max_age_left,max_age_right,slow_count,fast_count,first_ms;
 uint32_t last_ms,fault,first_fault_ms,core_dt_us,slow_row_bytes,fast_row_bytes,origin[2];
 uint32_t last_encoder[2],configured_scale_bits,configured_right_sign,period_min_us,period_max_us;
 uint32_t quality_flags,collected_steps,reserved[8];
} id_header;
typedef struct {
 id_header header;id_slow_row slow[ID_SLOW_RECORDS];id_fast_row fast[ID_FAST_RECORDS];
 id_exception_row exception[ID_EXCEPTION_RECORDS];
} id_blob;
typedef struct {uint32_t end_ms,actual_us,steps;int32_t encoder[2],command_integral[2];} id_accumulator;
typedef struct {
 id_blob blob;id_accumulator accumulator;
 uint32_t next_step,crc,crc_offset,cursor,repeat,pending,last_completed,complete,ready,invalid,export_pass;
 uint32_t previous_actual_us;int32_t previous_encoder[2];uint8_t previous_phase;
} id_trace;
typedef char id_slow_size[(sizeof(id_slow_row)==16)?1:-1];
typedef char id_fast_size[(sizeof(id_fast_row)==8)?1:-1];
typedef char id_exception_size[(sizeof(id_exception_row)==28)?1:-1];
typedef char id_header_size[(sizeof(id_header)==128)?1:-1];
typedef char id_trace_budget[(sizeof(id_trace)<=71200)?1:-1];
static uint32_t id_crc(uint32_t crc,const uint8_t *p,uint32_t count){uint32_t i,j;for(i=0;i<count;i++){crc^=p[i];for(j=0;j<8;j++)crc=(crc>>1)^((crc&1U)?0xedb88320U:0U);}return crc;}
static void id_flush_slow(id_trace *t){
 id_accumulator *a=&t->accumulator;id_slow_row *r;uint32_t ch;
 if(!a->steps)return;
 if(t->blob.header.slow_count>=ID_SLOW_RECORDS){t->invalid=1U;a->steps=0;return;}
 for(ch=0;ch<2;ch++)if(a->encoder[ch]<-32768||a->encoder[ch]>32767){t->invalid=1U;a->steps=0;return;}
 r=&t->blob.slow[t->blob.header.slow_count++];r->actual_us=a->actual_us;
 for(ch=0;ch<2;ch++){r->encoder[ch]=(int16_t)a->encoder[ch];r->command_integral[ch]=a->command_integral[ch];}
 if(t->previous_phase==1U)t->blob.header.reserved[6]++;
 else if(t->previous_phase==3U)t->blob.header.reserved[7]++;
 else if(t->previous_phase!=5U)t->invalid=1U;
 a->steps=0;a->command_integral[0]=0;a->command_integral[1]=0;
}
static int id_collect(id_trace *t,uint32_t step,uint32_t ms,uint32_t actual_us,uint32_t dt_us,const int32_t encoder[2],const int16_t command[2],const int16_t rpm[2],const int16_t feedback[2],const int16_t shadow[2],const uint32_t age[2],uint8_t fresh,uint8_t phase,uint8_t flags){
 uint32_t ch,dt,exception=0U,fi;int64_t delta[2],integral;uint64_t packed;id_fast_row *r;
 (void)feedback;(void)shadow;
 if(t->ready)return 0;
 if(step!=t->next_step||step>=20400U||actual_us<=t->previous_actual_us){t->invalid=1U;return 0;}
 if(phase<1U||phase>5U){t->invalid=1U;return 0;}
 if(t->previous_phase&&phase!=t->previous_phase){
  id_flush_slow(t);
  if(phase!=t->previous_phase+1U)t->invalid=1U;
 }
 dt=actual_us-t->previous_actual_us;
 if(!step)t->blob.header.first_ms=ms;
 if(!t->blob.header.period_min_us||dt_us<t->blob.header.period_min_us)t->blob.header.period_min_us=dt_us;
 if(dt_us>t->blob.header.period_max_us)t->blob.header.period_max_us=dt_us;
 if(dt_us<750U||dt_us>1250U)t->blob.header.quality_flags|=16U;
 if(age[0]>t->blob.header.max_age_left)t->blob.header.max_age_left=age[0];
 if(age[1]>t->blob.header.max_age_right)t->blob.header.max_age_right=age[1];
 if(age[0]>50U||age[1]>50U)t->blob.header.quality_flags|=32U;
 if(flags&2U)t->blob.header.quality_flags|=64U;
 for(ch=0;ch<2;ch++){
  delta[ch]=(int64_t)encoder[ch]-t->previous_encoder[ch];
  if(command[ch]<-1200||command[ch]>1200)t->invalid=1U;
  if(delta[ch]<-32||delta[ch]>31||rpm[ch]<-128||rpm[ch]>127||command[ch]<-2048||command[ch]>2047)exception=1U;
  t->blob.header.last_encoder[ch]=(uint32_t)encoder[ch];
 }
 if(phase==2U||phase==4U){
  fi=t->blob.header.fast_count;
  if(fi>=ID_FAST_RECORDS){t->invalid=1U;return 0;}
  if(dt<872U||dt>1127U)exception=1U;
  packed=((uint64_t)((uint16_t)command[0]&4095U))|
    ((uint64_t)((uint16_t)command[1]&4095U)<<12)|
    ((uint64_t)((uint32_t)delta[0]&63U)<<24)|((uint64_t)((uint32_t)delta[1]&63U)<<30)|
    ((uint64_t)((uint16_t)rpm[0]&255U)<<36)|((uint64_t)((uint16_t)rpm[1]&255U)<<44)|
    ((uint64_t)((dt-1000U)&255U)<<52)|
    ((uint64_t)((flags&1U)|((fresh&3U)<<1)|(exception?8U:0U))<<60);
  r=&t->blob.fast[fi];r->lo=(uint32_t)packed;r->hi=(uint32_t)(packed>>32);
  if(exception){
   uint32_t ei=t->blob.header.reserved[4];id_exception_row *e;
   if(ei>=ID_EXCEPTION_RECORDS){t->invalid=1U;return 0;}
   e=&t->blob.exception[ei];e->index=fi;e->actual_us=actual_us;
   for(ch=0;ch<2;ch++){e->encoder[ch]=encoder[ch];e->command[ch]=command[ch];e->rpm[ch]=rpm[ch];e->age[ch]=(uint8_t)(age[ch]>255U?255U:age[ch]);}
   e->flags=flags;t->blob.header.reserved[4]++;
  }
  t->blob.header.fast_count++;
  if(phase==2U)t->blob.header.reserved[5]++;
 }else{
  id_accumulator *a=&t->accumulator;
  for(ch=0;ch<2;ch++){
   integral=(int64_t)a->command_integral[ch]+(int64_t)command[ch]*dt;
   if(integral>2147483647LL||integral<(-2147483647LL-1LL)){t->invalid=1U;return 0;}
   a->command_integral[ch]=(int32_t)integral;a->encoder[ch]=encoder[ch];
  }
  a->actual_us=actual_us;a->steps++;
 }
 t->previous_phase=phase;t->previous_actual_us=actual_us;
 t->previous_encoder[0]=encoder[0];t->previous_encoder[1]=encoder[1];
 t->accumulator.end_ms=ms;t->next_step++;t->blob.header.collected_steps=t->next_step;
 if(t->accumulator.steps==40U)id_flush_slow(t);
 return 1;
}
static void id_seal(id_trace *t,uint32_t completed,uint32_t elapsed_ms,uint32_t fault,uint32_t fault_ms){
 if(t->ready)return;
 id_flush_slow(t);
 t->blob.header.last_ms=elapsed_ms;t->blob.header.fault=fault;t->blob.header.first_fault_ms=fault_ms;
 if(t->invalid)t->blob.header.quality_flags|=1U;
 if(fault)t->blob.header.quality_flags|=2U;
 if(!completed||elapsed_ms<20000U)t->blob.header.quality_flags|=4U;
 if(t->previous_phase!=5U||!t->blob.header.reserved[5]||t->blob.header.fast_count<=t->blob.header.reserved[5]||!t->blob.header.reserved[6]||!t->blob.header.reserved[7])t->blob.header.quality_flags|=8U;
 t->ready=1U;
}
static void id_reset(id_trace *t){memset(t,0,sizeof(*t));t->crc=0xffffffffU;t->blob.header.version=2U;t->blob.header.core_dt_us=1000U;t->blob.header.slow_row_bytes=sizeof(id_slow_row);t->blob.header.fast_row_bytes=sizeof(id_fast_row);}
static int id_allow_output(uint32_t phase,uint32_t fault,uint32_t age_ms,uint32_t cursor,uint32_t count,uint32_t ready){
 if(!ready)return 0;
 if(phase==6U&&fault==0U)return 1;
 return phase==9U&&fault!=0U&&count>0U&&cursor>=count-1U&&age_ms>=5000U;
}
/* Four copies per96-byte chunk (two ascending/two descending). Only stopped
 * payload channels change. Critical zero-command/phase/fault/timing/build
 * channels remain normal. UART completion is NOT host acknowledgement. */
static void id_next(id_trace *t,float v[107],uint32_t completed){
 const uint8_t *data=(const uint8_t*)&t->blob;
 uint32_t bytes=sizeof(t->blob),chunks=(bytes+ID_CHUNK_BYTES-1U)/ID_CHUNK_BYTES,i,offset,n,w;
 v[88]=(float)E5_ID_MAGIC;v[90]=(float)t->cursor;v[92]=(float)bytes;
 if(!t->ready){v[89]=5;v[91]=0;v[93]=0;return;}
 if(t->crc_offset<bytes){n=bytes-t->crc_offset;if(n>256U)n=256U;t->crc=id_crc(t->crc,data+t->crc_offset,n);t->crc_offset+=n;v[89]=2;v[91]=0;v[93]=0;if(t->crc_offset==bytes)t->crc^=0xffffffffU;return;}
 if(t->pending&&completed!=t->last_completed&&!t->complete){
  if(!t->repeat)t->repeat=1U;
  else{t->repeat=0;
   if(t->export_pass==0U){if(t->cursor+1U<chunks)t->cursor++;else t->export_pass=1U;}
   else{if(t->cursor>0U)t->cursor--;else t->complete=1U;}
  }
 }
 t->pending=1U;t->last_completed=completed;v[89]=t->complete?4.0f:3.0f;v[90]=(float)t->cursor;
 v[91]=id_encode_word(t->crc&65535U);v[93]=id_encode_word(t->crc>>16);
 for(i=0;i<48U;i++){offset=t->cursor*ID_CHUNK_BYTES+i*2U;w=offset<bytes?data[offset]:0U;if(offset+1U<bytes)w|=(uint32_t)data[offset+1U]<<8;v[id_payload_channels[i]]=id_encode_word(w);}
}
#endif
