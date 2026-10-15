import csv, hashlib, json, math, struct, sys, zlib
import numpy as np
source, decoded_path = sys.argv[1:3]
with open(source, newline='', encoding='utf-8-sig') as handle:
    reader = csv.reader(handle)
    assert next(reader) == [f'I{k}' for k in range(107)]
    a = np.array([[float(v) for v in row] for row in reader])
assert a.shape[1] == 107 and np.isfinite(a).all()
assert np.all(np.diff(a[:,0]) > 0) and np.all(np.diff(a[:,1]) > 0)
assert np.all(a[:,63] == 68112) and np.all(a[:,21] == 11) and np.all(a[:,87] == 6)
payload = [3,4,5,6,7,8,9,10,11,12,15,16,17,18,23,24,25,26,29,30,31,32,33,34,35,36,37,38,39,40,49,50,51,52,104,105,55,56,61,62,64,65,66,67,68,74,75,76]
blob = bytearray(74988)
copies = [0] * 782
expected_crc = None
def word(x):
    assert x == int(x)
    value = (int(x)-65536)//2 if x < 262144 else 32768+(int(x)-262144)//8
    assert 0 <= value <= 65535
    assert (65536+2*value if value < 32768 else 262144+8*(value-32768)) == x
    return value
for row in a:
    if row[88] != 4445 or row[89] != 3:
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
assert min(copies) == max(copies) == 4 and zlib.crc32(blob) == expected_crc
with open(decoded_path, encoding='utf-8') as handle:
    d = json.load(handle)
h = struct.unpack_from('<32I', blob)
assert h[0:3] == (3,68112,11) and h[5:7] == (300,8000)
assert h[22] == 0 and h[28:32] == (0,4000,100,50)
slow = [struct.unpack_from('<I2h2i', blob, 128+k*16) for k in range(300)]
meta = struct.unpack_from('<8I', blob, 70944)
assert meta[:5] == (1,39,1,4010,8000) and meta[7] == 1
def signed(v, bits):
    return v-2**bits if v >= 2**(bits-1) else v
enabled = 0
fresh = [0,0,0,0]
gate_checks = 0
for k in range(8000):
    if k in (0,4000):
        anchor = slow[99 if k == 0 else 149]
        time, encoder = anchor[0], list(anchor[1:3])
    w, = struct.unpack_from('<Q', blob, 128+304*16+k*8)
    field = lambda shift,bits: (w >> shift) & ((1 << bits)-1)
    assert field(60,4) & 8 == 0
    dt = 1000 + signed(field(52,8),8)
    time += dt
    encoder = [encoder[0]+signed(field(24,6),6),encoder[1]+signed(field(30,6),6)]
    commands = [signed(field(0,12),12),signed(field(12,12),12)]
    rpm = [signed(field(36,8),8),signed(field(44,8),8)]
    fresh[(field(60,4) >> 1) & 3] += 1
    r = d['fast'][k]
    assert r['actual_us'] == time and r['dt_us'] == dt
    assert r['encoder'] == encoder and r['command_counts'] == commands and r['rpm'] == rpm
    assert r['phase'] == (2 if k < 4000 else 4)
    code = (blob[70944+32+(k//2)] >> ((k%2)*4)) & 15
    modal = [20 if code & 2 else -20, 10 if code & 4 else -10] if code & 1 else [0,0]
    request = [modal[0]+modal[1],-modal[0]+modal[1]] if code & 8 else [0,0]
    assert r['symbol_code'] == code and r['ungated_modal_counts'] == modal
    assert r['requested_perturbation_counts'] == request
    enabled += bool(code & 8)
    if k not in (0,4000):
        assert bool(code & 8) == (bool(code & 1) and all(abs(v)<=10 for v in previous_rpm))
        gate_checks += 1
    previous_rpm = rpm
assert enabled == meta[5] == 5568 and meta[6] == 8000
for k,row in enumerate(slow):
    r = d['slow'][k]
    assert r['actual_us'] == row[0] and r['encoder'] == list(row[1:3])
    assert r['command_integral_counts_us'] == list(row[3:5])
m = a[(a[:,106] == 1) & (a[:,2] >= 2) & (a[:,2] <= 5)]
assert len(m) == 400
tracking = math.sqrt(float(np.mean((((m[:,5]+m[:,6])/2-m[:,3])*1000)**2)))
sync = math.sqrt(float(np.mean(((m[:,5]-m[:,6])*1000)**2)))
metrics = d['capture_audit']['metrics']
assert abs(tracking-metrics['trackingRMSE_mm']) < 1e-12
assert abs(sync-metrics['syncRMS_mm']) < 1e-12
after40 = a[(a[:,0] >= 40) & (a[:,2] == 6)]
assert np.all(np.abs(after40[:,53]-tracking) <= .00000051)
assert np.all(np.abs(after40[:,54]-sync) <= .00000051)
done = a[(a[:,88] == 4445) & (a[:,89] == 4) & (a[:,90] == 0)]
tail = float(a[-1,0]-done[0,0])
assert abs(tail-d['capture_audit']['completionTail_s']) < 1e-10
assert tail < 10  # Record the protocol deviation; never pad or fabricate observations.
with open(source,'rb') as handle:
    sha = hashlib.sha256(handle.read()).hexdigest()
assert sha == d['capture_audit']['sourceSHA256']
result = {'passed':True,'sourceSHA256':sha,'CRC32':expected_crc,'minimumCopies':min(copies),
 'independentlyDecodedMovingRows':8000,'independentlyDecodedHoldRows':300,
 'requestedMovingIntervals':enabled,'gateChecks':gate_checks,'freshMaskCounts':fresh,
 'nativeSamples':400,'trackingRMSE_mm':tracking,'syncRMS_mm':sync,
 'completionTail_s':tail,'completionTailProtocolMet':False,
 'modelIdentified':False,'noLiveShadowDataInvented':True}
if len(sys.argv)>3:
    with open(sys.argv[3],'x',encoding='utf-8') as handle:
        json.dump(result,handle,ensure_ascii=False,indent=2)
print(json.dumps(result,ensure_ascii=False))
