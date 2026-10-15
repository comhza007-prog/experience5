"""Derivative-free solver audit of the declared same reduced model/objective."""
import json
import numpy as np
from fit import HERE,PRIOR,OLD,ROOT,load,sha,library,rollout,describe,save
data=load();lib=library();sub=json.loads((HERE/'subspace.json').read_text());base=np.array(sub['anchor']);basis=np.array(sub['basis']);rank=basis.shape[1]
previous=json.loads((HERE/'comparison_summary.json').read_text());audit=previous['boundaryAndStability'];lo=np.array(audit['lower']);hi=np.array(audit['upper'])
for d in data:d['weights']=np.sqrt(np.diff(np.r_[0,np.cumsum(d['dt'])[d['idx']]]))/np.sqrt(2*sum(d['dt']))
save('solver_recovery_protocol.json',dict(reason='LM endpoints differ and 1percent perturbation refits stalled; tiny movement is NOT proof of stability. Use derivative-free solver for nonsmooth elastic-slider response.',
    previousSummarySHA256=sha(HERE/'comparison_summary.json'),sameBoundsSubspaceAnchorObjectiveAndPrior=True,
    search='Three starts: LMbest,zero,all0.05. Nelder-Mead each<=1600evaluations. Then two1percent observation/target perturbations each<=1000evaluations from selected. No extra seeds, stages or changed tolerances.',
    physicalParametersIdentified=False,firmwareChanged=False,assistantHardwareAction=False))
def expand(y):
    x=basis@y
    if np.any(x<lo-1e-12) or np.any(x>hi+1e-12):return None
    z=base*np.exp(np.where(np.arange(12)==8,0,x));z[8]=base[8]+.1*x[8];return z
def objective(y,perturb=0.):
    z=expand(y)
    if z is None:return 1e20
    value=.1*float(y@y)
    for d in data:
        p=rollout(lib,z,d)
        if p is None:return 1e20
        e=(p[d['idx']]-d['observed']*(1+perturb))*1000;w=d['weights'];q=p[d['at']]
        value+=float(np.sum((w*e.mean(axis=1)/.05)**2)+np.sum((w*(e[:,0]-e[:,1])/.05)**2))
        m=np.array([np.sqrt(np.mean(((q.mean(axis=1)-d['ref'])*1000)**2)),np.sqrt(np.mean(((q[:,0]-q[:,1])*1000)**2))])
        value+=float(12.5*np.sum(((m/(d['targets']*(1+perturb))-1)/.15)**2))
    return value
def nm(start,budget,perturb=0.):
    count=0
    def f(x):
        nonlocal count
        count+=1;return objective(x,perturb)
    points=np.vstack([start,*[start+np.eye(rank)[j]*.03 for j in range(rank)]]);values=np.array([f(p) for p in points])
    while count+rank+3<=budget:
        ix=np.argsort(values);points=points[ix];values=values[ix]
        if max(np.linalg.norm(points-points[0],axis=1))<1e-6:break
        c=points[:-1].mean(axis=0);worst=points[-1];xr=2*c-worst;fr=f(xr)
        if fr<values[0]:
            xe=c+2*(xr-c);fe=f(xe);points[-1],values[-1]=(xe,fe) if fe<fr else (xr,fr)
        elif fr<values[-2]:points[-1]=xr;values[-1]=fr
        else:
            outside=fr<values[-1];xc=c+.5*((xr if outside else worst)-c);fc=f(xc)
            if fc<(fr if outside else values[-1]):points[-1]=xc;values[-1]=fc
            else:
                for j in range(1,rank+1):points[j]=points[0]+.5*(points[j]-points[0]);values[j]=f(points[j])
    k=np.argmin(values);y=points[k];z=expand(y);assert z is not None
    result=dict(coordinates=y.tolist(),parameters=z.tolist(),objective=float(values[k]),evaluations=count,
        cases=[describe(rollout(lib,z,d),d) for d in data])
    print(json.dumps(dict(perturb=perturb,objective=result['objective'],cases=result['cases'])),flush=True)
    return result
selected=min([f for f in previous['allFits'] if 'objective' in f],key=lambda f:f['objective'])
fits=[nm(np.array(s),1600) for s in [selected['coordinates'],np.zeros(rank),np.full(rank,.05)]]
best=min([selected,*fits],key=lambda f:f['objective']);y=np.array(best['coordinates']);z=np.array(best['parameters'])
perturbs=[nm(y,1000,p) for p in [-.01,.01]]
for p in perturbs:
    zz=np.array(p['parameters']);p['maxPositiveCoefficientChange_percent']=float(max(abs(zz[np.arange(12)!=8]/z[np.arange(12)!=8]-1))*100)
    p['etaAbsoluteChange']=float(abs(zz[8]-z[8]))
cases=[describe(rollout(lib,z,d),d) for d in data]
for c in cases:c['bothWithin20Percent']=max(abs(c['trackingDifference_percent']),abs(c['syncDifference_percent']))<=20
save('solver_recovery_results.json',dict(selected=best,allFits=fits,perturbations=perturbs,cases=cases,
    exactBoundsSatisfied=expand(y) is not None,protocolSHA256=sha(HERE/'solver_recovery_protocol.json'),scriptSHA256=sha(__file__),
    priorLMResultsPreserved=True,sourceHashes=previous['sourceHashes'],physicalModelValidated=False,independentValidationPassed=False,
    conclusion='Bound enforcement repaired. Reduced fitting regularized; multistart and perturbation differences reported, not claimed resolved by smaller singular condition alone.'))
