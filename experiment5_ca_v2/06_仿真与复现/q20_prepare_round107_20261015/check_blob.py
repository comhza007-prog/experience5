"""Independent Python ABI3 fixture reader; no hardware access."""
import csv,hashlib,json,struct,zlib
from pathlib import Path
HERE=Path(__file__).resolve().parent
b=(HERE/'native_blob.bin').read_bytes();assert len(b)==69312
h=struct.unpack_from('<32I',b);assert h[:3]==(3,68312,11)
assert (h[5],h[6],h[8],h[9],h[11],h[12],h[13],h[22],h[23])==(300,4000,28000,0,1000,16,16,0,28000)
assert h[25:32]==(0,2,1,4,2000,100,50)
slow=[struct.unpack_from('<I2h2i',b,128+i*16) for i in range(300)]
fast=[struct.unpack_from('<I2h2i',b,128+304*16+i*16) for i in range(4000)]
with (HERE/'expected_intervals.csv').open(newline='') as f:
    rows=list(csv.DictReader(f))
assert len(rows)==4300
ordered=[*slow[:100],*fast[:2000],*slow[100:150],*fast[2000:],*slow[150:]]
start=0;dt=0;total=[0,0]
for r,e in zip(ordered,rows):
    end=int(e['ms']);phase=int(e['phase']);n=end-start
    assert n==(4 if phase in [2,4] else 40)
    expected0=sum(((i%2401)-1200)*(1001 if i%2 else 999) for i in range(start,end))
    dt+=sum(1001 if i%2 else 999 for i in range(start,end))
    assert r[0]==dt==int(e['actual_us'])
    assert list(r[1:])==[int(e[k]) for k in ['encoder0','encoder1','integral0','integral1']]
    assert r[3]==expected0 and r[4]==-expected0
    assert max(abs(r[1]),abs(r[2]))<32768
    total[0]+=r[3];total[1]+=r[4];start=end
assert start==28000 and dt==28000000
assert total[0]==sum(((i%2401)-1200)*(1001 if i%2 else 999) for i in range(28000))
out=dict(passed=True,version=3,blobBytes=len(b),blobSHA256=hashlib.sha256(b).hexdigest(),CRC32=zlib.crc32(b),
    independentIntervalRows=len(ordered),independentIntegrationSteps=28000,slowRows=300,fastRows=4000,forwardFastRows=2000,
    controlPeriod_us=1000,movingLogIntervalSteps=4,holdingLogIntervalSteps=40,
    instruction='Exact integrals, not recoverable1ms inputs. Fixture is NOT physical evidence.',hardwareAction=False)
with (HERE/'independent_verification.json').open('x',encoding='utf-8') as f:json.dump(out,f,indent=2)
print(json.dumps(out))
