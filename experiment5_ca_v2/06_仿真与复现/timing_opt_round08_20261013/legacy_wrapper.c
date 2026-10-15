#include "blnn_core.h"
#include "test_export.h"
int e5_reset_legacy(e5_state *,uint32_t,uint32_t);
int e5_step_legacy(e5_state *,const e5_input *,e5_output *);
static e5_state legacy;
int legacy_init(unsigned method){return e5_reset_legacy(&legacy,method,4);}
int legacy_run(const e5_input *in,double *v,unsigned *len){e5_output o;int ok=e5_step_legacy(&legacy,in,&o);*len=export_values(&legacy,&o,v);return ok;}
int legacy_snapshot(const e5_state *s,const e5_input *in,e5_state *next,e5_output *out){*next=*s;return e5_step_legacy(next,in,out);}
