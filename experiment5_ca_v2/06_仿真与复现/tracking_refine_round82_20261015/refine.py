import json
import numpy as np
from calibration_core import HERE,ROOT,protocol,sha,load_records,residual,describe

source=ROOT/'06_仿真与复现'/protocol['sourceModel']
assert sha(source)==protocol['sourceModelSHA256']
model=json.loads(source.read_text(encoding='utf-8'));assert model['parameters']==protocol['initialParameters']
assert sha(HERE/'native_model.c')==model['solverSourceSHA256']
assert sha(HERE/'native_model.dll')==model['solverSHA256']
records=load_records();initial=np.array(model['parameters']);dimension=len(initial)
scale=np.array(protocol['parameterScales11']);low=np.array(protocol['lowerBounds11'])/scale;high=np.array(protocol['upperBounds11'])/scale
settings=protocol['optimizer'];evaluations=[];history=[]
def evaluate(x,label):
    assert len(evaluations)<settings['maximumEvaluations']
    r=residual(x*scale,records);value=1e30 if r is None else float(r@r)
    evaluations.append({'label':label,'parameters':(x*scale).tolist(),'objective':None if r is None else value,'completed':r is not None})
    return value
bound=lambda x:np.clip(x,low,high)
x0=bound(initial/scale);points=[x0.copy()]
for ch in range(dimension):
    x=x0.copy();delta=settings['initialScaledSimplexStep']*(1+abs(x[ch]))
    x[ch]=min(high[ch],x[ch]+delta)
    if x[ch]==x0[ch]:x[ch]=max(low[ch],x[ch]-delta)
    points.append(x)
points=np.array(points);values=np.array([evaluate(x,f'initialVertex{k}') for k,x in enumerate(points)])
first=float(values[0]);status='iteration_budget'
for iteration in range(settings['maximumIterations']):
    order=np.argsort(values,kind='stable');points=points[order];values=values[order]
    if len(evaluations)+dimension+3>settings['maximumEvaluations']:status='evaluation_budget';break
    if np.max(np.abs(points[1:]-points[0]))<1e-6 and max(values)-min(values)<1e-9:status='simplex_converged';break
    centroid=np.mean(points[:-1],axis=0);worst=points[-1].copy()
    reflected=bound(centroid+settings['reflection']*(centroid-worst));fr=evaluate(reflected,f'iteration{iteration+1}_reflect')
    action='reflect'
    if fr<values[0]:
        expanded=bound(centroid+settings['expansion']*(reflected-centroid));fe=evaluate(expanded,f'iteration{iteration+1}_expand')
        if fe<fr:points[-1]=expanded;values[-1]=fe;action='expand'
        else:points[-1]=reflected;values[-1]=fr
    elif fr<values[-2]:points[-1]=reflected;values[-1]=fr
    else:
        outside=fr<values[-1]
        contracted=bound(centroid+settings['contraction']*((reflected if outside else worst)-centroid))
        fc=evaluate(contracted,f'iteration{iteration+1}_contract')
        if fc<(fr if outside else values[-1]):points[-1]=contracted;values[-1]=fc;action='contract'
        else:
            for k in range(1,dimension+1):
                points[k]=bound(points[0]+settings['shrink']*(points[k]-points[0]))
                values[k]=evaluate(points[k],f'iteration{iteration+1}_shrink{k}')
            action='shrink'
    history.append({'iteration':iteration+1,'bestObjective':float(min(values)),'action':action,'evaluations':len(evaluations)})
    if (iteration+1)%200==0:print(json.dumps(history[-1]),flush=True)
best=int(np.argmin(values));theta=points[best]*scale;score=float(values[best]);assert score<=first
cases=[]
for label,z in [('round81',initial),('round82',theta)]:
    for record in records:cases.append({'case':label,**describe(z,record)})
assert sha(source)==protocol['sourceModelSHA256']
for d in records:assert sha(d['raw'])==d['rawSHA256']
out={'protocolSHA256':sha(HERE/'protocol.json'),'refineScriptSHA256':sha(__file__),'coreScriptSHA256':sha(HERE/'calibration_core.py'),
     'solverSourceSHA256':sha(HERE/'native_model.c'),'solverSHA256':sha(HERE/'native_model.dll'),
     'sourceModelSHA256':sha(source),'sourceHashes':[{k:d[k] for k in ['name','raw','rawSHA256','decoded','decodedSHA256']} for d in records],
     'initialParameters':initial.tolist(),'parameters':theta.tolist(),'initialObjective':first,'finalObjective':score,
     'status':status,'evaluations':len(evaluations),'iterations':history,'allEvaluations':evaluations,'cases':cases,
     'sameModelStructureAndObjectiveAsRound81':True,'sameSharedParametersForAllRecords':True,
     'allThreeRecordsUsedForCalibration':True,'independentValidationPassed':False,'physicalFrictionIdentified':False,
     'rawOrFirmwareChanged':False,'hardwareAction':False,'newPhysicalRunReleased':False}
with (HERE/'fit_results.json').open('x',encoding='utf-8') as f:json.dump(out,f,ensure_ascii=False,indent=2,allow_nan=False)
print(json.dumps({'finalObjective':score,'initialObjective':first,'evaluations':len(evaluations),'status':status,
                  'cases':[{k:v for k,v in c.items() if k not in ['nativeContinuousPosition_m','phaseErrors']} for c in cases if c['case']=='round82']},ensure_ascii=False))
