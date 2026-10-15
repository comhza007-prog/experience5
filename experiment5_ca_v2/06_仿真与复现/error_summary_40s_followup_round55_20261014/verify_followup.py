"""Independent NumPy recomputation. Read-only raw data and result verification."""
import json
import hashlib
from pathlib import Path
import numpy as np

base = Path(__file__).resolve().parent
report = json.loads((base / 'all_attempts_analysis_final.json').read_text(encoding='utf-8'))
verified = []
for record in report['results']:
    source = Path(record['source'])
    assert hashlib.sha256(source.read_bytes()).hexdigest() == record['sourceSHA256']
    data = np.loadtxt(source, delimiter=',', skiprows=1, encoding='utf-8-sig')
    segment = next(s for s in record['allSessionSegments'] if s['containsActive'])
    session = data[segment['firstLine']-2:segment['lastLine']-1]
    active = session[(session[:,106] == 1) & (session[:,2] >= 2) & (session[:,2] <= 5)]
    errors = np.column_stack((1000*((active[:,5]+active[:,6])/2-active[:,3]), 1000*(active[:,5]-active[:,6])))
    values = np.sqrt(np.mean(errors**2, axis=0))
    peaks = np.max(np.abs(errors), axis=0)
    keys = ['trackingRMSE_mm', 'syncRMS_mm', 'maxTracking_mm', 'maxSync_mm']
    measured = [*values, *peaks]
    for key, value in zip(keys, measured):
        assert abs(float(value)-record['primaryMetrics'][key]) < 1e-12
    if record['attempt'] == 3:
        assert len(active) == 400
        assert record['completeCSVPrimaryWindow'] and record['event']['complete']
        assert record['summaryAgreesWithCompleteCSV']
        verified.append({'method': record['method'], 'N': len(active), **dict(zip(keys, map(float, measured)))})
assert len(verified) == 2
assert report['validPairedCSVComparisons'] == 2
print(json.dumps({'rawFilesHashVerified': len(report['results']), 'independentNumPyVerifiedAllSix': True, 'newAttempt03': verified}, indent=2))
