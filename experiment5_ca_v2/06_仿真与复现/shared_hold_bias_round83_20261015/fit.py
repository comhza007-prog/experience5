import json
import numpy as np
from calibration_core import HERE,ROOT,protocol,sha,load_records,residual,describe,rollout,library

source=ROOT/'06_仿真与复现'/protocol['sourceParametersFile']
assert sha(source)==protocol['sourceParametersSHA256']
prior=json.loads(source.read_text(encoding='utf-8'));assert prior['parameters']==protocol['initialParameters11']
records=load_records();initial11=np.array(prior['parameters']);initial13=np.r_[initial11,0.,0.]
source_lib=library(source.parent/'native_model.dll')
for d in records:
    p=np.full((20000,2),np.nan)
    assert source_lib.model_rollout(20000,d['dt'],d['u'],np.zeros(2),np.zeros(2),np.ascontiguousarray(initial11),p)==20000
    good,q,n=rollout(initial13,d);assert good and np.max(abs(p-q))<1e-12
scale=np.array(protocol['parameterScales']);lo=np.array(protocol['lowerBounds'])/scale;hi=np.array(protocol['upperBounds'])/scale
settings=protocol['optimizer'];dimension=13
def optimize(extra,index):
    initial=np.r_[initial11,extra];x0=initial/scale;trials=[];history=[]
    bound=lambda x:np.clip(x,lo,hi)
    def evaluate(x,label):
        r=residual(x*scale,records);score=1e30 if r is None else float(r@r)
        trials.append({'label':label,'parameters':(x*scale).tolist(),'objective':None if r is None else score})
        return score
    points=[x0.copy()]
    for ch in range(dimension):
        x=x0.copy();x[ch]=min(hi[ch],x[ch]+settings['simplexStep']*(1+abs(x[ch])))
        if x[ch]==x0[ch]:x[ch]=max(lo[ch],x[ch]-settings['simplexStep']*(1+abs(x[ch])))
        points.append(x)
    points=np.array(points);values=np.array([evaluate(x,f'initial{k}') for k,x in enumerate(points)]);first=float(values[0])
    for it in range(settings['maximumIterations']):
        order=np.argsort(values,kind='stable');points=points[order];values=values[order]
        if len(trials)+dimension+3>settings['maximumEvaluationsPerSeed']:break
        if np.max(abs(points[1:]-points[0]))<1e-6 and max(values)-min(values)<1e-9:break
        centroid=np.mean(points[:-1],axis=0);worst=points[-1].copy();xr=bound(2*centroid-worst);fr=evaluate(xr,'reflect')
        if fr<values[0]:
            xe=bound(centroid+2*(xr-centroid));fe=evaluate(xe,'expand')
            points[-1],values[-1]=(xe,fe) if fe<fr else (xr,fr)
        elif fr<values[-2]:points[-1]=xr;values[-1]=fr
        else:
            outside=fr<values[-1];xc=bound(centroid+.5*((xr if outside else worst)-centroid));fc=evaluate(xc,'contract')
            if fc<(fr if outside else values[-1]):points[-1]=xc;values[-1]=fc
            else:
                for k in range(1,dimension+1):points[k]=bound(points[0]+.5*(points[k]-points[0]));values[k]=evaluate(points[k],'shrink')
        history.append({'iteration':it+1,'bestObjective':float(min(values))})
    best=int(np.argmin(values));theta=points[best]*scale;score=float(values[best]);assert score<=first
    print(json.dumps({'seed':index,'initialObjective':first,'finalObjective':score,'evaluations':len(trials)}),flush=True)
    return {'seed':index,'initialParameters':initial.tolist(),'initialObjective':first,'parameters':theta.tolist(),
            'finalObjective':score,'evaluations':len(trials),'iterations':history,'allEvaluations':trials}
fits=[optimize(extra,k) for k,extra in enumerate(protocol['biasSeeds_counts'])]
best=min(fits,key=lambda f:f['finalObjective']);theta=np.array(best['parameters'])
cases=[]
for name,z in [('round82_zeroBias',initial13),('round83',theta)]:
    for d in records:cases.append({'case':name,**describe(z,d)})
assert sha(source)==protocol['sourceParametersSHA256']
for d in records:assert sha(d['raw'])==d['rawSHA256']
out={'protocolSHA256':sha(HERE/'protocol.json'),'fitScriptSHA256':sha(__file__),'coreScriptSHA256':sha(HERE/'calibration_core.py'),
     'solverSHA256':sha(HERE/'native_model.dll'),'solverSourceSHA256':sha(HERE/'native_model.c'),
     'sourceParametersSHA256':sha(source),'sourceHashes':[{k:d[k] for k in ['name','raw','rawSHA256','decoded','decodedSHA256']} for d in records],
     'zeroBiasNestingAcross60000Steps':True,'parameters':theta.tolist(),'selectedSeed':best['seed'],'finalObjective':best['finalObjective'],
     'fits':fits,'cases':cases,'oneSharedBiasPairForAllRecordsAndTimes':True,'perRecordBiases':False,
     'allThreeRecordsUsedForCalibration':True,'physicalLoadOrCurrentBiasIdentified':False,'measuredFutureStateInjected':False,
     'outputsAdjustedOrNoiseAdded':False,'rawOrFirmwareChanged':False,'newPhysicalRunReleased':False}
with (HERE/'fit_results.json').open('x',encoding='utf-8') as f:json.dump(out,f,ensure_ascii=False,indent=2,allow_nan=False)
print(json.dumps({'finalObjective':best['finalObjective'],'parameters':theta.tolist(),
                  'cases':[{k:v for k,v in c.items() if k not in ['nativeContinuousPosition_m','phaseErrors']} for c in cases if c['case']=='round83']},ensure_ascii=False))
