import csv,hashlib,json,math
from pathlib import Path
import numpy as np

HERE=Path(__file__).resolve().parent;ROOT=HERE.parents[1];SIM=ROOT/'06_仿真与复现'
sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
protocol=json.loads((HERE/'protocol.json').read_text(encoding='utf-8'))
def load(relative,expected,kind):
    p=SIM/relative;d=json.loads(p.read_text(encoding='utf-8'))
    raw=Path(d.get('source',d.get('capture_audit',{}).get('source')));assert sha(raw)==expected
    with raw.open(newline='',encoding='utf-8-sig') as f:
        r=csv.reader(f);assert next(r)==[f'I{k}' for k in range(107)]
        rawrows=np.array([[float(v) for v in row] for row in r])
    cuts=np.flatnonzero((np.diff(rawrows[:,0])<=0)|(np.diff(rawrows[:,1])<=0)).tolist()
    assert cuts==([] if kind=='T1' else [0])
    live=rawrows if kind=='T1' else rawrows[1:]
    segments=[]
    for phase,begin,step0 in [(2,0,4000),(4,4000,10000)]:
        rows=d['fast'][begin:begin+4000]
        obs=live[(live[:,2]==phase)&(live[:,106]==1)]
        endpoint=obs[:,46].astype(int)-1-step0
        assert len(obs)==100 and endpoint[0]==0 and np.all(endpoint[1:]>0)
        u=np.array([r['command_counts'] for r in rows],float);dt=np.array([r['dt_us'] for r in rows])/1e6
        for v,k in zip(obs[1:],endpoint[1:]):assert np.array_equal(v[13:15],u[k])
        segments.append({'phase':phase,'u':u,'dt':dt,'endpoint':endpoint[1:],'observation':obs[1:,15:17],
                         'initial':obs[0,15:17]})
    return {'kind':kind,'decoded':str(p),'decodedSHA256':sha(p),'raw':str(raw),'rawSHA256':expected,'segments':segments}
training=load(protocol['training'],protocol['trainingRawSHA256'],'T1')
def trajectory(segment,axis,params,jacobian=False):
    gain,tau_ms=params;tau=tau_ms/1000;z=float(segment['initial'][axis]);dg=0.;dtau=0.
    out=[];J=[]
    for h,u in zip(segment['dt'],segment['u'][:,axis]):
        decay=math.exp(-h/tau);old=z
        z=decay*old+(1-decay)*gain*u
        dg=decay*dg+(1-decay)*u
        dtau=decay*dtau+decay*h/tau**2*.001*(old-gain*u)
        out.append(z);J.append([dg,dtau])
    at=segment['endpoint']-1
    return np.array(out)[at],np.array(J)[at]
def prediction(record,axis,params):
    runs=[trajectory(s,axis,params) for s in record['segments']]
    return np.concatenate([r[0] for r in runs]),np.vstack([r[1] for r in runs])
def observed(record,axis):return np.concatenate([s['observation'][:,axis] for s in record['segments']])
def endpoint_inputs(record,axis):return np.concatenate([s['u'][s['endpoint']-1,axis] for s in record['segments']])
fits=[];gradient_checks=[]
for axis in [0,1]:
    y=observed(training,axis);scale=max(1.,float(np.std(y)));history=[];evaluations=[]
    low=np.array([protocol['gainBounds'][0],protocol['tauBounds_ms'][0]]);high=np.array([protocol['gainBounds'][1],protocol['tauBounds_ms'][1]])
    # Independent finite-difference check at the registered initialization.
    x=np.array(protocol['initialPerAxis'],float);base,J=prediction(training,axis,x)
    for ch,eps in [(0,1e-5),(1,1e-4)]:
        plus=x.copy();minus=x.copy();plus[ch]+=eps;minus[ch]-=eps
        fd=(prediction(training,axis,plus)[0]-prediction(training,axis,minus)[0])/(2*eps)
        err=float(np.max(np.abs(fd-J[:,ch])));relative=float(np.linalg.norm(fd-J[:,ch])/max(1.,np.linalg.norm(fd)))
        assert relative<1e-7
        gradient_checks.append({'axis':axis,'parameter':ch,'maximumAbsoluteDifference':err,'relativeNormDifference':relative})
    def evaluate(candidate,label):
        if len(evaluations)>=protocol['maxEvaluationsPerAxis']:return None
        pred,jac=prediction(training,axis,candidate);r=(pred-y)/scale;jac=jac/scale;loss=float(r@r)
        evaluations.append({'label':label,'parameters':candidate.tolist(),'loss':loss})
        return r,jac,loss
    r,J,loss=evaluate(x,'initial');initial_loss=loss;lm=.001
    for iteration in range(protocol['maxIterations']):
        if len(evaluations)+len(protocol['lineSearch'])>protocol['maxEvaluationsPerAxis']:break
        H=J.T@J;g=J.T@r
        direction=np.linalg.solve(H+lm*np.diag(np.maximum(np.diag(H),1e-8))+1e-10*np.eye(2),-g)
        direction=np.clip(direction,[-.5,-5],[.5,5]);before=loss;accepted=False
        for rate in protocol['lineSearch']:
            candidate=np.clip(x+rate*direction,low,high);test=evaluate(candidate,f'iteration{iteration+1}_rate{rate}')
            if test is not None and test[2]<loss:
                x=candidate;r,J,loss=test;accepted=True;break
        history.append({'iteration':iteration+1,'before':before,'after':loss,'accepted':accepted})
        lm=max(1e-8,lm/3) if accepted else min(1e6,lm*10)
        if accepted and before-loss<1e-10*max(1,before):break
    u=endpoint_inputs(training,axis);static_gain=float(np.clip((u@y)/(u@u),*protocol['gainBounds']))
    colnorm=np.linalg.norm(J,axis=0);singular=np.linalg.svd(J/colnorm,compute_uv=False)
    profile=[]
    for tau in [.05,.5,1,2,5,10,20]:
        zero=prediction(training,axis,[0,tau])[0];one=prediction(training,axis,[1,tau])[0];basis=one-zero
        gain=float(np.clip((basis@(y-zero))/(basis@basis),*protocol['gainBounds']))
        profile.append({'tau_ms':tau,'profiledGain':gain,'reportedCurrentRMSE_counts':float(np.sqrt(np.mean((zero+gain*basis-y)**2)))})
    fits.append({'axis':axis,'parameters':x.tolist(),'initialParameters':protocol['initialPerAxis'],'initialLoss':initial_loss,'finalLoss':loss,
        'evaluationCount':len(evaluations),'iterations':history,'allEvaluations':evaluations,'staticGain':static_gain,
        'normalizedJacobianCondition':float(singular[0]/singular[-1]),'normalizedJacobianSingularValues':singular.tolist(),
        'boundHits':{'lower':np.flatnonzero(np.isclose(x,low)).tolist(),'upper':np.flatnonzero(np.isclose(x,high)).tolist()},
        'fixedTrainingTauProfile':profile})
# Freeze before opening/evaluating newQ2; there is no model-selection feedback.
frozen=[r['parameters'].copy() for r in fits]
check=load(protocol['crossRecordCheck'],protocol['crossRecordRawSHA256'],'newQ2')
evaluations=[];integrator_checks=[]
for record in [training,check]:
    for axis in [0,1]:
        params=frozen[axis]
        for segment in record['segments']:
            pred,_=trajectory(segment,axis,params);y=segment['observation'][:,axis]
            u=segment['u'][segment['endpoint']-1,axis];static=fits[axis]['staticGain']*u
            dynamic_rmse=float(np.sqrt(np.mean((pred-y)**2)));static_rmse=float(np.sqrt(np.mean((static-y)**2)))
            evaluations.append({'record':record['kind'],'phase':segment['phase'],'axis':axis,'predictedEndpoints':len(y),
                'dynamicRMSE_counts':dynamic_rmse,'staticRMSE_counts':static_rmse,
                'dynamicVsStaticRMSEChange_percent':100*(dynamic_rmse/static_rmse-1),
                'dynamicMeanResidual_counts':float(np.mean(pred-y)),'dynamicResidualMaximumAbsolute_counts':float(np.max(np.abs(pred-y))),
                'observedRMS_counts':float(np.sqrt(np.mean(y*y))),'correlation':float(np.corrcoef(pred,y)[0,1]),
                'prediction_counts':pred.tolist(),'observation_counts':y.tolist()})
            # Independent trapezoid integration with maxsubstep=tau/100.
            z=float(segment['initial'][axis]);gain,tau_ms=params;tau=tau_ms/1000;numeric=[]
            for h,u0 in zip(segment['dt'],segment['u'][:,axis]):
                n=max(1,math.ceil(h/(tau/100)));a=h/n/(2*tau)
                factor=(1-a)/(1+a)
                for _ in range(n):z=factor*z+(1-factor)*gain*u0
                numeric.append(z)
            difference=float(np.max(np.abs(np.array(numeric)[segment['endpoint']-1]-pred)))
            assert difference<.02,'Independent integration mismatch'
            integrator_checks.append({'record':record['kind'],'phase':segment['phase'],'axis':axis,'maxEndpointDifference_counts':difference,'steps':4000})
assert frozen==[r['parameters'] for r in fits]
for record in [training,check]:assert sha(record['raw'])==record['rawSHA256']
out={'date':'2026-10-15','protocolSHA256':sha(HERE/'protocol.json'),'scriptSHA256':sha(__file__),
    'sources':[{k:r[k] for k in ['kind','decoded','decodedSHA256','raw','rawSHA256']} for r in [training,check]],
    'fits':fits,'frozenParametersBeforeNewQ2':True,'cases':evaluations,'gradientVerification':gradient_checks,
    'independentIntegrationVerification':integrator_checks,
    'candidateStructuresFitted':1,'dynamicParameterCount':4,'initializationsPerAxis':1,'staticComparatorParameterCount':2,
    'newQ2UsedForCalibration':False,'newQ2CheckExploratoryNotUntouchedValidation':True,
    'reportedCurrentNotDeliveredForceOrTorque':True,'mechanicalParametersChanged':False,'proxyInsertedIntoPlant':False,
    'modelClosureComplete':False,'controllerChanged':False,'rawChanged':False,'hardwareAction':False,'newPhysicalRunReleased':False}
with (HERE/'fit_results.json').open('x',encoding='utf-8') as f:json.dump(out,f,ensure_ascii=False,indent=2,allow_nan=False)
print(json.dumps({'fits':[{k:v for k,v in r.items() if k not in ['allEvaluations','iterations','fixedTrainingTauProfile']} for r in fits],
    'cases':[{k:v for k,v in r.items() if k not in ['prediction_counts','observation_counts']} for r in evaluations],
    'maximumIndependentIntegratorDifference_counts':max(r['maxEndpointDifference_counts'] for r in integrator_checks)},ensure_ascii=False))
