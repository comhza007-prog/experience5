"""Bounded calibration of shared parameters to aggregate RMS targets only."""
import csv,importlib.util,json,sys,time
from pathlib import Path
import numpy as np
HERE=Path(__file__).resolve().parent;ROOT=HERE.parents[1];PRIOR=HERE.parent/'motor_response_analysis_round93_20261015';OLD=HERE.parent/'cumulative_micro_round90_20261015'
sys.path.insert(0,str(PRIOR))
from predict import sha,contig,load_records,library,rollout,describe
def records():
    spec=importlib.util.spec_from_file_location('old_core',OLD/'calibration_core.py');core=importlib.util.module_from_spec(spec);spec.loader.exec_module(core)
    out=core.load_records()
    for d in out:d['actual']=d['active'][:,5:7];d['ref']=d['active'][:,3]
    for folder,name in [('q2_multimodel_check_round91_20261015','Q2_run07'),('q2_motor_frozen_check_round94_20261015','Q2_run08')]:
        p=HERE.parent/folder/'capture_analysis.json';decoded=json.loads(p.read_text());assert sha(decoded['source'])==decoded['sourceSHA256']
        dt=[];u=[];idx=[];obs=[];pitch=decoded['header']['configured_meters_per_count'];sign=np.array([1,-1])
        for mode,a,b in [('slow',0,100),('fast',0,4000),('slow',100,150),('fast',4000,8000),('slow',150,300)]:
            for r in decoded[mode][a:b]:
                n=40 if mode=='slow' else 1;dt.extend([r['dt_us']/n/1e6]*n);v=np.array(r['command_integral_counts_us'] if mode=='slow' else r['command_counts'])*sign
                if mode=='slow':v=v/r['dt_us']
                u.extend([v]*n);idx.append(len(dt)-1);obs.append(np.array(r['encoder'])*sign*pitch)
        if 'metric_samples' in decoded:
            s=decoded['metric_samples'];at=np.array([r['step'] for r in s]);actual=np.array([r['position_m'] for r in s]);ref=np.array([r['reference_m'] for r in s])
        else:
            with Path(decoded['source']).open(encoding='utf-8-sig',newline='') as f:
                rd=csv.reader(f);next(rd);a=np.array([[float(x) for x in r] for r in rd])
            a=a[(a[:,106]==1)&(a[:,2]>=2)&(a[:,2]<=5)];at=a[:,46].astype(int)-2;actual=a[:,5:7];ref=a[:,3]
        targets=np.array([np.sqrt(np.mean(((actual.mean(axis=1)-ref)*1000)**2)),np.sqrt(np.mean(((actual[:,0]-actual[:,1])*1000)**2))])
        out.append(dict(name=name,raw=decoded['source'],rawSHA256=decoded['sourceSHA256'],decoded=str(p),decodedSHA256=sha(p),
            dt=contig(dt),u=contig(u),idx=np.array(idx),observed=np.array(obs),pitch=pitch,at=at,actual=actual,ref=ref,targets=targets))
    manifest,m1=load_records()
    for d,s in zip(m1,manifest['records']):d['raw']=s['source'];d['rawSHA256']=s['sourceSHA256'];d['decodedPath']=s['decoded']
    out.extend(m1);assert len(out)==13;return out
def setup(data):
    source=json.loads((PRIOR/'model_parameters.json').read_text());base=json.loads((OLD/'model_parameters.json').read_text());lib=library(ROOT/base['solverRelativeToProject'])
    for d in data:
        filtered=np.zeros_like(d['u'])
        for ch,m in enumerate(source['actuator']):
            state=0.
            for k,h in enumerate(d['dt']):
                a=np.exp(-h/m['tau_s']);state=a*state+(1-a)*d['u'][k,ch];filtered[k,ch]=m['gain']*state
        d['motor_u']=contig(filtered)
    return source,base,lib
def main():
    data=records();motor,base,lib=setup(data);sources=[dict(name=d['name'],raw=d['raw'],rawSHA256=d['rawSHA256']) for d in data]
    protocol=dict(status='Declared before bounded RMS-only calibration',reason='User prioritizes two final RMS summaries. Prior squared objective was66.48percent dominated by M1run01; use equal-record Huber loss retaining all13 records, no waveform matching term.',
        sources=sources,schemes=['no_motor_shared11','motor_shared11'],freeParameters=base['parameterNames'],relativeBounds=.25,inertiaEtaAbsoluteRadius=.03,
        objective='For each record and metric r=(continuousPredictedRMS/actualRMS-1)/0.15; Huber(r)=r*r if abs(r)<=1 else2*abs(r)-1. Mean over all13records/two metrics plus0.01*mean(normalizedDeviation^2). No direct output scaling, per-run offsets, measured-state/current injection or noise correction.',
        oneSeedPerScheme=True,maximumEvaluationsPerScheme=1600,maximumIterations=1050,initialSimplexStep=.1,
        acceptance='All13 rounded-encoder aggregate tracking/sync relative errors <=15percent needed for recommending another physical validation trial. Fitted results are calibration only, not validation.',
        run08NowCalibration=True,oldRun08FrozenFailurePreserved=True,noNewHardwareAuthorized=True)
    with (HERE/'protocol.json').open('x',encoding='utf-8') as f:json.dump(protocol,f,indent=2)
    def metric(z,d,on):
        p=rollout(lib,z,d,d['motor_u'] if on else d['u'])
        if p is None:return None
        q=p[d['at']]
        return np.array([np.sqrt(np.mean(((q.mean(axis=1)-d['ref'])*1000)**2)),np.sqrt(np.mean(((q[:,0]-q[:,1])*1000)**2))])
    def optimize(name,on):
        center=np.array(motor['parameters'] if on else base['parameters']);radius=abs(center)*.25;radius[8]=.03
        def expand(x):return center+radius*x
        def rawloss(z):
            rows=[]
            for d in data:
                m=metric(z,d,on)
                if m is None:return 1e30
                r=abs((m/d['targets']-1)/.15);rows.extend(np.where(r<=1,r*r,2*r-1))
            return float(np.mean(rows))
        count=0;initial=rawloss(center);history=[]
        def objective(x):
            nonlocal count
            count+=1;return rawloss(expand(x))+.01*float(np.mean(x*x))
        bound=lambda x:np.clip(x,-1,1);points=np.vstack([np.zeros(11),np.eye(11)*.1]);values=np.array([objective(x) for x in points]);started=time.time()
        for iteration in range(1050):
            order=np.argsort(values,kind='stable');points=points[order];values=values[order]
            if count+14>1600:break
            if np.max(abs(points[1:]-points[0]))<1e-6 and max(values)-min(values)<1e-9:break
            c=points[:-1].mean(axis=0);worst=points[-1].copy();xr=bound(2*c-worst);fr=objective(xr)
            if fr<values[0]:
                xe=bound(c+2*(xr-c));fe=objective(xe);points[-1],values[-1]=(xe,fe) if fe<fr else (xr,fr)
            elif fr<values[-2]:points[-1]=xr;values[-1]=fr
            else:
                outside=fr<values[-1];xc=bound(c+.5*((xr if outside else worst)-c));fc=objective(xc)
                if fc<(fr if outside else values[-1]):points[-1]=xc;values[-1]=fc
                else:
                    for k in range(1,12):points[k]=bound(points[0]+.5*(points[k]-points[0]));values[k]=objective(points[k])
            if iteration%150==0:print(json.dumps(dict(scheme=name,iteration=iteration,evaluations=count,loss=float(min(values)),seconds=time.time()-started)),flush=True)
        best=points[np.argmin(values)];z=expand(best);cases=[]
        for d in data:
            p=rollout(lib,z,d,d['motor_u'] if on else d['u']);cases.append(describe(p,d))
        return dict(scheme=name,motorEnabled=on,parameters=z.tolist(),initialDataLoss=initial,finalDataLoss=rawloss(z),evaluations=count,
                    normalizedCoordinates=best.tolist(),results=cases,all13BothMetricsWithin15Percent=all(r['bothWithin15Percent'] for r in cases))
    fits=[optimize('no_motor_shared11',False),optimize('motor_shared11',True)]
    out=dict(protocolSHA256=sha(HERE/'protocol.json'),scriptSHA256=sha(__file__),fits=fits,sources=sources,
        all13RecordsCalibration=True,run08NoLongerIndependentForNewCandidates=True,oldFrozenPredictionsPreserved=True,
        nextPhysicalRunReleased=any(f['all13BothMetricsWithin15Percent'] for f in fits),physicalModelValidated=False,
        simulator='Forced recorded queued-input replay, not autonomous closed loop',controllerOrFirmwareChanged=False,assistantHardwareAction=False)
    with (HERE/'calibration_results.json').open('x',encoding='utf-8') as f:json.dump(out,f,ensure_ascii=False,indent=2)
    for d in data:assert sha(d['raw'])==d['rawSHA256']
    print(json.dumps(dict(resultsSHA256=sha(HERE/'calibration_results.json'),fits=[dict(scheme=f['scheme'],initial=f['initialDataLoss'],final=f['finalDataLoss'],bothPassed=sum(r['bothWithin15Percent'] for r in f['results']),run08=next(r for r in f['results'] if r['record']=='Q2_run08')) for f in fits])),flush=True)
if __name__=='__main__':main()
