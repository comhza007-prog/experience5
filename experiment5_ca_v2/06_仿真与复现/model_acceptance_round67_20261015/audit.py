"""Frozen-model diagnostic, no parameter fitting or hardware APIs."""
import csv,ctypes,hashlib,json
from pathlib import Path
import numpy as np

DIR=Path(__file__).resolve().parent;ROOT=DIR.parents[1]
MODEL=ROOT/'06_仿真与复现/inertia_coupling_round66_20261015'
sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
fit=json.loads((MODEL/'fit_results.json').read_text(encoding='utf-8'))
verified=json.loads((MODEL/'prediction_verification.json').read_text(encoding='utf-8'));assert verified['passed']
data_path=ROOT/'06_仿真与复现/identification_q2_summary40s_round61_20261015/build68012_0b743a60e6ed_analysis.json'
data=json.loads(data_path.read_text(encoding='utf-8'));raw=Path(data['source'])
assert sha(raw)==data['sourceSHA256']==fit['sourceSHA256'] and data['qualified']
assert sha(MODEL/'native_model.dll')==fit['nativeLibrarySHA256']
with raw.open(newline='',encoding='utf-8-sig') as f:
    r=csv.reader(f);assert next(r)==[f'I{k}' for k in range(107)]
    allrows=np.array([[float(v) for v in row] for row in r])
assert allrows.shape==(4526,107) and allrows[1,0]<allrows[0,0]
live=allrows[1:];pitch=data['header']['configured_meters_per_count'];sign=np.array([1.,-1.])
dt=[];commands=[]
def hold(first,last):
    for row in data['slow'][first:last]:
        dt.extend([row['dt_us']*1e-6/40]*40)
        commands.extend([np.array(row['command_integral_counts_us'])*sign/row['dt_us']]*40)
def motion(first,last):
    for row in data['fast'][first:last]:
        dt.append(row['dt_us']*1e-6);commands.append(np.array(row['command_counts'])*sign)
hold(0,100);motion(0,4000);hold(100,150);motion(4000,8000);hold(150,300)
dt=np.ascontiguousarray(dt,float);commands=np.ascontiguousarray(commands,float);assert len(dt)==20000
theta=np.array(fit['fit']['parameters']);arr=np.ctypeslib.ndpointer(dtype=np.float64,flags='C_CONTIGUOUS')
lib=ctypes.CDLL(str(MODEL/'native_model.dll'));lib.model_rollout.argtypes=[ctypes.c_int,arr,arr,arr,arr,arr,arr];lib.model_rollout.restype=ctypes.c_int
pred=np.empty((20000,2));zero=np.zeros(2)
assert lib.model_rollout(20000,dt,commands,zero,zero,theta,pred)==20000
active=live[(live[:,106]==1)&(live[:,2]>=2)&(live[:,2]<=5)];at=active[:,46].astype(int)-2;assert len(active)==400
native=pred[at];native=np.sign(native)*np.floor(np.abs(native/pitch)+.5)*pitch;native=np.round(native,6)
physical=active[:,5:7];reference=active[:,3]
rms=lambda x:float(np.sqrt(np.mean(np.asarray(x)**2)))
modal=lambda p:np.column_stack([p.mean(axis=1),p[:,0]-p[:,1]])
error=1000*modal(native-physical)
def residual_summary(x):
    bias=x.mean(axis=0);centered=np.sqrt(np.mean((x-bias)**2,axis=0));ss=np.sum(x*x,axis=0)
    return {'meanSyncBias_mm':bias.tolist(),'meanSyncCenteredRMS_mm':centered.tolist(),
            'meanSyncPredictionRMSE_mm':np.sqrt(np.mean(x*x,axis=0)).tolist(),'meanSyncSSE_mm2':ss.tolist()}
total=residual_summary(error);phase_results=[]
for phase,name in [(2,'outward'),(3,'targetHold'),(4,'return'),(5,'returnHold')]:
    mask=active[:,2]==phase;summary=residual_summary(error[mask])
    assert np.allclose(np.array(summary['meanSyncBias_mm'])**2+np.array(summary['meanSyncCenteredRMS_mm'])**2,
                       np.array(summary['meanSyncPredictionRMSE_mm'])**2,rtol=0,atol=1e-12)
    phase_results.append({'phase':phase,'name':name,'nativePoints':int(mask.sum()),**summary,
                          'meanSyncTotalSSEContribution_percent':(100*np.array(summary['meanSyncSSE_mm2'])/np.array(total['meanSyncSSE_mm2'])).tolist()})
metric_results=[]
for name,actual,modeled in [
    ('trackingRMSE_mm',rms(1000*(physical.mean(axis=1)-reference)),rms(1000*(native.mean(axis=1)-reference))),
    ('syncRMS_mm',rms(1000*(physical[:,0]-physical[:,1])),rms(1000*(native[:,0]-native[:,1]))),
    ('maxTracking_mm',float(np.max(np.abs(1000*(physical.mean(axis=1)-reference)))),float(np.max(np.abs(1000*(native.mean(axis=1)-reference))))),
    ('maxSync_mm',float(np.max(np.abs(1000*(physical[:,0]-physical[:,1])))),float(np.max(np.abs(1000*(native[:,0]-native[:,1])))))]:
    metric_results.append({'metric':name,'actual':actual,'modeled':modeled,'signedDifference':modeled-actual,'relativeSignedDifference_percent':100*(modeled-actual)/actual})
assert abs(total['meanSyncPredictionRMSE_mm'][0]-verified['meanPositionPredictionRMSE_mm'])<1e-12
assert abs(total['meanSyncPredictionRMSE_mm'][1]-verified['syncPredictionRMSE_mm'])<1e-12
segments=[]
for phase,name,first,last,anchor,global_first in [(2,'outward',0,4000,99,4000),(4,'return',4000,8000,149,10000)]:
    fast=data['fast'][first:last];hh=np.array([row['dt_us']*1e-6 for row in fast])
    observed=np.array([row['encoder'] for row in fast])*sign*pitch
    observed_start=np.array(data['slow'][anchor]['encoder'])*sign*pitch
    modeled=pred[global_first:global_first+4000];modeled_start=pred[global_first-1]
    increments=(modeled-modeled_start)-(observed-observed_start)
    rpms=np.array([row['rpm'] for row in fast])*sign
    measured_rpm_displacement=np.sum(hh[:,None]*rpms*pitch*8192/60,axis=0)
    encoder_displacement=observed[-1]-observed_start
    previous_hold=data['slow'][:100] if phase==2 else data['slow'][100:150]
    sums=np.array([row['command_integral_counts_us'] for row in previous_hold])*sign
    segments.append({'name':name,'exactInputIntervals':4000,
        'modelStartMinusObservedStart_mm':(1000*(modeled_start-observed_start)).tolist(),
        'positionIncrementResidual':residual_summary(1000*modal(increments)),
        'incrementDiagnosticNotSimulationStateReset':True,
        'encoderDisplacement_mm':(1000*encoder_displacement).tolist(),
        'endpointRPMIntegratedDisplacement_mm':(1000*measured_rpm_displacement).tolist(),
        'encoderMinusRPMDisplacement_mm':(1000*(encoder_displacement-measured_rpm_displacement)).tolist(),
        'precedingHoldCommandIntegralWasAllZero':bool(np.all(sums==0)),
        'inputIsQueuedCountsNotCalibratedForce':True,'measurementMismatchCauseNotIdentified':True})
assert sum(x['nativePoints'] for x in phase_results)==400
assert np.allclose(np.sum([x['meanSyncSSE_mm2'] for x in phase_results],axis=0),total['meanSyncSSE_mm2'],rtol=0,atol=1e-12)
ratio_sync=metric_results[1]['modeled']/metric_results[1]['actual']
out={'date':'2026-10-15','source':str(raw),'sourceSHA256':sha(raw),'decodedSourceSHA256':sha(data_path),
     'frozenFitSHA256':sha(MODEL/'fit_results.json'),'protocolSHA256':sha(DIR/'protocol.json'),
     'ordinaryOnly':True,'S3R2DataRead':False,'modelsRefitted':0,'parametersChanged':False,
     'native40msPoints':400,'sameOriginalTaskWindow':True,'taskMetrics':metric_results,
     'nativeComparisonTrace':[{'coreStep':int(active[k,46]),'phase':int(active[k,2]),'reference_m':float(reference[k]),
        'observed_m':physical[k].tolist(),'modeled_m':native[k].tolist()} for k in range(400)],
     'nativePredictionResidual':total,'phaseResiduals':phase_results,'exactMovingDiagnostics':segments,
     'modeledToObservedSyncRMSRatio':ratio_sync,
     'trajectoryRMSEEmpiricalMetricDifferenceBound_mm':total['meanSyncPredictionRMSE_mm'],
     'boundIsThisTrainingRecordOnlyNotUniversalOrIndependent':True,
     'diagnosticDecision':{'syncMagnitudeGrosslyUnderrepresentedInThisFrozenReplay':bool(ratio_sync<.2),
        'factorFiveUsedOnlyDescriptiveNotApprovalThreshold':True,
        'fullModelPredictionAdmitted':False,'rootCauseProven':False,
        'exactOutwardInputAvailableWithoutNonzeroPreholdCommandMean':segments[0]['precedingHoldCommandIntegralWasAllZero'],
        'outwardMismatchExistsWithZeroPreholdCommandIntegralAndMatchingBoundaryPosition':bool(segments[0]['precedingHoldCommandIntegralWasAllZero'] and np.max(np.abs(segments[0]['modelStartMinusObservedStart_mm']))<1e-12),
        'note':'Zero prehold queued means and observed fixed endpoints do not prove absent unknown external motion or force. No unique physical root cause claimed.'},
     'acceptanceThresholdsNotBackSolved':True,'modelClosureComplete':False,'controllerChanged':False,'physicalRunReleased':False}
print(json.dumps(out,ensure_ascii=False))
