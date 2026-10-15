"""Reduced parameter freedom versus a matched full-parameter local control."""
import json
import numpy as np
from calibration_core import HERE,ROOT,protocol,sha,load_records,residual,describe
source=ROOT/'06_仿真与复现'/protocol['sourceModel'];assert sha(source)==protocol['sourceModelSHA256']
model=json.loads(source.read_text(encoding='utf-8'));initial=np.array(model['parameters'])
assert sha(HERE/'native_model.c')==model['solverSourceSHA256'] and sha(HERE/'native_model.dll')==model['solverSHA256']
records=load_records();radius=np.abs(initial)*protocol['localRelativeBound'];radius[8]=protocol['localEtaAbsoluteBound']
physical_lo=np.array(protocol['lowerBounds11']);physical_hi=np.array(protocol['upperBounds11'])
settings=protocol['optimizer']
def data_loss(z,data=records):
    r=residual(z,data)
    return None if r is None else float(r@r)
def per_record(z):
    # The core's final 11 values are the tiny common R82 parameter regularizer.
    return [float(np.sum(residual(z,[d])[:-11]**2)) for d in records]
def optimize(scheme):
    ids=np.array(scheme['freeIndices']);dimension=len(ids);evaluations=[];history=[]
    lo=np.maximum(-1,(physical_lo[ids]-initial[ids])/radius[ids]);hi=np.minimum(1,(physical_hi[ids]-initial[ids])/radius[ids])
    def expand(x):
        z=initial.copy();z[ids]+=radius[ids]*x;return z
    def evaluate(x,label):
        assert len(evaluations)<settings['maximumEvaluations']
        loss=data_loss(expand(x));penalty=scheme['driftPenaltyWeight']*float(np.mean(x*x))
        total=1e30 if loss is None else loss+penalty
        evaluations.append({'label':label,'coordinates':x.tolist(),'parameters':expand(x).tolist(),
                            'dataLoss':loss,'driftPenalty':penalty,'objective':None if loss is None else total})
        return total
    bound=lambda x:np.clip(x,lo,hi)
    points=np.vstack([np.zeros(dimension),np.eye(dimension)*settings['initialStep']])
    values=np.array([evaluate(x,f'initial{k}') for k,x in enumerate(points)])
    first=float(values[0]);status='iteration_budget'
    for iteration in range(settings['maximumIterations']):
        order=np.argsort(values,kind='stable');points=points[order];values=values[order]
        if len(evaluations)+dimension+3>settings['maximumEvaluations']:status='evaluation_budget';break
        if np.max(abs(points[1:]-points[0]))<1e-6 and max(values)-min(values)<1e-9:status='converged';break
        centroid=np.mean(points[:-1],axis=0);worst=points[-1].copy();xr=bound(2*centroid-worst);fr=evaluate(xr,'reflect')
        if fr<values[0]:
            xe=bound(centroid+2*(xr-centroid));fe=evaluate(xe,'expand');points[-1],values[-1]=(xe,fe) if fe<fr else (xr,fr)
        elif fr<values[-2]:points[-1]=xr;values[-1]=fr
        else:
            outside=fr<values[-1];xc=bound(centroid+.5*((xr if outside else worst)-centroid));fc=evaluate(xc,'contract')
            if fc<(fr if outside else values[-1]):points[-1]=xc;values[-1]=fc
            else:
                for k in range(1,dimension+1):points[k]=bound(points[0]+.5*(points[k]-points[0]));values[k]=evaluate(points[k],'shrink')
        history.append({'iteration':iteration+1,'bestObjective':float(min(values)),'evaluations':len(evaluations)})
        if (iteration+1)%150==0:print(json.dumps({'scheme':scheme['label'],**history[-1]}),flush=True)
    best=int(np.argmin(values));z=expand(points[best]);loss=data_loss(z)
    assert float(values[best])<=first
    if scheme['label']=='stable6_regularized':assert np.array_equal(z[protocol['fixedCoreIndices']],initial[protocol['fixedCoreIndices']])
    out={**scheme,'parameters':z.tolist(),'initialObjective':first,'finalDataLoss':loss,'finalObjective':float(values[best]),
         'perRecordLoss':per_record(z),'evaluations':len(evaluations),'status':status,'iterations':history,'allEvaluations':evaluations}
    print(json.dumps({k:out[k] for k in ['label','finalDataLoss','finalObjective','evaluations','status']}),flush=True)
    return out
base=data_loss(initial);baseline_per_record=per_record(initial)
fits=[optimize(s) for s in protocol['schemes']];candidate=next(f for f in fits if f['label']=='stable6_regularized')
eligible=bool(candidate['finalDataLoss']<=base and np.all(np.array(candidate['perRecordLoss'])<=1.1*np.array(baseline_per_record)))
cases=[]
for label,z in [('frozenR86',initial),*[(f['label'],np.array(f['parameters'])) for f in fits]]:
    for d in records:cases.append({'case':label,**describe(z,d)})
out={'protocolSHA256':sha(HERE/'protocol.json'),'scriptSHA256':sha(__file__),'coreSHA256':sha(HERE/'calibration_core.py'),
     'sourceModelSHA256':sha(source),'solverSHA256':sha(HERE/'native_model.dll'),'solverSourceSHA256':sha(HERE/'native_model.c'),
     'sourceHashes':[{k:d[k] for k in ['name','raw','rawSHA256','decoded','decodedSHA256']} for d in records],
     'initialParameters':initial.tolist(),'initialDataLoss':base,'initialPerRecordLoss':baseline_per_record,
     'fits':fits,'selectedCandidate':candidate['label'],'candidateEligibleForOneExploratoryTest':eligible,
     'parameters':candidate['parameters'],'finalDataLoss':candidate['finalDataLoss'],
     'dataLossReduction_percent':100*(1-candidate['finalDataLoss']/base),'cases':cases,
     'allFiveRecordsUsedForCalibration':True,'run05NoLongerHeldOut':True,'run06UsedForCalibration':False,
     'physicalModelValidated':False,'mechanicalVariabilityIdentified':False,'firmwareChanged':False,'assistantHardwareAction':False}
for d in records:assert sha(d['raw'])==d['rawSHA256'] and sha(d['decoded'])==d['decodedSHA256']
with (HERE/'fit_results.json').open('x',encoding='utf-8') as f:json.dump(out,f,ensure_ascii=False,indent=2,allow_nan=False)
print(json.dumps({'candidateEligible':eligible,'initialLoss':base,'candidateLoss':candidate['finalDataLoss'],
                  'perRecordRelativeChange_percent':(100*(np.array(candidate['perRecordLoss'])/baseline_per_record-1)).tolist(),
                  'cases':[{k:v for k,v in c.items() if k not in ['nativeContinuousPosition_m','phaseErrors']} for c in cases if c['case']=='stable6_regularized']},ensure_ascii=False))
