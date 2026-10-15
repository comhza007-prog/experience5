"""One predeclared holdout, frozen R82 replay; no fitting or hardware access."""
import csv,ctypes,hashlib,importlib.util,json,sys
from pathlib import Path
import numpy as np
HERE=Path(__file__).resolve().parent;ROOT=HERE.parents[1]
MODEL=ROOT/'06_仿真与复现/tracking_refine_round82_20261015'
sys.path.insert(0,str(MODEL))
spec=importlib.util.spec_from_file_location('static_mechanical_reference',ROOT/'06_仿真与复现/cumulative_hold_calibration_round81_20261015/reference.py')
reference=importlib.util.module_from_spec(spec);spec.loader.exec_module(reference)
sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
protocol=json.loads((HERE/'protocol.json').read_text(encoding='utf-8'))
frozen=Path(protocol['modelParameters']);assert sha(frozen)==protocol['frozenModelSHA256']
model=json.loads(frozen.read_text(encoding='utf-8'))
theta=np.ascontiguousarray(model['parameters'],float)
assert len(theta)==11 and np.array_equal(theta,protocol['frozenParameters'])
decoded=HERE/'capture_analysis.json';verification=HERE/'capture_verification.json'
d=json.loads(decoded.read_text(encoding='utf-8'));vfy=json.loads(verification.read_text(encoding='utf-8'))
assert vfy['fullRecordingProtocolQualified'] and vfy['independentPythonFullDecodeCRCAndMetrics']['passed']
raw=Path(d['source']);rawhash=sha(raw);assert rawhash==d['sourceSHA256']
assert all(s['rawSHA256']!=rawhash for s in model['sourceHashes'])
with raw.open(newline='',encoding='utf-8-sig') as f:
    reader=csv.reader(f);assert next(reader)==[f'I{k}' for k in range(107)]
    rows=np.array([[float(v) for v in r] for r in reader])
assert np.all(np.diff(rows[:,1])==1)
active=rows[(rows[:,106]==1)&(rows[:,2]>=2)&(rows[:,2]<=5)]
assert len(active)==400
at=active[:,46].astype(int)-2
assert np.all(np.abs(active[:,46]-(active[:,79]*1000+1))<.01)
pitch=d['header']['configured_meters_per_count'];sign=np.array([1.,-1.])
dt=[];u=[];indices=[];observed=[]
for mode,a,b in [('slow',0,100),('fast',0,4000),('slow',100,150),('fast',4000,8000),('slow',150,300)]:
    for row in d[mode][a:b]:
        if mode=='slow':
            dt.extend([row['dt_us']/40e6]*40)
            u.extend([np.array(row['command_integral_counts_us'])*sign/row['dt_us']]*40)
        else:dt.append(row['dt_us']/1e6);u.append(np.array(row['command_counts'])*sign)
        indices.append(len(dt)-1);observed.append(np.array(row['encoder'])*sign*pitch)
dt=np.ascontiguousarray(dt,float);u=np.ascontiguousarray(u,float);indices=np.array(indices);observed=np.array(observed)
assert len(dt)==20000 and len(indices)==8300
# Independent raw/packed endpoint alignment and next-interval command convention.
endpoint_lookup={int(i):p for i,p in zip(indices,observed)}
assert all(np.all(np.abs(np.round(endpoint_lookup[int(i)],6)-r[5:7])<1e-12) for i,r in zip(at,active))
moving=active[np.isin(active[:,2],[2,4])]
for row in moving:
    next_index=int(row[46])-1
    assert np.array_equal(u[next_index],row[13:15]*sign)
libpath=ROOT/model['solverRelativeToProject'];assert sha(libpath)==protocol['solverSHA256']==model['solverSHA256']
assert sha(MODEL/'native_model.c')==model['solverSourceSHA256']
arr=np.ctypeslib.ndpointer(dtype=np.float64,flags='C_CONTIGUOUS')
lib=ctypes.CDLL(str(libpath));lib.model_rollout.argtypes=[ctypes.c_int,arr,arr,arr,arr,arr,arr];lib.model_rollout.restype=ctypes.c_int
positions=np.full((20000,2),np.nan)
assert lib.model_rollout(20000,dt,u,np.zeros(2),np.zeros(2),theta,positions)==20000
p=np.zeros(2);vel=np.zeros(2);maxdiff=0.;balance=0.
for k in range(20000):
    p,vel,info=reference.mechanical_step(p,vel,u[k],dt[k],theta)
    maxdiff=max(maxdiff,float(np.max(np.abs(p-positions[k]))));balance=max(balance,abs(info['balanceResidual']))
assert maxdiff<1e-12 and balance<1e-10
continuous=positions[at]
mapped=np.round(np.sign(continuous)*np.floor(np.abs(continuous/pitch)+.5)*pitch,6)
actual=active[:,5:7];ref=active[:,3]
actual_track=(actual.mean(axis=1)-ref)*1000;pred_track=(mapped.mean(axis=1)-ref)*1000
actual_sync=(actual[:,0]-actual[:,1])*1000;pred_sync=(mapped[:,0]-mapped[:,1])*1000
rms=lambda a:float(np.sqrt(np.mean(a*a)))
def errors(e):
    return {'axisRMSE_mm':np.sqrt(np.mean(e*e,axis=0)).tolist(),
            'meanPositionWaveformRMSE_mm':rms(e.mean(axis=1)),'syncWaveformRMSE_mm':rms(e[:,0]-e[:,1]),
            'meanMaximumAbsoluteDifference_mm':float(np.max(np.abs(e.mean(axis=1)))),
            'syncMaximumAbsoluteDifference_mm':float(np.max(np.abs(e[:,0]-e[:,1])))}
metrics={'observedNativeSamples':400,'expectedNativeSamples':400,
         'actualTrackingRMSE_mm':rms(actual_track),'modeledTrackingRMSE_mm':rms(pred_track),
         'actualSyncRMS_mm':rms(actual_sync),'modeledSyncRMS_mm':rms(pred_sync),
         'trackingRelativeDifference_percent':100*(rms(pred_track)/rms(actual_track)-1),
         'syncRelativeDifference_percent':100*(rms(pred_sync)/rms(actual_sync)-1),
         'trackingWaveformCorrelation':float(np.corrcoef(actual_track,pred_track)[0,1]),
         'syncWaveformCorrelation':float(np.corrcoef(actual_sync,pred_sync)[0,1])}
assert abs(metrics['actualTrackingRMSE_mm']-vfy['metrics']['trackingRMSE_mm'])<1e-12
assert abs(metrics['actualSyncRMS_mm']-vfy['metrics']['syncRMS_mm'])<1e-12
assert sha(protocol['hex'])==protocol['hexSHA256']
project=Path(protocol['project']).parents[1]
for filename,expected in protocol['codeHashes'].items():assert sha(project/filename)==expected
assert sha(frozen)==protocol['frozenModelSHA256'] and sha(raw)==rawhash
for old in model['sourceHashes']:assert sha(old['raw'])==old['rawSHA256']
out={'date':'2026-10-15','source':str(raw),'sourceSHA256':rawhash,'decodedSHA256':sha(decoded),
     'captureVerificationSHA256':sha(verification),'preCaptureProtocolSHA256':sha(HERE/'protocol.json'),
     'frozenModel':str(frozen),'frozenModelSHA256':protocol['frozenModelSHA256'],
     'scriptSHA256':sha(__file__),'parameters':theta.tolist(),'parametersChanged':False,'modelsRefitted':0,
     'run04IncludedInTraining':False,'modelSelectedFromRun04Outcome':False,
     'fullRecordingProtocolQualified':True,'completeCRCVerifiedMotionSnapshotUsable':True,
     'recordingLimitations':[],'completionTail_s':vfy['completionTail_s'],'missingCSVFrames':0,'missingSamplesImputed':False,
     'nativeMetrics':metrics,'nativeWaveformErrors':errors((mapped-actual)*1000),
     'continuous8300EndpointWaveformErrors':errors((positions[indices]-observed)*1000),
     'firmware400PointMetrics':vfy['firmware400PointMetrics'],
     'phaseErrors':[{'phase':phase,'samples':int(np.sum(active[:,2]==phase)),
       'errors':errors((mapped-actual)[active[:,2]==phase]*1000),
       'actualTrackingRMSE_mm':rms(actual_track[active[:,2]==phase]),'modeledTrackingRMSE_mm':rms(pred_track[active[:,2]==phase]),
       'actualSyncRMS_mm':rms(actual_sync[active[:,2]==phase]),'modeledSyncRMS_mm':rms(pred_sync[active[:,2]==phase])} for phase in [2,3,4,5]],
     'returnHoldFinalTrackingError_mm':float(pred_track[-1]),'actualReturnHoldFinalTrackingError_mm':float(actual_track[-1]),
     'returnHoldFinalSyncError_mm':float(pred_sync[-1]),'actualReturnHoldFinalSyncError_mm':float(actual_sync[-1]),
     'simulationType':'Frozen-parameter forced queued-input replay; hold40step means retained, not autonomous closed-loop simulation',
     'initialStateOnlyOnce':True,'futureMeasuredStateInjected':False,'outputsCorrectedOrSyntheticNoiseAdded':False,
     'independentNumericalVerification':{'passed':True,'steps':20000,'maximumCAndPythonPositionDifference_m':maxdiff,
       'maximumEnergyBalanceResidual':balance,'nativePackedEncoderAlignmentChecks':400,'nextIntervalMovingCommandChecks':len(moving)},
     'allRawParameterHexAndSevenFirmwareSourceHashesUnchanged':True,
     'applicationToleranceSpecifiedInAdvance':False,'independentPhysicalModelAcceptanceDeclared':False,
     'hardwareAction':False,'additionalPhysicalRunReleased':False}
with (HERE/'frozen_model_evaluation.json').open('x',encoding='utf-8') as f:json.dump(out,f,ensure_ascii=False,indent=2,allow_nan=False)
trace={'elapsedControlTime_s':active[:,79].tolist(),'actualTrackingError_mm':actual_track.tolist(),
       'modeledTrackingError_mm':pred_track.tolist(),'actualSyncError_mm':actual_sync.tolist(),
       'modeledSyncError_mm':pred_sync.tolist(),'phase':active[:,2].astype(int).tolist()}
with (HERE/'comparison_trace.json').open('x',encoding='utf-8') as f:json.dump(trace,f,ensure_ascii=False,indent=2,allow_nan=False)
print(json.dumps(out,ensure_ascii=False))
