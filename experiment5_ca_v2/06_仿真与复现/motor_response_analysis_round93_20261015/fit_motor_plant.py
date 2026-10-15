"""Bounded offline cumulative refit, with and without independently fitted drive lag."""
import csv,importlib.util,json,time
import numpy as np
from predict import HERE,ROOT,sha,contig,library,load_records,rollout,describe
OLD=ROOT/'06_仿真与复现/cumulative_micro_round90_20261015'
source=OLD/'model_parameters.json';model=json.loads(source.read_text(encoding='utf-8'))
manifest,new=load_records();lib=library(ROOT/model['solverRelativeToProject'])
spec=importlib.util.spec_from_file_location('old_calibration_core',OLD/'calibration_core.py');oldcore=importlib.util.module_from_spec(spec);spec.loader.exec_module(oldcore)
old=oldcore.load_records()
for d in old:
    d['actual']=d['active'][:,5:7];d['ref']=d['active'][:,3]
# Retain the previous negative run07 as calibration, rather than removing it.
path=ROOT/'06_仿真与复现/q2_multimodel_check_round91_20261015/capture_analysis.json'
decoded=json.loads(path.read_text(encoding='utf-8'));raw=Path=__import__('pathlib').Path(decoded['source'])
assert sha(raw)==decoded['sourceSHA256']
with raw.open(newline='',encoding='utf-8-sig') as f:
    rd=csv.reader(f);next(rd);rows=np.array([[float(x) for x in r] for r in rd])
active=rows[(rows[:,106]==1)&(rows[:,2]>=2)&(rows[:,2]<=5)];dt=[];u=[];idx=[];obs=[];sign=np.array([1.,-1.]);pitch=decoded['header']['configured_meters_per_count']
for mode,a,b in [('slow',0,100),('fast',0,4000),('slow',100,150),('fast',4000,8000),('slow',150,300)]:
    for r in decoded[mode][a:b]:
        n=40 if mode=='slow' else 1;dt.extend([r['dt_us']/n/1e6]*n)
        v=np.array(r['command_integral_counts_us'] if mode=='slow' else r['command_counts'])*sign
        if mode=='slow':v=v/r['dt_us']
        u.extend([v]*n);idx.append(len(dt)-1);obs.append(np.array(r['encoder'])*sign*pitch)
actual=active[:,5:7];ref=active[:,3];targets=np.array([np.sqrt(np.mean(((actual.mean(axis=1)-ref)*1000)**2)),np.sqrt(np.mean(((actual[:,0]-actual[:,1])*1000)**2))])
old.append(dict(name='Q2_run07',dt=contig(dt),u=contig(u),idx=np.array(idx),observed=np.array(obs),at=active[:,46].astype(int)-2,
                actual=actual,ref=ref,targets=targets,pitch=pitch,raw=str(raw),rawSHA256=sha(raw),decoded=str(path),decodedSHA256=sha(path)))
records=old+new;block=json.loads((HERE/'motor_block_parameters.json').read_text());motor=[a['selected'] for a in block['axes']]
def filter_input(d):
    out=np.zeros_like(d['u'])
    for ch,m in enumerate(motor):
        state=0.;delay=m['delay_steps']
        for k,h in enumerate(d['dt']):
            command=d['u'][k-delay,ch] if k>=delay else 0.
            a=np.exp(-h/m['tau_s']) if m['tau_s'] else 0.
            state=a*state+(1-a)*command
            out[k,ch]=m['gain']*state
    return contig(out)
for d in records:d['motor_u']=filter_input(d);d['weights']=np.sqrt(np.diff(np.r_[0,np.cumsum(d['dt'])[d['idx']]]))/np.sqrt(sum(d['dt']))
initial=np.array(model['parameters']);ids=np.array([0,1,6,7,9,10]);radius=np.abs(initial[ids])*.25
protocol=dict(status='Declared before plant fitting',recordNames=[d['name'] for d in records],
    preFitPredictionSHA256=sha(HERE/'frozen_predictions.json'),sourceModelSHA256=sha(source),motorParametersSHA256=sha(HERE/'motor_block_parameters.json'),
    schemes=['static_refit_control','motor_refit_candidate'],freeIndices=ids.tolist(),relativeRadius=.25,fixedIndices=[2,3,4,5,8],
    maximumEvaluationsPerScheme=900,maximumIterations=650,initialStep=.1,
    objective='Equal record weights across all12 records. Time weighted mean-position and differential waveform errors scaled0.05mm each plus native tracking/sync relative RMS differences scaled0.1, local drift penalty0.25*mean(x^2).',
    limitations='All five M1 records plus seven old tight-mechanics records are calibration. Motor tau10ms selected at grid upper boundary, not a precisely identified physical time constant. Coarse block means retained. Current sensor offset not interpreted as torque.',
    candidateEligibility='Average data loss lower than unchangedR90 and new-M1 average data loss lower; any per-record deterioration reported. This only releases one exploratory manual test, not model validation.',
    prospectiveScreen=dict(trackingAbsoluteRelativeError=.15,syncAbsoluteRelativeError=.15,waveformHardGate=False),
    assistantHardwareAction=False,firmwareChanged=False)
with (HERE/'plant_fit_protocol.json').open('x',encoding='utf-8') as f:json.dump(protocol,f,indent=2)
def loss(z,motor_on):
    total=[]
    for d in records:
        p=rollout(lib,z,d,d['motor_u'] if motor_on else d['u'])
        if p is None:return 1e30,None
        e=(p[d['idx']]-d['observed'])*1000;w=d['weights']
        v=float(np.sum((w*e.mean(axis=1)/.05)**2)+np.sum((w*(e[:,0]-e[:,1])/.05)**2))
        q=p[d['at']];metrics=np.array([np.sqrt(np.mean(((q.mean(axis=1)-d['ref'])*1000)**2)),np.sqrt(np.mean(((q[:,0]-q[:,1])*1000)**2))])
        v+=float(np.sum(((metrics/d['targets']-1)/.1)**2));total.append(v)
    return float(np.mean(total)),total
def optimize(motor_on):
    center=initial.copy()
    if motor_on:center[:2]/=np.array([m['gain'] for m in motor])
    r=np.abs(center[ids])*.25;ev=0;history=[];started=time.time()
    def expand(x):
        z=center.copy();z[ids]+=r*x;return z
    def fun(x):
        nonlocal ev
        ev+=1;v,_=loss(expand(x),motor_on);return v+.25*float(np.mean(x*x))
    bound=lambda x:np.clip(x,-1,1)
    points=np.vstack([np.zeros(6),np.eye(6)*.1]);values=np.array([fun(x) for x in points])
    for iteration in range(650):
        order=np.argsort(values,kind='stable');points=points[order];values=values[order]
        if ev+9>900:break
        if np.max(abs(points[1:]-points[0]))<1e-6 and max(values)-min(values)<1e-9:break
        c=points[:-1].mean(axis=0);worst=points[-1].copy();xr=bound(2*c-worst);fr=fun(xr)
        if fr<values[0]:
            xe=bound(c+2*(xr-c));fe=fun(xe);points[-1],values[-1]=(xe,fe) if fe<fr else (xr,fr)
        elif fr<values[-2]:points[-1]=xr;values[-1]=fr
        else:
            outside=fr<values[-1];xc=bound(c+.5*((xr if outside else worst)-c));fc=fun(xc)
            if fc<(fr if outside else values[-1]):points[-1]=xc;values[-1]=fc
            else:
                for k in range(1,7):points[k]=bound(points[0]+.5*(points[k]-points[0]));values[k]=fun(points[k])
        if iteration%100==0:print(json.dumps(dict(motor=motor_on,iteration=iteration,evaluations=ev,best=float(min(values)),seconds=time.time()-started)),flush=True)
    z=expand(points[int(np.argmin(values))]);v,per=loss(z,motor_on)
    return dict(parameters=z.tolist(),loss=v,perRecordLoss=per,evaluations=ev,boundCoordinates=points[int(np.argmin(values))].tolist())
base,baseper=loss(initial,False);print(json.dumps(dict(baselineLoss=base)),flush=True)
fits={name:optimize(on) for name,on in [('static_refit_control',False),('motor_refit_candidate',True)]}
cases=[]
for name,z,on in [('unchangedR90',initial,False),('motorOnlyR90',initial/np.r_[[m['gain'] for m in motor],np.ones(9)],True),
                  *[(name,np.array(fit['parameters']),name=='motor_refit_candidate') for name,fit in fits.items()]]:
    for d in records:
        p=rollout(lib,z,d,d['motor_u'] if on else d['u']);assert p is not None
        cases.append(dict(case=name,**describe(p,d)))
candidate=fits['motor_refit_candidate'];eligible=candidate['loss']<base and np.mean(candidate['perRecordLoss'][-5:])<np.mean(baseper[-5:])
out=dict(protocolSHA256=sha(HERE/'plant_fit_protocol.json'),scriptSHA256=sha(__file__),baselineLoss=base,baselinePerRecordLoss=baseper,
         fits=fits,cases=cases,candidateEligibleForOneExploratoryManualCapture=bool(eligible),physicalModelValidated=False,
         all12RecordsUsedForCalibration=True,olderNegativeResultsPreserved=True,measuredCurrentInjectedIntoPlant=False,assistantHardwareAction=False)
with (HERE/'plant_fit_results.json').open('x',encoding='utf-8') as f:json.dump(out,f,indent=2,allow_nan=False)
print(json.dumps(dict(baseline=base,fits=fits,eligible=bool(eligible)),ensure_ascii=False),flush=True)
