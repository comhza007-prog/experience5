#include <assert.h>
#include <stdio.h>
#include "experiment5_five_fixtures.h"
static e5_learning_fixture fixture;static e5_state ref;static e5_output out;
int main(void) {
    unsigned v,i,pairs=0,partial=0,growth=0,mixed=0,old_rate=0,blnn=0;
    for(v=0;v<5;v++)for(i=0;i<E5_FIVE_CASES;i++) {
        e5_five_prepare(&fixture,v,i);ref=fixture.state;
        assert(e5_five_reference[v](&ref,&fixture.input,&out));
        assert(e5_five_optimized[v](&fixture.state,&fixture.input,&fixture.output));
        assert(memcmp(&ref,&fixture.state,sizeof(ref))==0);
        assert(memcmp(&out,&fixture.output,sizeof(out))==0);
        assert(e5_five_rule_ok(v,&fixture.output));
        if(fixture.nodes==59){assert(fixture.state.growth==2);growth++;}
        if(v==0)blnn++;
        else if(fixture.mode==3){assert(fixture.output.ca_mask&(16|32));assert(fixture.output.learning_gate==0);mixed++;}
        else if(fixture.nodes!=59) {
            assert(fixture.output.diagnostic_reason==DIAG_REASON_RATE_ONLY);
            if(e5_five_learning[v]){assert(fixture.output.learning_gate>0&&fixture.output.learning_gate<1);partial++;}
            else{assert(fixture.output.learning_gate==0);old_rate++;}
        }
        pairs++;
    }
    assert(pairs==15000&&partial==3000&&growth==3750&&mixed==3000&&old_rate==3000&&blnn==3000);
    printf("PASS five-method probe:15000 exact state/output pairs,3000 partial,3750 growth,3000 mixed freezes,3000 old rate freezes,3000 ordinary BLNN cases.\n");
    return 0;
}
