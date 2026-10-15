import csv, ctypes, hashlib, json, os
from pathlib import Path
import numpy as np

HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[1]
T1DIR=ROOT/'06_仿真与复现/identification_t1_fullmoving_round70_20261015'
Q2DIR=ROOT/'06_仿真与复现/identification_q2_summary40s_round61_20261015'
MODEL=ROOT/'06_仿真与复现/inertia_coupling_round66_20261015'
sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
protocol=json.loads((HERE/'protocol.json').read_text(encoding='utf-8'))
t1path=T1DIR/'build68112_d1184a41428b_analysis.json'
t1=json.loads(t1path.read_text(encoding='utf-8'))
raw=Path(t1['capture_audit']['source'])
assert sha(raw)==protocol['sourceSHA256']==t1['capture_audit']['sourceSHA256']
assert t1['capture_audit']['transportBlobIntegrityPassed'] and t1['capture_audit']['completeMotionRecordUsableForTraining']
check=json.loads((T1DIR/'build68112_d1184a41428b_verification.json').read_text(encoding='utf-8'))
assert check['passed'] and check['sourceSHA256']==sha(raw)
q2path=Q2DIR/'build68012_0b743a60e6ed_analysis.json'
q2=json.loads(q2path.read_text(encoding='utf-8'))
assert sha(q2['source'])==q2['sourceSHA256'] and q2['qualified']
with raw.open(newline='',encoding='utf-8-sig') as f:
    r=csv.reader(f);assert next(r)==[f'I{k}' for k in range(107)]
    live=np.array([[float(v) for v in row] for row in r])
sign=np.array([1.,-1.])
pitch=t1['header']['configured_meters_per_count']
manifest=json.loads((T1DIR/'request_manifest.json').read_text(encoding='utf-8'))
assert len(manifest['requests'])==8000
symbol_mismatches=sum(r['ungated_modal_counts']!=m[2:4] for r,m in zip(t1['fast'],manifest['requests']))

def segments(data):
    out=[]
    for phase,a,b,anchor in [(2,0,4000,99),(4,4000,8000,149)]:
        rows=data['fast'][a:b]
        t=np.array([data['slow'][anchor]['actual_us']]+[r['actual_us'] for r in rows])*1e-6
        p=np.array([data['slow'][anchor]['encoder']]+[r['encoder'] for r in rows],float)*sign*pitch
        u=np.array([r['command_counts'] for r in rows],float)*sign
        rpm=np.array([r['rpm'] for r in rows],float)*sign
        z=np.array([r.get('ungated_modal_counts',[0,0]) for r in rows],float)
        requested=np.array([r.get('requested_perturbation_counts',[0,0]) for r in rows],float)
        out.append(dict(phase=phase,t=t,p=p,u=u,rpm=rpm,dt=np.diff(t),z=z,requested=requested))
    return out

names=['gainL','gainR','dampingL','dampingR','reciprocalSpring','reciprocalDamping','smoothFrictionL','smoothFrictionR']
def weak_rank(segs):
    X=[]
    for s in segs:
        t,p,u,dt=[s[k] for k in ['t','p','u','dt']]
        velocity=np.zeros_like(p)
        velocity[50:]=(p[50:]-p[:-50])/(t[50:]-t[:-50])[:,None]
        for start in range(50,3901,100):
            end=start+100
            impulse=np.sum(u[start:end]*dt[start:end,None],axis=0)
            displacement=p[end]-p[start]
            skew=.5*((p[start:end,1]-p[start:end,0])+(p[start+1:end+1,1]-p[start+1:end+1,0]))
            skew_integral=float(skew@dt[start:end]);skew_change=displacement[1]-displacement[0]
            friction=np.sum(np.tanh(velocity[start:end]/(pitch/.05))*dt[start:end,None],axis=0)
            X.extend([[impulse[0],0,-displacement[0],0,skew_integral,skew_change,-friction[0],0],
                      [0,impulse[1],0,-displacement[1],-skew_integral,-skew_change,0,-friction[1]]])
    X=np.array(X);norm=np.linalg.norm(X,axis=0);assert np.all(norm>0)
    A=X/norm;sigma=np.linalg.svd(A,compute_uv=False);C=np.corrcoef(A,rowvar=False)
    pairs=sorted([(abs(C[i,j]),i,j) for i in range(8) for j in range(i+1,8)],reverse=True)
    return {'columns':names,'rows':len(X),'normalizedRank':int(np.linalg.matrix_rank(A)),
            'conditionNumber':float(sigma[0]/sigma[-1]),'singularValues':sigma.tolist(),
            'columnNorms':norm.tolist(),'largestCorrelations':[{'a':names[i],'b':names[j],'correlation':float(C[i,j])} for _,i,j in pairs[:6]],
            'coefficientsFitted':False,'rankNotStructuralOrCausalProof':True}

def modal_axis(p):
    return np.column_stack([p.mean(axis=1),p[:,0]-p[:,1]])
def bin_segment(s):
    n=16;bins=[]
    for first in range(0,4000,n):
        last=first+n;dt=s['dt'][first:last];duration=float(dt.sum())
        mean=lambda a:np.sum(a[first:last]*dt[:,None],axis=0)/duration
        physical_u=mean(s['u']);requested_raw=mean(s['requested'])
        raw_rpm=mean(s['rpm'])
        bins.append({'first':first,'last':last,'duration_s':duration,
            'queuedCommonSyncCounts':[physical_u.mean(),(physical_u[0]-physical_u[1])/2],
            'ungatedCommonSyncCounts':mean(s['z']).tolist(),
            'requestedCommonSyncCounts':[(requested_raw[0]-requested_raw[1])/2,(requested_raw[0]+requested_raw[1])/2],
            'encoderMeanSyncVelocity_mm_s':modal_axis(((s['p'][last]-s['p'][first])/duration)[None,:])[0].tolist(),
            'rpmPhysicalAxis':raw_rpm.tolist()})
    # Convert measured displacement velocity to mm/s only after the geometric transform.
    for b in bins:b['encoderMeanSyncVelocity_mm_s']=[v*1000 for v in b['encoderMeanSyncVelocity_mm_s']]
    return bins

def residual_cubic(x):
    t=np.linspace(-1,1,len(x));A=np.column_stack([np.ones(len(x)),t,t*t,t*t*t])
    return x-A@np.linalg.lstsq(A,x,rcond=None)[0]

lags=[-8,-4,-2,-1,0,1,2,4,8]
moving=segments(t1);reference=segments(q2)
response=[];bin_data=[]
for s in moving:
    bins=bin_segment(s);bin_data.append({'phase':s['phase'],'bins':bins})
    y=residual_cubic(np.array([b['encoderMeanSyncVelocity_mm_s'] for b in bins]))
    sources={key:residual_cubic(np.array([b[key] for b in bins])) for key in ['ungatedCommonSyncCounts','requestedCommonSyncCounts','queuedCommonSyncCounts']}
    correlations=[]
    for key,x in sources.items():
        for lag in lags:
            start=max(0,-lag);end=min(len(x),len(x)-lag)
            xx=x[start:end];yy=y[start+lag:end+lag]
            C=np.corrcoef(xx.T,yy.T)[:2,2:]
            correlations.append({'input':key,'lagBins':lag,'nominalLag_ms':lag*16,'pairs':len(xx),'commonSyncInputToMeanSyncVelocityCorrelation':C.tolist()})
    queued=sources['queuedCommonSyncCounts'];request=sources['requestedCommonSyncCounts'];ungated=sources['ungatedCommonSyncCounts']
    def association(x,y):
        coef=np.linalg.lstsq(x,y,rcond=None)[0];pred=x@coef
        return {'coefficientMatrix':coef.tolist(),'partialVarianceExplained':(1-np.sum((y-pred)**2,axis=0)/np.sum(y*y,axis=0)).tolist(),
                'notCausalGain':True,'sameRecordDescriptiveAssociation':True}
    response.append({'phase':s['phase'],'bins':len(bins),'nominalBin_ms':16,
        'actualBinDurationRange_ms':[1000*min(b['duration_s'] for b in bins),1000*max(b['duration_s'] for b in bins)],
        'encoderDisplacementQuantum_mm':pitch*1000,'velocityQuantumAt16ms_mm_s':pitch*1000/.016,
        'ungatedToQueuedAssociation':association(ungated,queued),'requestedToQueuedAssociation':association(request,queued),
        'fixedLagCorrelations':correlations,'lagDirection':'Positive lag means velocity after input; negative lag is a control, not a selected best lag.'})

prior=json.loads((MODEL/'fit_results.json').read_text(encoding='utf-8'))
solvercheck=json.loads((MODEL/'solver_verification.json').read_text(encoding='utf-8'))
theta=np.array(prior['fit']['parameters'],float)
assert sha(MODEL/'native_model.dll')==solvercheck['nativeLibrarySHA256']
lib=ctypes.CDLL(str(MODEL/'native_model.dll'));arr=np.ctypeslib.ndpointer(dtype=np.float64,flags='C_CONTIGUOUS')
lib.model_rollout.argtypes=[ctypes.c_int,arr,arr,arr,arr,arr,arr];lib.model_rollout.restype=ctypes.c_int
dt=[];u=[];indices=[];observed=[]
def holds(a,b):
    for r in t1['slow'][a:b]:
        mean=np.array(r['command_integral_counts_us'])*sign/r['dt_us'];h=r['dt_us']*1e-6/40
        for _ in range(40):dt.append(h);u.append(mean)
        indices.append(len(dt)-1);observed.append(np.array(r['encoder'])*sign*pitch)
def motion(a,b):
    for r in t1['fast'][a:b]:
        dt.append(r['dt_us']*1e-6);u.append(np.array(r['command_counts'])*sign)
        indices.append(len(dt)-1);observed.append(np.array(r['encoder'])*sign*pitch)
holds(0,100);motion(0,4000);holds(100,150);motion(4000,8000);holds(150,300)
dt=np.ascontiguousarray(dt);u=np.ascontiguousarray(u);indices=np.array(indices);observed=np.array(observed)
assert len(dt)==20000 and len(indices)==8300
positions=np.full((20000,2),np.nan)
completed=lib.model_rollout(len(dt),dt,u,np.zeros(2),np.zeros(2),theta,positions)
assert completed==20000 and np.isfinite(positions).all()
active=live[(live[:,106]==1)&(live[:,2]>=2)&(live[:,2]<=5)]
native_index=active[:,46].astype(int)-2
assert len(active)==400 and np.all(np.abs(active[:,46]-(active[:,79]*1000+1))<.01)
continuous_native=positions[native_index]
# Preserve the prior declared encoder/display map; do not retune the quantizer here.
npred=np.sign(continuous_native)*np.floor(np.abs(continuous_native/pitch)+.5)*pitch
npred=np.round(npred,6)
def metric(error):
    return {'axisRMSE_mm':np.sqrt(np.mean(error*error,axis=0)).tolist(),
      'meanPositionPredictionRMSE_mm':float(np.sqrt(np.mean(error.mean(axis=1)**2))),
      'syncPredictionRMSE_mm':float(np.sqrt(np.mean((error[:,0]-error[:,1])**2)))}
preview={'model':'Frozen round66, one T1 forced-input20s replay, not closed-loop simulation',
    'parameters':theta.tolist(),'steps':completed,'initialStateOnlyOnce':True,'futureMeasuredStatesInjected':False,
    'holdingMeanZOHUnverified':True,'nativeMappingUnchangedUnverifiedPhysicalQuantizer':True,
    'nativePredictionError':metric((npred-active[:,5:7])*1000),
    'modeledTaskTrackingRMSE_mm':float(np.sqrt(np.mean(((npred.mean(axis=1)-active[:,3])*1000)**2))),
    'modeledTaskSyncRMS_mm':float(np.sqrt(np.mean(((npred[:,0]-npred[:,1])*1000)**2))),
    'actualTaskTrackingRMSE_mm':t1['capture_audit']['metrics']['trackingRMSE_mm'],
    'actualTaskSyncRMS_mm':t1['capture_audit']['metrics']['syncRMS_mm'],
    'nativeContinuousAxisPosition_m':continuous_native.tolist(),
    'nativeMappedAxisPosition_m':npred.tolist(),
    'recordedEndpointErrors':metric((positions[indices]-observed)*1000),
    'phaseErrors':[{'phase':name,'points':int(((indices>=a)&(indices<b)).sum()),'errors':metric((positions[indices[(indices>=a)&(indices<b)]]-observed[(indices>=a)&(indices<b)])*1000)}
                  for name,a,b in [('prehold',0,4000),('outward',4000,8000),('targetHold',8000,10000),('return',10000,14000),('returnHold',14000,20000)]]}
out={'date':'2026-10-15','protocolSHA256':sha(HERE/'protocol.json'),'scriptSHA256':sha(__file__),
     'sources':{'raw':str(raw),'rawSHA256':sha(raw),'decoded':str(t1path),'decodedSHA256':sha(t1path),'historicalQ2':str(q2path),'Q2SHA256':sha(q2path),
               'frozenModel':str(MODEL/'fit_results.json'),'frozenModelSHA256':sha(MODEL/'fit_results.json'),'solverSHA256':sha(MODEL/'native_model.dll')},
     'allSourceRecordsRetained':True,'dataQualityDeviations':{'completionTail_s':t1['capture_audit']['completionTail_s'],'10secondTailNotMet':True,'liveShadowUnavailable':True},
     'recordedUngatedManifestMismatches':symbol_mismatches,
     'weakMechanicalRegressor':{'T1':weak_rank(moving),'historicalQ2':weak_rank(reference)},
     'responseDiagnostics':response,'binnedResponseData':bin_data,'frozenModelPreview':preview,
     'modelsFitted':0,'parametersChanged':False,'physicalIdentifiabilityProven':False,'instrumentExogeneityProven':False,
     'independentValidationPassed':False,'modelClosureComplete':False,'S3R2DataRead':False,
     'controllerOrRawChanged':False,'newPhysicalRunReleased':False,'assistantHardwareAction':False}
with (HERE/'audit_results.json').open('x',encoding='utf-8') as f:json.dump(out,f,ensure_ascii=False,indent=2,allow_nan=False)
print(json.dumps({'manifestMismatches':symbol_mismatches,'weakRanks':{k:{v:d[v] for v in ['normalizedRank','conditionNumber','largestCorrelations']} for k,d in out['weakMechanicalRegressor'].items()},
                 'responseAssociations':[{k:v for k,v in r.items() if k in ['phase','bins','ungatedToQueuedAssociation','requestedToQueuedAssociation']} for r in response],
                 'prediction':{k:v for k,v in preview.items() if k not in ['nativeContinuousAxisPosition_m','nativeMappedAxisPosition_m','phaseErrors']},
                 'modelsFitted':0},ensure_ascii=False))
