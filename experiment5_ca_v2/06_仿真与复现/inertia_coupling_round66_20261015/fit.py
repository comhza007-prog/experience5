import csv, ctypes, hashlib, json
from pathlib import Path
import numpy as np

DIR=Path(__file__).resolve().parent;ROOT=DIR.parents[1]
PREV=ROOT/'06_仿真与复现/coulomb_joint_round65_20261015'
protocol=json.loads((DIR/'protocol.json').read_text(encoding='utf-8'))
prior=json.loads((PREV/'joint_fit_results.json').read_text(encoding='utf-8'))
checks=json.loads((DIR/'solver_verification.json').read_text(encoding='utf-8'));assert checks['passed']
record=ROOT/'06_仿真与复现/identification_q2_summary40s_round61_20261015/build68012_0b743a60e6ed_analysis.json'
data=json.loads(record.read_text(encoding='utf-8'));raw=Path(data['source'])
sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
assert sha(raw)==data['sourceSHA256']==prior['sourceSHA256'] and data['qualified']
with raw.open(newline='',encoding='utf-8-sig') as f:
 r=csv.reader(f);assert next(r)==[f'I{k}' for k in range(107)]
 live=np.array([[float(v) for v in row] for row in r])[1:]
pitch=data['header']['configured_meters_per_count'];sign=np.array([1.,-1.])
lib=ctypes.CDLL(str(DIR/'native_model.dll'));arr=np.ctypeslib.ndpointer(dtype=np.float64,flags='C_CONTIGUOUS')
assert sha(DIR/'native_model.dll')==checks['nativeLibrarySHA256']
lib.model_rollout.argtypes=[ctypes.c_int,arr,arr,arr,arr,arr,arr];lib.model_rollout.restype=ctypes.c_int
asarray=lambda x:np.ascontiguousarray(x,dtype=np.float64)
def build(stress=False):
 dt=[];u=[];at=[];position=[]
 def hold(first,last):
  for row in data['slow'][first:last]:
   mean=np.array(row['command_integral_counts_us'])*sign/row['dt_us'];h=row['dt_us']*1e-6/40
   pulse=np.minimum(100.,1200-np.abs(mean)) if stress else np.zeros(2)
   for k in range(40):dt.append(h);u.append(mean+(pulse if k<20 else -pulse))
   at.append(len(dt)-1);position.append(np.array(row['encoder'])*sign*pitch)
 def motion(first,last):
  for row in data['fast'][first:last]:
   dt.append(row['dt_us']*1e-6);u.append(np.array(row['command_counts'])*sign)
   at.append(len(dt)-1);position.append(np.array(row['encoder'])*sign*pitch)
 hold(0,100);motion(0,4000);hold(100,150);motion(4000,8000);hold(150,300)
 return asarray(dt),asarray(u),np.array(at),np.array(position)
dt,u,indices,observed=build();times=np.cumsum(dt)[indices]
weights=np.sqrt(np.diff(np.r_[0,times]));assert len(dt)==20000 and len(indices)==8300 and np.all(np.diff(indices)>0)
assert abs(times[-1]-20)<.00002
scale=np.array(protocol['parameterScales']);low=np.array(protocol['lowerBounds'])/scale;high=np.array(protocol['upperBounds'])/scale
evaluations=[];reg=1e-8
def prediction(theta,dt=dt,u=u):
 out=np.full((len(dt),2),np.nan)
 n=lib.model_rollout(len(dt),dt,u,asarray([0,0]),asarray([0,0]),asarray(theta),out)
 return n==len(dt),out,n
def evaluate(x,label):
 if len(evaluations)>=protocol['maxEvaluations']:return None
 okay,pred,n=prediction(x*scale)
 if okay:
  error=(pred[indices]-observed)*1000
  r=np.r_[weights*error.mean(axis=1),weights*(error[:,0]-error[:,1]),np.sqrt(reg)*x]
  score=float(r@r)
 else:r=None;score=None
 evaluations.append({'evaluation':len(evaluations)+1,'label':label,'parameters':(x*scale).tolist(),'completed':okay,'points':n,'objective':score})
 return r,pred,score
x=np.clip(np.r_[prior['fit']['parameters'],0.]/scale,low,high);first=evaluate(x,'initialRound65etaZero');history=[];status='initial_response_failed'
if first[0] is not None:
 residual,pred,score=first;lm=1e-3;status='fixed_iteration_budget'
 for iteration in range(protocol['maxIterations']):
  if len(evaluations)+14>protocol['maxEvaluations']:status='evaluation_budget';break
  cols=[];failed=False
  for ch in range(9):
   delta=1e-3*(1+abs(x[ch]));xp=x.copy();xp[ch]=min(high[ch],x[ch]+delta)
   if xp[ch]==x[ch]:xp[ch]=max(low[ch],x[ch]-delta)
   test=evaluate(xp,f'iteration{iteration+1}_derivative{ch}')
   if test is None or test[0] is None:failed=True;break
   cols.append((test[0]-residual)/(xp[ch]-x[ch]))
  if failed:status='finite_difference_failed';break
  J=np.array(cols).T;H=J.T@J;g=J.T@residual
  direction=np.linalg.solve(H+lm*np.diag(np.maximum(np.diag(H),1e-8))+1e-8*np.eye(9),-g)
  direction=np.clip(direction,-3*(1+np.abs(x)),3*(1+np.abs(x)))
  before=score;accepted=False
  for rate in protocol['lineSearch']:
   proposal=np.clip(x+rate*direction,low,high);test=evaluate(proposal,f'iteration{iteration+1}_rate{rate}')
   if test is not None and test[0] is not None and test[2]<score:
    x=proposal;residual,pred,score=test;accepted=True;break
  history.append({'iteration':iteration+1,'before':before,'after':score,'accepted':accepted,'damping':lm})
  lm=max(1e-8,lm/3) if accepted else min(1e6,lm*10)
  if accepted and before-score<=1e-9*max(1,before):status='small_training_improvement';break
theta=x*scale;frozen=theta.copy()
def metrics(error):
 return {'axisRMSE_mm':np.sqrt(np.mean(error**2,axis=0)).tolist(),'meanPositionPredictionRMSE_mm':float(np.sqrt(np.mean(error.mean(axis=1)**2))),
         'syncPredictionRMSE_mm':float(np.sqrt(np.mean((error[:,0]-error[:,1])**2))),'maxAxisError_mm':np.max(np.abs(error),axis=0).tolist()}
active=live[(live[:,106]==1)&(live[:,2]>=2)&(live[:,2]<=5)];native_indices=active[:,46].astype(int)-2
assert len(active)==400 and np.all(np.abs(active[:,46]-(active[:,79]*1000+1))<.01)
results=[];native_predictions=[]
for case,stress in [('fittedMass',False),('holdOrderingStress',True),('etaZeroFixedOtherParameters',False)]:
 hh,uu,ii,pp=build(stress);case_theta=frozen.copy()
 if case=='etaZeroFixedOtherParameters':case_theta[8]=0.
 okay,positions,n=prediction(case_theta,hh,uu)
 result={'case':case,'input':'holdMeanZOH' if not stress else 'sameMean100countOrderingStress','completed':okay,'points':n,
         'initialStateUsedOnlyOnce':True,'measuredFutureStatesNeverInjected':True,'holdInputAbstractionNotRecoveredWaveform':True,'notIndependentOrClosedLoopValidation':True}
 if okay:
  npred=positions[native_indices];npred=np.sign(npred)*np.floor(np.abs(npred/pitch)+.5)*pitch;npred=np.round(npred,6)
  result['native40msPredictionErrors']=metrics((npred-active[:,5:7])*1000)
  result['predictedTrackingRMSE_mm']=float(np.sqrt(np.mean(((npred.mean(axis=1)-active[:,3])*1000)**2)))
  result['predictedSyncRMS_mm']=float(np.sqrt(np.mean(((npred[:,0]-npred[:,1])*1000)**2)))
  result['terminalPosition_mm']=(1000*positions[-1]).tolist()
  phase_ranges=[('prehold',0,4000),('outward',4000,8000),('targetHold',8000,10000),('return',10000,14000),('returnHold',14000,20000)]
  result['recordedEndpointPhaseErrors']=[{'phase':name,'points':int(((indices>=a)&(indices<b)).sum()),'errors':metrics((positions[indices[(indices>=a)&(indices<b)]]-observed[(indices>=a)&(indices<b)])*1000)} for name,a,b in phase_ranges]
  native_predictions.append(npred)
 results.append(result)
assert np.array_equal(theta,frozen)
out={'date':'2026-10-15','source':str(raw),'sourceSHA256':sha(raw),'protocolSHA256':sha(DIR/'protocol.json'),
     'previousFitSHA256':sha(PREV/'joint_fit_results.json'),'nativeSolverSourceSHA256':sha(DIR/'native_model.c'),'nativeLibrarySHA256':sha(DIR/'native_model.dll'),
     'fitScriptSHA256':sha(DIR/'fit.py'),'referenceSHA256':sha(DIR/'reference.py'),
     'sameMechanicalStructure':False,'addedCoefficients':1,'candidateBranches':1,'ordinaryOnly':True,'S3R2DataRead':False,
     'observedPoints':8300,'elapsedTimeWeightedLoss':True,'notIndependentObservationCount':True,
     'fit':{'parameters':theta.tolist(),'status':status,'initialObjective':first[2],'finalObjective':score if first[0] is not None else None,
            'iterations':history,'objectiveEvaluations':len(evaluations),'maximumBudget':protocol['maxEvaluations']},
     'continuous20sTrainingPreviews':results,
     'massEigenvalues':np.linalg.eigvalsh(np.array([[1.,theta[8]],[theta[8],1.]])).tolist(),
     'numericalBoundHits':{'lower':np.flatnonzero(np.isclose(x,low,rtol=0,atol=1e-10)).tolist(),'upper':np.flatnonzero(np.isclose(x,high,rtol=0,atol=1e-10)).tolist()},
     'holdOrderingNative40msDifference':metrics((native_predictions[1]-native_predictions[0])*1000) if len(native_predictions)>=2 else None,
     'etaZeroAblationOnlyConditionalSensitivityNotRetrainedOrPhysicalProof':True,
     'allCalibrationEvaluations':evaluations,'rawOrControllerChanged':False,'hardwareAction':False,
     'parametersNotPhysicalForceCalibration':True,'independentValidationPassed':False,'modelClosureComplete':False,
     'holdingZOHAssumptionUnverified':True,'instantaneousSensorModelNotCalibrated':True,'noModelResolutionBudgetMetClaim':True,'additionalPhysicalRunReleased':False}
print(json.dumps(out,ensure_ascii=False))
