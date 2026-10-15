"""Audit hold-input reconstruction constraints; no parameters fitted to hypotheses."""
import csv,json
import numpy as np
from fit import HERE,PRIOR,load,sha,contig
import model as old
data=load();lib=old.library();params=json.loads((PRIOR/'model_parameters.json').read_text());z=np.array(params['parameters']);results=[]
for d in data:
    with open(d['raw'],encoding='utf-8-sig',newline='') as f:
        reader=csv.reader(f);next(reader);allrows=np.array([[float(x) for x in r] for r in reader])
    a=allrows[(allrows[:,63]==68012)&(allrows[:,21]==11)&(allrows[:,87]==6)]
    lookup={int(r[46])-1:r[13:15]*np.array([1,-1]) for r in a if r[2] in [3,5] and r[106]==1}
    decoded=json.loads(open(d['decoded'],encoding='utf-8').read());blocks=[]
    for n,row in enumerate(decoded['slow']):
        if n<100:continue
        start=8000+(n-100)*40 if n<150 else 14000+(n-150)*40
        assert start in lookup
        first=lookup[start];mean=np.array(row['command_integral_counts_us'])*np.array([1,-1])/row['dt_us'];blocks.append((start,first,mean))
    assert len(blocks)==200
    for kind in ['canonical_block_mean','known_first_then_constant','known_first_clipped_linear']:
        u=d['u'].copy();maxMeanDiff=0.;maxFirstDiff=0.;infeasible=[]
        for start,first,mean in blocks:
            if kind=='canonical_block_mean':
                maxFirstDiff=max(maxFirstDiff,float(max(abs(mean-first))));continue
            wave=np.zeros((40,2))
            for ch in range(2):
                if abs(40*mean[ch]-first[ch])>39*1200+1e-8:
                    infeasible.append(dict(start=start,axis=ch,first=float(first[ch]),mean=float(mean[ch])));wave[:,ch]=mean[ch];continue
                if kind=='known_first_then_constant':wave[0,ch]=first[ch];wave[1:,ch]=(40*mean[ch]-first[ch])/39
                else:
                    lo,hi=-1e6,1e6
                    for _ in range(70):
                        end=(lo+hi)/2;v=np.clip(np.linspace(first[ch],end,40),-1200,1200)
                        if v.mean()<mean[ch]:lo=end
                        else:hi=end
                    wave[:,ch]=np.clip(np.linspace(first[ch],(lo+hi)/2,40),-1200,1200)
            maxMeanDiff=max(maxMeanDiff,float(max(abs(wave.mean(axis=0)-mean))));maxFirstDiff=max(maxFirstDiff,float(max(abs(wave[0]-first))))
            u[start:start+40]=wave
        assert maxMeanDiff<1e-8
        if not infeasible and kind!='canonical_block_mean':assert maxFirstDiff<1e-8
        alternative=dict(d,u=contig(u));p=old.rollout(lib,z,alternative);assert p is not None
        results.append(dict(inputHypothesis=kind,maximumMeanDifference_counts=maxMeanDiff,maximumFirstCommandDifference_counts=maxFirstDiff,
            infeasibleBlocks=infeasible,**old.describe(p,d)))
    print(json.dumps([r for r in results if r['record']==d['name']]),flush=True)
out=dict(status='Input sensitivity only, not actual waveform recovery or model validation',results=results,
    physicalConstraint='All hypotheses retain each measured40ms command integral, observed first queued command where feasible, and1200count bound. Moving1ms inputs unchanged.',
    limitation='True hold waveform and individual control dt unknown; linear and constant-rest are hypotheses. No choosing reconstructed signals based on performance; canonical block mean remains baseline.',
    noParameterRefit=True,rawUnchanged=True,assistantHardwareAction=False,scriptSHA256=sha(__file__))
with (HERE/'input_audit.json').open('x',encoding='utf-8') as f:json.dump(out,f,ensure_ascii=False,indent=2)
print(sha(HERE/'input_audit.json'))
