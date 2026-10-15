#ifndef E5_FORMAL_CONFIG_H
#define E5_FORMAL_CONFIG_H
/* R9 exploratory coordination from R8, not a proven performance upgrade.
 * No added mass,2mm,1200/1200 counts. Fresh4-node zero-weight reset.
 * Common HW6 controls/guards; telemetry schema4480.
 * Snapshot configuration only; release status is in current_state.json.
 * Post-observation modification; not an unchanged formal F5 trial.
 * On symmetric limits, beta=min(1,(2*abs(mean error)+50um)/abs(sync error)).
 * Attenuate only Y NN request and its error-driven learning; never amplify
 * alpha. Keep both original sectors, integer slew/current/speed guards.
 * I92 and EVENT v39 now beta, not the balanced-search flag. Mode4 means
 * Y priority attenuation (NOT the old R3 modal-learning definition).
 * No gain/slew/sector retuning. No on-board WCET qualification claimed. */
#define E5_SELECTED_METHOD 12U
#define E5_SELECTED_BUILD 67112U
#define E5_SELECTED_NEW_LEARNING 1U
#define E5_SELECTED_BALANCED 1U
#define E5_SELECTED_VARIANT 14U
#define E5_SELECTED_SYNC_PRIORITY 1U
#define E5_SELECTED_REPAIR 1U
#define E5_SELECTED_RETENTION 1U
#define E5_FORMAL_SCHEMA 4480U
#define E5_SELECTED_LOAD_G 0U
#define E5_FORMAL_TELEMETRY_CHANNELS 107U
#endif
