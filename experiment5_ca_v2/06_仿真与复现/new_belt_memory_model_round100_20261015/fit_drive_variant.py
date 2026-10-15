"""Second and final4-parameter memory variant: fixed coupling, common drive scale."""
import itertools,json,time
import numpy as np
from model import HERE,sha,contig,library,load,rollout,describe
data=load();lib=library();source=HERE.parent/'aggregate_calibration_round96_20261015/model_parameters_no_motor.json'
assert sha(source)=='2d66275627876b0e229abcbbf096d821a8960eff5f9e42b941c9a4b12ebf1db6'
base=json.loads(source.read_text());initial=np.array(base['parameters'][:9])
protocol=dict(status='Declared before joint structural-model calibration',authorization='User requests changing low-speed friction or elastic-transmission description and modifying model, using new-belt run010/run011 only.',
    sources=[{k:d[k] for k in ['name','raw','rawSHA256','decoded','decodedSHA256']} for d in data],
    model='M*v_dot+B*v+Kdiff*p+Fc*Sign(v)+f_el=G*u; f_el_i=k_i*(p_i-anchor_i), abs(f_el_i)<=Y; plastic anchor changes only when spring trial force reachesY. Implicit convex active-set integration.',
    physicalInterpretation='Equivalent pre-sliding elastic friction with dissipative slip memory. Not proof of actual belt plasticity or identified belt material parameters.',
    parameters=['commonDriveGainMultiplier','preSlidingStiffnessL','preSlidingStiffnessR','sharedYieldForce'],
    fixedNominalCoefficients=base['parameterNames'][2:9],
    sourceNominalSHA256=sha(source),bounds=[[.02,2.],[.01,30.],[.01,30.],[.00001,.02]],
    objective='Equal-record final trackingRMSE and syncRMS relative residuals divided0.15, squared mean; no waveform matching term. Tiny1e-6 normalized log drift tie-breaker.',
    search='81 deterministic3^4 grid points +128 seeded log-uniform points, then6 separated seeds of bounded Nelder-Mead, each<=1000evaluations/650iterations. Seed100. No widening after budget.',
    initialization='Zero positions, velocities and unstrained elastic-friction memory once per full20s; no measured state/current injection or reference-specific forces.',
    inputLimitations='Moving queued commands1ms; holding40ms integrals represented by means. Queued command not delivered torque.',
    acceptance=dict(bothCalibrationRecordsEachTrackingAndSyncRelativeErrorMaximum=.15,waveformHardGate=False),
    previousFrozenFailuresPreserved=True,bothNewBeltRecordsNowCalibration=True,oldRegimeRecordsUsed=0,
    independentValidationRequired=True,MCUFirmwareChanged=False,assistantHardwareAction=False)
with (HERE/'drive_variant_protocol.json').open('x',encoding='utf-8') as f:json.dump(protocol,f,ensure_ascii=False,indent=2)
bounds=np.log(np.array(protocol['bounds']));lo=bounds[:,0];hi=bounds[:,1];center=np.log([1.,1.,1.,.002]);evaluations=[];starttime=time.time()
def expand(x):
    z=np.r_[initial,np.exp(x[1:])];z[:2]*=np.exp(x[0]);return z
def metric(p,d):
    q=p[d['at']];return np.array([np.sqrt(np.mean(((q.mean(axis=1)-d['ref'])*1000)**2)),np.sqrt(np.mean(((q[:,0]-q[:,1])*1000)**2))])
def objective(x):
    z=expand(x);res=[];metrics=[]
    for d in data:
        p=rollout(lib,z,d)
        if p is None:res=None;break
        m=metric(p,d);metrics.append(m.tolist());res.extend((m/d['targets']-1)/.15)
    value=1e20 if res is None else float(np.mean(np.array(res)**2)+1e-6*np.mean(((x-center)/(hi-lo))**2))
    evaluations.append(dict(logCoordinates=x.tolist(),objective=value,metrics_mm=metrics));return value
grid=[]
for f in itertools.product([0.,.5,1.],repeat=4):
    x=lo+(hi-lo)*np.array(f);grid.append((objective(x),x))
rng=np.random.default_rng(100)
for j in range(128):
    x=rng.uniform(lo,hi);grid.append((objective(x),x))
seeds=[]
for val,x in sorted(grid,key=lambda p:p[0]):
    if all(np.linalg.norm((x-y)/(hi-lo))>.12 for y in seeds):seeds.append(x.copy())
    if len(seeds)==6:break
bound=lambda x:np.clip(x,lo,hi);fits=[]
for seed_id,seed in enumerate(seeds):
    started=len(evaluations);points=np.vstack([seed,*[bound(seed+np.eye(4)[j]*.05) for j in range(4)]]);values=np.array([objective(x) for x in points])
    for iteration in range(650):
        order=np.argsort(values,kind='stable');points=points[order];values=values[order]
        if len(evaluations)-started+7>1000:break
        if np.max(abs(points[1:]-points[0]))<1e-7 and max(values)-min(values)<1e-11:break
        c=points[:-1].mean(axis=0);worst=points[-1].copy();xr=bound(2*c-worst);fr=objective(xr)
        if fr<values[0]:
            xe=bound(c+2*(xr-c));fe=objective(xe);points[-1],values[-1]=(xe,fe) if fe<fr else (xr,fr)
        elif fr<values[-2]:points[-1]=xr;values[-1]=fr
        else:
            outside=fr<values[-1];xc=bound(c+.5*((xr if outside else worst)-c));fc=objective(xc)
            if fc<(fr if outside else values[-1]):points[-1]=xc;values[-1]=fc
            else:
                for j in range(1,5):points[j]=bound(points[0]+.5*(points[j]-points[0]));values[j]=objective(points[j])
        if iteration%200==0:print(json.dumps(dict(seed=seed_id,iteration=iteration,loss=float(min(values)),evaluations=len(evaluations),seconds=time.time()-starttime)),flush=True)
    x=points[np.argmin(values)];z=expand(x);cases=[describe(rollout(lib,z,d),d) for d in data]
    fits.append(dict(seed=seed_id,logCoordinates=x.tolist(),parameters=z.tolist(),effectiveParameters=np.exp(x).tolist(),
        objective=float(min(values)),evaluations=len(evaluations)-started,cases=cases,calibrationBothRecordsPassed=all(r['bothWithin15Percent'] for r in cases)))
    print(json.dumps(dict(seed=seed_id,cases=cases)),flush=True)
best=min(fits,key=lambda f:f['objective']);out=dict(protocolSHA256=sha(HERE/'drive_variant_protocol.json'),sourceSHA256=sha(HERE/'native_model.c'),solverSHA256=sha(HERE/'native_model.dll'),
    scriptSHA256=sha(__file__),selected=best,fits=fits,evaluations=len(evaluations),allEvaluations=evaluations,
    bothRecordsCalibration=True,physicalModelValidated=False,MCUFirmwareChanged=False,assistantHardwareAction=False)
for d in data:assert sha(d['raw'])==d['rawSHA256']
with (HERE/'drive_variant_results.json').open('x',encoding='utf-8') as f:json.dump(out,f,ensure_ascii=False,indent=2)
print(json.dumps(dict(resultsSHA256=sha(HERE/'drive_variant_results.json'),selected=best)),flush=True)
