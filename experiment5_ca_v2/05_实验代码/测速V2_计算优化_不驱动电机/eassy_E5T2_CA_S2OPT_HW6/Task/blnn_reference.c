/* Stationary probe ONLY: baseline S2 math for paired on-MCU bit equality.
 * No reference controller output is connected to the CAN sender. */
#define e5_reset e5_reset_reference
#define e5_step e5_step_reference
#include "blnn_core_reference.inc"
