#include <assert.h>
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "experiment5_motion.h"
#include "identification_trace_v3.h"
#include "experiment5_error_summary.h"
static id_trace t,broken;
static unsigned char rebuilt[sizeof(id_blob)];
static unsigned copies[(sizeof(id_blob)+95U)/96U];
static unsigned decode(float x){unsigned e=(unsigned)x,w=e<262144U?(e-65536U)/2U:32768U+(e-262144U)/8U;assert(w<=65535U&&id_encode_word(w)==x);return w;}
static void summary_test(unsigned count,unsigned fault){
 e5_error_summary s;float v[107];unsigned i,completed=0;e5_summary_reset(&s);
 for(i=0;i<count;i++){
  memset(v,0,sizeof(v));v[0]=12+.04f*i;v[79]=4+.04f*i;v[2]=i<200?2:(i<250?3:(i<450?4:5));v[106]=1;
  v[3]=.020f;v[5]=.0198f;v[6]=.0196f;
  e5_summary_complete(&s,completed,0);e5_summary_observe(&s,v);e5_summary_stage(&s,v,100+i,completed);completed++;
 }
 e5_summary_complete(&s,completed,0);memset(v,0,sizeof(v));v[0]=40;v[2]=fault?9:6;v[22]=(float)fault;v[46]=28000;e5_summary_observe(&s,v);e5_summary_display(&s,v);
 if(count==600U&&!fault){assert(e5_summary_valid(&s));assert(fabsf(v[53]-.3f)<1e-6f&&fabsf(v[54]-.2f)<1e-6f);}
 else assert(!e5_summary_valid(&s)&&v[53]==-1&&v[54]==-1);
}
int main(int argc,char **argv){
 unsigned n,ch,phase,us=0,oldfast,oldslow,emissions=0,completed=0,j,chunk,count,expectedCRC;unsigned phaseCount[7]={0};
 int32_t enc[2];int16_t command[2],rpm[2]={0,0},esc[2]={0,0},guard;
 uint32_t age[2]={1,1};int64_t sums[2]={0,0};float ref[3],v[107],peakV=0,peakA=0;FILE *f,*expected;
 assert(argc==3);expected=fopen(argv[2],"wb");assert(expected);fprintf(expected,"ms,phase,actual_us,encoder0,encoder1,integral0,integral1\n");
 assert(sizeof(id_blob)==69312&&sizeof(id_trace)<=70000);
 assert((id_crc(0xffffffffU,(const uint8_t*)"123456789",9)^0xffffffffU)==0xcbf43926U);
 id_reset(&t);t.blob.header.build=68312;t.blob.header.method=11;t.blob.header.reserved[0]=168000000;t.blob.header.reserved[1]=0;t.blob.header.reserved[2]=2;t.blob.header.reserved[3]=1;t.blob.header.configured_right_sign=(uint32_t)-1;
 {float pitch=EXP3_METERS_PER_MOTOR_COUNT;memcpy(&t.blob.header.configured_scale_bits,&pitch,4);}
 for(n=0;n<28000;n++){
  unsigned dt=n%2?1001U:999U;id_slow_row *r=0;
  phase=e5_motion_reference(n,ref);phaseCount[phase]++;
  assert(phase>=1&&phase<=5&&ref[0]>=-1e-7f&&ref[0]<=.0200001f);
  if(fabsf(ref[1])>peakV)peakV=fabsf(ref[1]);if(fabsf(ref[2])>peakA)peakA=fabsf(ref[2]);
  enc[0]=(int32_t)floorf(ref[0]/EXP3_METERS_PER_MOTOR_COUNT+.5f);enc[1]=-enc[0];us+=dt;
  command[0]=(int16_t)((int)(n%2401U)-1200);command[1]=(int16_t)(-command[0]);
  for(ch=0;ch<2;ch++)sums[ch]+=(int64_t)command[ch]*dt;
  oldfast=t.blob.header.fast_count;oldslow=t.blob.header.slow_count;
  assert(id_collect(&t,n,n+1,us,dt,enc,command,rpm,esc,command,age,3,(uint8_t)phase,1));
  if(t.blob.header.fast_count>oldfast)r=&t.blob.fast[oldfast];
  if(t.blob.header.slow_count>oldslow)r=&t.blob.slow[oldslow];
  if(r){
   assert(r->actual_us==us&&r->encoder[0]==enc[0]&&r->encoder[1]==enc[1]);
   assert(r->command_integral[0]==sums[0]&&r->command_integral[1]==sums[1]);
   fprintf(expected,"%u,%u,%u,%d,%d,%d,%d\n",n+1,phase,us,enc[0],enc[1],r->command_integral[0],r->command_integral[1]);sums[0]=0;sums[1]=0;
  }
 }
 fclose(expected);assert(phaseCount[1]==4000&&phaseCount[2]==8000&&phaseCount[3]==2000&&phaseCount[4]==8000&&phaseCount[5]==6000);
 assert(fabsf(peakV-.0046875f)<1e-8f&&peakA<.001805f);
 assert(e5_motion_reference(28000,ref)==6&&ref[0]==0&&ref[1]==0&&ref[2]==0);
 assert(t.blob.header.fast_count==4000&&t.blob.header.slow_count==300);
 assert(t.blob.header.reserved[5]==2000&&t.blob.header.reserved[6]==100&&t.blob.header.reserved[7]==50);
 id_seal(&t,1,28000,0,0);assert(t.ready&&!t.invalid&&t.blob.header.quality_flags==0);
 memset(v,0,sizeof(v));while(!t.complete&&emissions<5000){
  id_next(&t,v,completed++);
  if(v[89]==3){chunk=(unsigned)v[90];assert(chunk<722);count=sizeof(id_blob)-chunk*96U;if(count>96)count=96;
   for(j=0;j<48;j++){unsigned w=decode(v[id_payload_channels[j]]),o=chunk*96+j*2;if(o<sizeof(id_blob))rebuilt[o]=(unsigned char)w;if(o+1<sizeof(id_blob))rebuilt[o+1]=(unsigned char)(w>>8);}
   copies[chunk]++;
  }
  emissions++;
 }
 assert(t.complete&&v[89]==4&&v[90]==0&&emissions<5000);for(j=0;j<722;j++)assert(copies[j]==4);
 assert(!memcmp(rebuilt,&t.blob,sizeof(id_blob)));expectedCRC=id_crc(0xffffffffU,rebuilt,sizeof(rebuilt))^0xffffffffU;assert(expectedCRC==t.crc);
 assert(decode(v[91])+(decode(v[93])<<16)==expectedCRC);
 f=fopen(argv[1],"wb");assert(f&&fwrite(&t.blob,1,sizeof(t.blob),f)==sizeof(t.blob));fclose(f);
 id_reset(&broken);enc[0]=40000;enc[1]=0;command[0]=0;command[1]=0;
 for(n=0;n<40;n++)assert(id_collect(&broken,n,n+1,(n+1)*1000,1000,enc,command,rpm,esc,command,age,3,1,1));assert(broken.invalid);
 id_reset(&broken);enc[0]=0;command[0]=1200;assert(!id_collect(&broken,0,1,3000000,1000,enc,command,rpm,esc,command,age,3,1,1)&&broken.invalid);
 id_reset(&broken);id_seal(&broken,0,7424,1024,7424);assert(broken.blob.header.fault==1024&&(broken.blob.header.quality_flags&14U)==14U);
 guard=1200;assert(e5_motion_speed_guard(28,&guard)&&guard==120);guard=1200;assert(e5_motion_speed_guard(31,&guard)&&guard==-10);
 assert(!e5_motion_rpm_fault(120)&&e5_motion_rpm_fault(121)&&e5_motion_rpm_fault(-121));
 assert(!e5_motion_travel_fault(-.004f)&&e5_motion_travel_fault(-.004001f));
 assert(!e5_motion_travel_fault(.022f)&&e5_motion_travel_fault(.022001f));
 summary_test(600,0);summary_test(400,0);summary_test(600,1024);
 printf("PASS trajectory20mm/8s/28000steps; maxV=%.9g maxA=%.9g; exact4ms/40ms integrals; ABI3/69312bytes/722chunks4copies; overflow/fault rejection; unchanged speed guard;600point RMS/fault/partial rejection\n",(double)peakV,(double)peakA);
 return 0;
}
