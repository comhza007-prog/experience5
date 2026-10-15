"""OFFLINE effective mechanical candidate, not calibrated hardware control.

Same eight nonnegative normalized coefficients as round58, but Coulomb
friction is set-valued at zero speed (can stick under a nonzero input).
Implicit endpoint update solves a strictly convex two-variable problem.
No measured-future-state correction, automatic fit, hardware or controller API.
"""
import itertools
import math
import numpy as np

NAMES=('inputGainLeft','inputGainRight','dampingLeft','dampingRight',
       'reciprocalSpring','reciprocalDamping','coulombFrictionLeft','coulombFrictionRight')
LAPLACIAN=np.array([[1.,-1.],[-1.,1.]])

def matrices(parameters):
    theta=np.asarray(parameters,dtype=float)
    if theta.shape!=(8,) or not np.isfinite(theta).all() or (theta<0).any() or (theta[:2]<=0).any():
        raise ValueError('Eight finite nonnegative coefficients; input gains strictly positive')
    return theta[:2],np.diag(theta[2:4])+theta[5]*LAPLACIAN,theta[4]*LAPLACIAN,theta[6:8]

def solve_velocity(M,r,threshold):
    """Enumerate9stick/slip active sets; no regularization smoothing at0."""
    M=np.asarray(M,float);r=np.asarray(r,float);threshold=np.asarray(threshold,float)
    if M.shape!=(2,2) or r.shape!=(2,) or threshold.shape!=(2,):
        raise ValueError('Two-axis dimensions')
    if not all(np.isfinite(x).all() for x in (M,r,threshold)) or (threshold<0).any():
        raise ValueError('Finite input and nonnegative friction')
    if not np.allclose(M,M.T,rtol=0,atol=1e-14) or np.linalg.eigvalsh(M).min()<=0:
        raise ValueError('Strictly positive symmetric implicit inertia')
    tolerance=2e-13*max(1.,float(np.abs(r).max()))
    candidates=[]
    for status in itertools.product([-1,0,1],repeat=2):
        s=np.array(status,float);active=np.flatnonzero(s)
        w=np.zeros(2)
        if len(active):
            w[active]=np.linalg.solve(M[np.ix_(active,active)],r[active]-threshold[active]*s[active])
            if (w[active]*s[active]<-tolerance).any():
                continue
        residual=r-M@w
        if any(abs(residual[ch])>threshold[ch]+tolerance for ch in range(2) if s[ch]==0):
            continue
        if any(abs(residual[ch]-threshold[ch]*s[ch])>tolerance for ch in active):
            continue
        objective=.5*w@M@w-r@w+threshold@np.abs(w)
        candidates.append((float(objective),w,residual,status))
    if not candidates:
        raise ArithmeticError('No admissible stick/slip active set')
    best=min(candidates,key=lambda x:x[0])
    if any(np.max(np.abs(c[1]-best[1]))>1e-10 for c in candidates):
        raise ArithmeticError('Inconsistent numerical active-set solutions')
    return best[1],{'frictionImpulse':best[2],'activeSet':list(best[3]),'objective':best[0]}

def mechanical_step(position,velocity,queued_input,dt,parameters):
    """Nominal effective qdd=g*u-B*v-K*q-Coulomb(v); units normalized.

    queued_input is NOT delivered force. Parameters are explicit caller
    inputs, never learned from a validation output or controller performance.
    """
    p=np.asarray(position,float);v=np.asarray(velocity,float);u=np.asarray(queued_input,float)
    if any(x.shape!=(2,) or not np.isfinite(x).all() for x in (p,v,u)) or not math.isfinite(dt) or dt<=0:
        raise ValueError('Finite two-axis state/input and positive actual dt')
    g,B,K,F=matrices(parameters)
    M=np.eye(2)+dt*B+dt*dt*K
    r=v+dt*(g*u-K@p)
    w,info=solve_velocity(M,r,dt*F)
    q=p+dt*w
    energy_before=.5*(v@v+p@K@p)
    energy_after=.5*(w@w+q@K@q)
    input_work=dt*(g*u)@w
    viscous_loss=dt*w@B@w
    friction_loss=dt*F@np.abs(w)
    implicit_loss=.5*((w-v)@(w-v)+dt*dt*w@K@w)
    info.update(energyBefore=float(energy_before),energyAfter=float(energy_after),
                inputWork=float(input_work),viscousLoss=float(viscous_loss),
                frictionLoss=float(friction_loss),implicitLoss=float(implicit_loss),
                balanceResidual=float(energy_after-energy_before-input_work+viscous_loss+friction_loss+implicit_loss))
    return q,w,info

def integer_rpm(value,quantizer):
    """Explicit observation hypotheses, NOT an actual hardware calibration."""
    if quantizer=='nearest':
        return math.floor(value+.5) if value>=0 else math.ceil(value-.5)
    if quantizer=='floor':
        return math.floor(value)
    raise ValueError('Choose a declared observation hypothesis; no auto-selection')
