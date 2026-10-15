"""Full propagation, independent state/energy checks, ablation and candidate freeze."""
import json
import numpy as np
from model import HERE,ROOT,sha,contig,library,load,rollout,describe
from reference import step
data=load();lib=library();fits=[]
for name,path in [('coupling_variant','fit_results.json'),('drive_variant','drive_variant_results.json')]:
    d=json.loads((HERE/path).read_text());fits.append(dict(name=name,file=path,**d['selected']))
selected=min(fits,key=lambda f:f['objective']);z=contig(selected['parameters']);checks=[];mechanism=[];cases=[];traces=[]
for d in data:
    positions=rollout(lib,z,d);cases.append(describe(positions,d));state=np.zeros(6);maxdiff=0.;independentDiff=0.;energy=0.;plastic=0.;yieldSteps=np.zeros(2,int);slipSteps=np.zeros(2,int)
    for k,h in enumerate(d['dt']):
        out=np.empty(6);assert lib.model_memory_step(contig(state),contig(d['u'][k]),float(h),z,out)==1
        if k%40==0:
            expected,info=step(state,d['u'][k],h,z);independentDiff=max(independentDiff,float(max(abs(out-expected))));energy=max(energy,abs(info['energyBalanceResidual']))
        force=z[9:11]*(out[:2]-out[4:]);pd=float(force@(out[4:]-state[4:]));assert pd>=-1e-12;plastic+=pd
        yieldSteps+=np.abs(force)>=z[11]-1e-10;slipSteps+=np.abs(out[4:]-state[4:])>1e-14
        state=out;maxdiff=max(maxdiff,float(np.max(abs(state[:2]-positions[k]))))
    assert maxdiff<1e-12 and independentDiff<1e-10 and energy<1e-10
    checks.append(dict(record=d['name'],nativePropagationSteps=20000,independentPythonSteps=500,maximumNativePositionDifference_m=maxdiff,maximumIndependentStateDifference=independentDiff,maximumSampledEnergyBalanceResidual=energy))
    mechanism.append(dict(record=d['name'],yieldStepCounts=yieldSteps.tolist(),plasticSlipStepCounts=slipSteps.tolist(),totalPlasticDissipation=plastic,finalPlasticAnchor_m=state[4:].tolist()))
    traces.append(dict(record=d['name'],nativePosition_m=positions[d['at']].tolist(),actualPosition_m=d['actual'].tolist(),reference_m=d['ref'].tolist()))
ablations=[]
for name,change in [('no_added_elastic_friction','zero_stiffness'),('elastic_without_slip_memory','infinite_yield')]:
    alt=z.copy()
    if change=='zero_stiffness':alt[9:11]=0
    else:alt[11]=1e6
    for d in data:
        p=rollout(lib,alt,d);ablations.append(dict(case=name,**describe(p,d)) if p is not None else dict(case=name,record=d['name'],rolloutValid=False))
# Zero stiffness must recover the previous kinetic-only mechanical integrator, without static extra.
oldsource=HERE.parent/'cumulative_micro_round90_20261015/native_model.dll'
from predict import library as oldlibrary,rollout as oldrollout
oldlib=oldlibrary(oldsource);zero=z.copy();zero[9:11]=0;equiv=[]
for d in data:
    q=rollout(lib,zero,d);p=oldrollout(oldlib,np.r_[zero[:9],0.,0.],d);assert p is not None and q is not None
    difference=float(np.max(abs(q-p)));assert difference<1e-9;equiv.append(dict(record=d['name'],kineticOnlyEquivalenceMaxDifference_m=difference))
verification=dict(passed=True,solverTestsSHA256=sha(HERE/'solver_tests.json'),checks=checks,kineticOnlyEquivalence=equiv,
    sourceSHA256=sha(HERE/'native_model.c'),solverSHA256=sha(HERE/'native_model.dll'),scope='Numerical checks, sampled energy identity and dissipation; not independent physical validation')
with (HERE/'verification.json').open('x',encoding='utf-8') as f:json.dump(verification,f,indent=2)
parameterNames=['gainL','gainR','dampingL','dampingR','reciprocalSpring','reciprocalDamping','CoulombKineticL','CoulombKineticR','inertiaEta','preSlidingStiffnessL','preSlidingStiffnessR','sharedYieldForce']
model=dict(version='R100_new_belt_elastic_slider',status='Exploratory modified model; sync aggregates fit but tracking still fails15percent; not accepted for validation batch',
    parameters=z.tolist(),parameterNames=parameterNames,selectedVariant=selected['name'],solverRelativeToProject=str((HERE/'native_model.dll').relative_to(ROOT)),
    solverSHA256=sha(HERE/'native_model.dll'),solverSourceSHA256=sha(HERE/'native_model.c'),
    memoryState='Two independent plastic anchors, initialized at initial positions once. Velocity and anchor evolve only from simulated states and recorded queued inputs.',
    equations=['M*v_dot+B*v+Kdiff*p+Fc*Sign(v)+f_el=G*u','trial_i=k_i*(p_new_i-anchor_old_i)','f_el_i=clip(trial_i,-Y,Y)','anchor_new_i=p_new_i-f_el_i/k_i'],
    sourceResultsSHA256=sha(HERE/selected['file']),verificationSHA256=sha(HERE/'verification.json'),
    regime='New synchronous belt; onlyrun010/run011 in objective',sourceHashes=[{k:d[k] for k in ['name','raw','rawSHA256','decoded','decodedSHA256']} for d in data],
    bothRecordsCalibration=True,independentValidationPassed=False,physicalParametersUniquelyIdentified=False,
    calibrationCases=cases,allBoth15percentPassed=all(c['bothWithin15Percent'] for c in cases),
    assumptionsAndLimitations=['Equivalent friction memory, not proof of actual belt plasticity or unique physical cause.',
        'Four shared effective parameters from four aggregate values can be nonunique; nominal remaining coefficients inherited, not reidentified.',
        'Only aggregate RMS is fitted; waveform agreement not promised or a hard acceptance gate.',
        'Moving inputs1ms; unknown40ms hold waveforms still represented by means.',
        'Forced recorded-input replay, not autonomous controller-plant simulation.'],
    firmwareChanged=False,assistantHardwareAction=False,newPhysicalRunReleased=False)
with (HERE/'model_parameters.json').open('x',encoding='utf-8') as f:json.dump(model,f,ensure_ascii=False,indent=2)
old010=json.loads((HERE.parent/'new_belt_calibration_round98_20261015/comparison_summary.json').read_text());old011=json.loads((HERE.parent/'new_belt_frozen_check_round99_20261015/comparison_summary.json').read_text())
previous=[next(r for r in old010['cases'] if r['family']=='damping_stiffness'),next(r for r in old011['cases'] if r['model']=='R98_damping_stiffness')]
summary=dict(status='Low-speed elastic-slider memory implemented and jointly calibrated; improved but not accepted',selectedVariant=selected['name'],
    modelParameters=str(HERE/'model_parameters.json'),modelSHA256=sha(HERE/'model_parameters.json'),
    sources=model['sourceHashes'],cases=cases,previousR98Comparisons=previous,mechanismDiagnostics=mechanism,ablations=ablations,
    alternativeVariantResults=[dict(variant=f['name'],objective=f['objective'],cases=f['cases']) for f in fits],
    verification=verification,allSyncAggregatesWithin15Percent=all(abs(c['syncDifference_percent'])<=15 for c in cases),
    allTrackingAggregatesWithin15Percent=all(abs(c['trackingDifference_percent'])<=15 for c in cases),
    bothNewBeltRecordsNowCalibration=True,previousFrozenFailuresPreserved=True,oldRegimeRecordsUsedForObjective=0,
    physicalModelValidated=False,allOldRawModelsFirmwarePreserved=True,newPhysicalRunReleased=False,assistantHardwareAction=False,
    nextStep='No further same-condition collection yet. Address remaining common-mode tracking mismatch and hold-input uncertainty offline; no guarantee it is uniquely a friction or belt issue. Any further model development uses both records as calibration, then needs a genuinely new frozen test.')
for d in data:assert sha(d['raw'])==d['rawSHA256']
with (HERE/'comparison_summary.json').open('x',encoding='utf-8') as f:json.dump(summary,f,ensure_ascii=False,indent=2)
with (HERE/'comparison_traces.json').open('x',encoding='utf-8') as f:json.dump(traces,f,indent=2)
print(json.dumps(dict(summarySHA256=sha(HERE/'comparison_summary.json'),modelSHA256=sha(HERE/'model_parameters.json'),cases=cases,mechanism=mechanism,verification=verification),ensure_ascii=False))
