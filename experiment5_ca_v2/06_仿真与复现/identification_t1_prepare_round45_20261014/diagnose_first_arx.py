"""Attribution of the frozen first fit; oracle sign is NOT a usable model."""
import hashlib
import json
from pathlib import Path
import numpy as np
from train_arx_audit import errors, feature

HERE = Path(__file__).resolve().parent
decoded_path = HERE/'build67832_0da7ed24d02b_analysis.json'
audit_path = HERE/'training_arx_first_audit.json'
d = json.loads(decoded_path.read_text(encoding='utf-8'))
audit = json.loads(audit_path.read_text(encoding='utf-8'))
assert hashlib.sha256(Path(d['source']).read_bytes()).hexdigest() == audit['sourceSHA256']
assert hashlib.sha256((HERE/'train_arx_audit.py').read_bytes()).hexdigest() == audit['analysisCodeSHA256']
dt = np.array([r['elapsed_us'] for r in d['slow']], dtype=float)/1e6
p = np.array([r['encoder'] for r in d['slow']], dtype=float)*d['header']['configured_meters_per_count']*1000
p[:, 1] *= -1
pp = np.vstack((np.zeros(2), p))
v = np.diff(pp, axis=0)/dt[:, None]
u = np.array([r['command_mean_counts'] for r in d['slow']], dtype=float)
u[:, 1] *= -1
models = audit['models']
diagnostics = []
for mode in ['free_prediction', 'measured_sign_oracle', 'zero_sign_diagnostic']:
    pred_p, pred_v = pp[200].copy(), v[199].copy()
    history = []
    for k in range(200, 1000):
        features = [feature(pred_v, u[k], ch) for ch in range(2)]
        if mode == 'measured_sign_oracle':
            for ch in range(2):
                features[ch][4] = np.sign(v[k-1, ch])
        elif mode == 'zero_sign_diagnostic':
            for ch in range(2):
                features[ch][4] = 0
        pred_v = np.array([features[ch] @ np.array(models[ch]['beta']) for ch in range(2)])
        pred_p += dt[k]*pred_v
        history.append(pred_p.copy())
    diagnostics.append({'mode': mode, 'positionErrors': errors(np.array(history)-p[200:]),
                        'coefficientsRefit': False, 'autonomousStateUpdate': mode == 'free_prediction',
                        'independentValidation': False})
result = {'sourceSHA256': d['sourceSHA256'], 'frozenModelSHA256': hashlib.sha256((HERE/'training_arx_first_candidate.json').read_bytes()).hexdigest(),
          'diagnostics': diagnostics,
          'sameAxisCommandGainCoefficients': [m['beta'][2] for m in models],
          'previousVelocitySignCoefficients': [m['beta'][4] for m in models],
          'interpretation': 'The measured-sign oracle uses future unavailable measurements and is not a usable predictor. Its error reduction diagnoses recursive sign-closure sensitivity, not a validated friction law. Negative own-input coefficients and positive sign terms are statistical closed-loop fit coefficients, not calibrated physical gains/friction.',
          'newFitOrParameterSearch': False, 'hardwareActions': 0, 'V1Read': False, 'modelIdentified': False}
with (HERE/'training_arx_first_diagnosis.json').open('x', encoding='utf-8') as f:
    json.dump(result, f, ensure_ascii=False, indent=2, allow_nan=False)
print(json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False))
