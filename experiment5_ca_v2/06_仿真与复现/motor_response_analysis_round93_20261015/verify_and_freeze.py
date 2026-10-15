"""Independent spot-step mechanics, full pre-fit replay checks, prospective freeze."""
import importlib.util,json,sys
from pathlib import Path
import numpy as np
from predict import HERE,ROOT,sha,contig,arr,load_records,library,rollout,describe
OLD=ROOT/'06_仿真与复现/cumulative_micro_round90_20261015'
sys.path.insert(0,str(OLD))
spec=importlib.util.spec_from_file_location('independent_static_reference',ROOT/'06_仿真与复现/cumulative_hold_calibration_round81_20261015/reference.py')
ref=importlib.util.module_from_spec(spec);spec.loader.exec_module(ref)
manifest,records=load_records();frozen=json.loads((HERE/'frozen_predictions.json').read_text());fit=json.loads((HERE/'plant_fit_results.json').read_text())
motorfile=HERE/'motor_block_parameters.json';motors=json.loads(motorfile.read_text());checks=[];independent=0
for modelSpec in manifest['registry']:
    m=json.loads(Path(modelSpec['file']).read_text());lib=library(ROOT/m['solverRelativeToProject']);z=contig(m['parameters'])
    lib.model_one.argtypes=[arr,arr,arr,__import__('ctypes').c_double,arr,arr];lib.model_one.restype=__import__('ctypes').c_int
    for d in records:
        p=rollout(lib,z,d);reported=next(r for r in frozen['results'] if r['model']==modelSpec['label'] and r['record']==d['name']);r=describe(p,d)
        for key in ['predictedTrackingRMSE_mm','predictedSyncRMS_mm','trackingDifference_percent','syncDifference_percent']:assert abs(r[key]-reported[key])<1e-12
    # Full one-step propagation checks on run01; 500 independent Python active-set steps per frozen model.
    d=records[0];p=rollout(lib,z,d);q=np.zeros(2);v=np.zeros(2);maxdiff=0.;stepdiff=0.
    for k,h in enumerate(d['dt']):
        out=np.empty(4);assert lib.model_one(contig(q),contig(v),contig(d['u'][k]),float(h),z,out)==1
        if k%40==0:
            pq,pv,info=ref.mechanical_step(q,v,d['u'][k],h,z)
            stepdiff=max(stepdiff,float(np.max(abs(pq-out[:2]))),float(np.max(abs(pv-out[2:]))));independent+=1
        q=out[:2].copy();v=out[2:].copy();maxdiff=max(maxdiff,float(np.max(abs(q-p[k]))))
    assert maxdiff<1e-12 and stepdiff<1e-12
    checks.append(dict(model=modelSpec['label'],allFiveFrozenPredictionsReproduced=True,fullStepwiseNativePropagation=20000,independentPythonSteps=500,maximumPositionDifference_m=maxdiff,maximumIndependentStateDifference=stepdiff))
candidate=fit['fits']['motor_refit_candidate'];base=json.loads((OLD/'model_parameters.json').read_text());theta=candidate['parameters']
for fixed in [2,3,4,5,8]:assert theta[fixed]==base['parameters'][fixed]
lib=library(ROOT/base['solverRelativeToProject']);motorchecks=[]
for d in records:
    u=np.zeros_like(d['u']);convolutiondiff=0.
    for ch,a in enumerate(motors['axes']):
        m=a['selected'];s=0.;aa=np.exp(-d['dt']/m['tau_s']) if m['tau_s'] else np.zeros(len(d['dt']))
        command=np.r_[np.zeros(m['delay_steps']),d['u'][:,ch]][:20000]
        for k in range(20000):s=aa[k]*s+(1-aa[k])*command[k];u[k,ch]=m['gain']*s
        # Closed-form convolution independently checks the recursive filter's initial200 steps.
        for k in range(200):
            value=0.
            for j in range(k+1):value+=(1-aa[j])*command[j]*float(np.prod(aa[j+1:k+1]))
            convolutiondiff=max(convolutiondiff,abs(m['gain']*value-u[k,ch]))
    assert convolutiondiff<1e-9
    p=rollout(lib,theta,d,contig(u));r=describe(p,d);reported=next(r for r in fit['cases'] if r['case']=='motor_refit_candidate' and r['record']==d['name'])
    for key in ['predictedTrackingRMSE_mm','predictedSyncRMS_mm']:assert abs(r[key]-reported[key])<1e-12
    motorchecks.append(dict(record=d['name'],recursiveVsClosedFormFilterDifference_counts=convolutiondiff,refitMetricsReproduced=True))
verification=dict(passed=True,frozenChecks=checks,independentPythonMechanicalSteps=independent,motorChecks=motorchecks,
    scope='Full15 frozen rollouts reproduced,60k one-step C propagation checks,1500 independent Python mechanical steps; filter convolution cross-checks and all five motor-refit metrics reproduced. Numerical verification is not physical validation.',
    rawFilesAndFrozenModelsUnchanged=True,assistantHardwareAction=False)
for r in manifest['records']:assert sha(r['source'])==r['sourceSHA256'] and sha(r['decoded'])==r['decodedSHA256']
for r in manifest['registry']:assert sha(r['file'])==r['sha256']
with (HERE/'numerical_verification.json').open('x',encoding='utf-8') as f:json.dump(verification,f,indent=2)
params=dict(version='R93_motor_response_candidate',status='Exploratory candidate only; not accepted as a replacement model',
    parameters=theta,parameterNames=base['parameterNames'],solverRelativeToProject=base['solverRelativeToProject'],solverSHA256=base['solverSHA256'],
    actuator=[dict(axis=a['axis'],**a['selected']) for a in motors['axes']],
    actuatorEquation='s[k]=exp(-dt[k]/tau)*s[k-1]+(1-exp(-dt[k]/tau))*u[k-delay];forceInput=gain*s[k]. Initialize s=0 once, no measured-current/state injection. MeasurementOffset not fed into force.',
    actuatorDelayConvention='Integer controller steps, no interpolated measured-current input',
    motorParametersSHA256=sha(motorfile),preFitPredictionsSHA256=sha(HERE/'frozen_predictions.json'),fitProtocolSHA256=sha(HERE/'plant_fit_protocol.json'),fitResultsSHA256=sha(HERE/'plant_fit_results.json'),
    verificationSHA256=sha(HERE/'numerical_verification.json'),all12RecordsCalibration=True,
    calibrationLossReduction_percent=100*(1-candidate['loss']/fit['baselineLoss']),
    physicalValidationPassed=False,notAllCalibrationMetricsWithin15Percent=True,
    limitations=['10ms effective drive lag is the upper grid boundary, not a well-identified motor constant.',
                'Cumulative refit worsens several older records; it is not adopted as the final plant model.',
                'Coarse M1 movement inputs remain20ms means; sensitivity does not prove that input reconstruction alone caused the error.'])
with (HERE/'model_parameters.json').open('x',encoding='utf-8') as f:json.dump(params,f,indent=2)
oldprotocol=json.loads((OLD/'next_capture_protocol.json').read_text());project=Path(oldprotocol['project']);hexfile=Path(oldprotocol['hex'])
assert project.exists() and sha(hexfile)==oldprotocol['hexSHA256']
for name,expected in oldprotocol['codeHashes'].items():assert sha(project.parents[1]/name)==expected
newraw=ROOT/'01_原始数据/模型闭环_Q2_误差汇总40s_20261015/E5ID_Q2S_BLNN_B68012_HW6_L1200_R1200_M0g_S2mm_run08.csv'
assert not newraw.exists()
nextp=dict(status='One optional exploratory discrimination capture; not formal acceptance batch',
    authorization='Latest user requests one new test after motor-informed model modification. No assistant hardware actions.',
    project=str(project),target='exp5ID_Q2S_BLNN_HW6',hex=str(hexfile),hexSHA256=sha(hexfile),codeHashes=oldprotocol['codeHashes'],
    newRawPath=str(newraw),newRawAbsentAtPreparation=True,manualRuns=1,
    scope='Same ordinaryBLNN, empty2mm,1200/1200,unchanged protection and no new excitation. Use existing Q2 firmware to obtain ALL moving-segment queued commands at1ms, rather than another M1 repeat with mostly20ms means.',
    primaryCandidate=str(HERE/'model_parameters.json'),primaryCandidateSHA256=sha(HERE/'model_parameters.json'),
    predeclaredComparators=manifest['registry'],
    intent='Determine prospective replay error with dense moving inputs. No promise of passing: current motor-refit training errors remain large and several old records deteriorate.',
    recording='Manual Keil+DAP and VOFA JustFloat115200,107channels; decimal places6. Fresh history before8s boot-start; keep structure/load/supply fixed. No repeated automatic runs.',
    completion='I2=6,I22=0,I88=4444,I89=4,I90=0, then at least20additional seconds AND I0>=185s before CSV export. Preserve history until saved; abnormal motion stop safely, no automatic retry.',
    provisionalAggregateThresholds=dict(trackingAbsoluteRelativePredictionErrorMaximum=.15,syncAbsoluteRelativePredictionErrorMaximum=.15,waveformIsHardGate=False),
    evaluation='Check identity, completeness, CRC and runtime first; evaluate all frozen candidates before any new fit. Do not use raw measured current as future plant input. Aggregate screening only, not autonomous closed-loop validation.',
    firmwareChanged=False,assistantHardwareAction=False,formalBatchReleased=False)
with (HERE/'next_capture_protocol.json').open('x',encoding='utf-8') as f:json.dump(nextp,f,ensure_ascii=False,indent=2)
print(json.dumps(dict(verificationPassed=True,candidateSHA256=sha(HERE/'model_parameters.json'),nextProtocolSHA256=sha(HERE/'next_capture_protocol.json'),newRaw=str(newraw),calibrationLossReduction_percent=params['calibrationLossReduction_percent']),ensure_ascii=False))
