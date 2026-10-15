"""Independent checks of the eleven-parameter refinement and bias hypothesis."""
import importlib.util,json
from pathlib import Path
import numpy as np
from calibration_core import HERE,ROOT,protocol,sha,load_records

previous=ROOT/'06_仿真与复现/cumulative_hold_calibration_round81_20261015'
spec=importlib.util.spec_from_file_location('static_reference',previous/'reference.py')
reference=importlib.util.module_from_spec(spec);spec.loader.exec_module(reference)
records=load_records();fit83=json.loads((HERE/'fit_results.json').read_text(encoding='utf-8'))
dir82=ROOT/'06_仿真与复现/tracking_refine_round82_20261015'
fit82=json.loads((dir82/'fit_results.json').read_text(encoding='utf-8'))
multi82=json.loads((dir82/'multistart_results.json').read_text(encoding='utf-8'))
proto82=json.loads((dir82/'protocol.json').read_text(encoding='utf-8'))
assert sha(HERE/'protocol.json')==fit83['protocolSHA256']
assert sha(HERE/'fit.py')==fit83['fitScriptSHA256']
assert sha(HERE/'native_model.c')==fit83['solverSourceSHA256']
assert sha(HERE/'native_model.dll')==fit83['solverSHA256']
assert sha(dir82/'fit_results.json')==multi82['fitResultsSHA256']
assert sha(dir82/'multistart_protocol.json')==multi82['multistartProtocolSHA256']
assert sha(dir82/'multistart.py')==multi82['multistartScriptSHA256']
assert sha(dir82/'protocol.json')==fit82['protocolSHA256']
assert sha(dir82/'refine.py')==fit82['refineScriptSHA256']
assert sha(dir82/'native_model.dll')==fit82['solverSHA256']
assert sha(dir82/'native_model.c')==fit82['solverSourceSHA256']
assert fit82['evaluations']<=proto82['optimizer']['maximumEvaluations']
mssettings=json.loads((dir82/'multistart_protocol.json').read_text(encoding='utf-8'))
for f in multi82['fits']:assert f['evaluations']<=mssettings['maximumEvaluationsPerSeed']
for f in fit83['fits']:assert f['evaluations']<=protocol['optimizer']['maximumEvaluationsPerSeed']

options=[('round82',dir82,multi82['parameters'],multi82['cases'],'selectedRound82',multi82['finalObjective']),
         ('round83',HERE,fit83['parameters'],fit83['cases'],'round83',fit83['finalObjective'])]
checks=[];total=0
for name,directory,parameters,cases,label,targetscore in options:
    z=np.array(parameters);parts=[];maxdiff=0.;maxbalance=0.;modelchecks=[]
    for d in records:
        p=np.zeros(2);v=np.zeros(2);positions=[]
        for u,h in zip(d['u'],d['dt']):
            effective=u-z[11:13] if len(z)==13 else u
            p,v,info=reference.mechanical_step(p,v,effective,h,z[:11]);positions.append(p.copy())
            maxbalance=max(maxbalance,abs(info['balanceResidual']))
        positions=np.array(positions);total+=len(positions)
        expected=next(c for c in cases if c['case']==label and c['record']==d['name'])
        diff=float(np.max(abs(positions[d['at']]-np.array(expected['nativeContinuousPosition_m']))))
        assert diff<1e-12
        maxdiff=max(maxdiff,diff)
        native=positions[d['at']];mapped=np.round(np.sign(native)*np.floor(abs(native/d['pitch'])+.5)*d['pitch'],6)
        tracking=float(np.sqrt(np.mean(((mapped.mean(axis=1)-d['active'][:,3])*1000)**2)))
        sync=float(np.sqrt(np.mean(((mapped[:,0]-mapped[:,1])*1000)**2)))
        assert abs(tracking-expected['modeledTrackingRMSE_mm'])<1e-12
        assert abs(sync-expected['modeledSyncRMS_mm'])<1e-12
        e=(positions[d['idx']]-d['observed'])*1000;w=d['weights']**2
        wave=np.sum(w*((e.mean(axis=1)/protocol['waveformScale_mm'][0])**2+((e[:,0]-e[:,1])/protocol['waveformScale_mm'][1])**2))/sum(d['dt'])
        metrics=np.array([np.sqrt(np.mean(((native.mean(axis=1)-d['active'][:,3])*1000)**2)),np.sqrt(np.mean(((native[:,0]-native[:,1])*1000)**2))])
        parts.append(float(wave+np.sum(((metrics/d['targets']-1)/protocol['metricRelativeScale'])**2)))
        modelchecks.append({'record':d['name'],'steps':len(positions),'maxPositionDifference_m':diff,'trackingRMSE_mm':tracking,'syncRMS_mm':sync})
        print(json.dumps({'model':name,'checked':d['name'],'difference_m':diff}),flush=True)
    scales=np.array(protocol['parameterScales'][:len(z)])
    score=float(np.dot(protocol['recordWeights'],parts)+1e-8*np.sum((z/scales)**2))
    assert abs(score-targetscore)<1e-9 and maxbalance<1e-10
    for d in records:assert sha(d['raw'])==d['rawSHA256']
    result={'passed':True,'model':name,'parameterCount':len(z),'independentPythonSteps':60000,'nativePositionChecks':1199,
            'maximumCAndPythonPositionDifference_m':maxdiff,'maximumEnergyBalanceResidual':maxbalance,
            'objectiveIndependentlyRecomputed':score,'checks':modelchecks,'allThreeRecordsUsedForCalibration':True,
            'inputForceForEnergyCheck':'gain*(queuedCommand-neutralBias)' if len(z)==13 else 'gain*queuedCommand',
            'physicalCauseIdentified':False,'independentPhysicalValidationPassed':False,
            'allRawFilesUnchanged':True,'firmwareChanged':False,'newHardwareAction':False}
    with (directory/'verification.json').open('x',encoding='utf-8') as f:json.dump(result,f,ensure_ascii=False,indent=2,allow_nan=False)
    checks.append(result)
assert total==120000
print(json.dumps({'allPassed':True,'totalIndependentSteps':total,'modelsChecked':len(checks)},ensure_ascii=False))
