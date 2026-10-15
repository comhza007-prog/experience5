#include <assert.h>
#include <math.h>
#include <stdio.h>
#include "experiment5_motion.h"
int main(void){
 float ref[3];unsigned n;float low=E5_TRAVEL_MIN_M,high=E5_TRAVEL_MAX_M;
 assert(low==-.022f&&high==.022f);
 assert(!e5_motion_travel_fault(low)&&!e5_motion_travel_fault(high));
 assert(!e5_motion_travel_fault(nextafterf(low,0))&&!e5_motion_travel_fault(nextafterf(high,0)));
 assert(e5_motion_travel_fault(nextafterf(low,-INFINITY))&&e5_motion_travel_fault(nextafterf(high,INFINITY)));
 assert(!e5_motion_travel_fault(-.020f)&&!e5_motion_travel_fault(.020f));
 for(n=0;n<=28000;n++){
  unsigned phase=e5_motion_reference(n,ref);assert(phase>=1&&phase<=6);
  assert(ref[0]>=-1e-7f&&ref[0]<=.0200001f&&!e5_motion_travel_fault(ref[0]));
 }
 assert(e5_motion_reference(12000,ref)==3&&ref[0]==.020f);
 assert(e5_motion_reference(28000,ref)==6&&ref[0]==0);
 puts("PASS realheader travel[-22,+22]mm exact/nextfloat boundaries and28001trajectory samples;20mm positive stroke/return unchanged, NOT +/-20mm commanded motion.");
 return 0;
}
