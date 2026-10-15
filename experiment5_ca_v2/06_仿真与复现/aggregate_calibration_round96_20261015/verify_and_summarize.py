"""Reproduce all calibrated summaries and independently verify mechanics at real states."""
import ctypes,importlib.util,json,sys
import numpy as np
from calibrate import HERE,ROOT,PRIOR,OLD,records,setup,sha,rollout,describe,contig
data=records();motor,base,lib=setup(data);fits=json.loads((HERE/'calibration_results.json').read_text(encoding='utf-8'))
sys.path.insert(0,str(OLD));spec=importlib.util.spec_from_file_location('reference95',HERE.parent/'cumulative_hold_calibration_round81_20261015/reference.py');reference=importlib.util.module_from_spec(spec);spec.loader.exec_module(reference)
arr=np.ctypeslib.ndpointer(dtype=np.float64,flags='C_CONTIGUOUS');lib.model_one.argtypes=[arr,arr,arr,ctypes.c_double,arr,arr];lib.model_one.restype=ctypes.c_int
checks=[];models=[]
for fit in fits['fits']:
    z=contig(fit['parameters']);on=fit['motorEnabled'];maxMetricDiff=0.
    for d,r in zip(data,fit['results']):
        assert d['name']==r['record'];p=rollout(lib,z,d,d['motor_u'] if on else d['u']);actual=describe(p,d)
        for k in ['predictedTrackingRMSE_mm','predictedSyncRMS_mm']:
            maxMetricDiff=max(maxMetricDiff,abs(actual[k]-r[k]));assert abs(actual[k]-r[k])<1e-12
    d=next(r for r in data if r['name']=='Q2_run08');u=d['motor_u'] if on else d['u'];positions=rollout(lib,z,d,u);p=np.zeros(2);v=np.zeros(2);maxDiff=0.;independentDiff=0.
    for k,h in enumerate(d['dt']):
        output=np.empty(4);assert lib.model_one(contig(p),contig(v),contig(u[k]),float(h),z,output)==1
        if k%40==0:
            q,w,info=reference.mechanical_step(p,v,u[k],h,z);independentDiff=max(independentDiff,float(np.max(abs(q-output[:2]))),float(np.max(abs(w-output[2:]))))
        p=output[:2].copy();v=output[2:].copy();maxDiff=max(maxDiff,float(np.max(abs(p-positions[k]))))
    assert maxDiff<1e-12 and independentDiff<1e-12 and maxMetricDiff<1e-12
    checks.append(dict(scheme=fit['scheme'],all13AggregateSummariesReproduced=True,nativeStepwiseSteps=20000,independentPythonSteps=500,
        maxMetricDifference_mm=maxMetricDiff,maxStepwisePositionDifference_m=maxDiff,maxIndependentStateDifference=independentDiff))
    output=dict(version='R96_'+fit['scheme'],status='Calibration-only, not adopted or independently validated',parameters=fit['parameters'],parameterNames=base['parameterNames'],
        solverRelativeToProject=base['solverRelativeToProject'],solverSHA256=base['solverSHA256'],
        actuator=motor['actuator'] if on else [],objective='Two aggregate RMS metrics only, equal-record Huber, all13 records calibration',
        protocolSHA256=sha(HERE/'protocol.json'),fitResultsSHA256=sha(HERE/'calibration_results.json'),
        all13Both15percent=fit['all13BothMetricsWithin15Percent'],physicalModelValidated=False,newPhysicalRunReleased=False,run08UsedForCalibration=True)
    dest=HERE/('model_parameters_motor.json' if on else 'model_parameters_no_motor.json')
    with dest.open('x',encoding='utf-8') as f:json.dump(output,f,indent=2)
    models.append(dict(scheme=fit['scheme'],file=str(dest),sha256=sha(dest)))
for d in data:assert sha(d['raw'])==d['rawSHA256']
for path,expected in [(PRIOR/'model_parameters.json','73fbd019a99a69a792f6027e873840ddf9baae14723284e46b12a8182e317748'),(OLD/'model_parameters.json','ffc2988f6943390e991294edb19ee0a7415f3e05b0dba3ffe80c9f585fe90b87')]:assert sha(path)==expected
diagnosis=json.loads((HERE.parent/'model_error_diagnosis_round95_20261015/diagnosis_results.json').read_text())
oldfit=json.loads((PRIOR/'plant_fit_results.json').read_text());losses=oldfit['fits']['motor_refit_candidate']['perRecordLoss']
summary=dict(status='Offline diagnosis and bounded RMS-only recalibration complete; no accepted model and no new physical trial',
    diagnosisSHA256=sha(HERE.parent/'model_error_diagnosis_round95_20261015/diagnosis_results.json'),
    priorM1Run01ShareOfSquaredCalibrationLoss_percent=100*losses[7]/sum(losses),
    run08ControlledAblations=[r for r in diagnosis['results'] if r['record']=='Q2_run08' and r['case'] in ['R90_original','R90_drive_only','R93_no_lag_same_DC_gain','R93_motor','R93_no_extra_static','R93_half_extra_static']],
    run08HoldDiagnostics=[r for r in diagnosis['run08PhaseDiagnostics'] if r['case']=='R93_motor' and r['phase']==5],
    inference='Drive block alone does not repair errors; static-extra removal helps run08 tracking but worsens old-group average and does not repair sync. Current static coupling/friction representation needs further discrimination; no unique physical fault proven.',
    calibrationObjective='User requested final tracking/sync RMS only. Removed waveform objective, retained all13 records, used equal-record Huber loss and bounded shared11 parameters. No outputs rescaled.',
    calibration=[dict(scheme=f['scheme'],initialLoss=f['initialDataLoss'],finalLoss=f['finalDataLoss'],both15percentPassCount=sum(r['bothWithin15Percent'] for r in f['results']),
        totalRecords=13,run08=next(r for r in f['results'] if r['record']=='Q2_run08')) for f in fits['fits']],
    models=models,numericalVerification=dict(passed=True,checks=checks),
    currentRecordsNowCalibrationIncludingRun08=True,priorProspectiveFailuresPreserved=True,physicalModelValidated=False,
    newPhysicalRunReleased=False,firmwareChanged=False,assistantHardwareAction=False,
    stoppingRule='Bounded calibration budget exhausted; do not expand parameter search or request identical trials automatically.',
    nextStep='Review model structure for low-speed sticking and finite differential hold offset (e.g. testable coupling dead-zone hypothesis), with an identifiable shared law and controlled ablation, before implementation. No ad hoc final-output offset/scale. Existing drive block remains tentative.')
with (HERE/'comparison_summary.json').open('x',encoding='utf-8') as f:json.dump(summary,f,ensure_ascii=False,indent=2)
print(json.dumps(dict(summarySHA256=sha(HERE/'comparison_summary.json'),models=models,checks=checks),ensure_ascii=False))
