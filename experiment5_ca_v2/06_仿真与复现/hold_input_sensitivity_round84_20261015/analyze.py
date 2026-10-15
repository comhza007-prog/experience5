import csv,hashlib,json,sys
from pathlib import Path
import numpy as np
HERE=Path(__file__).resolve().parent;ROOT=HERE.parents[1]
R82=ROOT/'06_仿真与复现/tracking_refine_round82_20261015'
sys.path.insert(0,str(R82))
from calibration_core import load_records,rollout,describe,newlib,contig,sha

protocol=json.loads((HERE/'protocol.json').read_text(encoding='utf-8'))
frozen=ROOT/'06_仿真与复现'/protocol['modelParameters'];model=json.loads(frozen.read_text(encoding='utf-8'))
frozen_hash=sha(frozen);theta=np.array(model['parameters'])
assert sha(R82/'native_model.dll')==model['solverSHA256']
records=load_records();results=[];input_checks=[];known_motion_checks=[];local_motion_checks=[];scenario_inputs={}
source_checks=[]
for d in records:
    source_checks.append({k:d[k] for k in ['name','raw','rawSHA256','decoded','decodedSHA256']})
    with Path(d['raw']).open(newline='',encoding='utf-8-sig') as f:
        reader=csv.reader(f);next(reader);allrows=np.array([[float(v) for v in r] for r in reader])
    prefix=0 if d['name']=='T1' else 1;live=allrows[prefix:]
    frames={int(round(r[46]))-1:r for r in live if r[2] in [1,2,3,4,5]}
    anchors={k:r[13:15]*np.array([1.,-1.]) for k,r in frames.items()}
    moving_frames=[(k,r) for k,r in frames.items() if r[2] in [2,4] and (4000<=k<8000 or 10000<=k<14000)]
    mismatches=sum(not np.array_equal(r[13:15]*[1.,-1.],d['u'][k]) for k,r in moving_frames)
    assert mismatches==0
    known_motion_checks.append({'record':d['name'],'nativeNextIntervalCommandChecks':len(moving_frames),'mismatches':mismatches})
    blocks=[]
    for phase,a,b in [(1,0,4000),(3,8000,10000),(5,14000,20000)]:
        blocks.extend((phase,k,k+40) for k in range(a,b,40))
    assert len(blocks)==300
    variants={name:d['u'].copy() for name in protocol['cases']}
    for phase,a,b in blocks:
        h=d['dt'][a:b];total=float(sum(h));target=d['u'][a:b].T@h;mean=target/total
        anchor=anchors.get(a)
        for name in protocol['cases'][1:4]:
            fallback='none';candidate=d['u'][a:b].copy();next_anchor=None
            if anchor is None:fallback='missing_start_retain_mean'
            else:
                flat=np.repeat(((target-anchor*h[0])/sum(h[1:]))[None,:],39,axis=0)
                flat=np.vstack([anchor,flat]);assert np.max(abs(flat))<=1200+1e-6
                if name=='hold_start_then_flat':candidate=flat
                else:
                    n=np.arange(40,dtype=float)
                    slope=(target-anchor*total)/float(n@h)
                    candidate=anchor+n[:,None]*slope
                    if name=='hold_start_next_mean_quadratic':
                        nextframe=frames.get(b)
                        if nextframe is not None and int(nextframe[2])==phase:
                            next_anchor=anchors[b];x=n/40;m1=float(x@h);m2=float(x*x@h)
                            delta=next_anchor-anchor;c=(target-anchor*total-delta*m1)/(m2-m1);linear=delta-c
                            candidate=anchor+x[:,None]*linear+(x*x)[:,None]*c
                        else:fallback='no_same_phase_next_anchor_use_ramp'
                    if np.max(abs(candidate))>1200+1e-6:candidate=flat;fallback='bound_exceeded_use_anchor_flat'
                variants[name][a:b]=candidate
            error=(candidate.T@h-target)*1e6
            assert max(abs(error))<1e-5
            assert max(abs(candidate.ravel()))<=1200+1e-6
            if anchor is not None:assert np.max(abs(candidate[0]-anchor))<1e-9
            input_checks.append({'record':d['name'],'case':name,'phase':phase,'start':a,'end':b,'anchorObserved':anchor is not None,
                                 'anchor_counts':None if anchor is None else anchor.tolist(),'nextAnchor_counts':None if next_anchor is None else next_anchor.tolist(),
                                 'mean_counts':mean.tolist(),'targetIntegral_count_us':(target*1e6).tolist(),
                                 'integralError_count_us':error.tolist(),'fallback':fallback,
                                 'minimum_counts':np.min(candidate,axis=0).tolist(),'maximum_counts':np.max(candidate,axis=0).tolist(),
                                 'scenarioInputChangeRMS_counts':np.sqrt(np.mean((candidate-d['u'][a:b])**2,axis=0)).tolist(),
                                 'firstSampleMinusMean_counts':None if anchor is None else (anchor-mean).tolist()})
    for a,b in [(4000,8000),(10000,14000)]:
        for k in range(a,b,40):
            h=d['dt'][k:k+40];mean=(d['u'][k:k+40].T@h)/sum(h)
            variants['known_moving_mean40'][k:k+40]=mean
            assert np.max(abs((variants['known_moving_mean40'][k:k+40].T@h-d['u'][k:k+40].T@h)*1e6))<1e-5
    for name,inputs in variants.items():
        clone={**d,'u':contig(inputs)};case=describe(theta,clone)
        results.append({'case':name,**case,'unobservedHoldingWaveformHypothesis':name.startswith('hold_'),
                        'actualHoldingWaveformRecovered':False,'parametersChanged':False})
        scenario_inputs[(d['name'],name)]=clone['u']
    # Keep the model's exact simulated states; no measured-state injection.
    p=np.zeros(2);v=np.zeros(2);states=[];positions=[]
    for k,(u,h) in enumerate(zip(d['u'],d['dt'])):
        states.append((p.copy(),v.copy()));out=np.empty(4)
        assert newlib.model_one(contig(p),contig(v),contig(u),float(h),contig(theta),out)==1
        p=out[:2].copy();v=out[2:].copy();positions.append(p.copy())
    okay,baseline,n=rollout(theta,d);assert okay and np.max(abs(np.array(positions)-baseline))<1e-12
    local=[]
    for a,b in [(4000,8000),(10000,14000)]:
        for k in range(a,b,40):
            p0,v0=states[k];inputs=scenario_inputs[(d['name'],'known_moving_mean40')][k:k+40]
            pred=np.full((40,2),np.nan)
            assert newlib.model_rollout(40,contig(d['dt'][k:k+40]),contig(inputs),contig(p0),contig(v0),contig(theta),pred)==40
            local.append((pred[-1]-baseline[k+39])*1000)
    local=np.array(local)
    local_motion_checks.append({'record':d['name'],'blocks':len(local),'startState':'Frozen baseline simulated state, not measured reset',
                                'meanPositionEffectRMSE_mm':float(np.sqrt(np.mean(local.mean(axis=1)**2))),
                                'syncEffectRMSE_mm':float(np.sqrt(np.mean((local[:,0]-local[:,1])**2))),
                                'maximumAxisEndPositionEffect_mm':float(np.max(abs(local)))})
    print(json.dumps({'processed':d['name'],'cases':len(variants),'observedHoldStartAnchors':sum(a in anchors for _,a,b in blocks)}),flush=True)
for d in records:assert sha(d['raw'])==d['rawSHA256']
assert sha(frozen)==frozen_hash
serial_checks=[]
for d in records:
    name='hold_start_next_mean_quadratic'
    inputs=scenario_inputs[(d['name'],name)]
    serial_checks.append({'record':d['name'],'case':name,'inputs':inputs.tolist()})
with (HERE/'quadratic_input_hypotheses.json').open('x',encoding='utf-8') as f:json.dump(serial_checks,f,ensure_ascii=False,allow_nan=False)
out={'date':'2026-10-15','protocolSHA256':sha(HERE/'protocol.json'),'scriptSHA256':sha(__file__),
     'frozenParameters':str(frozen),'frozenParametersSHA256':frozen_hash,'parameters':theta.tolist(),
     'sourceHashes':source_checks,'cases':results,'holdingInputAudits':input_checks,
     'knownCommandAlignmentChecks':known_motion_checks,'localMovingInputAveragingChecks':local_motion_checks,
     'modelsRefitted':0,'modelStructuresChanged':0,'hypothesesNotMeasurements':True,'actualHoldingInputRecovered':False,
     'rawOrFirmwareChanged':False,'newHardwareRunReleased':False,
     'scopeLimit':'These scenarios are not exhaustive bounds on unknown holding waveforms; known-motion averaging test does not identify holding errors.'}
with (HERE/'analysis.json').open('x',encoding='utf-8') as f:json.dump(out,f,ensure_ascii=False,indent=2,allow_nan=False)
print(json.dumps({'frozenParametersSHA256':frozen_hash,'localMovingChecks':local_motion_checks,
                  'cases':[{k:v for k,v in c.items() if k not in ['nativeContinuousPosition_m','phaseErrors']} for c in results]},ensure_ascii=False))
