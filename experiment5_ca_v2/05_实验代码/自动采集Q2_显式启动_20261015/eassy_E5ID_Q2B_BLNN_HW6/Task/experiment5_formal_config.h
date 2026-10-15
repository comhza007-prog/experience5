#ifndef E5_FORMAL_CONFIG_H
#define E5_FORMAL_CONFIG_H
/* Q2B logger plus UART-only40s error summary. ZERO excitation only.
 * Boot never starts motion. One explicit healthy host ARM after8s only.
 * No added mass,2mm,1200/1200 counts. Fresh4-node zero-weight reset.
 * HW6 physical/control guards unchanged; PC-heartbeat abort restored.
 * Snapshot configuration only; release status is in current_state.json.
 * Post-observation modification; not an unchanged formal F5 trial.
 * No gain/slew/sector retuning. No on-board WCET qualification claimed. */
#define E5_SELECTED_METHOD 11U
#define E5_SELECTED_BUILD 68212U
#define E5_SELECTED_NEW_LEARNING 1U
#define E5_SELECTED_BALANCED 1U
#define E5_SELECTED_VARIANT 18U
#define E5_SELECTED_REPAIR 1U
#define E5_SELECTED_RETENTION 1U
#define E5_FORMAL_SCHEMA 4500U
#define E5_SELECTED_LOAD_G 0U
#define E5_FORMAL_TELEMETRY_CHANNELS 107U
#endif
