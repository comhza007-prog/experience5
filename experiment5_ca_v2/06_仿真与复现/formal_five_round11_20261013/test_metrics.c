#include <assert.h>
#include <stdio.h>
#include <string.h>
#include "experiment5_formal_metrics.h"
int main(void) {
    e5_output out,saved;int16_t before[2]={120,-90};
    memset(&out,0,sizeof(out));out.learning_gate=0;out.learning_before_reason=(e5_real).7;
    out.diagnostic_reason=4;out.admitted_fraction=0;out.ca_before_guard[0]=10;out.ca_before_guard[1]=-12;
    saved=out;
    assert(e5_formal_effective_learning(E5_BLNN,&out)==1);
    assert(e5_formal_cause(E5_BLNN,&out)==-1&&e5_formal_rho(E5_BLNN,&out)==-1);
    assert(e5_formal_pre_learning(E5_BLNN,&out)==1);
    assert(e5_formal_pre_guard_wanted(E5_BLNN,&out,before,0)==120);
    assert(e5_formal_pre_guard_wanted(E5_BLNN,&out,before,1)==-90);
    assert(e5_formal_effective_learning(E5_CA_BLNN,&out)==0);
    assert(e5_formal_cause(E5_CA_BLNN,&out)==4&&e5_formal_rho(E5_CA_BLNN,&out)==0);
    assert(e5_formal_pre_learning(E5_CA_BLNN,&out)==out.learning_before_reason);
    assert(e5_formal_pre_guard_wanted(E5_CA_BLNN,&out,before,0)==10);
    assert(e5_formal_pre_guard_wanted(E5_CA_BLNN,&out,before,1)==-12);
    assert(e5_formal_effective_learning(E5_BASE,&out)==0);
    assert(memcmp(&out,&saved,sizeof(out))==0&&before[0]==120&&before[1]==-90);
    printf("PASS read-only method-aware actual-learning/cause/rho/pre-guard telemetry.\n");return 0;
}
