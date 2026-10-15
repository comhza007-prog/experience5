#include <assert.h>
#include <stdio.h>
#include "experiment5_learning_fixtures.h"
int e5_step_s1(e5_state *,const e5_input *,e5_output *);
int e5_step_reference_s1(e5_state *,const e5_input *,e5_output *);
int e5_step_reference_s3(e5_state *,const e5_input *,e5_output *);
static e5_learning_fixture f;static e5_state ref;static e5_output o;
int main(void){
    unsigned variant,i,pairs=0,partial=0,growth=0,mixed=0;
    for(variant=0;variant<2;variant++)for(i=0;i<E5_LEARN_CASES_PER_VARIANT;i++){
        e5_learning_prepare(&f,i);ref=f.state;
        assert(variant?e5_step_reference_s3(&ref,&f.input,&o):e5_step_reference_s1(&ref,&f.input,&o));
        assert(variant?e5_step(&f.state,&f.input,&f.output):e5_step_s1(&f.state,&f.input,&f.output));
        assert(memcmp(&ref,&f.state,sizeof(ref))==0);assert(memcmp(&o,&f.output,sizeof(o))==0);
        assert(e5_learning_rule_ok(&f.output));
        if(f.nodes==59U){assert(f.state.growth==2U);growth++;}
        else if(f.mode==3U){assert(f.output.ca_mask&(16U|32U));assert(f.output.diagnostic_reason!=DIAG_REASON_RATE_ONLY&&f.output.learning_gate==0);mixed++;}
        else{assert(f.output.diagnostic_reason==DIAG_REASON_RATE_ONLY&&f.output.learning_gate>0&&f.output.learning_gate<1);partial++;}
        pairs++;
    }
    assert(pairs==6000U&&partial==3000U&&growth==1500U&&mixed==1500U);
    printf("PASS S1/S3 probe schedule: 6000 exact state/output pairs, 3000 positive partial-learning, 1500 double-axis growth, 1500 full60-node exceptional-search frozen-learning cases.\n");return 0;
}
