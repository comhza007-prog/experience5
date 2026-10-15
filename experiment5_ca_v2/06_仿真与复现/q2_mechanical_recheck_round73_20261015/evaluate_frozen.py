import csv, ctypes, hashlib, json, sys
from pathlib import Path
import numpy as np

HERE=Path(__file__).resolve().parent;ROOT=HERE.parents[1]
MODEL=ROOT/'06_仿真与复现/inertia_coupling_round66_20261015'
sys.path.insert(0,str(MODEL))
from reference import mechanical_step
sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
prepared=json.loads((HERE/'preparation.json').read_text(encoding='utf-8'))
protocol=json.loads((HERE/'protocol.json').read_text(encoding='utf-8'))
assert sha(HERE/'protocol.json')==prepared['protocolSHA256']
record=HERE/'build68012_84bbb6e34165_analysis.json'
d=json.loads(record.read_text(encoding='utf-8'));raw=Path(d['source'])
assert sha(raw)==d['sourceSHA256'] and d['qualified'] and d['capture_audit']['qualified']
capture_verification=HERE/'build68012_84bbb6e34165_verification.json'
assert json.loads(capture_verification.read_text(encoding='utf-8'))['independentPythonFullDecodeCRCAndMetrics']['passed']
with raw.open(newline='',encoding='utf-8-sig') as f:
    r=csv.reader(f);assert next(r)==[f'I{k}' for k in range(107)]
    allrows=np.array([[float(v) for v in row] for row in r])
assert np.flatnonzero((np.diff(allrows[:,0])<=0)|(np.diff(allrows[:,1])<=0)).tolist()==[0]
live=allrows[1:];active=live[(live[:,106]==1)&(live[:,2]>=2)&(live[:,2]<=5)]
at=active[:,46].astype(int)-2;assert len(at)==400
assert np.all(np.abs(active[:,46]-(active[:,79]*1000+1))<.01)
pitch=d['header']['configured_meters_per_count'];sign=np.array([1.,-1.])
dt=[];u=[];indices=[];observed=[]
for kind,a,b in [('hold',0,100),('motion',0,4000),('hold',100,150),('motion',4000,8000),('hold',150,300)]:
    for row in d['slow' if kind=='hold' else 'fast'][a:b]:
        if kind=='hold':
            mean=np.array(row['command_integral_counts_us'])*sign/row['dt_us']
            for _ in range(40):dt.append(row['dt_us']/40e6);u.append(mean)
        else:dt.append(row['dt_us']/1e6);u.append(np.array(row['command_counts'])*sign)
        indices.append(len(dt)-1);observed.append(np.array(row['encoder'])*sign*pitch)
dt=np.ascontiguousarray(dt,float);u=np.ascontiguousarray(u,float)
indices=np.array(indices);observed=np.array(observed)
assert len(dt)==20000 and len(indices)==8300
oldchecks=json.loads((MODEL/'solver_verification.json').read_text(encoding='utf-8'))
assert sha(MODEL/'native_model.dll')==oldchecks['nativeLibrarySHA256']
arr=np.ctypeslib.ndpointer(dtype=np.float64,flags='C_CONTIGUOUS')
lib=ctypes.CDLL(str(MODEL/'native_model.dll'))
lib.model_rollout.argtypes=[ctypes.c_int,arr,arr,arr,arr,arr,arr];lib.model_rollout.restype=ctypes.c_int
def metrics(e):
    return {'axisRMSE_mm':np.sqrt(np.mean(e*e,axis=0)).tolist(),
            'meanPositionPredictionRMSE_mm':float(np.sqrt(np.mean(e.mean(axis=1)**2))),
            'syncWaveformPredictionRMSE_mm':float(np.sqrt(np.mean((e[:,0]-e[:,1])**2))),
            'meanMaximumAbsolute_mm':float(np.max(np.abs(e.mean(axis=1)))),
            'syncMaximumAbsolute_mm':float(np.max(np.abs(e[:,0]-e[:,1])))}
results=[];checks=[]
for n,item in enumerate(prepared['frozenModels']):
    assert sha(item['path'])==item['SHA256'],'Frozen model changed after registration'
    original=json.loads(Path(item['path']).read_text(encoding='utf-8'))
    assert original['fit']['parameters']==item['parameters']
    theta=np.ascontiguousarray(item['parameters'],float)
    pred=np.full((20000,2),np.nan)
    completed=lib.model_rollout(20000,dt,u,np.zeros(2),np.zeros(2),theta,pred)
    assert completed==20000 and np.isfinite(pred).all()
    p=np.zeros(2);v=np.zeros(2);difference=0.;balance=0.
    for k in range(20000):
        p,v,info=mechanical_step(p,v,u[k],dt[k],theta)
        difference=max(difference,float(np.max(np.abs(p-pred[k]))))
        balance=max(balance,abs(info['balanceResidual']))
    assert difference<1e-12 and balance<1e-10
    continuous=pred[at];mapped=np.sign(continuous)*np.floor(np.abs(continuous/pitch)+.5)*pitch
    mapped=np.round(mapped,6)
    error=(mapped-active[:,5:7])*1000
    rawerror=(pred[indices]-observed)*1000
    modeled_tracking=float(np.sqrt(np.mean(((mapped.mean(axis=1)-active[:,3])*1000)**2)))
    modeled_sync=float(np.sqrt(np.mean(((mapped[:,0]-mapped[:,1])*1000)**2)))
    actual_tracking=d['capture_audit']['metrics']['trackingRMSE_mm'];actual_sync=d['capture_audit']['metrics']['syncRMS_mm']
    result={'model':'round66_priorDiagnostic' if n==0 else 'round72_T1FrozenPrimary',
      'sourceModel':item['path'],'frozenModelSHA256':item['SHA256'],'parameters':theta.tolist(),
      'parametersChanged':False,'trainedOnNewQ2':False,'modelSelectedFromNewQ2Outcome':False,
      'completedSteps':completed,'initialStateOnlyOnce':True,'futureMeasuredStatesInjected':False,
      'nativeSamples':400,'nativePredictionError':metrics(error),'continuousEndpointPredictionError':metrics(rawerror),
      'modeledTaskTrackingRMSE_mm':modeled_tracking,'modeledTaskSyncRMS_mm':modeled_sync,
      'actualTaskTrackingRMSE_mm':actual_tracking,'actualTaskSyncRMS_mm':actual_sync,
      'taskMetricRelativeDifference_percent':{'tracking':100*(modeled_tracking/actual_tracking-1),'sync':100*(modeled_sync/actual_sync-1)},
      'nativeContinuousAxisPosition_m':continuous.tolist(),'nativeMappedAxisPosition_m':mapped.tolist(),
      'phaseErrors':[{'phase':phase,'samples':int(np.sum(active[:,2]==phase)),'errors':metrics(error[active[:,2]==phase])} for phase in [2,3,4,5]],
      'holdMeanInputAndEncoderMapRemainUnverified':True,'forcedInputNotFreeClosedLoopSimulation':True,
      'applicationNumericalToleranceUnspecified':True,'modelAdmitted':False}
    results.append(result)
    checks.append({'model':result['model'],'independentPythonSteps':20000,'maximumNativePythonPositionDifference_m':difference,
                   'maximumEnergyBalanceResidual':balance,'frozenParameterAndModelFileHashesUnchanged':True})
assert sha(raw)==d['sourceSHA256']
for item in prepared['frozenModels']:assert sha(item['path'])==item['SHA256']
old_raw=Path(protocol['dataFolder'])/'E5ID_Q2S_BLNN_B68012_HW6_L1200_R1200_M0g_S2mm_run01.csv'
assert sha(old_raw)==protocol['oldQ2SHA256']
out={'date':'2026-10-15','protocolSHA256':sha(HERE/'protocol.json'),'preparationSHA256':sha(HERE/'preparation.json'),
 'scriptSHA256':sha(__file__),'source':str(raw),'sourceSHA256':sha(raw),'decodedSHA256':sha(record),
 'captureVerificationSHA256':sha(capture_verification),'captureQualified':True,
 'captureMetrics':d['capture_audit']['metrics'],'captureFault':0,'captureMoving1msRecords':8000,'captureCompletionTail_s':d['capture_audit']['completionTail_s'],
 'mechanicalCondition':'Tightened Q2run02, same condition as T1 per user confirmation. Old loose Q2run01 excluded from this evaluation.',
 'evaluatedModels':results,'verification':checks,'modelsRefitted':0,'controllerChanged':False,
 'S3R2DataRead':False,'newQ2UsedForCalibration':False,'modelClosureComplete':False,
 'interpretation':'Prospectively frozen models evaluated against a newly acquired record without refitting. This is out-of-training-record forced-input replay, not a validated free-running controller/plant model. No invented application tolerance or model-admission claim. Recording quality is separate from predictive validity.',
 'rawOldAndNewPreserved':True,'assistantHardwareAction':False,'additionalPhysicalRunReleased':False}
with (HERE/'frozen_model_evaluation.json').open('x',encoding='utf-8') as f:json.dump(out,f,ensure_ascii=False,indent=2,allow_nan=False)
print(json.dumps({k:v for k,v in out.items() if k!='evaluatedModels'}|{'evaluatedModels':[{k:v for k,v in r.items() if k not in ['nativeContinuousAxisPosition_m','nativeMappedAxisPosition_m','phaseErrors']} for r in results]},ensure_ascii=False))
