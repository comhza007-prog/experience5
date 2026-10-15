#ifndef E5_FORMAL_CONFIG_H
#define E5_FORMAL_CONFIG_H
/* STATIONARY S1/S3 CPU/equality/learning-rule probe ONLY. Never arms.
 * Build65412; exact search timing optimization; hard-zero CAN.
 * Default core is S3; separate TUs test S1 against unchanged reference search.
 * No physical performance evidence. */
#define E5_SELECTED_METHOD 12U
#define E5_SELECTED_BUILD 65412U
#define E5_SELECTED_NEW_LEARNING 1U
#define E5_SELECTED_BALANCED 1U
#define E5_SELECTED_LOAD_G 0U
#define E5_FORMAL_TELEMETRY_CHANNELS 107U
#endif
