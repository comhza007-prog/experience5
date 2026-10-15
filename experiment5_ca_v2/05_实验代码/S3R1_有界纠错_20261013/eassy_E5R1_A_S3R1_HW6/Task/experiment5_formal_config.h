#ifndef E5_FORMAL_CONFIG_H
#define E5_FORMAL_CONFIG_H
/* R1 exploratory pair: S3 bounded corrective learning, build66112.
 * No added mass,2mm,1200/1200 counts. Fresh4-node zero-weight reset.
 * Common HW6 controls/guards and matched telemetry schema4470.
 * Snapshot configuration only; release status is in current_state.json.
 * Post-observation modification; not an unchanged formal F5 trial.
 * No gain/slew/sector retuning. Board timing pending before motion. */
#define E5_SELECTED_METHOD 12U
#define E5_SELECTED_BUILD 66112U
#define E5_SELECTED_NEW_LEARNING 1U
#define E5_SELECTED_BALANCED 1U
#define E5_SELECTED_VARIANT 5U
#define E5_SELECTED_REPAIR 1U
#define E5_FORMAL_SCHEMA 4470U
#define E5_SELECTED_LOAD_G 0U
#define E5_FORMAL_TELEMETRY_CHANNELS 107U
#endif
