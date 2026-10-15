#ifndef E5_FORMAL_CONFIG_H
#define E5_FORMAL_CONFIG_H
/* CPU TIMING ONLY: motor task never arms. CAN sender forces ZERO slots.
 * Synthetic fixtures only; NOT motion qualification/performance evidence.
 * Build 64712, magic I88=4463; I90=24000 and I76=6000 then I89=4.
 * Paired baseline/optimized ARM results must be exactly equal (I92=0). */
#define E5_SELECTED_METHOD 12U
#define E5_SELECTED_BUILD 64712U
#define E5_SELECTED_LOAD_G 0U
#define E5_FORMAL_TELEMETRY_CHANNELS 107U
#endif
