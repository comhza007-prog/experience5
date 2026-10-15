#ifndef E5_DIAGNOSTIC_CONFIG_H
#define E5_DIAGNOSTIC_CONFIG_H
/* HOST-ONLY diagnostic. No Keil project, HEX, CAN or physical permission.
 * Factors fixed BEFORE looking at results. NOT a released CA2 firmware. */
#ifndef DIAG_NEW_LEARNING
#define DIAG_NEW_LEARNING 0
#endif
#ifndef DIAG_BALANCED_CONTRACTION
#define DIAG_BALANCED_CONTRACTION 0
#endif
#ifndef DIAG_SLEW_COUNTS
#define DIAG_SLEW_COUNTS 2
#endif
#ifndef DIAG_SECTOR_FRACTION
#define DIAG_SECTOR_FRACTION .25
#endif
#if DIAG_SLEW_COUNTS != 2 && DIAG_SLEW_COUNTS != 4
#error Round01 allows only the preregistered 2 or 4 counts per 1ms step
#endif
#define DIAG_REASON_RATE_ONLY 1U
#define DIAG_REASON_HARD_CLIP 2U
#define DIAG_REASON_OTHER_CONSTRAINT 4U
#endif
