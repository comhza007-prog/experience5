#include <stdio.h>
#include "experiment5_motion.h"
int main(int argc,char **argv){unsigned ms;float ref[3];FILE *f;if(argc!=2)return 2;f=fopen(argv[1],"wb");if(!f)return 3;
 fprintf(f,"ms,phase,reference_m\n");for(ms=0;ms<=20000;ms++){unsigned phase=e5_motion_reference(ms,ref);fprintf(f,"%u,%u,%.9g\n",ms,phase,(double)ref[0]);}
 return fclose(f)!=0;
}
