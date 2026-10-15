#ifndef E5_ERROR_SUMMARY_H
#define E5_ERROR_SUMMARY_H
#include <stdint.h>
#include <string.h>
#include <math.h>
#include <float.h>
/* UART-only statistics. No controller state or actuator operation.
 * Accumulate the native40ms phase2..5/drive-permitted samples, and only
 * commit frames after the existing UART TC counter acknowledges completion.
 * I53/I54 stay instantaneous until BOTH I0>=40s and phase6; then show
 * trackingRMSE/syncRMS in mm. A delayed healthy run continues instantaneous
 * display after40s until completion. Fault/invalid completed summary=-1/-1.
 * Metric inputs use6decimal-place metre rounding to match the current VOFA
 * CSV I3/I5/I6 definition. This rounding NEVER feeds back to the controller.
 * UART completion is not a PC reception acknowledgement: retained CSV is
 * still needed to check host losses, identities and experimental conditions. */
typedef struct {
    double tracking_squares,sync_squares,pending_tracking,pending_sync;
    float first_elapsed,last_elapsed,pending_elapsed,tracking_rms,sync_rms;
    uint32_t samples,phase_mask,last_sequence,pending_sequence;
    uint32_t pending_phase,pending_completed,pending,invalid,seen_end,computed;
} e5_error_summary;
static void e5_summary_reset(e5_error_summary *s) {memset(s,0,sizeof(*s));}
static int e5_summary_finite(float x) {return x==x&&x<=FLT_MAX&&x>=-FLT_MAX;}
static int e5_summary_motion(const float v[107]) {
    return v[106]==1.0f&&v[2]>=2.0f&&v[2]<=5.0f;
}
static double e5_summary_micro(float x) {
    double y=(double)x*1000000.0;
    return y>=0.0?floor(y+0.5):-floor(-y+0.5);
}
static void e5_summary_complete(e5_error_summary *s,uint32_t completed,uint32_t error) {
    if(!s->pending)return;
    if(error) {s->invalid=1U;s->pending=0U;return;}
    if(completed==s->pending_completed)return;
    if(s->samples) {
        if(s->pending_sequence!=s->last_sequence+1U ||
           s->pending_elapsed<=s->last_elapsed ||
           s->pending_elapsed-s->last_elapsed>.0501f) s->invalid=1U;
    } else s->first_elapsed=s->pending_elapsed;
    s->tracking_squares+=s->pending_tracking*s->pending_tracking;
    s->sync_squares+=s->pending_sync*s->pending_sync;
    s->last_elapsed=s->pending_elapsed;s->last_sequence=s->pending_sequence;
    s->phase_mask|=1U<<(s->pending_phase-2U);
    s->samples++;s->pending=0U;
}
static void e5_summary_cancel_pending(e5_error_summary *s) {
    if(s->pending)s->invalid=1U;
    s->pending=0U;
}
static void e5_summary_observe(e5_error_summary *s,const float v[107]) {
    if(v[2]==9.0f||v[22]!=0.0f)s->invalid=1U;
    if(e5_summary_motion(v) &&
       (v[45]!=0.0f||v[57]!=0.0f||v[59]!=0.0f||v[70]!=0.0f||v[28]!=0.0f))s->invalid=1U;
    if(v[2]==6.0f&&v[22]==0.0f&&v[106]==0.0f&&v[46]==28000.0f)s->seen_end=1U;
}
static void e5_summary_rejected(e5_error_summary *s,const float v[107]) {
    if(e5_summary_motion(v))s->invalid=1U;
}
static void e5_summary_stage(e5_error_summary *s,const float v[107],
                             uint32_t sequence,uint32_t completed_before_send) {
    double left,right,reference;
    if(!e5_summary_motion(v))return;
    if(s->pending) {s->invalid=1U;return;}
    if(!e5_summary_finite(v[3])||!e5_summary_finite(v[5])||!e5_summary_finite(v[6])||
       !e5_summary_finite(v[79])||v[22]!=0.0f) {s->invalid=1U;return;}
    left=e5_summary_micro(v[5]);right=e5_summary_micro(v[6]);reference=e5_summary_micro(v[3]);
    s->pending_tracking=(0.5*(left+right)-reference)*.001;
    s->pending_sync=(left-right)*.001;
    s->pending_sequence=sequence;s->pending_completed=completed_before_send;
    s->pending_elapsed=v[79];s->pending_phase=(uint32_t)v[2];s->pending=1U;
}
static int e5_summary_valid(const e5_error_summary *s) {
    return !s->invalid&&!s->pending&&s->seen_end&&s->samples>=599U&&s->samples<=601U&&
           s->phase_mask==15U&&s->first_elapsed>=3.999f&&s->first_elapsed<=4.041f&&
           s->last_elapsed>=27.919f&&s->last_elapsed<28.001f&&
           s->last_elapsed-s->first_elapsed>=23.90f;
}
static void e5_summary_display(e5_error_summary *s,float v[107]) {
    if(v[0]<40.0f)return;
    if(v[2]!=6.0f) {
        if(v[2]==9.0f||v[22]!=0.0f||s->invalid) {v[53]=-1.0f;v[54]=-1.0f;}
        return;
    }
    if(!e5_summary_valid(s)) {v[53]=-1.0f;v[54]=-1.0f;return;}
    if(!s->computed) {
        s->tracking_rms=(float)sqrt(s->tracking_squares/(double)s->samples);
        s->sync_rms=(float)sqrt(s->sync_squares/(double)s->samples);
        s->computed=1U;
    }
    v[53]=s->tracking_rms;v[54]=s->sync_rms;
}
#endif
