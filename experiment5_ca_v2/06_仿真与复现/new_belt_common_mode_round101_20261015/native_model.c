/* HOST ONLY: convex implicit elastic-slider friction with state memory.
 * theta: gainL,gainR,BL,BR,Kdiff,Cdiff,FcL,FcR,eta,kL,kR,Fyield,Kcommon,Ccommon.
 * state: positionL/R,velocityL/R,plasticAnchorL/R.
 * No MCU, references, measured states, run labels or output corrections. */
#include <math.h>
#ifdef _WIN32
#define EXPORT __declspec(dllexport)
#else
#define EXPORT
#endif
static double clip(double x,double a){return fmax(-a,fmin(a,x));}
static int valid(const double *z){
 int j;for(j=0;j<14;j++)if(!isfinite(z[j])||(j!=8&&z[j]<0))return 0;
 return z[0]>0&&z[1]>0&&fabs(z[8])<1;
}
static int step(double state[6],const double u[2],double h,const double z[14]){
 double p[2]={state[0],state[1]},v[2]={state[2],state[3]},anchor[2]={state[4],state[5]};
 double cross=h*z[5]+h*h*z[4],common=.5*(h*z[13]+h*h*z[12]);
 double aa=1+h*z[2]+cross+common,b=z[8]-cross+common,dd=1+h*z[3]+cross+common;
 double restore=.5*z[12]*(p[0]+p[1]);
 double rhs[2]={v[0]+z[8]*v[1]+h*(z[0]*u[0]-z[4]*(p[0]-p[1])-restore),
               v[1]+z[8]*v[0]+h*(z[1]*u[1]-z[4]*(p[1]-p[0])-restore)};
 double k[2]={z[9],z[10]},f[2]={z[6],z[7]},Y=z[11],w[2],trial[2];
 int modes[3]={0,-1,1},i,j,s0,s1;
 for(i=0;i<3;i++)for(j=0;j<3;j++){
  int m[2]={modes[i],modes[j]};
  double A=aa+(m[0]==0?h*h*k[0]:0),D=dd+(m[1]==0?h*h*k[1]:0);
  double q[2]={rhs[0]-h*(m[0]==0?k[0]*(p[0]-anchor[0]):m[0]*Y),
               rhs[1]-h*(m[1]==0?k[1]*(p[1]-anchor[1]):m[1]*Y)};
  for(s0=-1;s0<=1;s0++)for(s1=-1;s1<=1;s1++){
   double x=q[0]-h*f[0]*s0,y=q[1]-h*f[1]*s1,res[2];int ch,ok=1;
   w[0]=w[1]=0;
   if(s0&&s1){double det=A*D-b*b;w[0]=(D*x-b*y)/det;w[1]=(A*y-b*x)/det;}
   else if(s0)w[0]=x/A;else if(s1)w[1]=y/D;
   if((s0&&s0*w[0]<-1e-13)||(s1&&s1*w[1]<-1e-13))continue;
   res[0]=q[0]-A*w[0]-b*w[1];res[1]=q[1]-b*w[0]-D*w[1];
   if(s0 ? fabs(res[0]-h*f[0]*s0)>2e-13 : fabs(res[0])>h*f[0]+2e-13)continue;
   if(s1 ? fabs(res[1]-h*f[1]*s1)>2e-13 : fabs(res[1])>h*f[1]+2e-13)continue;
   for(ch=0;ch<2;ch++){
    trial[ch]=k[ch]*(p[ch]+h*w[ch]-anchor[ch]);
    if(m[ch]==0 ? fabs(trial[ch])>Y+2e-13 : (m[ch]*trial[ch]<Y-2e-13))ok=0;
   }
   if(!ok)continue;
   for(ch=0;ch<2;ch++){
    double next=p[ch]+h*w[ch];
    state[ch]=next;state[ch+2]=w[ch];
    state[ch+4]=k[ch]>0?next-clip(trial[ch],Y)/k[ch]:anchor[ch];
   }
   return 1;
  }
 }
 return 0;
}
EXPORT int model_rollout(int n,const double *dt,const double *u,const double *p0,const double *v0,const double *theta,double *output){
 double state[6]={p0[0],p0[1],v0[0],v0[1],p0[0],p0[1]};int j,k;
 if(n<1||n>25000||!valid(theta))return -1;
 for(k=0;k<n;k++){
  if(!isfinite(dt[k])||dt[k]<=0||!step(state,u+2*k,dt[k],theta))return k;
  for(j=0;j<6;j++)if(!isfinite(state[j]))return k;
  output[2*k]=state[0];output[2*k+1]=state[1];
  if(fabs(state[0])>.05||fabs(state[1])>.05||fabs(state[2])>.5||fabs(state[3])>.5)return k;
 }
 return n;
}
EXPORT int model_memory_step(const double *initial,const double *u,double dt,const double *theta,double *output){
 int j;if(!valid(theta)||!isfinite(dt)||dt<=0)return 0;
 for(j=0;j<6;j++)output[j]=initial[j];
 return step(output,u,dt,theta);
}
