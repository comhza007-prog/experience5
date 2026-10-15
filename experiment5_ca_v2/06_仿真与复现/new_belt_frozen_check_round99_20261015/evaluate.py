"""Frozen new-belt run011 predictions before refit; no hardware access."""
import importlib.util,json,sys
from pathlib import Path
import numpy as np
HERE=Path(__file__).resolve().parent;ROOT=HERE.parents[1];PRIOR=HERE.parent/'motor_response_analysis_round93_20261015'
sys.path.insert(0,str(PRIOR))
from predict import sha,library,contig,rollout,describe,arr
protocolPath=PRIOR/'next_capture_protocol.json';assert sha(protocolPath)=='38cd6d2b0cf3d0d0e61c1cedd836a5826dd24b258d5714d43645f8ab65a65092'
protocol=json.loads(protocolPath.read_text(encoding='utf-8'));decodedPath=HERE/'capture_analysis.json';d=json.loads(decodedPath.read_text());audit=d['capture_audit']
assert sha(d['source'])==d['sourceSHA256'] and audit['all400MetricSamplesUsable']
dt=[];u=[];idx=[];observed=[];pitch=d['header']['configured_meters_per_count'];sign=np.array([1,-1])
for mode,a,b in [('slow',0,100),('fast',0,4000),('slow',100,150),('fast',4000,8000),('slow',150,300)]:
    for r in d[mode][a:b]:
        n=40 if mode=='slow' else 1;dt.extend([r['dt_us']/n/1e6]*n)
        command=np.array(r['command_integral_counts_us'] if mode=='slow' else r['command_counts'])*sign
        if mode=='slow':command=command/r['dt_us']
        u.extend([command]*n);idx.append(len(dt)-1);observed.append(np.array(r['encoder'])*sign*pitch)
samples=d['metric_samples'];record=dict(name='new_belt_run011',dt=contig(dt),u=contig(u),idx=np.array(idx),observed=np.array(observed),pitch=pitch,
    at=np.array([s['step'] for s in samples]),actual=np.array([s['position_m'] for s in samples]),ref=np.array([s['reference_m'] for s in samples]),
    targets=np.array([audit['metrics']['trackingRMSE_mm'],audit['metrics']['syncRMS_mm']]))
assert len(dt)==20000 and len(samples)==400
registry=[dict(label='nominal_R96',file=str(HERE.parent/'aggregate_calibration_round96_20261015/model_parameters_no_motor.json'),sha256='2d66275627876b0e229abcbbf096d821a8960eff5f9e42b941c9a4b12ebf1db6')]
for label,filename,hashvalue in [
    ('R98_effective_gains','model_parameters_effective_gains.json','db6ff56b4a52c93637d4801540113d0ba4e17325e34b7b80fb45d82ac9afccd2'),
    ('R98_friction_scales','model_parameters_friction_scales.json','13ec4b574e2e60086d7a200c89a5cf08a2ad0929278063f55aa282178da3557f'),
    ('R98_damping_stiffness','model_parameters_damping_stiffness.json','0ba3cdc5eaebfc43cc938c48da1975410ac0283a71396fd747ae5247bc7ac660')]:
    registry.append(dict(label=label,file=str(HERE.parent/'new_belt_calibration_round98_20261015'/filename),sha256=hashvalue))
evaluationProtocol=dict(status='Declared before predictions, after user supplied extra capture',source=d['source'],sourceSHA256=d['sourceSHA256'],
    primaryComparisons=['R98_damping_stiffness'],additionalFamilyComparisons=['R98_effective_gains','R98_friction_scales'],allModels=registry,oldSetupReference=str(protocolPath),modelsRefitted=0,
    criterion='Final active-window trackingRMSE and syncRMS relative errors both<=15percent; waveform not hard gate.',
    captureWasOperatorManualAfterOneRunInstructions=True,parametersFrozenBeforeCapture=True,modelNotSelectedFromNewPerformance=True,assistantHardwareAction=False)
with (HERE/'evaluation_protocol.json').open('x',encoding='utf-8') as f:json.dump(evaluationProtocol,f,ensure_ascii=False,indent=2)
cases=[];traces=[];checks=[]
old=HERE.parent/'cumulative_micro_round90_20261015';sys.path.insert(0,str(old))
spec=importlib.util.spec_from_file_location('independent_static_reference',HERE.parent/'cumulative_hold_calibration_round81_20261015/reference.py')
reference=importlib.util.module_from_spec(spec);spec.loader.exec_module(reference)
for entry in registry:
    assert sha(entry['file'])==entry['sha256'];model=json.loads(Path(entry['file']).read_text());lib=library(ROOT/model['solverRelativeToProject']);assert sha(ROOT/model['solverRelativeToProject'])==model['solverSHA256']
    z=contig(model['parameters']);drive=record['u'].copy();filterdiff=0.
    if 'actuator' in model:
        for axis,m in enumerate(model['actuator']):
            state=0.;delay=m['delay_steps'];a=np.exp(-record['dt']/m['tau_s']) if m['tau_s'] else np.zeros(20000)
            command=np.r_[np.zeros(delay),record['u'][:,axis]][:20000]
            for k in range(20000):state=a[k]*state+(1-a[k])*command[k];drive[k,axis]=m['gain']*state
            for k in range(200):
                s=sum((1-a[j])*command[j]*float(np.prod(a[j+1:k+1])) for j in range(k+1))
                filterdiff=max(filterdiff,abs(m['gain']*s-drive[k,axis]))
        assert filterdiff<1e-9
    drive=contig(drive);positions=rollout(lib,z,record,drive);assert positions is not None
    # Stepwise propagation and stratified independent matrix active-set checks.
    import ctypes
    lib.model_one.argtypes=[arr,arr,arr,ctypes.c_double,arr,arr];lib.model_one.restype=ctypes.c_int
    p=np.zeros(2);v=np.zeros(2);fullDiff=0.;pythonDiff=0.;pythonSteps=0
    for k,h in enumerate(record['dt']):
        out=np.empty(4);assert lib.model_one(contig(p),contig(v),contig(drive[k]),float(h),z,out)==1
        if k%40==0:
            q,w,info=reference.mechanical_step(p,v,drive[k],h,z);pythonDiff=max(pythonDiff,float(np.max(abs(q-out[:2]))),float(np.max(abs(w-out[2:]))));pythonSteps+=1
        p=out[:2].copy();v=out[2:].copy();fullDiff=max(fullDiff,float(np.max(abs(p-positions[k]))))
    assert fullDiff<1e-12 and pythonDiff<1e-12
    result=describe(positions,record);cases.append(dict(model=entry['label'],**result))
    traces.append(dict(model=entry['label'],continuousNativePosition_m=positions[record['at']].tolist()))
    checks.append(dict(model=entry['label'],nativeCPropagationSteps=20000,independentPythonSteps=pythonSteps,
                       maximumNativePositionDifference_m=fullDiff,maximumIndependentStateDifference=pythonDiff,maximumFilterConvolutionDifference_counts=filterdiff))
    print(json.dumps(cases[-1]),flush=True)
for entry in registry:assert sha(entry['file'])==entry['sha256']
assert sha(d['source'])==d['sourceSHA256']
motor=next(r for r in cases if r['model']=='R98_damping_stiffness');baseline=next(r for r in cases if r['model']=='nominal_R96')
summary=dict(status='Frozen new-belt run011 prediction, no fitting',source=d['source'],sourceSHA256=d['sourceSHA256'],
    captureVerificationSHA256=sha(HERE/'capture_verification.json'),preCaptureProtocolSHA256=sha(protocolPath),models=registry,
    actualTrackingRMSE_mm=float(record['targets'][0]),actualSyncRMS_mm=float(record['targets'][1]),cases=cases,
    numericalVerification=dict(passed=True,checks=checks),modelsRefitted=0,run011UsedForCalibration=False,
    evaluationProtocolSHA256=sha(HERE/'evaluation_protocol.json'),allParametersFrozenBeforeNewCapture=True,
    all400MetricsAndFullMovingSnapshotsUsable=True,strictFullRecordingProtocolQualified=True,qualificationScope='Entire capture; no excluded rows or missing frames',
    recordingLimitations='CSV positions exported5 decimals; use CRC integer encoders and identical frozen C reference rounded6 decimals as firmware statistics. No motion metrics imputed.',
    movingInputResolution_ms=1,holdingInputRepresentation='40-control-step recorded integral held as mean, unchanged old approximation',
    provisionalAggregateScreen=dict(trackingAbsoluteRelativeErrorMaximum=.15,syncAbsoluteRelativeErrorMaximum=.15,waveformIsHardGate=False,
        R98dampingMetricsPassed=motor['bothWithin15Percent'],allFamiliesPassed={r['model']:r['bothWithin15Percent'] for r in cases},scope='Current record aggregate prediction only; not full physical model validation'),
    dampingVsNominal=dict(trackingAbsoluteRelativeErrorReduced=abs(motor['trackingDifference_percent'])<abs(baseline['trackingDifference_percent']),
                    syncAbsoluteRelativeErrorReduced=abs(motor['syncDifference_percent'])<abs(baseline['syncDifference_percent'])),
    physicalModelValidated=False,simulationType='Forced recorded queued-input replay; not autonomous closed loop',
    measuredFutureStateOrCurrentInjected=False,parametersOrFirmwareChanged=False,assistantHardwareAction=False,newPhysicalRunReleased=False,
    nextStep='Report frozen result before any optional new-regime cumulative refit. No further identical trial automatically. User-selected regime is new synchronous belt; do not merge earlier unknown-belt-condition observations into objective.')
with (HERE/'comparison_summary.json').open('x',encoding='utf-8') as f:json.dump(summary,f,ensure_ascii=False,indent=2)
with (HERE/'comparison_traces.json').open('x',encoding='utf-8') as f:json.dump(dict(metricSamples=samples,predictions=traces),f,indent=2)
print(json.dumps(dict(summarySHA256=sha(HERE/'comparison_summary.json'),dampingVsNominal=summary['dampingVsNominal'],candidatePassed=motor['bothWithin15Percent']),ensure_ascii=False))
