"""Independently check recovered candidate, then save without overwriting LM history."""
import importlib.util,json
import numpy as np
from fit import HERE,PRIOR,OLD,ROOT,load,sha,library,rollout,contig,describe,save
data=load();lib=library();result=json.loads((HERE/'solver_recovery_results.json').read_text());sub=json.loads((HERE/'subspace.json').read_text());first=json.loads((HERE/'comparison_summary.json').read_text())
source=json.loads((PRIOR/'model_parameters.json').read_text());best=result['selected'];z=np.array(best['parameters']);y=np.array(best['coordinates']);base=np.array(sub['anchor']);basis=np.array(sub['basis'])
lo=np.array(first['boundaryAndStability']['lower']);hi=np.array(first['boundaryAndStability']['upper']);x=basis@y
assert np.all(x>=lo-1e-12) and np.all(x<=hi+1e-12)
spec=importlib.util.spec_from_file_location('r104_final_ref',PRIOR/'reference.py');ref=importlib.util.module_from_spec(spec);spec.loader.exec_module(ref)
checks=[];cases=[];traces=[]
for d in data:
    p=rollout(lib,z,d);assert p is not None;state=np.zeros(6);native=independent=energy=0.
    cases.append(describe(p,d));traces.append(dict(record=d['name'],nativePrediction_m=p[d['at']].tolist(),actual_m=d['actual'].tolist(),reference_m=d['ref'].tolist()))
    for k,h in enumerate(d['dt']):
        out=np.empty(6);assert lib.model_memory_step(contig(state),contig(d['u'][k]),float(h),contig(z),out)==1
        if k%40==0:
            expected,info=ref.step(state,d['u'][k],h,z);independent=max(independent,float(max(abs(expected-out))));energy=max(energy,abs(info['energyBalanceResidual']));assert info['plasticDissipation']>=-1e-12
        native=max(native,float(max(abs(out[:2]-p[k]))));state=out
    assert native<1e-12 and independent<1e-10 and energy<1e-10
    checks.append(dict(record=d['name'],nativeSteps=20000,independentPythonSteps=500,maxNativePositionDifference=native,maxIndependentStateDifference=independent,maxEnergyBalanceResidual=energy))
    assert sha(d['raw'])==d['rawSHA256'] and sha(d['decoded'])==d['decodedSHA256']
def response(xx):
    zz=base*np.exp(np.where(np.arange(12)==8,0,xx));zz[8]=base[8]+.1*xx[8];blocks=[]
    for d in data:
        p=rollout(lib,zz,d);assert p is not None
        e=(p[d['idx']]-d['observed'])*1000;w=np.sqrt(np.diff(np.r_[0,np.cumsum(d['dt'])[d['idx']]]))/np.sqrt(2*sum(d['dt']));q=p[d['at']]
        blocks.extend([w*e.mean(axis=1)/.05,w*(e[:,0]-e[:,1])/.05])
        m=np.array([np.sqrt(np.mean(((q.mean(axis=1)-d['ref'])*1000)**2)),np.sqrt(np.mean(((q[:,0]-q[:,1])*1000)**2))]);blocks.append(5/np.sqrt(2)*(m/d['targets']-1)/.15)
    return np.r_[*blocks]
cols=[]
for j in range(12):
    xp=x.copy();xm=x.copy();xp[j]+=.0005;xm[j]-=.0005
    if np.all(xp<=hi) and np.all(xm>=lo):column=(response(xp)-response(xm))/.001
    elif np.all(xp<=hi):column=(response(xp)-response(x))/.0005
    else:
        assert np.all(xm>=lo)
        column=(response(x)-response(xm))/.0005
    cols.append(column)
J=np.array(cols).T;sv=np.linalg.svd(J,compute_uv=False);reduced=np.linalg.svd(J@basis,compute_uv=False)
starts=result['allFits'];dist=max(np.linalg.norm(np.array(f['coordinates'])-y) for f in starts)
positive=np.arange(12)!=8
spread=max(float(max(abs(np.array(f['parameters'])[positive]/z[positive]-1))*100) for f in starts)
metricSpread=max(max(abs(f['cases'][i][k]-cases[i][k]) for f in starts) for i in range(2) for k in ['predictedTrackingRMSE_mm','predictedSyncRMS_mm'])
active=[source['parameterNames'][i] for i in range(12) if min(x[i]-lo[i],hi[i]-x[i])<1e-5]
audit=dict(allOriginalGlobalBoundsSatisfied=True,boundaryViolations=[],activeOrNearActiveGlobalBounds=active,
    boundaryDependenceStillPresent=bool(active),finiteDifferencesAtBoundaryOneSided=True,
    retainedDirections=int(basis.shape[1]),weakDirectionsFrozen=12-int(basis.shape[1]),
    full12ParameterConditionSameDataObjective=float(sv[0]/sv[-1]),reducedDataConditionNoPrior=float(reduced[0]/reduced[-1]),
    reducedSingularValues=reduced.tolist(),fullSingularValues=sv.tolist(),
    effectiveGainRightLeftRatio=float(z[1]/z[0]),massCondition=float((1+abs(z[8]))/(1-abs(z[8]))),
    multistartObjectiveRange=[min(f['objective'] for f in starts),max(f['objective'] for f in starts)],
    multistartMaxCoordinateDistance=dist,multistartMaxPositiveParameterDifference_percent=spread,multistartMaxRMSDifference_mm=metricSpread,
    onePercentPerturbationMaxPositiveParameterChange_percent=max(p['maxPositiveCoefficientChange_percent'] for p in result['perturbations']),
    onePercentPerturbationMaxEtaChange=max(p['etaAbsoluteChange'] for p in result['perturbations']),
    finiteBudgetNotProofOfGlobalConvergence=True,physical12ParameterIdentifiabilityResolved=False,
    meaning='Only six observable combinations are adjusted; remaining combinations fixed to R100 anchor. This mitigates optimizer nonuniqueness but does not add information or identify physical motor constants. Gain ratio is effective, not calibrated hardware ratio.')
for c in cases:c['bothWithin20Percent']=max(abs(c['trackingDifference_percent']),abs(c['syncDifference_percent']))<=20
model=dict(version='R104_bounded_reduced_recovered',status='Effective reduced-model calibration; independent test pending, physical constants not identified',parameters=z.tolist(),
    parameterNames=source['parameterNames'],solverRelativeToProject=source['solverRelativeToProject'],solverSHA256=source['solverSHA256'],solverSourceSHA256=source['solverSourceSHA256'],
    subspaceSHA256=sha(HERE/'subspace.json'),sourceHashes=first['sourceHashes'],calibrationCases=cases,audit=audit,
    physicalModelValidated=False,bothRecordsCalibration=True,independentValidationPassed=False,firmwareChanged=False)
assert sha(PRIOR/'native_model.dll')==source['solverSHA256']
save('recovered_model_parameters.json',model)
summary=dict(cases=cases,boundaryAndStability=audit,verification=checks,sourceHashes=first['sourceHashes'],
    allBothWithin15Percent=all(c['bothWithin15Percent'] for c in cases),allBothWithin20Percent=all(c['bothWithin20Percent'] for c in cases),
    maximumAbsoluteRMSRelativeError_percent=max(max(abs(c['trackingDifference_percent']),abs(c['syncDifference_percent'])) for c in cases),
    previousR103Preserved=True,original15PercentFailuresRetained=True,thresholdUsedToSelectFit=False,
    modelPath=str(HERE/'recovered_model_parameters.json'),modelSHA256=sha(HERE/'recovered_model_parameters.json'),
    recoveryResultsSHA256=sha(HERE/'solver_recovery_results.json'),verificationScriptSHA256=sha(__file__),
    numericalVerificationPassed=True,rawHashesUnchanged=True,firmwareChanged=False,assistantHardwareAction=False,
    bothRecordsCalibrationOnly=True,independentValidationPassed=False,physicalParametersIdentified=False,
    nextStep='User review, then freeze candidate BEFORE any future independent capture. No automatic sampling release. If independent aggregates pass, restrict claim to aggregate forced-input prediction under same regime; weak physical parameters remain assumed.')
save('final_comparison_summary.json',summary);save('final_comparison_traces.json',traces)
print(json.dumps(dict(cases=cases,audit=audit,summarySHA256=sha(HERE/'final_comparison_summary.json'),modelSHA256=sha(HERE/'recovered_model_parameters.json')),ensure_ascii=False),flush=True)
