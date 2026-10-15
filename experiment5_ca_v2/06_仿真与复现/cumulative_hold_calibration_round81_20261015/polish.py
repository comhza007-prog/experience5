import json
import numpy as np
from calibration_core import HERE,protocol,sha,load_records,residual,describe
settings=json.loads((HERE/'polish_protocol.json').read_text(encoding='utf-8'))
fit=json.loads((HERE/'fit_results.json').read_text(encoding='utf-8'))
records=load_records();initial=np.array(fit['parameters']);dimension=len(initial)
assert dimension==11
scale=np.array(protocol['parameterScales11']);low=np.array(protocol['lowerBounds11'])/scale;high=np.array(protocol['upperBounds11'])/scale
x=initial/scale;steps=.03*(1+abs(x));evaluations=[];history=[]
def evaluate(x,label):
    r=residual(x*scale,records);score=None if r is None else float(r@r)
    evaluations.append({'label':label,'parameters':(x*scale).tolist(),'objective':score})
    return score
score=evaluate(x,'initial');first=score
for iteration in range(settings['maximumPasses']):
    if len(evaluations)+2*dimension>settings['maximumEvaluations']:break
    best=score;bestx=x.copy()
    for ch in range(dimension):
        for direction in [-1,1]:
            trial=x.copy();trial[ch]=np.clip(trial[ch]+direction*steps[ch],low[ch],high[ch])
            candidate=evaluate(trial,f'pass{iteration+1}_parameter{ch}_direction{direction}')
            if candidate is not None and candidate<best:best=candidate;bestx=trial
    changed=best<score
    history.append({'pass':iteration+1,'before':score,'after':best,'improved':changed})
    x=bestx;score=best
    if not changed:steps*=.5
    if (iteration+1)%10==0:print(json.dumps({'pass':iteration+1,'objective':score,'evaluations':len(evaluations)}),flush=True)
    if max(steps)<settings['minimumMaximumStep']:break
theta=x*scale
assert score<=first and len(evaluations)<=settings['maximumEvaluations']
cases=[describe(theta,d) for d in records]
out={'parameters':theta.tolist(),'initialParameters':initial.tolist(),'initialObjective':first,'finalObjective':score,
     'fitResultsSHA256':sha(HERE/'fit_results.json'),'polishProtocolSHA256':sha(HERE/'polish_protocol.json'),
     'polishScriptSHA256':sha(__file__),'evaluations':len(evaluations),'history':history,'allEvaluations':evaluations,
     'cases':cases,'newStructureAdded':False,'newPhysicalRunReleased':False,'allRecordsUsedForCalibration':True}
with (HERE/'polish_results.json').open('x',encoding='utf-8') as f:json.dump(out,f,ensure_ascii=False,indent=2,allow_nan=False)
print(json.dumps({'finalObjective':score,'evaluations':len(evaluations),'parameters':theta.tolist(),
                  'cases':[{k:v for k,v in c.items() if k not in ['nativeContinuousPosition_m','phaseErrors']} for c in cases]},ensure_ascii=False))
