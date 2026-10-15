"""Fit a causal effective drive block with leave-one-record-out diagnostics."""
import json
import numpy as np
from predict import HERE,load_records,sha
_,records=load_records();axes=[]
for ch in range(2):
    data=[]
    for d in records:
        segments=[];last=-2
        for r in d['decoded']['fine']:
            if r['last_step']!=last+1:segments.append([])
            segments[-1].append(r);last=r['last_step']
        data.append(segments)
    trials=[]
    for delay in range(6):
        for tau in [0.,.00025,.0005,.001,.002,.005,.01]:
            designs=[];targets=[]
            for segments in data:
                xs=[];ys=[]
                for seg in segments:
                    state=0.
                    for k,r in enumerate(seg):
                        u=seg[k-delay]['command_counts'][ch] if k>=delay else 0.
                        a=np.exp(-r['dt_us']/1e6/tau) if tau else 0.
                        state=a*state+(1-a)*u
                        # No measured initial current. Discard first 50 ms for unknown prehistory.
                        if k>=50:xs.append(state);ys.append(r['esc_current_raw'][ch])
                designs.append(np.c_[xs,np.ones(len(xs))]);targets.append(np.array(ys))
            X=np.concatenate(designs);y=np.concatenate(targets);beta=np.linalg.lstsq(X,y,rcond=None)[0]
            loo=[];static_loo=[]
            for hold in range(5):
                others=[i for i in range(5) if i!=hold]
                b=np.linalg.lstsq(np.concatenate([designs[i] for i in others]),np.concatenate([targets[i] for i in others]),rcond=None)[0]
                loo.append(float(np.mean((designs[hold]@b-targets[hold])**2)))
            trials.append(dict(delay_steps=delay,tau_s=tau,gain=float(beta[0]),measurementOffset_counts=float(beta[1]),
                               trainingRMSE_counts=float(np.sqrt(np.mean((X@beta-y)**2))),
                               leaveOneRecordOutRMSE_counts=float(np.sqrt(np.mean(loo))),perRecordLOORMSE_counts=np.sqrt(loo).tolist()))
    static=next(t for t in trials if t['delay_steps']==0 and t['tau_s']==0)
    best=min(trials,key=lambda t:t['leaveOneRecordOutRMSE_counts'])
    improvement=100*(1-best['leaveOneRecordOutRMSE_counts']/static['leaveOneRecordOutRMSE_counts'])
    # Prospective adoption screen: positive gain, >=2% pooled LOO reduction, no >10% per-record LOO regression.
    adopt=bool(best['gain']>0 and improvement>=2 and np.all(np.array(best['perRecordLOORMSE_counts'])<=1.1*np.array(static['perRecordLOORMSE_counts'])))
    axes.append(dict(axis=ch,static=static,best=best,improvement_percent=improvement,adoptDynamics=adopt,
                     selected=best if adopt else static,allTrials=trials))
out=dict(status='Exploratory effective drive model, not calibrated motor physics',axes=axes,
         structure='Causal delay in 1ms control steps plus first-order lag, static raw-current gain; sensor offset excluded from force input.',
         selection='Equal record weights, leave-one-record-out raw-current MSE. Adoption >=2% pooled RMSE improvement and no record >10% worse; declared in script before fitting.',
         initialization='Zero filter state independently for each contiguous fine window, discard first50ms; no measured current injection.',
         tauGrid_s=[0,.00025,.0005,.001,.002,.005,.01],delayGrid_steps=list(range(6)),
         limitation='LOO diagnostics used to select structure, not independent validation. Cannot separate motor, ESC and feedback timing. Coarse currents not fitted.',
         scriptSHA256=sha(__file__),captureManifestSHA256=sha(HERE/'capture_manifest.json'))
with (HERE/'motor_block_parameters.json').open('x',encoding='utf-8') as f:json.dump(out,f,indent=2)
print(json.dumps([{k:a[k] for k in ['axis','static','best','improvement_percent','adoptDynamics','selected']} for a in axes],indent=2))
