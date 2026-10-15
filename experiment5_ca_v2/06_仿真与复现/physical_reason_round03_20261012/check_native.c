#include <stdio.h>
#include "experiment5_ca_actuator.h"

/* Independent check using the unchanged archived firmware's own functions.
 * CSV sigma is decimal-rounded, so sector flags may differ near boundaries;
 * robust interval classifications are checked separately in JS. */
int main(void) {
    int rl,rr,wl,wr,bl,br,dl,dr,ll,lr;
    double sy,sa;
    while(scanf("%d%d%d%d%d%d%d%d%d%d%lf%lf",
          &rl,&rr,&wl,&wr,&bl,&br,&dl,&dr,&ll,&lr,&sy,&sa)==12) {
        int16_t left=(int16_t)wl,right=(int16_t)wr;
        e5_real sigma[2]={(e5_real)sy,(e5_real)sa};
        unsigned sl=e5_motion_speed_guard((int16_t)rl,&left);
        unsigned sr=e5_motion_speed_guard((int16_t)rr,&right);
        printf("%d %d %u %u %d %d %d %d\n",(int)left-bl,(int)right-br,sl,sr,
            e5_ca_sector_ok(sigma,(int)left-bl,(int)right-br),
            e5_ca_envelope_ok((int16_t)rl,(int)left,ll),
            e5_ca_envelope_ok((int16_t)rr,(int)right,lr),
            e5_ca_sector_ok(sigma,dl,dr));
    }
    return ferror(stdin)?1:0;
}
