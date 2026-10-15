import importlib.util,json,sys
from pathlib import Path
import numpy as np
HERE=Path(__file__).resolve().parent;ROOT=HERE.parents[1]
R82=ROOT/'06_仿真与复现/tracking_refine_round82_20261015'
sys.path.insert(0,str(R82))
from calibration_core import load_records,sha,newlib,contig
spec=importlib.util.spec_from_file_location('static_reference',ROOT/'06_仿真与复现/cumulative_hold_calibration_round81_20261015/reference.py')
reference=importlib.util.module_from_spec(spec);spec.loader.exec_module(reference)
analysis=json.loads((HERE/'analysis.json').read_text(encoding='utf-8'))
assert sha(analysis['frozenParameters'])==analysis['frozenParametersSHA256']
theta=np.array(analysis['parameters']);d=next(r for r in load_records() if r['name']=='Q2_run03')
quadratic=json.loads((HERE/'quadratic_input_hypotheses.json').read_text(encoding='utf-8'))
quad=np.array(next(r for r in quadratic if r['record']=='Q2_run03')['inputs'])
flat=d['u'].copy()
for block in analysis['holdingInputAudits']:
    if block['record']!='Q2_run03' or block['case']!='hold_start_then_flat' or not block['anchorObserved']:continue
    a,b=block['start'],block['end'];anchor=np.array(block['anchor_counts']);h=d['dt'][a:b]
    target=d['u'][a:b].T@h;flat[a]=anchor;flat[a+1:b]=(target-anchor*h[0])/sum(h[1:])
checks=[];stepcount=0
for name,u in [('hold_start_then_flat',flat),('hold_start_next_mean_quadratic',quad)]:
    p=np.zeros(2);v=np.zeros(2);positions=[];balance=0.
    for command,h in zip(u,d['dt']):
        p,v,info=reference.mechanical_step(p,v,command,h,theta);positions.append(p.copy());balance=max(balance,abs(info['balanceResidual']))
    positions=np.array(positions);stepcount+=len(positions)
    expected=next(c for c in analysis['cases'] if c['record']=='Q2_run03' and c['case']==name)
    difference=float(np.max(abs(positions[d['at']]-np.array(expected['nativeContinuousPosition_m']))))
    checks.append({'case':name,'steps':len(positions),'maxPythonAndCNativePositionDifference_m':difference,
                   'maximumEnergyBalanceResidual':balance,'passed':difference<1e-12 and balance<1e-10})
    print(json.dumps(checks[-1]),flush=True)

# Locate how the fixed model's stick/slip state changes; no measured state resets.
states=[]
for name,u in [('baseline',d['u']),('anchor_flat',flat)]:
    p=np.zeros(2);v=np.zeros(2);vel=[]
    for command,h in zip(u,d['dt']):
        out=np.empty(4);assert newlib.model_one(contig(p),contig(v),contig(command),float(h),contig(theta),out)==1
        p=out[:2].copy();v=out[2:].copy();vel.append(v.copy())
    states.append(np.array(vel))
rest0=abs(states[0])<=1e-12;rest1=abs(states[1])<=1e-12
different=np.flatnonzero(np.any(rest0!=rest1,axis=1))
holding=np.r_[np.arange(0,4000),np.arange(8000,10000),np.arange(14000,20000)]
change=(flat-d['u'])[holding]
switching={'record':'Q2_run03','firstDifferentModelStickSlipStep':int(different[0]+1) if len(different) else None,
           'differentModelStickSlipIntervals':len(different),
           'baselineHoldRestIntervalsPerAxis':np.sum(rest0[holding],axis=0).tolist(),
           'anchorFlatHoldRestIntervalsPerAxis':np.sum(rest1[holding],axis=0).tolist(),
           'holdingInputChangeRMS_counts':np.sqrt(np.mean(change*change,axis=0)).tolist(),
           'holdingInputChangeMaximum_counts':np.max(abs(change),axis=0).tolist(),
           'unobservedWaveformHypothesisNotPhysicalSwitchMeasurements':True}
result={'passed':all(c['passed'] for c in checks),'analysisSHA256':sha(HERE/'analysis.json'),'checkerSHA256':sha(__file__),
        'independentPythonSteps':stepcount,'checks':checks,'switchingSensitivity':switching,
        'physicalCauseIdentified':False,'actualHoldingWaveformRecovered':False,
        'frozenParametersUnchanged':sha(analysis['frozenParameters'])==analysis['frozenParametersSHA256'],
        'noNewHardwareAction':True}
with (HERE/'replay_verification.json').open('x',encoding='utf-8') as f:json.dump(result,f,ensure_ascii=False,indent=2,allow_nan=False)
print(json.dumps(result,ensure_ascii=False))
