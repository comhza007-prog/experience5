"""Host-only independent matrix elastic-deadzone reference, not hardware."""
import sys,math
from pathlib import Path
import numpy as np
sys.path.insert(0,str(Path(__file__).resolve().parent.parent/'model_identifiability_round63_20261015'))
from candidate_core import solve_velocity,LAPLACIAN

def mechanical_step(p,v,u,h,theta):
    p,v,u=(np.asarray(x,float) for x in (p,v,u));z=np.asarray(theta,float)
    if z.shape!=(10,) or not np.isfinite(z).all() or (z[:8]<0).any() or z[9]<0 or (z[:2]<=0).any() or abs(z[8])>=1:
        raise ValueError('Invalid coefficients or mass')
    if any(x.shape!=(2,) or not np.isfinite(x).all() for x in (p,v,u)) or not math.isfinite(h) or h<=0:raise ValueError('Invalid state/input/dt')
    mass=np.array([[1.,z[8]],[z[8],1.]]);B=np.diag(z[2:4])+z[5]*LAPLACIAN
    edge=np.array([1.,-1.]);base=mass@v+h*z[:2]*u;answers=[]
    for region in [-1,0,1]:
        k=z[4] if region else 0.;A=mass+h*B+h*h*k*LAPLACIAN
        r=base-h*k*(p[0]-p[1]-region*z[9])*edge
        w,info=solve_velocity(A,r,h*z[6:8]);q=p+h*w;diff=q[0]-q[1]
        if (region==0 and abs(diff)>z[9]+2e-13) or (region>0 and diff<z[9]-2e-13) or (region<0 and diff>-z[9]+2e-13):continue
        potential=.5*z[4]*max(abs(diff)-z[9],0)**2
        objective=.5*w@(mass+h*B)@w-base@w+potential+h*z[6:8]@np.abs(w)
        answers.append((objective,w,q,info,region))
    if not answers:raise ArithmeticError('No valid spring regime')
    _,w,q,info,region=min(answers,key=lambda x:x[0])
    if any(np.max(np.abs(a[1]-w))>1e-10 for a in answers):raise ArithmeticError('Nonunique numeric solution')
    pot=lambda x:.5*z[4]*max(abs(x[0]-x[1])-z[9],0)**2
    spring_force=z[4]*np.sign(q[0]-q[1])*max(abs(q[0]-q[1])-z[9],0)*edge
    e0=.5*v@mass@v+pot(p);e1=.5*w@mass@w+pot(q)
    work=h*(z[:2]*u)@w;visc=h*w@B@w;fric=h*z[6:8]@np.abs(w)
    kinetic_slack=.5*(w-v)@mass@(w-v);elastic_slack=spring_force@(q-p)-(pot(q)-pot(p))
    info.update(springRegion=region,energyBefore=float(e0),energyAfter=float(e1),inputWork=float(work),
        viscousLoss=float(visc),frictionLoss=float(fric),implicitLoss=float(kinetic_slack+elastic_slack),
        elasticConvexSlack=float(elastic_slack),balanceResidual=float(e1-e0-work+visc+fric+kinetic_slack+elastic_slack))
    return q,w,info
