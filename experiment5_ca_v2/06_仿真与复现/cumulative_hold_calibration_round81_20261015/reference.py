"""Independent matrix/active-set check of the experimental breakaway model."""
import importlib.util,itertools
import numpy as np
from calibration_core import PRIOR
spec=importlib.util.spec_from_file_location('prior_mechanical_reference',PRIOR/'reference.py')
original=importlib.util.module_from_spec(spec);spec.loader.exec_module(original)

def mechanical_step(p,v,u,h,theta):
    p,v,u=(np.asarray(x,float) for x in (p,v,u));z=np.asarray(theta,float)
    if len(z)==9:return original.mechanical_step(p,v,u,h,z)
    if z.shape!=(11,) or not np.isfinite(z).all() or np.any(z[9:]<0):raise ValueError('Invalid extra static friction')
    M,g,B,K,F=original.matrices(z[:9])
    rest=np.abs(v)<=1e-12
    if not rest.all() and np.any(z[9:]>0):
        _,probe,_=original.mechanical_step(p,v,u,h,z[:9])
        rest=rest|(v*probe<=0)
    A=M+h*B+h*h*K;r=M@v+h*(g*u-K@p)
    limits=h*(F+z[9:]*rest);tol=2e-13*max(1,float(np.max(np.abs(r))))
    candidates=[]
    for signs in itertools.product((-1,0,1),repeat=2):
        signs=np.array(signs);ids=np.flatnonzero(signs)
        w=np.zeros(2)
        if len(ids):w[ids]=np.linalg.solve(A[np.ix_(ids,ids)],(r-h*F*signs)[ids])
        if np.any(w[ids]*signs[ids]<-tol):continue
        reaction=r-A@w;good=True
        for i in range(2):
            if signs[i]:good=good and abs(reaction[i]-h*F[i]*signs[i])<=tol
            else:good=good and abs(reaction[i])<=limits[i]+tol
        if not good:continue
        sticks=int(np.sum((signs==0)&rest))
        objective=float(.5*w@A@w-r@w+h*F@np.abs(w))
        candidates.append((-sticks,objective,w))
    if not candidates:raise ArithmeticError('No feasible static/kinetic velocity')
    _,_,w=min(candidates,key=lambda row:(row[0],row[1]));q=p+h*w
    before=.5*(v@M@v+p@K@p);after=.5*(w@M@w+q@K@q)
    work=h*(g*u)@w;visc=h*w@B@w;friction=h*F@np.abs(w)
    implicit=.5*((w-v)@M@(w-v)+h*h*w@K@w)
    return q,w,{'balanceResidual':float(after-before-work+visc+friction+implicit),'stickingEligible':rest.tolist()}
