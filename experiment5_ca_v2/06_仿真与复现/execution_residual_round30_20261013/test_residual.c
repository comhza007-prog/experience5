#include <assert.h>
#include <stdio.h>
#include <math.h>
#include "blnn_core.c"
#include "experiment5_formal_actuator.h"
int e5_r2_step(e5_state *,const e5_input *,e5_output *);
static e5_state s,prior;
static unsigned seed=423689;
static unsigned rnd(void){seed=1664525U*seed+1013904223U;return seed;}
static e5_real u(double lo,double hi){return (e5_real)(lo+(hi-lo)*(rnd()&65535U)/65535.0);}
int main(void) {
    e5_input in;e5_output out,old;unsigned i,ch,n,j,applications=0;
    for(i=0;i<60000;i++) {
        assert(e5_reset(&s,i%5?12:11,i%3==0?4:(i%3==1?59:60)));
        memset(&in,0,sizeof(in));in.limit[0]=1200;in.limit[1]=i%4?1200:800;
        in.reference[1]=i%2?R(.0005):0;
        for(ch=0;ch<2;ch++) {
            in.q[ch]=u(-.0003,.0003);in.velocity[ch]=u(-.0003,.0003);in.acceleration[ch]=u(-.1,.1);
            in.raw_rpm[ch]=i%7?0:(int16_t)(rnd()%81-40);s.ca_delta[ch]=(int16_t)(rnd()%101-50);
            for(n=0;n<s.net[ch].count;n++)for(j=0;j<3;j++)s.net[ch].weight[n][j]=u(-.01,.01);
        }
        s.step=19;prior=s;
        assert(e5_step(&s,&in,&out)&&e5_r2_step(&prior,&in,&old));
#if !DIAG_EXECUTION_RESIDUAL
        assert(!memcmp(&s,&prior,sizeof(s))&&!memcmp(&out,&old,sizeof(out)));
#else
        if(s.method==E5_BLNN)assert(!memcmp(&s,&prior,sizeof(s))&&!memcmp(&out,&old,sizeof(out)));
        /* Same state -> identical current output; only next-step weights differ. */
        for(ch=0;ch<2;ch++){assert(out.current[ch]==old.current[ch]);assert(out.ca_delta[ch]==old.ca_delta[ch]);assert(finite_value(out.norm[ch]));}
        if(s.method==E5_CA_BLNN)assert(e5_ca_sector_ok(out.sigma,(int)out.ca_delta[0],(int)out.ca_delta[1]));
        {int16_t command[2],pre_guard[2];uint32_t mask;
        assert(e5_formal_finalize(s.method,&in,&out,command,pre_guard,&mask));
        for(ch=0;ch<2;ch++){assert(e5_ca_envelope_ok(in.raw_rpm[ch],command[ch],(int)in.limit[ch]));applications+=out.repair_mode[ch]==4;}}
#endif
    }
#if DIAG_EXECUTION_RESIDUAL
    for(i=0;i<100000;i++) {
        e5_network net,before_net;e5_real cached[E5_MAX_NODES][3],target,after,norm=0,sum[3]={0,0,0},before,p=0;uint32_t hit=0;int ok;
        ch=i%2;memset(&net,0,sizeof(net));net.count=i%3==0?4:(i%3==1?59:60);
        for(n=0;n<net.count;n++)for(j=0;j<3;j++){cached[n][j]=u(.01,1);net.weight[n][j]=u(0,ch?15:30);if(i%4==0)net.weight[n][j]=-net.weight[n][j];sum[j]+=net.weight[n][j]*cached[n][j];p+=cached[n][j]*cached[n][j];}
        before=sum[0]+sum[1]+sum[2];target=before*u(0,1);before_net=net;
        ok=execution_residual_update(&net,cached,target,before>0?1:-1,ch,&after,&norm,&hit);
        if(ok){assert(ABS(after-target)<=ABS(before-target));assert(after*before>=0);assert(finite_value(norm));for(n=0;n<net.count;n++)for(j=0;j<3;j++)assert(ABS(net.weight[n][j])<=(ch?15:30));}
        else assert(!memcmp(&net,&before_net,sizeof(net)));
        assert(p>0);
    }
#endif
    printf("PASS60000 same-state outputs/original guards; disabled exactR2 or ordinary unchanged; local projected residual100000 when enabled; observed extra-update cycles=%u.\n",applications);
    return 0;
}
