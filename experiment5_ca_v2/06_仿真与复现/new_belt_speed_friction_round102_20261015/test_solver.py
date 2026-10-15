import json,importlib.util
import numpy as np
from fit import HERE,PRIOR,sha,contig,library,load,rollout
spec=importlib.util.spec_from_file_location('common_mode_reference',HERE/'reference.py');ref=importlib.util.module_from_spec(spec);spec.loader.exec_module(ref);step=ref.step
import model as previous
lib=library();rng=np.random.default_rng(101);diff=0.;energy=0.;minimumPlastic=0.
for j in range(400):
    z=np.r_[[3e-6,2e-6],rng.uniform(.01,10,2),rng.uniform(0,20,2),rng.uniform(0,.001,2),rng.uniform(-.92,.92),rng.uniform(.01,20,2),rng.uniform(.00001,.01),rng.uniform(.01,1),np.exp(rng.uniform(np.log(.00001),np.log(.02)))]
    s=np.r_[rng.uniform(-.003,.003,2),rng.uniform(-.01,.01,2),rng.uniform(-.003,.003,2)]
    if j%4==0:s[2:4]=0
    u=rng.uniform(-1200,1200,2);h=rng.uniform(.0008,.0012);out=np.empty(6)
    assert lib.model_memory_step(contig(s),contig(u),float(h),contig(z),out)==1
    expected,info=step(s,u,h,z);diff=max(diff,float(max(abs(out-expected))));energy=max(energy,abs(info['energyBalanceResidual']));minimumPlastic=min(minimumPlastic,info['plasticDissipation'])
assert diff<1e-10 and energy<1e-10 and minimumPlastic>=-1e-12
z=np.array(json.loads((PRIOR/'model_parameters.json').read_text())['parameters']);oldlib=previous.library();equivalence=[]
for d in load():
    old=previous.rollout(oldlib,z,d);new=rollout(lib,np.r_[z,1.,.001],d);delta=float(np.max(abs(old-new)));assert delta<1e-12
    equivalence.append(dict(record=d['name'],constantYieldLegacyDifference_m=delta))
result=dict(passed=True,randomCases=400,maximumIndependentStateDifference=diff,maximumEnergyBalanceResidual=energy,minimumPlasticDissipation=minimumPlastic,
    zeroTermsEquivalence=equivalence,sourceSHA256=sha(HERE/'native_model.c'),solverSHA256=sha(HERE/'native_model.dll'),scope='Numerical checks only, no physical validation')
with (HERE/'solver_tests.json').open('x',encoding='utf-8') as f:json.dump(result,f,indent=2)
print(json.dumps(result))
