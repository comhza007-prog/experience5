#ifndef E5_CA_ACTUATOR_H
#define E5_CA_ACTUATOR_H
#include "blnn_core.h"
#include "experiment5_motion.h"
#include "diagnostic_config.h"
/* PROVISIONAL HW6 CA-only adapter, not the frozen simulation algorithm.
 * Counts, NOT amperes. BASE dynamics/gains and existing speed guard stay.
 * Bound FINAL increment relative to guarded BASE at the SAME state.
 * Never reapply the non-idempotent taper afterwards.
 * HOST diagnostic NN slew: 2 or 4 counts/ms. If that neighborhood is infeasible,
 * first retain a contraction aligned with the CURRENT target, bounded by
 * the old component magnitudes, only if no speed guard is intervening.
 * Contraction/withdrawal are explicit slew exceptions and freeze learning.
 * Constraint feasibility takes priority over NN slew, NEVER over braking.
 * These properties are NOT a closed-loop/hardware stability proof. */
#define E5_CA_MAX_DELTA 300
#define E5_CA_DELTA_STEP DIAG_SLEW_COUNTS
#define E5_CA_AMPLITUDE 1U
#define E5_CA_PROJECTED 2U
#define E5_CA_SECTOR 4U
#define E5_CA_SPEED 8U
#define E5_CA_WITHDRAWN 16U
#define E5_CA_CONTRACTED 32U
typedef struct {
    int16_t base[2], command[2], delta[2], before_guard[2];
    uint32_t mask, speed_mask;
    /* Diagnostics separate from the old mask: D0 must retain old decisions. */
    uint32_t learning_reason;
    e5_real admitted_fraction;
} e5_ca_actuation;
static int32_t e5_ca_abs(int32_t x) { return x<0?-x:x; }
static e5_real e5_ca_clip(e5_real x,e5_real l) { return x<-l?-l:(x>l?l:x); }
static int e5_ca_sector_ok(const e5_real sigma[2],int32_t dl,int32_t dr) {
    const e5_real k=(e5_real).006197916666666667;
    e5_real work,budget;
    work=sigma[0]*k*(e5_real)(dl-dr);
    budget=(e5_real)(DIAG_SECTOR_FRACTION*40)*sigma[0]*sigma[0];
    if(work>budget+(e5_real)1e-10*((e5_real)1+budget)) return 0;
    work=-sigma[1]*(e5_real).3*k*(e5_real)(dl+dr);
    budget=(e5_real)(DIAG_SECTOR_FRACTION*25)*sigma[1]*sigma[1];
    return work<=budget+(e5_real)1e-10*((e5_real)1+budget);
}
static int e5_ca_envelope_ok(int16_t rpm,int32_t command,int32_t limit) {
    int32_t speed=e5_ca_abs((int32_t)rpm),aligned=rpm>0?command:-command,brake;
    if(e5_ca_abs(command)>limit) return 0;
    if(speed>E5_HW_SOFT_RPM) {
        brake=E5_HW_BRAKE_COUNTS_PER_RPM*(speed-E5_HW_SOFT_RPM);
        if(brake>E5_HW_BRAKE_LIMIT) brake=E5_HW_BRAKE_LIMIT;
        return aligned<=-brake;
    }
    if(speed>E5_HW_TAPER_RPM)
        return aligned<=limit*(E5_HW_SOFT_RPM-speed)/(E5_HW_SOFT_RPM-E5_HW_TAPER_RPM);
    return 1;
}
/* Intersect the CURRENT target ray with the CURRENT linear bounds.
 * Baseline is already feasible, so lambda=0 remains feasible. This is NOT
 * a new guard or a guarantee of plant stability. At most 36 integer
 * candidates are then rechecked; no unbounded search in the motor task. */
static int e5_ca_contract_ray(const e5_real sigma[2],const int16_t rpm[2],
    const int32_t lim[2],const int16_t previous[2],const int32_t target[2],
    e5_ca_actuation *a) {
    const e5_real k=(e5_real).006197916666666667;
    e5_real cap=1,work,budget,bound,level;
    int32_t ch,speed,aligned,ceiling,c,center[2],dl,dr,dist,best;
    int32_t round_l,round_r;
    unsigned step;
    /* Never carry additional NN memory through an infeasible speed-guard
     * transition. In that situation retain v1's immediate NN withdrawal.
     * Partial contraction is ONLY for conflicts without guard intervention. */
    if(a->speed_mask) return 0;
    /* An exceptional projection cannot increase any component beyond its
     * previous magnitude or reverse its sign. If the target is incompatible
     * with that history, fall back to v1's withdrawal, not stale retention. */
    for(ch=0;ch<2;ch++) {
        if((int32_t)previous[ch]*target[ch]<0) return 0;
        if(target[ch]) {
            bound=(e5_real)e5_ca_abs(previous[ch])/(e5_real)e5_ca_abs(target[ch]);
            if(bound<cap) cap=bound;
        }
    }
    work=sigma[0]*k*(e5_real)(target[0]-target[1]);
    budget=(e5_real)(DIAG_SECTOR_FRACTION*40)*sigma[0]*sigma[0];
    if(work>0 && budget/work<cap) cap=budget/work;
    work=-sigma[1]*(e5_real).3*k*(e5_real)(target[0]+target[1]);
    budget=(e5_real)(DIAG_SECTOR_FRACTION*25)*sigma[1]*sigma[1];
    if(work>0 && budget/work<cap) cap=budget/work;
    for(ch=0;ch<2;ch++) {
        c=target[ch];
        if(c) {
            bound=(e5_real)((c>0?lim[ch]:-lim[ch])-a->base[ch])/(e5_real)c;
            if(bound<cap) cap=bound;
        }
        speed=e5_ca_abs((int32_t)rpm[ch]);
        if(speed>E5_HW_TAPER_RPM) {
            aligned=rpm[ch]>0?a->base[ch]:-a->base[ch];
            c=rpm[ch]>0?target[ch]:-target[ch];
            if(speed>E5_HW_SOFT_RPM) {
                ceiling=E5_HW_BRAKE_COUNTS_PER_RPM*(speed-E5_HW_SOFT_RPM);
                if(ceiling>E5_HW_BRAKE_LIMIT) ceiling=E5_HW_BRAKE_LIMIT;
                ceiling=-ceiling;
            } else ceiling=lim[ch]*(E5_HW_SOFT_RPM-speed)/(E5_HW_SOFT_RPM-E5_HW_TAPER_RPM);
            if(c>0) {
                bound=(e5_real)(ceiling-aligned)/(e5_real)c;
                if(bound<cap) cap=bound;
            }
        }
    }
    if(cap<0) cap=0;
    /* Zero remains an explicit competitor. Integer candidates are checked
     * independently, so rounding can never bypass a safety constraint. */
    a->delta[0]=0;a->delta[1]=0;
    best=target[0]*target[0]+target[1]*target[1];
    /* Quantization may invalidate the continuous boundary. Try three more
     * contractions, keep the feasible point closest to the CURRENT target.
     * Rounding never reverses a component or increases its magnitude. */
    for(step=0;step<4;step++) {
        level=cap*(e5_real)(4U-step)/(e5_real)4;
        for(ch=0;ch<2;ch++) center[ch]=(int32_t)(level*(e5_real)target[ch]);
        for(round_l=-1;round_l<=1;round_l++)
        for(round_r=-1;round_r<=1;round_r++) {
            dl=center[0]+round_l;dr=center[1]+round_r;
            if(e5_ca_abs(dl)>e5_ca_abs(previous[0]) || e5_ca_abs(dr)>e5_ca_abs(previous[1]) ||
               dl*(int32_t)previous[0]<0 || dr*(int32_t)previous[1]<0 ||
               e5_ca_abs(dl)>E5_CA_MAX_DELTA || e5_ca_abs(dr)>E5_CA_MAX_DELTA) continue;
            if(!e5_ca_envelope_ok(rpm[0],(int32_t)a->base[0]+dl,lim[0]) ||
               !e5_ca_envelope_ok(rpm[1],(int32_t)a->base[1]+dr,lim[1]) ||
               !e5_ca_sector_ok(sigma,dl,dr)) continue;
            dist=(dl-target[0])*(dl-target[0])+(dr-target[1])*(dr-target[1]);
            if(dist<best) {
                best=dist;a->delta[0]=(int16_t)dl;a->delta[1]=(int16_t)dr;
            }
        }
    }
    return a->delta[0] || a->delta[1];
}
/* HOST ONLY: retain the old ray-search result, supplement it with at most
 * 20 EXACT zero-rotation increments [z,-z]. This is not a globally optimal
 * integer solver. At the SAME state its target distance cannot be worse
 * than the old contraction because the old result remains a competitor.
 * Activation requires normal slew infeasibility, no speed intervention,
 * compatible history/current-target signs, and opposite target components.
 * This remains an explicit slew EXCEPTION, not relaxed normal slew.
 * Normal output/sector/learning guards are unchanged. No firmware release. */
static int e5_ca_contract(const e5_real sigma[2],const int16_t rpm[2],
    const int32_t lim[2],const int16_t previous[2],const int32_t target[2],
    e5_ca_actuation *a) {
    int retained=e5_ca_contract_ray(sigma,rpm,lim,previous,target,a);
#if DIAG_BALANCED_CONTRACTION
    const e5_real k=(e5_real).006197916666666667;
    e5_real z,cap=1,bound,work,budget,level;
    int32_t ch,c,speed,aligned,ceiling,center,offset,dl,dr,dist,best;
    unsigned step;
    if(a->speed_mask || target[0]*target[1]>=0 ||
       (int32_t)previous[0]*target[0]<0 ||
       (int32_t)previous[1]*target[1]<0) return retained;
    z=((e5_real)target[0]-(e5_real)target[1])/(e5_real)2;
    if(z==0)return retained;
    for(ch=0;ch<2;ch++) {
        bound=(e5_real)e5_ca_abs(previous[ch])/(z>0?z:-z);
        if(bound<cap)cap=bound;
    }
    bound=(e5_real)E5_CA_MAX_DELTA/(z>0?z:-z);
    if(bound<cap)cap=bound;
    work=sigma[0]*k*((e5_real)2*z);
    budget=(e5_real)(DIAG_SECTOR_FRACTION*40)*sigma[0]*sigma[0];
    if(work>0 && budget/work<cap)cap=budget/work;
    /* The rotational work is identically zero on this candidate line. */
    for(ch=0;ch<2;ch++) {
        e5_real component=ch?-z:z;
        bound=((e5_real)(component>0?lim[ch]:-lim[ch])-(e5_real)a->base[ch])/component;
        if(bound<cap)cap=bound;
        speed=e5_ca_abs((int32_t)rpm[ch]);
        if(speed>E5_HW_TAPER_RPM) {
            aligned=rpm[ch]>0?a->base[ch]:-a->base[ch];
            c=ch?-(int32_t)(z>0?1:-1):(int32_t)(z>0?1:-1);
            if(rpm[ch]<0)c=-c;
            if(speed>E5_HW_SOFT_RPM) {
                ceiling=E5_HW_BRAKE_COUNTS_PER_RPM*(speed-E5_HW_SOFT_RPM);
                if(ceiling>E5_HW_BRAKE_LIMIT)ceiling=E5_HW_BRAKE_LIMIT;
                ceiling=-ceiling;
            } else ceiling=lim[ch]*(E5_HW_SOFT_RPM-speed)/(E5_HW_SOFT_RPM-E5_HW_TAPER_RPM);
            if(c>0) {
                bound=(e5_real)(ceiling-aligned)/(z>0?z:-z);
                if(bound<cap)cap=bound;
            }
        }
    }
    if(cap<0)cap=0;
    best=((int32_t)a->delta[0]-target[0])*((int32_t)a->delta[0]-target[0])+
         ((int32_t)a->delta[1]-target[1])*((int32_t)a->delta[1]-target[1]);
    for(step=0;step<4;step++) {
        level=cap*(e5_real)(4U-step)/(e5_real)4;
        center=(int32_t)(level*z);
        for(offset=-2;offset<=2;offset++) {
            dl=center+offset;dr=-dl;
            if(e5_ca_abs(dl)>e5_ca_abs(previous[0]) || e5_ca_abs(dr)>e5_ca_abs(previous[1]) ||
               dl*(int32_t)previous[0]<0 || dr*(int32_t)previous[1]<0 ||
               dl*target[0]<0 || dr*target[1]<0 ||
               e5_ca_abs(dl)>E5_CA_MAX_DELTA || e5_ca_abs(dr)>E5_CA_MAX_DELTA) continue;
            if(!e5_ca_envelope_ok(rpm[0],(int32_t)a->base[0]+dl,lim[0]) ||
               !e5_ca_envelope_ok(rpm[1],(int32_t)a->base[1]+dr,lim[1]) ||
               !e5_ca_sector_ok(sigma,dl,dr)) continue;
            dist=(dl-target[0])*(dl-target[0])+(dr-target[1])*(dr-target[1]);
            if(dist<best) {
                best=dist;a->delta[0]=(int16_t)dl;a->delta[1]=(int16_t)dr;
            }
        }
    }
    return a->delta[0] || a->delta[1];
#else
    return retained;
#endif
}
static int e5_ca_allocate(const e5_real bi[2],const e5_real correction[2],
    const e5_real sigma[2],const e5_real limits[2],const int16_t rpm[2],
    const int16_t previous[2],e5_ca_actuation *a) {
    e5_real scale=1,peak=0;
    int32_t target[2],lim[2],dl,dr,cl,cr,dist,best=0x7fffffff,tie=0;
    int16_t wanted[2];
    uint32_t ch;int found=0;
    a->mask=0;a->speed_mask=0;a->learning_reason=0;a->admitted_fraction=1;
    for(ch=0;ch<2;ch++) {
        if(!e5_motion_finite((float)bi[ch])||!e5_motion_finite((float)correction[ch])||
           !e5_motion_finite((float)sigma[ch])||!e5_motion_finite((float)limits[ch])||
           limits[ch]<E5_HW_BRAKE_LIMIT||limits[ch]>E5_MOTION_LIMIT) return 0;
        lim[ch]=(int32_t)limits[ch];
        if(correction[ch]>peak) peak=correction[ch];
        if(-correction[ch]>peak) peak=-correction[ch];
    }
    if(peak>E5_CA_MAX_DELTA) {scale=(e5_real)E5_CA_MAX_DELTA/peak;a->mask|=E5_CA_AMPLITUDE;}
    for(ch=0;ch<2;ch++) {
        if(bi[ch]>(e5_real)lim[ch] || bi[ch]<-(e5_real)lim[ch] ||
           bi[ch]+scale*correction[ch]>(e5_real)lim[ch] ||
           bi[ch]+scale*correction[ch]<-(e5_real)lim[ch])
            a->learning_reason|=DIAG_REASON_HARD_CLIP;
        if(!e5_motion_quantize((float)e5_ca_clip(bi[ch],(e5_real)lim[ch]),&a->base[ch])||
           !e5_motion_quantize((float)e5_ca_clip(bi[ch]+scale*correction[ch],(e5_real)lim[ch]),&wanted[ch])) return 0;
        a->before_guard[ch]=wanted[ch];
        if(e5_motion_speed_guard(rpm[ch],&a->base[ch])) a->speed_mask|=1U<<ch;
        if(e5_motion_speed_guard(rpm[ch],&wanted[ch])) a->speed_mask|=1U<<ch;
        if(!e5_ca_envelope_ok(rpm[ch],a->base[ch],lim[ch])) return 0;
        target[ch]=(int32_t)wanted[ch]-(int32_t)a->base[ch];
    }
    if(a->speed_mask) a->mask|=E5_CA_SPEED;
    if(!e5_ca_sector_ok(sigma,target[0],target[1])) a->mask|=E5_CA_SECTOR;
    /* 25 integer candidates: deterministic finite work per 1-ms step.
     * Zero is feasible for sectors/envelopes, but may be outside slew bounds.
 * In that case first try a feasible contraction of the previous NN. */
    for(dl=(int32_t)previous[0]-E5_CA_DELTA_STEP;dl<=(int32_t)previous[0]+E5_CA_DELTA_STEP;dl++)
    for(dr=(int32_t)previous[1]-E5_CA_DELTA_STEP;dr<=(int32_t)previous[1]+E5_CA_DELTA_STEP;dr++) {
        if(e5_ca_abs(dl)>E5_CA_MAX_DELTA||e5_ca_abs(dr)>E5_CA_MAX_DELTA) continue;
        cl=(int32_t)a->base[0]+dl;cr=(int32_t)a->base[1]+dr;
        if(!e5_ca_envelope_ok(rpm[0],cl,lim[0])||!e5_ca_envelope_ok(rpm[1],cr,lim[1])||
           !e5_ca_sector_ok(sigma,dl,dr)) continue;
        dist=(dl-target[0])*(dl-target[0])+(dr-target[1])*(dr-target[1]);
        if(!found||dist<best||(dist==best&&e5_ca_abs(dl)+e5_ca_abs(dr)<tie)) {
            found=1;best=dist;tie=e5_ca_abs(dl)+e5_ca_abs(dr);
            a->delta[0]=(int16_t)dl;a->delta[1]=(int16_t)dr;
        }
    }
    if(!found) {
        if(e5_ca_contract(sigma,rpm,lim,previous,target,a)) a->mask|=E5_CA_CONTRACTED;
        else {a->delta[0]=0;a->delta[1]=0;a->mask|=E5_CA_WITHDRAWN;}
    }
    for(ch=0;ch<2;ch++) {
        if(a->delta[ch]!=target[ch]) a->mask|=E5_CA_PROJECTED;
        a->command[ch]=(int16_t)((int32_t)a->base[ch]+a->delta[ch]);
    }
    /* Pure slew is proven by an otherwise feasible CURRENT target, not by
     * the generic PROJECTED bit alone. Mixed constraints always block.
     * Weight gradient is scaled by the signed projection of the ACTUAL NN
     * onto its feasible target. Opposite/stale compensation admits no
     * learning; merely changing learning from 0 to 1 is deliberately avoided.
     * This bounded coefficient is NOT a closed-loop stability theorem. */
    if(a->mask & ~E5_CA_PROJECTED)
        a->learning_reason|=DIAG_REASON_OTHER_CONSTRAINT;
    if(a->mask==E5_CA_PROJECTED && a->learning_reason==0 &&
       e5_ca_envelope_ok(rpm[0],(int32_t)a->base[0]+target[0],lim[0]) &&
       e5_ca_envelope_ok(rpm[1],(int32_t)a->base[1]+target[1],lim[1]) &&
       e5_ca_sector_ok(sigma,target[0],target[1])) {
        e5_real denominator=(e5_real)target[0]*target[0]+(e5_real)target[1]*target[1];
        e5_real numerator=(e5_real)a->delta[0]*target[0]+(e5_real)a->delta[1]*target[1];
        a->learning_reason=DIAG_REASON_RATE_ONLY;
        a->admitted_fraction=denominator>0?numerator/denominator:0;
        if(a->admitted_fraction<0)a->admitted_fraction=0;
        if(a->admitted_fraction>1)a->admitted_fraction=1;
    } else if(a->mask || a->learning_reason) {
        a->learning_reason|=DIAG_REASON_OTHER_CONSTRAINT;
        a->admitted_fraction=0;
    }
    return 1;
}
#endif
