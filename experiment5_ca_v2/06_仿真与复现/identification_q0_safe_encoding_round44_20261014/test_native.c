#include <assert.h>
#include <math.h>
#include <stdio.h>
#include <string.h>
#include "blnn_core.h"
#include "experiment5_formal_actuator.h"
#include "identification_trace.h"
volatile float g_e5_online_nn_scale=1,g_e5_online_learning_scale=1;
int e5_original_reset(e5_state*,uint32_t,uint32_t);
int e5_original_step(e5_state*,const e5_input*,e5_output*);
static e5_state a,b,saved;
static id_trace trace;
static uint8_t received[sizeof(id_blob)];
static unsigned copies[(sizeof(id_blob)+15)/16];
static unsigned recovered_copies[(sizeof(id_blob)+15)/16];
int main(int argc,char **argv){unsigned trial,n,ch,core_checks=0;float ref[3];
 for(trial=0;trial<5;trial++){
  e5_input in;e5_output oa,ob;memset(&in,0,sizeof(in));in.limit[0]=in.limit[1]=1200;
  assert(e5_reset(&a,11,4)&&e5_original_reset(&b,11,4));id_reset(&trace);trace.blob.header.build=67823;trace.blob.header.method=11;trace.blob.header.reserved[1]=1;trace.blob.header.reserved[2]=2;trace.blob.header.reserved[3]=ID_WORD_ENCODING;
  for(n=0;n<20000;n++){
   int16_t ca[2],cb[2],prea[2],preb[2],rpm[2],esc[2]={-32768,32767};uint32_t ma,mb,age[2]={1,2};int32_t encoder[2];
   unsigned dt=n%2?1010U:990U;e5_motion_reference(n,ref);
   for(ch=0;ch<3;ch++)in.reference[ch]=ref[ch];
   in.q[0]=(e5_real)ref[0]+(e5_real)(.00002*sin((n+trial*3)*.003));in.q[1]=(e5_real)(.00005*sin(n*.007));
   in.velocity[0]=(e5_real)ref[1];in.velocity[1]=(e5_real)(.00001*cos(n*.007));in.acceleration[0]=(e5_real)ref[2];in.acceleration[1]=0;
   rpm[0]=(int16_t)((int)(n%19)-9);rpm[1]=(int16_t)-rpm[0];in.raw_rpm[0]=rpm[0];in.raw_rpm[1]=rpm[1];
   assert(e5_step(&a,&in,&oa)&&e5_original_step(&b,&in,&ob));
   assert(e5_formal_finalize(11,&in,&oa,ca,prea,&ma)&&e5_formal_finalize(11,&in,&ob,cb,preb,&mb));
   for(ch=0;ch<2;ch++){a.aw[ch]+=(e5_real).001f*16.0f*((e5_real)ca[ch]-oa.current[ch]);b.aw[ch]+=(e5_real).001f*16.0f*((e5_real)cb[ch]-ob.current[ch]);encoder[ch]=(int32_t)n*(ch?-1:1);}
   assert(memcmp(&a,&b,sizeof(a))==0&&memcmp(&oa,&ob,sizeof(oa))==0&&memcmp(ca,cb,sizeof(ca))==0&&ma==mb);
   saved=a;assert(id_collect(&trace,n,n+1,(n+1)*1000,dt,encoder,ca,rpm,esc,ca,age,3,2,1));assert(memcmp(&saved,&a,sizeof(a))==0);core_checks++;
  }
  id_seal(&trace,1,20000,0,0);assert(trace.blob.header.slow_count==1000&&trace.blob.header.fast_count==400&&trace.ready&&!trace.invalid);
  for(n=0;n<1000;n++){assert(trace.blob.slow[n].elapsed_us==20000&&trace.blob.slow[n].steps==20);assert(trace.blob.slow[n].feedback_sum[0]==-655360&&trace.blob.slow[n].feedback_sum[1]==655340);}
 }
 assert((id_crc(0xffffffffU,(const uint8_t*)"123456789",9)^0xffffffffU)==0xcbf43926U);
 assert(!id_allow_output(5,0,100000,63,64,1));assert(id_allow_output(6,0,0,0,0,1));assert(!id_allow_output(6,512,10000,63,64,1));
 assert(!id_allow_output(9,512,4999,63,64,1));assert(!id_allow_output(9,512,5000,62,64,1));assert(id_allow_output(9,512,5000,63,64,1));assert(!id_allow_output(9,0,10000,63,64,1));
 {unsigned completed=100,frames=0,status;float v[107]={0};memset(copies,0,sizeof(copies));
  do{id_next(&trace,v,completed++);status=(unsigned)v[89];assert(v[88]==4441&&v[92]==63488);
   if(status==3){unsigned index=(unsigned)v[90],i;assert(index<3968);for(i=0;i<8;i++){unsigned encoded=(unsigned)v[96+i],word=encoded<262144U?(encoded-65536U)/2U:32768U+(encoded-262144U)/8U,offset=index*16+i*2;assert(word<=65535&&id_encode_word(word)==v[96+i]);if(copies[index]){assert(received[offset]==(uint8_t)word&&received[offset+1]==(uint8_t)(word>>8));}else{received[offset]=(uint8_t)word;received[offset+1]=(uint8_t)(word>>8);}}copies[index]++;
    /* Recorded missing blocks165/576 plus a10-frame burst; second pass
     * loses a disjoint10-frame burst. Every index must still have2copies. */
    if(!((trace.export_pass==0&&(index==165||index==576||(index>=213&&index<=217)))||(trace.export_pass==1&&index>=600&&index<=604)))recovered_copies[index]++;
    frames++;
   }
  }while(status!=4);
  for(n=0;n<3968;n++){assert(copies[n]==4&&recovered_copies[n]>=2);}
  assert(frames==15872&&trace.export_pass==1&&trace.cursor==0&&memcmp(received,&trace.blob,sizeof(trace.blob))==0);assert((id_crc(0xffffffffU,received,sizeof(received))^0xffffffffU)==trace.crc);
  received[500]^=1;assert((id_crc(0xffffffffU,received,sizeof(received))^0xffffffffU)!=trace.crc);
 }
 if(argc==2){FILE *f=fopen(argv[1],"wb");assert(f);assert(fwrite(&trace.blob,1,sizeof(trace.blob),f)==sizeof(trace.blob));assert(fclose(f)==0);}
 id_reset(&trace);{int32_t p[2]={0,0};int16_t c[2]={1200,-1200},rpm[2]={0,0};uint32_t age[2]={300,0};assert(id_collect(&trace,0,1,1000,1000,p,c,rpm,c,c,age,0,2,1));assert(trace.accumulator.command_integral[0]==1200000);assert(!id_collect(&trace,2,2,2000,1000,p,c,rpm,c,c,age,0,2,1));id_seal(&trace,0,1,512,1);assert(trace.blob.header.quality_flags==15&&trace.blob.header.fault==512&&trace.blob.slow[0].steps==1);}
 /* Repeated snapshot calls without a DMA completion must not advance. */
 id_reset(&trace);trace.ready=1;trace.crc_offset=sizeof(trace.blob);trace.crc=0;
 {float v[107]={0};id_blob immutable=trace.blob;id_next(&trace,v,100);for(n=0;n<100;n++){id_next(&trace,v,100);assert(trace.cursor==0&&trace.repeat==0&&trace.export_pass==0&&v[89]==3);}assert(memcmp(&immutable,&trace.blob,sizeof(immutable))==0);}
 printf("PASS exactCoreStateOutputCommands%u intervalIntegralPartialFaultCRC15872TwoPassChunksBurstRecoveryNoTXAdvance traceBytes%u\n",core_checks,(unsigned)sizeof(trace));return 0;}
