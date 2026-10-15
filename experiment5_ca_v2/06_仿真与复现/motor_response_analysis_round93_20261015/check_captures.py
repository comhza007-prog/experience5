"""Independent five-record M1 CRC and full struct decode comparison."""
import csv,hashlib,json,struct,sys,zlib
from pathlib import Path
import numpy as np
here=Path(__file__).resolve().parent
manifest=json.loads((here/'capture_manifest.json').read_text(encoding='utf-8'));checks=[]
payload=[3,4,5,6,7,8,9,10,11,12,15,16,17,18,23,24,25,26,29,30,31,32,33,34,35,36,37,38,39,40,49,50,51,52,104,105,55,56,61,62,64,65,66,67,68,74,75,76]
def word(v):
    assert v==int(v);w=(int(v)-65536)//2 if v<262144 else 32768+(int(v)-262144)//8
    assert 0<=w<=65535 and (65536+2*w if w<32768 else 262144+8*(w-32768))==v
    return w
for item in manifest['records']:
    raw=Path(item['source']);assert hashlib.sha256(raw.read_bytes()).hexdigest()==item['sourceSHA256']
    with raw.open(newline='',encoding='utf-8-sig') as f:
        reader=csv.reader(f);assert next(reader)==[f'I{k}' for k in range(107)];rows=np.array([[float(x) for x in r] for r in reader])
    rows=rows[item['prefixRows']:];assert np.isfinite(rows).all()
    blob=bytearray(83872);copies=np.zeros(874,int);crc=None
    for r in rows:
        if r[88]!=4446 or r[89]!=3:continue
        n=int(r[90]);b=b''.join(struct.pack('<H',word(r[k])) for k in payload);length=min(96,len(blob)-n*96)
        if copies[n]:assert blob[n*96:n*96+length]==b[:length]
        else:blob[n*96:n*96+length]=b[:length]
        copies[n]+=1;checksum=word(r[91])+65536*word(r[93]);crc=checksum if crc is None else crc;assert crc==checksum
    assert min(copies)==4 and zlib.crc32(blob)==crc==item['CRC32']
    h=struct.unpack_from('<32I',blob);assert h[:3]==(4,68212,11) and h[5:7]==(910,1800) and h[22:24]==(0,20000)
    decoded=json.loads(Path(item['decoded']).read_text(encoding='utf-8'));covered=0
    for name,count,offset,stride in [('fine',1800,128,28),('coarse',910,128+1808*28,36)]:
        for n in range(count):
            o=offset+n*stride;s=struct.unpack_from('<I8hH2B2H',blob,o);r=decoded[name][n]
            assert s[0]==r['actual_us'] and list(s[1:9])==r['encoder']+r['command_counts']+r['esc_current_raw']+r['rpm']
            assert list(s[9:])==[r['battery_mV'],*r['feedback_age_ms'],r['battery_age_ms'],r['meta']]
            assert s[13]>>9==r['interval_steps'];covered+=r['interval_steps']
            if name=='coarse':assert list(struct.unpack_from('<2i',blob,o+28))==r['command_integral_counts_us']
    assert covered==20000
    a=rows[(rows[:,106]==1)&(rows[:,2]>=2)&(rows[:,2]<=5)];assert len(a)==400
    refs=np.genfromtxt(here/'reference.csv',delimiter=',',skip_header=1)
    samples=decoded['metric_samples'];snap={r['last_step']:r for r in decoded['rows']};pitch=decoded['header']['configured_meters_per_count']
    positions=[];references=[]
    for row,sample in zip(a,samples):
        assert sample['step']==int(row[46])-2;endpoint=snap[sample['step']]
        pos=np.float32(np.array(endpoint['encoder'],dtype=np.float32)*np.float32(pitch))*np.array([1,-1],dtype=np.float32)
        pos=np.floor(pos.astype(float)*1e6+.5)/1e6
        ref=refs[int(round(row[79]*1000)),2];ref=np.floor(ref*1e6+.5)/1e6
        assert np.max(abs(pos-np.array(sample['position_m'])))<1e-12 and abs(ref-sample['reference_m'])<1e-12
        positions.append(pos);references.append(ref)
    positions=np.array(positions);references=np.array(references)
    track=float(np.sqrt(np.mean(((positions.mean(axis=1)-references)*1000)**2)));sync=float(np.sqrt(np.mean(((positions[:,0]-positions[:,1])*1000)**2)))
    assert abs(track-item['metrics']['trackingRMSE_mm'])<1e-12 and abs(sync-item['metrics']['syncRMS_mm'])<1e-12
    checks.append({'run':item['run'],'passed':True,'CRC32':crc,'fineRows':1800,'coarseRows':910,'coveredIntervals':covered,'nativeSamples':400})
out={'passed':True,'checks':checks,'allFiveStrictRecordingProtocolsQualified':False,'snapshotsAndMetricsUsable':True}
with (here/'capture_verification.json').open('x',encoding='utf-8') as f:json.dump(out,f,ensure_ascii=False,indent=2)
print(json.dumps(out))
