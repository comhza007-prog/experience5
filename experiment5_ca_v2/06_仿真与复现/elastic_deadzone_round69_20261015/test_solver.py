import ctypes,hashlib,json
from pathlib import Path
import numpy as np
from reference import mechanical_step

DIR=Path(__file__).resolve().parent;ROOT=DIR.parents[1]
sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
arr=np.ctypeslib.ndpointer(dtype=np.float64,flags='C_CONTIGUOUS')
def load(path):
    lib=ctypes.CDLL(str(path));lib.model_one.argtypes=[arr,arr,arr,ctypes.c_double,arr,arr];lib.model_one.restype=ctypes.c_int
    return lib
new=load(DIR/'native_model.dll');old=load(ROOT/'06_仿真与复现/inertia_coupling_round66_20261015/native_model.dll')
rng=np.random.default_rng(69015);difference=0.;balance=0.;regression=0.;min_slack=0.;regions=set()
for i in range(1500):
    z=np.r_[rng.uniform(1e-6,1e-4,2),rng.uniform(0,100,2),rng.uniform(0,2e4),rng.uniform(0,800),rng.uniform(0,.05,2),rng.uniform(-.95,.95),rng.uniform(0,.001)]
    p=rng.uniform(-.002,.002,2);v=rng.uniform(-.01,.01,2);u=rng.uniform(-1200,1200,2);h=rng.uniform(.0005,.002)
    q,w,info=mechanical_step(p,v,u,h,z);out=np.empty(4);assert new.model_one(p,v,u,h,z,out)==1
    difference=max(difference,float(np.max(np.abs(out-np.r_[q,w]))));balance=max(balance,abs(info['balanceResidual']))
    min_slack=min(min_slack,info['elasticConvexSlack']);regions.add(info['springRegion'])
    z[9]=0.;a=np.empty(4);b=np.empty(4)
    assert new.model_one(p,v,u,h,z,a)==1 and old.model_one(p,v,u,h,np.ascontiguousarray(z[:9]),b)==1
    regression=max(regression,float(np.max(np.abs(a-b))))
assert difference<1e-10 and balance<1e-10 and regression<1e-10 and min_slack>=-1e-12 and regions=={-1,0,1}
for eta in [-.95,0.,.95]:
    z=np.array([1e-5,2e-5,4.,6.,200.,20.,.05,.06,eta,.0002]);p=np.array([.00005,-.00005]);v=np.zeros(2);u=np.array([100.,-100.]);out=np.empty(4)
    assert new.model_one(p,v,u,.001,z,out)==1 and np.max(np.abs(out[:2]-p))==0 and np.max(np.abs(out[2:]))==0
    p=np.array([.001,-.0005]);v=np.array([.003,-.002]);zero=np.zeros(2);last=None
    for i in range(3000):
        assert new.model_one(p,v,zero,.001,z,out)==1;p=out[:2].copy();v=out[2:].copy()
        mass=np.array([[1.,eta],[eta,1.]]);energy=.5*v@mass@v+.5*z[4]*max(abs(p[0]-p[1])-z[9],0)**2
        if last is not None:assert energy<=last+1e-12
        last=energy
for gap in [-.001,float('nan')]:
    z=np.array([1e-5,2e-5,4.,6.,200.,20.,.05,.06,0.,gap]);assert new.model_one(np.zeros(2),np.zeros(2),np.zeros(2),.001,z,np.empty(4))==0
print(json.dumps({'passed':True,'randomCases':1500,'zeroInputDecaySteps':9000,'stickingInsideGapCases':3,
    'elasticRegionsObserved':sorted(regions),'maximumNativePythonStateDifference':difference,'maximumEnergyBalanceResidual':balance,
    'minimumElasticConvexSlack':min_slack,'maximumGapZeroRound66Difference':regression,
    'nativeLibrarySHA256':sha(DIR/'native_model.dll'),'nativeSourceSHA256':sha(DIR/'native_model.c'),'referenceSHA256':sha(DIR/'reference.py'),
    'notPhysicalValidation':True,'hardwareAction':False}))
