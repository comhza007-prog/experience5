"""Frozen R79 evaluation on Q2 run03. No fitting, state injection or hardware I/O."""
import csv,ctypes,hashlib,json,sys
from pathlib import Path
import numpy as np

HERE=Path(__file__).resolve().parent;ROOT=HERE.parents[1]
MODEL=ROOT/'06_仿真与复现/inertia_coupling_round66_20261015'
sys.path.insert(0,str(MODEL))
from reference import mechanical_step
sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
frozen=ROOT/'06_仿真与复现/measurement_target_calibration_round79_20261015/model_parameters.json'
expected_hash='2ec09510d85313fa468343837b398add271e7ffe12a06c9c8088e2f79ee8299b'
assert sha(frozen)==expected_hash
model=json.loads(frozen.read_text(encoding='utf-8'))
fitpath=frozen.parent/'fit_results.json'
assert sha(fitpath)==model['fitResultsSHA256']
priorfit=json.loads(fitpath.read_text(encoding='utf-8'))
decoded=HERE/'capture_analysis.json';verification=HERE/'capture_verification.json'
d=json.loads(decoded.read_text(encoding='utf-8'));vfy=json.loads(verification.read_text(encoding='utf-8'))
assert vfy['completeCRCVerifiedMotionSnapshotUsable']
assert vfy['independentPythonFullDecodeCRCAndMetrics']['passed']
raw=Path(d['source']);rawhash=sha(raw)
assert rawhash==d['sourceSHA256']
assert all(s['rawSHA256']!=rawhash for s in model['trainingSources'])
with raw.open(newline='',encoding='utf-8-sig') as f:
    reader=csv.reader(f);assert next(reader)==[f'I{k}' for k in range(107)]
    allrows=np.array([[float(v) for v in r] for r in reader])
assert np.flatnonzero((np.diff(allrows[:,0])<=0)|(np.diff(allrows[:,1])<=0)).tolist()==[0]
rows=allrows[1:]
active=rows[(rows[:,106]==1)&(rows[:,2]>=2)&(rows[:,2]<=5)]
assert len(active)==399
at=active[:,46].astype(int)-2
assert np.all(np.abs(active[:,46]-(active[:,79]*1000+1))<.01)
pitch=d['header']['configured_meters_per_count'];sign=np.array([1.,-1.])
dt=[];u=[];indices=[];observed=[]
for mode,a,b in [('hold',0,100),('motion',0,4000),('hold',100,150),('motion',4000,8000),('hold',150,300)]:
    for row in d['slow' if mode=='hold' else 'fast'][a:b]:
        if mode=='hold':
            dt.extend([row['dt_us']/40e6]*40)
            u.extend([np.array(row['command_integral_counts_us'])*sign/row['dt_us']]*40)
        else:dt.append(row['dt_us']/1e6);u.append(np.array(row['command_counts'])*sign)
        indices.append(len(dt)-1);observed.append(np.array(row['encoder'])*sign*pitch)
dt=np.ascontiguousarray(dt,float);u=np.ascontiguousarray(u,float);indices=np.array(indices);observed=np.array(observed)
assert len(dt)==20000 and len(indices)==8300
libpath=ROOT/model['solverRelativeToProject'];assert sha(libpath)==priorfit['nativeLibrarySHA256']
assert sha(MODEL/'native_model.c')==priorfit['nativeModelSHA256']
lib=ctypes.CDLL(str(libpath));arr=np.ctypeslib.ndpointer(dtype=np.float64,flags='C_CONTIGUOUS')
lib.model_rollout.argtypes=[ctypes.c_int,arr,arr,arr,arr,arr,arr];lib.model_rollout.restype=ctypes.c_int
theta=np.ascontiguousarray(model['parameters'],float);assert np.array_equal(theta,priorfit['fit']['parameters'])
positions=np.full((20000,2),np.nan)
assert lib.model_rollout(20000,dt,u,np.zeros(2),np.zeros(2),theta,positions)==20000
p=np.zeros(2);vel=np.zeros(2);maxdiff=0.;balance=0.
for k in range(20000):
    p,vel,info=mechanical_step(p,vel,u[k],dt[k],theta)
    maxdiff=max(maxdiff,float(np.max(np.abs(p-positions[k]))));balance=max(balance,abs(info['balanceResidual']))
assert maxdiff<1e-12 and balance<1e-10
continuous=positions[at]
mapped=np.sign(continuous)*np.floor(np.abs(continuous/pitch)+.5)*pitch
mapped=np.round(mapped,6)
actual=active[:,5:7]
actual_track=(actual.mean(axis=1)-active[:,3])*1000
pred_track=(mapped.mean(axis=1)-active[:,3])*1000
actual_sync=(actual[:,0]-actual[:,1])*1000
pred_sync=(mapped[:,0]-mapped[:,1])*1000
rms=lambda a:float(np.sqrt(np.mean(a*a)))
def errors(e):
    return {'axisRMSE_mm':np.sqrt(np.mean(e*e,axis=0)).tolist(),
            'meanPositionWaveformRMSE_mm':rms(e.mean(axis=1)),
            'syncWaveformRMSE_mm':rms(e[:,0]-e[:,1]),
            'meanMaximumAbsoluteDifference_mm':float(np.max(np.abs(e.mean(axis=1)))),
            'syncMaximumAbsoluteDifference_mm':float(np.max(np.abs(e[:,0]-e[:,1])))}
wave_error=errors((mapped-actual)*1000)
endpoint_error=errors((positions[indices]-observed)*1000)
metrics={'observedNativeSamples':399,'expectedNativeSamples':400,
         'actualTrackingRMSE_mm':rms(actual_track),'modeledTrackingRMSE_mm':rms(pred_track),
         'actualSyncRMS_mm':rms(actual_sync),'modeledSyncRMS_mm':rms(pred_sync),
         'trackingRelativeDifference_percent':100*(rms(pred_track)/rms(actual_track)-1),
         'syncRelativeDifference_percent':100*(rms(pred_sync)/rms(actual_sync)-1),
         'trackingWaveformCorrelation':float(np.corrcoef(actual_track,pred_track)[0,1]),
         'syncWaveformCorrelation':float(np.corrcoef(actual_sync,pred_sync)[0,1])}
assert abs(metrics['actualTrackingRMSE_mm']-vfy['metrics']['trackingRMSE_mm'])<1e-12
assert abs(metrics['actualSyncRMS_mm']-vfy['metrics']['syncRMS_mm'])<1e-12
firmware=json.loads((ROOT/'06_仿真与复现/q2_mechanical_recheck_round73_20261015/preparation.json').read_text(encoding='utf-8'))
protocol=json.loads((ROOT/'06_仿真与复现/q2_mechanical_recheck_round73_20261015/protocol.json').read_text(encoding='utf-8'))
assert sha(protocol['hex'])==firmware['hexSHA256']
project=Path(protocol['project']).parents[1]
for filename,expected in firmware['currentSourceHashes'].items():assert sha(project/filename)==expected
assert sha(frozen)==expected_hash and sha(raw)==rawhash
phase_errors=[{'phase':phase,'samples':int(np.sum(active[:,2]==phase)),
               'errors':errors((mapped-actual)[active[:,2]==phase]*1000)} for phase in [2,3,4,5]]
training_q2=next(c for c in priorfit['cases'] if c['record']=='Q2' and c['case']=='measurementTargetRefit')
out={'date':'2026-10-15','source':str(raw),'sourceSHA256':rawhash,'decodedSHA256':sha(decoded),
     'captureVerificationSHA256':sha(verification),'frozenModel':str(frozen),'frozenModelSHA256':expected_hash,
     'scriptSHA256':sha(__file__),'parameters':theta.tolist(),'parametersChanged':False,'modelsRefitted':0,
     'run03IncludedInTraining':False,'modelSelectedFromRun03Outcome':False,
     'fullRecordingProtocolQualified':False,'completeCRCVerifiedMotionSnapshotUsable':True,
     'recordingLimitations':vfy['reasons'],'completionTail_s':vfy['completionTail_s'],
     'missingCSVFrames':1,'missingSamplesImputed':False,
     'nativeMetrics':metrics,'nativeWaveformErrors':wave_error,'continuous8300EndpointWaveformErrors':endpoint_error,
     'firmware400PointMetricsNotMixedWith399PointModelComparison':vfy['firmware400PointMetrics'],
     'phaseErrors':phase_errors,
     'calibrationQ2NativeWaveformErrorsForContextOnly':training_q2['nativePredictionError'],
     'simulationType':'Frozen-parameter forced queued-input replay; hold 40-step mean input approximation retained, not autonomous closed-loop simulation',
     'initialStateOnlyOnce':True,'futureMeasuredStateInjected':False,'outputsCorrectedOrSyntheticNoiseAdded':False,
     'independentNumericalVerification':{'passed':True,'steps':20000,'maximumCAndPythonPositionDifference_m':maxdiff,'maximumEnergyBalanceResidual':balance},
     'allRawParameterAndSevenFirmwareSourceHashesUnchanged':True,
     'applicationToleranceSpecifiedInAdvance':False,'independentPhysicalModelAcceptanceDeclared':False,
     'hardwareAction':False,'additionalPhysicalRunReleased':False}
with (HERE/'frozen_model_evaluation.json').open('x',encoding='utf-8') as f:json.dump(out,f,ensure_ascii=False,indent=2,allow_nan=False)
trace={'elapsedControlTime_s':active[:,79].tolist(),'actualTrackingError_mm':actual_track.tolist(),
       'modeledTrackingError_mm':pred_track.tolist(),'actualSyncError_mm':actual_sync.tolist(),
       'modeledSyncError_mm':pred_sync.tolist(),'phase':active[:,2].astype(int).tolist()}
with (HERE/'comparison_trace.json').open('x',encoding='utf-8') as f:json.dump(trace,f,ensure_ascii=False,indent=2,allow_nan=False)
print(json.dumps(out,ensure_ascii=False))
