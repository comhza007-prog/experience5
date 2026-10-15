"""Frozen R104 prediction on independently captured run012, no fitting."""
import importlib.util,json,sys
from pathlib import Path
import numpy as np
HERE=Path(__file__).resolve().parent;ROOT=HERE.parents[1]
SOLVER=HERE.parent/'new_belt_memory_model_round100_20261015'
sys.path.insert(0,str(SOLVER))
from model import sha,contig,library,rollout,describe
protocol=json.loads((HERE/'evaluation_protocol.json').read_text(encoding='utf-8'))
modelpath=HERE.parent/protocol['frozenCandidate'];assert sha(modelpath)==protocol['frozenCandidateSHA256']
model=json.loads(modelpath.read_text(encoding='utf-8'));z=np.array(model['parameters']);lib=library()
assert sha(SOLVER/'native_model.dll')==model['solverSHA256']
capturepath=HERE/'capture_analysis.json';cap=json.loads(capturepath.read_text(encoding='utf-8'));audit=cap['capture_audit']
assert audit['fullRecordingProtocolQualified'] and sha(cap['source'])==cap['sourceSHA256']
dt=[];u=[];idx=[];observed=[];sign=np.array([1,-1]);pitch=cap['header']['configured_meters_per_count']
for mode,a,b in [('slow',0,100),('fast',0,4000),('slow',100,150),('fast',4000,8000),('slow',150,300)]:
    for r in cap[mode][a:b]:
        n=40 if mode=='slow' else 1;dt.extend([r['dt_us']/n/1e6]*n)
        command=np.array(r['command_integral_counts_us'] if mode=='slow' else r['command_counts'])*sign
        if mode=='slow':command=command/r['dt_us']
        u.extend([command]*n);idx.append(len(dt)-1);observed.append(np.array(r['encoder'])*sign*pitch)
s=cap['metric_samples'];d=dict(name='new_belt_run012',dt=contig(dt),u=contig(u),idx=np.array(idx),observed=np.array(observed),
    pitch=pitch,at=np.array([r['step'] for r in s]),ref=np.array([r['reference_m'] for r in s]),actual=np.array([r['position_m'] for r in s]),
    targets=np.array([audit['metrics']['trackingRMSE_mm'],audit['metrics']['syncRMS_mm']]))
assert len(dt)==20000 and len(s)==400
p=rollout(lib,z,d);assert p is not None;case=describe(p,d)
case['bothWithin20Percent']=max(abs(case['trackingDifference_percent']),abs(case['syncDifference_percent']))<=20
spec=importlib.util.spec_from_file_location('independent_r105_ref',SOLVER/'reference.py');ref=importlib.util.module_from_spec(spec);spec.loader.exec_module(ref)
state=np.zeros(6);native=independent=energy=0.
for k,h in enumerate(d['dt']):
    out=np.empty(6);assert lib.model_memory_step(contig(state),contig(d['u'][k]),float(h),contig(z),out)==1
    if k%40==0:
        expected,info=ref.step(state,d['u'][k],h,z);independent=max(independent,float(max(abs(out-expected))));energy=max(energy,abs(info['energyBalanceResidual']));assert info['plasticDissipation']>=-1e-12
    native=max(native,float(max(abs(out[:2]-p[k]))));state=out
assert native<1e-12 and independent<1e-10 and energy<1e-10
assert sha(modelpath)==protocol['frozenCandidateSHA256'] and sha(cap['source'])==cap['sourceSHA256']
summary=dict(status='Frozen R104 independent-record aggregate check, no parameter fitting',case=case,
    source=cap['source'],sourceSHA256=cap['sourceSHA256'],captureAnalysisSHA256=sha(capturepath),
    captureProtocolQualified=True,CRC32=cap['crc32'],minimumChunkCopies=cap['minimumCopies'],missingCSVFrames=audit['missingCSVFrames'],
    fault=cap['header']['fault'],completionTail_s=audit['completionTail_s'],nativeMetricSamples=400,
    frozenModel=str(modelpath),frozenModelSHA256=sha(modelpath),evaluationProtocolSHA256=sha(HERE/'evaluation_protocol.json'),scriptSHA256=sha(__file__),
    verification=dict(nativeSteps=20000,independentPythonSteps=500,maxNativePositionDifference_m=native,maxIndependentStateDifference=independent,maxEnergyBalanceResidual=energy,passed=True),
    modelRefitted=False,parametersChanged=0,newRecordUsedForCalibration=False,previousCalibrationRecords=['run010','run011'],
    passedAggregate20Percent=case['bothWithin20Percent'],passedAggregate15Percent=case['bothWithin15Percent'],
    physicalParameterIdentificationPassed=False,autonomousClosedLoopValidationPassed=False,
    previousGainLBoundaryDependenceRetained=True,previousWeakParameterAssumptionsRetained=True,
    aggregateAcceptanceNotPhysicalValidation=True,firmwareChanged=False,assistantHardwareAction=False)
for name,obj in [('comparison_summary.json',summary),('comparison_traces.json',dict(nativePrediction_m=p[d['at']].tolist(),actualPosition_m=d['actual'].tolist(),reference_m=d['ref'].tolist()))]:
    with (HERE/name).open('x',encoding='utf-8') as f:json.dump(obj,f,ensure_ascii=False,indent=2)
print(json.dumps(dict(case=case,verification=summary['verification'],summarySHA256=sha(HERE/'comparison_summary.json')),ensure_ascii=False))
