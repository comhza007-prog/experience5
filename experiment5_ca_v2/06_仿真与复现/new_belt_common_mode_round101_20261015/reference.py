"""Independent NumPy active-set solution and discrete energy identity."""
import itertools
import numpy as np
def step(state,u,h,z):
    p,v,anchor=np.asarray(state[:2]),np.asarray(state[2:4]),np.asarray(state[4:]);z=np.asarray(z)
    M=np.array([[1,z[8]],[z[8],1.]])
    B=np.diag(z[2:4])+z[5]*np.array([[1.,-1.],[-1.,1.]])+.5*z[13]*np.ones((2,2))
    K=z[4]*np.array([[1.,-1.],[-1.,1.]])+.5*z[12]*np.ones((2,2))
    A=M+h*B+h*h*K;rhs=M@v+h*(z[:2]*u-K@p);ks=z[9:11];Y=z[11]
    for modes in itertools.product((0,-1,1),repeat=2):
        modes=np.array(modes);stiff=np.where(modes==0,ks,0)
        F=np.where(modes==0,ks*(p-anchor),modes*Y)
        AA=A+h*h*np.diag(stiff);q=rhs-h*F
        for signs in itertools.product((-1,0,1),repeat=2):
            signs=np.array(signs);ids=np.flatnonzero(signs);w=np.zeros(2)
            if len(ids):w[ids]=np.linalg.solve(AA[np.ix_(ids,ids)],(q-h*z[6:8]*signs)[ids])
            if np.any(w*signs < -1e-13):continue
            reaction=q-AA@w
            if any(abs(reaction[i]-h*z[6+i]*signs[i])>2e-13 if signs[i] else abs(reaction[i])>h*z[6+i]+2e-13 for i in range(2)):continue
            trial=ks*(p+h*w-anchor)
            if any(abs(trial[i])>Y+2e-13 if modes[i]==0 else modes[i]*trial[i]<Y-2e-13 for i in range(2)):continue
            pp=p+h*w;force=np.clip(trial,-Y,Y);ap=anchor.copy();nz=ks>0;ap[nz]=pp[nz]-force[nz]/ks[nz]
            e=p-anchor;ep=pp-ap
            energy0=.5*(v@M@v+p@K@p+np.sum(ks*e*e))
            energy1=.5*(w@M@w+pp@K@pp+np.sum(ks*ep*ep))
            plastic=float(force@(ap-anchor));diss=h*(w@B@w+z[6:8]@abs(w))+plastic
            implicit=.5*((w-v)@M@(w-v)+(pp-p)@K@(pp-p)+np.sum(ks*(ep-e)**2))
            work=h*(z[:2]*u)@w
            return np.r_[pp,w,ap],dict(energyBalanceResidual=float(energy1-energy0-work+diss+implicit),plasticDissipation=plastic)
    raise ArithmeticError('No feasible implicit elastic-slider state')
