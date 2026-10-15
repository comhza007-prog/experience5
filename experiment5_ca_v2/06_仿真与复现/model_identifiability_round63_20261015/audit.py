"""Fixed offline diagnostics, no fitted model, coefficient search or hardware."""
import csv
import hashlib
import json
from pathlib import Path
import numpy as np

ROOT = Path(__file__).resolve().parents[2]
Q2 = ROOT/'06_仿真与复现/identification_q2_summary40s_round61_20261015'
source = Q2/'build68012_0b743a60e6ed_analysis.json'
data = json.loads(source.read_text(encoding='utf-8'))
raw = Path(data['source'])
def sha(p):
    return hashlib.sha256(Path(p).read_bytes()).hexdigest()
assert sha(raw) == data['sourceSHA256']
assert data['qualified'] and data['header']['quality_flags'] == 0
assert len(data['fast']) == 8000 and len(data['slow']) == 300
pitch = data['header']['configured_meters_per_count']
axis_sign = np.array([1.,-1.])
with raw.open(newline='',encoding='utf-8-sig') as handle:
    reader=csv.reader(handle)
    assert next(reader)==[f'I{k}' for k in range(107)]
    live=np.array([[float(x) for x in r] for r in reader])[1:]
assert np.all(np.diff(live[:,1])==1)
moving=[]
for phase,begin,end,anchor in [(2,0,4000,99),(4,4000,8000,149)]:
    rows=data['fast'][begin:end]
    t=np.array([data['slow'][anchor]['actual_us']]+[r['actual_us'] for r in rows])*1e-6
    p=np.array([data['slow'][anchor]['encoder']]+[r['encoder'] for r in rows],float)*axis_sign*pitch
    u=np.array([r['command_counts'] for r in rows],float)*axis_sign
    rpm=np.array([r['rpm'] for r in rows],float)*axis_sign
    dt=np.diff(t)
    assert np.all(dt>0) and np.max(np.abs(dt-.001))<.0001281
    rv=rpm*pitch*8192/60
    diagnostic=[]
    for n in [50,100]:
        # Exact sums of END-sampled raw RPM, not a continuous velocity truth.
        rpm_integral=np.vstack([np.zeros(2),np.cumsum(rv*dt[:,None],axis=0)])
        elapsed=t[n:]-t[:-n]
        enc_mean=(p[n:]-p[:-n])/elapsed[:,None]
        rpm_mean=(rpm_integral[n:]-rpm_integral[:-n])/elapsed[:,None]
        error=enc_mean-rpm_mean
        diag={'window_steps':n,'windows':len(elapsed),'actualWindowRange_ms':(1000*np.array([elapsed.min(),elapsed.max()])).tolist(),
              'encoderMeanVelocityRMS_mm_s':(1000*np.sqrt(np.mean(enc_mean**2,axis=0))).tolist(),
              'RPMMeanVelocityRMS_mm_s':(1000*np.sqrt(np.mean(rpm_mean**2,axis=0))).tolist(),
              'encoderMinusRPMRMS_mm_s':(1000*np.sqrt(np.mean(error**2,axis=0))).tolist(),
              'meanDifference_mm_s':(1000*error.mean(axis=0)).tolist(),
              'correlation':[float(np.corrcoef(enc_mean[:,ch],rpm_mean[:,ch])[0,1]) for ch in range(2)],
              'zeroEncoderDisplacementFraction':np.mean(p[n:]==p[:-n],axis=0).tolist()}
        diagnostic.append(diag)
    moving.append({'phase':phase,'t':t,'p':p,'u':u,'rpm':rpm,'dt':dt,'diagnostics':diagnostic})

names=['gainL','gainR','dampingL','dampingR','reciprocalSpring','reciprocalDamping','smoothFrictionL','smoothFrictionR']
X=[]
for seg in moving:
    t,p,u,dt=seg['t'],seg['p'],seg['u'],seg['dt']
    velocity=np.zeros_like(p)
    velocity[50:]=(p[50:]-p[:-50])/(t[50:]-t[:-50])[:,None]
    for start in range(50,3901,100):
        end=start+100
        impulse=(u[start:end]*dt[start:end,None]).sum(axis=0)
        displacement=p[end]-p[start]
        skew_mid=.5*((p[start:end,1]-p[start:end,0])+(p[start+1:end+1,1]-p[start+1:end+1,0]))
        skew_integral=float(skew_mid@dt[start:end])
        skew_change=displacement[1]-displacement[0]
        fi=(np.tanh(velocity[start:end]/(pitch/.05))*dt[start:end,None]).sum(axis=0)
        X.extend([[impulse[0],0,-displacement[0],0,skew_integral,skew_change,-fi[0],0],
                  [0,impulse[1],0,-displacement[1],-skew_integral,-skew_change,0,-fi[1]]])
X=np.array(X)
scale=np.linalg.norm(X,axis=0)
present=scale>0
A=X[:,present]/scale[present]
sv=np.linalg.svd(A,compute_uv=False)
rank=int(np.linalg.matrix_rank(A))
C=np.corrcoef(A,rowvar=False)
pairs=sorted([(abs(C[i,j]),i,j) for i in range(len(names)) for j in range(i+1,len(names))],reverse=True)
rank_info={'hypothesis':names,'rows':len(X),'normalizedRank':rank,'columns':int(present.sum()),'singularValues':sv.tolist(),
           'conditionNumber':float(sv[0]/sv[-1]),'columnNorms':scale.tolist(),
           'largestAbsoluteColumnCorrelations':[{'a':names[i],'b':names[j],'correlation':float(C[i,j])} for _,i,j in pairs[:6]],
           'overlapWindowsNotPretendedIndependent':True,'fullRankNotCausalOrPhysicalIdentification':True,
           'smoothFrictionNotProofOfNoStiction':True,'noRegressionCoefficientsFitted':True}

old=json.loads((ROOT/'06_仿真与复现/model_revision_round58_20261014/candidate_verification_final.json').read_text(encoding='utf-8'))
gain=np.array(old['fit']['parameters'][:2])
holds=[]
for r in data['slow']:
    duration=r['dt_us']*1e-6
    mean=np.array(r['command_integral_counts_us'],float)*axis_sign/r['dt_us']
    amplitude=np.maximum(0,1200-np.abs(mean))
    # u=mean+A first half,mean-A second half vs constant mean: same impulse;
    # for q''=g*u, displacement differs g*A*T^2/4, finalvelocity equal.
    illustrative_offset_um=gain*amplitude*duration**2/4*1e6
    holds.append({'phase':r['phase'],'duration_ms':duration*1000,'mean_counts':mean.tolist(),
                  'illustrativeSingleIntervalOffset_um':illustrative_offset_um.tolist()})
offset=np.array([r['illustrativeSingleIntervalOffset_um'] for r in holds])
active=(live[:,106]==1)&(live[:,2]>=1)&(live[:,2]<=5)
physical=json.loads((ROOT/'06_仿真与复现/error_summary_40s_followup_round55_20261014/all_attempts_analysis_final.json').read_text(encoding='utf-8'))
# Locked exploratory paired gains from previously audited exact CSV results;
# not a task tolerance or new method-superiority criterion.
observed_gains_um=[1000*(.0578738499-.0516031976),1000*(.05767492956215886-.05301617677652704)]
out={'date':'2026-10-15','sources':{'decoded':str(source),'decodedSHA256':sha(source),'raw':str(raw),'rawSHA256':sha(raw)},
     'moving':[{'phase':s['phase'],'rows':len(s['u']),'actualDuration_s':float(s['t'][-1]-s['t'][0]),
                'positionRange_mm':(1000*np.ptp(s['p'],axis=0)).tolist(),'commandRange_counts':np.stack([s['u'].min(axis=0),s['u'].max(axis=0)],axis=1).tolist(),
                'rawRPMRange':np.stack([s['rpm'].min(axis=0),s['rpm'].max(axis=0)],axis=1).tolist(),
                'RPMEncoderDiagnostics':s['diagnostics'],
                'commandAxisCorrelation':float(np.corrcoef(s['u'].T)[0,1]),
                'bothFreshFraction':float(np.mean([r['fresh_mask']==3 for r in data['fast'][(0 if s['phase']==2 else 4000):(4000 if s['phase']==2 else 8000)]]))} for s in moving],
     'weakRegressorRank':rank_info,
     'holds':{'rows':len(holds),'nominalStepInterval':40,'durationRange_ms':[min(r['duration_ms'] for r in holds),max(r['duration_ms'] for r in holds)],
              'commandMeanRange_counts':np.stack([np.array([r['mean_counts'] for r in holds]).min(axis=0),np.array([r['mean_counts'] for r in holds]).max(axis=0)],axis=1).tolist(),
              'firstCommandTimeMomentRecorded':False,'fullCommandWaveformRecovered':False,
              'sameImpulseDifferentPositionAnalyticExample':'qdd=g*u;mean+A firsthalf/mean-A secondhalf vsconstantmean produces g*A*T^2/4 displacementdifference,zero velocitydifference atintervalend',
              'oldUnvalidatedGainUsedForIllustrationOnly':gain.tolist(),
              'illustrativeOffsetMedian_um':np.median(offset,axis=0).tolist(),'illustrativeOffsetMax_um':offset.max(axis=0).tolist(),
              'illustrationNotActualErrorOrCertifiedBound':True},
     'supplyVoltageDuringArmed':{'range_V':[float(live[active,27].min()),float(live[active,27].max())],'notAutomaticallyCalibratedCommandForceGain':True},
     'methodDiscriminationPlanning':{'previousExploratorySyncGains_um':observed_gains_um,
       'provisionalEachMethodSyncPredictionRMSEBudget_um':2,'sumOfTwoProvisionalBudgets_um':4,
       'source':'Observed exploratory gains motivate required resolution only; not application tracking tolerance/efficacy cutoff. Must freeze before independent data',
       'budgetApproved':False,'budgetMet':False,'RMSDifferenceBound':'|RMS(pred)-RMS(actual)|<=RMS(pred-actual) on same fixed clock/window',
       'modelRankingBeyondVerifiedScopeNotEstablished':True},
     'modelsFitted':0,'modelParametersChanged':False,'closedLoopModelIdentified':False,'independentValidationPassed':False,
     'controlOrRawChanged':False,'newPhysicalRunReleased':False,'assistantHardwareAction':False,
     'conclusion':'Highrate moving data permit substantially stronger endpoint/input diagnostics,notproof of causalplantidentification. Full-task input remains nonunique within40step holds. Exact1ms whole-taskinput or justified uncertainty-aware multirate treatment is required before a micrometer-resolution whole-taskprediction claim.'}
print(json.dumps(out,ensure_ascii=False))
