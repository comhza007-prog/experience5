import json
import numpy as np
from model import HERE,ROOT,sha,contig,library
from reference import step
lib=library();rng=np.random.default_rng(100);maxdiff=0.;energy=0.;minimumPlastic=0.
for j in range(400):
    z=np.r_[[3e-6,2e-6],rng.uniform(.01,10,2),rng.uniform(0,20,2),rng.uniform(0,.001,2),rng.uniform(-.92,.92),rng.uniform(.01,20,2),rng.uniform(.00001,.01)]
    state=np.r_[rng.uniform(-.003,.003,2),rng.uniform(-.01,.01,2),rng.uniform(-.003,.003,2)]
    if j%4==0:state[2:4]=0
    if j%7==0:z[9:11]=0
    if j%11==0:z[11]=0
    u=rng.uniform(-1200,1200,2);h=rng.uniform(.0008,.0012);out=np.empty(6)
    assert lib.model_memory_step(contig(state),contig(u),float(h),contig(z),out)==1
    expected,info=step(state,u,h,z);maxdiff=max(maxdiff,float(max(abs(out-expected))));energy=max(energy,abs(info['energyBalanceResidual']));minimumPlastic=min(minimumPlastic,info['plasticDissipation'])
assert maxdiff<1e-10 and energy<1e-10 and minimumPlastic>=-1e-12
result=dict(passed=True,randomCases=400,maximumIndependentStateDifference=maxdiff,maximumEnergyBalanceResidual=energy,minimumPlasticDissipation=minimumPlastic,
    sourceSHA256=sha(HERE/'native_model.c'),dllSHA256=sha(HERE/'native_model.dll'),scope='Numerical/property checks only; not physical validation')
with (HERE/'solver_tests.json').open('x',encoding='utf-8') as f:json.dump(result,f,indent=2)
print(json.dumps(result))
