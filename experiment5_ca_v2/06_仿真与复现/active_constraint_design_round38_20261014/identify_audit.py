"""Read-only existing telemetry diagnostic. Not a calibrated hardware plant."""
import hashlib
import json
from pathlib import Path
import numpy as np

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
SAMPLES = ROOT / '06_仿真与复现' / 'feedback_model_round31_20261014'

def read(method):
    obj = json.loads((SAMPLES / (method + '_run01_samples.json')).read_text(encoding='utf-8'))
    assert hashlib.sha256(Path(obj['source']).read_bytes()).hexdigest() == obj['sourceSHA256']
    rows = obj['samples']
    assert len(rows) == 2001 and all(r['ms'] == i * 10 for i, r in enumerate(rows))
    pos = np.array([r['position_m'] for r in rows]) * 1000
    commands = np.array([r['attemptedCommandCounts'] for r in rows], dtype=float)
    assert np.isfinite(pos).all() and np.isfinite(commands).all()
    vel = np.diff(pos, axis=0) / .01
    indices = np.arange(400, 2000)
    # vel[i-1] is measured past interval. Target vel[i] spans i -> i+1.
    return {'source': obj['source'], 'sha256': obj['sourceSHA256'], 'pos': pos,
            'commands': commands, 'vel': vel, 'indices': indices}

def feature(v, u, ch):
    return np.array([v[ch], v[1-ch], u[ch] / 1000, u[1-ch] / 1000, np.sign(v[ch]), 1.])

data = {m: read(m) for m in ['BLNN', 'S3R2']}
models = {}
for name, d in data.items():
    models[name] = []
    for ch in [0, 1]:
        x = np.array([feature(d['vel'][i-1], d['commands'][i], ch) for i in d['indices']])
        y = d['vel'][d['indices'], ch]
        scale = np.std(x, axis=0)
        scale[scale < 1e-12] = 1
        coeff, residual, rank, singular = np.linalg.lstsq(x / scale, y, rcond=None)
        beta = coeff / scale
        assert np.isfinite(beta).all()
        model = {'axis': ch, 'beta': beta.tolist(), 'rank': int(rank),
                 'columns': x.shape[1], 'scaledCondition': float(singular[0]/singular[-1]) if singular[-1] > 0 else None,
                 'trainingOneStepVelocityRMSE_mm_s': float(np.sqrt(np.mean((x@beta-y)**2)))}
        models[name].append(model)

results = []
for train, test in [('BLNN','S3R2'), ('S3R2','BLNN')]:
    d = data[test]
    pred = np.array([[feature(d['vel'][i-1], d['commands'][i], ch) @ np.array(models[train][ch]['beta'])
                      for ch in [0,1]] for i in d['indices']])
    target = d['vel'][d['indices']]
    v = d['vel'][399].copy()
    p = d['pos'][400].copy()
    history = []
    finite = True
    for i in d['indices']:
        v_new = np.array([feature(v, d['commands'][i], ch) @ np.array(models[train][ch]['beta']) for ch in [0,1]])
        p = p + .01 * v_new
        v = v_new
        if not np.isfinite(p).all() or not np.isfinite(v).all():
            finite = False
            break
        history.append(p.copy())
    measured = d['pos'][d['indices'] + 1]
    h = np.array(history)
    err = h - measured if finite else None
    result = {'train':train,'test':test,'samples':len(d['indices']),
              'testOneStepVelocityRMSE_mm_s': np.sqrt(np.mean((pred-target)**2, axis=0)).tolist(),
              'recursiveFinite': finite,
              'recursivePositionRMSE_mm': np.sqrt(np.mean(err**2, axis=0)).tolist() if finite else None,
              'recursiveMeanPositionRMSE_mm': float(np.sqrt(np.mean(np.mean(err,axis=1)**2))) if finite else None,
              'recursiveSyncDifferenceRMSE_mm': float(np.sqrt(np.mean((err[:,0]-err[:,1])**2))) if finite else None,
              'endPositionPredictionError_mm': err[-1].tolist() if finite else None,
              'conditionSelectedByControllerPerformance':False,
              'oneStepUsesMeasuredPast':True,'recursiveUsesRecordedAttemptedCommands':True,
              'newControllerClosedLoopCounterfactual':False}
    results.append(result)

output = {'protocolSHA256':hashlib.sha256((HERE/'identification_prerequisite.json').read_bytes()).hexdigest(),
          'sources':[{k:d[k] for k in ['source','sha256']} for d in data.values()],
          'models':models,'crossControllerValidation':results,'modelsIdentified':False,
          'interpretation':'Fixed diagnostic first-order10ms fit. Recorded closed-loop attempted commands and missing intra-interval inputs prevent causal/1ms identification claims. Do not use one-step accuracy as recurrent model or candidate validation.',
          'hardwareReleased':False,'physicalRuns':0}
with (HERE/'identification_audit.json').open('x',encoding='utf-8') as f:
    json.dump(output,f,ensure_ascii=False,indent=2,allow_nan=False)
print(json.dumps({'crossControllerValidation':results,'modelsIdentified':False},indent=2,allow_nan=False))
