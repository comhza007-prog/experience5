import csv, ctypes, hashlib, json, sys
from pathlib import Path
import numpy as np

DIR=Path(__file__).resolve().parent;ROOT=DIR.parents[1]
PREV=ROOT/'06_仿真与复现/coulomb_identification_round64_20261015'
sys.path.insert(0,str(ROOT/'06_仿真与复现/model_identifiability_round63_20261015'))
from candidate_core import mechanical_step
result=json.loads((DIR/'joint_fit_results.json').read_text(encoding='utf-8'))
data=json.loads((ROOT/'06_仿真与复现/identification_q2_summary40s_round61_20261015/build68012_0b743a60e6ed_analysis.json').read_text(encoding='utf-8'))
sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
assert sha(result['source'])==result['sourceSHA256']
assert sha(PREV/'native_model.dll')==result['nativeLibrarySHA256']
assert sha(PREV/'candidate_fit_results.json')==result['previousFitSHA256']
with Path(result['source']).open(newline='',encoding='utf-8-sig') as f:
 r=csv.reader(f);assert next(r)==[f'I{k}' for k in range(107)]
 live=np.array([[float(v) for v in row] for row in r])[1:]
sign=np.array([1.,-1.]);pitch=data['header']['configured_meters_per_count'];theta=np.array(result['fit']['parameters'])
dt=[];commands=[]
def hold(first,last):
 for r in data['slow'][first:last]:
  dt.extend([r['dt_us']*1e-6/40]*40)
  commands.extend([np.array(r['command_integral_counts_us'])*sign/r['dt_us']]*40)
def motion(first,last):
 for r in data['fast'][first:last]:
  dt.append(r['dt_us']*1e-6);commands.append(np.array(r['command_counts'])*sign)
hold(0,100);motion(0,4000);hold(100,150);motion(4000,8000);hold(150,300)
dt=np.ascontiguousarray(dt,float);commands=np.ascontiguousarray(commands,float);assert len(dt)==20000
lib=ctypes.CDLL(str(PREV/'native_model.dll'));arr=np.ctypeslib.ndpointer(dtype=np.float64,flags='C_CONTIGUOUS')
lib.model_rollout.argtypes=[ctypes.c_int,arr,arr,arr,arr,arr,arr];lib.model_rollout.restype=ctypes.c_int
native=np.empty((20000,2));zero=np.array([0.,0.])
assert lib.model_rollout(20000,dt,commands,zero,zero,theta,native)==20000
p=np.zeros(2);v=np.zeros(2);maximum_difference=0.
for k in range(20000):
 p,v,info=mechanical_step(p,v,commands[k],dt[k],theta)
 maximum_difference=max(maximum_difference,float(np.max(np.abs(p-native[k]))))
assert maximum_difference<1e-10
active=live[(live[:,106]==1)&(live[:,2]>=2)&(live[:,2]<=5)];indices=active[:,46].astype(int)-2
positions=native[indices];positions=np.sign(positions)*np.floor(np.abs(positions/pitch)+.5)*pitch;positions=np.round(positions,6)
errors=1000*(positions-active[:,5:7])
mean=float(np.sqrt(np.mean(errors.mean(axis=1)**2)));sync=float(np.sqrt(np.mean((errors[:,0]-errors[:,1])**2)))
expected=result['continuous20sTrainingPreviews'][0]['native40msPredictionErrors']
assert abs(mean-expected['meanPositionPredictionRMSE_mm'])<1e-12
assert abs(sync-expected['syncPredictionRMSE_mm'])<1e-12
attempts=result['allCalibrationEvaluations'];assert len(attempts)==result['fit']['objectiveEvaluations']<=160
assert all(len(a['parameters'])==8 for a in attempts)
assert all(s['after']<=s['before']+1e-15 for s in result['fit']['iterations'])
print(json.dumps({'passed':True,'independentPythonContinuousSteps':20000,'maximumNativePythonPositionDifference_m':maximum_difference,
 'native40msPoints':400,'meanPositionPredictionRMSE_mm':mean,'syncPredictionRMSE_mm':sync,
 'ordinaryTrainingOnly':True,'holdInputRemainsMeanAbstraction':True,'notIndependentPredictionValidation':True,
 'previousFailureAndRawHashesUnchanged':True,'calibrationEvaluations':len(attempts),'controllerChanged':False,'physicalRunReleased':False}))
