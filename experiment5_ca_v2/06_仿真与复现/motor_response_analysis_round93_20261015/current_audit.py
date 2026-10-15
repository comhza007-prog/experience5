"""Exploratory raw-count drive response, contiguous 1 ms windows only."""
import json
import numpy as np
from predict import HERE,load_records
_,records=load_records();result=[]
for ch in range(2):
    per=[];all_pairs=[]
    for d in records:
        rows=d['decoded']['fine'];by={r['last_step']:r for r in rows};pairs=[]
        for r in rows:
            k=r['last_step']
            if all(k-j in by for j in range(12)):
                pairs.append([r['esc_current_raw'][ch],by[k-1]['esc_current_raw'][ch],*[by[k-j]['command_counts'][ch] for j in range(11)]])
        a=np.array(pairs,float);all_pairs.append(a)
        u=np.array([r['command_counts'][ch] for r in rows]);y=np.array([r['esc_current_raw'][ch] for r in rows])
        slope,intercept=np.linalg.lstsq(np.c_[u,np.ones(len(u))],y,rcond=None)[0]
        per.append(dict(record=d['name'],commandRange=[int(min(u)),int(max(u))],currentRange=[int(min(y)),int(max(y))],
                        staticGain=float(slope),staticOffset=float(intercept),staticRMSE_counts=float(np.sqrt(np.mean((y-slope*u-intercept)**2))),
                        correlation=float(np.corrcoef(u,y)[0,1]),batteryRange_mV=[min(r['battery_mV'] for r in rows),max(r['battery_mV'] for r in rows)]))
    pooled=np.concatenate(all_pairs);candidates=[]
    for delay in range(11):
        x=np.c_[pooled[:,1],pooled[:,2+delay],np.ones(len(pooled))];y=pooled[:,0]
        beta=np.linalg.lstsq(x,y,rcond=None)[0];a,b,c=beta
        valid=0<=a<1 and b>0
        candidates.append(dict(delay_ms=delay,a=float(a),b=float(b),c=float(c),stablePositive=bool(valid),
            tau_ms=float(-1/np.log(a)) if 0<a<1 else None,gain=float(b/(1-a)),offset=float(c/(1-a)),
            oneStepRMSE_counts=float(np.sqrt(np.mean((x@beta-y)**2)))))
    valid=[r for r in candidates if r['stablePositive']];best=min(valid,key=lambda r:r['oneStepRMSE_counts']) if valid else None
    result.append(dict(axis=ch,perRecord=per,candidates=candidates,bestCausalARX=best))
out=dict(status='Exploratory identification, not validation',axes=result,limitations=[
    'Raw ESC current counts are not calibrated torque or amperes.',
    'One-step ARX uses previous measured current for identification only, not main forward model prediction.',
    'CAN sample age 0-1ms and command reconstruction limit interpretation of small time constants.',
    'Fine windows total 1800ms per run; motor and drive cannot be separated from these measurements alone.'])
with (HERE/'current_response_audit.json').open('x',encoding='utf-8') as f:json.dump(out,f,indent=2)
print(json.dumps(out,ensure_ascii=False,indent=2))
