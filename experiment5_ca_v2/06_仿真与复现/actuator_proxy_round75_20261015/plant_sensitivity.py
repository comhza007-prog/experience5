import csv,ctypes,hashlib,json,math,sys
from pathlib import Path
import numpy as np
HERE=Path(__file__).resolve().parent;ROOT=HERE.parents[1];SIM=ROOT/'06_仿真与复现';MODEL=SIM/'inertia_coupling_round66_20261015'
sys.path.insert(0,str(MODEL))
from reference import mechanical_step
sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
proxy=json.loads((HERE/'fit_results.json').read_text(encoding='utf-8'))
modelpath=SIM/'t1_training_fit_round72_20261015/fit_results.json'
assert sha(modelpath)=='0efb92bb13bb6b96059cce67592f044e88c5a2d234c956280099f6b54daa6589'
theta=np.ascontiguousarray(json.loads(modelpath.read_text(encoding='utf-8'))['fit']['parameters'],float)
tau=np.array([r['parameters'][1]/1000 for r in proxy['fits']])
lib=ctypes.CDLL(str(MODEL/'native_model.dll'));arr=np.ctypeslib.ndpointer(dtype=np.float64,flags='C_CONTIGUOUS')
lib.model_rollout.argtypes=[ctypes.c_int,arr,arr,arr,arr,arr,arr];lib.model_rollout.restype=ctypes.c_int
def metric(e):return {'meanPositionPredictionRMSE_mm':float(np.sqrt(np.mean(e.mean(axis=1)**2))),
                     'syncWaveformPredictionRMSE_mm':float(np.sqrt(np.mean((e[:,0]-e[:,1])**2)))}
cases=[];verification=[]
for source in proxy['sources']:
    assert sha(source['decoded'])==source['decodedSHA256'] and sha(source['raw'])==source['rawSHA256']
    d=json.loads(Path(source['decoded']).read_text(encoding='utf-8'))
    with Path(source['raw']).open(newline='',encoding='utf-8-sig') as f:
        r=csv.reader(f);next(r);allrows=np.array([[float(v) for v in row] for row in r])
    live=allrows if source['kind']=='T1' else allrows[1:]
    active=live[(live[:,106]==1)&(live[:,2]>=2)&(live[:,2]<=5)];at=active[:,46].astype(int)-2
    assert len(at)==400
    sign=np.array([1.,-1.]);pitch=d['header']['configured_meters_per_count'];dt=[];u=[]
    for kind,a,b in [('hold',0,100),('motion',0,4000),('hold',100,150),('motion',4000,8000),('hold',150,300)]:
        for row in d['slow' if kind=='hold' else 'fast'][a:b]:
            if kind=='hold':
                dt.extend([row['dt_us']/40e6]*40);u.extend([np.array(row['command_integral_counts_us'])/row['dt_us']]*40)
            else:dt.append(row['dt_us']/1e6);u.append(row['command_counts'])
    dt=np.ascontiguousarray(dt,float);u=np.array(u,float);assert len(dt)==20000
    state=np.zeros(2);filtered=[]
    for h,request in zip(dt,u):
        decay=np.exp(-h/tau)
        filtered.append(request+(state-request)*(tau/h)*(-np.expm1(-h/tau)))
        state=decay*state+(1-decay)*request
    filtered=np.array(filtered)
    # Independent one-second constant-input fixture: exact integrated filterarea.
    fixture_dt=.001;z=0.;area=0.;T=1.;request=100.;tm=tau[0]
    for _ in range(1000):
        decay=math.exp(-fixture_dt/tm)
        avg=request+(z-request)*tm/fixture_dt*(1-decay)
        z=decay*z+(1-decay)*request;area+=avg*fixture_dt
    assert abs(area-request*(T-tm*(1-math.exp(-T/tm))))<1e-10
    for label,commands in [('unfilteredFrozenRound72',u),('unitGainProxyLagSensitivity',filtered)]:
        physical=np.ascontiguousarray(commands*sign,float);positions=np.full((20000,2),np.nan)
        assert lib.model_rollout(20000,dt,physical,np.zeros(2),np.zeros(2),theta,positions)==20000
        if label=='unitGainProxyLagSensitivity':
            p=np.zeros(2);v=np.zeros(2);maxdiff=0.;balance=0.
            for k in range(20000):
                p,v,info=mechanical_step(p,v,physical[k],dt[k],theta)
                maxdiff=max(maxdiff,float(np.max(np.abs(p-positions[k]))));balance=max(balance,abs(info['balanceResidual']))
            assert maxdiff<1e-12 and balance<1e-10
            verification.append({'record':source['kind'],'independentMechanicalSteps':20000,'maxNativePythonPositionDifference_m':maxdiff,'maxEnergyBalanceResidual':balance})
        pred=positions[at];mapped=np.sign(pred)*np.floor(np.abs(pred/pitch)+.5)*pitch;mapped=np.round(mapped,6)
        err=(mapped-active[:,5:7])*1000
        cases.append({'record':source['kind'],'case':label,'nativePredictionError':metric(err),
            'modeledTaskTrackingRMSE_mm':float(np.sqrt(np.mean(((mapped.mean(axis=1)-active[:,3])*1000)**2))),
            'modeledTaskSyncRMS_mm':float(np.sqrt(np.mean(((mapped[:,0]-mapped[:,1])*1000)**2))),
            'phaseErrors':[{'phase':phase,'errors':metric(err[active[:,2]==phase])} for phase in [2,3,4,5]],
            'nativeContinuousAxisPosition_m':pred.tolist(),'oneInitialStateWhole20s':True,'measuredFutureStatesInjected':False})
    assert sha(source['raw'])==source['rawSHA256']
out={'date':'2026-10-15','protocolSHA256':sha(HERE/'plant_sensitivity_protocol.json'),'scriptSHA256':sha(__file__),
    'proxyFitSHA256':sha(HERE/'fit_results.json'),'mechanicalModelSHA256':sha(modelpath),'tau_ms':(tau*1000).tolist(),
    'proxyGainsNotMultipliedIntoMechanicalGains':True,'cases':cases,'verification':verification,'filterIntegralFixturePassed':True,
    'modelsRefitted':0,'mechanicalParametersChanged':False,'independentValidation':False,'closedLoopAdmitted':False,
    'modelClosureComplete':False,'controllerChanged':False,'rawChanged':False,'physicalRunReleased':False}
with (HERE/'plant_sensitivity_results.json').open('x',encoding='utf-8') as f:json.dump(out,f,ensure_ascii=False,indent=2,allow_nan=False)
print(json.dumps({'tau_ms':out['tau_ms'],'cases':[{k:v for k,v in r.items() if k not in ['phaseErrors','nativeContinuousAxisPosition_m']} for r in cases],
    'verification':verification},ensure_ascii=False))
