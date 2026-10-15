#include <assert.h>
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include "blnn_core.c"
#include "experiment5_repair_fixtures.h"
static e5_repair_fixture f;
static e5_state old,trajectory,new_trajectory;
static e5_output a,b;
static unsigned seed=781123;
static unsigned rnd(void){seed=1664525U*seed+1013904223U;return seed;}
static e5_real u(e5_real l,e5_real h){return l+(h-l)*(rnd()&65535U)/(e5_real)65535;}
static e5_real raw_sum(const e5_network *n,e5_real ff[E5_MAX_NODES][3]) {
    e5_real z[3]={0,0,0};unsigned i,j;
    for(i=0;i<n->count;i++)for(j=0;j<3;j++)z[j]+=n->weight[i][j]*ff[i][j];
    return z[0]+z[1]+z[2];
}
int main(void) {
    unsigned i,j,ch,n,method,accepted=0,rejected=0,boardrep[2]={0,0},blocked=0;
    e5_real ff[E5_MAX_NODES][3],before,after,norm,learning,sigma,pre,nominal;
    uint32_t hit;int mode;e5_input in;
    for(method=11;method<=12;method++)for(i=0;i<E5_REPAIR_CASES;i++) {
        e5_repair_prepare(&f,method,i);old=f.state;
        assert(e5_old_step(&old,&f.input,&a));assert(e5_step(&f.state,&f.input,&b));
        assert(e5_repair_pair_ok(&old,&a,&f.state,&b));
        for(ch=0;ch<2;ch++)if(b.repair_mode[ch]==1)boardrep[ch]++;
        if(method==12 && (f.mode==5||f.mode==6))blocked++;
    }
    assert(boardrep[0]>0&&boardrep[1]>0&&blocked==750);
    /* Deliberately inconsistent preview input injects the otherwise rare
     * reject path: must leave weights untouched, request leak-only fallback.
     * This is a guard unit test, NOT a reachable recorded-state claim. */
    memset(&f,0,sizeof(f));f.state.net[0].count=4;
    for(n=0;n<4;n++)for(j=0;j<3;j++){ff[n][j]=1;f.state.net[0].weight[n][j]=-1;}
    old=f.state;learning=0;after=1;
    assert(repair_update(&f.state.net[0],ff,1,-1,1,0,0,&learning,&after,&norm,&hit)==2);
    assert(learning==0&&!memcmp(&old,&f.state,sizeof(old)));
    /* Finite extreme weights, both signs, cancellation, gate boundaries. */
    for(i=0;i<100000;i++) {
        e5_network *net=&f.state.net[0];ch=i&1U;net->count=4+rnd()%57;
        for(n=0;n<net->count;n++)for(j=0;j<3;j++) {
            ff[n][j]=u(0,1);net->weight[n][j]=u(ch?-15:-30,ch?15:30);
        }
        before=raw_sum(net,ff);sigma=before>0?-u((e5_real)1e-8,1):u((e5_real)1e-8,1);
        pre=u(0,1);nominal=i%3?0:pre;learning=nominal;after=before;old=f.state;
        mode=repair_update(net,ff,before,sigma,pre,nominal,ch,&learning,&after,&norm,&hit);
        if(mode==1) {
            assert(raw_sum(net,ff)==after);
            assert(before>0?(after>=0&&after<=before):(after<=0&&after>=before));
            assert(learning>nominal&&learning<=pre);accepted++;
            for(n=0;n<net->count;n++)for(j=0;j<3;j++)assert(fabs((double)net->weight[n][j])<=(ch?15:30));
        } else {
            assert(!memcmp(net,&old.net[0],sizeof(*net)));
            if(mode==2){assert(learning==0);rejected++;}
        }
    }
    /* Persistent ordinary BLNN: exact controls, weights, growth and AW. */
    assert(e5_reset(&trajectory,11,4));new_trajectory=trajectory;
    memset(&in,0,sizeof(in));in.limit[0]=1200;in.limit[1]=800;
    for(i=0;i<60000;i++) {
        in.q[0]=(e5_real)(.001*sin(i*.013));in.q[1]=(e5_real)(.0002*sin(i*.037));
        in.velocity[0]=(e5_real)(.002*cos(i*.013));in.velocity[1]=(e5_real)(.001*cos(i*.037));
        in.acceleration[0]=(e5_real)(.01*cos(i*.031));in.acceleration[1]=(e5_real)(.1*cos(i*.011));
        for(ch=0;ch<2;ch++)in.raw_rpm[ch]=(int16_t)(80*cos(i*.01+ch));
        assert(e5_old_step(&trajectory,&in,&a));assert(e5_step(&new_trajectory,&in,&b));
        assert(e5_repair_pair_ok(&trajectory,&a,&new_trajectory,&b));
    }
    /* Evolving CA with unchanged current/sector/slew/speed guards. */
    assert(e5_reset(&new_trajectory,12,4));
    for(i=0;i<60000;i++) {
        in.q[0]=(e5_real)(.001*sin(i*.013));in.q[1]=(e5_real)(.0002*sin(i*.037));
        in.velocity[0]=(e5_real)(.002*cos(i*.013));in.velocity[1]=(e5_real)(.001*cos(i*.037));
        in.acceleration[0]=(e5_real)(.01*cos(i*.031));in.acceleration[1]=(e5_real)(.1*cos(i*.011));
        for(ch=0;ch<2;ch++)in.raw_rpm[ch]=(int16_t)(40*cos(i*.01+ch));
        old=new_trajectory;assert(e5_step(&new_trajectory,&in,&b));
        assert(e5_ca_sector_ok(b.sigma,(int)b.ca_delta[0],(int)b.ca_delta[1]));
        for(ch=0;ch<2;ch++) {
            assert(e5_ca_envelope_ok(in.raw_rpm[ch],(int)b.current[ch],(int)in.limit[ch]));
            assert(fabs((double)b.ca_delta[ch])<=300);
            if(!(b.ca_mask&(E5_CA_CONTRACTED|E5_CA_WITHDRAWN)))assert(abs((int)b.ca_delta[ch]-old.ca_delta[ch])<=2);
            assert(b.learning_axis[ch]>=0&&b.learning_axis[ch]<=1);
            if(b.repair_mode[ch]) {
                assert(!(b.ca_mask&(E5_CA_AMPLITUDE|E5_CA_SPEED)));
                assert(!(b.diagnostic_reason&DIAG_REASON_HARD_CLIP));
                assert(old.net[ch].count==new_trajectory.net[ch].count);
                if(b.repair_mode[ch]==1) {
                    assert(b.repair_after[ch]==raw_sum(&new_trajectory.net[ch],new_trajectory.features[ch]));
                    assert(b.repair_before[ch]>0?(b.repair_after[ch]>=0&&b.repair_after[ch]<=b.repair_before[ch]):
                        (b.repair_after[ch]<=0&&b.repair_after[ch]>=b.repair_before[ch]));
                }
            }
        }
    }
    in.q[0]=(e5_real)NAN;assert(!e5_step(&new_trajectory,&in,&b));assert(new_trajectory.fault&&b.current[0]==0);
    printf("PASS fixtures6000 boardRepairY=%u alpha=%u hardSpeedFixtures=%u; fuzz100000 accepted=%u rejected=%u; BLNN60000 exact; CA60000 guards.\n",boardrep[0],boardrep[1],blocked,accepted,rejected);
    return 0;
}
