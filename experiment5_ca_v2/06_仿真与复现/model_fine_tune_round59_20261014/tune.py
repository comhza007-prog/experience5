"""Bounded, ordinary-only trajectory calibration; no algorithm-win objective."""
import contextlib
import importlib.util
import io
import json
import math
from pathlib import Path
import sys
import numpy as np

HERE = Path(__file__).resolve().parent
BASE = HERE.parent/'model_revision_round58_20261014'
protocol = json.loads((HERE/'protocol.json').read_text(encoding='utf-8'))
reference = json.loads((BASE/'candidate_verification_final.json').read_text(encoding='utf-8'))
spec = importlib.util.spec_from_file_location('mechanical_candidate',BASE/'revise.py')
m = importlib.util.module_from_spec(spec)
captured = io.StringIO()
with contextlib.redirect_stdout(captured):
    spec.loader.exec_module(m)
reproduced = json.loads(captured.getvalue())
assert reproduced['fit'] == reference['fit']
assert reproduced['rollouts'] == reference['rollouts']
original = m.theta.copy()
original_step = m.step
solver_fallbacks = 0
def robust_step(position,velocity,input_value):
    global solver_fallbacks
    try:
        return original_step(position,velocity,input_value)
    except AssertionError:
        # Same strictly monotone implicit equations, not another plant.
        # Coordinate bisection avoids Newton line-search roundoff stagnation.
        solver_fallbacks += 1
        h = .001
        matrix = np.eye(2)+h*m.B+h*h*m.K
        rhs = velocity+h*(m.gain*input_value-m.K@position)
        w = velocity.copy()
        for outer in range(8):
            for axis in [0,1]:
                target = rhs[axis]-matrix[axis,1-axis]*w[1-axis]
                lo = (target-h*m.friction[axis])/matrix[axis,axis]
                hi = (target+h*m.friction[axis])/matrix[axis,axis]
                for inner in range(50):
                    center = .5*(lo+hi)
                    r = matrix[axis,axis]*center+h*m.friction[axis]*math.tanh(center/m.velocity_scale)-target
                    if r>0:
                        hi = center
                    else:
                        lo = center
                w[axis] = .5*(lo+hi)
            residual = matrix@w+h*m.friction*np.tanh(w/m.velocity_scale)-rhs
            if np.max(np.abs(residual)) < 1e-13:
                return position+h*w,w
        raise AssertionError('Implicit solver residual not verified')
m.step = robust_step
normalizers = reference['rollouts'][0]['noMotionBaselineErrors']
mean_scale = normalizers['meanPositionRMSE_mm']
sync_scale = normalizers['syncDifferenceRMSE_mm']
assert mean_scale>0 and sync_scale>0

def set_parameters(setting):
    p = original.copy()
    p[:2] *= setting['gain']
    p[4] *= setting['spring']
    p[6:8] *= setting['friction']
    assert np.all(p>=0)
    assert np.array_equal(p[2:4],original[2:4]) and p[5]==original[5]
    m.theta = p.copy()
    m.gain = p[:2].copy()
    m.B = np.diag(p[2:4])+p[5]*np.array([[1,-1],[-1,1]],float)
    m.K = p[4]*np.array([[1,-1],[-1,1]],float)
    m.friction = p[6:8].copy()
    return p

records = []
for setting in protocol['parameterSets']:
    p = set_parameters(setting)
    previous_fallbacks = solver_fallbacks
    try:
        result = m.rollout(m.train)
        errors = result['motionForcedResponseErrors']
        score = (errors['meanPositionRMSE_mm']/mean_scale)**2+(errors['syncDifferenceRMSE_mm']/sync_scale)**2
        eligible = result['completed'] and np.isfinite(score)
        record = {'setting':setting,'parameters':p.tolist(),'trainingScore':float(score),
                  'trainingCompleted':result['completed'],'selectionEligible':bool(eligible),
                  'trainingErrors':errors,'numericalFailure':None}
        if setting['name']=='base':
            assert result==reference['rollouts'][0]
    except Exception as error:
        record = {'setting':setting,'parameters':p.tolist(),'trainingScore':None,
                  'trainingCompleted':False,'selectionEligible':False,'trainingErrors':None,
                  'numericalFailure':repr(error)}
    record['sameEquationSolverFallbackSteps'] = solver_fallbacks-previous_fallbacks
    records.append(record)
    print(json.dumps({'tested':len(records),'name':setting['name'],'score':record['trainingScore'],
                      'trainingErrors':record['trainingErrors'],'failure':record['numericalFailure']}),file=sys.stderr,flush=True)
assert len(records)==protocol['fixedBudget']==9
eligible = [r for r in records if r['selectionEligible']]
assert eligible
chosen = min(eligible,key=lambda r:r['trainingScore'])
frozen = set_parameters(chosen['setting'])
# The only selection score above uses m.train. S3R2 is now checked without
# additional parameter changes. Prior observation prevents calling it blind.
cross = m.rollout(m.validation)
assert np.array_equal(m.theta,frozen)
train_final = m.rollout(m.train)
assert train_final['motionForcedResponseErrors']==chosen['trainingErrors']

def differences(before,after):
    return {key:{'before_mm':before[key],'after_mm':after[key],
                 'change_pct':100*(after[key]/before[key]-1)}
            for key in ['meanPositionRMSE_mm','syncDifferenceRMSE_mm']}

for s in [reference['trainingSource'],reference['retrospectiveCrossMethodSource']]:
    assert m.digest(s['source'])==s['SHA256'] and m.digest(s['raw'])==s['rawSHA256']
output = {'protocol':protocol,'baseCodeSHA256':m.digest(BASE/'revise.py'),
          'baseExactlyReproduced':True,'ordinaryOnlySelection':True,'allNineOutcomes':records,
          'selected':chosen,'selectedTrainingRollout':train_final,'selectedCrossMethodRollout':cross,
          'trainingChanges':differences(reference['rollouts'][0]['motionForcedResponseErrors'],train_final['motionForcedResponseErrors']),
          'crossMethodChanges':differences(reference['rollouts'][1]['motionForcedResponseErrors'],cross['motionForcedResponseErrors']),
          'dataSources':[reference['trainingSource'],reference['retrospectiveCrossMethodSource']],
          'crossMethodNotNewIndependentData':True,'postCrossMethodRetuning':False,
          'frozenOriginalControlUnchanged':True,'rawDataUnchanged':True,'hardwareAction':False,
          'counterfactualClosedLoopAdmitted':False,'taskModelResolutionBudgetDefined':False,
          'newPhysicalCaptureReleased':False,'tuningCodeSHA256':m.digest(__file__)}
output['firstNumericalAttemptRetained'] = True
output['sameNineParameterSetsOnly'] = True
output['implicitEquationUnchangedBySolverFallback'] = True
output['totalVerifiedBisectionFallbackSteps'] = solver_fallbacks
print(json.dumps(output,ensure_ascii=False))
