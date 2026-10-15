import csv, hashlib, json, sys
from pathlib import Path
import numpy as np
HERE=Path(__file__).resolve().parent;ROOT=HERE.parents[1]
MODEL=ROOT/'06_仿真与复现/inertia_coupling_round66_20261015'
sys.path.insert(0,str(MODEL))
from reference import mechanical_step
sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
fit=json.loads((HERE/'fit_results.json').read_text(encoding='utf-8'));protocol=json.loads((HERE/'protocol.json').read_text(encoding='utf-8'))
assert sha(HERE/'protocol.json')==fit['protocolSHA256'] and sha(HERE/'fit.py')==fit['fitScriptSHA256']
assert sha(MODEL/'native_model.dll')==fit['nativeLibrarySHA256'] and sha(MODEL/'native_model.c')==fit['nativeModelSHA256']
theta=np.array(fit['fit']['parameters']);scale=np.array(protocol['parameterScales'])
assert len(fit['allCalibrationEvaluations'])==fit['fit']['evaluations']<=protocol['maxEvaluations']
assert len(fit['fit']['iterations'])<=protocol['maxIterations']
assert all(r['after']<=r['before'] for r in fit['fit']['iterations'])
assert fit['oldFittedParameterFilesRead'] is False
assert fit['fit']['initialParameters']==protocol['initialParameters']
assert fit['allCalibrationEvaluations'][0]['label']=='freshNumericalSeed'
for row in fit['allCalibrationEvaluations']:
    param=np.array(row['parameters']);assert len(param)==9
    assert np.all(param>=np.array(protocol['lowerBounds'])-1e-12) and np.all(param<=np.array(protocol['upperBounds'])+1e-12)
results=[];totalsteps=0;balance=0.;objectives=[]
for source in fit['sourceHashes']:
    assert sha(source['raw'])==source['rawSHA256'] and sha(source['decoded'])==source['decodedSHA256']
    d=json.loads(Path(source['decoded']).read_text(encoding='utf-8'))
    with Path(source['raw']).open(newline='',encoding='utf-8-sig') as f:
        reader=csv.reader(f);next(reader);raw=np.array([[float(v) for v in r] for r in reader])
    live=raw[1:] if source['kind']=='Q2' else raw
    active=live[(live[:,106]==1)&(live[:,2]>=2)&(live[:,2]<=5)]
    at=active[:,46].astype(int)-2;assert len(at)==400
    pitch=d['header']['configured_meters_per_count'];sign=np.array([1.,-1.]);dt=[];u=[];idx=[];obs=[]
    for mode,a,b in [('hold',0,100),('motion',0,4000),('hold',100,150),('motion',4000,8000),('hold',150,300)]:
        for r in d['slow' if mode=='hold' else 'fast'][a:b]:
            if mode=='hold':
                dt.extend([r['dt_us']/40e6]*40);u.extend([np.array(r['command_integral_counts_us'])*sign/r['dt_us']]*40)
            else:dt.append(r['dt_us']/1e6);u.append(np.array(r['command_counts'])*sign)
            idx.append(len(dt)-1);obs.append(np.array(r['encoder'])*sign*pitch)
    p=np.zeros(2);v=np.zeros(2);positions=[]
    for command,h in zip(u,dt):
        p,v,info=mechanical_step(p,v,command,h,theta);positions.append(p.copy());balance=max(balance,abs(info['balanceResidual']))
    totalsteps+=len(positions);positions=np.array(positions)
    expected=next(r for r in fit['cases'] if r['record']==source['kind'] and r['case']=='freshJointRefit')
    diff=float(np.max(np.abs(positions[at]-np.array(expected['nativeContinuousPosition_m']))));assert diff<1e-12
    mapped=np.sign(positions[at])*np.floor(np.abs(positions[at]/pitch)+.5)*pitch;mapped=np.round(mapped,6)
    e=(mapped-active[:,5:7])*1000
    mean=float(np.sqrt(np.mean(e.mean(axis=1)**2)));sync=float(np.sqrt(np.mean((e[:,0]-e[:,1])**2)))
    assert abs(mean-expected['nativePredictionError']['meanPositionPredictionRMSE_mm'])<1e-12
    assert abs(sync-expected['nativePredictionError']['syncPredictionRMSE_mm'])<1e-12
    ep=(positions[np.array(idx)]-np.array(obs))*1000
    w=np.diff(np.r_[0.,np.cumsum(dt)[np.array(idx)]])
    objectives.append(float(np.sum(w*(ep.mean(axis=1)**2+(ep[:,0]-ep[:,1])**2))))
    results.append({'record':source['kind'],'independentSteps':len(positions),'maximumNativePythonPositionDifference_m':diff,
                    'meanPredictionRMSE_mm':mean,'syncPredictionRMSE_mm':sync})
assert totalsteps==40000 and balance<1e-10
objective=float(np.dot(protocol['recordWeights'],objectives)+1e-8*np.sum((theta/scale)**2))
assert abs(objective-fit['fit']['finalObjective'])<1e-12
oldstate=json.loads((ROOT/'current_state.json').read_text(encoding='utf-8'))
firmware=oldstate['identificationT1FullmovingRound70'];project=Path(firmware['project']).parents[1]
assert sha(firmware['hex'])==firmware['hexSHA256']
for file,expected in firmware['sourceHashes'].items():assert sha(project/file)==expected
cases=fit['cases'];delta=[]
for kind in ['T1','Q2']:
    before=next(r for r in cases if r['record']==kind and r['case']=='freshNumericalSeed')
    after=next(r for r in cases if r['record']==kind and r['case']=='freshJointRefit')
    keys=['meanPositionPredictionRMSE_mm','syncPredictionRMSE_mm']
    delta.append({'record':kind,'nativeWaveformErrorChange_percent':{k:100*(after['nativePredictionError'][k]/before['nativePredictionError'][k]-1) for k in keys}})
summary={'date':'2026-10-15','fitResultsSHA256':sha(HERE/'fit_results.json'),'fitBudget':{'evaluations':fit['fit']['evaluations'],'maximum':protocol['maxEvaluations'],'iterations':len(fit['fit']['iterations'])},
    'trainingObjectiveReduction_percent':fit['fit']['objectiveReduction_percent'],'waveformChanges':delta,
    'fittedInertiaEta':float(theta[8]),'massEigenvalues':np.linalg.eigvalsh([[1,theta[8]],[theta[8],1]]).tolist(),
    'reciprocalSpringAtNumericalLowerBound':bool(theta[4]==0),'physicalZeroSpringOrInertiaProven':False,
    'decision':'Fresh-initialization joint calibration completed within its fixed budget. Both records are training, not independent validation. Numerical cross-check does not establish physical parameter identification, CA advantage or model closure. Preserve every whole-record prediction and report actual error levels before assessing applicability.',
    'nextOfflineStep':'Retain calibratedcandidate,limit applicability to training records, and address justified input/observation/structure information gaps before requesting independent validation. No further plant search or hardware trial automatically released.',
    'bothT1AndNewQ2NowTraining':True,'independentValidationDataAvailableForThisNewFit':False,'oldFittedParametersUsedForInitialization':False,
    'favorableMethodRankingNotOptimizationObjective':True,
    'modelClosureComplete':False,'independentValidationPassed':False,'Q2NotUntouchedHeldOut':True,'S3R2DataRead':False,
    'controlRawAndFirmwareUnchanged':True,'newPhysicalRunReleased':False}
verification={'passed':True,'independentPythonSteps':totalsteps,'nativePositionChecks':800,'maximumEnergyBalanceResidual':balance,
    'cases':results,'objectiveIndependentlyRecomputed':True,'allRawHashesUnchanged':True,'firmwareAndFourControlSourceHashesUnchanged':True,
    'budgetRespected':True,'numericalChecksNotPhysicalValidation':True,'modelAdmitted':False,'hardwareAction':False}
for name,result in [('verification.json',verification),('decision.json',summary)]:
    with (HERE/name).open('x',encoding='utf-8') as f:json.dump(result,f,ensure_ascii=False,indent=2,allow_nan=False)
print(json.dumps({'verification':verification,'decision':summary},ensure_ascii=False))
