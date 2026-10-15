#include <assert.h>
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include "blnn_core.c"
int e5_r1_step(e5_state *,const e5_input *,e5_output *);
static e5_state s,prior;
static e5_output o,old;
static unsigned seed=726413;
static unsigned rnd(void){seed=1664525U*seed+1013904223U;return seed;}
static e5_real u(double lo,double hi){return (e5_real)(lo+(hi-lo)*(rnd()&65535U)/65535.0);}
static e5_real raw_sum(const e5_network *net,e5_real f[E5_MAX_NODES][3]) {
    e5_real z[3]={0,0,0};unsigned n,j;
    for(n=0;n<net->count;n++)for(j=0;j<3;j++)z[j]+=net->weight[n][j]*f[n][j];
    return z[0]+z[1]+z[2];
}
static void check_pair(e5_input *in,unsigned *retained) {
    unsigned ch,n,j; e5_state before=s;
    prior=s;assert(e5_r1_step(&prior,in,&old));assert(e5_step(&s,in,&o));
    /* All first-step actuation, R1 repair policy and rotation unchanged. */
    for(ch=0;ch<2;ch++) {
        assert(old.requested[ch]==o.requested[ch]&&old.current[ch]==o.current[ch]);
        assert(old.dhat[ch]==o.dhat[ch]&&old.sigma[ch]==o.sigma[ch]);
        assert(prior.aw[ch]==s.aw[ch]&&prior.k2[ch]==s.k2[ch]);
        assert(old.learning_axis[ch]==o.learning_axis[ch]);
    }
    assert(!memcmp(&prior.net[1],&s.net[1],sizeof(s.net[1])));
    assert(o.repair_mode[1]==old.repair_mode[1]);
    if(s.method==E5_CA_BLNN) {
    assert(e5_ca_sector_ok(o.sigma,(int)o.ca_delta[0],(int)o.ca_delta[1]));
    for(ch=0;ch<2;ch++) {
        assert(e5_ca_envelope_ok(in->raw_rpm[ch],(int)o.current[ch],(int)in->limit[ch]));
        assert(fabs((double)o.ca_delta[ch])<=300);
        if(!(o.ca_mask&(E5_CA_CONTRACTED|E5_CA_WITHDRAWN)))assert(abs((int)o.ca_delta[ch]-before.ca_delta[ch])<=2);
    }
    }
    if(o.repair_mode[0]==3U) {
        (*retained)++;
        assert(tracking_retention_ok(&before,in,&o,o.learning_axis[0],o.repair_before[0]));
        assert(!old.repair_mode[0]);assert(o.novelty[0]==0);
        assert(s.net[0].count==before.net[0].count);
        assert(o.repair_after[0]==raw_sum(&s.net[0],s.features[0]));
        for(n=0;n<s.net[0].count;n++)for(j=0;j<3;j++) {
            e5_real expected=before.net[0].weight[n][j]+R(.001)*25*(o.learning_axis[0]*o.sigma[0]*s.features[0][n][j]);
            expected=clip(expected,-30,30);assert(s.net[0].weight[n][j]==expected);
        }
    } else {
        assert(!memcmp(&prior,&s,sizeof(s)));
        assert(!memcmp(&old,&o,sizeof(o)));
    }
}
int main(void) {
    e5_input in,good; e5_output x; unsigned i,n,j,ch,retained=0,blocked=0;
    assert(e5_reset(&s,12,4));memset(&good,0,sizeof(good));memset(&x,0,sizeof(x));
    good.q[0]=R(.00008);good.limit[0]=good.limit[1]=1200;x.sigma[0]=R(.002);
    assert(tracking_retention_ok(&s,&good,&x,1,1));
    for(i=0;i<13;i++) {
        e5_input z=good;e5_output y=x;e5_real learning=1,pred=1;uint32_t method=s.method;
        /* Each rejection independently tests a meaningful boundary. */
        if(i==0)z.reference[1]=R(.001);
        if(i==1)z.reference[2]=R(.001);
        if(i==2)z.q[0]=R(.000010);
        if(i==3)z.velocity[0]=R(.000201);
        if(i==4)z.raw_rpm[0]=3;
        if(i==5)z.raw_rpm[1]=-3;
        if(i==6)y.ca_mask=E5_CA_AMPLITUDE;
        if(i==7)y.ca_mask=E5_CA_SPEED;
        if(i==8)y.diagnostic_reason=DIAG_REASON_HARD_CLIP;
        if(i==9)learning=0;
        if(i==10)pred=-1;
        if(i==11)s.method=11;
        if(i==12)z.q[0]=R(.000201);
        assert(!tracking_retention_ok(&s,&z,&y,learning,pred));s.method=method;blocked++;
    }
    /* Synthetic eligible plateau, including growth-due59-node state. */
    for(i=0;i<3000;i++) {
        unsigned nodes=i%3==0?4:(i%3==1?59:60);e5_real sign=i&1?-1:1;
        assert(e5_reset(&s,12,nodes));s.step=19;in=good;in.q[0]=sign*R(.00008);
        for(n=0;n<nodes;n++)for(j=0;j<3;j++)s.net[0].weight[n][j]=sign*R(.005);
        check_pair(&in,&retained);
    }
    assert(retained>0);
    /* Random same-state counterfactuals: no control change on this step;
     * unaffected modes exact, rotation exact and numerical bounds intact. */
    for(i=0;i<60000;i++) {
        assert(e5_reset(&s,i%7==0?11:12,i%3==0?4:(i%3==1?59:60)));
        memset(&in,0,sizeof(in));in.limit[0]=1200;in.limit[1]=i%4?1200:800;
        for(ch=0;ch<2;ch++) {
            in.q[ch]=u(-.0003,.0003);in.velocity[ch]=u(-.0003,.0003);
            in.acceleration[ch]=u(-.1,.1);in.raw_rpm[ch]=i%5?0:(int16_t)(rnd()%81-40);
            s.ca_delta[ch]=(int16_t)(rnd()%101-50);
            for(n=0;n<s.net[ch].count;n++)for(j=0;j<3;j++)s.net[ch].weight[n][j]=u(-.01,.01);
        }
        if(i%3==0)in.reference[1]=R(.0005);
        if(i%13==0)in.reference[2]=R(.003);
        s.step=19;check_pair(&in,&retained);
    }
    /* Evolving ordinary control must be identical to R1 for every step. */
    assert(e5_reset(&s,11,4));memset(&in,0,sizeof(in));in.limit[0]=in.limit[1]=1200;
    for(i=0;i<30000;i++) {
        in.q[0]=R(.001)*(e5_real)sin(i*.013);in.q[1]=R(.0002)*(e5_real)sin(i*.037);
        in.velocity[0]=R(.002)*(e5_real)cos(i*.013);in.velocity[1]=R(.001)*(e5_real)cos(i*.037);
        check_pair(&in,&retained);
    }
    in.q[0]=(e5_real)NAN;assert(!e5_step(&s,&in,&o));assert(s.fault&&o.current[0]==0);
    printf("PASS rejectionBoundaries=%u; eligible3000+random60000; mode3=%u; exact unaffected/rotation/ordinary30000; all current/sector/slew and numerical guards.\n",blocked,retained);
    return 0;
}
