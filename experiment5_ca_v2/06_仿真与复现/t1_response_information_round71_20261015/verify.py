import csv, hashlib, json, sys
from pathlib import Path
import numpy as np
HERE=Path(__file__).resolve().parent;ROOT=HERE.parents[1]
MODEL=ROOT/'06_仿真与复现/inertia_coupling_round66_20261015'
sys.path.insert(0,str(MODEL))
from reference import mechanical_step
sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
audit=json.loads((HERE/'audit_results.json').read_text(encoding='utf-8'))
src=audit['sources'];assert sha(src['raw'])==src['rawSHA256'] and sha(src['decoded'])==src['decodedSHA256']
assert sha(src['frozenModel'])==src['frozenModelSHA256'] and sha(MODEL/'native_model.dll')==src['solverSHA256']
d=json.loads(Path(src['decoded']).read_text(encoding='utf-8'));pitch=d['header']['configured_meters_per_count'];sign=np.array([1.,-1.])
with Path(src['raw']).open(newline='',encoding='utf-8-sig') as f:
    reader=csv.reader(f);next(reader);live=np.array([[float(v) for v in row] for row in reader])
indices=live[(live[:,106]==1)&(live[:,2]>=2)&(live[:,2]<=5),46].astype(int)-2
dt=[];u=[]
for name,a,b in [('hold',0,100),('motion',0,4000),('hold',100,150),('motion',4000,8000),('hold',150,300)]:
    if name=='hold':
        for r in d['slow'][a:b]:
            dt.extend([r['dt_us']/40e6]*40)
            u.extend([np.array(r['command_integral_counts_us'])*sign/r['dt_us']]*40)
    else:
        for r in d['fast'][a:b]:dt.append(r['dt_us']/1e6);u.append(np.array(r['command_counts'])*sign)
p=np.zeros(2);v=np.zeros(2);pred=[];balance=0.
theta=np.array(audit['frozenModelPreview']['parameters'])
for h,command in zip(dt,u):
    p,v,info=mechanical_step(p,v,command,h,theta);pred.append(p.copy());balance=max(balance,abs(info['balanceResidual']))
pred=np.array(pred);expected=np.array(audit['frozenModelPreview']['nativeContinuousAxisPosition_m'])
diff=float(np.max(np.abs(pred[indices]-expected)));assert diff<1e-12 and balance<1e-10
bins_checked=0
for item in audit['binnedResponseData']:
    phase=item['phase'];offset=0 if phase==2 else 4000;anchor=d['slow'][99 if phase==2 else 149]
    rows=d['fast'][offset:offset+4000]
    for b in item['bins']:
        first,last=b['first'],b['last'];part=rows[first:last]
        elapsed=sum(r['dt_us'] for r in part)/1e6
        p0=np.array(rows[first-1]['encoder'] if first else anchor['encoder'])*sign*pitch
        p1=np.array(rows[last-1]['encoder'])*sign*pitch
        vv=(p1-p0)/elapsed*1000
        modal=[np.mean(vv),vv[0]-vv[1]]
        assert np.allclose(modal,b['encoderMeanSyncVelocity_mm_s'],rtol=0,atol=1e-10)
        for key,rawkey,mode in [('queuedCommonSyncCounts','command_counts','queued'),('requestedCommonSyncCounts','requested_perturbation_counts','request'),('ungatedCommonSyncCounts','ungated_modal_counts','direct')]:
            mean=np.array([sum(r[rawkey][ch]*r['dt_us'] for r in part)/sum(r['dt_us'] for r in part) for ch in range(2)])
            expected_mean=mean if mode=='direct' else np.array([(mean[0]-mean[1])/2,(mean[0]+mean[1])/2])
            assert np.allclose(expected_mean,b[key],rtol=0,atol=1e-10)
        bins_checked+=1
assert bins_checked==500
old=json.loads((ROOT/'06_仿真与复现/model_identifiability_round63_20261015/audit_results.json').read_text(encoding='utf-8'))
actual=audit['weakMechanicalRegressor']['historicalQ2'];expected=old['weakRegressorRank']
assert actual['normalizedRank']==expected['normalizedRank'] and abs(actual['conditionNumber']-expected['conditionNumber'])<1e-10
result={'passed':True,'sourceSHA256':src['rawSHA256'],'independentPythonSteps':20000,
        'nativePositionChecks':400,'maximumNativePythonPositionDifference_m':diff,'maximumEnergyBalanceResidual':balance,
        'independentExactBinChecks':bins_checked,'historicalQ2RankAndConditionReproduced':True,
        'modelValidityNotEstablished':True,'parametersChanged':False,'hardwareAction':False}
with (HERE/'verification.json').open('x',encoding='utf-8') as f:json.dump(result,f,ensure_ascii=False,indent=2)
print(json.dumps(result,ensure_ascii=False))
