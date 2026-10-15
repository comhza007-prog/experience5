"""Check reduced-parameter candidate; freeze even negligible results transparently."""
import importlib.util,json
from pathlib import Path
import numpy as np
from calibration_core import HERE,ROOT,protocol,sha,load_records,rollout
fitfile=HERE/'fit_results.json';fit=json.loads(fitfile.read_text(encoding='utf-8'))
assert fit['candidateEligibleForOneExploratoryTest']
source=ROOT/'06_仿真与复现'/protocol['sourceModel'];assert sha(source)==protocol['sourceModelSHA256']
base=json.loads(source.read_text(encoding='utf-8'));theta=np.array(fit['parameters']);initial=np.array(base['parameters'])
assert sha(HERE/'native_model.c')==base['solverSourceSHA256'] and sha(HERE/'native_model.dll')==base['solverSHA256']
fixed=protocol['fixedCoreIndices'];free=protocol['freeIndices']
assert np.array_equal(theta[fixed],initial[fixed]) and np.all(abs(theta[free]/initial[free]-1)<=.10000000001)
assert sha(protocol['oldIndependentTestSummary'])==protocol['oldIndependentTestSummarySHA256']
spec=importlib.util.spec_from_file_location('independent_static_reference',ROOT/'06_仿真与复现/cumulative_hold_calibration_round81_20261015/reference.py')
reference=importlib.util.module_from_spec(spec);spec.loader.exec_module(reference)
records=load_records();checks=[];blocks=[];maxdiff=0.;maxbalance=0.
rms=lambda x:float(np.sqrt(np.mean(x*x)))
for weight,data in zip(protocol['recordWeights'],records):
    valid,native,n=rollout(theta,data);assert valid and n==20000
    positions=np.empty_like(native);p=np.zeros(2);v=np.zeros(2);diff=0.;balance=0.
    for k in range(20000):
        p,v,info=reference.mechanical_step(p,v,data['u'][k],data['dt'][k],theta);positions[k]=p
        diff=max(diff,float(np.max(abs(p-native[k]))));balance=max(balance,abs(info['balanceResidual']))
    assert diff<1e-12 and balance<1e-10;maxdiff=max(maxdiff,diff);maxbalance=max(maxbalance,balance)
    e=(positions[data['idx']]-data['observed'])*1000;w=np.sqrt(weight)*data['weights']/np.sqrt(sum(data['dt']))
    blocks.extend([w*e.mean(axis=1)/protocol['waveformScale_mm'][0],w*(e[:,0]-e[:,1])/protocol['waveformScale_mm'][1]])
    continuous=positions[data['at']];ref=data['active'][:,3];actual=data['active'][:,5:7]
    metrics=np.array([rms((continuous.mean(axis=1)-ref)*1000),rms((continuous[:,0]-continuous[:,1])*1000)])
    blocks.append(np.sqrt(weight)*(metrics/data['targets']-1)/protocol['metricRelativeScale'])
    mapped=np.round(np.sign(continuous)*np.floor(abs(continuous/data['pitch'])+.5)*data['pitch'],6)
    track=(mapped.mean(axis=1)-ref)*1000;sync=(mapped[:,0]-mapped[:,1])*1000
    expected=next(c for c in fit['cases'] if c['case']=='stable6_regularized' and c['record']==data['name'])
    assert abs(rms(track)-expected['modeledTrackingRMSE_mm'])<1e-12 and abs(rms(sync)-expected['modeledSyncRMS_mm'])<1e-12
    checks.append({'record':data['name'],'steps':20000,'maxPositionDifference_m':diff,'trackingRMSE_mm':rms(track),'syncRMS_mm':rms(sync),
                   'trackingWaveformCorrelation':float(np.corrcoef(track,(actual.mean(axis=1)-ref)*1000)[0,1]),
                   'syncWaveformCorrelation':float(np.corrcoef(sync,(actual[:,0]-actual[:,1])*1000)[0,1])})
res=np.r_[*blocks,np.sqrt(1e-8)*theta/np.array(protocol['parameterScales11'])];loss=float(res@res)
assert abs(loss-fit['finalDataLoss'])<1e-8
for d in records:assert sha(d['raw'])==d['rawSHA256'] and sha(d['decoded'])==d['decodedSHA256']
oldcapture=json.loads((ROOT/'06_仿真与复现/cumulative_micro_round86_20261015/next_capture_protocol.json').read_text(encoding='utf-8'))
assert sha(oldcapture['hex'])==oldcapture['hexSHA256']
project=Path(oldcapture['project']).parents[1]
for filename,expected in oldcapture['codeHashes'].items():assert sha(project/filename)==expected
verification={'passed':True,'independentPythonSteps':100000,'nativePointsChecked':1999,
              'maximumCAndPythonPositionDifference_m':maxdiff,'maximumEnergyBalanceResidual':maxbalance,
              'independentlyRecomputedDataLoss':loss,'checks':checks,'fitResultsSHA256':sha(fitfile),
              'allRawDecodedFirmwareAndSourceParametersUnchanged':True,'fixedCoreExactlyPreserved':True,'physicalValidationPassed':False}
with (HERE/'verification.json').open('x',encoding='utf-8') as f:json.dump(verification,f,ensure_ascii=False,indent=2,allow_nan=False)
keep=lambda c:{k:v for k,v in c.items() if k!='nativeContinuousPosition_m'}
full=next(f for f in fit['fits'] if f['label']=='full11_control')
model={'version':HERE.name,'status':'Exploratory reduced-parameter candidate; negligible fitting gain, no demonstrated waveform or robustness improvement',
       'parameters':theta.tolist(),'parameterNames':protocol['parameterNames11'],'fixedCoreIndices':fixed,'freeIndices':free,
       'sourceR86SHA256':sha(source),'solverRelativeToProject':str((HERE/'native_model.dll').relative_to(ROOT)).replace('\\','/'),
       'solverSHA256':sha(HERE/'native_model.dll'),'solverSourceSHA256':sha(HERE/'native_model.c'),
       'fitResultsSHA256':sha(fitfile),'protocolSHA256':sha(HERE/'protocol.json'),'verificationSHA256':sha(HERE/'verification.json'),
       'initialDataLoss':fit['initialDataLoss'],'finalDataLoss':fit['finalDataLoss'],'dataLossReduction_percent':fit['dataLossReduction_percent'],
       'matchedFull11DataLoss':full['finalDataLoss'],'matchedFull11DataLossReduction_percent':100*(1-full['finalDataLoss']/fit['initialDataLoss']),
       'sourceHashes':[{k:d[k] for k in ['name','raw','rawSHA256','decoded','decodedSHA256']} for d in records],
       'calibrationBefore':[keep(c) for c in fit['cases'] if c['case']=='frozenR86'],
       'calibrationAfter':[keep(c) for c in fit['cases'] if c['case']=='stable6_regularized'],
       'matchedFull11Calibration':[keep(c) for c in fit['cases'] if c['case']=='full11_control'],
       'allFiveRecordsUsedForCalibration':True,'run05IncludedInTraining':True,'run06IncludedInTraining':False,
       'previousRun05FrozenEvaluationsRetained':True,'sameStateDynamicsAndInputApproximation':True,
       'noPerRecordCorrectionOrMeasuredStateInjection':True,'mechanicalVariabilityIdentified':False,
       'uncertaintyCoverageValidated':False,'independentPhysicalValidationPassed':False,'firmwareChanged':False,'assistantHardwareAction':False}
parameter_file=HERE/'model_parameters.json'
with parameter_file.open('x',encoding='utf-8') as f:json.dump(model,f,ensure_ascii=False,indent=2,allow_nan=False)
next_raw=Path(oldcapture['newRawPath'].replace('_run05.csv','_run06.csv'));assert not next_raw.exists()
next_protocol={**oldcapture,'authorization':protocol['authorization'],'manualRunsAuthorized':1,'manualRunsCollected':0,
  'newRawPath':str(next_raw),'newRawDidNotExistAtPreparation':True,'modelParameters':str(parameter_file),'frozenModelSHA256':sha(parameter_file),
  'frozenParameters':theta.tolist(),'solverSHA256':sha(HERE/'native_model.dll'),'modelVersion':'R88 fixed-core six-free-parameter regularized candidate',
  'scope':'One unchanged manual BLNN68012 Q2run06, empty2mm,1200/1200,no perturbation. Candidate is offline only, not new motor control.',
  'evaluation':'Check recording, then frozen R88 and predeclared frozen R86 on identical windows before any refit. Report waveforms and scalar errors. This one repeat checks candidate predictions; no claim of improved hardware behavior because firmware is unchanged.',
  'previousR86Model':str(source),'previousR86ModelSHA256':sha(source),
  'previousRun05FrozenSummary':protocol['oldIndependentTestSummary'],'previousRun05FrozenSummarySHA256':protocol['oldIndependentTestSummarySHA256'],
  'proceedingDespiteNegligibleOfflineGainMustBeExplicit':True,'offlineGainIsNegligible':True,'physicalValidationPassed':False,
  'newRawUsedForTrainingAtPreparation':False,'formalBatchReleased':False,'assistantHardwareAction':False}
with (HERE/'next_capture_protocol.json').open('x',encoding='utf-8') as f:json.dump(next_protocol,f,ensure_ascii=False,indent=2,allow_nan=False)
print(json.dumps({'verified':True,'parameterFile':str(parameter_file),'frozenModelSHA256':sha(parameter_file),
                  'candidateDataLossReduction_percent':model['dataLossReduction_percent'],'full11DataLossReduction_percent':model['matchedFull11DataLossReduction_percent'],
                  'checks':checks,'nextRaw':str(next_raw),'nextProtocolSHA256':sha(HERE/'next_capture_protocol.json')},ensure_ascii=False))
