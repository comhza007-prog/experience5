"""Re-run the calibrated mechanical model; no fitting and no hardware I/O."""
import ctypes, hashlib, json
from pathlib import Path
import numpy as np

HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[1]
sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
params=json.loads((HERE/'model_parameters.json').read_text(encoding='utf-8'))
fit=json.loads((HERE/'fit_results.json').read_text(encoding='utf-8'))
assert sha(HERE/'fit_results.json')==params['fitResultsSHA256']
theta=np.ascontiguousarray(params['parameters'],dtype=np.float64)
assert np.array_equal(theta,fit['fit']['parameters'])
library=ROOT/params['solverRelativeToProject']
assert sha(library)==fit['nativeLibrarySHA256']
lib=ctypes.CDLL(str(library))
arr=np.ctypeslib.ndpointer(dtype=np.float64,flags='C_CONTIGUOUS')
lib.model_rollout.argtypes=[ctypes.c_int,arr,arr,arr,arr,arr,arr]
lib.model_rollout.restype=ctypes.c_int
output=[]
for source in params['trainingSources']:
    assert sha(source['raw'])==source['rawSHA256']
    assert sha(source['decoded'])==source['decodedSHA256']
    decoded=json.loads(Path(source['decoded']).read_text(encoding='utf-8'))
    pitch=decoded['header']['configured_meters_per_count']
    sign=np.array([1.,-1.]);dt=[];u=[];idx=[];observed=[];phases=[]
    for mode,a,b in [('hold',0,100),('motion',0,4000),('hold',100,150),('motion',4000,8000),('hold',150,300)]:
        for row in decoded['slow' if mode=='hold' else 'fast'][a:b]:
            if mode=='hold':
                dt.extend([row['dt_us']/40e6]*40)
                u.extend([np.array(row['command_integral_counts_us'])*sign/row['dt_us']]*40)
            else:
                dt.append(row['dt_us']/1e6);u.append(np.array(row['command_counts'])*sign)
            idx.append(len(dt)-1);observed.append(np.array(row['encoder'])*sign*pitch);phases.append(row['phase'])
    dt=np.ascontiguousarray(dt,dtype=np.float64);u=np.ascontiguousarray(u,dtype=np.float64)
    positions=np.full((len(dt),2),np.nan)
    assert lib.model_rollout(len(dt),dt,u,np.zeros(2),np.zeros(2),theta,positions)==20000
    idx=np.array(idx);observed=np.array(observed);pred=positions[idx]
    e=(pred-observed)*1000
    output.append({'record':source['kind'],'parameterVersion':params['version'],'simulationType':params['simulationType'],
                   'time_s':np.cumsum(dt)[idx].tolist(),'phase':phases,
                   'measuredPosition_m':observed.tolist(),'modeledPosition_m':pred.tolist(),
                   'meanPositionWaveformRMSE_mm':float(np.sqrt(np.mean(e.mean(axis=1)**2))),
                   'syncWaveformRMSE_mm':float(np.sqrt(np.mean((e[:,0]-e[:,1])**2)))})
destination=HERE/'replay_results.json'
if destination.exists():
    prior=json.loads(destination.read_text(encoding='utf-8'))
    assert prior==output,'Different existing replay result; preserved instead of overwritten'
else:
    with destination.open('x',encoding='utf-8') as f:json.dump(output,f,ensure_ascii=False,indent=2,allow_nan=False)
print(json.dumps({'replayedRecords':len(output),'stepsPerRecord':20000,'endpointsPerRecord':8300,'parametersLoadedFrom':str(HERE/'model_parameters.json'),'results':str(destination),'fitNotRerun':True,'hardwareAction':False},ensure_ascii=False))
