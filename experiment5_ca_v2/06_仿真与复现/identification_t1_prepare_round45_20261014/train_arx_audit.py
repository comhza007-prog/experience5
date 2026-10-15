"""One fixed training-only ARX audit. Never write raw data or access hardware."""
import hashlib
import json
from pathlib import Path
import numpy as np

HERE = Path(__file__).resolve().parent
DECODED = HERE / 'build67832_0da7ed24d02b_analysis.json'

def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def fit_model(vpast, u, target):
    models = []
    predictions = []
    for ch in range(2):
        x = np.column_stack((vpast[:, ch], vpast[:, 1-ch], u[:, ch]/1000,
                             u[:, 1-ch]/1000, np.sign(vpast[:, ch]), np.ones(len(u))))
        scale = x.std(axis=0)
        scale[scale < 1e-12] = 1
        coeff, _, rank, singular = np.linalg.lstsq(x / scale, target[:, ch], rcond=None)
        beta = coeff / scale
        models.append({'axis': ch, 'beta': beta.tolist(), 'rank': int(rank),
                       'regressors': 6, 'scaledSingularValues': singular.tolist(),
                       'scaledCondition': float(singular[0]/singular[-1]) if singular[-1] > 0 else None})
        predictions.append(x @ beta)
    return models, np.array(predictions).T

def feature(v, u, ch):
    return np.array([v[ch], v[1-ch], u[ch]/1000, u[1-ch]/1000, np.sign(v[ch]), 1.])

def recursive(models, u, dt, p0, v0):
    p, v = p0.copy(), v0.copy()
    history = []
    for command, span in zip(u, dt):
        v = np.array([feature(v, command, ch) @ np.array(models[ch]['beta']) for ch in range(2)])
        p = p + span * v
        if not np.isfinite(p).all() or np.max(np.abs(p)) > 1e12:
            return None
        history.append(p.copy())
    return np.array(history)

def errors(err):
    return {'axisRMSE_mm': np.sqrt(np.mean(err**2, axis=0)).tolist(),
            'meanPositionRMSE_mm': float(np.sqrt(np.mean(np.mean(err, axis=1)**2))),
            'syncDifferenceRMSE_mm': float(np.sqrt(np.mean((err[:, 0]-err[:, 1])**2))),
            'axisMaxAbs_mm': np.max(np.abs(err), axis=0).tolist(),
            'terminalAxisError_mm': err[-1].tolist()}

def matrix_audit(x):
    centered = x - x.mean(axis=0)
    _, singular, _ = np.linalg.svd(centered, full_matrices=False)
    return {'samples': len(x), 'mean': x.mean(axis=0).tolist(),
            'RMS': np.sqrt(np.mean(x**2, axis=0)).tolist(),
            'centeredRank': int(np.linalg.matrix_rank(centered)),
            'centeredSingularValues': singular.tolist(),
            'centeredCondition': float(singular[0]/singular[-1]) if singular[-1] > 0 else None}

def self_test():
    rng = np.random.default_rng(3901)
    truth = np.array([[.6, .1, .8, .2, -.01, .001], [.5, .05, .7, .1, -.008, -.002]])
    u = rng.normal(size=(800, 2))*300
    past = np.zeros((800, 2)); y = np.zeros((800, 2))
    v = np.array([.05, -.03])
    for k in range(800):
        past[k] = v
        v = np.array([feature(v, u[k], ch) @ truth[ch] for ch in range(2)])
        y[k] = v
    models, predicted = fit_model(past, u, y)
    assert np.max(np.abs(np.array([m['beta'] for m in models])-truth)) < 1e-10
    h = recursive(models, u, np.full(800, .02), np.zeros(2), past[0])
    assert np.max(np.abs(h-np.cumsum(y*.02, axis=0))) < 1e-10
    assert np.max(np.abs(predicted-y)) < 1e-10

def main():
    self_test()
    obj = json.loads(DECODED.read_text(encoding='utf-8'))
    assert obj['qualified'] and obj['header']['build'] == 67832
    assert digest(Path(obj['source'])) == obj['sourceSHA256']
    slow, fast = obj['slow'], obj['fast']
    assert len(slow) == 1000 and len(fast) == 400
    assert all(r['steps'] == 20 and r['end_ms'] == (i+1)*20 and r['quality_flags'] == 3
               for i, r in enumerate(slow))
    dt = np.array([r['elapsed_us'] for r in slow], dtype=float)/1e6
    assert (dt > 0).all()
    scale = obj['header']['configured_meters_per_count']*1000
    position = np.array([r['encoder'] for r in slow], dtype=float)*scale
    position[:, 1] *= obj['header']['configured_right_sign']
    positions_with_start = np.vstack((np.zeros(2), position))
    velocity = np.diff(positions_with_start, axis=0)/dt[:, None]
    command = np.array([r['command_mean_counts'] for r in slow], dtype=float)
    command[:, 1] *= -1
    assert np.isfinite(position).all() and np.isfinite(command).all()
    indices = np.arange(200, 1000)
    models, predicted = fit_model(velocity[indices-1], command[indices], velocity[indices])
    a = np.array([[models[0]['beta'][0], models[0]['beta'][1]],
                  [models[1]['beta'][1], models[1]['beta'][0]]])
    eig = np.linalg.eigvals(a)
    radius = float(np.max(np.abs(eig)))
    one_step_positions = positions_with_start[indices] + dt[indices, None]*predicted
    rollout = recursive(models, command[indices], dt[indices], positions_with_start[200], velocity[199])
    measured = position[indices]
    fast_delta = np.array([r['command_counts'] for r in fast], dtype=float)-np.array([r['zero_injection_shadow_counts'] for r in fast], dtype=float)
    fast_modal = np.column_stack(((fast_delta[:, 0]-fast_delta[:, 1])/2,
                                  (fast_delta[:, 0]+fast_delta[:, 1])/2))
    requested_rows = np.array([bool(r['flags'] & 4) for r in fast])
    assert all(r['flags'] & 1 for r in fast)
    assert all(r['age_ms'][0] <= 50 and r['age_ms'][1] <= 50 for r in fast)
    assert np.max(np.abs(fast_delta)) <= 31
    assert np.all(fast_delta[~requested_rows] == 0)
    gate_errors = []
    for k in range(1, 400):
        if k == 200:
            continue
        assert fast[k]['actual_us'] > fast[k-1]['actual_us']
        if requested_rows[k] and max(abs(x) for x in fast[k-1]['rpm']) > 10:
            gate_errors.append(k)
    assert not gate_errors
    modal_command = np.column_stack(((command[:, 0]+command[:, 1])/2,
                                    (command[:, 0]-command[:, 1])/2))
    result = {'source': obj['source'], 'sourceSHA256': obj['sourceSHA256'],
              'decodedSHA256': digest(DECODED),
              'protocolSHA256': digest(HERE/'training_audit_protocol.json'),
              'analysisCodeSHA256': digest(Path(__file__)),
              'selfTestKnownSyntheticARXPassed': True,
              'trainingSamples': 800, 'trainingWindow_end_ms': [4020, 20000],
              'modelRegressors': ['ownPreviousVelocity_mm_s', 'otherPreviousVelocity_mm_s',
                                  'ownAttemptedCommand_counts/1000', 'otherAttemptedCommand_counts/1000',
                                  'signOwnPreviousVelocity', 'intercept'],
              'models': models, 'linearA': a.tolist(), 'linearEigenvalues': [[float(x.real), float(x.imag)] for x in eig],
              'linearSpectralRadius': radius, 'linearPartStable': radius < 1,
              'nonlinearSignTermGlobalStabilityNotProven': True,
              'oneStepUsesMeasuredPast': True,
              'oneStepVelocityRMSE_mm_s': np.sqrt(np.mean((predicted-velocity[indices])**2, axis=0)).tolist(),
              'oneStepPositionErrors': errors(one_step_positions-measured),
              'recursiveFinite': rollout is not None,
              'trainingRecordedInputRecursiveErrors': errors(rollout-measured) if rollout is not None else None,
              'actualCommandModalAudit': matrix_audit(modal_command[indices]),
              'fastActualInjectedModalAudit': matrix_audit(fast_modal),
              'requestedExcitationSteps': obj['header']['requestedExcitationSteps'],
              'requestedExposureFractionOf8000MotionSteps': obj['header']['requestedExcitationSteps']/8000,
              'fastExcitationSamples': int(requested_rows.sum()),
              'fastPriorRPMGateErrors': gate_errors,
              'independentValidationPerformed': False, 'modelIdentified': False,
              'Q0UsedForFitOrSelection': False, 'V1ReadOrAcquired': False,
              'newControllerClosedLoopCounterfactual': False, 'modelResolutionBudget_mm': None,
              'limitations': ['Same-training forced-response fit,not independent validation.',
                              'Measured current-count exposure is release-aligned attempted command,not delivered torque.',
                              'Closed-loop gated excitation is not assumed exogenous or zero-bias.',
                              '20sample aggregates cannot certify1ms controller-counterfactual fidelity.',
                              'Encoder movement is not independently measured carriage displacement.']}
    frozen = {'sourceSHA256': obj['sourceSHA256'], 'protocolSHA256': result['protocolSHA256'],
              'codeSHA256': result['analysisCodeSHA256'], 'models': models,
              'linearA': a.tolist(), 'fitWindow': 'T1 only4020..20000ms',
              'validated': False, 'resolutionBudget_mm': None}
    with (HERE/'training_arx_first_audit.json').open('x', encoding='utf-8') as f:
        json.dump(result, f, ensure_ascii=False, indent=2, allow_nan=False)
    with (HERE/'training_arx_first_candidate.json').open('x', encoding='utf-8') as f:
        json.dump(frozen, f, ensure_ascii=False, indent=2, allow_nan=False)
    print(json.dumps({k: result[k] for k in ['linearSpectralRadius', 'oneStepVelocityRMSE_mm_s',
                     'oneStepPositionErrors', 'trainingRecordedInputRecursiveErrors',
                     'fastActualInjectedModalAudit', 'fastExcitationSamples', 'modelIdentified']}, indent=2, allow_nan=False))

if __name__ == '__main__':
    main()
