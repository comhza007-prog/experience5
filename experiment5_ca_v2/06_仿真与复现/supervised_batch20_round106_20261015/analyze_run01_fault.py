"""Read-only fault diagnosis and independent snapshot decode. No hardware IO."""
import csv,hashlib,json,struct,zlib
from pathlib import Path
import numpy as np
HERE=Path(__file__).resolve().parent;ROOT=HERE.parents[1]
raw=ROOT/'01_原始数据/自动采集Q2_20组_20261015/E5ID_Q2B_BLNN_B68212_HW6_L1200_R1200_M0g_S2mm_batch01_run01.csv'
sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
decoded=json.loads(Path(str(raw)+'.q2.json').read_text(encoding='utf-8'))
with raw.open(encoding='utf-8-sig',newline='') as f:
    reader=csv.reader(f);assert next(reader)==[f'I{i}' for i in range(107)];a=np.array([[float(v) for v in r] for r in reader])
assert a.shape[1]==107 and np.isfinite(a).all()
assert np.all(np.diff(a[:,0])>0) and np.all(np.diff(a[:,1])==1)
assert np.all(a[:,63]==68212) and np.all(a[:,87]==6) and np.all(a[:,21]==11)
payload=[3,4,5,6,7,8,9,10,11,12,15,16,17,18,23,24,25,26,29,30,31,32,33,34,35,36,37,38,39,40,49,50,51,52,104,105,55,56,61,62,64,65,66,67,68,74,75,76]
def word(v):
    assert v==int(v)
    x=(int(v)-65536)//2 if v<262144 else 32768+(int(v)-262144)//8
    assert 0<=x<=65535 and (65536+2*x if x<32768 else 262144+8*(x-32768))==v
    return x
blob=bytearray(70944);copies=np.zeros(739,dtype=int);checksum=None
for row in a[(a[:,88]==4444)&(a[:,89]==3)]:
    i=int(row[90]);part=b''.join(struct.pack('<H',word(row[k])) for k in payload);n=min(96,len(blob)-i*96)
    if copies[i]:assert blob[i*96:i*96+n]==part[:n]
    else:blob[i*96:i*96+n]=part[:n]
    copies[i]+=1;c=word(row[91])+65536*word(row[93])
    if checksum is None:checksum=c
    assert checksum==c
assert min(copies)==4 and zlib.crc32(blob)==checksum==decoded['crc32']
h=struct.unpack_from('<32I',blob);assert h[:3]==(2,68212,11) and h[9]==1024 and h[22]==14 and h[25]==0
ns,nf=h[5],h[6];assert ns==100 and nf==3424 and h[28]==0
slow=[struct.unpack_from('<I2h2i',blob,128+i*16) for i in range(ns)]
for i,r in enumerate(slow):
    d=decoded['slow'][i];assert d['actual_us']==r[0] and d['encoder']==list(r[1:3]) and d['command_integral_counts_us']==list(r[3:])
def signed(v,b):return v-2**b if v>=2**(b-1) else v
time=slow[-1][0];enc=list(slow[-1][1:3])
for i in range(nf):
    w=struct.unpack_from('<Q',blob,128+304*16+i*8)[0];field=lambda shift,b:(w>>shift)&((1<<b)-1)
    assert field(60,4)&8==0
    dt=1000+signed(field(52,8),8);time+=dt
    enc=[enc[0]+signed(field(24,6),6),enc[1]+signed(field(30,6),6)]
    d=decoded['fast'][i]
    assert d['actual_us']==time and d['dt_us']==dt and d['encoder']==enc
    assert d['command_counts']==[signed(field(0,12),12),signed(field(12,12),12)]
    assert d['rpm']==[signed(field(36,8),8),signed(field(44,8),8)]
i=int(np.flatnonzero(a[:,22]!=0)[0]);pre=a[:i];fault=a[i];last=pre[-1]
stopped=a[(a[:,2]==9)]
assert np.all(stopped[:,13:15]==0) and np.all(stopped[:,106]==0)
done=a[(a[:,88]==4444)&(a[:,89]==4)&(a[:,90]==0)]
assert len(done) and a[-1,0]-done[0,0]>=20
moving=pre[pre[:,2]==2];bad=np.max(np.abs(moving[:,5:7]-moving[:,3,None]),axis=1)>.001
end=len(bad)
while end>0 and bad[end-1]:end-=1
observedDuration=float(moving[-1,79]-moving[end,79]) if end<len(bad) else 0.
summary=dict(status='Batch halted at first attempt; fault record completely archived, not a qualified training run',
    source=str(raw),sourceSHA256=sha(raw),decodedSHA256=sha(str(raw)+'.q2.json'),attempts=1,qualifiedCompletedRuns=0,requestedRuns=20,
    operatorConfirmedStoppedDriveOffBoardPowered=True,operatorObservation='Almost no motion',
    firstFault=1024,elapsedAtFault_s=float(fault[79]),firstFaultUptime_s=float(fault[0]),
    referenceAtFault_mm=float(fault[3]*1000),positionsAtFault_mm=(fault[5:7]*1000).tolist(),
    trackingErrorsAtFault_mm=((fault[5:7]-fault[3])*1000).tolist(),
    lastActiveQueuedCommands=last[13:15].tolist(),lastActiveESCCurrentCounts=last[15:17].tolist(),
    maxActiveRpmAbs=np.max(np.abs(pre[:,80:82]),axis=0).tolist(),rpmPeakIncludingStartup=fault[82:84].tolist(),
    observedConsecutiveNativeTrackingViolationSpan_s=observedDuration,
    faultInterpretation='Mid-forward phase2, neither axis in negative-direction threshold and no return phase reached. Under unchanged source,1024 at this point is consistent with >1mm tracking deviation persisting1000ms, not final-origin error. Native40ms observations approximate duration, not exact1ms timer reconstruction.',
    rootCause='Not uniquely identified: observed poor motion despite high attempted/current-feedback counts. Cannot attribute to belt friction, supply, motor or startup-mode change without further evidence. ADC voltage is not motor terminal voltage and ESC nativecounts are not calibrated torque.',
    livePrefixVoltageRange_V=[float(min(pre[:,27])),float(max(pre[:,27]))],
    runtimeTiming=dict(overruns=int(max(a[:,57])),latePeriods=int(max(a[:,45])),corePeak_us=float(max(a[:,42])),bodyPeak_us=float(max(a[:,60])),
        recordedPeriodMin_us=decoded['header']['period_min_us'],recordedPeriodMax_us=decoded['header']['period_max_us']),
    frames=len(a),missingCSVFrames=0,CRC32=checksum,minimumIdenticalChunkCopies=int(min(copies)),completeFaultSnapshot=True,
    independentPythonDecodedMovingRows=nf,independentPythonDecodedHoldingRows=ns,completionTail_s=float(a[-1,0]-done[0,0]),
    recorderQualityFlags=14,qualityFlagsMeaning='Fault, incomplete run, absent return/final-hold phases; snapshot itself has complete CRC.',
    zeroDriveAfterFaultVerified=True,controlProtectionWeakened=False,softwareFaultClear=False,automaticRetry=False,
    trainingStarted=False,modelParametersChanged=False,
    nextStep='Keep stopped, no further batch ARM. Need determine why current plant cannot complete unchanged2mm/1200 baseline before supervised batch resume; preserve failed attempt and fixed16/4 split. No extra motion/new excitation authorized by this diagnosis.')
with (HERE/'run01_fault_summary.json').open('x',encoding='utf-8') as f:json.dump(summary,f,ensure_ascii=False,indent=2)
print(json.dumps(summary,ensure_ascii=False,indent=2));print('summarySHA256',sha(HERE/'run01_fault_summary.json'))
