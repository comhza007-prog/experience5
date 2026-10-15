#include "blnn_core.h"
#include "experiment5_hw_profile.h"
#include "experiment5_ca_actuator.h"
#include "online_protocol.h"
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
static e5_real prediction(const e5_network *n,const e5_real x[5],uint32_t channel,e5_real cached[E5_MAX_NODES][3],e5_real distances[E5_MAX_NODES],e5_real *raw_prediction) {
    uint32_t j; e5_real *f,sum[3]={0,0,0};
    for(j=0;j<n->count;j++) {
        f=cached[j];
        distances[j]=features(n->center[j],x,f);
        sum[0]+=n->weight[j][0]*f[0];sum[1]+=n->weight[j][1]*f[1];sum[2]+=n->weight[j][2]*f[2];
    }
    *raw_prediction=sum[0]+sum[1]+sum[2];
    return clip(*raw_prediction,channel?R(-10):R(-80),channel?R(10):R(80));
}
/* Fixed-feature repair only, not a closed-loop stability claim. Candidate
 * weights are projected FIRST and the actual floating-point prediction is
 * checked BEFORE committing. Normal growth is disabled on repair cycles.
 * This cannot enlarge or reverse the raw wrong-direction request at this x.
 * No actuator/current/slew/sector/speed limit is changed by this routine. */
#if DIAG_BOUNDED_REPAIR
static int repair_update(e5_network *net,e5_real cached[E5_MAX_NODES][3],
    e5_real before,e5_real sigma,e5_real pre,e5_real nominal,uint32_t ch,
    e5_real *learning,e5_real *after,e5_real *norm,uint32_t *hit) {
    e5_real candidate[E5_MAX_NODES][3],sum[3]={0,0,0},p=0,g,den,w,wp;
    e5_real dtgamma=R(.001)*(ch?18:25),bound=ch?15:30;
    uint32_t n,j;
    if(!net->count || !finite_value(before) || !finite_value(sigma) ||
       before*sigma>=0 || pre<=nominal)return 0;
    for(n=0;n<net->count;n++)for(j=0;j<3;j++)p+=cached[n][j]*cached[n][j];
    den=dtgamma*sigma*p;
    if(!finite_value(den)||den==0)return 0;
    g=R(.99)*(-(1-dtgamma*R(.01))*before)/den;
    if(!finite_value(g)||g<=nominal)return 0;
    if(g>pre)g=pre;
    *norm=0;*hit=0;
    for(n=0;n<net->count;n++)for(j=0;j<3;j++) {
        /* Same update and projection order as the qualified kernel. */
        w=net->weight[n][j]+dtgamma*(g*sigma*cached[n][j]-R(.01)*net->weight[n][j]);
        wp=clip(w,-bound,bound);if(wp!=w)*hit=1;
        candidate[n][j]=wp;sum[j]+=wp*cached[n][j];*norm+=wp*wp;
    }
    *after=sum[0]+sum[1]+sum[2];
    if(!finite_value(*after)||!finite_value(*norm)||
       (before>0?(*after<0||*after>before):(*after>0||*after<before))) {
        /* Original weights untouched; caller performs leak-only update. */
        *learning=0;return 2;
    }
    memcpy(net->weight,candidate,net->count*3U*sizeof(e5_real));
    *learning=g;return 1;
}
#endif
#if DIAG_TRACKING_RETENTION
/* R2: only translation, at a stationary target with residual position error,
 * near-zero filtered speed AND near-zero per-motor raw speed. Preserve a
 * useful error-driven update against continuous leakage cancellation.
 * Never enable gradients: the R1 actual multiplier remains untouched.
 * No amplitude/hard-clip/speed state can enter. Local residual region only:
 * 10um<abs(error)<=200um; large errors retain the conservative R1 law.
 * At error<=10um, moving
 * target, wrong-direction output or zero learning, legacy leakage resumes.
 * Weight projection and all output guards remain authoritative. No claim
 * of closed-loop stability, general superiority or exact plant friction. */
static int tracking_retention_ok(const e5_state *s,const e5_input *in,
    const e5_output *out,e5_real learning,e5_real raw_prediction) {
    e5_real error=in->q[0]-in->reference[0];
    return s->method==E5_CA_BLNN && learning>0 &&
        !(out->ca_mask&(E5_CA_AMPLITUDE|E5_CA_SPEED)) &&
        !(out->diagnostic_reason&DIAG_REASON_HARD_CLIP) &&
        ABS(in->reference[1])<=R(1e-8) && ABS(in->reference[2])<=R(1e-8) &&
        ABS(error)>R(.000010) && ABS(error)<=R(.000200) &&
        ABS(in->velocity[0])<=R(.0002) &&
        e5_ca_abs((int32_t)in->raw_rpm[0])<=2 &&
        e5_ca_abs((int32_t)in->raw_rpm[1])<=2 &&
        error*out->sigma[0]>0 && raw_prediction*out->sigma[0]>0;
}
#endif
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
int e5_step(e5_state *s,const e5_input *in,e5_output *out) {
    const e5_real mass[2]={R(11.528),R(.34584)},damp[2]={R(57.4),R(20.5)},stiff[2]={0,R(E5_HW_SYNC_STIFFNESS_FF)};
    const e5_real gamma[2]={25,18},k1[2]={40,25},phi[2]={R(.025),R(.012)};
    const e5_real scales[2][5]={{2,R(.7),1,R(.08),R(.7)},{1,R(.20),R(.020),R(.010),R(.20)}};
    const e5_real k=R(.006197916666666667),dt=R(.001);
    e5_real chi[2][5],base[2],bi[2],correction[2],neg[2],limits[2],e,ed,ref,refv,refa;
    e5_real distances[2][E5_MAX_NODES]; /* Local scratch; state ABI unchanged. */
    e5_real raw_prediction[2];
    e5_real safe=1,headroom=1,learn,gate,work,budget,d,cap,rising,raw[3],*f,norm,w,wp;
    uint32_t ch,n,j,hit,preview_nodes[2];
    e5_ca_actuation actuation;
    if(!s||!in||!out) return 0;
    memset(out,0,sizeof(*out));
    if(s->fault) return 0;
    for(ch=0;ch<2;ch++) {
        if(!finite_value(in->q[ch])||!finite_value(in->velocity[ch])||!finite_value(in->acceleration[ch])||
           !finite_value(in->limit[ch])||in->limit[ch]<=0) goto invalid;
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
        out->dhat[ch]=prediction(&s->net[ch],chi[ch],ch,s->features[ch],distances[ch],&raw_prediction[ch]);out->sector[ch]=1;
        if(s->method==E5_CA_BLNN && ch==0U) {
            if(!finite_value(g_e5_online_nn_scale) || g_e5_online_nn_scale<R(.5) || g_e5_online_nn_scale>R(1.25) ||
               !finite_value(g_e5_online_learning_scale) || g_e5_online_learning_scale<R(.5) || g_e5_online_learning_scale>R(1))goto invalid;
            out->dhat[ch]=clip(out->dhat[ch]*R(g_e5_online_nn_scale),R(-80),R(80));
        }
        if(s->method==E5_CA_BLNN) {
            work=-out->sigma[ch]*out->dhat[ch];budget=R(.25)*k1[ch]*out->sigma[ch]*out->sigma[ch];
            if(work>budget && work>0) out->sector[ch]=budget/work;
        }
        neg[ch]=-out->sector[ch]*out->dhat[ch];
    }
    base[0]+=k*(s->aw[0]-s->aw[1]);base[1]+=R(-.3)*k*(s->aw[0]+s->aw[1]);
    force_to_current(base,bi);force_to_current(neg,correction);
    for(ch=0;ch<2;ch++) {
        /* Diagnostic raw BASE reference for all methods; no control change. */
        out->ca_base[ch]=bi[ch];
        if(!finite_value(bi[ch])||!finite_value(correction[ch])) goto invalid;
        d=(limits[ch]-ABS(bi[ch]))/limits[ch];if(d<headroom) headroom=d;
        if(s->method==E5_CA_BLNN && correction[ch]!=0) {
            if(ABS(bi[ch])>limits[ch] && bi[ch]*correction[ch]>0) safe=0;
            cap=(correction[ch]>0?limits[ch]-bi[ch]:-limits[ch]-bi[ch])/correction[ch];
            if(cap<safe) safe=cap>0?cap:0;
        }
    }
    safe=clip(safe,0,1);rising=s->gate+dt/(R(.030)+dt)*(safe-s->gate);gate=safe<rising?safe:rising;
    learn=clip(headroom/R(.15),0,1);if(learn>gate) learn=gate;
    if(s->method==E5_CA_BLNN) {
        for(ch=0;ch<2;ch++) correction[ch]*=gate;
        if(!e5_ca_allocate(bi,correction,out->sigma,limits,in->raw_rpm,s->ca_delta,&actuation)) goto invalid;
        out->ca_mask=actuation.mask;out->ca_speed_mask=actuation.speed_mask;
        out->diagnostic_reason=actuation.learning_reason;
        out->admitted_fraction=actuation.admitted_fraction;
        out->learning_before_reason=learn;
#if DIAG_NEW_LEARNING
        if(actuation.learning_reason==DIAG_REASON_RATE_ONLY)
            learn*=actuation.admitted_fraction;
        else if(actuation.mask || actuation.learning_reason) learn=0;
#else
        if(actuation.mask) learn=0;
#endif
        if(actuation.mask&E5_CA_WITHDRAWN) s->ca_fallbacks++;
        if(actuation.mask&E5_CA_CONTRACTED) s->ca_contractions++;
        for(ch=0;ch<2;ch++) {
            s->ca_delta[ch]=actuation.delta[ch];out->ca_delta[ch]=actuation.delta[ch];
            out->ca_base[ch]=bi[ch];out->ca_guarded_base[ch]=actuation.base[ch];
            out->ca_before_guard[ch]=actuation.before_guard[ch];
            /* Final = guarded BASE + admitted NN increment. Rejected NN must
             * not become a baseline AW bias. Therefore current-requested is
             * guarded BASE - attempted BASE, integrated exactly once. */
            out->requested[ch]=bi[ch]+actuation.delta[ch];
            out->current[ch]=actuation.command[ch];
        }
    }
    s->gate=gate;out->gate=gate;out->learning_gate=learn;s->step++;
    for(ch=0;ch<2;ch++) {
        e5_network *net=&s->net[ch];
        e5_real learning=s->method==E5_CA_BLNN?learn:1;
        e5_real pre_learning=out->learning_before_reason;
        e5_real leakage=R(.01);
        if(s->method==E5_CA_BLNN && ch==0U) {
            learning*=R(g_e5_online_learning_scale);pre_learning*=R(g_e5_online_learning_scale);
        }
        out->repair_before[ch]=raw_prediction[ch];out->repair_after[ch]=raw_prediction[ch];
        norm=0;hit=0;
#if DIAG_BOUNDED_REPAIR
        if(s->method==E5_CA_BLNN && out->ca_mask &&
           !(out->ca_mask&(E5_CA_AMPLITUDE|E5_CA_SPEED)) &&
           !(out->diagnostic_reason&DIAG_REASON_HARD_CLIP))
            out->repair_mode[ch]=(uint32_t)repair_update(net,s->features[ch],raw_prediction[ch],
                out->sigma[ch],pre_learning,learning,ch,
                &learning,&out->repair_after[ch],&norm,&hit);
#endif
#if DIAG_TRACKING_RETENTION
        if(ch==0U && !out->repair_mode[ch] &&
           tracking_retention_ok(s,in,out,learning,raw_prediction[ch])) {
            leakage=0;out->repair_mode[ch]=3U;
        }
#endif
        out->learning_axis[ch]=learning;
        if(!out->repair_mode[ch] && net->count && !s->fixed_nodes && s->step%20==0 && learning>=R(.5) && net->count<60)
            s->growth+=(uint32_t)grow(net,chi[ch],distances[ch],&out->novelty[ch]);
        if(out->repair_mode[ch]!=1U) {
        e5_real fallback_sum[3]={0,0,0};
        norm=0;hit=0;
        for(n=0;n<net->count;n++) {
            f=s->features[ch][n];
            /* Only a newly appended zero-weight node needs new features.
             * Existing features and pre-update output are exactly reusable. */
            if(n>=preview_nodes[ch]) features(net->center[n],chi[ch],f);
            for(j=0;j<3;j++) {
                w=net->weight[n][j]+dt*(ch?18:25)*(learning*out->sigma[ch]*f[j]-leakage*net->weight[n][j]);
                wp=clip(w,ch?-15:-30,ch?15:30);if(wp!=w) hit=1;
                net->weight[n][j]=wp;norm+=wp*wp;
                if(out->repair_mode[ch]>=2U)fallback_sum[j]+=wp*f[j];
            }
        }
        if(out->repair_mode[ch]>=2U)out->repair_after[ch]=fallback_sum[0]+fallback_sum[1]+fallback_sum[2];
        }
        net->projections+=hit;out->norm[ch]=SQRT(norm);
        /* Appending zero-weight nodes cannot change the same-step output. */
        if(s->method!=E5_CA_BLNN) raw[ch]=base[ch]-gate*out->sector[ch]*out->dhat[ch];
    }
    if(s->method!=E5_CA_BLNN) force_to_current(raw,out->requested);
    for(ch=0;ch<2;ch++) {
        if(s->method!=E5_CA_BLNN) out->current[ch]=clip(out->requested[ch],-limits[ch],limits[ch]);
        s->aw[ch]+=dt*(16*(out->current[ch]-out->requested[ch])-20*s->aw[ch]);
        s->k2[ch]=clip(s->k2[ch]+dt*(ch?2:5)*(ABS(out->sigma[ch])-s->k2[ch]),
            ch?R(E5_HW_K2_ALPHA_MIN):R(E5_HW_K2_Y_MIN),ch?10:24);
        if(!finite_value(out->requested[ch])||!finite_value(s->aw[ch])||!finite_value(out->norm[ch])||!finite_value(s->k2[ch])) goto invalid;
    }
    return 1;
invalid:
    s->fault=1;memset(out,0,sizeof(*out));return 0;
}
