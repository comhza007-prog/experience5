#ifndef E5_FORMAL_CONFIG_H
#define E5_FORMAL_CONFIG_H
/* R8 rollback to the physically observed R2 control law.
 * No added mass,2mm,1200/1200 counts. Fresh4-node zero-weight reset.
 * Common HW6 controls/guards; mode3 telemetry schema4479.
 * Snapshot configuration only; release status is in current_state.json.
 * Post-observation modification; not an unchanged formal F5 trial.
 * R6 moving-direction repair is NOT included; R7 joint borrowing rejected.
 * Control sources identical to R2; only version and passive event identity
 * and capture time differ. Not a new performance improvement claim.
 * No gain/slew/sector retuning. No on-board WCET qualification claimed. */
#define E5_SELECTED_METHOD 12U
#define E5_SELECTED_BUILD 67012U
#define E5_SELECTED_NEW_LEARNING 1U
#define E5_SELECTED_BALANCED 1U
#define E5_SELECTED_VARIANT 13U
#define E5_SELECTED_REPAIR 1U
#define E5_SELECTED_RETENTION 1U
#define E5_FORMAL_SCHEMA 4479U
#define E5_SELECTED_LOAD_G 0U
#define E5_FORMAL_TELEMETRY_CHANNELS 107U
#endif
