"""Alternative coarse-input hypotheses, not recovered waveforms or new fits."""
import json
import numpy as np
from predict import HERE,ROOT,load_records,library,rollout,describe,contig,sha
manifest,records=load_records();spec=manifest['registry'][0];model=json.loads(__import__('pathlib').Path(spec['file']).read_text());lib=library(ROOT/model['solverRelativeToProject']);out=[]
for d in records:
    for kind in ['block_mean','linear_to_known_endpoint','two_halves_to_known_endpoint']:
        u=d['u'].copy();maxdiff=0.;clipped=0
        if kind!='block_mean':
            for r in d['decoded']['coarse']:
                n=r['interval_steps'];start=r['first_step'];mean=np.array(r['command_integral_counts_us'])*np.array([1,-1])/r['dt_us'];end=np.array(r['command_counts'])*np.array([1,-1])
                if kind=='linear_to_known_endpoint':wave=np.linspace(2*mean-end,end,n)
                else:wave=np.vstack([np.tile(2*mean-end,(n//2,1)),np.tile(end,(n-n//2,1))])
                if np.max(abs(wave))>1200:clipped+=1;continue
                maxdiff=max(maxdiff,float(np.max(abs(wave.mean(axis=0)-mean))));u[start:start+n]=wave
        p=rollout(lib,model['parameters'],d,contig(u));assert p is not None
        out.append(dict(hypothesis=kind,maximumMeanDifference_counts=maxdiff,overLimitBlocksLeftAsMean=clipped,**describe(p,d)))
result=dict(status='Input reconstruction sensitivity only; alternatives are not observed actual commands',results=out,
            limitation='No model fitting or output correction. Coarse endpoint and integral constrain but do not determine intervening commands. Constant means remain canonical baseline.',
            scriptSHA256=sha(__file__))
with (HERE/'input_sensitivity.json').open('x',encoding='utf-8') as f:json.dump(result,f,indent=2)
print(json.dumps([{k:r[k] for k in ['record','hypothesis','predictedTrackingRMSE_mm','predictedSyncRMS_mm','overLimitBlocksLeftAsMean']} for r in out],indent=2))
