#include <assert.h>
#include <math.h>
#include <stddef.h>
#include <stdio.h>
#include <string.h>
#include "blnn_core.c"
int r2_reset(e5_state*,uint32_t,uint32_t);
int r2_step(e5_state*,const e5_input*,e5_output*);
static e5_state previous,next,old_next;
static unsigned activation,checks;
static void compare(uint32_t method) {
    e5_input in;e5_output a,b;unsigned n,ch;
    memset(&in,0,sizeof(in));in.limit[0]=1200;in.limit[1]=1200;
    assert(r2_reset(&previous,method,4));
    for(n=0;n<6000;n++) {
        in.reference[0]=(e5_real)(.001*(1+sin(n*.013)));
        in.reference[1]=(e5_real)(.0008*cos(n*.013));
        in.reference[2]=(e5_real)(-.00001*sin(n*.013));
        if(n%2000>=1000)in.reference[1]=in.reference[2]=0;
        in.q[0]=in.reference[0]+(e5_real)(.00016*sin(n*.019));
        in.q[1]=(e5_real)(.0003*sin(n*.027));
        in.velocity[0]=(e5_real)(.0004*cos(n*.019));
        in.velocity[1]=(e5_real)(.0005*cos(n*.027));
        in.acceleration[0]=(e5_real)(.004*sin(n*.023));
        in.acceleration[1]=(e5_real)(.003*cos(n*.033));
        in.raw_rpm[0]=(int16_t)(n%41==0?32:(n%17));
        in.raw_rpm[1]=(int16_t)(n%47==0?-33:-(int)(n%13));
        old_next=previous;next=previous;
        memset(&a,0,sizeof(a));memset(&b,0,sizeof(b));
        assert(r2_step(&old_next,&in,&a));assert(e5_step(&next,&in,&b));
        assert(memcmp(a.current,b.current,sizeof(a.current))==0);
        assert(memcmp(a.requested,b.requested,sizeof(a.requested))==0);
        assert(memcmp(a.ca_delta,b.ca_delta,sizeof(a.ca_delta))==0);
        assert(a.ca_mask==b.ca_mask&&a.diagnostic_reason==b.diagnostic_reason);
        assert(a.learning_axis[0]==b.learning_axis[0]&&a.repair_mode[0]==b.repair_mode[0]);
        assert(memcmp(&next.net[0],&old_next.net[0],sizeof(e5_network))==0);
        for(ch=0;ch<2;ch++) {
            if(method==E5_CA_BLNN)
                assert(e5_ca_envelope_ok(in.raw_rpm[ch],(int)b.current[ch],(int)in.limit[ch]));
            else assert(fabs((double)b.current[ch])<=in.limit[ch]);
            assert(isfinite(b.norm[ch]));
        }
        if(method==E5_CA_BLNN)assert(e5_ca_sector_ok(b.sigma,(int)b.ca_delta[0],(int)b.ca_delta[1]));
        if(b.repair_mode[1]==4U) {
            assert(method==E5_CA_BLNN&&a.repair_mode[1]==0U);
            assert(b.ca_mask==E5_CA_PROJECTED&&b.diagnostic_reason==DIAG_REASON_RATE_ONLY);
            assert(b.learning_axis[1]>a.learning_axis[1]);
            assert(b.learning_axis[1]<=b.learning_before_reason);
            assert(b.sync_learning_rho>0&&b.sync_learning_rho<=1);
            assert(next.net[1].count==old_next.net[1].count);
            activation++;
        } else {
            assert(memcmp(&a,&b,offsetof(e5_output,sync_learning_rho))==0);
            assert(memcmp(&next,&old_next,sizeof(next))==0);
        }
        previous=old_next;checks++;
    }
}
int main(void) {
#if DIAG_SYNC_RATE_LEARNING
    e5_output o;e5_input fixture; e5_real rho=-1,learn=0;unsigned i;
    const unsigned masks[]={0,1,3,4,6,8,10,16,18,32,34};
    memset(&o,0,sizeof(o));o.ca_mask=2;o.diagnostic_reason=1;
    memset(&fixture,0,sizeof(fixture));fixture.q[1]=(e5_real)-.0003;
#if DIAG_SYNC_RATE_SCOPE==1
    fixture.reference[1]=(e5_real).0005;
#endif
    o.gate=1;o.sector[1]=1;o.dhat[1]=(e5_real)-.2;
    o.sigma[1]=(e5_real)-.1;o.learning_before_reason=(e5_real).8;
    o.ca_delta[0]=o.ca_delta[1]=-10;
    assert(sync_rate_learning(&fixture,&o,12,(e5_real)-.2,(e5_real).02,&rho,&learn));
    assert(learn>(e5_real).02&&learn<=o.learning_before_reason);
    for(i=0;i<sizeof(masks)/sizeof(masks[0]);i++) {o.ca_mask=masks[i];assert(!sync_rate_learning(&fixture,&o,12,(e5_real)-.2,0,&rho,&learn));}
    o.ca_mask=2;o.diagnostic_reason=5;assert(!sync_rate_learning(&fixture,&o,12,(e5_real)-.2,0,&rho,&learn));
    o.diagnostic_reason=1;assert(!sync_rate_learning(&fixture,&o,11,(e5_real)-.2,0,&rho,&learn));
    assert(!sync_rate_learning(&fixture,&o,12,(e5_real).2,0,&rho,&learn));
    o.ca_delta[0]=o.ca_delta[1]=10;assert(!sync_rate_learning(&fixture,&o,12,(e5_real)-.2,0,&rho,&learn));
    o.ca_delta[0]=o.ca_delta[1]=-10;o.dhat[1]=(e5_real)-.0001;assert(!sync_rate_learning(&fixture,&o,12,(e5_real)-.0001,0,&rho,&learn));
#endif
    compare(E5_BASE);compare(E5_BLNN);compare(E5_CA_BLNN);
#if DIAG_SYNC_RATE_LEARNING
    assert(activation>0);
#else
    assert(activation==0);
#endif
    printf("same_state_checks=%u alpha_restoration=%u\n",checks,activation);
    return 0;
}
