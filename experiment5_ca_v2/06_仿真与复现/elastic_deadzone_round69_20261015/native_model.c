/* HOST ONLY. Convex implicit elastic-deadzone/Coulomb step, SPD mass.
 * No MCU headers, controller calls, GPIO, UART or actuation entry points. */
#include <math.h>
#include <stddef.h>
#ifdef _WIN32
#define EXPORT __declspec(dllexport)
#else
#define EXPORT
#endif
static int valid(const double *z){
 int ch;
 for(ch=0;ch<10;ch++)if(!isfinite(z[ch])||((ch<8||ch==9)&&z[ch]<0))return 0;
 return z[0]>0&&z[1]>0&&fabs(z[8])<1;
}
static int one_step(double p[2],double v[2],const double u[2],double h,const double z[10]){
 double base0=v[0]+z[8]*v[1]+h*z[0]*u[0],base1=v[1]+z[8]*v[0]+h*z[1]*u[1];
 double f0=h*z[6],f1=h*z[7],best=HUGE_VAL,bw0=0,bw1=0,tol=2e-13*fmax(1,fmax(fabs(base0),fabs(base1)));
 int spring,s0,s1,found=0;
 for(spring=-1;spring<=1;spring++){
  double stiffness=spring?z[4]:0,cross=h*z[5]+h*h*stiffness;
  double a=1+h*z[2]+cross,b=z[8]-cross,d=1+h*z[3]+cross;
  double elastic=h*stiffness*(p[0]-p[1]-spring*z[9]),r0=base0-elastic,r1=base1+elastic;
  for(s0=-1;s0<=1;s0++)for(s1=-1;s1<=1;s1++){
  double w0=0,w1=0,x=r0-f0*s0,y=r1-f1*s1,res0,res1,objective;
  if(s0&&s1){double det=a*d-b*b;w0=(d*x-b*y)/det;w1=(a*y-b*x)/det;}
  else if(s0)w0=x/a;
  else if(s1)w1=y/d;
  if((s0&&w0*s0 < -tol)||(s1&&w1*s1 < -tol))continue;
  res0=r0-a*w0-b*w1;res1=r1-b*w0-d*w1;
  if(s0 ? fabs(res0-f0*s0)>tol : fabs(res0)>f0+tol)continue;
  if(s1 ? fabs(res1-f1*s1)>tol : fabs(res1)>f1+tol)continue;
  {double gap=p[0]-p[1]+h*(w0-w1),stretch=fmax(0,fabs(gap)-z[9]);
   if((spring==0&&fabs(gap)>z[9]+tol)||(spring>0&&gap<z[9]-tol)||(spring<0&&gap>-z[9]+tol))continue;
   objective=.5*((1+h*z[2]+h*z[5])*w0*w0+2*(z[8]-h*z[5])*w0*w1+(1+h*z[3]+h*z[5])*w1*w1)-base0*w0-base1*w1+f0*fabs(w0)+f1*fabs(w1)+.5*z[4]*stretch*stretch;
  }
  if(!found||objective<best){best=objective;bw0=w0;bw1=w1;found=1;}
  }
 }
 if(!found)return 0;
 v[0]=bw0;v[1]=bw1;p[0]+=h*bw0;p[1]+=h*bw1;
 return isfinite(p[0])&&isfinite(p[1])&&isfinite(v[0])&&isfinite(v[1]);
}
EXPORT int model_rollout(int n,const double *dt,const double *u,const double *p0,const double *v0,const double *theta,double *output){
 double p[2]={p0[0],p0[1]},v[2]={v0[0],v0[1]};int k;
 if(n<1||n>25000||!valid(theta))return -1;
 for(k=0;k<n;k++){
  if(!isfinite(dt[k])||dt[k]<=0||!one_step(p,v,u+2*k,dt[k],theta))return k;
  output[2*k]=p[0];output[2*k+1]=p[1];
  if(fabs(p[0])>.05||fabs(p[1])>.05||fabs(v[0])>.5||fabs(v[1])>.5)return k;
 }
 return n;
}
EXPORT int model_one(const double *p0,const double *v0,const double *u,double dt,const double *theta,double *output){
 double p[2]={p0[0],p0[1]},v[2]={v0[0],v0[1]};
 if(!valid(theta)||!isfinite(dt)||dt<=0||!one_step(p,v,u,dt,theta))return 0;
 output[0]=p[0];output[1]=p[1];output[2]=v[0];output[3]=v[1];return 1;
}
