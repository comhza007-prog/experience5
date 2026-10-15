"""Controlled offline model interventions. No fitting, no hardware, no acceptance selection."""
import csv,importlib.util,json,sys
from pathlib import Path
import numpy as np
HERE=Path(__file__).resolve().parent;ROOT=HERE.parents[1];PRIOR=HERE.parent/'motor_response_analysis_round93_20261015'
sys.path.insert(0,str(PRIOR))
from predict import sha,contig,load_records,library,rollout,describe
OLD=HERE.parent/'cumulative_micro_round90_20261015'
spec=importlib.util.spec_from_file_location('old_core',OLD/'calibration_core.py');core=importlib.util.module_from_spec(spec);spec.loader.exec_module(core)
old=core.load_records()
for d in old:d['actual']=d['active'][:,5:7];d['ref']=d['active'][:,3];d['phases']=d['active'][:,2].astype(int)
def q2(folder,name):
    path=HERE.parent/folder/'capture_analysis.json';decoded=json.loads(path.read_text(encoding='utf-8'))
    assert sha(decoded['source'])==decoded['sourceSHA256'];dt=[];u=[];idx=[];obs=[];pitch=decoded['header']['configured_meters_per_count'];sign=np.array([1,-1])
    for mode,a,b in [('slow',0,100),('fast',0,4000),('slow',100,150),('fast',4000,8000),('slow',150,300)]:
        for r in decoded[mode][a:b]:
            n=40 if mode=='slow' else 1;dt.extend([r['dt_us']/n/1e6]*n)
            command=np.array(r['command_integral_counts_us'] if mode=='slow' else r['command_counts'])*sign
            if mode=='slow':command=command/r['dt_us']
            u.extend([command]*n);idx.append(len(dt)-1);obs.append(np.array(r['encoder'])*sign*pitch)
    if 'metric_samples' in decoded:
        samples=decoded['metric_samples'];at=np.array([s['step'] for s in samples]);actual=np.array([s['position_m'] for s in samples]);ref=np.array([s['reference_m'] for s in samples]);phases=np.array([s['phase'] for s in samples])
    else:
        with Path(decoded['source']).open(encoding='utf-8-sig',newline='') as f:
            rd=csv.reader(f);next(rd);r=np.array([[float(x) for x in row] for row in rd])
        r=r[(r[:,106]==1)&(r[:,2]>=2)&(r[:,2]<=5)];at=r[:,46].astype(int)-2;actual=r[:,5:7];ref=r[:,3];phases=r[:,2].astype(int)
    targets=np.array([np.sqrt(np.mean(((actual.mean(axis=1)-ref)*1000)**2)),np.sqrt(np.mean(((actual[:,0]-actual[:,1])*1000)**2))])
    return dict(name=name,dt=contig(dt),u=contig(u),idx=np.array(idx),observed=np.array(obs),pitch=pitch,at=at,actual=actual,ref=ref,phases=phases,targets=targets,
                raw=decoded['source'],rawSHA256=decoded['sourceSHA256'],decoded=str(path),decodedSHA256=sha(path))
old.append(q2('q2_multimodel_check_round91_20261015','Q2_run07'))
test=q2('q2_motor_frozen_check_round94_20261015','Q2_run08')
manifest,new=load_records()
for d in new:
    d['phases']=np.array([s['phase'] for s in d['decoded']['metric_samples']]);d['raw']=d['decoded']['source'];d['rawSHA256']=d['decoded']['sourceSHA256']
records=old+[test]+new
assert len(records)==13
base=json.loads((OLD/'model_parameters.json').read_text());candidate=json.loads((PRIOR/'model_parameters.json').read_text());fit=json.loads((PRIOR/'plant_fit_results.json').read_text());z0=np.array(base['parameters']);z1=np.array(candidate['parameters']);g=np.array([m['gain'] for m in candidate['actuator']]);lib=library(ROOT/base['solverRelativeToProject'])
assert sha(PRIOR/'model_parameters.json')=='73fbd019a99a69a792f6027e873840ddf9baae14723284e46b12a8182e317748'
for d in records:
    d['drive_dc']=contig(d['u']*g);filtered=np.zeros_like(d['u'])
    for ch,m in enumerate(candidate['actuator']):
        state=0.
        for k,h in enumerate(d['dt']):
            a=np.exp(-h/m['tau_s']);state=a*state+(1-a)*d['u'][k,ch];filtered[k,ch]=m['gain']*state
    d['drive_lag']=contig(filtered)
protocol=dict(status='Declared before controlled interventions',records=[d['name'] for d in records],modelsRefitted=0,
    scope='Factorial separation of adding drive lag vs mechanical refit, parameter-family ablations, local+/-1percent sensitivity. These are post-result diagnostics, NOT a parameter search or new accepted model.',
    cases=['R90_original','R90_drive_only','static_refit_control','R93_no_lag_same_DC_gain','R93_motor',
           'R93_no_extra_static','R93_half_extra_static','R93_no_kinetic_or_extra_friction','R93_no_elastic_viscous_coupling','R93_no_inertia_cross_term'],
    initialization='Zero positions, velocities and drive state once. No observed current/state injection.',
    localSensitivity='Each R93 mechanical parameter independently+/-1percent of absolute value; inertiaeta varies+/-0.001. All other settings held fixed, no selecting winning coefficients.',
    evaluation='Final active-window trackingRMSE and syncRMS only for performance screen. Phase partitions and trajectory residuals diagnostic only.',
    run08Role='Frozen R94 independent test retained; reused here as post-result diagnosis, not independent evidence for future changes.',
    physicalModelValidated=False,firmwareChanged=False,assistantHardwareAction=False)
with (HERE/'protocol.json').open('x',encoding='utf-8') as f:json.dump(protocol,f,indent=2)
cases=[('R90_original',z0,'u'),('R90_drive_only',z0/np.r_[g,np.ones(9)],'drive_lag'),
       ('static_refit_control',np.array(fit['fits']['static_refit_control']['parameters']),'u'),
       ('R93_no_lag_same_DC_gain',z1,'drive_dc'),('R93_motor',z1,'drive_lag')]
for name,indices,factor in [('R93_no_extra_static',[9,10],0),('R93_half_extra_static',[9,10],.5),
                            ('R93_no_kinetic_or_extra_friction',[6,7,9,10],0),
                            ('R93_no_elastic_viscous_coupling',[4,5],0),('R93_no_inertia_cross_term',[8],0)]:
    z=z1.copy();z[indices]*=factor;cases.append((name,z,'drive_lag'))
results=[];phase=[]
for name,z,key in cases:
    for d in records:
        p=rollout(lib,z,d,d[key]);
        if p is None:results.append(dict(case=name,record=d['name'],rolloutValid=False));continue
        result=describe(p,d);results.append(dict(case=name,rolloutValid=True,**result))
        if d['name']=='Q2_run08':
            q=p[d['at']];q=np.round(np.sign(q)*np.floor(abs(q/d['pitch'])+.5)*d['pitch'],6)
            actualTrack=(d['actual'].mean(axis=1)-d['ref'])*1000;predTrack=(q.mean(axis=1)-d['ref'])*1000
            actualSync=(d['actual'][:,0]-d['actual'][:,1])*1000;predSync=(q[:,0]-q[:,1])*1000
            for ph in [2,3,4,5]:
                mask=d['phases']==ph;rms=lambda x:float(np.sqrt(np.mean(x[mask]**2)))
                phase.append(dict(case=name,phase=ph,samples=int(sum(mask)),actualTrackingRMSE_mm=rms(actualTrack),predictedTrackingRMSE_mm=rms(predTrack),
                    actualSyncRMS_mm=rms(actualSync),predictedSyncRMS_mm=rms(predSync),
                    trackingSSEFraction=float(np.sum(predTrack[mask]**2)/np.sum(predTrack**2)),
                    commonPositionBias_mm=float(np.mean((q[mask].mean(axis=1)-d['actual'][mask].mean(axis=1))*1000))))
    print(json.dumps(dict(case=name,run08=results[-6] if False else next(r for r in results if r['case']==name and r['record']=='Q2_run08'))),flush=True)
sens=[]
for index,name in enumerate(base['parameterNames']):
    step=.001 if index==8 else abs(z1[index])*.01
    for direction in [-1,1]:
        z=z1.copy();z[index]+=direction*step;rows=[]
        for d in records:
            p=rollout(lib,z,d,d['drive_lag']);rows.append(describe(p,d) if p is not None else dict(record=d['name'],rolloutValid=False))
        sens.append(dict(parameter=name,index=index,direction=direction,absoluteStep=step,results=rows))
out=dict(protocolSHA256=sha(HERE/'protocol.json'),scriptSHA256=sha(__file__),results=results,run08PhaseDiagnostics=phase,localSensitivity=sens,
    records=[dict(name=d['name'],raw=d['raw'],rawSHA256=d['rawSHA256']) for d in records],
    parametersChangedOrFitted=False,postResultMechanismDiagnostics=True,run08NowUsedForDiagnosisNotNewBlindValidation=True,
    causalFaultProven=False,physicalModelValidated=False,assistantHardwareAction=False,newPhysicalRunReleased=False)
for d in records:assert sha(d['raw'])==d['rawSHA256']
assert sha(PRIOR/'model_parameters.json')=='73fbd019a99a69a792f6027e873840ddf9baae14723284e46b12a8182e317748'
with (HERE/'diagnosis_results.json').open('x',encoding='utf-8') as f:json.dump(out,f,ensure_ascii=False,indent=2)
print(json.dumps(dict(done=True,diagnosisSHA256=sha(HERE/'diagnosis_results.json'))),flush=True)
