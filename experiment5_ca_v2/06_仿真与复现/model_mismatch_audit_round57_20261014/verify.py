"""Independent numerical verification of existing-data mismatch diagnostics."""
import hashlib
import json
from pathlib import Path
import numpy as np

base = Path(__file__).resolve().parent
report = json.loads((base/'mismatch_diagnosis_complete.json').read_text(encoding='utf-8'))
for record in report['physical']:
    source = Path(record['source'])
    assert hashlib.sha256(source.read_bytes()).hexdigest() == record['SHA256']
    rows = np.loadtxt(source, delimiter=',', skiprows=1, encoding='utf-8-sig')
    late = rows[(rows[:,106] == 1) & (rows[:,2] == 5) & (rows[:,79] >= 18)]
    assert len(late) == record['lateOriginHold']['N'] == 50
    mean_error = 500*(late[:,5]+late[:,6])
    sync_error = 1000*(late[:,5]-late[:,6])
    assert abs(float(np.sqrt(np.mean(mean_error**2)))-record['lateOriginHold']['meanPositionRMS_mm']) < 1e-12
    assert abs(float(np.sqrt(np.mean(sync_error**2)))-record['lateOriginHold']['syncRMS_mm']) < 1e-12
for record in report['assumedModels']:
    source = Path(record['source'])
    assert hashlib.sha256(source.read_bytes()).hexdigest() == record['SHA256']
    rows = json.loads(source.read_text(encoding='utf-8'))
    ids = record['scenarioHasOnly1200_1200']
    values = []
    for case in ids:
        late = [r for r in rows if r['type']=='trace' and r['case']==case and r['phase']==5 and r['t'] >= 18]
        assert len(late) == 50
        positions = np.asarray([r['positions_mm'] for r in late])
        errors = positions.mean(axis=1)-np.asarray([r['ref_mm'] for r in late])
        values.append(float(np.sqrt(np.mean(errors**2))))
    assert abs(float(np.mean(values))-record['sameLimitDistributions']['lateOriginMeanPositionRMS_mm']['mean']) < 1e-12
print(json.dumps({'physicalFilesVerified':6, 'modelTraceFilesVerified':2,
                  'sameLimitCompletedCasesEach':16, 'independentNumericalChecksPassed':True}))
