#ifndef E5_FORMAL_CONFIG_H
#define E5_FORMAL_CONFIG_H
/* Q20 ABI3 interval-integral logger plus UART-only40s error summary.
 * MANUAL VOFA: one health-checked boot-start attempt after8seconds.
 * No added mass,20mm/8s per leg,1200/1200. Fresh4-node zero-weight reset.
 * Sync stop threshold5mm (was1.5mm); other guards unchanged from68412.
 * Travel now[-22,+22]mm. Tracking1024 retained, no gain/current increase.
 * Negative22mm physicalclearance must be verified before manual flashing/run.
 * No host heartbeat in this mode; onsite physical emergency stop required.
 * User-operated SINGLE qualification, not a20run batch release.
 * Snapshot configuration only; release status is in current_state.json.
 * Post-observation modification; not an unchanged formal F5 trial.
 * No gain/slew/sector retuning. No on-board WCET qualification claimed. */
#define E5_SELECTED_METHOD 11U
#define E5_SELECTED_BUILD 68612U
#define E5_SELECTED_NEW_LEARNING 1U
#define E5_SELECTED_BALANCED 1U
#define E5_SELECTED_VARIANT 18U
#define E5_SELECTED_REPAIR 1U
#define E5_SELECTED_RETENTION 1U
#define E5_FORMAL_SCHEMA 4504U
#define E5_SELECTED_LOAD_G 0U
#define E5_FORMAL_TELEMETRY_CHANNELS 107U
#endif
