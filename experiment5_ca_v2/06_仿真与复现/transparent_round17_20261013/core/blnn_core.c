#include "blnn_core.h"
#include "experiment5_hw_profile.h"
#include "experiment5_ca_actuator.h"
#include <math.h>
#include <string.h>
#include <float.h>
#ifdef E5_USE_DOUBLE
#define R(x) ((e5_real)(x))
#define EXP exp
#define SQRT sqrt
#define TANH tanh
#define COS cos
#define SIN sin
#define ABS fabs
#define REAL_MAX DBL_MAX
#else
#define R(x) ((e5_real)(x))
#define EXP expf
#define SQRT sqrtf
#define TANH tanhf
#define COS cosf
#define SIN sinf
#define ABS fabsf
#define REAL_MAX FLT_MAX
#endif
static e5_real clip(e5_real x,e5_real lo,e5_real hi) { return x<lo?lo:(x>hi?hi:x); }
static int finite_value(e5_real x) { return x==x && x<=REAL_MAX && x>=-REAL_MAX; }
static void force_to_current(const e5_real f[2],e5_real i[2]) {
    const e5_real k=R(0.006197916666666667), le=R(.60);
    i[0]=f[0]/(2*k)-f[1]/(le*k);
    i[1]=-f[0]/(2*k)-f[1]/(le*k);
}
/* Timing-only optimization: retain the exact five-term distance order.
 * Return that same distance for the later growth pass; no NN-law change. */
static e5_real features(const e5_real c[5],const e5_real x[5],e5_real f[3]) {
    uint32_t j; e5_real d=0,t;
    for(j=0;j<5;j++){t=c[j]-x[j];d+=t*t;}
    f[0]=EXP(-d);f[1]=COS(f[0]);f[2]=SIN(f[0]);
    return d;
}
static e5_real prediction(const e5_network *n,const e5_real x[5],uint32_t channel,e5_real cached[E5_MAX_NODES][3],e5_real distances[E5_MAX_NODES]) {
    uint32_t j; e5_real *f,sum[3]={0,0,0};
    for(j=0;j<n->count;j++) {
        f=cached[j];
        distances[j]=features(n->center[j],x,f);
        sum[0]+=n->weight[j][0]*f[0];sum[1]+=n->weight[j][1]*f[1];sum[2]+=n->weight[j][2]*f[2];
    }
    return clip(sum[0]+sum[1]+sum[2],channel?R(-10):R(-80),channel?R(10):R(80));
}
static int grow(e5_network *n,const e5_real x[5],const e5_real distances[E5_MAX_NODES],e5_real *novelty) {
    uint32_t i,j,indices[3]={0,0,0};
    e5_real best[3]={R(REAL_MAX),R(REAL_MAX),R(REAL_MAX)},d,t,average[5]={0,0,0,0,0};
    for(i=0;i<n->count;i++) {
        d=distances[i];
        /* Same strict comparisons and stable tie order as the old loops.
         * Centers/input are unchanged between prediction and this pass. */
        if(d<best[0]) {
            best[2]=best[1];indices[2]=indices[1];
            best[1]=best[0];indices[1]=indices[0];best[0]=d;indices[0]=i;
        } else if(d<best[1]) {
            best[2]=best[1];indices[2]=indices[1];best[1]=d;indices[1]=i;
        } else if(d<best[2]) {best[2]=d;indices[2]=i;}
    }
    d=0;
    for(j=0;j<5;j++) {
        average[j]=(n->center[indices[0]][j]+n->center[indices[1]][j]+n->center[indices[2]][j])/R(3);
        t=x[j]-average[j];d+=t*t;
    }
    *novelty=SQRT(d);
    if(*novelty<=R(.3)) return 0;
    for(j=0;j<5;j++) n->center[n->count][j]=average[j]+R(.7)*(x[j]-average[j]);
    for(j=0;j<3;j++) n->weight[n->count][j]=0;
    n->count++; return 1;
}
int e5_reset(e5_state *s,uint32_t method,uint32_t initial_nodes) {
    uint32_t ch,n,j;const e5_real base[5]={-1,R(-.5),0,R(.5),1};
    if(!s) return 0;
    memset(s,0,sizeof(*s));
    if((method!=E5_BASE && method!=E5_BLNN && method!=E5_CA_BLNN) || initial_nodes<4 || initial_nodes>60) {
        s->fault=1;return 0;
    }
    s->method=method;s->k2[0]=R(E5_HW_K2_Y_MIN);s->k2[1]=R(E5_HW_K2_ALPHA_MIN);s->gate=1;
    s->fixed_nodes=initial_nodes==60;
    for(ch=0;ch<2;ch++) {
        s->net[ch].count=method==E5_BASE?0:initial_nodes;
        for(n=0;n<s->net[ch].count;n++) for(j=0;j<5;j++) s->net[ch].center[n][j]=base[(j+5-n%5)%5];
    }
    return 1;
}
#ifndef T17_ALLOCATION
#define T17_ALLOCATION 1
#endif
#ifndef T17_LEARNING
#define T17_LEARNING 1
#endif
/* HOST ONLY: old NN300/rate2/separate-sector software restrictions are NOT
 * silently inherited. This hypothesis keeps physical count limits and the
 * qualified speed/brake envelope; it is NOT released board firmware. */
static int common_actuation(const e5_state *s,const e5_input *in,e5_output *out,
    const e5_real limits[2],uint32_t flags) {
    e5_real allocation[2],sum,lo,hi,desired[2],actual[2],k=R(.006197916666666667);
    uint32_t ch,hard=0;int16_t cmd,guarded_base;
    for(ch=0;ch<2;ch++) {
        if(!finite_value(out->requested[ch]))return 0;
        allocation[ch]=out->requested[ch];
        out->clip_reference[ch]=clip(out->requested[ch],-limits[ch],limits[ch]);
        if(out->clip_reference[ch]!=out->requested[ch])hard=1;
    }
    if(hard)out->intervention_mask|=1U;
    /* Reuse the old SyncAlloc principle ONLY at true amplitude clipping:
     * preserve the feasible synchronization current sum, then project
     * translation into remaining authority. Current sum corresponds to
     * synchronization because the right motor's drive sign is reversed.
     * This property is BEFORE the common speed guard and quantization,
     * not a promise of final modal force under braking or closed-loop gain. */
    if(s->method==E5_CA_BLNN && (flags&1U) && hard) {
        sum=clip(allocation[0]+allocation[1],-limits[0]-limits[1],limits[0]+limits[1]);
        lo=sum-limits[1];if(lo<-limits[0])lo=-limits[0];
        hi=sum+limits[1];if(hi>limits[0])hi=limits[0];
        allocation[0]=clip(allocation[0],lo,hi);allocation[1]=sum-allocation[0];
        out->intervention_mask|=4U;
    }
    for(ch=0;ch<2;ch++) {
        if(!e5_motion_quantize((float)clip(allocation[ch],-limits[ch],limits[ch]),&cmd))return 0;
        out->pre_guard_command[ch]=cmd;
        if(e5_motion_speed_guard(in->raw_rpm[ch],&cmd)) {
            out->ca_speed_mask|=1U<<ch;out->intervention_mask|=2U;
        }
        if(!e5_motion_quantize((float)clip(out->ca_base[ch],-limits[ch],limits[ch]),&guarded_base))return 0;
        /* Diagnostic COPY only, not a second guard on the command. */
        (void)e5_motion_speed_guard(in->raw_rpm[ch],&guarded_base);
        out->ca_guarded_base[ch]=guarded_base;out->ca_delta[ch]=(e5_real)(cmd-guarded_base);
        out->current[ch]=cmd;out->learning_axis[ch]=s->method==E5_BASE?0:1;
        if(!e5_ca_envelope_ok(in->raw_rpm[ch],cmd,(int32_t)limits[ch]))return 0;
    }
    desired[0]=-out->gate*out->dhat[0];desired[1]=-out->gate*out->dhat[1];
    actual[0]=k*(out->ca_delta[0]-out->ca_delta[1]);
    actual[1]=R(-.3)*k*(out->ca_delta[0]+out->ca_delta[1]);
    for(ch=0;ch<2;ch++) {
        out->modal_deficit[ch]=desired[ch]-actual[ch];
        /* NN gradient makes the future REQUEST move in direction -sigma.
         * Suppress only its outward component at actual physical clipping
         * or speed intervention. Inward unwinding and ordinary unconstrained
         * updates continue. Quantization alone must not freeze learning.
         * This local rule is a hypothesis, not a stability proof. */
        if(s->method==E5_CA_BLNN && (flags&2U) && (out->intervention_mask&3U) &&
           ABS(out->modal_deficit[ch])>2*(ch?R(.3)*k:k) &&
           out->modal_deficit[ch]*out->sigma[ch]<0)
            out->learning_axis[ch]=0;
    }
    out->learning_before_reason=s->method==E5_BASE?0:1;
    out->learning_gate=out->learning_axis[0]<out->learning_axis[1]?out->learning_axis[0]:out->learning_axis[1];
    out->finalized=1U;return 1;
}
int e5_step_with_flags(e5_state *s,const e5_input *in,e5_output *out,uint32_t flags) {
    const e5_real mass[2]={R(11.528),R(.34584)},damp[2]={R(57.4),R(20.5)},stiff[2]={0,R(E5_HW_SYNC_STIFFNESS_FF)};
    const e5_real gamma[2]={25,18},k1[2]={40,25},phi[2]={R(.025),R(.012)};
    const e5_real scales[2][5]={{2,R(.7),1,R(.08),R(.7)},{1,R(.20),R(.020),R(.010),R(.20)}};
    const e5_real k=R(.006197916666666667),dt=R(.001);
    e5_real chi[2][5],base[2],bi[2],correction[2],neg[2],limits[2],e,ed,ref,refv,refa;
    e5_real distances[2][E5_MAX_NODES]; /* Local scratch; state ABI unchanged. */
    e5_real safe=1,headroom=1,learn,gate,d,rising,raw[3],*f,norm,w,wp;
    uint32_t ch,n,j,hit,preview_nodes[2];
    if(!s||!in||!out) return 0;
    memset(out,0,sizeof(*out));
    if(s->fault) return 0;
    for(ch=0;ch<2;ch++) {
        if(!finite_value(in->q[ch])||!finite_value(in->velocity[ch])||!finite_value(in->acceleration[ch])||
           !finite_value(in->limit[ch])||in->limit[ch]<E5_HW_BRAKE_LIMIT||in->limit[ch]>E5_MOTION_LIMIT) goto invalid;
    }
    for(j=0;j<3;j++) if(!finite_value(in->reference[j])) goto invalid;
    for(ch=0;ch<2;ch++) {
        ref=ch?0:in->reference[0];refv=ch?0:in->reference[1];refa=ch?0:in->reference[2];
        e=in->q[ch]-ref;ed=in->velocity[ch]-refv;out->sigma[ch]=ed+gamma[ch]*e;
        base[ch]=damp[ch]*in->velocity[ch]+stiff[ch]*in->q[ch]+(ch?0:R(E5_HW_COULOMB_FF)*TANH(in->velocity[ch]/R(.01)))+
          mass[ch]*refa-k1[ch]*out->sigma[ch]-s->k2[ch]*TANH(out->sigma[ch]/phi[ch])-mass[ch]*gamma[ch]*ed;
        chi[ch][0]=in->acceleration[ch];chi[ch][1]=in->velocity[ch];chi[ch][2]=in->q[ch];chi[ch][3]=e;chi[ch][4]=ed;
        for(j=0;j<5;j++) chi[ch][j]=clip(chi[ch][j]/scales[ch][j],-2,2);
        limits[ch]=clip(in->limit[ch],0,16000);
        preview_nodes[ch]=s->net[ch].count;
        out->dhat[ch]=prediction(&s->net[ch],chi[ch],ch,s->features[ch],distances[ch]);out->sector[ch]=1;
        /* Common predictor: no CA-specific scalar attenuation here. */
        neg[ch]=-out->sector[ch]*out->dhat[ch];
    }
    base[0]+=k*(s->aw[0]-s->aw[1]);base[1]+=R(-.3)*k*(s->aw[0]+s->aw[1]);
    force_to_current(base,bi);force_to_current(neg,correction);
    for(ch=0;ch<2;ch++) {
        /* Diagnostic raw BASE reference for all methods; no control change. */
        out->ca_base[ch]=bi[ch];
        if(!finite_value(bi[ch])||!finite_value(correction[ch])) goto invalid;
        d=(limits[ch]-ABS(bi[ch]))/limits[ch];if(d<headroom) headroom=d;
    }
    safe=clip(safe,0,1);rising=s->gate+dt/(R(.030)+dt)*(safe-s->gate);gate=safe<rising?safe:rising;
    learn=clip(headroom/R(.15),0,1);if(learn>gate) learn=gate;
    /* Exact ordinary arithmetic, BEFORE changing any network weights. */
    for(ch=0;ch<2;ch++)raw[ch]=base[ch]-gate*out->sector[ch]*out->dhat[ch];
    force_to_current(raw,out->requested);
    s->gate=gate;out->gate=gate;out->learning_gate=learn;s->step++;
    if(!common_actuation(s,in,out,limits,flags))goto invalid;
    for(ch=0;ch<2;ch++) {
        e5_network *net=&s->net[ch];
        e5_real learning=out->learning_axis[ch];
        if(net->count && !s->fixed_nodes && s->step%20==0 && learning>=R(.5) && net->count<60)
            s->growth+=(uint32_t)grow(net,chi[ch],distances[ch],&out->novelty[ch]);
        norm=0;hit=0;
        for(n=0;n<net->count;n++) {
            f=s->features[ch][n];
            /* Only a newly appended zero-weight node needs new features.
             * Existing features and pre-update output are exactly reusable. */
            if(n>=preview_nodes[ch]) features(net->center[n],chi[ch],f);
            for(j=0;j<3;j++) {
                w=net->weight[n][j]+dt*(ch?18:25)*(learning*out->sigma[ch]*f[j]-R(.01)*net->weight[n][j]);
                wp=clip(w,ch?-15:-30,ch?15:30);if(wp!=w) hit=1;
                net->weight[n][j]=wp;norm+=wp*wp;
            }
        }
        net->projections+=hit;out->norm[ch]=SQRT(norm);
        /* Appending zero-weight nodes cannot change the same-step output. */
    }
    for(ch=0;ch<2;ch++) {
        /* Preserve legacy TWO-stage arithmetic exactly: core clip residual,
         * then its ONE external quantization/speed/allocation residual.
         * No software-NN rejection is charged to BASE; this is the true
         * full-controller request/final-command residual. Host outer helper
         * returns final current, so the old outer correction is then ZERO. */
        s->aw[ch]+=dt*(16*(out->clip_reference[ch]-out->requested[ch])-20*s->aw[ch]);
        s->aw[ch]+=R(.016)*(out->current[ch]-out->clip_reference[ch]);
        s->k2[ch]=clip(s->k2[ch]+dt*(ch?2:5)*(ABS(out->sigma[ch])-s->k2[ch]),
            ch?R(E5_HW_K2_ALPHA_MIN):R(E5_HW_K2_Y_MIN),ch?10:24);
        if(!finite_value(out->requested[ch])||!finite_value(s->aw[ch])||!finite_value(out->norm[ch])||!finite_value(s->k2[ch])) goto invalid;
    }
    return 1;
invalid:
    s->fault=1;memset(out,0,sizeof(*out));return 0;
}
int e5_step(e5_state *s,const e5_input *in,e5_output *out) {
    return e5_step_with_flags(s,in,out,(T17_ALLOCATION?1U:0U)|(T17_LEARNING?2U:0U));
}
