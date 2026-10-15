"""New-belt regime: single-record, two effective-gain calibration only."""
import json,sys
from pathlib import Path
import numpy as np
HERE=Path(__file__).resolve().parent;ROOT=HERE.parents[1];PRIOR=HERE.parent/'motor_response_analysis_round93_20261015';CAP=HERE.parent/'q2_r96_frozen_check_round97_20261015'
sys.path.insert(0,str(PRIOR))
from predict import sha,contig,library,rollout,describe
def setup():
    d=json.loads((CAP/'capture_analysis.json').read_text());assert d['sourceSHA256']=='398164810d2ee0462d895a7b5927c4b990eeb5ffb20784017d362b53852df02b' and sha(d['source'])==d['sourceSHA256']
    assert d['capture_audit']['fullRecordingProtocolQualified'];dt=[];u=[];idx=[];obs=[];pitch=d['header']['configured_meters_per_count'];sign=np.array([1,-1])
    for mode,a,b in [('slow',0,100),('fast',0,4000),('slow',100,150),('fast',4000,8000),('slow',150,300)]:
        for r in d[mode][a:b]:
            n=40 if mode=='slow' else 1;dt.extend([r['dt_us']/n/1e6]*n);v=np.array(r['command_integral_counts_us'] if mode=='slow' else r['command_counts'])*sign
            if mode=='slow':v=v/r['dt_us']
            u.extend([v]*n);idx.append(len(dt)-1);obs.append(np.array(r['encoder'])*sign*pitch)
    s=d['metric_samples'];r=dict(name='new_belt_run010',dt=contig(dt),u=contig(u),idx=np.array(idx),observed=np.array(obs),pitch=pitch,
        at=np.array([v['step'] for v in s]),actual=np.array([v['position_m'] for v in s]),ref=np.array([v['reference_m'] for v in s]),
        targets=np.array([d['capture_audit']['metrics']['trackingRMSE_mm'],d['capture_audit']['metrics']['syncRMS_mm']]))
    source=HERE.parent/'aggregate_calibration_round96_20261015/model_parameters_no_motor.json';assert sha(source)=='2d66275627876b0e229abcbbf096d821a8960eff5f9e42b941c9a4b12ebf1db6'
    base=json.loads(source.read_text());lib=library(ROOT/base['solverRelativeToProject']);assert sha(ROOT/base['solverRelativeToProject'])==base['solverSHA256']
    return d,r,source,base,lib
def main():
    d,r,source,base,lib=setup();initial=np.array(base['parameters'])
    protocol=dict(status='Declared before new-belt calibration',authorization='User confirms run010 was after new synchronous belt installation, requests this regime only and future operation under it.',
        regime='new synchronous belt; detailed belt specification/tension unknown; reported sluggish/sticking response retained as observed condition, not declared safe/normal',
        calibrationSource=d['source'],calibrationSourceSHA256=d['sourceSHA256'],oldRawRecordsInObjective=0,sourceNominalModel=str(source),sourceNominalModelSHA256=sha(source),
        freeParameters=['effectiveGainL','effectiveGainR'],fixedParameters=base['parameterNames'][2:],
        gainInterpretation='Conditional equivalent command-to-acceleration gains, confounded with fixed friction/inertia/coupling; not identified motor torque constants or proven belt material parameters.',
        objective='Only final active-window trackingRMSE and syncRMS relative residuals, continuous simulated positions; tiny1e-6*mean(log(gainMultipliers)^2) drift tie-breaker. Encoder-mapped statistics used for final screen.',
        initialization='Zero positions/velocities once; forced recorded queued inputs; no current/state injection, no output correction or per-run offsets.',
        search=dict(gainMultiplierRange=[.02,2.],deterministicLogGridPerAxis=17,localSeeds=8,maximumLocalEvaluationsPerSeed=600,maximumLocalIterationsPerSeed=400),
        acceptance=dict(calibrationTrackingRelativeErrorMaximum=.15,calibrationSyncRelativeErrorMaximum=.15,waveformHardGate=False),
        independentValidationRequired=True,run010NowCalibration=True,previousFrozenPredictionFailuresPreserved=True,oldModelsUnchanged=True,
        MCUFirmwareChanged=False,assistantHardwareAction=False)
    with (HERE/'protocol.json').open('x',encoding='utf-8') as f:json.dump(protocol,f,ensure_ascii=False,indent=2)
    lo,hi=np.log(.02),np.log(2.);evaluations=[]
    def expand(x):
        z=initial.copy();z[:2]*=np.exp(x);return z
    def objective(x):
        z=expand(x);p=rollout(lib,z,r)
        if p is None:value=1e12;metrics=None
        else:
            q=p[r['at']];metrics=np.array([np.sqrt(np.mean(((q.mean(axis=1)-r['ref'])*1000)**2)),np.sqrt(np.mean(((q[:,0]-q[:,1])*1000)**2))])
            value=float(np.sum((metrics/r['targets']-1)**2)+1e-6*np.mean(x*x))
        evaluations.append(dict(logMultipliers=x.tolist(),objective=value,metrics_mm=None if metrics is None else metrics.tolist()));return value
    grid=[]
    for a in np.linspace(lo,hi,17):
        for b in np.linspace(lo,hi,17):
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
        x=points[np.argmin(values)];z=expand(x);p=rollout(lib,z,r);result=describe(p,r)
        f=dict(seed=j,parameters=z.tolist(),multipliers=np.exp(x).tolist(),objective=float(min(values)),evaluations=len(evaluations)-start,calibration=result);fits.append(f)
        print(json.dumps(dict(seed=j,multipliers=f['multipliers'],calibration=result)),flush=True)
    best=min(fits,key=lambda f:f['objective']);assert np.array_equal(np.array(best['parameters'])[2:],initial[2:])
    baseline=describe(rollout(lib,initial,r),r)
    out=dict(status='New-belt regime calibration only',protocolSHA256=sha(HERE/'protocol.json'),scriptSHA256=sha(__file__),sourceSHA256=d['sourceSHA256'],
        baseline=baseline,selected=best,fits=fits,evaluations=len(evaluations),allEvaluations=evaluations,
        run010UsedForCalibration=True,oldRegimeObservationsUsedForFit=False,independentModelValidationPassed=False,
        calibrationScreenPassed=best['calibration']['bothWithin15Percent'],physicalBeltParametersIdentified=False,
        simulationType='Recorded-input forced replay, not autonomous closed loop',controllerOrFirmwareChanged=False,assistantHardwareAction=False)
    assert sha(d['source'])==d['sourceSHA256'] and sha(source)==protocol['sourceNominalModelSHA256']
    with (HERE/'calibration_results.json').open('x',encoding='utf-8') as f:json.dump(out,f,ensure_ascii=False,indent=2)
    print(json.dumps(dict(resultsSHA256=sha(HERE/'calibration_results.json'),selected=best)),flush=True)
if __name__=='__main__':main()
