#include <assert.h>
#include <stdio.h>
#include "experiment5_timing_fixtures.h"
static e5_bench_fixture f;
int main(void) {
    unsigned n,regressions=0,core_steps=0,growth=0,ch;
    for(n=0;n<E5_BENCH_TOTAL;n++) {
        e5_bench_prepare(&f,n);
        if(n<E5_BENCH_BLOCK) {
            assert(e5_ca_allocate(f.bi,f.correction,f.sigma,f.limits,f.rpm,f.previous,&f.allocation));
            for(ch=0;ch<2;ch++)assert(e5_ca_envelope_ok(f.rpm[ch],f.allocation.command[ch],f.lim[ch]));
            assert(e5_ca_sector_ok(f.sigma,f.allocation.delta[0],f.allocation.delta[1]));
            if(f.regression) {assert(f.allocation.delta[0]==23&&f.allocation.delta[1]==-23);regressions++;}
        } else if(n<2U*E5_BENCH_BLOCK) {
            (void)e5_ca_contract_ray(f.sigma,f.rpm,f.lim,f.previous,f.target,&f.old_ray);
            (void)e5_ca_contract(f.sigma,f.rpm,f.lim,f.previous,f.target,&f.balanced);
            if(f.regression) {assert(f.old_ray.delta[0]==2&&f.old_ray.delta[1]==-2);assert(f.balanced.delta[0]==23&&f.balanced.delta[1]==-23);regressions++;}
        } else {
            assert(e5_step(&f.state,&f.input,&f.output));core_steps++;
            if(f.nodes==59U) {assert(f.state.growth==2U);growth++;}
        }
    }
    assert(regressions==1500U&&core_steps==6000U&&growth==2000U);
    printf("PASS 18000 timing fixtures: 1500 critical-event checks, 6000 core steps (4/59/60 nodes), 2000 two-axis growth checks.\n");
    return 0;
}
