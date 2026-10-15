#ifndef E5_FORMAL_CONFIG_H
#define E5_FORMAL_CONFIG_H
#error R7_REJECTED_OFFLINE_NEW_FAILURES_DO_NOT_FLASH
/* R7 exploratory S3: translation can use stabilizing rotational work.
 * No added mass,2mm,1200/1200 counts. Fresh4-node zero-weight reset.
 * Common HW6 controls/guards; mode3 telemetry schema4478.
 * Snapshot configuration only; release status is in current_state.json.
 * Post-observation modification; not an unchanged formal F5 trial.
 * Alpha sector unchanged; Y uses BY-min(Walpha,0), preserving the joint
 * work upper bound. This is not a closed-loop stability proof.
 * No gain/current/slew retuning. No on-board WCET qualification claimed. */
#define E5_SELECTED_METHOD 12U
#define E5_SELECTED_BUILD 66912U
#define E5_SELECTED_NEW_LEARNING 1U
#define E5_SELECTED_BALANCED 1U
#define E5_SELECTED_VARIANT 12U
#define E5_SELECTED_JOINT_TRANSLATION 1U
#define E5_SELECTED_REPAIR 1U
#define E5_SELECTED_RETENTION 1U
#define E5_FORMAL_SCHEMA 4478U
#define E5_SELECTED_LOAD_G 0U
#define E5_FORMAL_TELEMETRY_CHANNELS 107U
#endif
