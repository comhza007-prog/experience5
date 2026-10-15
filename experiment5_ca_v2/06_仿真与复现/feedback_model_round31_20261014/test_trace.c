#include <assert.h>
#include <stdio.h>
#include "model_trace.h"
static e5_model_trace t;
int main(void) {
    unsigned ms,i,completed=0,frames=0;float v[107]={0};
    int32_t enc[2]={120,-100};int16_t rpm[2]={5,-6},current[2]={123,-456},cmd[2]={1200,-1200};
    e5_model_reset(&t);
    for(ms=0;ms<=20000;ms++){enc[0]=(int32_t)(ms/10);enc[1]=-(int32_t)(ms/10);assert(e5_model_push(&t,ms,enc,rpm,current,cmd));}
    assert(t.count==2001&&t.rows[2000].ms==20000&&sizeof(e5_model_row)==18);
    e5_model_next(&t,v,0);assert(v[88]==0);
    e5_model_finish(&t);
    for(i=0;i<2001;i++) {
        e5_model_next(&t,v,completed++);assert(v[88]==4435&&v[89]==3&&v[90]==i&&v[92]==2001&&v[96]==i*10);frames++;
        assert((int)v[103]/2401-1200==1200&&((int)v[103]%2401)-1200==-1200);
        e5_model_next(&t,v,completed-1);assert(v[90]==i); /* no TC, no cursor advance */
        e5_model_next(&t,v,completed++);assert(v[90]==i&&v[89]==3);frames++;
    }
    e5_model_next(&t,v,completed);assert(v[89]==4&&v[90]==2000&&frames==4002);
    e5_model_reset(&t);enc[0]=32768;assert(!e5_model_push(&t,0,enc,rpm,current,cmd)&&t.count==0);
    enc[0]=0;cmd[1]=1201;assert(!e5_model_push(&t,0,enc,rpm,current,cmd)&&t.count==0);
    cmd[1]=0;assert(!e5_model_push(&t,65536,enc,rpm,current,cmd));
    for(ms=0;ms<2048;ms++)assert(e5_model_push(&t,ms*10,enc,rpm,current,cmd));
    assert(!e5_model_push(&t,20480,enc,rpm,current,cmd));
    puts("PASS18byte rows; full20s/2001records/4002copies; exact command packing, TC-only cursor, bounds and capacity; no hardware");return 0;
}
