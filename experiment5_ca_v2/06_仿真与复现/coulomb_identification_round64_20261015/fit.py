"""ONE ordinary-only candidate fit, boundedbudget, allattempts retained.
The20s holdingmean preview is NOTreconstructedinput or independentvalidation.
"""
import csv, ctypes, hashlib, itertools, json, os, sys
from pathlib import Path
import numpy as np

DIR=Path(__file__).resolve().parent
ROOT=DIR.parents[1]
sys.path.insert(0,str(ROOT/'06_仿真与复现/model_identifiability_round63_20261015'))
from candidate_core import mechanical_step, NAMES
protocol=json.loads((DIR/'protocol.json').read_text(encoding='utf-8'))
record=ROOT/'06_仿真与复现/identification_q2_summary40s_round61_20261015/build68012_0b743a60e6ed_analysis.json'
data=json.loads(record.read_text(encoding='utf-8'))
raw=Path(data['source'])
sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
assert sha(raw)==data['sourceSHA256'] and data['qualified']
with raw.open(newline='',encoding='utf-8-sig') as handle:
    reader=csv.reader(handle);assert next(reader)==[f'I{k}' for k in range(107)]
    live=np.array([[float(v) for v in r] for r in reader])[1:]
pitch=data['header']['configured_meters_per_count'];sgn=np.array([1.,-1.]);mpr=pitch*8192/60
lib=ctypes.CDLL(str(DIR/'native_model.dll'))
arr=np.ctypeslib.ndpointer(dtype=np.float64,flags='C_CONTIGUOUS')
lib.model_one.argtypes=[arr,arr,arr,ctypes.c_double,arr,arr];lib.model_one.restype=ctypes.c_int
lib.model_rollout.argtypes=[ctypes.c_int,arr,arr,arr,arr,arr,arr];lib.model_rollout.restype=ctypes.c_int
def array(x):return np.ascontiguousarray(x,dtype=np.float64)
def rollout(dt,u,p0,theta):
    out=np.full((len(dt),2),np.nan)
    count=lib.model_rollout(len(dt),array(dt),array(u),array(p0),array([0,0]),array(theta),out)
    return count==len(dt),out,count

# Independent Python active-set reference, before any fitting.
rng=np.random.default_rng(20261015);maximum_native_error=0.
for n in range(500):
    theta=np.r_[rng.uniform(1e-6,1e-4,2),rng.uniform(0,50,2),rng.uniform(0,10000),rng.uniform(0,20),rng.uniform(0,.2,2)]
    p=rng.uniform(-.004,.004,2);v=rng.uniform(-.1,.1,2);u=rng.uniform(-1200,1200,2);h=rng.uniform(.00075,.00125)
    q,w,info=mechanical_step(p,v,u,h,theta);native=np.empty(4)
    assert lib.model_one(array(p),array(v),array(u),h,array(theta),native)==1
    difference=float(np.max(np.abs(native-np.r_[q,w])))
    maximum_native_error=max(maximum_native_error,difference);assert difference<1e-11

segments=[]
for phase,start,end,anchor in [(2,0,4000,99),(4,4000,8000,149)]:
    rows=data['fast'][start:end]
    t=np.array([data['slow'][anchor]['actual_us']]+[r['actual_us'] for r in rows])*1e-6
    p=np.array([data['slow'][anchor]['encoder']]+[r['encoder'] for r in rows],float)*sgn*pitch
    u=np.array([r['command_counts'] for r in rows],float)*sgn
    rpm=np.array([r['rpm'] for r in rows],float)
    segments.append(dict(phase=phase,t=t,p=p,u=u,rpm=rpm,dt=np.diff(t)))

# Measurement model is a100ms AGGREGATE relation, not1ms calibration.
sensor_x=[];sensor_y=[]
for seg in segments:
    for k in range(0,4000,100):
        elapsed=seg['t'][k+100]-seg['t'][k]
        angle_mean=(seg['p'][k+100]-seg['p'][k])*sgn/elapsed/mpr
        raw_mean=(seg['rpm'][k:k+100]*seg['dt'][k:k+100,None]).sum(axis=0)/elapsed
        sensor_x.append(angle_mean);sensor_y.append(raw_mean)
sensor_x=np.array(sensor_x);sensor_y=np.array(sensor_y)
sensor=[]
for ch in range(2):
    design=np.c_[sensor_x[:,ch],np.ones(len(sensor_x))]
    theta,residual,rank,sv=np.linalg.lstsq(design,sensor_y[:,ch],rcond=None)
    predicted=design@theta
    sensor.append({'axis':ch,'gain':float(theta[0]),'offset_rpm':float(theta[1]),'windows':len(predicted),'rank':int(rank),
        'fitRMS_rpm':float(np.sqrt(np.mean((predicted-sensor_y[:,ch])**2))),
        'identityRMS_rpm':float(np.sqrt(np.mean((sensor_x[:,ch]-sensor_y[:,ch])**2))),
        'forwardResidualMean_rpm':float((predicted-sensor_y[:,ch])[:40].mean()),
        'returnResidualMean_rpm':float((predicted-sensor_y[:,ch])[40:].mean()),
        'aggregateOnlyNotInstantaneousQuantizerOrLag':True,'notControllerCorrection':True})

# Compact weak equations: Y=-sum(delta(phi)*mean_velocity); damping uses
# integralphi*dposition. Positionaffine components cancel discrete derivatives.
X=[];Y=[];selected={'rows':0,'excludedAxisRows':0}
for seg in segments:
    t,p,u,dt=seg['t'],seg['p'],seg['u'],seg['dt']
    causal=np.zeros_like(p);causal[50:]=(p[50:]-p[:-50])/(t[50:]-t[:-50])[:,None]
    for begin in range(50,3901,100):
        end=begin+100;tt=t[begin:end+1];duration=tt[-1]-tt[0];s=(tt-tt[0])/duration
        phi=s*s*(1-s)*(1-s);mid=.5*(phi[1:]+phi[:-1]);h=dt[begin:end]
        velocity=(p[begin+1:end+1]-p[begin:end])/h[:,None]
        y=-(np.diff(phi)[:,None]*velocity).sum(axis=0)
        impul=(mid[:,None]*u[begin:end]*h[:,None]).sum(axis=0)
        damping=(mid[:,None]*(p[begin+1:end+1]-p[begin:end])).sum(axis=0)
        skew=.5*((p[begin+1:end+1,1]-p[begin+1:end+1,0])+(p[begin:end,1]-p[begin:end,0]))
        spring=float((mid*h)@skew);coupling_velocity=damping[1]-damping[0]
        friction=(mid[:,None]*h[:,None]*np.sign(causal[begin:end])).sum(axis=0)
        rows=[[impul[0],0,-damping[0],0,spring,coupling_velocity,-friction[0],0],
              [0,impul[1],0,-damping[1],-spring,-coupling_velocity,0,-friction[1]]]
        for ch in range(2):
            slip_fraction=np.mean(np.abs(causal[begin:end,ch])>=2*pitch/.05)
            if abs(p[end,ch]-p[begin,ch])<4*pitch or slip_fraction<.8:
                selected['excludedAxisRows']+=1;continue
            X.append(rows[ch]);Y.append(y[ch]);selected['rows']+=1
X=np.array(X);Y=np.array(Y);norm=np.linalg.norm(X,axis=0)
assert X.shape[1]==8 and np.all(norm>0)
lower=np.array(protocol['numericalLowerBounds']);upper=np.array(protocol['numericalUpperBounds'])
A=X/norm;target=Y-X@lower;ridge=1e-6
G=A.T@A+ridge*np.eye(8);q=A.T@target;best=None
for mask in itertools.product([False,True],repeat=8):
    ix=np.flatnonzero(mask);z=np.zeros(8)
    if len(ix):z[ix]=np.linalg.solve(G[np.ix_(ix,ix)],q[ix])
    if np.any(z < -1e-15):continue
    score=float(np.linalg.norm(A@z-target)**2+ridge*(z@z))
    if best is None or score<best[0]:best=(score,z.copy())
assert best is not None
initial=np.clip(lower+np.maximum(best[1],0)/norm,lower,upper)
scale=np.array(protocol['parameterScales']);low=lower/scale;high=upper/scale
attempts=[];budget=protocol['maxObjectiveEvaluations'];reg=1e-8
def evaluate(x,label):
    if len(attempts)>=budget:return None
    theta=x*scale;predictions=[];errors=[];completed=True;counts=[]
    for seg in segments:
        okay,pred,count=rollout(seg['dt'],seg['u'],seg['p'][0],theta)
        completed=completed and okay;counts.append(count);predictions.append(pred)
        if okay:
            err=(pred-seg['p'][1:])*1000
            errors.extend([err.mean(axis=1),err[:,0]-err[:,1]])
    residual=np.r_[*errors,np.sqrt(reg)*x] if completed else None
    score=float(residual@residual) if completed else None
    attempts.append({'evaluation':len(attempts)+1,'label':label,'parameters':theta.tolist(),'completed':completed,'points':counts,'objective':score})
    return residual,predictions,score
x=np.clip(initial/scale,low,high)
baseline=evaluate(x,'initialweakfit');fit_status='initial_response_failed';iteration_history=[]
if baseline[0] is not None:
    residual,predictions,score=baseline;lm=1e-3;fit_status='fixed_iteration_budget'
    for iteration in range(protocol['maxIterations']):
        if len(attempts)+8+5>budget:fit_status='evaluation_budget';break
        jac=[];failed=False
        for ch in range(8):
            delta=1e-3*(1+abs(x[ch]));xp=x.copy();xp[ch]=min(high[ch],x[ch]+delta)
            if xp[ch]==x[ch]:xp[ch]=max(low[ch],x[ch]-delta)
            trial=evaluate(xp,f'iteration{iteration+1}_derivative{ch}')
            if trial is None or trial[0] is None:failed=True;break
            jac.append((trial[0]-residual)/(xp[ch]-x[ch]))
        if failed:fit_status='finite_difference_failed';break
        J=np.array(jac).T;normal=J.T@J;gradient=J.T@residual
        direction=np.linalg.solve(normal+lm*np.diag(np.maximum(np.diag(normal),1e-8))+1e-8*np.eye(8),-gradient)
        direction=np.clip(direction,-3*(1+np.abs(x)),3*(1+np.abs(x)))
        previous_score=score;accepted=False
        for rate in protocol['lineSearchRates']:
            proposal=np.clip(x+rate*direction,low,high)
            trial=evaluate(proposal,f'iteration{iteration+1}_rate{rate}')
            if trial is not None and trial[0] is not None and trial[2]<score:
                x=proposal;residual,predictions,score=trial;accepted=True;break
        iteration_history.append({'iteration':iteration+1,'before':previous_score,'after':score,'accepted':accepted,'damping':lm})
        lm=max(1e-8,lm/3) if accepted else min(1e6,lm*10)
        if accepted and (previous_score-score)<=1e-9*max(1,previous_score):fit_status='small_training_improvement';break
    fitted=x*scale
else:
    fitted=initial
frozen=fitted.copy()
def metrics(error):
    return {'axisRMSE_mm':np.sqrt(np.mean(error**2,axis=0)).tolist(),
            'meanPositionPredictionRMSE_mm':float(np.sqrt(np.mean(error.mean(axis=1)**2))),
            'syncPredictionRMSE_mm':float(np.sqrt(np.mean((error[:,0]-error[:,1])**2))),
            'maxAxisError_mm':np.max(np.abs(error),axis=0).tolist()}
conditional=[]
for seg in segments:
    okay,pred,count=rollout(seg['dt'],seg['u'],seg['p'][0],frozen)
    conditional.append({'phase':seg['phase'],'completed':okay,'points':count,
        'errors':metrics((pred-seg['p'][1:])*1000) if okay else None,
        'initialPositionFromPrecedingHoldEndpoint':True,'initialVelocityAssumedZero':True,
        'measuredFutureStateUsedAfterSegmentInit':False,'notWholeTaskOrIndependentValidation':True})

def holding_support(theta):
    g=theta[:2];K=theta[4]*np.array([[1,-1],[-1,1]])
    previous=np.array([0.,0.]);rows=[]
    for k,r in enumerate(data['slow']):
        if k==100:previous=np.array(data['fast'][3999]['encoder'],float)
        if k==150:previous=np.array(data['fast'][7999]['encoder'],float)
        p=np.array(r['encoder'],float)*sgn*pitch;u=np.array(r['command_integral_counts_us'],float)*sgn/r['dt_us']
        unchanged=np.all(previous==r['encoder'])
        balance=g*u-K@p
        rows.append({'phase':r['phase'],'bothEndpointsUnchanged':bool(unchanged),'stickAtObservedPositionUnderMeanInput':bool(np.all(np.abs(balance)<=theta[6:8]+1e-12))})
        previous=np.array(r['encoder'],float)
    return [{'phase':phase,'rows':sum(r['phase']==phase for r in rows),
             'unchangedRows':sum(r['phase']==phase and r['bothEndpointsUnchanged'] for r in rows),
             'unchangedRowsCompatibleWithMeanInputSticking':sum(r['phase']==phase and r['bothEndpointsUnchanged'] and r['stickAtObservedPositionUnderMeanInput'] for r in rows),
             'meanInputOnlyNotTrueWaveformOrCalibratedFrictionProof':True} for phase in [1,3,5]]

# Whole20s CONTINUOUS diagnostic using the explicit holdingmean abstraction.
def make_full_input(stress=False):
    dt=[];u=[]
    def hold(first,last):
        for r in data['slow'][first:last]:
            mean=np.array(r['command_integral_counts_us'],float)*sgn/r['dt_us']
            h=r['dt_us']*1e-6/40
            pulse=np.minimum(100.,np.maximum(0,1200-np.abs(mean))) if stress else np.zeros(2)
            # Same integral,one fixed100count pulse ordering,not actualinput.
            for k in range(40):dt.append(h);u.append(mean+(pulse if k<20 else -pulse))
    def motion(first,last):
        for r in data['fast'][first:last]:dt.append(r['dt_us']*1e-6);u.append(np.array(r['command_counts'],float)*sgn)
    hold(0,100);motion(0,4000);hold(100,150);motion(4000,8000);hold(150,300)
    return np.array(dt),np.array(u)
active=live[(live[:,106]==1)&(live[:,2]>=2)&(live[:,2]<=5)]
indices=active[:,46].astype(int)-2
assert len(active)==400 and np.all(indices>=0) and np.all(indices<20000)
assert np.all(np.abs(active[:,46]-(active[:,79]*1000+1))<.01)
full=[];preview_positions=[]
for stress in [False,True]:
    dt,u=make_full_input(stress);assert len(dt)==20000
    okay,pred,count=rollout(dt,u,[0,0],frozen)
    item={'input':'holdmeanZOH' if not stress else 'sameMean100countOrderingStress','completed':okay,'points':count,
          'initialPositionAndVelocityAssumedZeroOnce':True,'measuredStateNeverInjected':True,
          'holdingInputIsAbstractionNotRecovered1msCommands':True,'notIndependentOrClosedLoopValidation':True}
    if okay:
        pp=pred[indices];pp=np.sign(pp)*np.floor(np.abs(pp/pitch)+.5)*pitch
        pp=np.round(pp,6);actual=active[:,5:7]
        item['native40msPredictionErrors']=metrics((pp-actual)*1000)
        item['predictedTrackingRMSE_mm']=float(np.sqrt(np.mean(((pp.mean(axis=1)-active[:,3])*1000)**2)))
        item['predictedSyncRMS_mm']=float(np.sqrt(np.mean(((pp[:,0]-pp[:,1])*1000)**2)))
        item['terminalPosition_mm']=(1000*pred[-1]).tolist()
        preview_positions.append(pp)
    full.append(item)
assert np.array_equal(fitted,frozen)
boundary_names=[NAMES[i] for i in range(8) if abs(fitted[i]-lower[i])<=1e-10*max(1,upper[i]) or abs(fitted[i]-upper[i])<=1e-10*max(1,upper[i])]
out={'date':'2026-10-15','source':str(raw),'sourceSHA256':sha(raw),'decodedSHA256':sha(record),
     'protocolSHA256':sha(DIR/'protocol.json'),'nativeReferenceChecks':500,'maxNativePythonDifference':maximum_native_error,
     'measurementAggregateFit':sensor,'measurementAggregateNotCalibratedInstantaneousPipeline':True,
     'weakInitialization':{'rows':len(Y),'excludedAxisRows':selected['excludedAxisRows'],'rank':int(np.linalg.matrix_rank(A)),'conditionNumber':float(np.linalg.cond(A)),'parameters':initial.tolist(),'notCausalIdentification':True},
     'fit':{'parameterNames':NAMES,'parameters':fitted.tolist(),'initialObjective':baseline[2],'finalObjective':score if baseline[0] is not None else None,
            'status':fit_status,'iterations':iteration_history,'objectiveEvaluations':len(attempts),'maximumBudget':budget,'boundaryCoefficientNames':boundary_names,
            'trainingOnly':True,'initialStatesNotFitted':True,'modelHypothesesFitted':1,'S3R2DataRead':False,'postIndependentValidationRetuning':False},
     'conditionalMovingTrainingResponses':conditional,'holdingMeanStickingConsistency':holding_support(frozen),
     'whole20sApproximateInputPreview':full,
     'holdOrderingNative40msPositionDifference':metrics((preview_positions[1]-preview_positions[0])*1000) if len(preview_positions)==2 else None,
     'allOptimizationEvaluations':attempts,'rawOrControllerChanged':False,'hardwareAction':False,
     'physicalMassOrForceIdentified':False,'independentValidationPassed':False,'counterfactualClosedLoopAdmitted':False,'modelClosureComplete':False,
     'noModelBudgetMetClaim':True,'futureCaptureReleased':False}
print(json.dumps(out,ensure_ascii=False))
