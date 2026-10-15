#include <assert.h>
#include <math.h>
#include <stddef.h>
#include <stdio.h>
#include <stdlib.h>
#include "blnn_core.c"
int e5_r2_step(e5_state *,const e5_input *,e5_output *);
static e5_state s,prior;
static e5_output out,old;
static unsigned seed=718441;
static unsigned rnd(void){seed=1664525U*seed+1013904223U;return seed;}
static e5_real u(double lo,double hi){return (e5_real)(lo+(hi-lo)*(rnd()&65535U)/65535.0);}
static e5_real raw_sum(const e5_network *net,e5_real f[E5_MAX_NODES][3]) {
    e5_real a[3]={0,0,0};unsigned n,j;
    for(n=0;n<net->count;n++)for(j=0;j<3;j++)a[j]+=net->weight[n][j]*f[n][j];
    return a[0]+a[1]+a[2];
}
static void compare(e5_input *in,unsigned *changed,unsigned *reduced) {
    unsigned ch,n,j,any=0; e5_state before=s;
    prior=s;assert(e5_r2_step(&prior,in,&old));assert(e5_step(&s,in,&out));
    for(ch=0;ch<2;ch++) {
        assert(out.current[ch]==old.current[ch]&&out.requested[ch]==old.requested[ch]);
        assert(out.dhat[ch]==old.dhat[ch]&&out.sigma[ch]==old.sigma[ch]);
        assert(out.ca_delta[ch]==old.ca_delta[ch]);assert(s.aw[ch]==prior.aw[ch]&&s.k2[ch]==prior.k2[ch]);
        if(out.repair_mode[ch]==4) {
            any=1;(*changed)++;if(out.learning_axis[ch]<old.learning_axis[ch])(*reduced)++;
            assert(ch==0);
            assert(fabs((double)in->reference[1])>1e-8 || fabs((double)in->reference[2])>1e-8);
            assert(out.learning_axis[ch]>old.learning_axis[ch]);
            assert(old.repair_mode[ch]==0);
            assert(!(out.ca_mask&(E5_CA_AMPLITUDE|E5_CA_SPEED|E5_CA_WITHDRAWN)));
            assert(!(out.diagnostic_reason&DIAG_REASON_HARD_CLIP));
            assert(out.repair_before[ch]*out.sigma[ch]>0);
            assert(out.admission_axis[ch]>=0&&out.admission_axis[ch]<=1);
            assert(out.learning_axis[ch]==out.learning_before_reason*out.admission_axis[ch]);
            assert(out.learning_axis[ch]>=0&&out.learning_axis[ch]<=out.learning_before_reason);
            assert(s.net[ch].count==before.net[ch].count&&out.novelty[ch]==0);
            assert(out.repair_after[ch]==raw_sum(&s.net[ch],s.features[ch]));
            for(n=0;n<s.net[ch].count;n++)for(j=0;j<3;j++) {
                e5_real w=before.net[ch].weight[n][j]+R(.001)*(ch?18:25)*
                    (out.learning_axis[ch]*out.sigma[ch]*s.features[ch][n][j]-R(.01)*before.net[ch].weight[n][j]);
                assert(s.net[ch].weight[n][j]==clip(w,ch?-15:-30,ch?15:30));
            }
        } else {
            assert(out.repair_mode[ch]==old.repair_mode[ch]);
            assert(out.learning_axis[ch]==old.learning_axis[ch]);
            assert(!memcmp(&s.net[ch],&prior.net[ch],sizeof(s.net[ch])));
        }
    }
    if(!any){assert(!memcmp(&s,&prior,sizeof(s)));assert(!memcmp(&out,&old,offsetof(e5_output,admission_axis)));}
    if(s.method==E5_CA_BLNN) {
        assert(e5_ca_sector_ok(out.sigma,(int)out.ca_delta[0],(int)out.ca_delta[1]));
        for(ch=0;ch<2;ch++) {
            assert(e5_ca_envelope_ok(in->raw_rpm[ch],(int)out.current[ch],(int)in->limit[ch]));
            assert(fabs((double)out.ca_delta[ch])<=300);
            if(!(out.ca_mask&(E5_CA_CONTRACTED|E5_CA_WITHDRAWN)))assert(abs((int)out.ca_delta[ch]-before.ca_delta[ch])<=2);
        }
    }
}
int main(void) {
    e5_output w,z;e5_real rho,g;unsigned i,n,j,ch,changed=0,reduced=0,blocked=0;e5_input in;
    memset(&w,0,sizeof(w));w.ca_mask=6;w.diagnostic_reason=4;w.gate=1;w.sector[0]=w.sector[1]=1;
    w.learning_before_reason=1;w.sigma[0]=R(-.005377);w.dhat[0]=R(-.312276);w.ca_delta[0]=25;w.ca_delta[1]=-25;
    memset(&in,0,sizeof(in));in.reference[1]=R(.0005);
    g=0;assert(modal_learning(&in,&w,12,0,w.dhat[0],&rho,&g));assert(rho>R(.9923)&&rho<R(.9925)&&g==rho);
    for(i=0;i<10;i++) {
        z=w;g=R(.2);
        if(i==0)z.ca_mask|=E5_CA_AMPLITUDE;
        if(i==1)z.ca_mask|=E5_CA_SPEED;
        if(i==2)z.ca_mask|=E5_CA_WITHDRAWN;
        if(i==3)z.diagnostic_reason|=DIAG_REASON_HARD_CLIP;
        if(i==4)z.dhat[0]=-z.dhat[0];
        if(i==5)z.dhat[0]=R(-.001);
        if(i==6)z.ca_mask=0;
        if(i==8)in.reference[1]=0;
        if(i==9)in.reference[1]=R(.0005);
        assert(!modal_learning(&in,&z,i==7?11:12,i==9?1:0,z.dhat[0],&rho,&g));assert(rho==-1&&g==R(.2));blocked++;
    }
    z=w;z.ca_delta[0]=-25;z.ca_delta[1]=25;g=1;assert(modal_learning(&in,&z,12,0,z.dhat[0],&rho,&g));assert(g==0&&rho==0);
    z=w;z.ca_delta[0]=100;z.ca_delta[1]=-100;g=0;assert(modal_learning(&in,&z,12,0,z.dhat[0],&rho,&g));assert(g==1&&rho==1);
    z=w;z.sigma[1]=R(.001);z.dhat[1]=R(.05);z.ca_delta[0]=z.ca_delta[1]=15;
    g=0;assert(!modal_learning(&in,&z,12,1,z.dhat[1],&rho,&g));assert(rho==-1&&g==0);
    for(i=0;i<60000;i++) {
        assert(e5_reset(&s,i%7==0?11:12,i%3==0?4:(i%3==1?59:60)));
        memset(&in,0,sizeof(in));in.limit[0]=1200;in.limit[1]=i%4?1200:800;
        for(ch=0;ch<2;ch++) {
            in.q[ch]=u(-.0003,.0003);in.velocity[ch]=u(-.0003,.0003);in.acceleration[ch]=u(-.1,.1);
            in.raw_rpm[ch]=i%5?0:(int16_t)(rnd()%81-40);s.ca_delta[ch]=(int16_t)(rnd()%101-50);
            for(n=0;n<s.net[ch].count;n++)for(j=0;j<3;j++)s.net[ch].weight[n][j]=u(-.01,.01);
        }
        if(i%3==0)in.reference[1]=R(.0005);
        if(i%13==0)in.reference[2]=R(.003);
        s.step=19;
        compare(&in,&changed,&reduced);
    }
    assert(changed>0&&reduced==0);
    assert(e5_reset(&s,11,4));memset(&in,0,sizeof(in));in.limit[0]=in.limit[1]=1200;
    for(i=0;i<30000;i++) {
        in.q[0]=R(.001)*(e5_real)sin(i*.013);in.q[1]=R(.0002)*(e5_real)sin(i*.037);
        in.velocity[0]=R(.002)*(e5_real)cos(i*.013);in.velocity[1]=R(.001)*(e5_real)cos(i*.037);
        compare(&in,&changed,&reduced);
    }
    in.q[0]=(e5_real)NAN;assert(!e5_step(&s,&in,&out));assert(s.fault&&out.current[0]==0);
    printf("PASS moving Y-only restore witness rho~.9924; boundaryRejections=%u; same-state60000 modalChanges=%u reductions=%u; exact ordinary30000, R2 rotation/static/priority modes; no extra growth; all output guards.\n",blocked,changed,reduced);
    return 0;
}
