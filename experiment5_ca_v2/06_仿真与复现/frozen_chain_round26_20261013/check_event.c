#include <stdio.h>
#include <math.h>
#include "experiment5_ca_actuator.h"
int main(void) {
    double bl,br,sy,sa,py,pa,gy,ga,gate;int rl,rr,pl,pr;
    const e5_real k=(e5_real).006197916666666667;
    while(scanf("%lf%lf%lf%lf%lf%lf%lf%lf%lf%d%d%d%d",
        &bl,&br,&sy,&sa,&py,&pa,&gy,&ga,&gate,&rl,&rr,&pl,&pr)==13) {
        e5_real base[2]={(e5_real)bl,(e5_real)br},sigma[2]={(e5_real)sy,(e5_real)sa};
        e5_real lim[2]={1200,1200},corr[2],y,alpha;int16_t rpm[2]={(int16_t)rl,(int16_t)rr},prev[2]={(int16_t)pl,(int16_t)pr};
        e5_ca_actuation a;y=(e5_real)-gy*(e5_real)(py>80?80:py<-80?-80:py);
        alpha=(e5_real)-ga*(e5_real)(pa>10?10:pa<-10?-10:pa);
        corr[0]=(y/(2*k)-alpha/((e5_real).6*k))*(e5_real)gate;
        corr[1]=(-y/(2*k)-alpha/((e5_real).6*k))*(e5_real)gate;
        if(!e5_ca_allocate(base,corr,sigma,lim,rpm,prev,&a))return 2;
        printf("%d %d %u %u %.9g\n",(int)a.delta[0],(int)a.delta[1],a.mask,a.learning_reason,(double)a.admitted_fraction);
    }
    return ferror(stdin)?1:0;
}
