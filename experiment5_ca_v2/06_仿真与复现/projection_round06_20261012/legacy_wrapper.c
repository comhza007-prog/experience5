#include "blnn_core.h"
#include "test_export.h"
static e5_state legacy;
int legacy_init(unsigned method){return e5_reset(&legacy,method,4);}
int legacy_run(const e5_input *in,double *v,unsigned *len){e5_output o;int ok=e5_step(&legacy,in,&o);*len=export_values(&legacy,&o,v);return ok;}
