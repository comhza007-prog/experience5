#include <assert.h>
#include <math.h>
#include <stdio.h>
#include <string.h>
#include "experiment5_ca_actuator.h"
int e5_r2_reset(e5_state *,uint32_t,uint32_t);
int e5_r2_step(e5_state *,const e5_input *,e5_output *);
static e5_state state,prior;
static unsigned seed=463157U;
static unsigned rnd(void){seed=1664525U*seed+1013904223U;return seed;}
static e5_real u(double l,double h){return (e5_real)(l+(h-l)*(rnd()&65535U)/65535.0);}
int main(void) {
    unsigned n,ch,method,extended=0; e5_real sigma[2],wy,wa,by,ba;
    int dl,dr,old_ok,new_ok;e5_ca_sector_cache cache;
    e5_input in;e5_output out,old;
    for(n=0;n<200000;n++) {
        sigma[0]=u(-.1,.1);sigma[1]=u(-.1,.1);
        dl=(int)(rnd()%601)-300;dr=(int)(rnd()%601)-300;
        wy=sigma[0]*(e5_real).006197916666666667*(e5_real)(dl-dr);
        wa=-sigma[1]*(e5_real).3*(e5_real).006197916666666667*(e5_real)(dl+dr);
        by=(e5_real)(DIAG_SECTOR_FRACTION*40)*sigma[0]*sigma[0];
        ba=(e5_real)(DIAG_SECTOR_FRACTION*25)*sigma[1]*sigma[1];
        old_ok=wy<=by+(e5_real)1e-10*(1+by)&&wa<=ba+(e5_real)1e-10*(1+ba);
        new_ok=e5_ca_sector_ok(sigma,dl,dr);
        e5_ca_sector_prepare(sigma,&cache);
        assert(new_ok==e5_ca_sector_cached_ok(&cache,dl,dr));
        assert(!old_ok||new_ok);
        if(new_ok) {
            assert((double)wa<=(double)ba+1e-7*(1+(double)ba));
            assert((double)wy+(double)wa<=(double)by+(double)ba+1e-7*(1+(double)by+(double)ba));
        }
#if DIAG_JOINT_TRANSLATION
        if(wa>=0)assert(old_ok==new_ok);
        if(new_ok&&!old_ok){assert(wa<0);extended++;}
#else
        assert(old_ok==new_ok);
#endif
    }
    for(method=10;method<=12;method++) {
#if DIAG_JOINT_TRANSLATION
        if(method==12)continue;
#endif
        assert(e5_reset(&state,method,4));assert(e5_r2_reset(&prior,method,4));
        memset(&in,0,sizeof(in));
        for(n=0;n<30000;n++) {
            for(ch=0;ch<2;ch++) {
                in.q[ch]=u(-.002,.002);in.velocity[ch]=u(-.003,.003);
                in.acceleration[ch]=u(-.03,.03);in.limit[ch]=1200;
                in.raw_rpm[ch]=(int16_t)((int)(rnd()%71)-35);
            }
            in.reference[0]=u(0,.002);in.reference[1]=u(-.001,.001);in.reference[2]=u(-.001,.001);
            assert(e5_step(&state,&in,&out));assert(e5_r2_step(&prior,&in,&old));
            assert(memcmp(&state,&prior,sizeof(state))==0);
            assert(memcmp(&out,&old,sizeof(out))==0);
        }
    }
    printf("PASS 200000 sector sets: cached/direct exact, old-feasible retained, alpha and joint work bounded; extra feasible=%u. BASE/BLNN exact; disabled CA exact when tested.\n",extended);
    return 0;
}
