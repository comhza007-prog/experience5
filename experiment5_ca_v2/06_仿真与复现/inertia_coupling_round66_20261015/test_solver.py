import ctypes, hashlib, json
from pathlib import Path
import numpy as np
from reference import mechanical_step,matrices

DIR=Path(__file__).resolve().parent;ROOT=DIR.parents[1]
sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
arr=np.ctypeslib.ndpointer(dtype=np.float64,flags='C_CONTIGUOUS')
def load(path):
    lib=ctypes.CDLL(str(path));lib.model_one.argtypes=[arr,arr,arr,ctypes.c_double,arr,arr];lib.model_one.restype=ctypes.c_int
    return lib
new=load(DIR/'native_model.dll')
old=load(ROOT/'06_仿真与复现/coulomb_identification_round64_20261015/native_model.dll')
rng=np.random.default_rng(66015);maxdiff=0.;balance=0.;regression=0.;kkt=0.
for i in range(1500):
    theta=np.r_[rng.uniform(1e-6,1e-4,2),rng.uniform(0,100,2),rng.uniform(0,2e4),rng.uniform(0,800),rng.uniform(0,.05,2),rng.uniform(-.95,.95)]
    p=rng.uniform(-.003,.003,2);v=rng.uniform(-.01,.01,2);u=rng.uniform(-1200,1200,2);h=rng.uniform(.0005,.002)
    q,w,info=mechanical_step(p,v,u,h,theta);out=np.empty(4)
    assert new.model_one(p,v,u,h,theta,out)==1
    maxdiff=max(maxdiff,float(np.max(np.abs(out-np.r_[q,w]))));balance=max(balance,abs(info['balanceResidual']))
    M,g,B,K,F=matrices(theta);residual=M@v+h*(g*u-K@p)-(M+h*B+h*h*K)@w
    nz=np.abs(w)>1e-10
    violation=np.maximum(np.abs(residual)-h*F,0.)
    if nz.any():violation[nz]=np.abs(residual[nz]-h*F[nz]*np.sign(w[nz]))
    kkt=max(kkt,float(violation.max()))
    theta[8]=0.;a=np.empty(4);b=np.empty(4)
    assert new.model_one(p,v,u,h,theta,a)==1 and old.model_one(p,v,u,h,np.ascontiguousarray(theta[:8]),b)==1
    regression=max(regression,float(np.max(np.abs(a-b))))
assert maxdiff<1e-10 and balance<1e-10 and kkt<1e-10 and regression<1e-12
for eta in [-.95,0.,.95]:
    z=np.array([1e-5,2e-5,4.,6.,200.,20.,.05,.06,eta]);p=np.zeros(2);v=np.zeros(2);u=np.array([100.,-100.]);out=np.empty(4)
    assert new.model_one(p,v,u,.001,z,out)==1 and np.max(np.abs(out))==0
    p=np.array([.001,-.0005]);v=np.array([.003,-.002]);zero=np.zeros(2)
    M,g,B,K,F=matrices(z);last=.5*(v@M@v+p@K@p)
    for i in range(3000):
        assert new.model_one(p,v,zero,.001,z,out)==1
        p=out[:2].copy();v=out[2:].copy();energy=.5*(v@M@v+p@K@p)
        assert energy<=last+1e-12;last=energy
for eta in [-1.,1.,float('nan')]:
    z=np.array([1e-5,2e-5,4.,6.,200.,20.,.05,.06,eta]);assert new.model_one(np.zeros(2),np.zeros(2),np.zeros(2),.001,z,np.empty(4))==0
print(json.dumps({'passed':True,'randomCases':1500,'freeDecaySteps':9000,'stickCases':3,'invalidMassRejected':3,
    'maximumNativePythonStateDifference':maxdiff,'maximumEnergyBalanceResidual':balance,'maximumKKTResidual':kkt,
    'maximumEtaZeroOldSolverDifference':regression,'nativeLibrarySHA256':sha(DIR/'native_model.dll'),
    'nativeSourceSHA256':sha(DIR/'native_model.c'),'referenceSHA256':sha(DIR/'reference.py'),
    'notPhysicalValidation':True,'hardwareAction':False}))
