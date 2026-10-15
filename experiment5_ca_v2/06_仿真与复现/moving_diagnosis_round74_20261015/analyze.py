import csv, ctypes, hashlib, json, sys
from pathlib import Path
import numpy as np

HERE=Path(__file__).resolve().parent;ROOT=HERE.parents[1];SIM=ROOT/'06_仿真与复现'
MODEL=SIM/'inertia_coupling_round66_20261015'
sys.path.insert(0,str(MODEL))
from reference import mechanical_step,matrices
sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
protocol=json.loads((HERE/'protocol.json').read_text(encoding='utf-8'))
modelpath=SIM/protocol['model'];assert sha(modelpath)==protocol['frozenModelSHA256']
theta=np.ascontiguousarray(json.loads(modelpath.read_text(encoding='utf-8'))['fit']['parameters'],float)
M,g,B,K,F=matrices(theta)
lam=np.linalg.eigvals(np.linalg.solve(M,B));assert np.isreal(lam).all() and np.all(lam>0)
modal={'massEigenvalues':np.linalg.eigvalsh(M).tolist(),'massDampingGeneralizedPoles_per_s':sorted(lam.tolist()),
       'timeConstants_ms':sorted((1000/lam).tolist()),'nominalLoggedPeriod_ms':1,
       'springCoefficient':float(theta[4]),'physicalHardwareConstantsIdentified':False,
       'subSampleTimeConstantAloneNotUnidentifiabilityProof':True}
checks=json.loads((MODEL/'solver_verification.json').read_text(encoding='utf-8'))
assert sha(MODEL/'native_model.dll')==checks['nativeLibrarySHA256']
lib=ctypes.CDLL(str(MODEL/'native_model.dll'));arr=np.ctypeslib.ndpointer(dtype=np.float64,flags='C_CONTIGUOUS')
lib.model_rollout.argtypes=[ctypes.c_int,arr,arr,arr,arr,arr,arr];lib.model_rollout.restype=ctypes.c_int
cont=lambda a:np.ascontiguousarray(a,dtype=np.float64)
def rollout(dt,u,p=None,v=None):
    p=np.zeros(2) if p is None else cont(p);v=np.zeros(2) if v is None else cont(v)
    out=np.full((len(dt),2),np.nan)
    assert lib.model_rollout(len(dt),cont(dt),cont(u),p,v,theta,out)==len(dt)
    return out
def metrics(e):
    return {'axisRMSE_mm':np.sqrt(np.mean(e*e,axis=0)).tolist(),
            'meanPositionPredictionRMSE_mm':float(np.sqrt(np.mean(e.mean(axis=1)**2))),
            'syncPredictionRMSE_mm':float(np.sqrt(np.mean((e[:,0]-e[:,1])**2))),
            'syncMaximumAbsolute_mm':float(np.max(np.abs(e[:,0]-e[:,1])))}
def association(x,y):
    A=np.column_stack([x,np.ones(len(x))]);coef=np.linalg.lstsq(A,y,rcond=None)[0];err=y-A@coef
    return {'samples':len(x),'slope':float(coef[0]),'intercept_counts':float(coef[1]),
            'correlation':float(np.corrcoef(x,y)[0,1]),'residualRMS_counts':float(np.sqrt(np.mean(err*err))),
            'notCausalOrCalibratedTorqueGain':True}
all_results=[];source_info=[];independent=[]
for kind,rel in zip(['T1','newQ2'],protocol['sources']):
    p=SIM/rel;d=json.loads(p.read_text(encoding='utf-8'))
    raw=Path(d.get('source',d.get('capture_audit',{}).get('source')))
    expected=d.get('sourceSHA256',d.get('capture_audit',{}).get('sourceSHA256'))
    assert sha(raw)==expected
    with raw.open(newline='',encoding='utf-8-sig') as f:
        r=csv.reader(f);assert next(r)==[f'I{k}' for k in range(107)]
        rawrows=np.array([[float(v) for v in row] for row in r])
    cuts=np.flatnonzero((np.diff(rawrows[:,0])<=0)|(np.diff(rawrows[:,1])<=0)).tolist()
    assert cuts==([] if kind=='T1' else [0])
    live=rawrows if kind=='T1' else rawrows[1:]
    source_info.append({'record':kind,'decoded':str(p),'decodedSHA256':sha(p),'raw':str(raw),'rawSHA256':expected})
    pitch=d['header']['configured_meters_per_count'];sign=np.array([1.,-1.])
    dtall=[];uall=[]
    for mode,a,b in [('hold',0,100),('motion',0,4000),('hold',100,150),('motion',4000,8000),('hold',150,300)]:
        for r in d['slow' if mode=='hold' else 'fast'][a:b]:
            if mode=='hold':
                dtall.extend([r['dt_us']/40e6]*40)
                uall.extend([np.array(r['command_integral_counts_us'])*sign/r['dt_us']]*40)
            else:dtall.append(r['dt_us']/1e6);uall.append(np.array(r['command_counts'])*sign)
    full=rollout(dtall,uall);assert len(full)==20000
    phases=[]
    for phase,first,last,anchor,step0 in [(2,0,4000,99,4000),(4,4000,8000,149,10000)]:
        rows=d['fast'][first:last];a=d['slow'][anchor];past=d['slow'][anchor-2]
        t=np.array([a['actual_us']]+[r['actual_us'] for r in rows])/1e6
        position=np.array([a['encoder']]+[r['encoder'] for r in rows],float)*sign*pitch
        dt=np.diff(t);command=np.array([r['command_counts'] for r in rows],float)
        physical=command*sign;rpm=np.array([r['rpm'] for r in rows],float)*sign
        p0=position[0];velocity0=(np.array(a['encoder'])-np.array(past['encoder']))*sign*pitch/((a['actual_us']-past['actual_us'])/1e6)
        conditional=rollout(dt,physical,p0,velocity0)
        reference_p=p0.copy();reference_v=velocity0.copy();difference=0.;balance=0.
        for k in range(4000):
            reference_p,reference_v,info=mechanical_step(reference_p,reference_v,physical[k],dt[k],theta)
            difference=max(difference,float(np.max(np.abs(reference_p-conditional[k]))));balance=max(balance,abs(info['balanceResidual']))
        assert difference<1e-12 and balance<1e-10
        independent.append({'record':kind,'phase':phase,'steps':4000,'nativePythonMaximumDifference_m':difference,'energyBalanceMaximumResidual':balance})
        native=live[(live[:,2]==phase)&(live[:,106]==1)]
        endstep=native[:,46].astype(int)-1;local=endstep-step0
        assert len(native)==100 and np.all((local>=0)&(local<4000))
        # Endpoint index0 is the observed anchor; prior whole-model endpoint is step0-1.
        cond_endpoints=np.vstack([p0,conditional])[local]
        full_endpoints=full[endstep-1]
        matched=[];rpm_mismatch=0;encoder_mismatch=0;new_command_mismatch=0
        for v,step in zip(native,local):
            if step==0:continue
            j=int(step)-1;r=rows[j]
            rpm_mismatch+=not np.array_equal(v[80:82],r['rpm'])
            encoder_mismatch+=not np.all(np.abs(v[5:7]-position[j+1])<=.5003e-6)
            if j+1<4000:new_command_mismatch+=not np.array_equal(v[13:15],rows[j+1]['command_counts'])
            if j>=10 and j+5<4000:matched.append((v,j))
        alignment={'matchedMotionFrames':len(native)-1,'rpmMismatchFrames':rpm_mismatch,'encoderMismatchFrames':encoder_mismatch,
                   'currentLiveCommandVsNextIntervalMismatchFrames':new_command_mismatch,
                   'previousQueuedIntervalNotSameFrameNewCommand':True}
        assert rpm_mismatch==encoder_mismatch==new_command_mismatch==0
        feedback=[]
        for lookback in [-5,-2,-1,0,1,2,5,10]:
            axis=[]
            for ch in [0,1]:
                x=np.array([command[j-lookback,ch] for v,j in matched])
                y=np.array([v[15+ch] for v,j in matched])
                axis.append(association(x,y))
            feedback.append({'queuedLookback_steps':lookback,'negativeMeansFutureControlNotCausalInput':lookback<0,'axis':axis})
        sensors=[]
        integrated_rpm=np.vstack([np.zeros(2),np.cumsum(rpm*dt[:,None],axis=0)])
        for width in [50,100]:
            elapsed=t[width:]-t[:-width]
            encoder_velocity=(position[width:]-position[:-width])/elapsed[:,None]
            rpm_velocity=(integrated_rpm[width:]-integrated_rpm[:-width])/elapsed[:,None]*pitch*8192/60
            residual=(encoder_velocity-rpm_velocity)*1000
            sensors.append({'windowSteps':width,'windows':len(elapsed),'encoderMinusRPMVelocityMean_mm_s':residual.mean(axis=0).tolist(),
                 'encoderMinusRPMVelocityRMS_mm_s':np.sqrt(np.mean(residual*residual,axis=0)).tolist(),
                 'meanResidualEquivalentRawRPM':(residual.mean(axis=0)/1000/(pitch*8192/60)*sign).tolist(),
                 'encoderRMS_mm_s':(1000*np.sqrt(np.mean(encoder_velocity**2,axis=0))).tolist(),
                 'rpmRMS_mm_s':(1000*np.sqrt(np.mean(rpm_velocity**2,axis=0))).tolist(),
                 'noSensorBiasDelayOrQuantizerFitted':True,'endSampleRPMIntegralNotContinuousTruth':True})
        phases.append({'phase':phase,'initialPosition_mm':(p0*1000).tolist(),'initialEncoder80StepVelocity_mm_s':(velocity0*1000).tolist(),
            'initialVelocityWindow_ms':(a['actual_us']-past['actual_us'])/1000,
            'conditional4s1msErrors':metrics((conditional-position[1:])*1000),
            'fullTask4s1msErrors':metrics((full[step0:step0+4000]-position[1:])*1000),
            'conditionalNative100Errors':metrics((cond_endpoints-native[:,5:7])*1000),
            'fullTaskNative100Errors':metrics((full_endpoints-native[:,5:7])*1000),
            'conditionalVsFullNativeDifference':metrics((cond_endpoints-full_endpoints)*1000),
            'nativeInitialStateNotGroundTruthVelocity':True,'conditionalPredictionNotFullModelValidation':True,
            'alignment':alignment,'reportedCurrentAssociationsFixedLookbacks':feedback,'encoderRPMDiagnostics':sensors})
    all_results.append({'record':kind,'phases':phases,
        'supplyVoltageDuringActive_V':[float(live[(live[:,106]==1),27].min()),float(live[(live[:,106]==1),27].max())],
        'reportedBMSValidDuringActive':bool(np.all(live[(live[:,106]==1),73]==1))})
    assert sha(raw)==expected
assert sha(modelpath)==protocol['frozenModelSHA256']
out={'date':'2026-10-15','protocolSHA256':sha(HERE/'protocol.json'),'scriptSHA256':sha(__file__),
     'sourceInfo':source_info,'frozenModelSHA256':sha(modelpath),'nativeLibrarySHA256':sha(MODEL/'native_model.dll'),
     'modelModeDiagnostics':modal,'records':all_results,'independentConditionalPythonChecks':independent,
     'modelsFitted':0,'parametersChanged':False,'newQ2UsedForCalibration':False,'S3R2DataRead':False,
     'fullModelAdmitted':False,'modelClosureComplete':False,'rawOrControlChanged':False,
     'singleMismatchCauseProven':False,'additionalPhysicalRunReleased':False,'assistantHardwareAction':False}
with (HERE/'audit_results.json').open('x',encoding='utf-8') as f:json.dump(out,f,ensure_ascii=False,indent=2,allow_nan=False)
brief={'modal':modal,'records':[],'independentlyCheckedSteps':sum(r['steps'] for r in independent)}
for r in all_results:
    brief['records'].append({'record':r['record'],'phases':[{'phase':p['phase'],'initialPosition_mm':p['initialPosition_mm'],
        'initialVelocity_mm_s':p['initialEncoder80StepVelocity_mm_s'],'fullErrors':p['fullTaskNative100Errors'],
        'conditionalErrors':p['conditionalNative100Errors'],'alignment':p['alignment'],
        'currentAssociationAtQueuedZeroLag':next(v['axis'] for v in p['reportedCurrentAssociationsFixedLookbacks'] if v['queuedLookback_steps']==0),
        'encoderRPM50steps':p['encoderRPMDiagnostics'][0]} for p in r['phases']]})
print(json.dumps(brief,ensure_ascii=False))
