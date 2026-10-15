#include <assert.h>
#include <math.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>
#include "experiment5_error_wave.h"
static uint32_t seed=4901U;
static float sample(void) {
    seed=seed*1664525U+1013904223U;
    return ((float)(seed>>8)/16777216.0f-.5f)*.008f;
}
int main(void) {
    float v[107],before[107];unsigned i,j;
    for(i=0;i<100000U;i++) {
        for(j=0;j<107U;j++)v[j]=(float)j+.25f;
        v[3]=sample();v[5]=sample();v[6]=sample();
        memcpy(before,v,sizeof(v));e5_error_wave(v);
        assert(fabs((double)v[53]-1000.0*(.5*((double)before[5]+before[6])-before[3]))<.000002);
        assert(fabs((double)v[54]-1000.0*((double)before[5]-before[6]))<.000002);
        for(j=0;j<107U;j++)if(j!=53U&&j!=54U)assert(memcmp(&v[j],&before[j],sizeof(float))==0);
    }
    memset(v,0,sizeof(v));v[3]=.002f;v[5]=.0018f;v[6]=.0016f;e5_error_wave(v);
    assert(fabsf(v[53]+.3f)<.000001f&&fabsf(v[54]-.2f)<.000001f);
    memset(v,0,sizeof(v));e5_error_wave(v);assert(v[53]==0&&v[54]==0);
    puts("PASS:100000 fixtures; I53/I54 units/sign; other105 channels bit-exact; zero fixture.");
    return 0;
}
