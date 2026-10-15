import json
import numpy as np
from calibration_core import HERE,ROOT,PRIOR,protocol,sha,load_records,newlib,oldlib,contig
from reference import mechanical_step,original

fit=json.loads((HERE/'fit_results.json').read_text(encoding='utf-8'))
polished=json.loads((HERE/'polish_results.json').read_text(encoding='utf-8'))
settings=json.loads((HERE/'polish_protocol.json').read_text(encoding='utf-8'))
assert polished['fitResultsSHA256']==sha(HERE/'fit_results.json')
assert polished['polishProtocolSHA256']==sha(HERE/'polish_protocol.json')
assert polished['polishScriptSHA256']==sha(HERE/'polish.py')
assert len(polished['allEvaluations'])==polished['evaluations']<=settings['maximumEvaluations']
assert len(polished['history'])<=settings['maximumPasses']
assert all(r['after']<=r['before'] for r in polished['history'])
assert sha(HERE/'protocol.json')==fit['protocolSHA256']
assert sha(HERE/'fit.py')==fit['fitScriptSHA256']
assert sha(HERE/'calibration_core.py')==fit['coreScriptSHA256']
assert sha(HERE/'native_model.dll')==fit['newSolverLibrarySHA256']
assert sha(HERE/'native_model.c')==fit['newSolverSourceSHA256']
for item in fit['fits']:
    budget=protocol['nineParameterBudget'] if item['dimension']==9 else protocol['elevenParameterBudgetPerSeed']
    assert len(item['allEvaluations'])==item['evaluations']<=budget['evaluations']
    assert len(item['iterations'])<=budget['iterations']
    assert all(r['after']<=r['before'] for r in item['iterations'])
    for row in item['allEvaluations']:
        z=np.array(row['parameters']);assert np.isfinite(z).all()
        assert np.all(z>=np.array(protocol['lowerBounds11'][:len(z)])-1e-12)
        assert np.all(z<=np.array(protocol['upperBounds11'][:len(z)])+1e-12)

def native(p,v,u,h,z):
    out=np.full(4,np.nan);assert newlib.model_one(contig(p),contig(v),contig(u),h,contig(z),out)==1
    return out
fixture=np.array([1e-5,1e-5,1,1,0,0,.001,.001,0,.003,.003])
assert np.array_equal(native([0,0],[0,0],[250,0],.001,fixture),np.zeros(4))
assert native([0,0],[0,0],[600,0],.001,fixture)[2]>0
assert native([0,0],[-1e-6,0],[250,0],.001,fixture)[2]==0
z=fixture.copy();z[9:]=0
assert native([0,0],[-1e-6,0],[250,0],.001,z)[2]>0
rng=np.random.default_rng(811015);random_diff=0.;random_balance=0.
for k in range(160):
    theta=np.array(fit['parameters'][:9]+[.0005,.0007])
    p=rng.uniform(-.002,.002,2);v=rng.uniform(-.001,.001,2);u=rng.uniform(-600,600,2)
    if k%3==0:v[k%2]=0
    if k%5==0:v[:]=0
    h=float(rng.uniform(.00099,.00101))
    expected=native(p,v,u,h,theta);q,w,info=mechanical_step(p,v,u,h,theta)
    random_diff=max(random_diff,float(np.max(np.abs(np.r_[q,w]-expected))))
    random_balance=max(random_balance,abs(info['balanceResidual']))
assert random_diff<1e-12 and random_balance<1e-10

records=load_records();theta=np.array(polished['parameters']);scale=np.array(protocol['parameterScales11'][:len(theta)])
steps=0;maximum_diff=0.;maximum_balance=0.;scores=[];checks=[]
for d in records:
    source=next(r for r in fit['sourceHashes'] if r['name']==d['name'])
    assert sha(d['raw'])==source['rawSHA256'] and sha(d['decoded'])==source['decodedSHA256']
    p=np.zeros(2);v=np.zeros(2);positions=[];record_balance=0.
    for u,h in zip(d['u'],d['dt']):
        p,v,info=mechanical_step(p,v,u,h,theta);positions.append(p.copy())
        record_balance=max(record_balance,abs(info['balanceResidual']))
    positions=np.array(positions);steps+=len(positions)
    expected=next(c for c in polished['cases'] if c['record']==d['name'])
    diff=float(np.max(np.abs(positions[d['at']]-np.array(expected['nativeContinuousPosition_m']))))
    assert diff<1e-12
    maximum_diff=max(maximum_diff,diff);maximum_balance=max(maximum_balance,record_balance)
    native_positions=positions[d['at']]
    mapped=np.round(np.sign(native_positions)*np.floor(np.abs(native_positions/d['pitch'])+.5)*d['pitch'],6)
    tracking=float(np.sqrt(np.mean(((mapped.mean(axis=1)-d['active'][:,3])*1000)**2)))
    sync=float(np.sqrt(np.mean(((mapped[:,0]-mapped[:,1])*1000)**2)))
    assert abs(tracking-expected['modeledTrackingRMSE_mm'])<1e-12
    assert abs(sync-expected['modeledSyncRMS_mm'])<1e-12
    e=(positions[d['idx']]-d['observed'])*1000
    weights=d['weights']**2
    wave=float(np.sum(weights*((e.mean(axis=1)/protocol['waveformScale_mm'][0])**2+((e[:,0]-e[:,1])/protocol['waveformScale_mm'][1])**2))/sum(d['dt']))
    stats=np.array([np.sqrt(np.mean(((native_positions.mean(axis=1)-d['active'][:,3])*1000)**2)),np.sqrt(np.mean(((native_positions[:,0]-native_positions[:,1])*1000)**2))])
    scores.append(wave+float(np.sum(((stats/d['targets']-1)/protocol['metricRelativeScale'])**2)))
    checks.append({'record':d['name'],'steps':len(positions),'maxNativePositionDifference_m':diff,'trackingRMSE_mm':tracking,'syncRMS_mm':sync})
    print(json.dumps({'checked':d['name'],'steps':len(positions),'maxDifference':diff}),flush=True)
selected=next(f for f in fit['fits'] if f['label']==fit['selectedFit'])
score=float(np.dot(protocol['recordWeights'],scores)+1e-8*np.sum((theta/scale)**2))
assert abs(score-polished['finalObjective'])<1e-9 and score<=selected['finalObjective'] and steps==60000 and maximum_balance<1e-10
old=json.loads((ROOT/'current_state.json').read_text(encoding='utf-8'))
firmware=old['identificationT1FullmovingRound70'];project=__import__('pathlib').Path(firmware['project']).parents[1]
assert sha(firmware['hex'])==firmware['hexSHA256']
for file,expected in firmware['sourceHashes'].items():assert sha(project/file)==expected
q2prep=json.loads((ROOT/'06_仿真与复现/q2_mechanical_recheck_round73_20261015/preparation.json').read_text(encoding='utf-8'))
q2proto=json.loads((ROOT/'06_仿真与复现/q2_mechanical_recheck_round73_20261015/protocol.json').read_text(encoding='utf-8'))
assert sha(q2proto['hex'])==q2prep['hexSHA256']
project=__import__('pathlib').Path(q2proto['project']).parents[1]
for file,expected in q2prep['currentSourceHashes'].items():assert sha(project/file)==expected
assert sha(ROOT/'06_仿真与复现'/protocol['frozenR79ParametersFile'])==protocol['frozenR79ParametersSHA256']
out={'passed':True,'fitResultsSHA256':sha(HERE/'fit_results.json'),'polishResultsSHA256':sha(HERE/'polish_results.json'),'randomOneStepChecks':160,
     'staticHoldBreakawayAndZeroCrossCaptureFixturesPassed':True,'zeroExtraBackCompatibilityAcross60000Steps':fit['zeroExtraBackCompatibilityAcross60000Steps'],
     'independentPythonSteps':steps,'nativePositionChecks':1199,'maximumNativePositionDifference_m':maximum_diff,
     'maximumEnergyBalanceResidual':maximum_balance,'objectiveIndependentlyRecomputed':score,
     'checks':checks,'allRawFrozenR79AndFirmwareHashesUnchanged':True,'modelPhysicalValidityProven':False,
     'allThreeRecordsUsedForCalibration':True,'noHardwareAction':True}
with (HERE/'verification.json').open('x',encoding='utf-8') as f:json.dump(out,f,ensure_ascii=False,indent=2,allow_nan=False)
print(json.dumps(out,ensure_ascii=False))
