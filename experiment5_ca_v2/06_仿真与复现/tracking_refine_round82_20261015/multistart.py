import json
import numpy as np
from calibration_core import HERE,ROOT,protocol,sha,load_records,residual,describe
settings=json.loads((HERE/'multistart_protocol.json').read_text(encoding='utf-8'))
base=json.loads((HERE/'fit_results.json').read_text(encoding='utf-8'))
records=load_records();scales=np.array(protocol['parameterScales11']);lo=np.array(protocol['lowerBounds11'])/scales;hi=np.array(protocol['upperBounds11'])/scales
def optimize(seed):
    assert sha(ROOT/seed['source'])==seed['sourceSHA256']
    initial=np.array(seed['parameters']);x0=initial/scales;dimension=len(x0);evaluations=[];history=[]
    clip=lambda x:np.clip(x,lo,hi)
    def evaluate(x,label):
        r=residual(x*scales,records);loss=1e30 if r is None else float(r@r)
        evaluations.append({'label':label,'parameters':(x*scales).tolist(),'objective':None if r is None else loss})
        return loss
    points=[x0.copy()]
    for ch in range(dimension):
        x=x0.copy();x[ch]=min(hi[ch],x[ch]+settings['scaledSimplexStep']*(1+abs(x[ch])))
        if x[ch]==x0[ch]:x[ch]=max(lo[ch],x[ch]-settings['scaledSimplexStep']*(1+abs(x[ch])))
        points.append(x)
    points=np.array(points);values=np.array([evaluate(x,f'initial{k}') for k,x in enumerate(points)])
    first=float(values[0])
    for iteration in range(settings['maximumIterationsPerSeed']):
        order=np.argsort(values,kind='stable');points=points[order];values=values[order]
        if len(evaluations)+dimension+3>settings['maximumEvaluationsPerSeed']:break
        if np.max(abs(points[1:]-points[0]))<1e-6 and max(values)-min(values)<1e-9:break
        centroid=np.mean(points[:-1],axis=0);worst=points[-1].copy();xr=clip(2*centroid-worst);fr=evaluate(xr,'reflect')
        if fr<values[0]:
            xe=clip(centroid+2*(xr-centroid));fe=evaluate(xe,'expand')
            points[-1],values[-1]=(xe,fe) if fe<fr else (xr,fr)
        elif fr<values[-2]:points[-1]=xr;values[-1]=fr
        else:
            outside=fr<values[-1];xc=clip(centroid+.5*((xr if outside else worst)-centroid));fc=evaluate(xc,'contract')
            if fc<(fr if outside else values[-1]):points[-1]=xc;values[-1]=fc
            else:
                for k in range(1,dimension+1):points[k]=clip(points[0]+.5*(points[k]-points[0]));values[k]=evaluate(points[k],'shrink')
        history.append({'iteration':iteration+1,'bestObjective':float(min(values))})
    selected=int(np.argmin(values));theta=points[selected]*scales;score=float(values[selected]);assert score<=first
    print(json.dumps({'seed':seed['label'],'initialObjective':first,'finalObjective':score,'evaluations':len(evaluations)}),flush=True)
    return {'label':seed['label'],'initialObjective':first,'finalObjective':score,'parameters':theta.tolist(),'evaluations':len(evaluations),'iterations':history,'allEvaluations':evaluations}
fits=[optimize(s) for s in settings['seeds']]
options=[{'label':'initial_round82','parameters':base['parameters'],'finalObjective':base['finalObjective']},*fits]
best=min(options,key=lambda f:f['finalObjective']);theta=np.array(best['parameters'])
cases=[]
for name,z in [('round81',np.array(base['initialParameters'])),('selectedRound82',theta)]:
    for d in records:cases.append({'case':name,**describe(z,d)})
out={'fitResultsSHA256':sha(HERE/'fit_results.json'),'multistartProtocolSHA256':sha(HERE/'multistart_protocol.json'),'multistartScriptSHA256':sha(__file__),
     'parameters':theta.tolist(),'selected':best['label'],'finalObjective':best['finalObjective'],'fits':fits,'cases':cases,
     'sameModelAndObjective':True,'allThreeRecordsUsedForCalibration':True,'newPhysicalRunReleased':False}
with (HERE/'multistart_results.json').open('x',encoding='utf-8') as f:json.dump(out,f,ensure_ascii=False,indent=2,allow_nan=False)
print(json.dumps({'selected':best['label'],'finalObjective':best['finalObjective'],'cases':[{k:v for k,v in c.items() if k not in ['nativeContinuousPosition_m','phaseErrors']} for c in cases if c['case']=='selectedRound82']},ensure_ascii=False))
