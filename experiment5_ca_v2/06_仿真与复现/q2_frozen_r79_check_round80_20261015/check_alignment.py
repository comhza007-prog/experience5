"""Read-only alignment checks; derived audit only, no refitting."""
import csv,ctypes,hashlib,json
from pathlib import Path
import numpy as np
HERE=Path(__file__).resolve().parent;ROOT=HERE.parents[1]
sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
evaluation=json.loads((HERE/'frozen_model_evaluation.json').read_text(encoding='utf-8'))
frozen=Path(evaluation['frozenModel']);assert sha(frozen)==evaluation['frozenModelSHA256']
model=json.loads(frozen.read_text(encoding='utf-8'))
lib=ctypes.CDLL(str(ROOT/model['solverRelativeToProject']))
arr=np.ctypeslib.ndpointer(dtype=np.float64,flags='C_CONTIGUOUS')
lib.model_rollout.argtypes=[ctypes.c_int,arr,arr,arr,arr,arr,arr]
lib.model_rollout.restype=ctypes.c_int
theta=np.ascontiguousarray(model['parameters'],float)
sources=[('run03',HERE/'capture_analysis.json')]
sources.extend((r['kind']+'_calibration',Path(r['decoded'])) for r in model['trainingSources'])
results=[]
for kind,file in sources:
    d=json.loads(file.read_text(encoding='utf-8'))
    path=Path(d.get('source',d['capture_audit']['source']))
    rawhash=d.get('sourceSHA256',d['capture_audit']['sourceSHA256'])
    assert sha(path)==rawhash
    with path.open(newline='',encoding='utf-8-sig') as f:
        reader=csv.reader(f);next(reader);allrows=np.array([[float(v) for v in r] for r in reader])
    cuts=np.flatnonzero((np.diff(allrows[:,0])<=0)|(np.diff(allrows[:,1])<=0))+1
    assert cuts.tolist() in ([],[1])
    live=allrows[int(cuts[0]):] if len(cuts) else allrows
    active=live[(live[:,106]==1)&(live[:,2]>=2)&(live[:,2]<=5)]
    pitch=d['header']['configured_meters_per_count'];sign=np.array([1.,-1.]);dt=[];u=[];indices=[];measured=[]
    phase_stats=[]
    for name,mode,a,b in [('prehold','slow',0,100),('outward','fast',0,4000),('targethold','slow',100,150),('return','fast',4000,8000),('returnhold','slow',150,300)]:
        start=len(dt)
        for r in d[mode][a:b]:
            if mode=='slow':
                dt.extend([r['dt_us']/40e6]*40);u.extend([np.array(r['command_integral_counts_us'])*sign/r['dt_us']]*40)
            else:dt.append(r['dt_us']/1e6);u.append(np.array(r['command_counts'])*sign)
            indices.append(len(dt)-1);measured.append(np.array(r['encoder'])*sign*pitch)
        phase_stats.append({'phase':name,'startStep':start,'endStep':len(dt),'duration_s':float(sum(dt[start:])),
                            'meanPhysicalCommand_counts':np.mean(u[start:],axis=0).tolist(),
                            'meanAbsolutePhysicalCommand_counts':np.mean(np.abs(u[start:]),axis=0).tolist()})
    indices=np.array(indices);measured=np.array(measured)
    lookup={int(i):r for i,r in zip(indices,measured)}
    at=active[:,46].astype(int)-2
    assert all(int(i) in lookup for i in at)
    recovered=np.array([lookup[int(i)] for i in at])
    recovered=np.round(recovered,6)
    mismatches=int(np.sum(np.any(abs(recovered-active[:,5:7])>0.00000051,axis=1)))
    assert mismatches==0
    expected_steps=np.arange(4001,20001,40)
    missing_steps=sorted(map(int,set(expected_steps)-set(active[:,46].astype(int))))
    dt=np.ascontiguousarray(dt,float);u=np.ascontiguousarray(u,float)
    positions=np.full((20000,2),np.nan)
    assert lib.model_rollout(20000,dt,u,np.zeros(2),np.zeros(2),theta,positions)==20000
    continuous=positions[at];mapped=np.round(np.sign(continuous)*np.floor(np.abs(continuous/pitch)+.5)*pitch,6)
    track=float(np.sqrt(np.mean(((mapped.mean(axis=1)-active[:,3])*1000)**2)))
    sync=float(np.sqrt(np.mean(((mapped[:,0]-mapped[:,1])*1000)**2)))
    if kind=='run03':
        assert abs(track-evaluation['nativeMetrics']['modeledTrackingRMSE_mm'])<1e-12
        assert abs(sync-evaluation['nativeMetrics']['modeledSyncRMS_mm'])<1e-12
    else:
        fit=json.loads((frozen.parent/'fit_results.json').read_text(encoding='utf-8'))
        expected=next(c for c in fit['cases'] if c['record']==kind.split('_')[0] and c['case']=='measurementTargetRefit')
        assert abs(track-expected['modeledTaskTrackingRMSE_mm'])<1e-12
        assert abs(sync-expected['modeledTaskSyncRMS_mm'])<1e-12
    results.append({'record':kind,'CSVAndBlobPositionAlignmentsChecked':len(at),'mismatches':mismatches,
                    'missingCSVCoreSteps':missing_steps,'sumDt_s':float(sum(dt)),
                    'modelTrackingRMSE_mm':track,'modelSyncRMS_mm':sync,
                    'phaseInputStatistics':phase_stats})
out={'passed':True,'records':results,'frozenModelSHA256':sha(frozen),
     'sameEvaluationPipelineReproducesOriginalTrainingMetrics':True,
     'nativeCSVAndBlobAlignmentMismatches':0,'run03OnlyGapIsCoreStep':results[0]['missingCSVCoreSteps'],
     'noDataOrParametersModified':True,'modelRefitted':False,
     'interpretation':'Numerical implementation, data mapping and frozen parameter provenance cross-checks agree. New-record mismatch is not explained by the single absent CSV point. This audit does not identify the physical cause of model error.'}
with (HERE/'alignment_audit.json').open('x',encoding='utf-8') as f:json.dump(out,f,ensure_ascii=False,indent=2,allow_nan=False)
print(json.dumps(out,ensure_ascii=False))
