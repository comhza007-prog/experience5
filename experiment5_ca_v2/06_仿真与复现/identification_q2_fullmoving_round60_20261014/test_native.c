#include <assert.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "identification_trace.h"
static id_trace t;
static unsigned char got[sizeof(id_blob)];
static unsigned copies[(sizeof(id_blob)+95)/96];
static int unpack_signed(unsigned v,unsigned bits){unsigned m=1U<<(bits-1);return (int)(v^m)-(int)m;}
static uint64_t word(id_fast_row r){return (uint64_t)r.lo|((uint64_t)r.hi<<32);}
static unsigned dec(float v){unsigned e=(unsigned)v;unsigned w=e<262144U?(e-65536U)/2U:32768U+(e-262144U)/8U;assert(w<=65535&&id_encode_word(w)==v);return w;}
int main(int argc,char **argv){unsigned n,ch,us=0,frames=0,completed=100;int32_t p[2]={0,0};int16_t c[2],rpm[2],feedback[2]={0,0};uint32_t age[2]={1,1};FILE *expected=0,*f;float v[107];
 assert(sizeof(id_blob)==70944);assert((id_crc(0xffffffffU,(const uint8_t*)"123456789",9)^0xffffffffU)==0xcbf43926U);
 if(argc==3){expected=fopen(argv[2],"wb");assert(expected);fprintf(expected,"n,phase,us,p0,p1,c0,c1,r0,r1,dt\n");}
 id_reset(&t);t.blob.header.build=68011;t.blob.header.method=11;t.blob.header.reserved[0]=168000000;t.blob.header.reserved[1]=1;t.blob.header.reserved[2]=2;t.blob.header.reserved[3]=1;t.blob.header.configured_right_sign=(uint32_t)-1;
 for(n=0;n<20000;n++){
  unsigned phase=n<4000?1:n<8000?2:n<10000?3:n<14000?4:5;
  unsigned dt=n%2?1001:999;uint64_t packed;unsigned fi=t.blob.header.fast_count;
  if(n==5000)dt=750;
  if(n==5001)dt=1250;
  us+=dt;for(ch=0;ch<2;ch++){c[ch]=(int16_t)((int)(n%2401)-1200);rpm[ch]=(int16_t)((int)(n%241)-120);p[ch]+=(int32_t)(n%3)-1;if((n==4400||n==11000)&&ch==0)p[ch]+=40;}
  assert(id_collect(&t,n,n+1,us,dt,p,c,rpm,feedback,c,age,3,(uint8_t)phase,1));
  if(expected)fprintf(expected,"%u,%u,%u,%d,%d,%d,%d,%d,%d,%u\n",n,phase,us,p[0],p[1],c[0],c[1],rpm[0],rpm[1],dt);
  if(phase==2||phase==4){packed=word(t.blob.fast[fi]);assert(unpack_signed((unsigned)packed&4095,12)==c[0]);assert(unpack_signed((unsigned)(packed>>12)&4095,12)==c[1]);assert(unpack_signed((unsigned)(packed>>36)&255,8)==rpm[0]);assert(unpack_signed((unsigned)(packed>>44)&255,8)==rpm[1]);}
 }
 if(expected)assert(fclose(expected)==0);
 id_seal(&t,1,20000,0,0);assert(t.ready&&!t.invalid&&t.blob.header.quality_flags==0&&t.blob.header.fast_count==8000&&t.blob.header.slow_count==300&&t.blob.header.reserved[4]==4&&t.blob.header.reserved[5]==4000&&t.blob.header.reserved[6]==100&&t.blob.header.reserved[7]==50&&t.blob.header.collected_steps==20000);
 for(n=0;n<65536;n++)assert(dec(id_encode_word(n))==n);
 do{
  for(n=0;n<107;n++)v[n]=(float)n;
  id_next(&t,v,completed++);
  for(n=0;n<107;n++){unsigned payload=0;for(ch=0;ch<48;ch++)if(n==id_payload_channels[ch])payload=1;if(!payload&&(n<88||n>93))assert(v[n]==(float)n);}
  if(v[89]==3){unsigned index=(unsigned)v[90];for(n=0;n<48;n++){unsigned w=dec(v[id_payload_channels[n]]),o=index*96+n*2;if(o<sizeof(got)){if(copies[index])assert(got[o]==(unsigned char)w);else got[o]=(unsigned char)w;}if(o+1<sizeof(got)){if(copies[index])assert(got[o+1]==(unsigned char)(w>>8));else got[o+1]=(unsigned char)(w>>8);}}copies[index]++;frames++;}
 }while(v[89]!=4);
 for(n=0;n<sizeof(copies)/sizeof(copies[0]);n++)assert(copies[n]==4);
 assert(memcmp(got,&t.blob,sizeof(got))==0);assert(t.cursor==0&&t.export_pass==1&&frames==2956);
 assert((id_crc(0xffffffffU,got,sizeof(got))^0xffffffffU)==t.crc);
 if(argc>=2){f=fopen(argv[1],"wb");assert(f&&fwrite(&t.blob,1,sizeof(t.blob),f)==sizeof(t.blob));assert(fclose(f)==0);}
 /* Full-range signed packing: one independent moving record per fixture. */
 for(n=0;n<100000;n++){
  int d=(int)(n%64)-32;unsigned dt=872+n%256;uint64_t w;id_reset(&t);t.previous_phase=1;
  p[0]=d;p[1]=-1-d;c[0]=(int16_t)((int)(n%2401)-1200);c[1]=(int16_t)-c[0];rpm[0]=(int16_t)((int)(n%256)-128);rpm[1]=(int16_t)(127-(int)(n%256));
  assert(id_collect(&t,0,1,dt,dt,p,c,rpm,feedback,c,age,n&3,2,1));w=word(t.blob.fast[0]);assert(!(w>>63));
  assert(unpack_signed((unsigned)(w>>24)&63,6)==p[0]);assert(unpack_signed((unsigned)(w>>30)&63,6)==p[1]);assert(1000+unpack_signed((unsigned)(w>>52)&255,8)==(int)dt);
 }
 /* Capture overflow is explicit; fault metadata/old replay gating retained. */
 id_reset(&t);t.previous_phase=1;p[0]=100;p[1]=100;c[0]=0;c[1]=0;rpm[0]=0;rpm[1]=0;
 for(n=0;n<64;n++){p[0]+=100;p[1]+=100;assert(id_collect(&t,n,n+1,(n+1)*1000,1000,p,c,rpm,feedback,c,age,3,2,1));}
 p[0]+=100;p[1]+=100;assert(!id_collect(&t,64,65,65000,1000,p,c,rpm,feedback,c,age,3,2,1)&&t.invalid);
 id_seal(&t,0,65,512,65);assert((t.blob.header.quality_flags&7)==7);
 assert(!id_allow_output(5,0,9000,63,64,1));assert(id_allow_output(6,0,0,0,0,1));assert(!id_allow_output(9,512,4999,63,64,1));assert(!id_allow_output(9,512,5000,62,64,1));assert(id_allow_output(9,512,5000,63,64,1));
 id_reset(&t);t.ready=1;t.crc_offset=sizeof(t.blob);id_next(&t,v,100);for(n=0;n<100;n++){id_next(&t,v,100);assert(!t.cursor&&!t.repeat&&!t.export_pass);}
 printf("PASS ABI/blob%u/trace%u full20000intervals moving8000 hold300 exception4 packing100000 words65536 chunks2956 guards preserved; no hardware\n",(unsigned)sizeof(id_blob),(unsigned)sizeof(id_trace));return 0;
}
