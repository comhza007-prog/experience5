"""Frozen pre-fit predictions and raw ESC response audit; no hardware access."""
import ctypes, hashlib, json
from pathlib import Path
import numpy as np
HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[1]
sha=lambda p: hashlib.sha256(Path(p).read_bytes()).hexdigest()
contig=lambda x: np.ascontiguousarray(x,dtype=np.float64)
arr=np.ctypeslib.ndpointer(dtype=np.float64,flags='C_CONTIGUOUS')
def library(path):
    lib=ctypes.CDLL(str(path));lib.model_rollout.argtypes=[ctypes.c_int,arr,arr,arr,arr,arr,arr];lib.model_rollout.restype=ctypes.c_int
    return lib
def load_records():
    manifest=json.loads((HERE/'capture_manifest.json').read_text(encoding='utf-8'));out=[]
    for spec in manifest['records']:
        assert sha(spec['source'])==spec['sourceSHA256'] and sha(spec['decoded'])==spec['decodedSHA256']
        d=json.loads(Path(spec['decoded']).read_text(encoding='utf-8'));dt=[];u=[];idx=[];obs=[]
        sign=np.array([1.,-1.]);pitch=d['header']['configured_meters_per_count']
        for r in d['rows']:
            n=r['interval_steps'];dt.extend([r['dt_us']/n/1e6]*n)
            raw=np.array(r['command_counts'] if r['mode']=='fine' else r['command_integral_counts_us'],dtype=float)
            if r['mode']!='fine':raw/=r['dt_us']
            u.extend([raw*sign]*n);idx.append(r['last_step']);obs.append(np.array(r['encoder'])*sign*pitch)
        samples=d['metric_samples'];assert len(dt)==20000 and len(samples)==400
        out.append(dict(name=f"M1_run{spec['run']:02d}",dt=contig(dt),u=contig(u),idx=np.array(idx),observed=np.array(obs),
                        at=np.array([s['step'] for s in samples]),actual=np.array([s['position_m'] for s in samples]),
                        ref=np.array([s['reference_m'] for s in samples]),pitch=pitch,targets=np.array(list(spec['metrics'].values())),decoded=d))
    return manifest,out
def rollout(lib,theta,d,u=None):
    p=np.full((20000,2),np.nan);n=lib.model_rollout(20000,d['dt'],contig(d['u'] if u is None else u),np.zeros(2),np.zeros(2),contig(theta),p)
    if n!=20000: return None
    return p
def describe(p,d):
    q=p[d['at']];q=np.round(np.sign(q)*np.floor(np.abs(q/d['pitch'])+.5)*d['pitch'],6)
    metrics=np.array([np.sqrt(np.mean(((q.mean(axis=1)-d['ref'])*1000)**2)),np.sqrt(np.mean(((q[:,0]-q[:,1])*1000)**2))])
    rel=100*(metrics/d['targets']-1)
    return dict(record=d['name'],actualTrackingRMSE_mm=float(d['targets'][0]),actualSyncRMS_mm=float(d['targets'][1]),
                predictedTrackingRMSE_mm=float(metrics[0]),predictedSyncRMS_mm=float(metrics[1]),trackingDifference_percent=float(rel[0]),
                syncDifference_percent=float(rel[1]),bothWithin15Percent=bool(np.all(np.abs(rel)<=15)),
                nativePositionRMSE_mm=np.sqrt(np.mean(((q-d['actual'])*1000)**2,axis=0)).tolist())
def frozen():
    manifest,records=load_records();results=[]
    for spec in manifest['registry']:
        assert sha(spec['file'])==spec['sha256'];model=json.loads(Path(spec['file']).read_text(encoding='utf-8'))
        path=ROOT/model['solverRelativeToProject'];assert sha(path)==model['solverSHA256'];lib=library(path)
        for d in records:
            p=rollout(lib,model['parameters'],d);assert p is not None
            row=dict(model=spec['label'],**describe(p,d));results.append(row);print(json.dumps(row),flush=True)
    result=dict(status='Frozen pre-fit prospective predictions on five new M1 records',modelsRefitted=0,models=manifest['registry'],
                sourceManifestSHA256=sha(HERE/'capture_manifest.json'),results=results,
                method='Initial state zero once; recorded prior queued commands; coarse 20ms integral held as block mean; no measured-state/current injection.',
                limitation='Aggregate RMS screen only, not full closed-loop model validation. Strict CSV protocol has stopped CRC-preparation gaps; active metrics and CRC snapshot complete.')
    with (HERE/'frozen_predictions.json').open('x',encoding='utf-8') as f:json.dump(result,f,ensure_ascii=False,indent=2)
if __name__=='__main__':frozen()
