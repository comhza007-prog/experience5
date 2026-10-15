#include "online_uart.h"
#include "online_protocol.h"
#include "usart.h"
#include "motor_task.h"
volatile float g_e5_online_nn_scale=1.0f,g_e5_online_learning_scale=1.0f;
volatile uint32_t g_e5_online_rx_overflow=0,g_e5_online_rx_error=0;
static volatile uint16_t head=0,tail=0;
static uint8_t ring[256],rx_byte;
void e5_online_uart_fault(void) {g_e5_online_rx_error++;g_exp5_abort=1;}
void e5_online_uart_start(void) {
    if(HAL_UART_Receive_IT(&huart6,&rx_byte,1)!=HAL_OK)e5_online_uart_fault();
}
void HAL_UART_RxCpltCallback(UART_HandleTypeDef *uart) {
    uint16_t next;
    if(uart!=&huart6)return;
    next=(uint16_t)((head+1U)&255U);
    if(next==tail){g_e5_online_rx_overflow++;g_exp5_abort=1;}
    else {ring[head]=rx_byte;__DMB();head=next;}
    if(HAL_UART_Receive_IT(&huart6,&rx_byte,1)!=HAL_OK)e5_online_uart_fault();
}
int e5_online_uart_pop(uint8_t *byte) {
    if(tail==head)return 0;
    __DMB();*byte=ring[tail];__DMB();tail=(uint16_t)((tail+1U)&255U);return 1;
}
uint16_t e5_online_session_token(void) {
    uint32_t n,value=0;
    /* PLLQ provides48MHz in this project. Bounded startup wait ONLY.
     * RNG failure leaves session0: all non-STOP commands are rejected. */
    __HAL_RCC_RNG_CLK_ENABLE();RNG->CR=RNG_CR_RNGEN;
    for(n=0;n<100000U;n++) {
        if(RNG->SR&(RNG_SR_CECS|RNG_SR_SECS))break;
        if(RNG->SR&RNG_SR_DRDY){value=RNG->DR;if((value&0xffffU)!=0U)break;}
    }
    RNG->CR=0;__HAL_RCC_RNG_CLK_DISABLE();return (uint16_t)value;
}
