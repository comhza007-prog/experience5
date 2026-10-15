#include <assert.h>
#include <math.h>
#include <stddef.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "identification_trace.h"
static id_trace t;
static unsigned char recovered[sizeof(id_blob)];
static unsigned copies[(sizeof(id_blob)+95)/96];
static unsigned decode_word(float f){unsigned x=(unsigned)f,w=x<262144U?(x-65536U)/2U:32768U+(x-262144U)/8U;assert(w<=65535U&&id_encode_word(w)==f);return w;}
int main(int argc,char **argv){
 unsigned n,ch,us=0,completed=10,frames=0;int32_t enc[2];int16_t cmd[2],rpm[2],current[2];uint32_t age[2];
 int64_t total[2]={0,0},coarse[2]={0,0};unsigned previous_time=0;FILE *expected,*binary;float values[107];
 assert(argc==3);assert(sizeof(id_sample)==28&&sizeof(id_coarse_row)==36&&sizeof(id_blob)==83872&&sizeof(id_trace)==83968);
 assert(offsetof(id_sample,meta)==26&&offsetof(id_coarse_row,command_integral)==28);
 assert((id_crc(0xffffffffU,(const uint8_t*)"123456789",9)^0xffffffffU)==0xcbf43926U);
 expected=fopen(argv[2],"wb");assert(expected);
 fprintf(expected,"step,phase,us,dt,p0,p1,c0,c1,i0,i1,r0,r1,mV,age0,age1,bms_age,meta,fine\n");
 id_reset(&t);t.blob.header.build=68212;t.blob.header.method=11;t.blob.header.configured_right_sign=(uint32_t)-1;
 t.blob.header.reserved[0]=168000000;t.blob.header.reserved[1]=1;t.blob.header.reserved[2]=2;t.blob.header.reserved[3]=1;
 for(n=0;n<20000;n++){
  unsigned phase=n<4000?1:n<8000?2:n<10000?3:n<14000?4:5,dt=n%2?1001:999;
  unsigned before=t.blob.header.fast_count,slow_before=t.blob.header.slow_count,meta;float volts;
  if(n==5000)dt=750;if(n==5001)dt=1250;
  us+=dt;
  for(ch=0;ch<2;ch++){
   enc[ch]=(int32_t)((n*(ch+1U))%9000U)-4500;cmd[ch]=(int16_t)((int)((n+ch*29U)%2401U)-1200);
   current[ch]=(int16_t)((int)((n*127U+ch*65535U)%65536U)-32768);
   rpm[ch]=(int16_t)((int)((n*7U+ch*32768U)%65536U)-32768);age[ch]=(n+ch)%6U;
   total[ch]+=(int64_t)cmd[ch]*dt;
  }
  volts=24.0f+(float)(n%1000U)*.001f;meta=1U|((n&3U)<<2)|(phase<<4)|128U|256U;
  assert(id_collect(&t,n,n+1,us,dt,enc,cmd,rpm,current,cmd,age,(uint8_t)(n&3U),(uint8_t)phase,1,volts,n%11U,1));
  fprintf(expected,"%u,%u,%u,%u,%d,%d,%d,%d,%d,%d,%d,%d,%u,%u,%u,%u,%u,%u\n",n,phase,us,dt,
   enc[0],enc[1],cmd[0],cmd[1],current[0],current[1],rpm[0],rpm[1],(unsigned)(volts*1000.0f+.5f),age[0],age[1],n%11U,meta,id_fine_step(n));
  if(id_fine_step(n)){
   const id_sample *r=&t.blob.fine[before];assert(t.blob.header.fast_count==before+1U);
   assert(r->actual_us==us&&r->meta==(meta|512U)&&r->esc_current[0]==current[0]&&r->esc_current[1]==current[1]);
   assert(r->rpm[0]==rpm[0]&&r->rpm[1]==rpm[1]);
  }else{
   for(ch=0;ch<2;ch++)coarse[ch]+=(int64_t)cmd[ch]*dt;
   if(t.blob.header.slow_count>slow_before){
    const id_coarse_row *r=&t.blob.coarse[slow_before];assert(r->endpoint.actual_us==us);
    for(ch=0;ch<2;ch++){assert(r->command_integral[ch]==coarse[ch]);coarse[ch]=0;}
   }
  }
 }
 assert(fclose(expected)==0);id_seal(&t,1,20000,0,0);
 assert(t.ready&&!t.invalid&&!t.blob.header.quality_flags&&t.blob.header.fast_count==1800&&t.blob.header.slow_count==910);
 {int64_t sum[2]={0,0};unsigned fi=0,ci=0;
  while(fi<1800U||ci<910U){
   int fine=ci==910U||(fi<1800U&&t.blob.fine[fi].actual_us<t.blob.coarse[ci].endpoint.actual_us);
   if(fine){const id_sample *r=&t.blob.fine[fi++];for(ch=0;ch<2;ch++)sum[ch]+=(int64_t)r->command[ch]*(r->actual_us-previous_time);previous_time=r->actual_us;}
   else{const id_coarse_row *r=&t.blob.coarse[ci++];for(ch=0;ch<2;ch++)sum[ch]+=r->command_integral[ch];previous_time=r->endpoint.actual_us;}
  }
  assert(sum[0]==total[0]&&sum[1]==total[1]&&previous_time==us);
 }
 binary=fopen(argv[1],"wb");assert(binary&&fwrite(&t.blob,1,sizeof(t.blob),binary)==sizeof(t.blob));assert(fclose(binary)==0);
 for(n=0;n<65536U;n++)assert(decode_word(id_encode_word(n))==n);
 do{
  for(n=0;n<107;n++)values[n]=(float)n;id_next(&t,values,completed++);
  for(n=0;n<107;n++){
   unsigned payload=0;for(ch=0;ch<48;ch++)if(n==id_payload_channels[ch])payload=1;
   if(!payload&&(n<88U||n>93U))assert(values[n]==(float)n);
  }
  if(values[89]==3){
   unsigned index=(unsigned)values[90];
   for(n=0;n<48;n++){
    unsigned w=decode_word(values[id_payload_channels[n]]),at=index*96U+n*2U;
    if(at<sizeof(recovered)){if(copies[index])assert(recovered[at]==(unsigned char)w);else recovered[at]=(unsigned char)w;}
    if(at+1U<sizeof(recovered)){if(copies[index])assert(recovered[at+1U]==(unsigned char)(w>>8));else recovered[at+1U]=(unsigned char)(w>>8);}
   }copies[index]++;frames++;
  }
 }while(values[89]!=4);
 for(n=0;n<sizeof(copies)/sizeof(copies[0]);n++)assert(copies[n]==4);
 assert(memcmp(recovered,&t.blob,sizeof(recovered))==0&&frames==3496&&t.cursor==0);
 assert((id_crc(0xffffffffU,recovered,sizeof(recovered))^0xffffffffU)==t.crc);
 assert(!id_allow_output(5,0,9999,1,2,1)&&id_allow_output(6,0,0,0,0,1));
 assert(!id_allow_output(9,512,4999,1,2,1)&&!id_allow_output(9,512,5000,0,2,1)&&id_allow_output(9,512,5000,1,2,1));
 id_reset(&t);t.ready=1;t.crc_offset=sizeof(t.blob);id_next(&t,values,10);
 for(n=0;n<100;n++){id_next(&t,values,10);assert(!t.cursor&&!t.repeat&&!t.export_pass);}
 id_reset(&t);enc[0]=40000;assert(!id_collect(&t,0,1,1000,1000,enc,cmd,rpm,current,cmd,age,3,1,1,24,0,1)&&t.invalid);
 id_reset(&t);enc[0]=0;cmd[0]=1201;assert(!id_collect(&t,0,1,1000,1000,enc,cmd,rpm,current,cmd,age,3,1,1,24,0,1)&&t.invalid);
 id_reset(&t);cmd[0]=0;t.blob.header.fast_count=ID_FINE_RECORDS;
 assert(!id_collect(&t,0,1,1000,1000,enc,cmd,rpm,current,cmd,age,3,1,1,24,0,1)&&t.invalid);
 id_reset(&t);assert(id_collect(&t,0,1,1000,1000,enc,cmd,rpm,current,cmd,age,3,1,1,NAN,1000,0));
 assert(t.blob.header.quality_flags&128U);id_seal(&t,0,1,512,1);assert((t.blob.header.quality_flags&14U)==14U);
 printf("PASS ABI4 blob%u trace%u fine1800 coarse910 full20000 input-integral-conservation current/rpm-int16-lossless words65536 chunks3496 fault-gating/stalled-TC/overflow/battery-flags no-hardware\n",(unsigned)sizeof(id_blob),(unsigned)sizeof(id_trace));
 return 0;
}
