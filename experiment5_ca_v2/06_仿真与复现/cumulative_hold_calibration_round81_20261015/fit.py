import json
import numpy as np
from calibration_core import HERE,ROOT,PRIOR,protocol,sha,load_records,rollout,residual,describe

source=ROOT/'06_仿真与复现'/protocol['frozenR79ParametersFile']
assert sha(source)==protocol['frozenR79ParametersSHA256']
r79=np.array(json.loads(source.read_text(encoding='utf-8'))['parameters'])
records=load_records()
for d in records:
    a,p,n=rollout(r79,d);b,q,m=rollout(np.r_[r79,0.,0.],d)
    assert a and b and np.max(np.abs(p-q))<1e-12,'Zero-extra compatibility failure'
def fit(initial,budget,label):
    dimension=len(initial);scales=np.array(protocol['parameterScales11'][:dimension])
    low=np.array(protocol['lowerBounds11'][:dimension])/scales
    high=np.array(protocol['upperBounds11'][:dimension])/scales
    evaluations=[]
    def evaluate(x,tag):
        if len(evaluations)>=budget['evaluations']:return None
        r=residual(x*scales,records);loss=None if r is None else float(r@r)
        evaluations.append({'label':tag,'parameters':(x*scales).tolist(),'objective':loss,'completed':r is not None})
        return r,loss
    x=np.clip(initial/scales,low,high);r,loss=evaluate(x,'initial');assert r is not None
    initialloss=loss;lm=1e-3;history=[];stalls=0;status='iteration_budget'
    for iteration in range(budget['iterations']):
        if len(evaluations)+dimension+len(protocol['lineSearch'])>budget['evaluations']:status='evaluation_budget';break
        cols=[];failed=False
        for ch in range(dimension):
            delta=protocol['finiteDifferenceRelativeStep']*(1+abs(x[ch]));trial=x.copy()
            trial[ch]=min(high[ch],x[ch]+delta)
            if trial[ch]==x[ch]:trial[ch]=max(low[ch],x[ch]-delta)
            result=evaluate(trial,f'iteration{iteration+1}_derivative{ch}')
            if result is None or result[0] is None:failed=True;break
            cols.append((result[0]-r)/(trial[ch]-x[ch]))
        if failed:status='invalid_derivative_trial';break
        J=np.array(cols).T;H=J.T@J;g=J.T@r
        step=np.linalg.solve(H+lm*np.diag(np.maximum(np.diag(H),1e-8))+1e-8*np.eye(dimension),-g)
        step=np.clip(step,-3*(1+np.abs(x)),3*(1+np.abs(x)))
        before=loss;accepted=False
        for rate in protocol['lineSearch']:
            testx=np.clip(x+rate*step,low,high);result=evaluate(testx,f'iteration{iteration+1}_rate{rate}')
            if result is not None and result[0] is not None and result[1]<loss:
                x=testx;r,loss=result;accepted=True;break
        history.append({'iteration':iteration+1,'before':before,'after':loss,'accepted':accepted,'damping':lm})
        lm=max(1e-8,lm/3) if accepted else min(1e6,lm*10)
        stalls=0 if accepted else stalls+1
        if accepted and before-loss<=1e-10*max(1,before):status='small_improvement';break
        if stalls>=12:status='twelve_rejected_steps';break
    theta=x*scales
    return {'label':label,'dimension':dimension,'parameters':theta.tolist(),'initialParameters':initial.tolist(),
            'initialObjective':initialloss,'finalObjective':loss,'status':status,'evaluations':len(evaluations),
            'iterations':history,'allEvaluations':evaluations,
            'lowerBoundHits':np.flatnonzero(np.isclose(x,low,rtol=0,atol=1e-10)).tolist(),
            'upperBoundHits':np.flatnonzero(np.isclose(x,high,rtol=0,atol=1e-10)).tolist()}

baseline=fit(r79,protocol['nineParameterBudget'],'cumulative9')
print(json.dumps({'completed':'cumulative9','objective':baseline['finalObjective'],'evaluations':baseline['evaluations']}),flush=True)
fits=[baseline]
for k,extra in enumerate(protocol['staticExtraNumericalSeeds']):
    initial=np.r_[baseline['parameters'],extra]
    result=fit(initial,protocol['elevenParameterBudgetPerSeed'],f'static11_seed{k}')
    fits.append(result)
    print(json.dumps({'completed':result['label'],'objective':result['finalObjective'],'evaluations':result['evaluations']}),flush=True)
selected=min(fits,key=lambda f:f['finalObjective'])
cases=[]
for label,theta in [('frozenR79',r79),('cumulative9',np.array(baseline['parameters'])),('selectedCumulative',np.array(selected['parameters']))]:
    for d in records:cases.append({'case':label,**describe(theta,d)})
assert sha(source)==protocol['frozenR79ParametersSHA256']
for d in records:assert sha(d['raw'])==d['rawSHA256']
out={'date':'2026-10-15','protocolSHA256':sha(HERE/'protocol.json'),'fitScriptSHA256':sha(__file__),
     'coreScriptSHA256':sha(HERE/'calibration_core.py'),'newSolverSourceSHA256':sha(HERE/'native_model.c'),
     'newSolverLibrarySHA256':sha(HERE/'native_model.dll'),'oldSolverLibrarySHA256':sha(PRIOR/'native_model.dll'),
     'frozenR79FileSHA256':sha(source),'sourceHashes':[{k:d[k] for k in ['name','raw','rawSHA256','decoded','decodedSHA256']} for d in records],
     'zeroExtraBackCompatibilityAcross60000Steps':True,'fits':fits,'selectedFit':selected['label'],
     'parameters':selected['parameters'],'selectionCriterion':'Lowest complete cumulative training objective among declared candidates',
     'cases':cases,'allThreeRecordsNowCalibration':True,'run03RemainsIndependentValidationForR79Only':True,
     'independentValidationForNewCandidate':False,'newModelStructurePhysicallyIdentified':False,
     'rawOrControllerModified':False,'hardwareAction':False,'newPhysicalRunReleased':False}
with (HERE/'fit_results.json').open('x',encoding='utf-8') as f:json.dump(out,f,ensure_ascii=False,indent=2,allow_nan=False)
print(json.dumps({'selected':selected['label'],'parameters':selected['parameters'],'objective':selected['finalObjective'],
                  'cases':[{k:v for k,v in c.items() if k not in ['nativeContinuousPosition_m','phaseErrors']} for c in cases]},ensure_ascii=False))
