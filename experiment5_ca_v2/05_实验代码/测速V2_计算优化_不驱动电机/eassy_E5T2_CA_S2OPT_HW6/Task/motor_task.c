#include "motor_task.h"
#include "CAN_receive.h"
#include "experiment5_timing_fixtures.h"
#include "periodic_release.h"
#include <string.h>
/* STATIONARY CPU TIMING ONLY. No arm state or controller-to-CAN path.
 * Drive permission NEVER enabled; CAN sender also forces all-zero slots.
 * Zero current is NOT a holding brake: mechanically secure the mechanism.
 * Observed peaks include live interrupts, not a certified worst-case bound. */
volatile uint8_t g_exp5_abort=0;
volatile uint32_t g_exp5_uart_errors=0,g_exp5_drive_permit=0;
extern volatile uint32_t g_exp5_can_errors,g_exp5_can_rejected;
extern volatile uint32_t g_exp5_dma_completed,g_exp5_dma_skipped,g_exp5_uart_last_error;
extern volatile uint32_t g_exp5_bms_errors,g_exp5_bms_valid;
extern float Batvalt;
static e5_bench_fixture fixture;
static e5_state reference_state;
static e5_output reference_output;
int e5_step_reference(e5_state *s,const e5_input *in,e5_output *out);
#define E5_TIMING_TOTAL (4U*E5_BENCH_BLOCK)
static float published[E5_TELEMETRY_CHANNELS],channels[E5_TELEMETRY_CHANNELS];
static motor_measure_t feedback[2];
static volatile uint32_t result_sink=0;
void e5_telemetry_snapshot(float values[E5_TELEMETRY_CHANNELS]) {
    taskENTER_CRITICAL();memcpy(values,published,sizeof(published));taskEXIT_CRITICAL();
}
static void publish(void) {
    taskENTER_CRITICAL();memcpy(published,channels,sizeof(published));taskEXIT_CRITICAL();
}
__attribute__((noinline)) static int bench_allocate(void) {
    return e5_ca_allocate(fixture.bi,fixture.correction,fixture.sigma,fixture.limits,fixture.rpm,fixture.previous,&fixture.allocation);
}
__attribute__((noinline)) static int bench_ray(void) {
    return e5_ca_contract_ray(fixture.sigma,fixture.rpm,fixture.lim,fixture.previous,fixture.target,&fixture.old_ray);
}
__attribute__((noinline)) static int bench_balanced(void) {
    return e5_ca_contract(fixture.sigma,fixture.rpm,fixture.lim,fixture.previous,fixture.target,&fixture.balanced);
}
void motor_task(void const *argument) {
    TickType_t wake=xTaskGetTickCount();
    uint32_t boot,n=0,fault=0,check_errors=0,begin,t0,t1,now,last=0,valid=0,fixture_n,paired_checks=0;
    uint32_t late=0,overruns=0,rebase=0,ch,stack_at=0,stack_bytes=4096;
    float cpu=(float)SystemCoreClock/1000000.0f,period=0,body,body_peak=0;
    float alloc_us=0,alloc_peak=0,ray_peak=0,balanced_peak=0,core_us=0,core_peak=0;
    float core_nodes_peak[3]={0,0,0},reference_nodes_peak[3]={0,0,0};int ok;
    (void)argument;g_exp5_drive_permit=0;
    CoreDebug->DEMCR|=CoreDebug_DEMCR_TRCENA_Msk;
    DWT->CYCCNT=0;DWT->CTRL|=DWT_CTRL_CYCCNTENA_Msk;boot=HAL_GetTick();
    for(;;) {
        begin=DWT->CYCCNT;now=HAL_GetTick();g_exp5_drive_permit=0;
        if(valid) {period=(float)(begin-last)/cpu;if(period>1500)late++;}
        valid=1;last=begin;
        taskENTER_CRITICAL();memcpy(feedback,motor_3508,sizeof(feedback));taskEXIT_CRITICAL();
        if(g_exp5_abort)fault|=32U;
        if(!(DWT->CTRL&DWT_CTRL_CYCCNTENA_Msk))fault|=64U;
        if(!fault && now-boot>=2000U && n<E5_TIMING_TOTAL) {
            fixture_n=n<2U*E5_BENCH_BLOCK?n:2U*E5_BENCH_BLOCK+(n-2U*E5_BENCH_BLOCK)/2U;
            e5_bench_prepare(&fixture,fixture_n);
            if(n<E5_BENCH_BLOCK) {
                __DSB();__ISB();t0=DWT->CYCCNT;
                ok=bench_allocate();__DSB();__ISB();t1=DWT->CYCCNT;
                alloc_us=(float)(t1-t0)/cpu;if(alloc_us>alloc_peak)alloc_peak=alloc_us;
                if(!ok)check_errors++;
                if(fixture.regression && (fixture.allocation.delta[0]!=23 || fixture.allocation.delta[1]!=-23))check_errors++;
                result_sink+=(uint32_t)(fixture.allocation.delta[0]+300);
            } else if(n<2U*E5_BENCH_BLOCK) {
                __DSB();__ISB();t0=DWT->CYCCNT;
                (void)bench_ray();__DSB();__ISB();t1=DWT->CYCCNT;
                body=(float)(t1-t0)/cpu;if(body>ray_peak)ray_peak=body;
                __DSB();__ISB();t0=DWT->CYCCNT;
                (void)bench_balanced();__DSB();__ISB();t1=DWT->CYCCNT;
                body=(float)(t1-t0)/cpu;if(body>balanced_peak)balanced_peak=body;
                if(fixture.regression && (fixture.old_ray.delta[0]!=2 || fixture.old_ray.delta[1]!=-2 ||
                    fixture.balanced.delta[0]!=23 || fixture.balanced.delta[1]!=-23))check_errors++;
                result_sink+=(uint32_t)(fixture.balanced.delta[0]+300);
            } else {
                ch=fixture.nodes==4U?0U:(fixture.nodes==59U?1U:2U);
                /* Reference and optimized calls use identical reset inputs
                 * on consecutive periods, not together in a >1ms body.
                 * No change to either algorithm or task overrun threshold. */
                if((n-2U*E5_BENCH_BLOCK)%2U==0U) {
                    memcpy(&reference_state,&fixture.state,sizeof(reference_state));
                    __DSB();__ISB();t0=DWT->CYCCNT;
                    ok=e5_step_reference(&reference_state,&fixture.input,&reference_output);
                    __DSB();__ISB();t1=DWT->CYCCNT;
                    body=(float)(t1-t0)/cpu;
                    if(body>reference_nodes_peak[ch])reference_nodes_peak[ch]=body;
                    if(!ok)check_errors++;
                    result_sink+=(uint32_t)(reference_output.ca_delta[0]+300);
                } else {
                    __DSB();__ISB();t0=DWT->CYCCNT;
                    ok=e5_step(&fixture.state,&fixture.input,&fixture.output);__DSB();__ISB();t1=DWT->CYCCNT;
                    core_us=(float)(t1-t0)/cpu;if(core_us>core_peak)core_peak=core_us;
                    if(core_us>core_nodes_peak[ch])core_nodes_peak[ch]=core_us;
                    if(!ok || (fixture.nodes==59U && fixture.state.growth!=2U) ||
                       memcmp(&reference_state,&fixture.state,sizeof(reference_state))!=0 ||
                       memcmp(&reference_output,&fixture.output,sizeof(reference_output))!=0)check_errors++;
                    paired_checks++;
                    result_sink+=(uint32_t)(fixture.output.ca_delta[0]+300);
                }
            }
            n++;if(check_errors)fault|=64U;
        }
        /* Independent hard zero regardless of computed outputs and faults. */
        g_exp5_drive_permit=0;CAN_cmd_3508(0,0);
        channels[0]=(float)now*.001f;channels[2]=fault?9.0f:(n>=E5_TIMING_TOTAL?6.0f:(n?1.0f:0.0f));
        channels[13]=0;channels[14]=0;channels[21]=E5_SELECTED_METHOD;channels[22]=(float)fault;
        channels[27]=Batvalt;channels[28]=(float)g_exp5_can_rejected;
        channels[41]=core_us;channels[42]=core_peak;channels[43]=period;channels[45]=(float)late;channels[46]=(float)n;
        channels[57]=(float)overruns;
        if(now-stack_at>=100U) {stack_bytes=(uint32_t)(uxTaskGetStackHighWaterMark(NULL)*sizeof(StackType_t));stack_at=now;}
        channels[58]=(float)stack_bytes;channels[59]=(float)g_exp5_uart_errors;channels[60]=body_peak;
        channels[63]=E5_SELECTED_BUILD;channels[69]=(float)g_exp5_dma_completed;channels[70]=(float)g_exp5_dma_skipped;
        channels[71]=(float)g_exp5_uart_last_error;channels[72]=(float)g_exp5_bms_errors;channels[73]=(float)g_exp5_bms_valid;
        channels[76]=(float)paired_checks;
        channels[77]=(float)g_exp5_can_errors;channels[80]=(float)feedback[0].speed_rpm;channels[81]=(float)feedback[1].speed_rpm;
        channels[88]=4463;channels[89]=fault?9.0f:(n>=E5_TIMING_TOTAL?4.0f:1.0f);
        channels[90]=(float)n;channels[91]=(float)E5_TIMING_TOTAL;channels[92]=(float)check_errors;
        channels[93]=reference_nodes_peak[0];channels[94]=reference_nodes_peak[1];channels[95]=reference_nodes_peak[2];
        channels[96]=alloc_us;channels[97]=alloc_peak;channels[98]=ray_peak;channels[99]=balanced_peak;
        channels[100]=core_nodes_peak[0];channels[101]=core_nodes_peak[1];channels[102]=core_nodes_peak[2];
        channels[103]=body_peak;channels[104]=0;channels[105]=(float)(result_sink&65535U);channels[106]=0;
        publish();body=(float)(DWT->CYCCNT-begin)/cpu;if(body>body_peak)body_peak=body;
        if(body>=1000.0f) {overruns++;fault|=256U;}
        wake=(TickType_t)e5_release_base((uint32_t)xTaskGetTickCount(),(uint32_t)wake,1U,&rebase);vTaskDelayUntil(&wake,1U);
    }
}
