#ifndef E5_FORMAL_CONFIG_H
#define E5_FORMAL_CONFIG_H
/* R1 static timing/rule probe, build66212. Independently hard-zero CAN.
 * No added mass,2mm,1200/1200 counts. Fresh4-node zero-weight reset.
 * Probe schema4471 is NOT the motion schema4470.
 * Snapshot configuration only; release status is in current_state.json.
 * Intended factors only; no method-specific gain/slew/sector retuning. */
#define E5_SELECTED_METHOD 12U
#define E5_SELECTED_BUILD 66212U
#define E5_SELECTED_NEW_LEARNING 1U
#define E5_SELECTED_BALANCED 1U
#define E5_SELECTED_VARIANT 5U
#define E5_SELECTED_REPAIR 1U
#define E5_FORMAL_SCHEMA 4471U
#define E5_SELECTED_LOAD_G 0U
#define E5_FORMAL_TELEMETRY_CHANNELS 107U
#endif
