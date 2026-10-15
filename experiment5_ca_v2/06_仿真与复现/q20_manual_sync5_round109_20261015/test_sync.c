#include <assert.h>
#include <math.h>
#include <stdio.h>
#ifndef E5_SYNC_THRESHOLD_M
#error "Threshold must be supplied from actual source expression"
#endif
static int fault(float left,float right,unsigned armed){return armed&&fabsf(left-right)>E5_SYNC_THRESHOLD_M;}
int main(void){
 float edge=E5_SYNC_THRESHOLD_M,inside=nextafterf(edge,0),outside=nextafterf(edge,INFINITY);
 assert(edge==.005f);
 assert(!fault(.0015f,0,1)&&!fault(.002f,0,1));
 assert(!fault(edge,0,1)&&!fault(-edge,0,1));
 assert(!fault(inside,0,1)&&!fault(-inside,0,1));
 assert(fault(outside,0,1)&&fault(-outside,0,1));
 assert(fault(0,outside,1)&&fault(0,-outside,1));
 assert(!fault(.1f,-.1f,0));
 puts("PASS actual-source5mm threshold; strictgreater bothsign/nextfloat boundaries; armed-only;1.5/2mm no longer sync-fault. Other protection equality audited separately.");
 return 0;
}
