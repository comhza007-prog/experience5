#include "blnn_core.h"
#include "test_export.h"
int e5_reset_legacy(e5_state *,uint32_t,uint32_t);
int e5_step_legacy(e5_state *,const e5_input *,e5_output *);
static e5_state legacy;
static e5_real clip_pre(e5_real x,e5_real a,e5_real b){return x<a?a:(x>b?b:x);}
int legacy_init(unsigned method){return e5_reset_legacy(&legacy,method,4);}
int legacy_run(const e5_input *in,double *v,unsigned *len){
    e5_output o;unsigned ch; e5_real headroom=1,limit,d,pre=0;
    int ok=e5_step_legacy(&legacy,in,&o);*len=export_values(&legacy,&o,v);
    if(legacy.method==E5_CA_BLNN){
        for(ch=0;ch<2;ch++){
            limit=clip_pre(in->limit[ch],0,16000);
            d=(limit-(o.ca_base[ch]<0?-o.ca_base[ch]:o.ca_base[ch]))/limit;
            if(d<headroom)headroom=d;
        }
        pre=clip_pre(headroom/(e5_real).15,0,1);if(pre>o.gate)pre=o.gate;
    }
    v[(*len)++]=o.diagnostic_reason;v[(*len)++]=o.admitted_fraction;v[(*len)++]=pre;
    return ok;
}
