import csv,ctypes,hashlib,json
from pathlib import Path
import numpy as np
from reference import mechanical_step

DIR=Path(__file__).resolve().parent;ROOT=DIR.parents[1]
sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
fit=json.loads((DIR/'fit_results.json').read_text(encoding='utf-8'))
protocol=json.loads((DIR/'protocol.json').read_text(encoding='utf-8'))
prior_path=ROOT/'06_仿真与复现/coulomb_joint_round65_20261015/joint_fit_results.json'
prior=json.loads(prior_path.read_text(encoding='utf-8'))
record=ROOT/'06_仿真与复现/identification_q2_summary40s_round61_20261015/build68012_0b743a60e6ed_analysis.json'
data=json.loads(record.read_text(encoding='utf-8'))
assert sha(fit['source'])==fit['sourceSHA256']==prior['sourceSHA256']==data['sourceSHA256']
assert sha(prior_path)==fit['previousFitSHA256']
assert sha(ROOT/'06_仿真与复现/coulomb_identification_round64_20261015/candidate_fit_results.json')==prior['previousFitSHA256']
assert sha(DIR/'protocol.json')==fit['protocolSHA256']
for file,key in [('native_model.c','nativeSolverSourceSHA256'),('native_model.dll','nativeLibrarySHA256'),('fit.py','fitScriptSHA256'),('reference.py','referenceSHA256')]:
    assert sha(DIR/file)==fit[key]
with Path(fit['source']).open(newline='',encoding='utf-8-sig') as f:
    r=csv.reader(f);assert next(r)==[f'I{k}' for k in range(107)]
    rows=np.array([[float(v) for v in row] for row in r])
assert rows.shape==(4526,107) and rows[1,0]<rows[0,0]
live=rows[1:];sign=np.array([1.,-1.]);pitch=data['header']['configured_meters_per_count']
dt=[];commands=[];indices=[];observations=[]
def hold(first,last):
    for row in data['slow'][first:last]:
        dt.extend([row['dt_us']*1e-6/40]*40)
        commands.extend([np.array(row['command_integral_counts_us'])*sign/row['dt_us']]*40)
        indices.append(len(dt)-1);observations.append(np.array(row['encoder'])*sign*pitch)
def motion(first,last):
    for row in data['fast'][first:last]:
        dt.append(row['dt_us']*1e-6);commands.append(np.array(row['command_counts'])*sign)
        indices.append(len(dt)-1);observations.append(np.array(row['encoder'])*sign*pitch)
hold(0,100);motion(0,4000);hold(100,150);motion(4000,8000);hold(150,300)
dt=np.ascontiguousarray(dt,float);commands=np.ascontiguousarray(commands,float)
indices=np.array(indices);observations=np.array(observations);assert len(dt)==20000 and len(indices)==8300
theta=np.array(fit['fit']['parameters']);scale=np.array(protocol['parameterScales'])
arr=np.ctypeslib.ndpointer(dtype=np.float64,flags='C_CONTIGUOUS')
lib=ctypes.CDLL(str(DIR/'native_model.dll'))
lib.model_rollout.argtypes=[ctypes.c_int,arr,arr,arr,arr,arr,arr];lib.model_rollout.restype=ctypes.c_int
native=np.empty((20000,2));zero=np.zeros(2)
assert lib.model_rollout(20000,dt,commands,zero,zero,theta,native)==20000
p=np.zeros(2);v=np.zeros(2);difference=0.;balance=0.
for k in range(20000):
    p,v,info=mechanical_step(p,v,commands[k],dt[k],theta)
    difference=max(difference,float(np.max(np.abs(p-native[k]))));balance=max(balance,abs(info['balanceResidual']))
assert difference<1e-10 and balance<1e-10
e=1000*(native[indices]-observations);weights=np.diff(np.r_[0.,np.cumsum(dt)[indices]])
objective=float(np.sum(weights*(e.mean(axis=1)**2+(e[:,0]-e[:,1])**2))+1e-8*np.sum((theta/scale)**2))
assert abs(objective-fit['fit']['finalObjective'])<1e-12
assert abs(fit['fit']['initialObjective']-prior['fit']['finalObjective'])<1e-12
active=live[(live[:,106]==1)&(live[:,2]>=2)&(live[:,2]<=5)];at=active[:,46].astype(int)-2
assert len(active)==400
positions=native[at];positions=np.sign(positions)*np.floor(np.abs(positions/pitch)+.5)*pitch;positions=np.round(positions,6)
err=1000*(positions-active[:,5:7])
mean=float(np.sqrt(np.mean(err.mean(axis=1)**2)));sync=float(np.sqrt(np.mean((err[:,0]-err[:,1])**2)))
expected=fit['continuous20sTrainingPreviews'][0]['native40msPredictionErrors']
assert abs(mean-expected['meanPositionPredictionRMSE_mm'])<1e-12 and abs(sync-expected['syncPredictionRMSE_mm'])<1e-12
actual_tracking=float(np.sqrt(np.mean((1000*(active[:,5:7].mean(axis=1)-active[:,3]))**2)))
actual_sync=float(np.sqrt(np.mean((1000*(active[:,5]-active[:,6]))**2)))
evaluations=fit['allCalibrationEvaluations'];assert len(evaluations)==fit['fit']['objectiveEvaluations']<=protocol['maxEvaluations']
assert all(len(a['parameters'])==9 and abs(a['parameters'][8])<=.95 for a in evaluations)
assert len(fit['fit']['iterations'])<=protocol['maxIterations']
assert all(s['after']<=s['before']+1e-15 for s in fit['fit']['iterations'])
old=prior['continuous20sTrainingPreviews'][0]['native40msPredictionErrors']
before_mean=old['meanPositionPredictionRMSE_mm'];before_sync=old['syncPredictionRMSE_mm']
print(json.dumps({'passed':True,'ordinaryOnly':True,'S3R2DataRead':False,
    'independentPythonContinuousSteps':20000,'maximumNativePythonPositionDifference_m':difference,
    'maximumEnergyBalanceResidual':balance,'native40msPoints':400,
    'meanPositionPredictionRMSE_mm':mean,'syncPredictionRMSE_mm':sync,
    'previousModelPredictionMeanSyncRMSE_mm':[before_mean,before_sync],
    'meanPredictionErrorReduction_percent':100*(before_mean-mean)/before_mean,
    'syncPredictionErrorIncrease_percent':100*(sync-before_sync)/before_sync,
    'actualOrdinaryTrackingRMSE_mm':actual_tracking,'actualOrdinarySyncRMS_mm':actual_sync,
    'objectiveRecomputed':objective,'objectiveReduction_percent':100*(fit['fit']['initialObjective']-objective)/fit['fit']['initialObjective'],
    'eta':float(theta[8]),'massEigenvalues':fit['massEigenvalues'],'calibrationEvaluations':len(evaluations),
    'lowerBoundHits':fit['numericalBoundHits']['lower'],'globalOptimumOrStructuralImpossibilityProven':False,
    'holdInputRemainsMeanAbstraction':True,'instantaneousSensorModelUnverified':True,
    'trainingFitNotIndependentPredictionValidation':True,'previousNegativeResultsAndRawHashesUnchanged':True,
    'modelClosureComplete':False,'predictiveAdmission':False,'controllerChanged':False,'physicalRunReleased':False,
    'decision':'One inertial coefficient did not resolve sync prediction discrepancy under this fixed fit budget. Stop this round; do not use this model for claiming candidate efficacy or launch physical batch.'},ensure_ascii=False))
