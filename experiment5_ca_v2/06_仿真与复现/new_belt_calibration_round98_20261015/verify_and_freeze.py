"""Freeze separate new-belt exploratory models, preserving failed fits and old regime."""
import ctypes,importlib.util,json,sys
import numpy as np
from calibrate import HERE,ROOT,PRIOR,CAP,sha,setup,rollout,describe,contig
d,r,source,base,lib=setup();old=HERE.parent/'cumulative_micro_round90_20261015';sys.path.insert(0,str(old))
spec=importlib.util.spec_from_file_location('independent_newbelt_ref',HERE.parent/'cumulative_hold_calibration_round81_20261015/reference.py');reference=importlib.util.module_from_spec(spec);spec.loader.exec_module(reference)
arr=np.ctypeslib.ndpointer(dtype=np.float64,flags='C_CONTIGUOUS');lib.model_one.argtypes=[arr,arr,arr,ctypes.c_double,arr,arr];lib.model_one.restype=ctypes.c_int
cases=[];files=[];checks=[]
for label,resultfile in [('effective_gains','calibration_results.json'),('friction_scales','friction_results.json'),('damping_stiffness','damping_results.json')]:
    fit=json.loads((HERE/resultfile).read_text());best=fit['selected'];z=contig(best['parameters']);p=rollout(lib,z,r);metrics=describe(p,r)
    for key in ['predictedTrackingRMSE_mm','predictedSyncRMS_mm']:assert abs(metrics[key]-best['calibration'][key])<1e-12
    q=np.zeros(2);v=np.zeros(2);maxdiff=0.;independent=0.
    for k,h in enumerate(r['dt']):
        out=np.empty(4);assert lib.model_one(contig(q),contig(v),contig(r['u'][k]),float(h),z,out)==1
        if k%40==0:
            rq,rv,info=reference.mechanical_step(q,v,r['u'][k],h,z);independent=max(independent,float(np.max(abs(rq-out[:2]))),float(np.max(abs(rv-out[2:]))))
        q=out[:2].copy();v=out[2:].copy();maxdiff=max(maxdiff,float(np.max(abs(q-p[k]))))
    assert maxdiff<1e-12 and independent<1e-12
    checks.append(dict(family=label,fullNativeStepChecks=20000,independentPythonSteps=500,maxNativePositionDifference_m=maxdiff,maxIndependentStateDifference=independent))
    model=dict(version='R98_new_belt_'+label,status='Exploratory calibration failed aggregate15percent screen; not adopted as final model',
        regime='New synchronous belt; run010 only',parameters=best['parameters'],parameterNames=base['parameterNames'],
        solverRelativeToProject=base['solverRelativeToProject'],solverSHA256=base['solverSHA256'],actuator=[],
        sourceRaw=d['source'],sourceSHA256=d['sourceSHA256'],sourceNominalModel=str(source),sourceNominalModelSHA256=sha(source),
        sourceResultsSHA256=sha(HERE/resultfile),onlyNewRegimeDataInObjective=True,calibrationMetrics=metrics,
        physicalCoefficientsIdentified=False,independentValidationPassed=False,firmwareChanged=False)
    filename=HERE/('model_parameters_'+label+'.json')
    with filename.open('x',encoding='utf-8') as f:json.dump(model,f,ensure_ascii=False,indent=2)
    files.append(dict(family=label,file=str(filename),sha256=sha(filename)));cases.append(dict(family=label,**metrics))
assert not any(c['bothWithin15Percent'] for c in cases)
assert sha(d['source'])==d['sourceSHA256'] and sha(source)=='2d66275627876b0e229abcbbf096d821a8960eff5f9e42b941c9a4b12ebf1db6'
summary=dict(status='New-belt regime established, parameter-only calibration attempted; none accepted',
    userConfirmedNewBelt=True,source=d['source'],sourceSHA256=d['sourceSHA256'],newRegimeCalibrationRecords=1,
    oldRegimeObservationsUsedInObjective=0,oldModelUsedAsNominalStartAndFixedParameterReference=True,
    actualTrackingRMSE_mm=float(r['targets'][0]),actualSyncRMS_mm=float(r['targets'][1]),cases=cases,models=files,
    numericalVerification=dict(passed=True,checks=checks),oldModelsAndRawUnchanged=True,
    previousFrozenRun010FailurePreserved=True,run010NowCalibrationForNewRegime=True,
    physicalModelValidated=False,uniqueMechanicalCauseEstablished=False,newPhysicalRunReleased=False,
    outputScalingOrMeasuredStateCorrectionAdded=False,controllerFirmwareChanged=False,assistantHardwareAction=False,
    stoppingRule='All three bounded2-parameter families exhausted; no further widening or added parameters in this round.',
    nextStep='Use new-belt regime for future work; do not mix old-belt observations without regime labels. Review existing model structure for changed low-speed/elastic response before another parameter search or physical repeat. New belt installation does not establish that reported sluggish/sticking response is safe or normal.')
with (HERE/'comparison_summary.json').open('x',encoding='utf-8') as f:json.dump(summary,f,ensure_ascii=False,indent=2)
print(json.dumps(dict(summarySHA256=sha(HERE/'comparison_summary.json'),models=files,verificationPassed=True),ensure_ascii=False))
