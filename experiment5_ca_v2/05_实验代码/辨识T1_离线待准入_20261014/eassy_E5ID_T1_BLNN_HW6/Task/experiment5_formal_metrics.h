#ifndef E5_FORMAL_METRICS_H
#define E5_FORMAL_METRICS_H
#include "blnn_core.h"
/* Read-only reporting. Ordinary BLNN's error gradient is always enabled,
 * although its core also returns a CA-style headroom diagnostic. Do NOT
 * mistake that diagnostic for the actual BLNN update multiplier.
 * CA cause/rho do not exist for BLNN: publish -1 (not applicable), not0.
 * No state, weight, command or AW change in these helpers. */
static e5_real e5_formal_effective_learning(uint32_t method,const e5_output *o) {
    /* R1 scalar is conservative MIN(actual Y,actual alpha), not a common
     * multiplier. Use I17/I18 or EVENT48 v40/v41 for the actual updates. */
    return method==E5_BASE?0:(method==E5_BLNN?1:
        (o->learning_axis[0]<o->learning_axis[1]?o->learning_axis[0]:o->learning_axis[1]));
}
static e5_real e5_formal_cause(uint32_t method,const e5_output *o) {
    return method==E5_CA_BLNN?(e5_real)o->diagnostic_reason:(e5_real)-1;
}
static e5_real e5_formal_rho(uint32_t method,const e5_output *o) {
    return method==E5_CA_BLNN?o->admitted_fraction:(e5_real)-1;
}
static e5_real e5_formal_pre_learning(uint32_t method,const e5_output *o) {
    return method==E5_BASE?0:(method==E5_BLNN?1:o->learning_before_reason);
}
static int16_t e5_formal_pre_guard_wanted(uint32_t method,const e5_output *o,
                                        const int16_t before[2],unsigned ch) {
    return method==E5_CA_BLNN?(int16_t)o->ca_before_guard[ch]:before[ch];
}
#endif
