#ifndef E5_REPAIR_FIXTURES_H
#define E5_REPAIR_FIXTURES_H
#include "blnn_core.h"
#include "experiment5_ca_actuator.h"
#include <stddef.h>
#include <string.h>
#define E5_REPAIR_CASES 3000U
#define E5_REPAIR_CYCLES (E5_REPAIR_CASES*4U)
int e5_old_step(e5_state *,const e5_input *,e5_output *);
typedef struct {e5_state state;e5_input input;e5_output output;uint32_t nodes,mode;} e5_repair_fixture;
static void e5_repair_prepare(e5_repair_fixture *f,uint32_t method,uint32_t index) {
    uint32_t n,j,ch;e5_real sign=index&8U?(e5_real)-1:(e5_real)1;
    f->mode=index%8U;f->nodes=f->mode==0U?4U:(f->mode==1U?59U:60U);
    (void)e5_reset(&f->state,method,f->nodes);
    memset(&f->input,0,sizeof(f->input));f->input.limit[0]=f->input.limit[1]=1200;
    f->state.step=19;f->input.q[0]=sign*(e5_real).0001;
    for(n=0;n<f->nodes;n++)for(j=0;j<3;j++)
        f->state.net[0].weight[n][j]=sign*(f->nodes==4U?(e5_real).02:(e5_real).0015);
    if(f->mode==1U) {
        for(ch=0;ch<2;ch++)memset(f->state.net[ch].weight,0,sizeof(f->state.net[ch].weight));
        f->input.acceleration[0]=f->input.acceleration[1]=10;
    }
    if(f->mode==3U) {
        f->input.q[0]=(e5_real)-.005593/(e5_real)25;f->input.q[1]=(e5_real)-.000018/(e5_real)18;
        f->state.ca_delta[0]=28;f->state.ca_delta[1]=-23;
        for(n=0;n<f->nodes;n++)for(j=0;j<3;j++)f->state.net[0].weight[n][j]=(e5_real)-.005;
    }
    if(f->mode>=4U) {
        /* Wrong-direction requests; mode5 amplitude,mode6 braking. */
        f->input.q[1]=sign*(e5_real).0002;
        for(ch=0;ch<2;ch++)for(n=0;n<f->nodes;n++)for(j=0;j<3;j++)
            f->state.net[ch].weight[n][j]=-sign*(e5_real).005;
        if(f->mode==5U)f->input.velocity[0]=sign*(e5_real).2;
        if(f->mode==6U)f->input.raw_rpm[0]=f->input.raw_rpm[1]=40;
        if(f->mode==7U) {
            f->state.fixed_nodes=0;f->state.net[0].count=f->state.net[1].count=59;f->nodes=59;
            f->input.acceleration[0]=f->input.acceleration[1]=10;
        }
    }
}
static int e5_repair_pair_ok(const e5_state *old,const e5_output *a,const e5_state *now,const e5_output *b) {
    uint32_t ch;
    if(now->method==E5_BLNN)return !memcmp(old,now,sizeof(*now)) &&
        !memcmp(a,b,offsetof(e5_output,learning_axis)) && b->learning_axis[0]==1 &&
        b->learning_axis[1]==1 && !b->repair_mode[0] && !b->repair_mode[1];
    for(ch=0;ch<2;ch++) {
        if(a->current[ch]!=b->current[ch] || a->requested[ch]!=b->requested[ch] ||
           a->dhat[ch]!=b->dhat[ch] || a->ca_delta[ch]!=b->ca_delta[ch] ||
           old->aw[ch]!=now->aw[ch] || old->k2[ch]!=now->k2[ch])return 0;
        if(b->learning_axis[ch]<0||b->learning_axis[ch]>1||b->repair_mode[ch]>2)return 0;
        if(b->repair_mode[ch]) {
            if(b->ca_mask&(E5_CA_AMPLITUDE|E5_CA_SPEED) || b->diagnostic_reason&DIAG_REASON_HARD_CLIP ||
               b->repair_before[ch]*b->sigma[ch]>=0 || b->novelty[ch]!=0)return 0;
            if(b->repair_mode[ch]==1U) {
                if(b->learning_axis[ch]<=b->learning_gate || b->learning_axis[ch]>b->learning_before_reason)return 0;
                if(b->repair_before[ch]>0?(b->repair_after[ch]<0||b->repair_after[ch]>b->repair_before[ch]):
                    (b->repair_after[ch]>0||b->repair_after[ch]<b->repair_before[ch]))return 0;
            } else if(b->learning_axis[ch]!=0)return 0;
        } else if(b->learning_axis[ch]!=b->learning_gate || memcmp(&old->net[ch],&now->net[ch],sizeof(now->net[ch])))return 0;
    }
    return 1;
}
#endif
