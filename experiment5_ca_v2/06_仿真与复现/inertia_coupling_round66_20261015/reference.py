"""Independent host-only matrix formulation. Effective queued-command model.

Generalizes the previously verified convex stick/slip solver to SPD mass.
No hardware, controller or calibration selection entry points.
"""
import sys, math
from pathlib import Path
import numpy as np
sys.path.insert(0,str(Path(__file__).resolve().parent.parent/'model_identifiability_round63_20261015'))
from candidate_core import solve_velocity, LAPLACIAN

def matrices(theta):
    z=np.asarray(theta,float)
    if z.shape!=(9,) or not np.isfinite(z).all() or (z[:8]<0).any() or (z[:2]<=0).any() or abs(z[8])>=1:
        raise ValueError('Eight nonnegative coefficients, positive gains and SPD mass required')
    return np.array([[1.,z[8]],[z[8],1.]]),z[:2],np.diag(z[2:4])+z[5]*LAPLACIAN,z[4]*LAPLACIAN,z[6:8]

def mechanical_step(p,v,u,h,theta):
    p,v,u=(np.asarray(x,float) for x in (p,v,u))
    if any(x.shape!=(2,) or not np.isfinite(x).all() for x in (p,v,u)) or not math.isfinite(h) or h<=0:
        raise ValueError('Finite state/input and positive dt required')
    mass,g,B,K,F=matrices(theta)
    A=mass+h*B+h*h*K
    r=mass@v+h*(g*u-K@p)
    w,info=solve_velocity(A,r,h*F)
    q=p+h*w
    e0=.5*(v@mass@v+p@K@p);e1=.5*(w@mass@w+q@K@q)
    work=h*(g*u)@w;visc=h*w@B@w;fric=h*F@np.abs(w)
    loss=.5*((w-v)@mass@(w-v)+h*h*w@K@w)
    info.update(energyBefore=float(e0),energyAfter=float(e1),inputWork=float(work),
                viscousLoss=float(visc),frictionLoss=float(fric),implicitLoss=float(loss),
                balanceResidual=float(e1-e0-work+visc+fric+loss))
    return q,w,info
