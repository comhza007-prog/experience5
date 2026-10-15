"""Third and final bounded two-parameter new-belt family: damping and stiffness."""
import json
import numpy as np
from calibrate import HERE,sha,setup,rollout,describe
d,r,source,base,lib=setup();initial=np.array(base['parameters'])
protocol=dict(status='Declared before alternative-family fit',calibrationSourceSHA256=d['sourceSHA256'],oldObservationsInObjective=0,
    motivation='Gain-only and friction-only families failed. Test added symmetric viscous resistance and elastic coupling without inheriting fitted parameters from either failed family. Final family in this bounded round.',
    freeParameters=['addedCommonDamping','elasticStiffnessMultiplier'],rule='Add the same nonnegative viscous coefficient to both axes and scale reciprocal elastic stiffness. Other9 nominal coefficients fixed; no prior family coefficients inherited.',
    fixedGains=initial[:2].tolist(),addedDampingRange=[0,199],stiffnessMultiplierRange=[.02,50],logGridPerAxis=17,seeds=8,maximumEvaluationsPerSeed=600,
    objective='Same two final continuous RMS relative residuals and1e-6 log-deviation tie breaker. No waveform objective or output correction.',
    interpretation='Conditional effective damping/stiffness fit, not identified belt material parameters or proof of hardware fault. All three families retained.',
    independentValidationRequired=True,MCUFirmwareChanged=False,assistantHardwareAction=False)
with (HERE/'damping_protocol.json').open('x',encoding='utf-8') as f:json.dump(protocol,f,indent=2)
lo=np.array([0.,np.log(.02)]);hi=np.array([np.log(200.),np.log(50.)]);evaluations=[]
def expand(x):
    z=initial.copy();z[[2,3]]+=np.expm1(x[0]);z[4]*=np.exp(x[1]);return z
def objective(x):
    p=rollout(lib,expand(x),r)
    if p is None:value=1e12;metrics=None
    else:
        q=p[r['at']];metrics=np.array([np.sqrt(np.mean(((q.mean(axis=1)-r['ref'])*1000)**2)),np.sqrt(np.mean(((q[:,0]-q[:,1])*1000)**2))])
        value=float(np.sum((metrics/r['targets']-1)**2)+1e-6*np.mean(x*x))
    evaluations.append(dict(logMultipliers=x.tolist(),objective=value,metrics_mm=None if metrics is None else metrics.tolist()));return value
grid=[]
for a in np.linspace(lo[0],hi[0],17):
    for b in np.linspace(lo[1],hi[1],17):
        x=np.array([a,b]);grid.append((objective(x),x))
seeds=[]
for value,x in sorted(grid,key=lambda p:p[0]):
    if all(np.linalg.norm(x-y)>.25 for y in seeds):seeds.append(x.copy())
    if len(seeds)==8:break
bound=lambda x:np.clip(x,lo,hi);fits=[]
for j,seed in enumerate(seeds):
    start=len(evaluations);points=np.vstack([seed,bound(seed+np.array([.025,0])),bound(seed+np.array([0,.025]))]);values=np.array([objective(x) for x in points])
    for iteration in range(400):
        order=np.argsort(values,kind='stable');points=points[order];values=values[order]
        if len(evaluations)-start+5>600:break
        if np.max(abs(points[1:]-points[0]))<1e-7 and max(values)-min(values)<1e-12:break
        c=points[:-1].mean(axis=0);worst=points[-1].copy();xr=bound(2*c-worst);fr=objective(xr)
        if fr<values[0]:
            xe=bound(c+2*(xr-c));fe=objective(xe);points[-1],values[-1]=(xe,fe) if fe<fr else (xr,fr)
        elif fr<values[-2]:points[-1]=xr;values[-1]=fr
        else:
            outside=fr<values[-1];xc=bound(c+.5*((xr if outside else worst)-c));fc=objective(xc)
            if fc<(fr if outside else values[-1]):points[-1]=xc;values[-1]=fc
            else:
                for k in range(1,3):points[k]=bound(points[0]+.5*(points[k]-points[0]));values[k]=objective(points[k])
    x=points[np.argmin(values)];z=expand(x);result=describe(rollout(lib,z,r),r)
    fit=dict(seed=j,parameters=z.tolist(),addedCommonDamping=float(np.expm1(x[0])),stiffnessMultiplier=float(np.exp(x[1])),objective=float(min(values)),evaluations=len(evaluations)-start,calibration=result);fits.append(fit)
    print(json.dumps(dict(seed=j,damping=fit['addedCommonDamping'],stiffnessMultiplier=fit['stiffnessMultiplier'],calibration=result)),flush=True)
best=min(fits,key=lambda f:f['objective']);fixed=[0,1,5,6,7,8,9,10];assert np.array_equal(np.array(best['parameters'])[fixed],initial[fixed])
out=dict(status='New-belt damping/stiffness-family calibration only',protocolSHA256=sha(HERE/'damping_protocol.json'),scriptSHA256=sha(__file__),
    selected=best,fits=fits,evaluations=len(evaluations),allEvaluations=evaluations,run010UsedForCalibration=True,
    oldObservationsUsedForFit=False,physicalFrictionIdentified=False,independentModelValidated=False,firmwareChanged=False,assistantHardwareAction=False)
assert sha(d['source'])==d['sourceSHA256']
with (HERE/'damping_results.json').open('x',encoding='utf-8') as f:json.dump(out,f,ensure_ascii=False,indent=2)
print(json.dumps(dict(resultsSHA256=sha(HERE/'damping_results.json'),selected=best)),flush=True)
