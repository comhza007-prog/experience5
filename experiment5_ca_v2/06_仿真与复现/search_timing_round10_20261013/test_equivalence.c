#include <assert.h>
#include <math.h>
#include <stdio.h>
#include <string.h>
#include "blnn_core.h"
#include "test_export.h"
int legacy_init(unsigned method);
int legacy_run(const e5_input *in,double *v,unsigned *len);
static e5_state s;static double original[1600],candidate[1600];
int main(void){
    e5_input in;e5_output o;unsigned method,n,j,k,a,b,total=0;
    for(method=E5_BASE;method<=E5_CA_BLNN;method++){
        assert(legacy_init(method));assert(e5_reset(&s,method,4));memset(&in,0,sizeof(in));
        in.limit[0]=1200;in.limit[1]=800;
        for(n=0;n<30000;n++){
            in.q[0]=(e5_real)(.001*sin(n*.013));in.q[1]=(e5_real)(.0002*sin(n*.037));
            in.velocity[0]=(e5_real)(.002*cos(n*.013));in.velocity[1]=(e5_real)(.001*cos(n*.037));
            in.acceleration[0]=(e5_real)(.01*cos(n*.031));in.acceleration[1]=(e5_real)(.1*cos(n*.011));
            for(j=0;j<2;j++)in.raw_rpm[j]=(int16_t)(80*cos(n*.01+j));
            assert(legacy_run(&in,original,&a));assert(e5_step(&s,&in,&o));b=export_values(&s,&o,candidate);
            candidate[b++]=o.diagnostic_reason;candidate[b++]=o.admitted_fraction;candidate[b++]=o.learning_before_reason;
            assert(a==b&&b<1600);for(k=0;k<b;k++)assert(original[k]==candidate[k]);total++;
        }
    }
    printf("PASS exact offline/production equivalence: %u steps, all commands, predictions, weights, centers, scratch features, growth, AW, gates and reason/fraction/pre-gate.\n",total);return 0;
}
