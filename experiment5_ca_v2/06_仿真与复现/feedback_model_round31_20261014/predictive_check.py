import json
from pathlib import Path
import numpy as np
import sys

DIR = Path(__file__).resolve().parent
DT = 0.010
METHODS = ('S3R2', 'BLNN')
LAMBDA = 0.001
USE_RPM = '--without-rpm' not in sys.argv

def load(name):
    source = json.loads((DIR / (name + '_run01_samples.json')).read_text(encoding='utf-8'))
    rows = source['samples']
    t = np.array([r['ms'] / 1000 for r in rows])
    assert np.max(np.abs(np.diff(t)-DT)) < 1e-9
    p = np.array([r['position_m'] for r in rows])
    z = np.column_stack(((p[:, 0]+p[:, 1])/2, (p[:, 1]-p[:, 0])/2))
    factor = source['configuredKinematics']['metersPerSecondPerRPM']
    raw_v = np.array([r['rpm'] for r in rows])*np.array([factor, -factor])
    raw_v = np.column_stack(((raw_v[:,0]+raw_v[:,1])/2, (raw_v[:,1]-raw_v[:,0])/2))
    u = {}
    for key in ('feedbackCurrentCounts','attemptedCommandCounts'):
        c = np.array([r[key] for r in rows])
        u[key] = np.column_stack(((c[:,0]-c[:,1])/2, -(c[:,0]+c[:,1])/2))
    v = np.vstack((np.zeros(2), np.diff(z,axis=0)/DT))
    return {'method':name,'source':source,'t':t,'p':p,'z':z,'v':v,'raw_v':raw_v,'u':u}

def features(d, idx, input_type, lag, velocity=None, z_override=None):
    v = d['v'][idx] if velocity is None else velocity
    z = d['z'][idx] if z_override is None else z_override
    u = d['u'][input_type][idx-lag]/1000
    columns=(v,d['raw_v'][idx],u,z[:,1],np.tanh(v[:,0]/0.00015),np.tanh(v[:,1]/0.00015)) if USE_RPM else (v,u,z[:,1],np.tanh(v[:,0]/0.00015),np.tanh(v[:,1]/0.00015))
    return np.column_stack(columns)

def fit(d, input_type, lag):
    idx=np.arange(5,len(d['t'])-1)
    x=features(d,idx,input_type,lag)
    y=d['v'][idx+1]
    mu=x.mean(axis=0); scale=x.std(axis=0); scale=np.where(scale>1e-12,scale,1)
    a=np.column_stack((np.ones(len(x)),(x-mu)/scale))
    penalty=np.eye(a.shape[1])*LAMBDA; penalty[0,0]=0
    beta=np.linalg.solve(a.T@a+penalty,a.T@y)
    return {'mu':mu,'scale':scale,'beta':beta,'conditionNumber':float(np.linalg.cond(a)),'designRank':int(np.linalg.matrix_rank(a))}

def predict(model,x):
    return np.column_stack((np.ones(len(x)),(x-model['mu'])/model['scale']))@model['beta']

def rms_mm(error):
    return (np.sqrt(np.mean(error**2,axis=0))*1000).tolist()

data={m:load(m) for m in METHODS}
results=[]
for train in METHODS:
    test=METHODS[1] if train==METHODS[0] else METHODS[0]
    a,b=data[train],data[test]
    for input_type in ('feedbackCurrentCounts','attemptedCommandCounts'):
        for lag in (0,1,2,3):
            model=fit(a,input_type,lag)
            idx=np.arange(5,len(b['t'])-1)
            v_pred=predict(model,features(b,idx,input_type,lag))
            truth=b['z'][idx+1]
            estimates={'ridge':b['z'][idx]+DT*v_pred,'persistence':b['z'][idx],
                       'constantVelocity':b['z'][idx]+DT*b['v'][idx],
                       'rawRPM':b['z'][idx]+DT*b['raw_v'][idx]}
            masks={'motion':b['t'][idx]>=4,'moving':((b['t'][idx]>=4)&(b['t'][idx]<8))|((b['t'][idx]>=10)&(b['t'][idx]<14))}
            scores={region:{name:rms_mm((p-truth)[mask]) for name,p in estimates.items()} for region,mask in masks.items()}
            # Forced rollout of the same predictive surrogate. RawRPM remains
            # a measured exogenous feature, so this is NOT a free plant model.
            z=b['z'][5:6].copy(); velocity=b['v'][5:6].copy(); rollout=[]
            for k in idx:
                x=features(b,np.array([k]),input_type,lag,velocity,z)
                velocity=predict(model,x)
                z=z+DT*velocity
                rollout.append(z[0].copy())
                if not np.isfinite(z).all() or np.max(np.abs(z))>1:
                    break
            roll=np.array(rollout)
            result={'train':train,'test':test,'input':input_type,'lag_ms':lag*10,
                    'conditionNumber':model['conditionNumber'],'designRank':model['designRank'],
                    'scores_nextPositionRMSE_mm_meanAndHalfSkew':scores,
                    'measuredRPMForcedRolloutCompleted':len(roll)==len(idx),
                    'forcedRolloutRMSE_mm':rms_mm(roll-truth[:len(roll)]),
                    'forcedRolloutPredictedSteps':len(roll),'forcedRolloutExpectedSteps':len(idx),
                    'rolloutUsesMeasuredRPM':USE_RPM,
                    'parametersNotPhysicalMassOrFriction':True}
            results.append(result)

result={'protocol':'predictive_protocol.json' if USE_RPM else 'predictive_without_rpm_protocol.json','lambda':LAMBDA,'causalFeatures':True,'noFutureFeatureLeakage':True,
        'results':results,'samplesPerController':len(data['S3R2']['t']),
        'physicalPlantIdentified':False,'counterfactualClosedLoopValidated':False,
        'rolloutUsesMeasuredRPM':USE_RPM,
        'finding':('Even forced rollout uses measured futureRPM as an exogenous input; it must never be used as a standalone plant to predict a new controller.' if USE_RPM else 'After initialization, forced rollout uses only its own predicted state and the recorded inputs, not measured future positions or RPM. Feedback-current input remains unavailable for a new-controller counterfactual. Fixed closed-loop trajectories and unknown1ms dynamics do not establish causal plant identification.')+'10ms recording cannot recover1ms feedback, filter history or all actuation dynamics.'}
(DIR/('prediction_verification.json' if USE_RPM else 'prediction_without_rpm_verification.json')).write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
for r in results:
    print(json.dumps({k:r[k] for k in ('train','test','input','lag_ms','forcedRolloutRMSE_mm')},ensure_ascii=False))
print('Recorded-input prediction checked; physical plant and counterfactual closed-loop remain NOT VALIDATED.')
