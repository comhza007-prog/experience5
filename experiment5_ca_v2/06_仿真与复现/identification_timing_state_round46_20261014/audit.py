"""Fixed four-cell timing/state diagnostic using only qualified T1."""
import hashlib
import json
from pathlib import Path
import sys
import numpy as np

HERE = Path(__file__).resolve().parent
PRIOR = HERE.parent/'identification_t1_prepare_round45_20261014'
sys.path.insert(0, str(PRIOR))
from train_arx_audit import errors, recursive as old_recursive, self_test as old_self_test

def sha(p):
    return hashlib.sha256(p.read_bytes()).hexdigest()

def feature(v, u, up, ch, tap, sign):
    x = [v[ch], v[1-ch], u[ch]/1000, u[1-ch]/1000]
    if tap:
        x.extend([up[ch]/1000, up[1-ch]/1000])
    if sign:
        x.append(np.sign(v[ch]))
    x.append(1.)
    return np.array(x)

def fit(vp, u, up, y, tap, sign):
    models, predictions = [], []
    for ch in range(2):
        x = np.array([feature(v, c, cp, ch, tap, sign) for v, c, cp in zip(vp, u, up)])
        scale = x.std(axis=0)
        scale[scale < 1e-12] = 1
        b, _, rank, sv = np.linalg.lstsq(x/scale, y[:, ch], rcond=None)
        beta = b/scale
        models.append({'axis': ch, 'beta': beta.tolist(), 'rank': int(rank), 'columns': x.shape[1],
                       'scaledCondition': float(sv[0]/sv[-1]) if sv[-1] > 0 else None})
        predictions.append(x @ beta)
    return models, np.array(predictions).T

def rollout(models, u, up, dt, p0, v0, tap, sign):
    p, v, h = p0.copy(), v0.copy(), []
    for c, cp, span in zip(u, up, dt):
        v = np.array([feature(v, c, cp, ch, tap, sign) @ np.array(models[ch]['beta']) for ch in range(2)])
        p += span*v
        if not np.isfinite(p).all() or np.max(np.abs(p)) > 1e12:
            return None
        h.append(p.copy())
    return np.array(h)

def correlation(x, y):
    x, y = x-x.mean(), y-y.mean()
    denominator = np.sqrt((x@x)*(y@y))
    return float(x@y/denominator) if denominator > 1e-12 else None

def synthetic_test():
    rng = np.random.default_rng(4601)
    truth = np.array([[.4, .1, .8, .2, .1, .05, -.01, .001],
                      [.5, .1, .7, .15, .08, .03, -.02, -.001]])
    u = rng.normal(size=(801, 2))*300
    up = u[:-1]; u = u[1:]
    past, target = [], []
    v = np.array([.03, -.02])
    for c, cp in zip(u, up):
        past.append(v.copy())
        v = np.array([feature(v, c, cp, ch, True, True) @ truth[ch] for ch in range(2)])
        target.append(v.copy())
    past, target = np.array(past), np.array(target)
    m, pred = fit(past, u, up, target, True, True)
    assert np.max(np.abs(np.array([r['beta'] for r in m])-truth)) < 1e-10
    h = rollout(m, u, up, np.full(800, .02), np.zeros(2), past[0], True, True)
    assert np.max(np.abs(h-np.cumsum(target*.02, axis=0))) < 1e-10
    assert np.max(np.abs(pred-target)) < 1e-10

def main():
    old_self_test(); synthetic_test()
    decoded = PRIOR/'build67832_0da7ed24d02b_analysis.json'
    d = json.loads(decoded.read_text(encoding='utf-8'))
    prior = json.loads((PRIOR/'training_arx_first_audit.json').read_text(encoding='utf-8'))
    assert d['qualified'] and d['header']['build'] == 67832
    assert sha(Path(d['source'])) == d['sourceSHA256'] == prior['sourceSHA256']
    assert sha(decoded) == prior['decodedSHA256']
    assert sha(PRIOR/'train_arx_audit.py') == prior['analysisCodeSHA256']
    s, f = d['slow'], d['fast']
    assert all(r['end_ms'] == (i+1)*20 and r['steps'] == 20 and r['quality_flags'] == 3 for i, r in enumerate(s))
    dt = np.array([r['elapsed_us'] for r in s])/1e6
    p = np.array([r['encoder'] for r in s], dtype=float)*d['header']['configured_meters_per_count']*1000
    p[:, 1] *= -1
    pp = np.vstack((np.zeros(2), p)); v = np.diff(pp, axis=0)/dt[:, None]
    u = np.array([r['command_mean_counts'] for r in s], dtype=float); u[:, 1] *= -1
    idx = np.arange(200, 1000)
    nominal = old_recursive(prior['models'], u[idx], np.full(800, .02), pp[200], v[199])
    timing = {'sourceReview': 'motor_task closes previous_command at current release with interval-END feedback; no source off-by-one correction applied',
              'observedNominalRun_ms': s[-1]['end_ms'], 'sumInteger_us': int(round(dt.sum()*1e6)),
              'integerSpanShortfall_us': int(round(20e6-dt.sum()*1e6)),
              'quantizationBound_us': 20000,
              'nominal20msFrozenFitReplayErrors': errors(nominal-p[idx]),
              'observedInteger_usFrozenFitReplayErrors': prior['trainingRecordedInputRecursiveErrors'],
              'deliveredCANDelayKnown': False}
    windows, lag_correlations = [], []
    rpm_scale = d['header']['configured_meters_per_count']*1000*8192/60
    for window_index in range(2):
        w = f[window_index*200:(window_index+1)*200]
        t = np.array([r['actual_us'] for r in w], dtype=float)/1e6
        assert (np.diff(t) > 0).all()
        wp = np.array([r['encoder'] for r in w], dtype=float)*d['header']['configured_meters_per_count']*1000; wp[:, 1] *= -1
        rpm = np.array([r['rpm'] for r in w], dtype=float); rpm[:, 1] *= -1
        rv = rpm*rpm_scale
        integrated = np.sum((rv[1:]+rv[:-1])*.5*np.diff(t)[:, None], axis=0)
        wc = np.array([r['command_counts'] for r in w], dtype=float)
        fb = np.array([r['feedback_counts'] for r in w], dtype=float)
        windows.append({'window': window_index, 'observedSpan_us': int(round((t[-1]-t[0])*1e6)),
                        'encoderDisplacement_mm': (wp[-1]-wp[0]).tolist(),
                        'rawRPMTrapezoidDisplacement_mm': integrated.tolist(),
                        'integratedRPMMinusEncoder_mm': (integrated-(wp[-1]-wp[0])).tolist(),
                        'maxFeedbackAge_ms': max(max(r['age_ms']) for r in w)})
        for lag in range(11):
            lag_correlations.append({'window': window_index, 'lagFastSamples': lag,
                                     'commandToEndpointESCFeedbackCorrelation': [correlation(wc[:len(w)-lag, ch], fb[lag:, ch]) for ch in range(2)]})
    cells = []
    for tap, sign in [(False, True), (True, True), (False, False), (True, False)]:
        models, predicted = fit(v[idx-1], u[idx], u[idx-1], v[idx], tap, sign)
        h = rollout(models, u[idx], u[idx-1], dt[idx], pp[200], v[199], tap, sign)
        a = np.array([[models[0]['beta'][0], models[0]['beta'][1]], [models[1]['beta'][1], models[1]['beta'][0]]])
        b0 = np.array([[models[0]['beta'][2], models[0]['beta'][3]], [models[1]['beta'][3], models[1]['beta'][2]]])
        b1 = np.array([[models[0]['beta'][4], models[0]['beta'][5]], [models[1]['beta'][5], models[1]['beta'][4]]]) if tap else np.zeros((2, 2))
        rho = float(np.max(np.abs(np.linalg.eigvals(a))))
        try:
            gain = np.linalg.solve(np.eye(2)-a, b0+b1)/1000
        except np.linalg.LinAlgError:
            gain = None
        result = {'previousInputTap': tap, 'signTerm': sign, 'models': models,
                  'linearA': a.tolist(), 'linearSpectralRadius': rho, 'linearPartStable': rho < 1,
                  'linearDCGain_mm_s_per_count': gain.tolist() if gain is not None else None,
                  'physicalCausalGainNotEstablished': True,
                  'measuredPastOneStepVelocityRMSE_mm_s': np.sqrt(np.mean((predicted-v[idx])**2, axis=0)).tolist(),
                  'measuredPastOneStepPositionErrors': errors(pp[idx]+dt[idx, None]*predicted-p[idx]),
                  'trainingRecordedInputRecursiveErrors': errors(h-p[idx]) if h is not None else None,
                  'independentValidation': False, 'modelIdentified': False}
        if not tap and sign:
            assert np.max(np.abs(np.array([r['beta'] for r in models])-np.array([r['beta'] for r in prior['models']]))) < 1e-11
            assert abs(result['trainingRecordedInputRecursiveErrors']['syncDifferenceRMSE_mm']-prior['trainingRecordedInputRecursiveErrors']['syncDifferenceRMSE_mm']) < 1e-10
        cells.append(result)
    output = {'source': d['source'], 'sourceSHA256': d['sourceSHA256'], 'decodedSHA256': sha(decoded),
              'protocolSHA256': sha(HERE/'protocol.json'), 'analysisCodeSHA256': sha(Path(__file__)),
              'syntheticTestsPassed': True, 'originalCellExactlyReproduced': True,
              'timingAudit': timing, 'fastSensorAudit': windows, 'allFixedLagCorrelations': lag_correlations,
              'factorialCells': cells, 'newPhysicalRuns': 0, 'MCUFirmwareChanged': False,
              'Q0UsedForFitOrSelection': False, 'V1ReadOrAcquired': False,
              'modelIdentified': False, 'modelResolutionBudget_mm': None, 'V1Released': False}
    with (HERE/'audit.json').open('x', encoding='utf-8') as stream:
        json.dump(output, stream, ensure_ascii=False, indent=2, allow_nan=False)
    print(json.dumps({'timingAudit': timing, 'fastSensorAudit': windows,
                     'factorialCells': [{k: cell[k] for k in ['previousInputTap', 'signTerm', 'linearSpectralRadius', 'linearDCGain_mm_s_per_count', 'trainingRecordedInputRecursiveErrors']} for cell in cells]}, indent=2, allow_nan=False))

if __name__ == '__main__':
    main()
