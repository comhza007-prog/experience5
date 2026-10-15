"""Read-only audit of manual CSV; keep residual prefix separate, never overwrite raw."""
import csv
import hashlib
import json
from collections import Counter
from pathlib import Path

ROOT = Path('D:/lunwen2/起重机/output/experiment5_ca_v2')
RAW = ROOT / '01_原始数据/20mm手动VOFA_20261015/1.csv'
digest = hashlib.sha256(RAW.read_bytes()).hexdigest()
with RAW.open(encoding='utf-8-sig', newline='') as f:
    reader = csv.reader(f)
    header = next(reader)
    rows = [[float(v) for v in r] for r in reader if r]
assert header == ['I'+str(i) for i in range(107)]
assert all(len(r) == 107 for r in rows)
assert rows[2][2] == 0 and rows[2][22] == 0 and rows[2][63] == 68612
data = rows[2:]
assert all(r[63] == 68612 for r in data)
assert all(abs(y[0]-x[0]-.04) < .0001 and y[1]-x[1] == 1 for x,y in zip(data,data[1:]))
fault_index = next(i for i,r in enumerate(data) if r[22] != 0)
fault = data[fault_index]
trace = {}
for r in data:
    if r[2] == 9 and r[22] == 512 and 0 <= r[103] <= 63 and abs(r[96]+r[103]) < .01:
        k = int(r[103])
        v = r[96:104]
        assert k not in trace or trace[k] == v
        trace[k] = v
assert set(trace) == set(range(64))
chronological = [trace[k] for k in range(63,-1,-1)]
assert chronological[-1][1] == 131 and chronological[-1][0] == 0
summary = {
    'raw': str(RAW), 'rawSHA256': digest, 'rawUnmodified': True,
    'rawRows': len(rows), 'excludedResidualPrefixRows': [0,1],
    'exclusionReason': 'Prior data followed by reboot/time-counter reset; second prefix row has shifted/invalid metadata. No current-session samples removed.',
    'currentSessionRows': len(data), 'currentFrameAndTimeContinuity': True,
    'build': 68612, 'phaseCounts': dict(Counter(int(r[2]) for r in data)),
    'firstObservedFault': {'uptime_s': fault[0], 'controllerElapsed_s': fault[95],
        'code': int(fault[22]), 'meaning': 'hard motor RPM guard, not synchronism/travel/tracking',
        'reference_mm': fault[3]*1000, 'left_mm': fault[5]*1000,
        'right_mm': fault[6]*1000, 'sync_mm': (fault[5]-fault[6])*1000,
        'positionPrecisionCaution': 'Native positions rounded to 0.00001 m in CSV; not exact encoder-derived values.'},
    'faultTrace': {'complete': True, 'rows': 64, 'period_ms': 1,
        'columns': ['relative_ms','left_rpm','right_rpm','encoder_left_rpm','encoder_right_rpm','previous_left_command','previous_right_command','cursor'],
        'chronological': chronological,
        'triggerLeftRPM': chronological[-1][1],
        'triggerEncoderLeftRPM': chronological[-1][3],
        'encoderCaution': 'Per-CAN-frame position-difference estimate from same encoder, not independent tachometer; timing/filter differs from ESC RPM.',
        'finding': 'Left RPM rises continuously, 25 at -13ms to 131 at 0ms; encoder estimate also rises to154.70. Commands oppose positive rotation before fault. Not evidence of a lone corrupt RPM sample.'},
    'nativeLeftPeakRPMCounter': max(r[82] for r in data),
    'packedMotionSnapshot': {'complete': False, 'finalMagic': data[-1][88],
        'finalStatus': data[-1][89], 'payloadStatus3Rows': sum(r[89]==3 for r in data),
        'lastUptime_s': data[-1][0], 'CRCValidated': False},
    'formalMetricsValid': False, 'modelPredictionPerformed': False,
    'guards': {'sync_mm': 5, 'travel_mm': [-22,22], 'hardRPM': 120,
        'driveTaperRPM': [10,30], 'activeBrakingCap_counts': 200},
    'interpretation': 'The hard RPM event is established; root cause of acceleration is not uniquely identified. Existing 10-30RPM taper overlaps the 20mm/8s nominal28.35RPM peak and needs controller/guard interaction review. This is a hypothesis, not proven cause.',
    'firmwareChangedThisRound': False, 'hardwareOperatedThisRound': False,
    'next': 'Preserve stopped same-run history if available and export complete replay. Do not repeat run or simply raise/remove RPM guard to mask acceleration. Compare legacy protection semantics separately from current controller dynamics.'
}
assert hashlib.sha256(RAW.read_bytes()).hexdigest() == digest
out = Path(__file__).with_name('summary.json')
out.write_text(json.dumps(summary,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({k:v for k,v in summary.items() if k not in ['faultTrace']},ensure_ascii=False))
