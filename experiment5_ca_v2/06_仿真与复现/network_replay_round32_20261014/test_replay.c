#include <assert.h>
#include <stdio.h>
#include <math.h>
#include "blnn_core.c"
#include "experiment5_formal_actuator.h"
#include "network_trace.h"
volatile float g_e5_online_nn_scale=1,g_e5_online_learning_scale=1;
static e5_replay_trace trace;
static e5_state state,without_log,replayed;
static void step(e5_state *s,const e5_input *in,e5_output *out,int16_t cmd[2]){
    int16_t pre[2];uint32_t mask,ch;
    assert(e5_step(s,in,out));assert(e5_formal_finalize(12,in,out,cmd,pre,&mask));
    for(ch=0;ch<2;ch++)s->aw[ch]+=.001f*16.0f*((float)cmd[ch]-out->current[ch]);
}
static void close_float(float actual,float expected){
    assert(isfinite(actual)&&isfinite(expected));
    if(fabsf(actual-expected)>.00001f+.00002f*fabsf(expected))fprintf(stderr,"Float mismatch actual=%.9g expected=%.9g absoluteDiff=%.9g\n",(double)actual,(double)expected,(double)fabsf(actual-expected));
    assert(fabsf(actual-expected)<=.00001f+.00002f*fabsf(expected));
}
static void compare_state(const e5_state *a,const e5_state *b){
    unsigned ch,n,j;
    assert(a->step==b->step&&a->growth==b->growth&&a->method==b->method&&a->fixed_nodes==b->fixed_nodes&&a->fault==b->fault);
    assert(a->ca_fallbacks==b->ca_fallbacks&&a->ca_contractions==b->ca_contractions);
    close_float(a->gate,b->gate);
    for(ch=0;ch<2;ch++){
        assert(a->net[ch].count==b->net[ch].count&&a->net[ch].projections==b->net[ch].projections&&a->ca_delta[ch]==b->ca_delta[ch]);
        close_float(a->aw[ch],b->aw[ch]);close_float(a->k2[ch],b->k2[ch]);
        for(n=0;n<60;n++){
            for(j=0;j<5;j++)close_float(a->net[ch].center[n][j],b->net[ch].center[n][j]);
            for(j=0;j<3;j++){close_float(a->net[ch].weight[n][j],b->net[ch].weight[n][j]);close_float(a->features[ch][n][j],b->features[ch][n][j]);}
        }
    }
}
static void verify_captured(void){
    unsigned i,ch;e5_output out;int16_t cmd[2];
    assert(trace.blob.version==1&&trace.blob.build==67612&&trace.blob.method==12);
    assert(trace.blob.state_bytes==sizeof(e5_state)&&trace.blob.input_bytes==sizeof(e5_input)&&trace.blob.row_bytes==80&&trace.blob.count==360);
    assert(trace.blob.initial.method==12&&trace.blob.initial.fault==0&&trace.blob.final.fault==0);
    assert(trace.blob.initial.net[0].count<=60&&trace.blob.initial.net[1].count<=60);
    replayed=trace.blob.initial;
    for(i=0;i<360;i++){
        const e5_replay_row *r=&trace.blob.rows[i];assert(r->input.limit[0]==1200&&r->input.limit[1]==1200);
        assert(i==0?r->ms==trace.blob.first_ms:r->ms>trace.blob.rows[i-1].ms);
        step(&replayed,&r->input,&out,cmd);
        if(memcmp(cmd,r->command,sizeof(cmd)))fprintf(stderr,"Recorded replay command mismatch index=%u ms=%u actual=[%d,%d] expected=[%d,%d]\n",i,r->ms,cmd[0],cmd[1],r->command[0],r->command[1]);
        assert(!memcmp(cmd,r->command,sizeof(cmd)));
        assert(out.ca_mask==r->mask&&out.diagnostic_reason==r->cause);
        for(ch=0;ch<2;ch++){close_float(out.dhat[ch],r->prediction[ch]);close_float(out.learning_axis[ch],r->learning[ch]);}
    }
    compare_state(&replayed,&trace.blob.final);
    puts("PASS recorded-input baseline replay:360 integer commands/masks/causes exact;prediction/learning/final floats within predefined1e-5abs+2e-5rel;NOT a closed-loop counterfactual");
}
int main(int argc,char **argv){
    unsigned i,ch,completed=0,status3=0,loops=0;float v[107]={0};
    int rate_case=argc==2&&!strcmp(argv[1],"--rate-test");
    e5_input in; e5_output out,original;int16_t cmd[2],oldcmd[2];FILE *binary,*csv;
    assert(sizeof(e5_input)==48&&sizeof(e5_state)==5348&&sizeof(e5_replay_row)==80&&sizeof(trace)<=40960);
    if(argc==2&&!rate_case){
        binary=fopen(argv[1],"rb");assert(binary);
        assert(fread(&trace.blob,1,sizeof(trace.blob),binary)==sizeof(trace.blob));assert(fgetc(binary)==EOF);assert(!fclose(binary));
        verify_captured();return 0;
    }
    assert((e5_replay_crc_update(0xffffffffU,(const uint8_t*)"123456789",9)^0xffffffffU)==0xcbf43926U);
    assert(e5_reset(&state,12,4));
    if(rate_case){for(i=0;i<4;i++)for(ch=0;ch<3;ch++)state.net[0].weight[i][ch]=-.1f;state.step=5360;}
    without_log=state;e5_replay_reset(&trace);
    memset(&in,0,sizeof(in));in.limit[0]=in.limit[1]=1200;
    for(i=rate_case?5360U:0U;i<E5_REPLAY_TRIGGER_MS+E5_REPLAY_ROWS+5;i++){
        e5_motion_reference(i,(float*)in.reference);
        in.q[0]=in.reference[0]-.00005f*sinf((float)i*.011f);
        in.q[1]=.00002f*sinf((float)i*.009f);
        in.velocity[0]=in.reference[1]+.0001f*cosf((float)i*.021f);
        in.velocity[1]=.00008f*cosf((float)i*.013f);
        in.acceleration[0]=.008f*sinf((float)i*.03f);in.acceleration[1]=.009f*cosf((float)i*.025f);
        in.raw_rpm[0]=(int16_t)(i%41)-20;in.raw_rpm[1]=(int16_t)(i%51)-25;
        if(rate_case){
            /* Artificial useful-compensation/rate-only fixture, not a physical run. */
            in.q[0]=in.reference[0]-.000020f;in.q[1]=0;
            in.velocity[0]=in.reference[1];in.velocity[1]=0;
            in.acceleration[0]=in.reference[2];in.acceleration[1]=0;
            in.raw_rpm[0]=in.raw_rpm[1]=0;
        }
        assert(e5_replay_before(&trace,i,&state,&in,67612));
        step(&state,&in,&out,cmd);step(&without_log,&in,&original,oldcmd);
        assert(e5_replay_after(&trace,&state,&out,cmd));
        assert(!memcmp(&state,&without_log,sizeof(state))&&!memcmp(cmd,oldcmd,sizeof(cmd)));
    }
    assert(trace.ready&&trace.blob.count==360&&trace.blob.first_ms==5360&&trace.blob.last_ms==5719);
    replayed=trace.blob.initial;
    for(i=0;i<360;i++){
        const e5_replay_row *r=&trace.blob.rows[i];
        step(&replayed,&r->input,&out,cmd);
        assert(!memcmp(cmd,r->command,sizeof(cmd)));
        assert(out.ca_mask==r->mask&&out.diagnostic_reason==r->cause);
        for(ch=0;ch<2;ch++)assert(out.dhat[ch]==r->prediction[ch]&&out.learning_axis[ch]==r->learning[ch]);
    }
    assert(!memcmp(&replayed,&trace.blob.final,sizeof(replayed)));
    binary=fopen(rate_case?"synthetic_rate_replay.bin":"synthetic_replay.bin","wb");assert(binary);assert(fwrite(&trace.blob,1,sizeof(trace.blob),binary)==sizeof(trace.blob));assert(!fclose(binary));
    csv=fopen(rate_case?"synthetic_rate_replay.csv":"synthetic_replay.csv","wb");assert(csv);
    for(i=0;i<107;i++)fprintf(csv,"%sI%u",i?",":"",i);
    fprintf(csv,"\n");
    while(!trace.complete){
        uint32_t cursor_after;float copy[107];
        e5_replay_next(&trace,v,completed);assert(v[88]==4436);
        cursor_after=trace.cursor;
        memcpy(copy,v,sizeof(v));
        if(v[89]==3){status3++;e5_replay_next(&trace,v,completed);assert(!memcmp(copy,v,sizeof(v))&&trace.cursor==cursor_after);}
        v[0]=(float)(loops+1)*.040f;v[1]=(float)(loops+1);v[2]=6;v[21]=12;v[63]=67612;v[87]=6;
        for(i=0;i<107;i++)fprintf(csv,"%s%.9g",i?",":"",(double)v[i]);
        fprintf(csv,"\n");
        completed++;loops++;assert(loops<6000);
    }
    assert(status3==2U*((sizeof(trace.blob)+15U)/16U));assert(v[89]==4);assert(!fclose(csv));
    e5_replay_reset(&trace);memset(v,0,sizeof(v));e5_replay_next(&trace,v,0);assert(v[89]==5);
    assert(e5_replay_before(&trace,5360,&state,&in,67612));assert(!e5_replay_before(&trace,5361,&state,&in,67612));
    cmd[0]=1201;assert(!e5_replay_after(&trace,&state,&out,cmd));
    printf("PASS unchanged controller/state/commands for%usteps;360 full-state recurrent replay exact;CRC32 vector;TC-only two-copy bytes;bounds;trace=%u blob=%u row=%u state=%u;artificialRateFixture=%d\n",rate_case?365U:5725U,(unsigned)sizeof(trace),(unsigned)sizeof(trace.blob),(unsigned)sizeof(e5_replay_row),(unsigned)sizeof(e5_state),rate_case);
    return 0;
}
