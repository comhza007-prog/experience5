import json
import numpy as np
from candidate_core import mechanical_step,solve_velocity,integer_rpm,matrices

rng=np.random.default_rng(20261015)
maximum_residual=0.
maximum_solver_difference=0.
for n in range(5000):
    theta=np.r_[rng.uniform(1e-6,1e-4,2),rng.uniform(0,50,2),rng.uniform(0,10000),rng.uniform(0,20),rng.uniform(0,.2,2)]
    p=rng.uniform(-.004,.004,2);v=rng.uniform(-.1,.1,2);u=rng.uniform(-1200,1200,2);dt=rng.uniform(.00075,.00125)
    q,w,info=mechanical_step(p,v,u,dt,theta)
    maximum_residual=max(maximum_residual,abs(info['balanceResidual']))
    assert abs(info['balanceResidual'])<1e-12
    assert info['viscousLoss']>=-1e-15 and info['frictionLoss']>=-1e-15 and info['implicitLoss']>=-1e-15
    assert info['energyAfter']-info['energyBefore'] <= info['inputWork']+1e-12
    if n<500:
        g,B,K,F=matrices(theta);M=np.eye(2)+dt*B+dt*dt*K;r=v+dt*(g*u-K@p)
        # Independent cyclic soft-threshold coordinate descent.
        x=np.zeros(2)
        for iteration in range(200):
            before=x.copy()
            for ch in range(2):
                z=r[ch]-M[ch,1-ch]*x[1-ch]
                x[ch]=np.sign(z)*max(abs(z)-dt*F[ch],0)/M[ch,ch]
            if np.max(np.abs(x-before))<1e-14:
                break
        difference=float(np.max(np.abs(x-w)))
        maximum_solver_difference=max(maximum_solver_difference,difference)
        assert difference<1e-11

theta=np.array([1e-5,1e-5,5,5,20,2,.002,.002])
p=np.zeros(2);v=np.zeros(2)
for k in range(1000):
    p,v,info=mechanical_step(p,v,[100,-100],.001,theta)
    assert np.array_equal(p,[0,0]) and np.array_equal(v,[0,0])
for u in ([1000,1000],[-1000,-1000],[1000,-1000]):
    q,w,info=mechanical_step([0,0],[0,0],u,.001,theta)
    assert np.all(np.sign(w)==np.sign(u)) and np.max(np.abs(q))>0

for n in range(20):
    p=rng.uniform(-.004,.004,2);v=rng.uniform(-.02,.02,2)
    for k in range(500):
        p,v,info=mechanical_step(p,v,[0,0],.001,theta)
        assert info['energyAfter']<=info['energyBefore']+1e-12

assert integer_rpm(-.2,'nearest')==0 and integer_rpm(-.2,'floor')==-1
assert integer_rpm(-.5,'nearest')==-1 and integer_rpm(.5,'nearest')==1
for bad in ([0]*8,[-1]*8,[1]*7):
    try:
        mechanical_step([0,0],[0,0],[0,0],.001,bad)
    except ValueError:
        pass
    else:
        raise AssertionError('Invalid coefficients accepted')
print(json.dumps({'passed':True,'randomEnergyKKTSteps':5000,'independentCoordinateSolverCases':500,
                  'zeroInputDissipationSteps':10000,'nonzeroInputStickingSteps':1000,
                  'maximumBalanceResidual':maximum_residual,'maximumIndependentSolverDifference':maximum_solver_difference,
                  'nineActiveSetImplicitCoulombCoreReady':True,'eightCoefficientHypothesisNotFittedToPhysicalData':True,
                  'observationQuantizersAreDeclaredHypothesesOnly':True,
                  'closedLoopStabilityOfActualBLNNNotProven':True,'modelIdentified':False,
                  'wholeTaskSimulationValidated':False,'controllerChanged':False,'hardwareAction':False}))
