"""Frozen-model and captured within-interval resolution audit, no refitting."""
import hashlib
import json
from pathlib import Path
import sys
import numpy as np

HERE = Path(__file__).resolve().parent
PREVIOUS = HERE.parent / 'identification_timing_state_round46_20261014'
TRAIN = HERE.parent / 'identification_t1_prepare_round45_20261014'
sys.path.insert(0, str(PREVIOUS))
from coupled_state import replay, self_test, errors


def sha(p):
    return hashlib.sha256(p.read_bytes()).hexdigest()


def chord_residual(position, start, end):
    fraction = np.arange(1, 21, dtype=float)[:, None] / 20
    return position - (start + fraction * (end - start))


def main():
    self_test()
    line = np.arange(1, 21, dtype=float)[:, None] * np.array([[.03, -.02]])
    assert np.max(np.abs(chord_residual(line, np.zeros(2), line[-1]))) < 1e-14
    assert np.max(np.abs(chord_residual(np.ones((20, 2)), np.ones(2), np.ones(2)))) == 0
    source = TRAIN / 'build67832_0da7ed24d02b_analysis.json'
    saved_path = PREVIOUS / 'coupled_state.json'
    d = json.loads(source.read_text(encoding='utf-8'))
    saved = json.loads(saved_path.read_text(encoding='utf-8'))
    protocol = json.loads((HERE / 'protocol.json').read_text(encoding='utf-8'))
    raw = Path(d['source'])
    protected = [raw, source, saved_path, PREVIOUS / 'coupled_state.py', PREVIOUS / 'coupled_state_protocol.json']
    before = {str(p): sha(p) for p in protected}
    assert d['qualified'] and d['header']['build'] == 67832
    assert before[str(raw)] == d['sourceSHA256'] == saved['sourceSHA256'] == protocol['sourceSHA256']
    assert before[str(PREVIOUS / 'coupled_state.py')] == saved['codeSHA256']
    assert before[str(PREVIOUS / 'coupled_state_protocol.json')] == saved['protocolSHA256']

    slow, fast = d['slow'], d['fast']
    dt = np.array([r['elapsed_us'] for r in slow], dtype=float) / 1e6
    scale = d['header']['configured_meters_per_count'] * 1000
    p = np.array([r['encoder'] for r in slow], dtype=float) * scale * [1, -1]
    pp = np.vstack((np.zeros(2), p))
    v = np.diff(pp, axis=0) / dt[:, None]
    u = np.array([r['command_mean_counts'] for r in slow], dtype=float) * [1, -1]
    idx = np.arange(200, 1000)
    specifications = [('full_training_fit', saved['fullTrainingFit']['models'])] + [
        (f"leave_block_{f['block']}_out", f['models']) for f in saved['allFourTrainingInternalBlockedChecks']]
    histories, results = [], []
    for name, models in specifications:
        prediction = replay(models, pp[200], v[199], u[idx], u[idx-1], dt[idx])
        assert prediction is not None and np.isfinite(prediction).all()
        histories.append(prediction)
        results.append({'model': name, 'sameT1FullSpanRecordedInputErrors': errors(prediction-p[idx]),
                        'independentValidation': False})
    assert abs(results[0]['sameT1FullSpanRecordedInputErrors']['syncDifferenceRMSE_mm'] -
               saved['fullTrainingFit']['trainingRecordedInputRecursiveErrors']['syncDifferenceRMSE_mm']) < 1e-12
    histories = np.array(histories)
    sync_predictions = histories[:, :, 0] - histories[:, :, 1]
    mean_predictions = histories.mean(axis=2)
    sync_spread = np.ptp(sync_predictions, axis=0)
    mean_spread = np.ptp(mean_predictions, axis=0)
    beta = np.array([[m['beta'] for m in models] for _, models in specifications])
    sensitivity = {'allFiveModels': results,
                   'sameInputSyncPredictionRangeRMS_mm': float(np.sqrt(np.mean(sync_spread**2))),
                   'sameInputSyncPredictionRangeMax_mm': float(sync_spread.max()),
                   'sameInputMeanPositionPredictionRangeRMS_mm': float(np.sqrt(np.mean(mean_spread**2))),
                   'sameInputMeanPositionPredictionRangeMax_mm': float(mean_spread.max()),
                   'relativePositionCoefficientRanges': [[float(beta[:, ch, 6].min()), float(beta[:, ch, 6].max())] for ch in range(2)],
                   'coefficientSetsOverlappingTrainingData': True,
                   'formalStatisticalConfidenceInterval': False,
                   'modelSelectionOrRefitPerformed': False}

    windows = []
    for window in range(2):
        rows = fast[window*200:(window+1)*200]
        assert len(rows) == 200 and all(rows[i+1]['ms']-rows[i]['ms'] == 1 for i in range(199))
        blocks = []
        for block in range(10):
            r = rows[block*20:(block+1)*20]
            end = r[-1]['ms']
            assert end % 20 == 0 and r[0]['ms'] == end - 19
            slow_idx = end // 20 - 1
            assert r[-1]['encoder'] == slow[slow_idx]['encoder']
            fp = np.array([x['encoder'] for x in r], dtype=float) * scale * [1, -1]
            residual = chord_residual(fp, pp[slow_idx], p[slow_idx])
            commands = np.array([x['command_counts'] for x in r], dtype=float)
            slow_min = np.array(slow[slow_idx]['command_min_counts'])
            slow_max = np.array(slow[slow_idx]['command_max_counts'])
            assert np.array_equal(commands.min(axis=0), slow_min)
            assert np.array_equal(commands.max(axis=0), slow_max)
            blocks.append({'end_ms': end,
                           'commandWithinIntervalStd_counts': commands.std(axis=0).tolist(),
                           'commandWithinIntervalRange_counts': np.ptp(commands, axis=0).tolist(),
                           'arithmeticMinusRecordedTimeWeightedMean_counts':
                               (commands.mean(axis=0)-np.array(slow[slow_idx]['command_mean_counts'])).tolist(),
                           'nominalIndexChordAxisMaxAbsDeparture_mm': np.abs(residual).max(axis=0).tolist(),
                           'nominalIndexChordMeanMaxAbsDeparture_mm': float(np.abs(residual.mean(axis=1)).max()),
                           'nominalIndexChordSyncMaxAbsDeparture_mm': float(np.abs(residual[:, 0]-residual[:, 1]).max()),
                           'sameEndpointExactlyConfirmed': True})
        windows.append({'window': window, 'endpoint_ms': [rows[0]['ms'], rows[-1]['ms']],
                        'capturedIntervals': 200, 'complete20SampleGroups': blocks})
    all_blocks = [block for window in windows for block in window['complete20SampleGroups']]
    coverage = {'coreIntervalsTotal': 20000, 'coreMovingIntervals': 8000, 'capturedFastIntervals': 400,
                'fastFractionOfFullRun': .02, 'fastFractionOfMovingIntervals': .05,
                'nominalSlowInterval_ms': 20, 'controllerNominalInterval_ms': 1,
                'fullRunOneMillisecondInputShapeAvailable': False,
                'encoderMillimetersPerCount': scale,
                'allSharedEndpointsAndCommandRangesExact': True,
                'maxCapturedSyncChordDeparture_mm': max(b['nominalIndexChordSyncMaxAbsDeparture_mm'] for b in all_blocks),
                'maxCapturedMeanChordDeparture_mm': max(b['nominalIndexChordMeanMaxAbsDeparture_mm'] for b in all_blocks),
                'maxCapturedWithinIntervalCommandRange_counts': np.max(np.array([b['commandWithinIntervalRange_counts'] for b in all_blocks]), axis=0).tolist(),
                'chordDepartureIsNotSensorNoiseOrPredictionErrorBound': True,
                'unobservedIntervalsNotInferredFromFastWindows': True,
                'windows': windows}
    worst = max(f['trainingInternalHeldBlockErrors']['syncDifferenceRMSE_mm'] for f in saved['allFourTrainingInternalBlockedChecks'])
    illustration = [{'illustrativeEffect_mm': effect, 'worstInternalBlockRMSEDividedByEffect': worst/effect,
                     'acceptanceThreshold': False} for effect in protocol['effectIllustrations_mm']]
    assert {str(p): sha(p) for p in protected} == before
    result = {'source': str(raw), 'sourceSHA256': sha(raw), 'protectedSourceHashes': before,
              'protocolSHA256': sha(HERE/'protocol.json'), 'codeSHA256': sha(Path(__file__)),
              'testsPassed': True, 'rawAndPriorArtifactsUnchanged': True,
              'frozenModelSensitivity': sensitivity, 'capturedResolutionAudit': coverage,
              'effectScaleIllustrationsOnly': illustration,
              'decision': {'controllerScreeningReleased': False, 'modelIdentified': False, 'V1Released': False,
                           'modelExpansionStopped': True, 'modelResolutionBudget_mm': None,
                           'independentPredictionAccuracyEstablished': False,
                           'oneMillisecondCompatibilityEstablished': False,
                           'needMoreHardwareAutomatically': False,
                           'reason': 'Same-run internal prediction error and frozen-coefficient spread remain material. Twenty-sample summaries do not specify full-run one-millisecond input shape. No effect-linked error budget or independent accuracy established. This is not proof that synchronization benefit is impossible.',
                           'nextStep': 'Choose research priority before another physical run: further system identification with a defined resolution target, or freeze a candidate and predefine direct paired hardware comparison. The latter is a workflow change requiring user direction. Do not silently expand identification or start V1.'},
              'Q0UsedForFitOrSelection': False, 'V1ReadOrAcquired': False,
              'newModelsFitted': 0, 'newPhysicalRuns': 0, 'MCUFirmwareChanged': False}
    with (HERE/'audit.json').open('x', encoding='utf-8') as stream:
        json.dump(result, stream, ensure_ascii=False, indent=2, allow_nan=False)
    print(json.dumps({'testsPassed': True, 'frozenModelSensitivity': sensitivity,
                      'resolutionSummary': {k: value for k, value in coverage.items() if k != 'windows'},
                      'effectScaleIllustrationsOnly': illustration, 'decision': result['decision']}, indent=2))


if __name__ == '__main__':
    main()
