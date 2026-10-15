"""Freeze final bounded-development outcome without converting calibration into validation."""
import importlib.util,json
import numpy as np
from fit import HERE,PRIOR,ROOT,load,sha,library,rollout,contig,describe
spec=importlib.util.spec_from_file_location('memory_independent_ref',PRIOR/'reference.py');reference=importlib.util.module_from_spec(spec);spec.loader.exec_module(reference)
data=load();lib=library();polish=json.loads((HERE/'polish_results.json').read_text());selected=polish['selected'];z=np.array(selected['parameters'])
source=json.loads((PRIOR/'model_parameters.json').read_text());initial=np.array(source['parameters']);checks=[];cases=[];traces=[]
for d in data:
    p=rollout(lib,z,d);assert p is not None;metrics=describe(p,d);cases.append(metrics);state=np.zeros(6);maximum=0.;independent=0.;energy=0.
    for k,h in enumerate(d['dt']):
        output=np.empty(6);assert lib.model_memory_step(contig(state),contig(d['u'][k]),float(h),contig(z),output)==1
        if k%40==0:
            expected,info=reference.step(state,d['u'][k],h,z);independent=max(independent,float(max(abs(output-expected))));energy=max(energy,abs(info['energyBalanceResidual']));assert info['plasticDissipation']>=-1e-12
        state=output;maximum=max(maximum,float(max(abs(state[:2]-p[k]))))
    assert maximum<1e-12 and independent<1e-10 and energy<1e-10
    checks.append(dict(record=d['name'],nativeFullPropagationSteps=20000,independentPythonSteps=500,maxPositionDifference_m=maximum,maxIndependentStateDifference=independent,maxSampledEnergyBalanceResidual=energy))
    traces.append(dict(record=d['name'],nativePosition_m=p[d['at']].tolist(),actualPosition_m=d['actual'].tolist(),reference_m=d['ref'].tolist()))
    reported=next(r for r in selected['cases'] if r['record']==d['name'])
    for key in ['predictedTrackingRMSE_mm','predictedSyncRMS_mm']:assert abs(metrics[key]-reported[key])<1e-12
# Check both inherited global bounds and the separately declared final local modal box.
lo=initial*.05;hi=initial*20;hi[3]=initial[3]*1000;lo[8]=-.95;hi[8]=.95
boundViolations=[dict(parameter=source['parameterNames'][i],value=float(z[i]),originalJointLower=float(lo[i]),originalJointUpper=float(hi[i])) for i in range(12) if z[i]<lo[i]-1e-15 or z[i]>hi[i]+1e-15]
assert max(abs(np.array(selected['coordinates'])))<=.1000000001
def weighted_response(theta):
    arrays=[];aggregate=[]
    for d in data:
        p=rollout(lib,theta,d);assert p is not None
        q=p[d['at']];e=(p[d['idx']]-d['observed'])*1000;w=np.sqrt(np.diff(np.r_[0,np.cumsum(d['dt'])[d['idx']]]))/np.sqrt(2*sum(d['dt']))
        arrays.extend([w*e.mean(axis=1)/.05,w*(e[:,0]-e[:,1])/.05])
        m=np.array([np.sqrt(np.mean(((q.mean(axis=1)-d['ref'])*1000)**2)),np.sqrt(np.mean(((q[:,0]-q[:,1])*1000)**2))]);aggregate.extend((m/d['targets']-1)/.15)
    return np.r_[*arrays],np.array(aggregate)
columns=[];aggregateColumns=[]
for i in range(12):
    plus=z.copy();minus=z.copy()
    if i==8:plus[i]+=.0001;minus[i]-=.0001;h=.0001
    else:plus[i]*=np.exp(.001);minus[i]*=np.exp(-.001);h=.001
    a,aa=weighted_response(plus);b,bb=weighted_response(minus);columns.append((a-b)/(2*h));aggregateColumns.append((aa-bb)/(2*h))
sv=np.linalg.svd(np.array(columns).T,compute_uv=False);av=np.linalg.svd(np.array(aggregateColumns).T,compute_uv=False)
identifiability=dict(fullSnapshotJacobianSingularValues=sv.tolist(),fullSnapshotJacobianRankRelative1e6=int(sum(sv>sv[0]*1e-6)),
    fullSnapshotConditionNumber=float(sv[0]/sv[-1]) if sv[-1]>0 else None,
    aggregateJacobianSingularValues=av.tolist(),aggregateJacobianMaximumRank=4,
    caveat='Local finite-difference sensitivity, not proof of globally identifiable physical parameters. Four summaries alone cannot uniquely identify12 coefficients.',
    normalizedMassConditionNumber=float((1+abs(z[8]))/(1-abs(z[8]))),effectiveRightLeftGainRatio=float(z[1]/z[0]),
    originalJointBoundsExceededByLocalPolish=boundViolations,
    inference='Do not adopt as physical model: original joint boundary exceeded for listed parameters; final local modal box was respected, but acceptance still fails.')
verification=dict(passed=True,checks=checks,rawHashesUnchanged=True,sourceModelPreserved=sha(PRIOR/'model_parameters.json')=='a44665e79b254514302e0c39c3a3ebf288df7e684920e5dc2b76df49683ce486')
for d in data:assert sha(d['raw'])==d['rawSHA256']
with (HERE/'verification.json').open('x',encoding='utf-8') as f:json.dump(verification,f,indent=2)
model=dict(version='R103_new_belt_joint_dynamics_development',status='Development only, not accepted: max rounded aggregate error still exceeds15percent and boundary/identifiability issues remain',
    parameters=z.tolist(),parameterNames=source['parameterNames'],solverRelativeToProject=source['solverRelativeToProject'],solverSHA256=source['solverSHA256'],solverSourceSHA256=source['solverSourceSHA256'],
    memoryState=source['memoryState'],equations=source['equations'],regime='Same-specification new synchronous belt, tighter tension, same pulleys and ratio; position conversion unchanged',
    sourceHashes=[{k:d[k] for k in ['name','raw','rawSHA256','decoded','decodedSHA256']} for d in data],
    stages=['joint full-snapshot identification','bounded LM with aggregate priority','bounded local minimax aggregate polish'],
    sourceResultsSHA256=sha(HERE/'polish_results.json'),verificationSHA256=sha(HERE/'verification.json'),calibrationCases=cases,
    identifiabilityAndBounds=identifiability,bothRecordsCalibration=True,independentValidationPassed=False,physicalParametersIdentified=False,
    noOutputCorrections=True,noMeasuredStateInjection=True,firmwareChanged=False,newPhysicalRunReleased=False,assistantHardwareAction=False)
with (HERE/'model_parameters.json').open('x',encoding='utf-8') as f:json.dump(model,f,ensure_ascii=False,indent=2)
summary=dict(status='Finite new-belt joint-identification work complete, improved but original15percent gate not passed',
    confirmedHardware=dict(sameBeltSpecification=True,samePulleysAndRatio=True,tighterBelt=True,positionConversionChanged=False),
    sourceHashes=model['sourceHashes'],cases=cases,maximumRoundedAbsoluteRelativeError_percent=max(max(abs(c['trackingDifference_percent']),abs(c['syncDifference_percent'])) for c in cases),
    allBothMetricsWithin15Percent=all(c['bothWithin15Percent'] for c in cases),
    rejectedHypotheses=dict(commonPassiveCentering='R101 optimum addedK/C bothzero; no improvement under fixed R100 coefficients',
        speedWeakening='R102 optimum moving/restyield ratio1; no improvement under fixed R100 coefficients',
        holdReconstruction='Two integral/first-command consistent hypotheses changed R100 tracking by <=0.000111mm, did not explain discrepancy; true waveform still unknown'),
    modelPath=str(HERE/'model_parameters.json'),modelSHA256=sha(HERE/'model_parameters.json'),verification=verification,identifiabilityAndBounds=identifiability,
    objectiveChangesExplicitlyDocumented=True,acceptanceThresholdRelaxed=False,bothRecordsDevelopmentOnly=True,previousFrozenFailuresRetained=True,
    physicalModelValidated=False,adoptedAsFinalModel=False,newPhysicalRunReleased=False,firmwareChanged=False,assistantHardwareAction=False,
    nextStep='Stop this bounded search. Review weakly identifiable/boundary-dependent coefficients and use physical constraints before any new trial or additional model terms. Do not relabel16percent as passing15percent; do not claim tighter tension uniquely caused friction change.')
with (HERE/'comparison_summary.json').open('x',encoding='utf-8') as f:json.dump(summary,f,ensure_ascii=False,indent=2)
with (HERE/'comparison_traces.json').open('x',encoding='utf-8') as f:json.dump(traces,f,indent=2)
print(json.dumps(dict(summarySHA256=sha(HERE/'comparison_summary.json'),modelSHA256=sha(HERE/'model_parameters.json'),cases=cases,identifiability=identifiability),ensure_ascii=False))
