import csv, hashlib, json, math, struct, sys, zlib
import numpy as np

source, decoded_path = sys.argv[1:3]
with open(source, newline='', encoding='utf-8-sig') as handle:
    reader = csv.reader(handle)
    assert next(reader) == [f'I{k}' for k in range(107)]
    rows = np.array([[float(v) for v in row] for row in reader])
assert rows.shape[1] == 107 and np.isfinite(rows).all()
cuts = np.where((np.diff(rows[:, 0]) <= 0) | (np.diff(rows[:, 1]) <= 0))[0] + 1
assert cuts.tolist() == [], 'Unexpected session boundaries'
assert rows[0, 2] == 0 and rows[0, 87] == 6
a = rows
assert np.all(a[:, 63] == 68012) and np.all(a[:, 21] == 11) and np.all(a[:, 87] == 6)
gaps=np.flatnonzero(np.diff(a[:,1])!=1)
assert gaps.tolist()==[0] and a[1,1]-a[0,1]==8 and a[0,2]==a[1,2]==0
payload = [3,4,5,6,7,8,9,10,11,12,15,16,17,18,23,24,25,26,29,30,31,32,33,34,35,36,37,38,39,40,49,50,51,52,104,105,55,56,61,62,64,65,66,67,68,74,75,76]
blob = bytearray(70944)
copies = [0] * 739
expected_crc = None
def word(x):
    assert x == int(x)
    value = (int(x)-65536)//2 if x < 262144 else 32768+(int(x)-262144)//8
    assert 0 <= value <= 65535
    encoded = 65536+2*value if value < 32768 else 262144+8*(value-32768)
    assert encoded == x
    return value
for row in a:
    if row[88] != 4444 or row[89] != 3:
        continue
    index = int(row[90])
    chunk = b''.join(struct.pack('<H', word(row[k])) for k in payload)
    count = min(96, len(blob)-index*96)
    if copies[index]:
        assert blob[index*96:index*96+count] == chunk[:count]
    else:
        blob[index*96:index*96+count] = chunk[:count]
    copies[index] += 1
    checksum = word(row[91]) + 65536*word(row[93])
    if expected_crc is None:
        expected_crc = checksum
    assert checksum == expected_crc
assert min(copies) == 4 and zlib.crc32(blob) == expected_crc
with open(decoded_path, encoding='utf-8') as handle:
    decoded = json.load(handle)
h = struct.unpack_from('<32I', blob)
assert h[0:3] == (2,68012,11) and h[5:7] == (300,8000) and h[22] == 0
assert h[28:32] == (0,4000,100,50)
slow = [struct.unpack_from('<I2h2i', blob, 128+k*16) for k in range(300)]
def signed(v, bits):
    return v-2**bits if v >= 2**(bits-1) else v
time = 0
encoder = [0,0]
for k in range(8000):
    if k in (0,4000):
        anchor = slow[99 if k == 0 else 149]
        time, encoder = anchor[0], list(anchor[1:3])
    w, = struct.unpack_from('<Q', blob, 128+304*16+k*8)
    field = lambda shift, bits: (w >> shift) & ((1 << bits)-1)
    assert field(60,4) & 8 == 0
    dt = 1000 + signed(field(52,8),8)
    time += dt
    encoder = [encoder[0]+signed(field(24,6),6),encoder[1]+signed(field(30,6),6)]
    commands = [signed(field(0,12),12),signed(field(12,12),12)]
    rpm = [signed(field(36,8),8),signed(field(44,8),8)]
    r = decoded['fast'][k]
    assert r['actual_us'] == time and r['dt_us'] == dt
    assert r['encoder'] == encoder and r['command_counts'] == commands and r['rpm'] == rpm
    assert r['phase'] == (2 if k < 4000 else 4)
for k, row in enumerate(slow):
    r = decoded['slow'][k]
    assert r['actual_us'] == row[0] and r['encoder'] == list(row[1:3])
    assert r['command_integral_counts_us'] == list(row[3:5])
m = a[(a[:,106] == 1) & (a[:,2] >= 2) & (a[:,2] <= 5)]
assert len(m) == 400
lookup={};step=0
for mode,start,end in [('slow',0,100),('fast',0,4000),('slow',100,150),('fast',4000,8000),('slow',150,300)]:
    for r in decoded[mode][start:end]:
        step+=40 if mode=='slow' else 1
        lookup[step-1]=r['encoder']
pitch=struct.unpack('<f',struct.pack('<I',h[18]))[0]
positions=np.array([np.array(lookup[int(r[46])-2],np.float32)*np.float32(pitch)*np.array([1,-1],np.float32) for r in m],float)
positions=np.floor(positions*1e6+.5)/1e6
from pathlib import Path
reference_path=Path(decoded_path).parent.parent/'motor_response_analysis_round93_20261015/reference.csv'
reference=np.loadtxt(reference_path,delimiter=',',skiprows=1)
ref=np.floor(reference[np.rint(m[:,79]*1000).astype(int),2]*1e6+.5)/1e6
assert np.max(abs(positions-m[:,5:7]))<=.00000500001
assert np.max(abs(ref-m[:,3]))<=.00000500001
assert np.max(abs(positions-np.array([s['position_m'] for s in decoded['metric_samples']])))<1e-12
tracking=math.sqrt(float(np.mean(((positions.mean(axis=1)-ref)*1000)**2)))
sync=math.sqrt(float(np.mean(((positions[:,0]-positions[:,1])*1000)**2)))
assert abs(tracking-decoded['capture_audit']['metrics']['trackingRMSE_mm']) < 1e-12
assert abs(sync-decoded['capture_audit']['metrics']['syncRMS_mm']) < 1e-12
after40 = a[(a[:,0] >= 40) & (a[:,2] == 6)]
assert np.all(np.abs(after40[:,53]-tracking) <= .0000051)
assert np.all(np.abs(after40[:,54]-sync) <= .0000051)
done = a[(a[:,88] == 4444) & (a[:,89] == 4) & (a[:,90] == 0)]
assert len(done) > 0 and a[-1,0]-done[0,0] >= 10
with open(source,'rb') as handle:
    sha = hashlib.sha256(handle.read()).hexdigest()
assert sha == decoded['sourceSHA256']
print(json.dumps({'passed':True,'sourceSHA256':sha,'crc32':expected_crc,'minimumCopies':min(copies),'independentlyDecodedMovingRows':8000,'independentlyDecodedHoldRows':300,'native40msSamples':400,'trackingRMSE_mm':tracking,'syncRMS_mm':sync,'completionTail_s':float(a[-1,0]-done[0,0]),'excludedResetPrefixRows':0},ensure_ascii=False))
