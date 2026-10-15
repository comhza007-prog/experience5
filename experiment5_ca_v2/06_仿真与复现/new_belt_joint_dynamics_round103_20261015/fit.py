"""Reidentify inherited coefficients on new-belt snapshots, retaining memory law."""
import importlib.util,json,sys,time
from pathlib import Path
import numpy as np
HERE=Path(__file__).resolve().parent;ROOT=HERE.parents[1];PRIOR=HERE.parent/'new_belt_memory_model_round100_20261015'
sys.path.insert(0,str(PRIOR))
from model import load,sha,library,rollout,contig,describe
def main():
    data=load();source=PRIOR/'model_parameters.json';assert sha(source)=='a44665e79b254514302e0c39c3a3ebf288df7e684920e5dc2b76df49683ce486'
    model=json.loads(source.read_text());initial=np.array(model['parameters']);lib=library()
    for d in data:d['weights']=np.sqrt(np.diff(np.r_[0,np.cumsum(d['dt'])[d['idx']]]))/np.sqrt(sum(d['dt']))
    lo=np.full(12,np.log(.05));hi=np.full(12,np.log(20.));hi[3]=np.log(1000.)
    lo[8]=(-.95-initial[8])/.1;hi[8]=(.95-initial[8])/.1
    protocol=dict(status='Declared before new-belt joint dynamics calibration',authorization='User requests continuing model improvement and confirms same belt specifications/pulleys/ratio, tighter tension. Keep encoder conversion unchanged.',
        sources=[{k:d[k] for k in ['name','raw','rawSHA256','decoded','decodedSHA256']} for d in data],
        modelStructure='R100 elastic-slider memory unchanged. No common-centering or speed-weakening terms adopted because bounded tests did not improve fixed-base fit.',
        rationale='Earlier memory fit inherited most kinetic/inertial coefficients from nominal old-regime model. Reidentify them jointly using new-regime time-resolved responses; nominal coefficients are starting values, not assumed truth.',
        parameters=model['parameterNames'],parameterization='Positive parameters=initial*exp(x). eta=initialEta+0.1*xEta, bounded[-0.95,0.95].',
        factorBounds=[.05,20.],rightDampingFactorUpperBound=1000,
        calibrationObjective='Equal-record time-weighted mean-position and differential-position residuals scaled0.05mm each, plus final tracking/sync RMS relative residuals scaled0.15. Tiny1e-3 normalized-coordinate regularizer. Full snapshots used for identification, not a waveform acceptance gate.',
        acceptance='Only final aggregate trackingRMSE and syncRMS relative error both<=15percent for both calibration records; future independent capture required.',
        initialization='Zero positions/velocities/unstrained memory once. Recorded inputs only. No per-run offsets/scales, desired-trajectory force or measured-state/current injection.',
        search='Three declared bounded Nelder-Mead seeds, each<=1800evaluations/1250iterations. Seed0R100,seed1eta0,seed2doublekineticfriction. No additional seeds or bound widening this round.',
        inputLimitations='Moving1ms commands known; holding40ms command integrals represented by means. Parameter nonuniqueness remains possible under closed-loop inputs and only two trajectories.',
        bothRecordsDevelopment=True,oldRecordsInObjective=0,independentValidationRequired=True,firmwareChanged=False,assistantHardwareAction=False)
    with (HERE/'protocol.json').open('x',encoding='utf-8') as f:json.dump(protocol,f,ensure_ascii=False,indent=2)
    def expand(x):
        z=initial*np.exp(np.where(np.arange(12)==8,0,x));z[8]=initial[8]+.1*x[8];return z
    def loss(z):
        values=[]
        for d in data:
            p=rollout(lib,z,d)
            if p is None:return 1e20,None
            e=(p[d['idx']]-d['observed'])*1000;w=d['weights'];value=float(np.sum((w*e.mean(axis=1)/.05)**2)+np.sum((w*(e[:,0]-e[:,1])/.05)**2))
            q=p[d['at']];m=np.array([np.sqrt(np.mean(((q.mean(axis=1)-d['ref'])*1000)**2)),np.sqrt(np.mean(((q[:,0]-q[:,1])*1000)**2))]);value+=float(np.sum(((m/d['targets']-1)/.15)**2));values.append(value)
        return float(np.mean(values)),values
    zero=np.zeros(12);inertia=zero.copy();inertia[8]=-initial[8]/.1;friction=zero.copy();friction[6:8]=np.log(2.)
    fits=[];evaluations=[];starttime=time.time()
    for seed_id,seed in enumerate([zero,inertia,friction]):
        start=len(evaluations)
        def objective(x):
            raw,per=loss(expand(x));regularizer=.001*float(np.mean((x/(hi-lo))**2));value=raw+regularizer
            evaluations.append(dict(seed=seed_id,coordinates=x.tolist(),dataLoss=raw,objective=value));return value
        bound=lambda x:np.clip(x,lo,hi);points=np.vstack([seed,*[bound(seed+np.eye(12)[j]*.1) for j in range(12)]]);values=np.array([objective(x) for x in points])
        for iteration in range(1250):
            order=np.argsort(values,kind='stable');points=points[order];values=values[order]
            if len(evaluations)-start+15>1800:break
            if np.max(abs(points[1:]-points[0]))<1e-6 and max(values)-min(values)<1e-9:break
            c=points[:-1].mean(axis=0);worst=points[-1].copy();xr=bound(2*c-worst);fr=objective(xr)
            if fr<values[0]:
                xe=bound(c+2*(xr-c));fe=objective(xe);points[-1],values[-1]=(xe,fe) if fe<fr else (xr,fr)
            elif fr<values[-2]:points[-1]=xr;values[-1]=fr
            else:
                outside=fr<values[-1];xc=bound(c+.5*((xr if outside else worst)-c));fc=objective(xc)
                if fc<(fr if outside else values[-1]):points[-1]=xc;values[-1]=fc
                else:
                    for j in range(1,13):points[j]=bound(points[0]+.5*(points[j]-points[0]));values[j]=objective(points[j])
            if iteration%250==0:print(json.dumps(dict(seed=seed_id,iteration=iteration,loss=float(min(values)),evaluations=len(evaluations)-start,seconds=time.time()-starttime)),flush=True)
        x=points[np.argmin(values)];z=expand(x);cases=[describe(rollout(lib,z,d),d) for d in data];raw,per=loss(z)
        fits.append(dict(seed=seed_id,parameters=z.tolist(),coordinates=x.tolist(),objective=float(min(values)),dataLoss=raw,perRecordLoss=per,
            evaluations=len(evaluations)-start,cases=cases,calibrationBothRecordsPassed=all(r['bothWithin15Percent'] for r in cases)))
        print(json.dumps(dict(seed=seed_id,cases=cases)),flush=True)
    eligible=[f for f in fits if f['calibrationBothRecordsPassed']];best=min(eligible or fits,key=lambda f:f['objective'])
    out=dict(protocolSHA256=sha(HERE/'protocol.json'),scriptSHA256=sha(__file__),sourceModelSHA256=sha(source),
        solverSHA256=sha(PRIOR/'native_model.dll'),initialDataLoss=loss(initial)[0],selected=best,fits=fits,evaluations=len(evaluations),allEvaluations=evaluations,
        bothRecordsCalibration=True,physicalModelValidated=False,firmwareChanged=False,assistantHardwareAction=False)
    for d in data:assert sha(d['raw'])==d['rawSHA256']
    with (HERE/'fit_results.json').open('x',encoding='utf-8') as f:json.dump(out,f,ensure_ascii=False,indent=2)
    print(json.dumps(dict(resultsSHA256=sha(HERE/'fit_results.json'),selected=best)),flush=True)
if __name__=='__main__':main()
