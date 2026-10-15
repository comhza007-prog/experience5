#include "motor_task.h"
#include "CAN_receive.h"
#include "experiment5_five_fixtures.h"
#include "periodic_release.h"
/* NO DRIVE66012: same fixtures as prior board check, all five formal laws.
 * Computed commands NEVER reach CAN; sender independently forces zero.
 * Raw old-reference kernels are unoptimized; production kernels retain
 * exactly equivalent math/cache/pruning. No mechanical qualification here.
 * Secure unloaded mechanism: zero current is not a holding brake. */
volatile uint8_t g_exp5_abort=0;
volatile uint32_t g_exp5_uart_errors=0,g_exp5_drive_permit=0;
extern volatile uint32_t g_exp5_can_errors,g_exp5_can_rejected;
extern volatile uint32_t g_exp5_dma_completed,g_exp5_dma_skipped,g_exp5_uart_last_error;
extern volatile uint32_t g_exp5_bms_errors,g_exp5_bms_valid;
extern float Batvalt;
static e5_learning_fixture fixture;
static e5_state reference_state;
static e5_output reference_output;
static float published[E5_TELEMETRY_CHANNELS],channels[E5_TELEMETRY_CHANNELS];
static volatile uint32_t result_sink=0;
void e5_telemetry_snapshot(float values[E5_TELEMETRY_CHANNELS]) {
    taskENTER_CRITICAL();memcpy(values,published,sizeof(published));taskEXIT_CRITICAL();
}
static void publish(void) {
    taskENTER_CRITICAL();memcpy(published,channels,sizeof(published));taskEXIT_CRITICAL();
}
void motor_task(void const *argument) {
    TickType_t wake=xTaskGetTickCount();
    uint32_t boot,n=0,fault=0,errors=0,pairs=0,partial=0,growth=0,mixed=0,old_rate=0,blnn=0;
    uint32_t begin,t0,t1,now,last=0,valid=0,variant=0,index,node_index,rebase=0;
    uint32_t late=0,overruns=0,stack_at=0,stack_bytes=4096,ch,v;
    const uint32_t peak_channel[5]={3,6,9,15,18};
    float cpu=(float)SystemCoreClock/1000000.0f,period=0,core_us=0,core_peak=0,body,body_peak=0;
    float peaks[5][3]={{0}},ref_peaks[3]={0};int ok;
    e5_five_step_fn step_fn;
    (void)argument;g_exp5_drive_permit=0;
    CoreDebug->DEMCR|=CoreDebug_DEMCR_TRCENA_Msk;DWT->CYCCNT=0;DWT->CTRL|=DWT_CTRL_CYCCNTENA_Msk;
    boot=HAL_GetTick();
    for(;;) {
        begin=DWT->CYCCNT;now=HAL_GetTick();g_exp5_drive_permit=0;
        if(valid){period=(float)(begin-last)/cpu;if(period>1500)late++;}
        valid=1;last=begin;
        if(g_exp5_abort)fault|=32U;
        if(!(DWT->CTRL&DWT_CTRL_CYCCNTENA_Msk))fault|=64U;
        if(!fault && now-boot>=2000U && n<E5_FIVE_CYCLES) {
            variant=n/(2U*E5_FIVE_CASES);index=(n/2U)%E5_FIVE_CASES;
            e5_five_prepare(&fixture,variant,index);
            node_index=fixture.nodes==4U?0U:(fixture.nodes==59U?1U:2U);
            if(n%2U==0U) {
                memcpy(&reference_state,&fixture.state,sizeof(reference_state));
                step_fn=e5_five_reference[variant];
                __DSB();__ISB();t0=DWT->CYCCNT;
                ok=step_fn(&reference_state,&fixture.input,&reference_output);
                __DSB();__ISB();t1=DWT->CYCCNT;
                body=(float)(t1-t0)/cpu;if(body>ref_peaks[node_index])ref_peaks[node_index]=body;
                if(!ok)errors++;
                result_sink+=(uint32_t)(reference_output.ca_delta[0]+300);
            } else {
                step_fn=e5_five_optimized[variant];
                __DSB();__ISB();t0=DWT->CYCCNT;
                ok=step_fn(&fixture.state,&fixture.input,&fixture.output);
                __DSB();__ISB();t1=DWT->CYCCNT;
                core_us=(float)(t1-t0)/cpu;if(core_us>core_peak)core_peak=core_us;
                if(core_us>peaks[variant][node_index])peaks[variant][node_index]=core_us;
                if(!ok || memcmp(&reference_state,&fixture.state,sizeof(reference_state)) ||
                   memcmp(&reference_output,&fixture.output,sizeof(reference_output)) ||
                   !e5_five_rule_ok(variant,&fixture.output))errors++;
                if(fixture.nodes==59U){
                    if(fixture.state.growth!=2U)errors++;else growth++;
                }
                if(variant==0U)blnn++;
                else if(fixture.mode==3U) {
                    if(!(fixture.output.ca_mask&(16U|32U))||fixture.output.learning_gate!=0)errors++;else mixed++;
                } else if(fixture.nodes!=59U) {
                    if(fixture.output.diagnostic_reason!=DIAG_REASON_RATE_ONLY)errors++;
                    else if(e5_five_learning[variant]){
                        if(fixture.output.learning_gate<=0||fixture.output.learning_gate>=1)errors++;else partial++;
                    } else {if(fixture.output.learning_gate!=0)errors++;else old_rate++;}
                }
                pairs++;result_sink+=(uint32_t)(fixture.output.ca_delta[0]+300);
            }
            n++;if(errors)fault|=64U;
        }
        g_exp5_drive_permit=0;CAN_cmd_3508(0,0);
        channels[0]=(float)now*.001f;
        channels[2]=fault?9.0f:(n>=E5_FIVE_CYCLES?6.0f:(n?1.0f:0.0f));
        for(v=0;v<5;v++)for(ch=0;ch<3;ch++)channels[peak_channel[v]+ch]=peaks[v][ch];
        channels[13]=0;channels[14]=0;channels[21]=E5_SELECTED_METHOD;channels[22]=(float)fault;
        channels[27]=Batvalt;channels[28]=(float)g_exp5_can_rejected;
        channels[41]=core_us;channels[42]=core_peak;channels[43]=period;channels[45]=(float)late;
        channels[46]=(float)n;channels[57]=(float)overruns;
        if(now-stack_at>=100U){stack_bytes=(uint32_t)(uxTaskGetStackHighWaterMark(NULL)*sizeof(StackType_t));stack_at=now;}
        channels[58]=(float)stack_bytes;channels[59]=(float)g_exp5_uart_errors;channels[60]=body_peak;
        channels[63]=E5_SELECTED_BUILD;channels[69]=(float)g_exp5_dma_completed;channels[70]=(float)g_exp5_dma_skipped;
        channels[71]=(float)g_exp5_uart_last_error;channels[72]=(float)g_exp5_bms_errors;channels[73]=(float)g_exp5_bms_valid;
        channels[74]=(float)partial;channels[75]=(float)growth;channels[76]=(float)pairs;
        channels[77]=(float)g_exp5_can_errors;channels[78]=(float)mixed;
        channels[87]=(float)variant;channels[88]=4467;
        channels[89]=fault?9.0f:(n>=E5_FIVE_CYCLES?4.0f:1.0f);
        channels[90]=(float)n;channels[91]=(float)E5_FIVE_CYCLES;channels[92]=(float)errors;
        for(ch=0;ch<3;ch++)channels[93+ch]=ref_peaks[ch];
        channels[96]=body_peak;channels[97]=(float)(result_sink&65535U);
        channels[98]=(float)old_rate;channels[99]=(float)blnn;
        for(ch=0;ch<3;ch++)channels[100+ch]=peaks[variant][ch];
        channels[103]=(float)e5_five_method[variant];channels[104]=(float)e5_five_learning[variant];
        channels[105]=(float)e5_five_search[variant];channels[106]=0;
        publish();body=(float)(DWT->CYCCNT-begin)/cpu;if(body>body_peak)body_peak=body;
        if(body>=1000.0f){overruns++;fault|=256U;}
        wake=(TickType_t)e5_release_base((uint32_t)xTaskGetTickCount(),(uint32_t)wake,1U,&rebase);
        vTaskDelayUntil(&wake,1U);
    }
}
