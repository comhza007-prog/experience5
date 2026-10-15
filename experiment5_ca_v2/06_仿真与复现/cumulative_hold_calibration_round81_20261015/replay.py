"""Re-run the saved candidate on accumulated records; no calibration or hardware."""
import json
import numpy as np
from calibration_core import HERE,sha,load_records,describe,rollout
candidate=json.loads((HERE/'model_parameters.json').read_text(encoding='utf-8'))
assert sha(HERE/'native_model.dll')==candidate['solverSHA256']
assert sha(HERE/'native_model.c')==candidate['solverSourceSHA256']
assert sha(HERE/'fit_results.json')==candidate['fitResultsSHA256']
assert sha(HERE/'polish_results.json')==candidate['polishResultsSHA256']
theta=np.array(candidate['parameters']);records=load_records();results=[]
for d in records:
    expected=next(c for c in candidate['calibrationAfter'] if c['record']==d['name'])
    result=describe(theta,d)
    assert abs(result['modeledTrackingRMSE_mm']-expected['modeledTrackingRMSE_mm'])<1e-12
    assert abs(result['modeledSyncRMS_mm']-expected['modeledSyncRMS_mm'])<1e-12
    valid,p,n=rollout(theta,d);assert valid
    result['all8300EndpointTimes_s']=np.cumsum(d['dt'])[d['idx']].tolist()
    result['all8300MeasuredPosition_m']=d['observed'].tolist()
    result['all8300ModeledPosition_m']=p[d['idx']].tolist()
    results.append(result)
destination=HERE/'replay_results.json'
if destination.exists():assert json.loads(destination.read_text(encoding='utf-8'))==results
else:
    with destination.open('x',encoding='utf-8') as f:json.dump(results,f,ensure_ascii=False,indent=2,allow_nan=False)
print(json.dumps({'replayedRecords':len(results),'stepsPerRecord':20000,'fittingPerformed':False,'hardwareAction':False,'modelParameters':str(HERE/'model_parameters.json'),'output':str(destination)},ensure_ascii=False))
