"""Constrained observable-subspace calibration; no firmware or hardware access."""
import importlib.util, json, sys, time
from pathlib import Path
import numpy as np
HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[1]
PRIOR=HERE.parent/'new_belt_memory_model_round100_20261015'
OLD=HERE.parent/'new_belt_joint_dynamics_round103_20261015'
sys.path.insert(0,str(PRIOR))
from model import load,sha,library,rollout,contig,describe

def save(name,obj):
    if name in ['protocol.json','subspace.json'] and (HERE/name).exists():
        assert json.loads((HERE/name).read_text(encoding='utf-8'))==obj
        return
    with (HERE/name).open('x',encoding='utf-8') as f:json.dump(obj,f,ensure_ascii=False,indent=2)

def main():
    data=load();lib=library()
    source=json.loads((PRIOR/'model_parameters.json').read_text())
    old=json.loads((OLD/'model_parameters.json').read_text())
    assert sha(OLD/'model_parameters.json')=='d3f5e02f6a63cd89f03c5705fa9d83f8a4176148517a746eeed1a71425681f09'
    base=np.array(source['parameters']);oldz=np.array(old['parameters'])
    lo=np.full(12,np.log(.05));hi=np.full(12,np.log(20.));hi[3]=np.log(1000.)
    lo[8]=(-.95-base[8])/.1;hi[8]=(.95-base[8])/.1
    for d in data:d['weights']=np.sqrt(np.diff(np.r_[0,np.cumsum(d['dt'])[d['idx']]]))/np.sqrt(2*sum(d['dt']))
    protocol=dict(authorization='User requests repairing parameter boundaries/identification instability before comparing run010 andrun011.',
        originalBoundsRetained=True,parameterBounds='Same R103 joint bounds: positive factors[.05,20], right damping upper1000; eta[-.95,.95]. Applied at EVERY evaluation and final export. These are numerical search bounds, not experimentally identified physical bounds.',
        method='SVD of time-weighted snapshot and aggregate residual Jacobian at fixed R100 anchor. Keep singular directions >=1percent of largest, at most6. Freeze orthogonal weak combinations at anchor. Fit only retained coordinates with ridge prior0.1.',
        coordinateMetric='Log-positive coefficients relative R100; eta increment divided0.1. SVD conditioning is coordinate/scale-dependent.',
        objective='Equal-record timeweighted mean/difference position residuals /0.05mm plus aggregate relative residuals /0.15 weighted5, then ridge0.1*||retained coordinates||^2. No changing objectives or polish after seeing results.',
        starts='Three fixed starts: anchor, projected oldR103 shrunk into bounds, +0.05 in every retained coordinate. <=70 LMiterations each.',
        sensitivity='After selection, refit from chosen point under +1percent and-1percent uniform observation/target perturbation, <=35iterations each; diagnostic, not statistical confidence.',
        acceptance='Report original15percent and requested20percent descriptively; neither gate selects a fit. Both records calibration only.',
        previousResultsPreserved=True,oldDataInObjective=False,modelStructureChanged=False,firmwareChanged=False,assistantHardwareAction=False,
        fundamentalLimitation='Freezing weak directions stabilizes reduced fitting, does not make all12 physical coefficients identifiable. No manufactured physical motor bounds.',
        sources=[{k:d[k] for k in ['name','raw','rawSHA256','decoded','decodedSHA256']} for d in data])
    save('protocol.json',protocol)
    def expand(x):
        z=base*np.exp(np.where(np.arange(12)==8,0,x));z[8]=base[8]+.1*x[8];return z
    def within(x):return bool(np.all(x>=lo-1e-12) and np.all(x<=hi+1e-12))
    def response(x,perturb=0.):
        assert within(x),'Global bounds violated'
        z=expand(x);blocks=[]
        for d in data:
            p=rollout(lib,z,d)
            if p is None:return None
            e=(p[d['idx']]-d['observed']*(1+perturb))*1000;w=d['weights']
            blocks.extend([w*e.mean(axis=1)/.05,w*(e[:,0]-e[:,1])/.05])
            q=p[d['at']];m=np.array([np.sqrt(np.mean(((q.mean(axis=1)-d['ref'])*1000)**2)),np.sqrt(np.mean(((q[:,0]-q[:,1])*1000)**2))])
            blocks.append(5/np.sqrt(2)*(m/(d['targets']*(1+perturb))-1)/.15)
        return np.r_[*blocks]
    zero=np.zeros(12);r0=response(zero);J0=[]
    for j in range(12):
        xp=zero.copy();xm=zero.copy();xp[j]=.001;xm[j]=-.001
        J0.append((response(xp)-response(xm))/.002)
    _,singular,Vh=np.linalg.svd(np.array(J0).T,full_matrices=False)
    rank=min(6,int(sum(singular>=singular[0]*.01)));assert rank>0
    basis=Vh[:rank].T
    save('subspace.json',dict(anchor=base.tolist(),basis=basis.tolist(),singularValues=singular.tolist(),retainedRank=rank,
        retainedConditionAtAnchor=float(singular[0]/singular[rank-1]),fullConditionAtAnchor=float(singular[0]/singular[-1]),
        frozenWeakDirections=12-rank,cutoffRelative=.01))
    evaluated=0;rejected=0
    def residual(y,perturb=0.):
        nonlocal evaluated,rejected
        x=basis@y
        if not within(x):rejected+=1;return None
        evaluated+=1;r=response(x,perturb)
        return None if r is None else np.r_[r,np.sqrt(.1)*y]
    def feasible(y):
        x=basis@y;t=1.
        for k in range(12):
            if x[k]>hi[k]:t=min(t,hi[k]/x[k])
            if x[k]<lo[k]:t=min(t,lo[k]/x[k])
        return y*max(0.,min(1.,t))*(1-1e-10)
    def optimize(start,iterations,perturb=0.):
        y=feasible(start.copy());r=residual(y,perturb)
        if r is None:
            return dict(rejectedStart=True,reason='Bound-feasible projected seed exceeded solver state guards; no fit or seed replacement performed.')
        value=float(r@r);initialLoss=value;damping=.01;history=[];begin=evaluated
        for iteration in range(iterations):
            cols=[]
            for j in range(rank):
                h=.001;rp=None
                for direction in [1,-1]:
                    yp=y.copy();yp[j]+=direction*h;rp=residual(yp,perturb)
                    if rp is not None:break
                cols.append(np.zeros_like(r) if rp is None else (rp-r)/(direction*h))
            J=np.array(cols).T;H=J.T@J;g=J.T@r;accepted=False
            for attempt in range(8):
                dampingFloor=max(0.,(np.linalg.eigvalsh(H)[-1]-1e4*np.linalg.eigvalsh(H)[0])/(1e4-1))
                delta=np.linalg.solve(H+(damping+dampingFloor)*np.eye(rank),-g)
                if max(abs(delta))>.25:delta*=.25/max(abs(delta))
                alpha=1.;trial=None
                while alpha>=1/1024:
                    yp=y+alpha*delta
                    if within(basis@yp):trial=residual(yp,perturb)
                    if trial is not None:break
                    alpha/=2
                loss=1e30 if trial is None else float(trial@trial)
                if loss<value-1e-10:
                    y=yp;r=trial;value=loss;damping=max(damping/3,1e-8);accepted=True;break
                damping=min(damping*10,1e12)
            history.append(dict(iteration=iteration,objective=value,accepted=accepted))
            if iteration%15==0:print(json.dumps(dict(iteration=iteration,perturb=perturb,loss=value,evaluations=evaluated)),flush=True)
            if not accepted and damping>=1e10:break
        return dict(coordinates=y.tolist(),parameters=expand(basis@y).tolist(),objective=value,initialObjective=initialLoss,evaluations=evaluated-begin,history=history)
    oldx=np.log(np.maximum(oldz,1e-30)/np.maximum(base,1e-30));oldx[8]=(oldz[8]-base[8])/.1
    starts=[np.zeros(rank),feasible(basis.T@oldx),feasible(np.full(rank,.05))]
    attempts=[optimize(s,70) for s in starts];fits=[f for f in attempts if 'objective' in f]
    best=min(fits,key=lambda f:f['objective']);y=np.array(best['coordinates']);z=np.array(best['parameters'])
    cases=[describe(rollout(lib,z,d),d) for d in data]
    for c in cases:c['bothWithin20Percent']=max(abs(c['trackingDifference_percent']),abs(c['syncDifference_percent']))<=20
    sensitivity=[optimize(y,35,p) for p in [-.01,.01]]
    for s in sensitivity:
        dz=np.array(s['parameters']);s['maxPositiveCoefficientRelativeChange_percent']=float(max(abs(dz[np.arange(12)!=8]/z[np.arange(12)!=8]-1))*100)
        s['etaAbsoluteChange']=float(abs(dz[8]-z[8]));s['onOriginalDataCases']=[describe(rollout(lib,dz,d),d) for d in data]
    # Only retained data sensitivity; prior excluded, so regularization cannot masquerade as data information.
    local=[]
    for j in range(rank):
        yp=y.copy();ym=y.copy();yp[j]+=.0005;ym[j]-=.0005
        if within(basis@yp) and within(basis@ym):v=(response(basis@yp)-response(basis@ym))/.001
        elif within(basis@yp):v=(response(basis@yp)-response(basis@y))/.0005
        else:v=(response(basis@y)-response(basis@ym))/.0005
        local.append(v)
    sv=np.linalg.svd(np.array(local).T,compute_uv=False)
    audit=dict(globalCoordinates=(basis@y).tolist(),lower=lo.tolist(),upper=hi.tolist(),allGlobalBoundsSatisfied=within(basis@y),
        retainedRank=rank,retainedDataJacobianCondition=float(sv[0]/sv[-1]),retainedSingularValues=sv.tolist(),
        weakDirectionsFrozenNotIdentified=12-rank,physicalParametersIdentified=False,
        effectiveGainRightLeftRatio=float(z[1]/z[0]),massCondition=float((1+abs(z[8]))/(1-abs(z[8]))),
        multiStartObjectives=[f['objective'] for f in fits],multiStartMaxCoordinateDistance=float(max(np.linalg.norm(np.array(f['coordinates'])-y) for f in fits)),
        perturbationMaxPositiveCoefficientChange_percent=max(s['maxPositiveCoefficientRelativeChange_percent'] for s in sensitivity))
    spec=importlib.util.spec_from_file_location('independent_r104_ref',PRIOR/'reference.py');ref=importlib.util.module_from_spec(spec);spec.loader.exec_module(ref)
    checks=[]
    for d in data:
        p=rollout(lib,z,d);state=np.zeros(6);native=independent=energy=0.
        for k,h in enumerate(d['dt']):
            out=np.empty(6);assert lib.model_memory_step(contig(state),contig(d['u'][k]),float(h),contig(z),out)==1
            if k%40==0:
                expected,info=ref.step(state,d['u'][k],h,z);independent=max(independent,float(max(abs(expected-out))));energy=max(energy,abs(info['energyBalanceResidual']));assert info['plasticDissipation']>=-1e-12
            state=out;native=max(native,float(max(abs(out[:2]-p[k]))))
        assert native<1e-12 and independent<1e-10 and energy<1e-10
        checks.append(dict(record=d['name'],CSteps=20000,independentSteps=500,maxNativePositionDifference=native,maxIndependentStateDifference=independent,maxEnergyBalanceResidual=energy))
    assert audit['allGlobalBoundsSatisfied']
    for d in data:assert sha(d['raw'])==d['rawSHA256'] and sha(d['decoded'])==d['decodedSHA256']
    model=dict(version='R104_bounded_observable_subspace',status='Reduced effective model calibration only; independent validation pending',parameters=z.tolist(),parameterNames=source['parameterNames'],
        solverRelativeToProject=source['solverRelativeToProject'],solverSHA256=source['solverSHA256'],solverSourceSHA256=source['solverSourceSHA256'],
        calibrationCases=cases,identifiability=audit,subspaceSHA256=sha(HERE/'subspace.json'),bothRecordsCalibration=True,physicalModelValidated=False,firmwareChanged=False)
    save('model_parameters.json',model)
    summary=dict(cases=cases,previousR103Cases=old['calibrationCases'],boundaryAndStability=audit,sensitivity=sensitivity,
        bothWithin15Percent=all(c['bothWithin15Percent'] for c in cases),bothWithin20Percent=all(c['bothWithin20Percent'] for c in cases),
        original15PercentFailuresPreserved=True,thresholdUsedToSelectFit=False,modelSHA256=sha(HERE/'model_parameters.json'),protocolSHA256=sha(HERE/'protocol.json'),
        scriptSHA256=sha(__file__),sourceHashes=protocol['sources'],verification=checks,rawAndDecodedHashesUnchanged=True,
        allFits=attempts,evaluations=evaluated,boundsRejectedBeforeRollout=rejected,
        numericalVerificationPassed=True,physicalModelValidated=False,independentValidationPassed=False,firmwareChanged=False,assistantHardwareAction=False,
        limitation='Reduced-space/prior stabilization trades freedom for robustness. Frozen weak combinations are assumptions, not identified physical truth. Recorded-input replay is not autonomous closed loop.')
    save('comparison_summary.json',summary)
    print(json.dumps(dict(cases=cases,audit=audit,summarySHA256=sha(HERE/'comparison_summary.json')),ensure_ascii=False),flush=True)
if __name__=='__main__':main()
