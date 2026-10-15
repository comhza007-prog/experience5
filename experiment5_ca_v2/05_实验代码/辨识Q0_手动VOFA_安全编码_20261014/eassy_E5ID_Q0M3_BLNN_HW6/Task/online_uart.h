#ifndef E5_ONLINE_UART_H
#define E5_ONLINE_UART_H
#include <stdint.h>
void e5_online_uart_start(void);
void e5_online_uart_fault(void);
int e5_online_uart_pop(uint8_t *byte);
uint16_t e5_online_session_token(void);
extern volatile uint32_t g_e5_online_rx_overflow,g_e5_online_rx_error;
#endif
