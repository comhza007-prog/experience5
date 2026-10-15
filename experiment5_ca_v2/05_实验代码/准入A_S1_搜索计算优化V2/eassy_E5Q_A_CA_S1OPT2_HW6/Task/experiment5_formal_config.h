#ifndef E5_FORMAL_CONFIG_H
#define E5_FORMAL_CONFIG_H
/* S1 QUALIFICATION A: cause-aware partial learning ONLY; OLD ray search.
 * No added mass, 2 mm, 1200/1200 command COUNTS. Event telemetry retained.
 * Build 65212; same S1 policy plus exact distance/sort/search optimization.
 * Not formal evidence; not released before board timing and equality check.
 * Gains/trajectory/protections unchanged. Load is a label, not a sensor. */
#define E5_SELECTED_METHOD 12U
#define E5_SELECTED_BUILD 65212U
#define E5_SELECTED_NEW_LEARNING 1U
#define E5_SELECTED_BALANCED 0U
#define E5_SELECTED_LOAD_G 0U
#define E5_FORMAL_TELEMETRY_CHANNELS 107U
#endif
