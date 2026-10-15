#ifndef E5_TIMING_FIXTURES_H
#define E5_TIMING_FIXTURES_H
#include "experiment5_ca_actuator.h"
#include <string.h>
/* Synthetic finite CPU coverage, NOT exhaustive WCET or physical feedback. */
#define E5_BENCH_TOTAL 18000U
#define E5_BENCH_BLOCK 6000U
typedef struct {
    e5_real bi[2],correction[2],sigma[2],limits[2];
    int16_t rpm[2],previous[2];int32_t lim[2],target[2];
    e5_ca_actuation old_ray,balanced,allocation;
    e5_state state;e5_input input;e5_output output;
    uint32_t nodes,regression;
} e5_bench_fixture;
static void e5_bench_prepare(e5_bench_fixture *f,uint32_t n) {
    uint32_t j,ch,node;
    memset(&f->old_ray,0,sizeof(f->old_ray));memset(&f->allocation,0,sizeof(f->allocation));
    f->regression=n%8U==0U;
    for(ch=0;ch<2;ch++) {
        int32_t sign=ch?-1:1;
        f->lim[ch]=ch&&(n%2U)?800:1200;f->limits[ch]=(e5_real)f->lim[ch];
        f->bi[ch]=(e5_real)(sign*(int32_t)(n%601U))+(e5_real)(sign*.25f);
        f->correction[ch]=(e5_real)(sign*(int32_t)(n%301U));
        f->previous[ch]=(int16_t)(sign*(int32_t)((n*7U+19U)%301U));
        f->target[ch]=(int32_t)f->correction[ch];
        f->sigma[ch]=ch?(e5_real)((int32_t)(n%11U)-5)*.00001f:(e5_real)((int32_t)(n%101U)-50)*.0001f;
        f->rpm[ch]=(int16_t)(sign*(int32_t)(n%51U));
        f->old_ray.base[ch]=(int16_t)f->bi[ch];
        if(e5_motion_speed_guard(f->rpm[ch],&f->old_ray.base[ch]))f->old_ray.speed_mask|=1U<<ch;
    }
    if(f->regression) {
        f->bi[0]=242.25f;f->bi[1]=-244.25f;f->correction[0]=26;f->correction[1]=-25;
        f->sigma[0]=-.005593f;f->sigma[1]=-.000018f;
        f->rpm[0]=0;f->rpm[1]=0;f->previous[0]=28;f->previous[1]=-23;
        f->lim[0]=1200;f->lim[1]=1200;f->limits[0]=1200;f->limits[1]=1200;
        f->target[0]=26;f->target[1]=-25;
        f->old_ray.base[0]=242;f->old_ray.base[1]=-244;f->old_ray.speed_mask=0;
    }
    f->balanced=f->old_ray;
    if(n<2U*E5_BENCH_BLOCK)return;
    f->nodes=n%3U==0U?4U:(n%3U==1U?59U:60U);
    (void)e5_reset(&f->state,E5_CA_BLNN,f->nodes);
    memset(&f->input,0,sizeof(f->input));f->input.limit[0]=1200;f->input.limit[1]=(n%2U)?800:1200;
    f->state.step=19U;
    for(ch=0;ch<2;ch++) {
        f->input.q[ch]=(e5_real)((int32_t)(n%21U)-10)*.00002f;
        f->input.velocity[ch]=(e5_real)((int32_t)(n%11U)-5)*.0001f;
        f->input.acceleration[ch]=(e5_real)((int32_t)(n%7U)-3)*.01f;
        f->input.raw_rpm[ch]=(int16_t)((int32_t)(n%81U)-40);
        for(node=0;node<f->nodes;node++)for(j=0;j<3;j++)
            f->state.net[ch].weight[node][j]=((node+j+ch)%2U)?-.003f:.005f;
    }
    f->input.reference[0]=(e5_real)(n%11U)*.00005f;
    if(f->nodes==59U) {
        /* Near-capacity two-axis novelty/growth with feasible zero NN. */
        memset(&f->input,0,sizeof(f->input));f->input.limit[0]=1200;f->input.limit[1]=800;
        f->input.acceleration[0]=10;f->input.acceleration[1]=10;
        memset(f->state.net[0].weight,0,sizeof(f->state.net[0].weight));
        memset(f->state.net[1].weight,0,sizeof(f->state.net[1].weight));
    }
}
#endif
