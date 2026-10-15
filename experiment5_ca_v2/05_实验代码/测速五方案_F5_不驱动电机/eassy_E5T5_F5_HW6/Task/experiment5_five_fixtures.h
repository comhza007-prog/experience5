#ifndef E5_FIVE_FIXTURES_H
#define E5_FIVE_FIXTURES_H
#include "experiment5_learning_fixtures.h"
#include "experiment5_formal_metrics.h"
#define E5_FIVE_CASES 3000U
#define E5_FIVE_CYCLES 30000U
typedef int (*e5_five_step_fn)(e5_state *,const e5_input *,e5_output *);
int e5_step_f_s0(e5_state *,const e5_input *,e5_output *);
int e5_step_f_s1(e5_state *,const e5_input *,e5_output *);
int e5_step_f_s2(e5_state *,const e5_input *,e5_output *);
int e5_step_f_ref_s0(e5_state *,const e5_input *,e5_output *);
int e5_step_f_ref_s1(e5_state *,const e5_input *,e5_output *);
int e5_step_f_ref_s2(e5_state *,const e5_input *,e5_output *);
int e5_step_f_ref_s3(e5_state *,const e5_input *,e5_output *);
static const uint32_t e5_five_method[5]={11,12,12,12,12};
static const uint32_t e5_five_learning[5]={0,0,1,0,1};
static const uint32_t e5_five_search[5]={0,0,0,1,1};
/* Core method is state-driven. BLNN/S0 share the same0/0 kernel, but
 * use distinct state.method11/12, fixtures and counters. */
static const e5_five_step_fn e5_five_optimized[5]={
    e5_step_f_s0,e5_step_f_s0,e5_step_f_s1,e5_step_f_s2,e5_step};
static const e5_five_step_fn e5_five_reference[5]={
    e5_step_f_ref_s0,e5_step_f_ref_s0,e5_step_f_ref_s1,e5_step_f_ref_s2,e5_step_f_ref_s3};
static void e5_five_prepare(e5_learning_fixture *f,uint32_t variant,uint32_t index) {
    e5_learning_prepare(f,index);
    f->state.method=e5_five_method[variant]; /* Synthetic fixture ONLY. */
}
static int e5_five_rule_ok(uint32_t variant,const e5_output *o) {
    if(e5_five_method[variant]==E5_BLNN)
        return e5_formal_effective_learning(E5_BLNN,o)==1 &&
               e5_formal_cause(E5_BLNN,o)==-1 && e5_formal_rho(E5_BLNN,o)==-1;
    if(e5_five_learning[variant])return e5_learning_rule_ok(o);
    return o->learning_gate==(o->ca_mask?0:o->learning_before_reason);
}
#endif
