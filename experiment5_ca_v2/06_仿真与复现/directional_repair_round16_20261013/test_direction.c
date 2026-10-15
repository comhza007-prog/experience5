#include <assert.h>
#include <math.h>
#include <stddef.h>
#include <stdio.h>
#include <stdlib.h>
#include "blnn_core.c"
int e5_r3_step(e5_state *,const e5_input *,e5_output *);
static e5_state state,prior;
static e5_output out,old;
static unsigned seed=816466;
static unsigned rnd(void){seed=1664525U*seed+1013904223U;return seed;}
static e5_real u(double lo,double hi){return (e5_real)(lo+(hi-lo)*(rnd()&65535U)/65535.0);}
static e5_real raw_sum(const e5_network *n,e5_real f[E5_MAX_NODES][3]) {
    e5_real sums[3]={0,0,0};unsigned i,j;
    for(i=0;i<n->count;i++)for(j=0;j<3;j++)sums[j]+=n->weight[i][j]*f[i][j];
    return sums[0]+sums[1]+sums[2];
}
static unsigned compare(e5_input *in) {
    unsigned ch,n,j; e5_state before=state;unsigned changed;
    prior=state;assert(e5_r3_step(&prior,in,&old));assert(e5_step(&state,in,&out));
    changed=out.repair_mode[0]==5;
    for(ch=0;ch<2;ch++) {
        assert(out.current[ch]==old.current[ch]&&out.requested[ch]==old.requested[ch]);
        assert(out.dhat[ch]==old.dhat[ch]&&out.sigma[ch]==old.sigma[ch]);
        assert(out.sector[ch]==old.sector[ch]&&out.ca_delta[ch]==old.ca_delta[ch]);
        assert(state.aw[ch]==prior.aw[ch]&&state.k2[ch]==prior.k2[ch]);
        if(ch==0&&changed) {
            assert(state.method==12);
            assert(in->limit[0]==in->limit[1]);
            assert(fabs((double)in->reference[1])>1e-8 || fabs((double)in->reference[2])>1e-8);
            assert(!(out.ca_mask&(E5_CA_AMPLITUDE|E5_CA_SPEED|E5_CA_WITHDRAWN)));
            assert(!(out.diagnostic_reason&DIAG_REASON_HARD_CLIP));
            assert(out.sector[0]<1&&out.repair_before[0]*out.sigma[0]<0);
            assert(ABS(out.sigma[0])>=R(.0001));
            assert(out.learning_axis[0]>0&&out.learning_axis[0]<=out.learning_before_reason);
            assert(state.net[0].count==before.net[0].count&&out.novelty[0]==0);
            assert(out.repair_after[0]==raw_sum(&state.net[0],state.features[0]));
            assert(out.repair_before[0]*out.repair_after[0]>=0);
            assert(fabs((double)out.repair_after[0])<=fabs((double)out.repair_before[0]));
            for(n=0;n<state.net[0].count;n++)for(j=0;j<3;j++)assert(fabs((double)state.net[0].weight[n][j])<=30);
        }else {
            assert(out.repair_mode[ch]==old.repair_mode[ch]);
            assert(out.learning_axis[ch]==old.learning_axis[ch]);
            assert(!memcmp(&state.net[ch],&prior.net[ch],sizeof(state.net[ch])));
        }
    }
    assert(out.repair_mode[1]!=5);
    if(!changed){assert(!memcmp(&state,&prior,sizeof(state)));assert(!memcmp(&out,&old,sizeof(out)));}
    if(state.method==12) {
        assert(e5_ca_sector_ok(out.sigma,(int)out.ca_delta[0],(int)out.ca_delta[1]));
        for(ch=0;ch<2;ch++) {
            assert(e5_ca_envelope_ok(in->raw_rpm[ch],(int)out.current[ch],(int)in->limit[ch]));
            assert(fabs((double)out.ca_delta[ch])<=300);
            if(!(out.ca_mask&(E5_CA_CONTRACTED|E5_CA_WITHDRAWN)))assert(abs((int)out.ca_delta[ch]-before.ca_delta[ch])<=2);
        }
    }
    return changed;
}
int main(void) {
    e5_input in;e5_output w,z;e5_real f[E5_MAX_NODES][3]={{0}},before,g,after,norm;
    e5_network baseline;unsigned i,n,j,ch,hit,changed=0,blocked=0;
    assert(e5_reset(&state,12,4));memset(&in,0,sizeof(in));in.reference[1]=R(-.0001);in.limit[0]=in.limit[1]=1200;
    for(n=0;n<4;n++)for(j=0;j<3;j++){f[n][j]=R(.5);state.net[0].weight[n][j]=R(-.05);}
    before=raw_sum(&state.net[0],f);memset(&w,0,sizeof(w));w.learning_before_reason=1;w.sigma[0]=R(.001);w.sector[0]=R(.01);
    baseline=state.net[0];g=0;after=before;norm=0;hit=0;
    assert(directional_repair_update(&state,&in,&w,&state.net[0],f,before,&g,&after,&norm,&hit)==5);
    assert(g==1&&after<0&&after>before&&after==raw_sum(&state.net[0],f));
    for(i=0;i<12;i++) {
        state.net[0]=baseline;state.method=12;z=w;in.reference[1]=R(-.0001);in.limit[0]=in.limit[1]=1200;g=R(.2);after=before;
        if(i==0)z.ca_mask=E5_CA_AMPLITUDE;
        if(i==1)z.ca_mask=E5_CA_SPEED;
        if(i==2)z.ca_mask=E5_CA_WITHDRAWN;
        if(i==3)z.diagnostic_reason=DIAG_REASON_HARD_CLIP;
        if(i==4)z.sigma[0]=-z.sigma[0];
        if(i==5)after=R(-.001);
        if(i==6)z.sigma[0]=R(.00001);
        if(i==7)z.sector[0]=1;
        if(i==8)z.learning_before_reason=0;
        if(i==9)in.reference[1]=0;
        if(i==10)state.method=11;
        if(i==11)in.limit[1]=800;
        assert(!directional_repair_update(&state,&in,&z,&state.net[0],f,after,&g,&after,&norm,&hit));
        assert(!memcmp(&state.net[0],&baseline,sizeof(baseline))&&g==R(.2));blocked++;
    }
    for(i=0;i<60000;i++) {
        assert(e5_reset(&state,i%7==0?11:12,i%3==0?4:(i%3==1?59:60)));
        memset(&in,0,sizeof(in));in.limit[0]=1200;in.limit[1]=i%4?1200:800;
        for(ch=0;ch<2;ch++) {
            in.q[ch]=u(-.0003,.0003);in.velocity[ch]=u(-.0003,.0003);in.acceleration[ch]=u(-.1,.1);
            in.raw_rpm[ch]=i%5?0:(int16_t)(rnd()%81-40);state.ca_delta[ch]=(int16_t)(rnd()%101-50);
            for(n=0;n<state.net[ch].count;n++)for(j=0;j<3;j++)state.net[ch].weight[n][j]=u(-.01,.01);
        }
        if(i%3==0)in.reference[1]=R(.0005);
        if(i%13==0)in.reference[2]=R(-.003);
        state.step=19;changed+=compare(&in);
    }
    assert(changed>0);
    /* Exercise projected-weight boundaries, not only small live weights. */
    for(i=0;i<6000;i++) {
        assert(e5_reset(&state,12,i%2?59:60));memset(&in,0,sizeof(in));
        in.limit[0]=in.limit[1]=1200;in.reference[1]=R(-.0001);
        in.q[0]=u(-.0003,.0003);in.velocity[0]=u(-.0003,.0003);
        for(n=0;n<state.net[0].count;n++)for(j=0;j<3;j++)
            state.net[0].weight[n][j]=(rnd()&1U?1:-1)*u(29,30);
        state.step=19;changed+=compare(&in);
    }
    assert(e5_reset(&state,11,4));memset(&in,0,sizeof(in));in.limit[0]=in.limit[1]=1200;
    for(i=0;i<30000;i++) {
        in.q[0]=R(.001)*(e5_real)sin(i*.013);in.q[1]=R(.0002)*(e5_real)sin(i*.037);
        in.velocity[0]=R(.002)*(e5_real)cos(i*.013);in.velocity[1]=R(.001)*(e5_real)cos(i*.037);compare(&in);
    }
    in.q[0]=(e5_real)NAN;assert(!e5_step(&state,&in,&out));assert(state.fault&&out.current[0]==0);
    printf("PASS moving wrong-direction Y contraction, rejected previews unchanged,boundaries=%u,same-state66000 including6000 weight-edge cases,mode5=%u,exact ordinary30000/R3 unaffected states/rotation,weight/output guards,no extra growth.\n",blocked,changed);return 0;
}
