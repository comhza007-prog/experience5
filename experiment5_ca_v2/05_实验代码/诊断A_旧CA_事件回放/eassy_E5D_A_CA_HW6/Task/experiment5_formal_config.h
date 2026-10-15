#ifndef E5_FORMAL_CONFIG_H
#define E5_FORMAL_CONFIG_H
/* DIAGNOSTIC A only: original CA method, no added mass, 2 mm,
 * 1200/1200 command COUNTS. Build 64412 distinguishes event telemetry.
 * No new learning policy/gain/trajectory/guard. Needs on-device timing check.
 * Configured mass is a label, not a sensor. NOT a formal CA2 firmware. */
#define E5_SELECTED_METHOD 12U
#define E5_SELECTED_BUILD 64412U
#define E5_SELECTED_LOAD_G 0U
#define E5_FORMAL_TELEMETRY_CHANNELS 107U
#endif
