#define e5_reset r2_reset
#define e5_step r2_step
#include "blnn_core.c"
int r2_allocate(const e5_real b[2],const e5_real c[2],const e5_real s[2],
 const e5_real l[2],const int16_t rpm[2],const int16_t p[2],e5_ca_actuation *a) {
 return e5_ca_allocate(b,c,s,l,rpm,p,a);
}
