"""Final bounded minimax aggregate-margin polish; no acceptance relaxation."""
import itertools,json
import numpy as np
from fit import HERE,load,sha,library,rollout,contig,describe
data=load();lib=library();source=json.loads((HERE/'refine_results.json').read_text());initial=np.array(source['selected']['parameters']);radius=.1
protocol=dict(status='Declared before final bounded aggregate-margin polish',sourceSHA256=sha(HERE/'refine_results.json'),
    reason='Three of four aggregate checks already pass; remaining sync error18.44percent. Match original max15percent criterion rather than merely average squared error.',
    modalCoordinates=['commonDriveLogGain','differentialDriveLogGain','differentialSpringLogScale','sharedYieldLogScale'],radiusLog=.1,
    rule='gL*=exp(common+0.5diff),gR*=exp(common-0.5diff),Kdiff*=exp(spring),Y*=exp(yield); all other refined coefficients fixed.',
    objective='Maximum absolute continuous-RMS relative error over two records/two metrics plus tiny1e-5 normalized-coordinate regularizer. Full snapshot waveform loss may not worsen by more20percent; guard is fit regularization, not a new acceptance demand.',
    budget='81grid points,3separatedseeds,each<=700evaluations/450iterations; no further refinement after this budget.',
    acceptance='Original rounded-statistics both15percent for both calibration records, unchanged. No independent physical validation from this exercise.',
    bothRecordsCalibration=True,outputCorrection=False,firmwareChanged=False,assistantHardwareAction=False)
with (HERE/'polish_protocol.json').open('x',encoding='utf-8') as f:json.dump(protocol,f,indent=2)
for d in data:d['weights']=np.sqrt(np.diff(np.r_[0,np.cumsum(d['dt'])[d['idx']]]))/np.sqrt(sum(d['dt']))
def expand(x):
    z=initial.copy();z[0]*=np.exp(x[0]+.5*x[1]);z[1]*=np.exp(x[0]-.5*x[1]);z[4]*=np.exp(x[2]);z[11]*=np.exp(x[3]);return z
def compute(z):
    errors=[];wave=[]
    for d in data:
        p=rollout(lib,z,d)
        if p is None:return None,None
        q=p[d['at']];m=np.array([np.sqrt(np.mean(((q.mean(axis=1)-d['ref'])*1000)**2)),np.sqrt(np.mean(((q[:,0]-q[:,1])*1000)**2))]);errors.extend(m/d['targets']-1)
        e=(p[d['idx']]-d['observed'])*1000;w=d['weights'];wave.append(float(np.sum((w*e.mean(axis=1)/.05)**2)+np.sum((w*(e[:,0]-e[:,1])/.05)**2)))
    return np.array(errors),float(np.mean(wave))
baselineErrors,baselineWave=compute(initial);evaluations=[]
def objective(x):
    errors,wave=compute(expand(x));value=1e20 if errors is None else float(max(abs(errors))+1e-5*np.mean((x/radius)**2)+100*max(0,wave/baselineWave-1.2)**2)
    evaluations.append(dict(coordinates=x.tolist(),objective=value,errors=None if errors is None else errors.tolist(),waveformLoss=wave));return value
grid=[]
for x in itertools.product([-radius,0,radius],repeat=4):
    x=np.array(x);grid.append((objective(x),x))
seeds=[]
for value,x in sorted(grid,key=lambda p:p[0]):
    if all(np.linalg.norm(x-y)>.05 for y in seeds):seeds.append(x.copy())
    if len(seeds)==3:break
bound=lambda x:np.clip(x,-radius,radius);fits=[]
for seed_id,seed in enumerate(seeds):
    start=len(evaluations);points=np.vstack([seed,*[bound(seed+np.eye(4)[k]*(-.01 if seed[k]>=.09 else .01)) for k in range(4)]]);values=np.array([objective(x) for x in points])
    for iteration in range(450):
        order=np.argsort(values,kind='stable');points=points[order];values=values[order]
        if len(evaluations)-start+7>700:break
        if np.max(abs(points[1:]-points[0]))<1e-7 and max(values)-min(values)<1e-10:break
        c=points[:-1].mean(axis=0);worst=points[-1].copy();xr=bound(2*c-worst);fr=objective(xr)
        if fr<values[0]:
            xe=bound(c+2*(xr-c));fe=objective(xe);points[-1],values[-1]=(xe,fe) if fe<fr else (xr,fr)
        elif fr<values[-2]:points[-1]=xr;values[-1]=fr
        else:
            outside=fr<values[-1];xc=bound(c+.5*((xr if outside else worst)-c));fc=objective(xc)
            if fc<(fr if outside else values[-1]):points[-1]=xc;values[-1]=fc
            else:
                for k in range(1,5):points[k]=bound(points[0]+.5*(points[k]-points[0]));values[k]=objective(points[k])
    x=points[np.argmin(values)];z=expand(x);errors,wave=compute(z);cases=[describe(rollout(lib,z,d),d) for d in data]
    f=dict(seed=seed_id,parameters=z.tolist(),coordinates=x.tolist(),objective=float(min(values)),maximumRelativeError=float(max(abs(errors))),waveformLoss=wave,
        waveformGuardPassed=bool(wave<=1.2*baselineWave),cases=cases,evaluations=len(evaluations)-start,calibrationBothRecordsPassed=all(c['bothWithin15Percent'] for c in cases));fits.append(f)
    print(json.dumps(dict(seed=seed_id,cases=cases,maximumRelativeError=f['maximumRelativeError'])),flush=True)
eligible=[f for f in fits if f['calibrationBothRecordsPassed'] and f['waveformGuardPassed']];best=min(eligible or fits,key=lambda f:f['objective'])
out=dict(protocolSHA256=sha(HERE/'polish_protocol.json'),scriptSHA256=sha(__file__),baselineErrors=baselineErrors.tolist(),baselineWaveformLoss=baselineWave,
    selected=best,fits=fits,evaluations=len(evaluations),allEvaluations=evaluations,bothRecordsCalibration=True,physicalModelValidated=False,
    independentValidationRequired=True,firmwareChanged=False,assistantHardwareAction=False)
with (HERE/'polish_results.json').open('x',encoding='utf-8') as f:json.dump(out,f,ensure_ascii=False,indent=2)
print(json.dumps(dict(resultsSHA256=sha(HERE/'polish_results.json'),selected=best)),flush=True)
