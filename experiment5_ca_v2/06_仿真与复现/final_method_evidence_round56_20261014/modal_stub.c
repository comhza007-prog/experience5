/* Host test harness compatibility only. Old diagnostic returns0 here too.
 * This is NOT a controller hook or an observed physical node count. */
#include <stdint.h>
uint32_t e5_modal_count(uint32_t ch) { (void)ch; return 0; }
