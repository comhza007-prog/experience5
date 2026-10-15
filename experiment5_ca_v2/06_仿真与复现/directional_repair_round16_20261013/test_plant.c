/* HOST ONLY: sensitivity on an ASSUMED coupled plant, not identified hardware.
 * Reuses the existing HW6 diagnostic plant and unmodified safety limits.
 * Identical deterministic feedback noise, initial state and plant per method. */
#include <assert.h>
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "blnn_core.h"
#include "experiment5_formal_actuator.h"
#include "experiment5_ca_actuator.h"
#ifndef TEST_METHOD
#define TEST_METHOD E5_CA_BLNN
#endif
static e5_state state;
static void run(unsigned case_id,double mass,double friction_counts,unsigned delay,int right_limit) {
    e5_input in;e5_output out;double p[2]={0,0},v[2]={0,0},filtered[2]={0,0},acc[2]={0,0},esc[2]={0,0},current[2]={0,0};
    double esc_queue[8][2]={{0}},cmd_queue[8][2]={{0}},pos[2],coupling,drive,friction,newv,old,true_rpm;
    double sum_track=0,sum_sync=0,peak_track=0,peak_sync=0,learn_sum=0,rho_sum=0,nn_sum=0,peak_rpm=0;
    const double dt=.001,k=.006197916666666667,mpr=EXP3_METERS_PER_MOTOR_COUNT*EXP3_ENCODER_CPR/60.0;
    unsigned n,ch,j,fault=0,tracking_ms=0,samples=0,active=0,learning_zero=0,rate_only=0,mask_count=0,hits[2]={0,0};
    unsigned bits[6]={0},sector_reduced[2]={0},mixed=0,hard_clip=0;
    double sector_sum[2]={0,0};
    float ref[3],qv[2];int16_t rpm[2],cmd[2],before[2];uint32_t speedmask;
    memset(&in,0,sizeof(in));in.limit[0]=1200;in.limit[1]=(e5_real)right_limit;assert(e5_reset(&state,TEST_METHOD,4));
    printf("{\"type\":\"start\",\"case\":%u,\"method\":%u,\"massAxis\":%.0f,\"friction_counts\":%.0f,\"delay_ms\":%u,\"right_limit\":%d}\n",case_id,TEST_METHOD,mass,friction_counts,delay,right_limit);
    for(n=0;n<=20000;n++) {
        unsigned phase=e5_motion_reference(n,ref);for(j=0;j<3;j++)in.reference[j]=(e5_real)ref[j];
        coupling=2000*(p[1]-p[0])+40*(v[1]-v[0]);
        for(ch=0;ch<2;ch++) {
            true_rpm=(ch?-1:1)*v[ch]/mpr;esc[ch]+=dt/(.003+dt)*(true_rpm-esc[ch]);
            rpm[ch]=(int16_t)lround(esc_queue[n%(delay+1)][ch]);esc_queue[n%(delay+1)][ch]=esc[ch]+(n%19==0?1:0);
            pos[ch]=round(p[ch]/EXP3_METERS_PER_MOTOR_COUNT)*EXP3_METERS_PER_MOTOR_COUNT;
            if(fabs(true_rpm)>peak_rpm)peak_rpm=fabs(true_rpm);
            if(e5_motion_rpm_fault(rpm[ch]))fault|=512;
            if(fabs(pos[ch])>.004)fault|=16;
        }
        if(fabs(pos[0]-pos[1])>.0015)fault|=8;
        if(fabs(pos[0]-ref[0])>.001||fabs(pos[1]-ref[0])>.001)tracking_ms++;else tracking_ms=0;
        if(tracking_ms>=1000)fault|=1024;
        if(phase==2&&ref[0]>.00025&&(pos[0]<-.00025||pos[1]<-.00025))fault|=1024;
        if(n==20000&&(fabs(pos[0])>.0005||fabs(pos[1])>.0005||fabs(pos[0]-pos[1])>.0005))fault|=1024;
        if(fault||n==20000)break;
        in.q[0]=(e5_real)(.5*(pos[0]+pos[1]));in.q[1]=(e5_real)((pos[1]-pos[0])/.6);
        e5_motion_velocity(rpm[0],rpm[1],qv);
        for(ch=0;ch<2;ch++) {
            old=filtered[ch];filtered[ch]+=.26959730895*(qv[ch]-filtered[ch]);
            acc[ch]+=.11808862170*((filtered[ch]-old)/dt-acc[ch]);
            in.velocity[ch]=(e5_real)filtered[ch];in.acceleration[ch]=(e5_real)acc[ch];in.raw_rpm[ch]=rpm[ch];
        }
        assert(e5_step(&state,&in,&out));assert(e5_formal_finalize(TEST_METHOD,&in,&out,cmd,before,&speedmask));
        for(ch=0;ch<2;ch++) {
            assert(e5_ca_envelope_ok(rpm[ch],cmd[ch],(int)in.limit[ch]));
            state.aw[ch]+=(e5_real).016*((e5_real)cmd[ch]-out.current[ch]);
            if(abs(cmd[ch])>=in.limit[ch]-1)hits[ch]++;
        }
        if(TEST_METHOD==E5_CA_BLNN)assert(e5_ca_sector_ok(out.sigma,(int)out.ca_delta[0],(int)out.ca_delta[1]));
        active++;learn_sum+=TEST_METHOD==E5_BLNN?1:out.learning_gate;
        if(TEST_METHOD!=E5_BLNN&&out.learning_gate==0)learning_zero++;
        if(out.diagnostic_reason==DIAG_REASON_RATE_ONLY)rate_only++;
        if(out.ca_mask)mask_count++;
        rho_sum+=out.admitted_fraction;
        for(j=0;j<6;j++)if(out.ca_mask&(1U<<j))bits[j]++;
        if((out.ca_mask&E5_CA_PROJECTED)&&(out.ca_mask&~E5_CA_PROJECTED))mixed++;
        if(out.diagnostic_reason&DIAG_REASON_HARD_CLIP)hard_clip++;
        for(ch=0;ch<2;ch++){
            sector_sum[ch]+=out.sector[ch];
            if(out.sector[ch]<(e5_real).99999)sector_reduced[ch]++;
        }
        nn_sum+=.5*((double)out.ca_delta[0]*out.ca_delta[0]+(double)out.ca_delta[1]*out.ca_delta[1]);
        /* Match preregistered PHYSICAL metric: mean-position tracking, not
         * per-motor tracking (old assumed-model tester used a different one). */
        if(phase>=2&&phase<=5){double e0=1000*(.5*(pos[0]+pos[1])-ref[0]),sy=1000*(pos[0]-pos[1]);sum_track+=e0*e0;sum_sync+=sy*sy;samples++;if(fabs(e0)>peak_track)peak_track=fabs(e0);if(fabs(sy)>peak_sync)peak_sync=fabs(sy);}
        if(n%40==0)printf("{\"type\":\"trace\",\"case\":%u,\"t\":%.3f,\"phase\":%u,\"ref_mm\":%.9g,\"positions_mm\":[%.9g,%.9g],\"commands\":[%d,%d],\"learning\":%.9g,\"mask\":%u,\"reason\":%u,\"rho\":%.9g,\"delta\":[%.9g,%.9g],\"nodes\":[%u,%u]}\n",case_id,n*.001,phase,ref[0]*1000,pos[0]*1000,pos[1]*1000,cmd[0],cmd[1],TEST_METHOD==E5_BLNN?1:(double)out.learning_gate,out.ca_mask,out.diagnostic_reason,(double)out.admitted_fraction,(double)out.ca_delta[0],(double)out.ca_delta[1],state.net[0].count,state.net[1].count);
        for(ch=0;ch<2;ch++){
            current[ch]+=(cmd_queue[n%(delay+1)][ch]-current[ch])/3;cmd_queue[n%(delay+1)][ch]=cmd[ch];
            drive=(ch?-1:1)*k*current[ch]-31.5*v[ch]+(ch?-coupling:coupling);
            friction=k*friction_counts*(ch?1.4:1);
            if(fabs(v[ch])<1e-7&&fabs(drive)<=friction)v[ch]=0;
            else {double resist=.2*friction*(v[ch]?(v[ch]>0?1:-1):(drive>0?1:-1));newv=v[ch]+dt*(drive-resist)/(ch?mass*1.2:mass);if(v[ch]*newv<0&&fabs(drive)<=friction)v[ch]=0;else v[ch]=newv;}
        }
        for(ch=0;ch<2;ch++){p[ch]+=dt*v[ch];assert(isfinite(p[ch])&&isfinite(v[ch]));}
    }
    printf("{\"type\":\"mechanism\",\"case\":%u,\"steps\":%u,\"maskCounts\":[%u,%u,%u,%u,%u,%u],\"mixedProjection\":%u,\"hiddenHardClip\":%u,\"sectorMean\":[%.9g,%.9g],\"sectorReducedCounts\":[%u,%u]}\n",case_id,active,bits[0],bits[1],bits[2],bits[3],bits[4],bits[5],mixed,hard_clip,active?sector_sum[0]/active:0,active?sector_sum[1]/active:0,sector_reduced[0],sector_reduced[1]);
    printf("{\"type\":\"result\",\"case\":%u,\"method\":%u,\"stop_ms\":%u,\"fault\":%u,\"complete\":%s,\"motionSamples\":%u,\"partialTrackingRMSE_mm\":%.9g,\"partialSyncRMS_mm\":%.9g,\"peakTracking_mm\":%.9g,\"peakSync_mm\":%.9g,\"terminalMax_mm\":%.9g,\"peakRPM\":%.9g,\"learningMean\":%.9g,\"learningZero_pct\":%.9g,\"pureRate_pct\":%.9g,\"anyMask_pct\":%.9g,\"admittedFractionMean\":%.9g,\"nnIncrementRMS_counts\":%.9g,\"nodes\":[%u,%u],\"projections\":[%u,%u],\"hardHits\":[%u,%u],\"withdrawals\":%u,\"contractions\":%u}\n",case_id,TEST_METHOD,n,fault,!fault&&n==20000?"true":"false",samples,samples?sqrt(sum_track/samples):0,samples?sqrt(sum_sync/samples):0,peak_track,peak_sync,1000*fmax(fabs(pos[0]),fabs(pos[1])),peak_rpm,active?learn_sum/active:0,active?100.0*learning_zero/active:0,active?100.0*rate_only/active:0,active?100.0*mask_count/active:0,active?rho_sum/active:0,active?sqrt(nn_sum/active):0,state.net[0].count,state.net[1].count,state.net[0].projections,state.net[1].projections,hits[0],hits[1],state.ca_fallbacks,state.ca_contractions);
}
int main(void){unsigned m,f,d,b,id=0;double masses[3]={3,6,9},frictions[2]={400,600};for(b=0;b<2;b++)for(m=0;m<3;m++)for(f=0;f<2;f++)for(d=0;d<3;d++)run(++id,masses[m],frictions[f],d*3,b?800:1200);return 0;}
