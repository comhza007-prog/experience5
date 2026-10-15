#include <assert.h>
#include <stdio.h>
#include <math.h>
#include "blnn_core.c"
#include "experiment5_formal_actuator.h"
#include "network_trace.h"
volatile float g_e5_online_nn_scale=1,g_e5_online_learning_scale=1;
static e5_replay_blob blob;
static e5_state state;
int main(int argc,char **argv){
    FILE *source;unsigned i,ch;int16_t command[2],before[2];uint32_t speed;
    e5_output out;
    assert(argc==2);source=fopen(argv[1],"rb");assert(source);
    assert(fread(&blob,1,sizeof(blob),source)==sizeof(blob));assert(fgetc(source)==EOF);assert(!fclose(source));
    assert(blob.version==1&&blob.build==67712&&blob.method==12&&blob.count==360&&blob.state_bytes==5348&&blob.row_bytes==80&&blob.input_bytes==48);
    assert(blob.initial.method==12&&blob.initial.fault==0&&blob.initial.net[0].count>=4&&blob.initial.net[0].count<=60&&blob.initial.net[1].count>=4&&blob.initial.net[1].count<=60);
    state=blob.initial;
    puts("ms,predictionY,predictionAlpha,learningY,learningAlpha,commandL,commandR,deltaL,deltaR,mask,cause,repairY,repairAlpha,nodesY,nodesAlpha");
    for(i=0;i<360;i++){
        const e5_input *in=&blob.rows[i].input;
        assert(in->limit[0]==1200&&in->limit[1]==1200);
        assert(e5_step(&state,in,&out));assert(e5_formal_finalize(12,in,&out,command,before,&speed));
        for(ch=0;ch<2;ch++)state.aw[ch]+=.001f*16.0f*((float)command[ch]-out.current[ch]);
        assert(!state.fault);
        printf("%u,%.9g,%.9g,%.9g,%.9g,%d,%d,%.9g,%.9g,%u,%u,%u,%u,%u,%u\n",blob.rows[i].ms,(double)out.dhat[0],(double)out.dhat[1],(double)out.learning_axis[0],(double)out.learning_axis[1],command[0],command[1],(double)out.ca_delta[0],(double)out.ca_delta[1],out.ca_mask,out.diagnostic_reason,out.repair_mode[0],out.repair_mode[1],state.net[0].count,state.net[1].count);
    }
    return 0;
}
