#ifndef E5_LEARNING_FIXTURES_H
#define E5_LEARNING_FIXTURES_H
#include "blnn_core.h"
#include "diagnostic_config.h"
#include <string.h>
#define E5_LEARN_CASES_PER_VARIANT 3000U
#define E5_LEARN_TOTAL_CYCLES 12000U
typedef struct {e5_state state;e5_input input;e5_output output;uint32_t nodes,mode;} e5_learning_fixture;
static void e5_learning_prepare(e5_learning_fixture *f,uint32_t index) {
    uint32_t ch,node,j;
    e5_real sign=(index/4U)%2U?(e5_real)-1:(e5_real)1;
    f->mode=index%4U;
    f->nodes=f->mode==0U?4U:(f->mode==1U?59U:60U);
    (void)e5_reset(&f->state,E5_CA_BLNN,f->nodes);
    memset(&f->input,0,sizeof(f->input));
    f->input.limit[0]=1200;f->input.limit[1]=index%2U?800:1200;
    f->state.step=19U;
    if(f->nodes==59U) {
        f->input.acceleration[0]=10;f->input.acceleration[1]=10;
    } else {
        /* Corrective translation, zero rotation: target remains sector/
         * amplitude/speed feasible, but normal2-count slew limits execution.
         * Must exercise positive PARTIAL learning, not just an enabled flag. */
        f->input.q[0]=sign*(e5_real).0001;
        for(node=0;node<f->nodes;node++)for(j=0;j<3;j++)
            f->state.net[0].weight[node][j]=sign*(f->nodes==4U?(e5_real).02:(e5_real).0015);
    }
    if(f->mode==3U) {
        /* Compound high-node exception: normal neighborhood has dl+dr>=1
         * while tiny negative rotational sigma requires near-nonpositive
         * sum. Forces contraction search, not the cheaper normal path.
         * S1 ray / S3 ray+balanced search must both freeze error learning. */
        f->input.q[0]=(e5_real)-.005593/(e5_real)25;
        f->input.q[1]=(e5_real)-.000018/(e5_real)18;
        f->state.ca_delta[0]=28;f->state.ca_delta[1]=-23;
        for(node=0;node<f->nodes;node++)for(j=0;j<3;j++)f->state.net[0].weight[node][j]=(e5_real)-.005;
    }
    /* Keep explicit per-axis initialized limits; no physical feedback input. */
    for(ch=0;ch<2;ch++)f->input.raw_rpm[ch]=0;
}
static int e5_learning_rule_ok(const e5_output *o) {
    if(o->learning_gate<0 || o->learning_gate>o->learning_before_reason ||
       o->learning_before_reason>1 || o->learning_before_reason<0 ||
       o->admitted_fraction<0 || o->admitted_fraction>1)return 0;
    if(o->diagnostic_reason==DIAG_REASON_RATE_ONLY)
        return o->ca_mask==2U && o->learning_gate==o->learning_before_reason*o->admitted_fraction;
    if(o->ca_mask || o->diagnostic_reason)return o->learning_gate==0;
    return o->learning_gate==o->learning_before_reason;
}
#endif
