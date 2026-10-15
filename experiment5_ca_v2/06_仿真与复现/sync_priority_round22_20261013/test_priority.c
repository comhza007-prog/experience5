#include <assert.h>
#include <stddef.h>
#include <stdio.h>
#include <string.h>
#include "blnn_core.c"
int e5_r8_reset(e5_state *,uint32_t,uint32_t);
int e5_r8_step(e5_state *,const e5_input *,e5_output *);
static e5_state state,prior;
static e5_output out,old;
static unsigned seed=739285U;
static unsigned rnd(void){seed=1664525U*seed+1013904223U;return seed;}
static e5_real u(double l,double h){return (e5_real)(l+(h-l)*(rnd()&65535U)/65535.0);}
static void compare(e5_input *in,int exact) {
    unsigned ch,n,j;
    uint32_t old_y_count=state.net[0].count;
    prior=state;memset(&old,0,sizeof(old));
    assert(e5_step(&state,in,&out));assert(e5_r8_step(&prior,in,&old));
    assert(out.translation_fraction>0&&out.translation_fraction<=1);
    if(exact || out.translation_fraction==1) {
        assert(memcmp(&state,&prior,sizeof(state))==0);
        assert(memcmp(&out,&old,offsetof(e5_output,translation_fraction))==0);
    } else {
        assert(state.method==12&&in->limit[0]==in->limit[1]);
        assert(out.learning_axis[0]<=out.translation_fraction*out.learning_before_reason+(e5_real)1e-6);
        assert(state.net[0].count==old_y_count);
        if(out.repair_mode[0]==1U) {
            assert(out.repair_before[0]*out.repair_after[0]>=0);
            assert(ABS(out.repair_after[0])<=ABS(out.repair_before[0]));
        }
        for(ch=0;ch<2;ch++) {
            assert(out.sigma[ch]==old.sigma[ch]&&out.dhat[ch]==old.dhat[ch]);
            assert(out.sector[ch]==old.sector[ch]&&out.ca_base[ch]==old.ca_base[ch]);
            assert(state.k2[ch]==prior.k2[ch]);
        }
        for(ch=0;ch<2;ch++)for(n=0;n<state.net[ch].count;n++)for(j=0;j<3;j++)
            assert(ABS(state.net[ch].weight[n][j])<=(ch?15:30));
    }
}
int main(void) {
    e5_input in;unsigned n,ch,method,changed=0;
    memset(&in,0,sizeof(in));in.limit[0]=in.limit[1]=1200;
    for(n=0;n<100000;n++) {
        e5_real expected,skew,budget;
        in.q[0]=u(-.002,.002);in.q[1]=u(-.003,.003);in.reference[0]=u(-.002,.002);
        skew=ABS((e5_real).60*in.q[1]);budget=2*ABS(in.q[0]-in.reference[0])+(e5_real).000050;
        expected=skew>budget?budget/skew:1;
#if !DIAG_SYNC_PRIORITY
        expected=1;
#endif
        assert(translation_fraction(12,&in)==expected);
        assert(translation_fraction(11,&in)==1&&translation_fraction(10,&in)==1);
        in.limit[1]=800;assert(translation_fraction(12,&in)==1);in.limit[1]=1200;
    }
    for(method=10;method<=12;method++) {
        assert(e5_reset(&state,method,4));
        memset(&in,0,sizeof(in));in.limit[0]=in.limit[1]=1200;
        for(n=0;n<30000;n++) {
            for(ch=0;ch<2;ch++) {
                in.q[ch]=u(-.001,.001);in.velocity[ch]=u(-.003,.003);
                in.acceleration[ch]=u(-.03,.03);in.raw_rpm[ch]=(int16_t)((int)(rnd()%71)-35);
            }
            /* Large mean error => beta1, so full CA dynamics remain exact. */
            in.q[0]=-.001;in.reference[0]=.002;
            in.reference[1]=u(-.001,.001);in.reference[2]=u(-.001,.001);
            compare(&in,1);
        }
    }
    for(n=0;n<60000;n++) {
        assert(e5_reset(&state,12,4));memset(&in,0,sizeof(in));
        in.limit[0]=in.limit[1]=1200;in.reference[0]=.002;
        in.q[0]=u(.0019,.0021);in.q[1]=u(-.001,.001);
        for(ch=0;ch<2;ch++) {
            in.velocity[ch]=u(-.002,.002);in.acceleration[ch]=u(-.02,.02);
            in.raw_rpm[ch]=(int16_t)((int)(rnd()%121)-60);
            state.ca_delta[ch]=(int16_t)((int)(rnd()%601)-300);
            for(unsigned node=0;node<4;node++)for(unsigned j=0;j<3;j++)state.net[ch].weight[node][j]=u(-1,1);
        }
        state.step=n%20;compare(&in,0);if(out.translation_fraction<1)changed++;
        if(n%2==0){state=prior;in.limit[1]=800;compare(&in,1);}
    }
    printf("PASS 100000 beta identities, 90000 exact BASE/BLNN/beta1 steps, 60000 priority states (%u active), 30000 asymmetric exact states.\n",changed);
    puts("LIMITATION: command/gradient consistency, not measured-force or closed-loop stability proof.");return 0;
}
