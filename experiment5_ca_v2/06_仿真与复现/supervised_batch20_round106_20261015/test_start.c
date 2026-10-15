#include <assert.h>
#include <stdio.h>
#include "online_protocol.h"
int main(void){
 e5_ol_state s;e5_ol_command c={0};unsigned n;e5_ol_init(&s,123);
 assert(!s.prepared);
 for(n=0;n<20000;n++)assert(!e5_ol_watchdog_expired(&s,0,n));
 c.session=123;c.seq=1;c.op=E5_OL_ARM;
 assert(!e5_ol_apply(&s,&c,1,0,1,9000));
 c.seq=2;c.op=E5_OL_PREPARE;assert(e5_ol_apply(&s,&c,1,0,1,9000)==E5_OL_PREPARE);
 c.seq=3;c.op=E5_OL_ARM;assert(e5_ol_apply(&s,&c,1,0,1,9500)==E5_OL_ARM);
 assert(!e5_ol_watchdog_expired(&s,1,10500));assert(e5_ol_watchdog_expired(&s,1,10501));
 c.seq=4;c.op=E5_OL_PREPARE;assert(!e5_ol_apply(&s,&c,0,0,1,11000));
 c.seq=5;c.op=E5_OL_ARM;assert(!e5_ol_apply(&s,&c,0,0,1,11000));
 c.seq=0;c.session=0;c.op=E5_OL_STOP;assert(e5_ol_apply(&s,&c,0,512,1,11000)==E5_OL_STOP);
 puts("PASS explicit PREPARE/ARM, no idle watchdog, active heartbeat expiry, no done rearm, unconditional CRC-valid STOP action");
 return 0;
}
