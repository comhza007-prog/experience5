#define e5_reset e5_reset_growth_reference_unused
#define e5_step e5_step_growth_reference_unused
#include "blnn_core.c"
int legacy_growth(e5_network *net,const e5_real x[5],e5_real *novelty){return grow(net,x,novelty);}
