#include <assert.h>
#include <stdio.h>
#include <math.h>
#include "blnn_core.c"
#include "experiment5_formal_actuator.h"
int e5_ordinary_original_step(e5_state *,const e5_input *,e5_output *);
volatile float g_e5_online_nn_scale=1,g_e5_online_learning_scale=1;
static e5_state s,prior;static unsigned seed=670942;
static unsigned rnd(void){seed=1664525U*seed+1013904223U;return seed;}
static e5_real u(double lo,double hi){return (e5_real)(lo+(hi-lo)*(rnd()&65535U)/65535.0);}
int main(void) {
    unsigned i,ch,n,j;e5_input in;e5_output out,old;int16_t cmd[2],oldcmd[2],before[2];uint32_t mask;
    for(i=0;i<60000;i++) {
        assert(e5_reset(&s,11,i%3==0?4:(i%3==1?59:60)));memset(&in,0,sizeof(in));
        in.limit[0]=1200;in.limit[1]=i%4?1200:800;in.reference[1]=i%2?R(.0005):0;
        for(ch=0;ch<2;ch++){in.q[ch]=u(-.0003,.0003);in.velocity[ch]=u(-.0003,.0003);in.acceleration[ch]=u(-.1,.1);in.raw_rpm[ch]=(int16_t)(rnd()%81-40);for(n=0;n<s.net[ch].count;n++)for(j=0;j<3;j++)s.net[ch].weight[n][j]=u(-.01,.01);}
        s.step=19;prior=s;assert(e5_step(&s,&in,&out)&&e5_ordinary_original_step(&prior,&in,&old));
        assert(!memcmp(&s,&prior,sizeof(s)));
        for(ch=0;ch<2;ch++){assert(out.requested[ch]==old.requested[ch]&&out.current[ch]==old.current[ch]&&out.sigma[ch]==old.sigma[ch]&&out.dhat[ch]==old.dhat[ch]&&out.norm[ch]==old.norm[ch]);}
        assert(e5_formal_finalize(11,&in,&out,cmd,before,&mask)&&e5_formal_finalize(11,&in,&old,oldcmd,before,&mask));
        assert(cmd[0]==oldcmd[0]&&cmd[1]==oldcmd[1]);
    }
    puts("PASS60000 new ordinary controller states/outputs/final guarded commands exact archived65511; diagnostic extensions excluded");return 0;
}
