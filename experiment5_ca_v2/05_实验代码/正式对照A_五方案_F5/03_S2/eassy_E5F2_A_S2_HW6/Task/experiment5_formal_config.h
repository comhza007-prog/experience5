#ifndef E5_FORMAL_CONFIG_H
#define E5_FORMAL_CONFIG_H
/* Matched A five-method set: S2, build65812.
 * No added mass,2mm,1200/1200 counts. Fresh4-node zero-weight reset.
 * Common HW6 controls/guards and read-only telemetry schema4466.
 * Snapshot configuration only; release status is in current_state.json.
 * Intended factors only; no method-specific gain/slew/sector retuning. */
#define E5_SELECTED_METHOD 12U
#define E5_SELECTED_BUILD 65812U
#define E5_SELECTED_NEW_LEARNING 0U
#define E5_SELECTED_BALANCED 1U
#define E5_SELECTED_VARIANT 3U
#define E5_FORMAL_SCHEMA 4466U
#define E5_SELECTED_LOAD_G 0U
#define E5_FORMAL_TELEMETRY_CHANNELS 107U
#endif
