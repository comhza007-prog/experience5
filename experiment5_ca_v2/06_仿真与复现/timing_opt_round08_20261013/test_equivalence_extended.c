#include <assert.h>
#include <math.h>
#include <stdio.h>
#include <string.h>
#include "blnn_core.c"
#include "experiment5_timing_fixtures.h"
int legacy_snapshot(const e5_state *,const e5_input *,e5_state *,e5_output *);
int legacy_growth(e5_network *,const e5_real[5],e5_real *);
int e5_step_reference(e5_state *,const e5_input *,e5_output *);
static e5_state before,old,next,ref;
static e5_output old_out,new_out,ref_out;
static e5_bench_fixture fixture;
static unsigned seed=20261013U;
static unsigned rnd(void){seed=1664525U*seed+1013904223U;return seed;}
static e5_real random_real(void){return (e5_real)((int)(rnd()&65535U)-32768)/(e5_real)32768;}
static e5_network net_old,net_new;
int main(void){
    e5_input in;unsigned n,ch,j,node,method,total=0,paired=0,grows=0;
    e5_real x[5],distances[E5_MAX_NODES],f[3],novel_old,novel_new;
    for(method=E5_BASE;method<=E5_CA_BLNN;method++)for(n=0;n<12000U;n++){
        unsigned nodes=n%3U==0?4U:(n%3U==1?59U:60U);
        assert(e5_reset(&before,method,nodes));memset(&in,0,sizeof(in));
        before.step=n%2U?19U:n;
        for(ch=0;ch<2;ch++){
            for(node=0;node<before.net[ch].count;node++){
                for(j=0;j<5;j++)before.net[ch].center[node][j]=random_real()*2;
                for(j=0;j<3;j++)before.net[ch].weight[node][j]=random_real()*.05f;
            }
            in.q[ch]=random_real()*.001f;in.velocity[ch]=random_real()*.002f;
            in.acceleration[ch]=random_real()*2;in.limit[ch]=ch?800:1200;
            in.raw_rpm[ch]=(int16_t)((int)(rnd()%101U)-50);
        }
        in.reference[0]=random_real()*.001f;
        next=before;
        assert(legacy_snapshot(&before,&in,&old,&old_out));assert(e5_step(&next,&in,&new_out));
        assert(memcmp(&old,&next,sizeof(old))==0);assert(memcmp(&old_out,&new_out,sizeof(old_out))==0);total++;
    }
    /* Direct stable-tie/novelty/growth checks, including unique centers.
     * Distance arithmetic order is exactly the original five-term loop. */
    for(n=0;n<40000U;n++){
        memset(&net_old,0,sizeof(net_old));net_old.count=4U+rnd()%56U;
        for(node=0;node<net_old.count;node++)for(j=0;j<5;j++){
            net_old.center[node][j]=n%4U?random_real()*2:(e5_real)(node%3U)*.125f;
        }
        for(j=0;j<5;j++)x[j]=n%4U?random_real()*2:(e5_real).3;
        net_new=net_old;
        for(node=0;node<net_new.count;node++)distances[node]=features(net_new.center[node],x,f);
        assert(legacy_growth(&net_old,x,&novel_old)==grow(&net_new,x,distances,&novel_new));
        assert(memcmp(&net_old,&net_new,sizeof(net_old))==0);assert(memcmp(&novel_old,&novel_new,sizeof(novel_old))==0);grows++;
    }
    for(n=2U*E5_BENCH_BLOCK;n<E5_BENCH_TOTAL;n++){
        e5_bench_prepare(&fixture,n);ref=fixture.state;
        assert(e5_step_reference(&ref,&fixture.input,&ref_out));
        assert(e5_step(&fixture.state,&fixture.input,&fixture.output));
        assert(memcmp(&ref,&fixture.state,sizeof(ref))==0);assert(memcmp(&ref_out,&fixture.output,sizeof(ref_out))==0);paired++;
    }
    printf("PASS exact-bit states/outputs: %u unique-center snapshots, %u stable-tie/growth cases, %u scheduled paired reference checks.\n",total,grows,paired);
    return 0;
}
