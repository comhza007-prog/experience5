"""Independently verify a small cumulative parameter update and freeze next test."""
import importlib.util,json
from pathlib import Path
import numpy as np
from calibration_core import HERE,ROOT,protocol,sha,load_records,rollout

fitfile=HERE/'fit_results.json';fit=json.loads(fitfile.read_text(encoding='utf-8'))
source=ROOT/'06_仿真与复现'/protocol['sourceModel'];base=json.loads(source.read_text(encoding='utf-8'))
assert sha(source)==protocol['sourceModelSHA256']
assert sha(HERE/'native_model.c')==base['solverSourceSHA256']
assert sha(HERE/'native_model.dll')==base['solverSHA256']
theta=np.array(fit['parameters']);initial=np.array(fit['initialParameters'])
assert len(theta)==11 and np.all(theta>=fit['localLowerBounds']) and np.all(theta<=fit['localUpperBounds'])
spec=importlib.util.spec_from_file_location('independent_static_reference',ROOT/'06_仿真与复现/cumulative_hold_calibration_round81_20261015/reference.py')
reference=importlib.util.module_from_spec(spec);spec.loader.exec_module(reference)
records=load_records();checks=[];blocks=[];maxdiff=0.;maxbalance=0.
rms=lambda x:float(np.sqrt(np.mean(x*x)))
for weight,data in zip(protocol['recordWeights'],records):
    valid,native,n=rollout(theta,data);assert valid and n==20000
    python=np.empty_like(native);p=np.zeros(2);v=np.zeros(2);diff=0.;balance=0.
    for k in range(20000):
        p,v,info=reference.mechanical_step(p,v,data['u'][k],data['dt'][k],theta)
        python[k]=p;diff=max(diff,float(np.max(np.abs(p-native[k]))));balance=max(balance,abs(info['balanceResidual']))
    assert diff<1e-12 and balance<1e-10
    maxdiff=max(maxdiff,diff);maxbalance=max(maxbalance,balance)
    e=(python[data['idx']]-data['observed'])*1000
    w=np.sqrt(weight)*data['weights']/np.sqrt(sum(data['dt']))
    blocks.extend([w*e.mean(axis=1)/protocol['waveformScale_mm'][0],w*(e[:,0]-e[:,1])/protocol['waveformScale_mm'][1]])
    continuous=python[data['at']];ref=data['active'][:,3];actual=data['active'][:,5:7]
    targets=data['targets'];metrics=np.array([rms((continuous.mean(axis=1)-ref)*1000),rms((continuous[:,0]-continuous[:,1])*1000)])
    blocks.append(np.sqrt(weight)*(metrics/targets-1)/protocol['metricRelativeScale'])
    mapped=np.round(np.sign(continuous)*np.floor(abs(continuous/data['pitch'])+.5)*data['pitch'],6)
    expected=next(c for c in fit['cases'] if c['case']=='microR86' and c['record']==data['name'])
    track=(mapped.mean(axis=1)-ref)*1000;sync=(mapped[:,0]-mapped[:,1])*1000
    assert abs(rms(track)-expected['modeledTrackingRMSE_mm'])<1e-12
    assert abs(rms(sync)-expected['modeledSyncRMS_mm'])<1e-12
    checks.append({'record':data['name'],'steps':20000,'maxPositionDifference_m':diff,
                   'trackingRMSE_mm':rms(track),'syncRMS_mm':rms(sync),
                   'trackingWaveformCorrelation':float(np.corrcoef(track,(actual.mean(axis=1)-ref)*1000)[0,1]),
                   'syncWaveformCorrelation':float(np.corrcoef(sync,(actual[:,0]-actual[:,1])*1000)[0,1])})
res=np.r_[*blocks,np.sqrt(1e-8)*theta/np.array(protocol['parameterScales11'])]
objective=float(res@res);assert abs(objective-fit['finalObjective'])<1e-8
assert fit['finalObjective']<fit['initialObjective']
for data in records:
    assert sha(data['raw'])==data['rawSHA256'] and sha(data['decoded'])==data['decodedSHA256']
oldholdout=ROOT/'06_仿真与复现'/protocol['previousHoldoutResult']
assert sha(oldholdout)=='b165c568f132ce2420930b973df9bd8569539e30e0593c73d852d51962fe3aa5'
oldcapture=json.loads((ROOT/'06_仿真与复现/q2_r82_repeat_round85_20261015/protocol.json').read_text(encoding='utf-8'))
assert sha(oldcapture['hex'])==oldcapture['hexSHA256']
project=Path(oldcapture['project']).parents[1]
for filename,expected in oldcapture['codeHashes'].items():assert sha(project/filename)==expected
verification={'passed':True,'independentPythonSteps':80000,'nativePointsChecked':sum(len(d['at']) for d in records),
              'maximumCAndPythonPositionDifference_m':maxdiff,'maximumEnergyBalanceResidual':maxbalance,
              'independentlyRecomputedObjective':objective,'checks':checks,'fitResultsSHA256':sha(fitfile),
              'allRawDecodedFirmwareAndSourceParameterHashesUnchanged':True,'physicalModelValidationPassed':False}
with (HERE/'verification.json').open('x',encoding='utf-8') as f:json.dump(verification,f,ensure_ascii=False,indent=2,allow_nan=False)
keep=lambda c:{k:v for k,v in c.items() if k!='nativeContinuousPosition_m'}
parameter_file=HERE/'model_parameters.json'
model={'version':HERE.name,'status':'Exploratory local cumulative refinement; not physically validated',
       'parameters':theta.tolist(),'parameterNames':protocol['parameterNames11'],
       'sourceR82SHA256':sha(source),'solverRelativeToProject':str((HERE/'native_model.dll').relative_to(ROOT)).replace('\\','/'),
       'solverSHA256':sha(HERE/'native_model.dll'),'solverSourceSHA256':sha(HERE/'native_model.c'),
       'fitResultsSHA256':sha(fitfile),'protocolSHA256':sha(HERE/'protocol.json'),'verificationSHA256':sha(HERE/'verification.json'),
       'initialObjective':fit['initialObjective'],'finalObjective':fit['finalObjective'],
       'objectiveReduction_percent':100*(1-fit['finalObjective']/fit['initialObjective']),
       'relativeParameterChanges_percent':(100*(theta/initial-1)).tolist(),
       'sourceHashes':[{k:d[k] for k in ['name','raw','rawSHA256','decoded','decodedSHA256']} for d in records],
       'calibrationBefore':[keep(c) for c in fit['cases'] if c['case']=='frozenR82'],
       'calibrationAfter':[keep(c) for c in fit['cases'] if c['case']=='microR86'],
       'allFourRecordsUsedForCalibration':True,'run04IncludedInTraining':True,'run05IncludedInTraining':False,
       'previousRun04FrozenR82EvaluationRetained':True,'sameModelStructureAndInputApproximation':True,
       'noPerRecordCorrectionOrMeasuredStateInjection':True,'independentPhysicalValidationPassed':False,
       'firmwareChanged':False,'assistantHardwareAction':False}
with parameter_file.open('x',encoding='utf-8') as f:json.dump(model,f,ensure_ascii=False,indent=2,allow_nan=False)
next_raw=Path(oldcapture['newRawPath'].replace('_run04.csv','_run05.csv'));assert not next_raw.exists()
next_protocol={**oldcapture,'authorization':protocol['authorization'],'manualRunsAuthorized':1,'manualRunsCollected':0,
               'newRawPath':str(next_raw),'newRawDidNotExistAtPreparation':True,
               'modelParameters':str(parameter_file),'frozenModelSHA256':sha(parameter_file),'frozenParameters':theta.tolist(),
               'solverSHA256':sha(HERE/'native_model.dll'),'modelVersion':'R86 eleven-parameter local cumulative refinement',
               'previousR82FrozenEvaluation':str(oldholdout),'previousR82FrozenEvaluationSHA256':sha(oldholdout),
               'newRawUsedForTrainingAtPreparation':False,'scope':'One unchanged manual ordinaryBLNN68012 run05, empty2mm,1200/1200,no perturbation. R86 is offline only; controller and protection unchanged.',
               'evaluation':'Verify capture, then evaluate frozen R86 BEFORE any refit, and frozen R82 as the declared previous-model comparator. Same native window, no frame imputation. Do not select a model from run05 then call it an independent prediction.',
               'formalBatchReleased':False,'assistantHardwareAction':False}
with (HERE/'next_capture_protocol.json').open('x',encoding='utf-8') as f:json.dump(next_protocol,f,ensure_ascii=False,indent=2,allow_nan=False)
print(json.dumps({'passed':True,'modelParameters':str(parameter_file),'frozenModelSHA256':sha(parameter_file),
                  'objectiveReduction_percent':model['objectiveReduction_percent'],'verification':verification,
                  'nextManualCapture':str(next_raw),'hexAndSevenFirmwareSourcesUnchanged':True},ensure_ascii=False))
