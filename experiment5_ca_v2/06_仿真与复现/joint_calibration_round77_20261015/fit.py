import csv, ctypes, hashlib, json
from pathlib import Path
import numpy as np

HERE=Path(__file__).resolve().parent;ROOT=HERE.parents[1]
MODEL=ROOT/'06_仿真与复现/inertia_coupling_round66_20261015'
sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
protocol=json.loads((HERE/'protocol.json').read_text(encoding='utf-8'))
initialpath=ROOT/'06_仿真与复现'/protocol['initialModel']
assert sha(initialpath)==protocol['initialModelSHA256']
initial=np.array(json.loads(initialpath.read_text(encoding='utf-8'))['fit']['parameters'],float)
solvercheck=json.loads((MODEL/'solver_verification.json').read_text(encoding='utf-8'))
assert sha(MODEL/'native_model.dll')==solvercheck['nativeLibrarySHA256']
lib=ctypes.CDLL(str(MODEL/'native_model.dll'));arr=np.ctypeslib.ndpointer(dtype=np.float64,flags='C_CONTIGUOUS')
lib.model_rollout.argtypes=[ctypes.c_int,arr,arr,arr,arr,arr,arr];lib.model_rollout.restype=ctypes.c_int
contiguous=lambda a:np.ascontiguousarray(a,dtype=np.float64)

def record(p,kind):
    data=json.loads(Path(p).read_text(encoding='utf-8'))
    raw=Path(data['capture_audit']['source'] if kind=='T1' else data['source'])
    expected=data['capture_audit']['sourceSHA256'] if kind=='T1' else data['sourceSHA256']
    assert sha(raw)==expected
    with raw.open(newline='',encoding='utf-8-sig') as f:
        reader=csv.reader(f);assert next(reader)==[f'I{k}' for k in range(107)]
        all_rows=np.array([[float(v) for v in row] for row in reader])
    if kind=='Q2':
        assert all_rows[1,0]<all_rows[0,0] and all_rows[0,2]==6
        live=all_rows[1:]
    else:live=all_rows
    assert np.all(np.diff(live[:,0])>0) and len(data['fast'])==8000
    pitch=data['header']['configured_meters_per_count'];sign=np.array([1.,-1.]);dt=[];u=[];indices=[];obs=[]
    for mode,a,b in [('hold',0,100),('motion',0,4000),('hold',100,150),('motion',4000,8000),('hold',150,300)]:
        rows=data['slow' if mode=='hold' else 'fast'][a:b]
        for row in rows:
            if mode=='hold':
                mean=np.array(row['command_integral_counts_us'])*sign/row['dt_us']
                for _ in range(40):dt.append(row['dt_us']/40e6);u.append(mean)
            else:dt.append(row['dt_us']/1e6);u.append(np.array(row['command_counts'])*sign)
            indices.append(len(dt)-1);obs.append(np.array(row['encoder'])*sign*pitch)
    dt=contiguous(dt);u=contiguous(u);indices=np.array(indices);obs=np.array(obs)
    weights=np.sqrt(np.diff(np.r_[0.,np.cumsum(dt)[indices]]))
    active=live[(live[:,106]==1)&(live[:,2]>=2)&(live[:,2]<=5)]
    at=active[:,46].astype(int)-2
    assert len(dt)==20000 and len(indices)==8300 and len(at)==400
    return dict(kind=kind,decoded=str(p),decodedSHA256=sha(p),raw=str(raw),rawSHA256=sha(raw),dt=dt,u=u,indices=indices,observed=obs,weights=weights,active=active,at=at,pitch=pitch)

joint_training=[record(ROOT/'06_仿真与复现'/p,kind) for p,kind in zip(protocol['trainingSources'],['T1','Q2'])]
assert [r['rawSHA256'] for r in joint_training]==protocol['trainingRawSHA256']
training=joint_training[0]
# Both tightened records are training; newQ2 is no longer held out for this model.
scale=np.array(protocol['parameterScales']);low=np.array(protocol['lowerBounds'])/scale;high=np.array(protocol['upperBounds'])/scale
evaluations=[];reg=1e-8
def rollout(theta,data):
    out=np.full((20000,2),np.nan)
    n=lib.model_rollout(20000,data['dt'],data['u'],np.zeros(2),np.zeros(2),contiguous(theta),out)
    return n==20000,out,n
def evaluate(x,label):
    if len(evaluations)>=protocol['maxEvaluations']:return None
    parts=[];completed=[];okay=True
    for weight,data in zip(protocol['recordWeights'],joint_training):
        valid,pred,n=rollout(x*scale,data);completed.append(n)
        if not valid:okay=False;break
        e=(pred[data['indices']]-data['observed'])*1000
        w=np.sqrt(weight)*data['weights']
        parts.extend([w*e.mean(axis=1),w*(e[:,0]-e[:,1])])
    if okay:
        r=np.r_[*parts,np.sqrt(reg)*x]
        score=float(r@r)
    else:r=None;score=None
    evaluations.append({'evaluation':len(evaluations)+1,'label':label,'parameters':(x*scale).tolist(),'completed':okay,'stepsPerRecord':completed,'objective':score})
    return r,pred,score
x=np.clip(initial/scale,low,high);first=evaluate(x,'initialFrozenRound72');history=[]
assert first[0] is not None
residual,pred,score=first;lm=1e-3;status='fixed_iteration_budget'
for iteration in range(protocol['maxIterations']):
    if len(evaluations)+13>protocol['maxEvaluations']:status='evaluation_budget';break
    cols=[];failed=False
    for ch in range(9):
        delta=1e-3*(1+abs(x[ch]));xp=x.copy();xp[ch]=min(high[ch],x[ch]+delta)
        if xp[ch]==x[ch]:xp[ch]=max(low[ch],x[ch]-delta)
        test=evaluate(xp,f'iteration{iteration+1}_derivative{ch}')
        if test is None or test[0] is None:failed=True;break
        cols.append((test[0]-residual)/(xp[ch]-x[ch]))
    if failed:status='finite_difference_failed';break
    J=np.array(cols).T;H=J.T@J;g=J.T@residual
    step=np.linalg.solve(H+lm*np.diag(np.maximum(np.diag(H),1e-8))+1e-8*np.eye(9),-g)
    step=np.clip(step,-3*(1+np.abs(x)),3*(1+np.abs(x)))
    before=score;accepted=False
    for rate in protocol['lineSearch']:
        candidate=np.clip(x+rate*step,low,high);test=evaluate(candidate,f'iteration{iteration+1}_rate{rate}')
        if test is not None and test[0] is not None and test[2]<score:
            x=candidate;residual,pred,score=test;accepted=True;break
    history.append({'iteration':iteration+1,'before':before,'after':score,'accepted':accepted,'damping':lm})
    lm=max(1e-8,lm/3) if accepted else min(1e6,lm*10)
    if accepted and before-score<=1e-9*max(1,before):status='small_training_improvement';break
frozen=x*scale
frozen_copy=frozen.copy()
historical=joint_training[1]
def metric(error):
    return {'axisRMSE_mm':np.sqrt(np.mean(error**2,axis=0)).tolist(),
            'meanPositionPredictionRMSE_mm':float(np.sqrt(np.mean(error.mean(axis=1)**2))),
            'syncPredictionRMSE_mm':float(np.sqrt(np.mean((error[:,0]-error[:,1])**2)))}
results=[]
for data in [training,historical]:
    for label,theta in [('initialRound72',initial),('jointT1Q2Refit',frozen)]:
        okay,positions,n=rollout(theta,data);assert okay
        continuous=positions[data['at']];pitch=data['pitch']
        mapped=np.sign(continuous)*np.floor(np.abs(continuous/pitch)+.5)*pitch;mapped=np.round(mapped,6)
        active=data['active'];err=(mapped-active[:,5:7])*1000
        e=(positions[data['indices']]-data['observed'])*1000;w=data['weights']
        objective=float(np.sum(w*w*(e.mean(axis=1)**2+(e[:,0]-e[:,1])**2)))
        results.append({'record':data['kind'],'case':label,'recordUsedForCalibration':True,'parametersFrozenBeforePostFitEvaluation':True,'initialStateOnlyOnce':True,'futureMeasuredStatesInjected':False,
            'independentValidation':False,'nativePredictionError':metric(err),'endpointPredictionError':metric(e),
            'elapsedWeightedMeanSyncSquaredError':objective,
            'modeledTaskTrackingRMSE_mm':float(np.sqrt(np.mean(((mapped.mean(axis=1)-active[:,3])*1000)**2))),
            'modeledTaskSyncRMS_mm':float(np.sqrt(np.mean(((mapped[:,0]-mapped[:,1])*1000)**2))),
            'actualTaskTrackingRMSE_mm':float(np.sqrt(np.mean(((active[:,5:7].mean(axis=1)-active[:,3])*1000)**2))),
            'actualTaskSyncRMS_mm':float(np.sqrt(np.mean(((active[:,5]-active[:,6])*1000)**2))),
            'nativeContinuousPosition_m':continuous.tolist(),
            'endpointPhaseErrors':[{'phase':name,'points':int(((data['indices']>=a)&(data['indices']<b)).sum()),'errors':metric(e[(data['indices']>=a)&(data['indices']<b)])}
                                  for name,a,b in [('prehold',0,4000),('outward',4000,8000),('targetHold',8000,10000),('return',10000,14000),('returnHold',14000,20000)]]})
assert np.array_equal(frozen,frozen_copy) and len(evaluations)<=protocol['maxEvaluations']
assert abs(.5*(results[1]['elapsedWeightedMeanSyncSquaredError']+results[3]['elapsedWeightedMeanSyncSquaredError'])+reg*float(np.sum(x*x))-score)<1e-12
out={'date':'2026-10-15','protocolSHA256':sha(HERE/'protocol.json'),'fitScriptSHA256':sha(__file__),
     'sourceHashes':[{key:data[key] for key in ['kind','raw','rawSHA256','decoded','decodedSHA256']} for data in [training,historical]],
     'initialModelSHA256':sha(initialpath),'nativeModelSHA256':sha(MODEL/'native_model.c'),'nativeLibrarySHA256':sha(MODEL/'native_model.dll'),
     'fit':{'parameters':frozen.tolist(),'initialParameters':initial.tolist(),'status':status,'initialObjective':first[2],'finalObjective':score,
            'objectiveReduction_percent':100*(first[2]-score)/first[2],'evaluations':len(evaluations),'iterations':history,
            'lowerBoundHits':np.flatnonzero(np.isclose(x,low,rtol=0,atol=1e-10)).tolist(),'upperBoundHits':np.flatnonzero(np.isclose(x,high,rtol=0,atol=1e-10)).tolist()},
     'cases':results,'allCalibrationEvaluations':evaluations,'modelStructures':1,'modelsFitted':1,'initializations':1,
     'ordinaryOnly':True,'S3R2DataRead':False,'bothRecordsUsedForCalibration':True,'newQ2HeldOutForThisModel':False,
     'noCAAdvantageOrTaskRMSMatchingObjective':True,'oldLooseQ2ExcludedFromObjective':True,
     'physicalParameterIdentificationProven':False,'instrumentExogeneityProven':False,'holdingInputWaveformRecovered':False,
     'globalOptimumOrStructureImpossibilityProven':False,'counterfactualClosedLoopValidated':False,'independentValidationPassed':False,
     'newModelAdmitted':False,'modelClosureComplete':False,'rawOrControllerChanged':False,'newPhysicalRunReleased':False,'assistantHardwareAction':False}
with (HERE/'fit_results.json').open('x',encoding='utf-8') as f:json.dump(out,f,ensure_ascii=False,indent=2,allow_nan=False)
print(json.dumps({'fit':out['fit'],'cases':[{k:v for k,v in r.items() if k not in ['nativeContinuousPosition_m','endpointPhaseErrors']} for r in results]},ensure_ascii=False))
