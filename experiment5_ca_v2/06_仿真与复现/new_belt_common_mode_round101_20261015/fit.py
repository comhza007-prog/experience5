"""Common-mode elastic/viscous extension; old snapshots/models never overwritten."""
import ctypes,importlib.util,itertools,json,sys
from pathlib import Path
import numpy as np
HERE=Path(__file__).resolve().parent;ROOT=HERE.parents[1];PRIOR=HERE.parent/'new_belt_memory_model_round100_20261015'
sys.path.insert(0,str(PRIOR))
from model import load,sha,contig,describe,arr
def library():
    lib=ctypes.CDLL(str(HERE/'native_model.dll'));lib.model_rollout.argtypes=[ctypes.c_int,arr,arr,arr,arr,arr,arr];lib.model_rollout.restype=ctypes.c_int
    lib.model_memory_step.argtypes=[arr,arr,ctypes.c_double,arr,arr];lib.model_memory_step.restype=ctypes.c_int;return lib
def rollout(lib,z,d):
    out=np.full((20000,2),np.nan);n=lib.model_rollout(20000,d['dt'],d['u'],np.zeros(2),np.zeros(2),contig(z),out)
    return out if n==20000 else None
def main():
    data=load();source=PRIOR/'model_parameters.json';assert sha(source)=='a44665e79b254514302e0c39c3a3ebf288df7e684920e5dc2b76df49683ce486'
    base=json.loads(source.read_text());initial=np.array(base['parameters']);lib=library()
    # Locate error without using trajectory shape as an acceptance gate.
    phases=[];baselineTraces=json.loads((PRIOR/'comparison_traces.json').read_text())
    for d,t in zip(data,baselineTraces):
        p=np.array(t['nativePosition_m'])*1000;a=d['actual']*1000;ref=d['ref']*1000
        for phase,lo,hi in [(2,0,100),(3,100,150),(4,150,250),(5,250,400)]:
            pp=p[lo:hi].mean(axis=1);aa=a[lo:hi].mean(axis=1);rr=ref[lo:hi]
            phases.append(dict(record=d['name'],phase=phase,actualTrackingRMSE_mm=float(np.sqrt(np.mean((aa-rr)**2))),
                predictedTrackingRMSE_mm=float(np.sqrt(np.mean((pp-rr)**2))),meanPositionBias_mm=float(np.mean(pp-aa))))
    protocol=dict(status='Declared before extension fitting',sources=[{k:d[k] for k in ['name','raw','rawSHA256']} for d in data],
        motivation='R100 final hold mean-position bias opposite signs across records. Test passive common-mode elastic/viscous response, preserving differential coupling and memory friction.',
        addedLaw='Each axis receives Fc=Kcommon*mean(position)+Ccommon*mean(velocity), opposing motion/deflection about initial equilibrium. Kcommon,Ccommon>=0; matrices add0.5*coefficient*ones(2,2). No desired-trajectory feedback or per-run offsets.',
        physicalCaveat='Effective initial-equilibrium restoring hypothesis, not identified actual belt force. Inherited calibration means total model is not uniquely identified by four aggregate targets.',
        sourceModelSHA256=sha(source),primaryFreeParameters=['Kcommon','Ccommon'],fixedR100Parameters=base['parameterNames'],
        bounds=[[0,30],[0,100]],transform='log1p',gridPerAxis=17,localSeeds=6,maximumEvaluationsPerSeed=700,
        objective='Two final tracking/sync RMS relative errors divided0.15, equal record weights. Tiny1e-6 log-coordinate regularizer. No waveform objective or output correction.',
        criterion='Both records each tracking/sync<=15percent; waveform diagnostic only',oldRegimeDataUsed=0,bothRecordsCalibration=True,
        independentValidationRequired=True,firmwareChanged=False,assistantHardwareAction=False)
    with (HERE/'protocol.json').open('x',encoding='utf-8') as f:json.dump(protocol,f,ensure_ascii=False,indent=2)
    with (HERE/'phase_diagnosis.json').open('x',encoding='utf-8') as f:json.dump(phases,f,indent=2)
    lo=np.zeros(2);hi=np.log1p([30.,100.]);evaluations=[]
    def expand(x):return np.r_[initial,np.expm1(x)]
    def objective(x):
        z=expand(x);res=[]
        for d in data:
            p=rollout(lib,z,d)
            if p is None:value=1e20;break
            q=p[d['at']];m=np.array([np.sqrt(np.mean(((q.mean(axis=1)-d['ref'])*1000)**2)),np.sqrt(np.mean(((q[:,0]-q[:,1])*1000)**2))]);res.extend((m/d['targets']-1)/.15)
        else:value=float(np.mean(np.array(res)**2)+1e-6*np.mean((x/hi)**2))
        evaluations.append(dict(coordinates=x.tolist(),objective=value));return value
    grid=[]
    for a in np.linspace(0,hi[0],17):
        for b in np.linspace(0,hi[1],17):
            x=np.array([a,b]);grid.append((objective(x),x))
    seeds=[]
    for val,x in sorted(grid,key=lambda p:p[0]):
        if all(np.linalg.norm((x-y)/hi)>.1 for y in seeds):seeds.append(x.copy())
        if len(seeds)==6:break
    bound=lambda x:np.clip(x,lo,hi);fits=[]
    for seed_id,seed in enumerate(seeds):
        started=len(evaluations);points=np.vstack([seed,bound(seed+[.025,0]),bound(seed+[0,.025])]);values=np.array([objective(x) for x in points])
        for iteration in range(450):
            order=np.argsort(values,kind='stable');points=points[order];values=values[order]
            if len(evaluations)-started+5>700:break
            if np.max(abs(points[1:]-points[0]))<1e-7 and max(values)-min(values)<1e-12:break
            c=points[:-1].mean(axis=0);worst=points[-1].copy();xr=bound(2*c-worst);fr=objective(xr)
            if fr<values[0]:
                xe=bound(c+2*(xr-c));fe=objective(xe);points[-1],values[-1]=(xe,fe) if fe<fr else (xr,fr)
            elif fr<values[-2]:points[-1]=xr;values[-1]=fr
            else:
                outside=fr<values[-1];xc=bound(c+.5*((xr if outside else worst)-c));fc=objective(xc)
                if fc<(fr if outside else values[-1]):points[-1]=xc;values[-1]=fc
                else:
                    for j in range(1,3):points[j]=bound(points[0]+.5*(points[j]-points[0]));values[j]=objective(points[j])
        x=points[np.argmin(values)];z=expand(x);cases=[describe(rollout(lib,z,d),d) for d in data]
        fit=dict(seed=seed_id,parameters=z.tolist(),addedParameters=np.expm1(x).tolist(),objective=float(min(values)),evaluations=len(evaluations)-started,
            cases=cases,calibrationBothRecordsPassed=all(r['bothWithin15Percent'] for r in cases));fits.append(fit)
        print(json.dumps(dict(seed=seed_id,added=fit['addedParameters'],cases=cases)),flush=True)
    selected=min(fits,key=lambda f:f['objective']);out=dict(protocolSHA256=sha(HERE/'protocol.json'),sourceSHA256=sha(HERE/'native_model.c'),solverSHA256=sha(HERE/'native_model.dll'),
        selected=selected,fits=fits,evaluations=len(evaluations),allEvaluations=evaluations,bothRecordsCalibration=True,physicalModelValidated=False,
        oldSourcePreserved=sha(source)==protocol['sourceModelSHA256'],firmwareChanged=False,assistantHardwareAction=False)
    with (HERE/'fit_results.json').open('x',encoding='utf-8') as f:json.dump(out,f,ensure_ascii=False,indent=2)
    print(json.dumps(dict(resultsSHA256=sha(HERE/'fit_results.json'),selected=selected)),flush=True)
if __name__=='__main__':main()
