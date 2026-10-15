"""Independent input alignment checks and limited cross-capture diagnostics, no fitting."""
import csv,hashlib,json,struct,zlib
from pathlib import Path
import numpy as np
HERE=Path(__file__).resolve().parent;ROOT=HERE.parents[1]
sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
def read(p):
    with Path(p).open(encoding='utf-8-sig',newline='') as f:
        rd=csv.reader(f);assert next(rd)==[f'I{k}' for k in range(107)];a=np.array([[float(x) for x in r] for r in rd])
    return a
decoded=json.loads((HERE/'capture_analysis.json').read_text());summary=json.loads((HERE/'comparison_summary.json').read_text())
live=read(decoded['source'])[1:];active=live[(live[:,106]==1)&(live[:,2]>=2)&(live[:,2]<=5)]
assert len(active)==400
fast={3999+k if k<4000 else 9999+(k-4000):r for k,r in enumerate(decoded['fast'])}
# The first fast row is core step4000 (interval endpoint4001ms), so native step4000 has this prior queued input.
fast={4000+k if k<4000 else 10000+(k-4000):r for k,r in enumerate(decoded['fast'])}
checked=0
for r in active:
    if r[2] not in [2,4]:continue
    next_step=int(r[46])-1
    if next_step in fast:
        assert np.array_equal(r[13:15],fast[next_step]['command_counts']);checked+=1
assert checked==200
old=json.loads((HERE.parent/'q2_motor_frozen_check_round94_20261015/capture_analysis.json').read_text())
comparisons=[]
for label,d in [('run08',old),('run010',decoded)]:
    a=read(d['source']);a=a[(a[:,63]==68012)&(a[:,21]==11)&(a[:,87]==6)]
    m=a[(a[:,106]==1)&(a[:,2]>=2)&(a[:,2]<=5)]
    hold=np.array([r['command_mean_counts'] for r in d['slow'] if r['phase']==3])
    comparisons.append(dict(record=label,trackingRMSE_mm=d['capture_audit']['metrics']['trackingRMSE_mm'],syncRMS_mm=d['capture_audit']['metrics']['syncRMS_mm'],
        topHoldPriorQueuedMean_counts=hold.mean(axis=0).tolist(),topHoldNativeNextCommandMean_counts=m[m[:,2]==3,13:15].mean(axis=0).tolist(),
        nativeBatteryADCMedian_V=float(np.median(m[:,27])),nativeBatteryADCRange_V=[float(min(m[:,27])),float(max(m[:,27]))],
        motionPeakRPM=np.max(np.abs([r['rpm'] for r in d['fast']]),axis=0).tolist(),
        limitation='Battery ADC is not motor terminal voltage; queued command is not measured torque/current. Differences do not uniquely identify mechanical or drive faults.'))
priorRaw=Path(decoded['source']).with_name(Path(decoded['source']).name.replace('run010.csv','run09.csv'));rows=read(priorRaw)
valid=(rows[:,63]==68012)&(rows[:,21]==11)&(rows[:,87]==6)&np.isin(rows[:,2],range(10));bad=np.flatnonzero(~valid).tolist()
payload=[3,4,5,6,7,8,9,10,11,12,15,16,17,18,23,24,25,26,29,30,31,32,33,34,35,36,37,38,39,40,49,50,51,52,104,105,55,56,61,62,64,65,66,67,68,74,75,76]
def word(x):
    assert x==int(x);v=(int(x)-65536)//2 if x<262144 else 32768+(int(x)-262144)//8
    assert 0<=v<=65535 and (65536+2*v if v<32768 else 262144+8*(v-32768))==x
    return v
blob=bytearray(70944);counts=np.zeros(739,int);expected=None
for r in rows[valid]:
    if r[88]!=4444 or r[89]!=3:continue
    k=int(r[90]);b=b''.join(struct.pack('<H',word(r[ch])) for ch in payload);size=min(96,len(blob)-96*k)
    if counts[k]:assert blob[k*96:k*96+size]==b[:size]
    blob[k*96:k*96+size]=b[:size];counts[k]+=1
    crc=word(r[91])+65536*word(r[93]);assert expected is None or crc==expected;expected=crc
missing=np.flatnonzero(counts==0).tolist();assert missing==[712,715]
out=dict(status='No refit; inputs and metric windows checked',sourceSHA256=sha(decoded['source']),newRunCurrentSessionQualified=True,
    inputAlignment=dict(nativeMovingNextQueuedCommandChecks=checked,passed=True),crossCaptureDiagnostics=comparisons,
    interpretation='New record differs materially in physical response: approximately double trackingRMSE and much higher sustained top-hold requests. This flags effective drive/friction/operating-condition mismatch; does not prove which component changed. Dense moving inputs are aligned, current snapshot CRC passes.',
    previousRun09=dict(source=str(priorRaw),sourceSHA256=sha(priorRaw),malformedMetadataRowIndices_zeroBased=bad,missingChunks=missing,
        singleCopyChunks=np.flatnonzero(counts==1).tolist(),expectedCRC32=expected,incompleteBlobCRC32=zlib.crc32(blob),
        completeSnapshotUsable=False,rawRetained=True,missingInputImputed=False,
        reason='Two moving-data chunks absent from every usable repeat. Whole snapshot CRC cannot be verified; not used for model prediction. Operator confirms history cleared and board reset/power-cycled.'),
    modelsUnchanged=True,run010UsedForCalibration=False,newPhysicalRunReleased=False,assistantHardwareAction=False,
    nextStep='Do not fit to this one record or repeat automatically. Check observed operating conditions and drive/transmission response before further model changes; existing six models fail aggregate screening.')
with (HERE/'capture_diagnostics.json').open('x',encoding='utf-8') as f:json.dump(out,f,ensure_ascii=False,indent=2)
print(json.dumps(dict(alignment=out['inputAlignment'],comparisons=comparisons,diagnosticsSHA256=sha(HERE/'capture_diagnostics.json')),ensure_ascii=False))
