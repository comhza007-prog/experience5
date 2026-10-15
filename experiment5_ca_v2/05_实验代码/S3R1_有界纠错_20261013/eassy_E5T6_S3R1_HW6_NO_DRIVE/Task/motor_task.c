#include "motor_task.h"
#include "CAN_receive.h"
#include "experiment5_repair_fixtures.h"
#include "periodic_release.h"
/* NO DRIVE66212: no arming; CAN sender independently forces both slots0.
 * Synthetic timing/rule check, NOT mechanical or performance evidence. */
volatile uint8_t g_exp5_abort=0;
volatile uint32_t g_exp5_uart_errors=0,g_exp5_drive_permit=0;
extern volatile uint32_t g_exp5_can_errors,g_exp5_can_rejected;
extern volatile uint32_t g_exp5_dma_completed,g_exp5_dma_skipped,g_exp5_uart_last_error;
extern volatile uint32_t g_exp5_bms_errors,g_exp5_bms_valid;
extern float Batvalt;
static e5_repair_fixture fixture;
static e5_state old_state;
static e5_output old_output;
static float published[E5_TELEMETRY_CHANNELS],channels[E5_TELEMETRY_CHANNELS];
static volatile uint32_t sink=0;
void e5_telemetry_snapshot(float values[E5_TELEMETRY_CHANNELS]) {
    taskENTER_CRITICAL();memcpy(values,published,sizeof(published));taskEXIT_CRITICAL();
}
void motor_task(void const *argument) {
    TickType_t wake=xTaskGetTickCount();
    uint32_t boot,n=0,fault=0,errors=0,pairs=0,repairs[2]={0,0},rejected=0,blocked=0;
    uint32_t begin,t0,t1,now,last=0,valid=0,index,method,bin,rebase=0,ch,k;
    uint32_t late=0,overruns=0,stack_at=0,stack_bytes=4096;
    float cpu=(float)SystemCoreClock/1000000.0f,period=0,us=0,peak=0,body,body_peak=0;
    float peaks[2][3]={{0}},old_peak=0;int ok;
    (void)argument;g_exp5_drive_permit=0;
    CoreDebug->DEMCR|=CoreDebug_DEMCR_TRCENA_Msk;DWT->CYCCNT=0;DWT->CTRL|=DWT_CTRL_CYCCNTENA_Msk;
    boot=HAL_GetTick();
    for(;;) {
        begin=DWT->CYCCNT;now=HAL_GetTick();g_exp5_drive_permit=0;
        if(valid){period=(float)(begin-last)/cpu;if(period>1500)late++;}
        valid=1;last=begin;
        if(g_exp5_abort)fault|=32U;
        if(!(DWT->CTRL&DWT_CTRL_CYCCNTENA_Msk))fault|=64U;
        if(!fault && now-boot>=2000U && n<E5_REPAIR_CYCLES) {
            k=n/(2U*E5_REPAIR_CASES);method=k?E5_CA_BLNN:E5_BLNN;index=(n/2U)%E5_REPAIR_CASES;
            if(n%2U==0) {
                e5_repair_prepare(&fixture,method,index);memcpy(&old_state,&fixture.state,sizeof(old_state));
                __DSB();__ISB();t0=DWT->CYCCNT;ok=e5_old_step(&old_state,&fixture.input,&old_output);
                __DSB();__ISB();t1=DWT->CYCCNT;us=(float)(t1-t0)/cpu;if(us>old_peak)old_peak=us;
                if(!ok)errors++;
            } else {
                bin=fixture.nodes==4?0:(fixture.nodes==59?1:2);
                __DSB();__ISB();t0=DWT->CYCCNT;ok=e5_step(&fixture.state,&fixture.input,&fixture.output);
                __DSB();__ISB();t1=DWT->CYCCNT;us=(float)(t1-t0)/cpu;if(us>peak)peak=us;if(us>peaks[k][bin])peaks[k][bin]=us;
                if(!ok || !e5_repair_pair_ok(&old_state,&old_output,&fixture.state,&fixture.output))errors++;
                for(ch=0;ch<2;ch++) {
                    if(fixture.output.repair_mode[ch]==1)repairs[ch]++;
                    if(fixture.output.repair_mode[ch]==2)rejected++;
                }
                if(k && (fixture.mode==5||fixture.mode==6))blocked++;
                pairs++;sink+=(uint32_t)(fixture.output.ca_delta[0]+300);
            }
            n++;if(errors)fault|=64U;
        }
        g_exp5_drive_permit=0;CAN_cmd_3508(0,0);
        channels[0]=(float)now*.001f;channels[2]=fault?9:(n>=E5_REPAIR_CYCLES?6:(n?1:0));
        for(ch=0;ch<3;ch++){channels[3+ch]=peaks[0][ch];channels[6+ch]=peaks[1][ch];}
        channels[13]=0;channels[14]=0;channels[21]=12;channels[22]=(float)fault;
        channels[27]=Batvalt;channels[28]=(float)g_exp5_can_rejected;
        channels[41]=us;channels[42]=peak;channels[43]=period;channels[45]=(float)late;channels[46]=(float)n;channels[57]=(float)overruns;
        if(now-stack_at>=100U){stack_bytes=(uint32_t)(uxTaskGetStackHighWaterMark(NULL)*sizeof(StackType_t));stack_at=now;}
        channels[58]=(float)stack_bytes;channels[59]=(float)g_exp5_uart_errors;channels[60]=body_peak;
        channels[63]=E5_SELECTED_BUILD;channels[69]=(float)g_exp5_dma_completed;channels[70]=(float)g_exp5_dma_skipped;
        channels[71]=(float)g_exp5_uart_last_error;channels[72]=(float)g_exp5_bms_errors;channels[73]=(float)g_exp5_bms_valid;
        channels[74]=(float)repairs[0];channels[75]=(float)repairs[1];channels[76]=(float)pairs;
        channels[77]=(float)g_exp5_can_errors;channels[78]=(float)blocked;
        channels[88]=4471;channels[89]=fault?9:(n>=E5_REPAIR_CYCLES?4:1);
        channels[90]=(float)n;channels[91]=(float)E5_REPAIR_CYCLES;channels[92]=(float)errors;
        channels[93]=old_peak;channels[94]=(float)rejected;channels[95]=(float)(sink&65535U);channels[106]=0;
        taskENTER_CRITICAL();memcpy(published,channels,sizeof(published));taskEXIT_CRITICAL();
        body=(float)(DWT->CYCCNT-begin)/cpu;if(body>body_peak)body_peak=body;
        if(body>=1000.0f){overruns++;fault|=256U;}
        wake=(TickType_t)e5_release_base((uint32_t)xTaskGetTickCount(),(uint32_t)wake,1U,&rebase);vTaskDelayUntil(&wake,1U);
    }
}
