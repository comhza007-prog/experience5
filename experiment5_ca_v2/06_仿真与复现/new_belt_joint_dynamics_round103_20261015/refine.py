"""Bounded finite-difference LM refinement; aggregate priorities explicit, no bound expansion."""
import json
import numpy as np
from fit import HERE,PRIOR,load,sha,library,rollout,contig,describe
data=load();lib=library();source=json.loads((PRIOR/'model_parameters.json').read_text());initial=np.array(source['parameters'])
stage=json.loads((HERE/'fit_results.json').read_text());lo=np.full(12,np.log(.05));hi=np.full(12,np.log(20.));hi[3]=np.log(1000.)
lo[8]=(-.95-initial[8])/.1;hi[8]=(.95-initial[8])/.1
for d in data:d['weights']=np.sqrt(np.diff(np.r_[0,np.cumsum(d['dt'])[d['idx']]]))/np.sqrt(sum(d['dt']))
protocol=dict(status='Declared before final solver refinement',stageResultsSHA256=sha(HERE/'fit_results.json'),
    optimizer='Finite-difference damped Gauss-Newton/LM, existing3seed endpoints only. Maximum100iterations/2000functionevaluations each. Existing bounds unchanged; normalized trial step max0.25 per coordinate.',
    objective='Time-weighted full-snapshot mean and differential errors /0.05mm plus aggregate relative RMS errors /0.15 weighted5. Aggregate term weight increased to match user priority; this is development, not independent evidence.',
    finiteDifferenceLogStep=.002,aggregateResidualWeight=5,physicalParametersUniquelyIdentified=False,
    acceptance='Both records each rounded-statistics tracking/sync within15percent; independent future validation required.',
    noWaveformAcceptanceGate=True,bothRecordsCalibration=True,noNewSeedsOrBounds=True,firmwareChanged=False,assistantHardwareAction=False)
with (HERE/'refine_protocol.json').open('x',encoding='utf-8') as f:json.dump(protocol,f,indent=2)
def expand(x):
    z=initial*np.exp(np.where(np.arange(12)==8,0,x));z[8]=initial[8]+.1*x[8];return z
count=0
def residual(x):
    global count
    count+=1;z=expand(x);blocks=[]
    for d in data:
        p=rollout(lib,z,d)
        if p is None:return None
        e=(p[d['idx']]-d['observed'])*1000;w=d['weights']/np.sqrt(2)
        blocks.extend([w*e.mean(axis=1)/.05,w*(e[:,0]-e[:,1])/.05])
        q=p[d['at']];m=np.array([np.sqrt(np.mean(((q.mean(axis=1)-d['ref'])*1000)**2)),np.sqrt(np.mean(((q[:,0]-q[:,1])*1000)**2))]);blocks.append(5/np.sqrt(2)*(m/d['targets']-1)/.15)
    blocks.append(np.sqrt(.001/12)*x/(hi-lo));return np.r_[*blocks]
fits=[]
for seed in stage['fits']:
    start=count;x=np.array(seed['coordinates']);r=residual(x);loss=float(r@r);initialLoss=loss;damping=.01;history=[]
    for iteration in range(100):
        if count-start+30>2000:break
        J=np.empty((len(r),12))
        for k in range(12):
            step=.002;xp=x.copy();xp[k]=min(hi[k],x[k]+step)
            if xp[k]==x[k]:xp[k]=max(lo[k],x[k]-step)
            rp=residual(xp)
            J[:,k]=(rp-r)/(xp[k]-x[k]) if rp is not None else 0
        H=J.T@J;g=J.T@r;diag=np.maximum(np.diag(H),1e-8);accepted=False
        for attempt in range(5):
            try:delta=np.linalg.solve(H+damping*np.diag(diag),-g)
            except np.linalg.LinAlgError:damping*=10;continue
            delta=np.clip(delta,-.25,.25);trial=np.clip(x+delta,lo,hi);rt=residual(trial);value=1e30 if rt is None else float(rt@rt)
            if value<loss-1e-10:
                improvement=loss-value;x=trial;r=rt;loss=value;damping=max(damping/3,1e-8);accepted=True;break
            damping=min(damping*10,1e12)
        history.append(dict(iteration=iteration,loss=loss,damping=damping,accepted=accepted,evaluations=count-start))
        if iteration%20==0:print(json.dumps(dict(seed=seed['seed'],**history[-1])),flush=True)
        if not accepted and damping>=1e10:break
    z=expand(x);cases=[describe(rollout(lib,z,d),d) for d in data]
    f=dict(seed=seed['seed'],coordinates=x.tolist(),parameters=z.tolist(),initialLoss=initialLoss,objective=loss,evaluations=count-start,history=history,
        cases=cases,calibrationBothRecordsPassed=all(c['bothWithin15Percent'] for c in cases));fits.append(f);print(json.dumps(dict(seed=f['seed'],cases=cases)),flush=True)
eligible=[f for f in fits if f['calibrationBothRecordsPassed']];best=min(eligible or fits,key=lambda f:f['objective'])
out=dict(protocolSHA256=sha(HERE/'refine_protocol.json'),scriptSHA256=sha(__file__),selected=best,fits=fits,evaluations=count,
    bothRecordsCalibration=True,oldFrozenFailuresPreserved=True,physicalModelValidated=False,firmwareChanged=False,assistantHardwareAction=False)
with (HERE/'refine_results.json').open('x',encoding='utf-8') as f:json.dump(out,f,ensure_ascii=False,indent=2)
print(json.dumps(dict(resultsSHA256=sha(HERE/'refine_results.json'),selected=best)),flush=True)
