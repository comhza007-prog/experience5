#undef E5_SYNC_PRIORITY_PROJECTION
#define E5_SYNC_PRIORITY_PROJECTION 0
#include "experiment5_ca_actuator.h"
int r2_allocate(const e5_real bi[2],const e5_real correction[2],const e5_real sigma[2],const e5_real limits[2],const int16_t rpm[2],const int16_t previous[2],e5_ca_actuation *a) {
    return e5_ca_allocate(bi,correction,sigma,limits,rpm,previous,a);
}
