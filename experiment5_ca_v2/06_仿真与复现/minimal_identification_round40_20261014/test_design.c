#include <assert.h>
#include <stdio.h>
#include <math.h>
#include <stdlib.h>
#include "experiment5_motion.h"
#include "offline_design.h"
static id_trace trace;
int main(void){uint32_t profile,ms,ch;unsigned guard_checks=0;double cross[3]={0,0,0};
 for(profile=1;profile<=31;profile++){unsigned state=profile,seen=0;int sum=0;for(ms=0;ms<31;ms++){assert(state&&!(seen&(1U<<state)));seen|=1U<<state;state=(state>>1)|((((state>>0)^(state>>2))&1U)<<4);}assert(state==profile);for(ms=0;ms<32;ms++)sum+=id_symbol(profile,ms);assert(sum==0);}
 for(profile=0;profile<3;profile++){int32_t sums[2]={0,0};uint32_t on=0;
  for(ms=0;ms<=20000;ms++){int16_t modal[2],rpm[2]={0,0};id_excitation(ms,profile,1,rpm,modal);sums[0]+=modal[0];sums[1]+=modal[1];
   assert(abs(modal[0])<=20&&abs(modal[1])<=10);assert(abs(modal[0]+modal[1])<=30&&abs(-modal[0]+modal[1])<=30);
   if(modal[0]){on++;cross[profile]+=(double)modal[0]*modal[1];}
   if(ms<4000||ms>=14000||(ms>=8000&&ms<10000))assert(modal[0]==0&&modal[1]==0);
   id_excitation(ms,profile,0,rpm,modal);assert(!modal[0]&&!modal[1]);
   rpm[0]=11;id_excitation(ms,profile,1,rpm,modal);assert(!modal[0]&&!modal[1]);rpm[0]=-11;id_excitation(ms,profile,1,rpm,modal);assert(!modal[0]&&!modal[1]);
  }assert(!sums[0]&&!sums[1]);assert(on==(profile?8000U:0U));
  printf("profile%u nominalZeroNetBias active%u nominalCross%.0f\n",profile,on,cross[profile]);
 }
 for(profile=1;profile<3;profile++)for(ms=4000;ms<8000;ms+=17){
  int speed,base;for(speed=-120;speed<=120;speed++){int16_t rpm[2]={(int16_t)speed,(int16_t)-speed},modal[2];id_excitation(ms,profile,1,rpm,modal);
   for(base=-1200;base<=1200;base+=61)for(ch=0;ch<2;ch++){int addition=ch?-modal[0]+modal[1]:modal[0]+modal[1];int desired=base+addition;int16_t command;
    if(desired>1200){desired=1200;}
    if(desired<-1200){desired=-1200;}
    assert(e5_motion_quantize((float)desired,&command));e5_motion_speed_guard(rpm[ch],&command);assert(abs(command)<=1200);
    if(abs(rpm[ch])>30){int brake=10*(abs(rpm[ch])-30);if(brake>200)brake=200;assert((rpm[ch]>0?command:-command)<=-brake);}guard_checks++;
   }
  }
 }
 memset(&trace,0,sizeof(trace));for(ms=0;ms<20000;ms++){int32_t encoder[2]={(int32_t)ms,-(int32_t)ms};int16_t cmd[2]={(int16_t)((int)(ms%1201U)-600),(int16_t)(600-(int)(ms%1201U))},rpm[2]={1,-1},feedback[2]={-32768,32767},shadow[2]={0,0};uint32_t age[2]={ms%50U,ms%50U};assert(id_collect(&trace,ms,ms,ms*1000U+7U,1000,encoder,cmd,rpm,feedback,shadow,age,3,2,1));}
 assert(trace.blob.header.slow_count==1000&&trace.blob.header.fast_count==400&&!trace.invalid);
 for(ms=0;ms<1000;ms++){id_slow_row *r=&trace.blob.slow[ms];int32_t sum=0;for(ch=ms*20;ch<(ms+1)*20;ch++)sum+=(int)(ch%1201U)-600;assert(r->steps==20&&r->end_ms==(ms+1)*20-1&&r->elapsed_us==20000);assert(r->command_sum[0]==sum&&r->command_sum[1]==-sum);assert(r->feedback_sum[0]==-655360&&r->feedback_sum[1]==655340);}
 assert(trace.blob.fast[0].ms==5400&&trace.blob.fast[199].ms==5599&&trace.blob.fast[200].ms==11400&&trace.blob.fast[399].ms==11599);assert(trace.blob.fast[0].actual_us==5400007U);
 id_seal(&trace,1,20000,0,0);assert(trace.ready&&trace.blob.header.quality_flags==0&&trace.blob.header.slow_count==1000);
 assert((id_crc(0xffffffffU,(const uint8_t*)"123456789",9)^0xffffffffU)==0xcbf43926U);
 {uint32_t c1=id_crc(0xffffffffU,(const uint8_t*)&trace.blob,sizeof(trace.blob));trace.blob.slow[10].command_sum[0]^=1;assert(c1!=id_crc(0xffffffffU,(const uint8_t*)&trace.blob,sizeof(trace.blob)));}
 memset(&trace,0,sizeof(trace));{int32_t p[2]={0,0};int16_t x[2]={0,0};uint32_t age[2]={300,0};assert(id_collect(&trace,0,0,0,1300,p,x,x,x,x,age,0,1,0));assert((trace.accumulator.quality_flags&12U)==12U&&trace.accumulator.max_age[0]==255);assert(!id_collect(&trace,2,2,2000,1000,p,x,x,x,x,age,0,1,0)&&trace.invalid);}
 id_seal(&trace,0,1,512,1);assert(trace.blob.header.fault==512&&trace.blob.header.quality_flags==15&&trace.blob.header.slow_count==1&&trace.blob.slow[0].steps==1);
 memset(&trace,0,sizeof(trace));{int32_t p[2]={0,0};int16_t x[2]={0,0};uint32_t age[2]={0,0};for(ms=0;ms<20400;ms++)assert(id_collect(&trace,ms,ms,ms*1000U,1000,p,x,x,x,x,age,3,2,1));assert(trace.blob.header.slow_count==1020);assert(!id_collect(&trace,20400,20400,20400000,1000,p,x,x,x,x,age,3,2,1));assert(trace.invalid);}
 /*Repeated/ skipped board-ms timestamps are retained, not invented as1ms.
  * Sample sequence still advances; microsecond timing records actual time.*/
 memset(&trace,0,sizeof(trace));{int32_t p[2]={0,0};int16_t x[2]={0,0};uint32_t age[2]={0,0};unsigned now_us=0;for(ms=0;ms<20000;ms++){unsigned dt=ms%2?1010U:990U;assert(id_collect(&trace,ms,now_us/1000U,now_us,dt,p,x,x,x,x,age,3,2,1));now_us+=dt;}assert(trace.blob.fast[0].actual_us==5400000&&trace.blob.fast[1].actual_us==5400990&&trace.blob.fast[1].ms==5400);assert(trace.blob.slow[0].elapsed_us==20000);}
 printf("guardEnvelopeFixtures%u sizeofSlow%u sizeofFast%u blob%u trace%u originalBuffers64200 hostOnlyChecksPassed\n",guard_checks,(unsigned)sizeof(id_slow_row),(unsigned)sizeof(id_fast_row),(unsigned)sizeof(id_blob),(unsigned)sizeof(id_trace));return 0;}
