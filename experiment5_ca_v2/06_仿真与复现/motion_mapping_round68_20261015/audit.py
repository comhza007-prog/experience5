import csv,ctypes,hashlib,json
from pathlib import Path
import numpy as np

DIR=Path(__file__).resolve().parent;ROOT=DIR.parents[1]
M=ROOT/'06_仿真与复现/inertia_coupling_round66_20261015'
sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
fit=json.loads((M/'fit_results.json').read_text(encoding='utf-8'))
verified=json.loads((M/'prediction_verification.json').read_text(encoding='utf-8'));assert verified['passed']
record=ROOT/'06_仿真与复现/identification_q2_summary40s_round61_20261015/build68012_0b743a60e6ed_analysis.json'
data=json.loads(record.read_text(encoding='utf-8'));raw=Path(data['source'])
assert sha(raw)==data['sourceSHA256']==fit['sourceSHA256'] and data['qualified']
assert sha(M/'native_model.dll')==fit['nativeLibrarySHA256']
with raw.open(newline='',encoding='utf-8-sig') as f:
    r=csv.reader(f);assert next(r)==[f'I{k}' for k in range(107)]
    live=np.array([[float(v) for v in row] for row in r])[1:]
active=live[(live[:,106]==1)&(live[:,2]>=2)&(live[:,2]<=5)];at=active[:,46].astype(int)-2
assert len(active)==400
pitch=data['header']['configured_meters_per_count'];sign=np.array([1.,-1.]);factor=pitch*8192/60
def inputs(source):
    dt=[];commands=[]
    def hold(first,last):
        for row in source['slow'][first:last]:
            dt.extend([row['dt_us']*1e-6/40]*40)
            commands.extend([np.array(row['command_integral_counts_us'])*sign/row['dt_us']]*40)
    def motion(first,last):
        for row in source['fast'][first:last]:
            dt.append(row['dt_us']*1e-6);commands.append(np.array(row['command_counts'])*sign)
    hold(0,100);motion(0,4000);hold(100,150);motion(4000,8000);hold(150,300)
    return np.ascontiguousarray(dt,float),np.ascontiguousarray(commands,float)
dt,u=inputs(data);assert len(dt)==20000
arr=np.ctypeslib.ndpointer(dtype=np.float64,flags='C_CONTIGUOUS')
lib=ctypes.CDLL(str(M/'native_model.dll'));lib.model_rollout.argtypes=[ctypes.c_int,arr,arr,arr,arr,arr,arr];lib.model_rollout.restype=ctypes.c_int
def rollout(theta,dt=dt,u=u):
    out=np.full((len(dt),2),np.nan);zero=np.zeros(2)
    n=lib.model_rollout(len(dt),dt,u,zero,zero,np.ascontiguousarray(theta,float),out)
    return n,out
rms=lambda x:float(np.sqrt(np.mean(np.asarray(x)**2)))
def metrics(pred,obs):
    e=1000*(pred-obs)
    return {'meanPositionPredictionRMSE_mm':rms(e.mean(axis=1)),'syncPredictionRMSE_mm':rms(e[:,0]-e[:,1])}
theta=np.array(fit['fit']['parameters']);results=[]
for name,remove_k,remove_d in [('baseline',False,False),('springZero',True,False),('crossDampingZero',False,True),('bothCouplingsZero',True,True)]:
    z=theta.copy()
    if remove_k:z[4]=0
    if remove_d:z[5]=0
    n,pred=rollout(z)
    result={'case':name,'parameters':z.tolist(),'completed':n==20000,'completedSteps':n,
            'singleInitialState':True,'noMeasuredFutureStateInjection':True,'notRetrainedOrPhysicalValidation':True}
    if n==20000:
        native=pred[at];native=np.sign(native)*np.floor(np.abs(native/pitch)+.5)*pitch;native=np.round(native,6)
        result['native40msPredictionErrors']=metrics(native,active[:,5:7])
        result['predictedTrackingRMSE_mm']=rms(1000*(native.mean(axis=1)-active[:,3]))
        result['predictedSyncRMS_mm']=rms(1000*(native[:,0]-native[:,1]))
        result['predictedMaxSync_mm']=float(np.max(np.abs(1000*(native[:,0]-native[:,1]))))
        obs=np.array([row['encoder'] for row in data['fast']])*sign*pitch
        moving_pred=np.vstack([pred[4000:8000],pred[10000:14000]])
        result['exactMovingEndpointPredictionErrors']=metrics(moving_pred,obs)
        result['terminalPosition_mm']=(1000*pred[-1]).tolist()
        result['nativeModeledPositions_m']=native.tolist()
    results.append(result)
base=results[0]
assert abs(base['native40msPredictionErrors']['syncPredictionRMSE_mm']-verified['syncPredictionRMSE_mm'])<1e-12
assert abs(base['native40msPredictionErrors']['meanPositionPredictionRMSE_mm']-verified['meanPositionPredictionRMSE_mm'])<1e-12
# Dependency probe affects copied telemetry only, never source or hardware.
copy={**data,'fast':[{**r,'rpm':[100,100]} for r in data['fast']],
                  'slow':[{**r,'rpm':[100,100]} for r in data['slow']]}
dt2,u2=inputs(copy);assert np.array_equal(dt,dt2) and np.array_equal(u,u2)
n,pred2=rollout(theta,dt2,u2);n0,pred0=rollout(theta);assert n==n0==20000 and np.array_equal(pred0,pred2)
# Symmetric common-mode fixture: all four coupling removals should be inert.
sym=np.array([3e-5,3e-5,5.,5.,509.,249.,.006,.006,-.03]);h=np.full(1000,.001)
command=np.column_stack([300*np.sin(np.arange(1000)/150)]*2)
fixture=[]
for k,d in [(False,False),(True,False),(False,True),(True,True)]:
    z=sym.copy()
    if k:z[4]=0
    if d:z[5]=0
    n,p=rollout(z,h,np.ascontiguousarray(command));assert n==1000
    fixture.append(p)
fixture_difference=max(float(np.max(np.abs(p-fixture[0]))) for p in fixture)
assert fixture_difference<1e-12
sensor=[]
for phase,name,first,last,anchor in [(2,'outward',0,4000,99),(4,'return',4000,8000,149)]:
    rows=data['fast'][first:last];hh=np.array([r['dt_us']*1e-6 for r in rows]);rpm=np.array([r['rpm'] for r in rows],float)
    observed=(np.array(rows[-1]['encoder'])-np.array(data['slow'][anchor]['encoder']))*pitch
    duration=float(hh.sum());rpm_disp=np.sum(hh[:,None]*rpm,axis=0)*factor
    hypotheses=[]
    for quantizer,lo,hi in [('nearestIntervalMean',-.5,.5),('floorIntervalMean',0.,1.)]:
        lower=rpm_disp+lo*duration*factor;upper=rpm_disp+hi*duration*factor
        gap=np.maximum(lower-(observed+2*pitch),0)+np.maximum((observed-2*pitch)-upper,0)
        hypotheses.append({'hypothesis':quantizer,'displacementInterval_raw_mm':np.column_stack([1000*lower,1000*upper]).tolist(),
            'encoderEnvelope_raw_mm':np.column_stack([1000*(observed-2*pitch),1000*(observed+2*pitch)]).tolist(),
            'outsideIntervalGap_mm':(1000*gap).tolist(),'compatibleUnderDeclaredAssumptions':(gap<=1e-15).tolist()})
    sensor.append({'phase':name,'duration_s':duration,'rawEncoderDisplacement_mm':(1000*observed).tolist(),
        'rawRPMSumDisplacement_mm':(1000*rpm_disp).tolist(),'equivalentMeanEncoderMinusRPM_rpm':((observed-rpm_disp)/(duration*factor)).tolist(),
        'hypotheses':hypotheses,'conditionalIntervalSpeedAssumptionsNotActualEndpointFilterIdentification':True})
paths=[ROOT/'05_实验代码/模型闭环_Q2_误差汇总40s_20261015/eassy_E5ID_Q2S_BLNN_HW6'/x
       for x in ['Task/motor_task.c','Task/experiment5_motion.h','CAN-control/CAN_receive.c']]
out={'date':'2026-10-15','source':str(raw),'sourceSHA256':sha(raw),'decodedSHA256':sha(record),
     'protocolSHA256':sha(DIR/'protocol.json'),'frozenFitSHA256':sha(M/'fit_results.json'),
     'controllerSourceHashes':[{'path':str(p),'SHA256':sha(p)} for p in paths],
     'ordinaryOnly':True,'S3R2DataRead':False,'modelsFitted':0,'parametersSelectedForNewCandidate':False,
     'actualNativeTrackingRMSE_mm':verified['actualOrdinaryTrackingRMSE_mm'],'actualNativeSyncRMS_mm':verified['actualOrdinarySyncRMS_mm'],
     'fixedCouplingKnockouts':results,'nativeObservedPositions_m':active[:,5:7].tolist(),'nativeReference_m':active[:,3].tolist(),
     'RPMDependencyProbe':{'mutatedInMemoryOnly':True,'exactlyIdenticalQueuedInputAndDt':True,'forcedPositionReplayIdentical':True,
         'physicalControllerDependsOnRPM':True,'RPMOnlyChangeCannotFixThisForcedPositionReplay':True},
     'symmetricCommonModeFixtureMaxDifference_m':fixture_difference,'sensorConditionalChecks':sensor,
     'sensorFloorNotProven':True,'actuatorOrMechanicalRootCauseNotUniquelyIdentified':True,
     'allCasesRetainedNoValidationOrBestCaseDeclaration':True,'holdMeanAbstractionStillUnverified':True,
     'rawAndControllerUnchanged':True,'physicalCaptureReleased':False,'modelClosureComplete':False}
print(json.dumps(out,ensure_ascii=False))
