"""Independent struct/CRC/interval coverage check, not using the JS decoder."""
import csv,json,struct,sys,zlib
from pathlib import Path
raw=Path(sys.argv[1]).read_bytes()
with open(sys.argv[2],newline='',encoding='utf-8') as f:
    reader=csv.DictReader(f);expected=[{k:int(v) for k,v in r.items()} for r in reader]
assert len(raw)==83872 and len(expected)==20000
h=struct.unpack_from('<32I',raw)
assert h[:3]==(4,68212,11) and h[5:7]==(910,1800) and h[22]==0 and h[23]==20000
assert h[28:32]==(1,20,1,4501)
records=[]
for mode,count,offset,stride in [('fine',1800,128,28),('coarse',910,128+1808*28,36)]:
    for n in range(count):
        o=offset+n*stride;s=struct.unpack_from('<I8hH2B2H',raw,o)
        records.append((s[0],mode,s,struct.unpack_from('<2i',raw,o+28) if mode=='coarse' else None))
records.sort();lookup={r['us']:r for r in expected};last=-1;total=[0,0];fine=0;coarse=0
for timestamp,mode,s,integral in records:
    e=lookup[timestamp];at=e['step'];assert at>last
    assert list(s[1:9])==[e[k] for k in ['p0','p1','c0','c1','i0','i1','r0','r1']]
    assert list(s[9:13])==[e[k] for k in ['mV','age0','age1','bms_age']]
    assert s[13]==(e['meta']|((1 if mode=='fine' else 20)<<9))
    assert (mode=='fine')==bool(e['fine'])
    if mode=='fine':
        assert at-last==1;fine+=1
        for ch in range(2):total[ch]+=e[f'c{ch}']*e['dt']
    else:
        assert at-last==20;coarse+=1
        for ch in range(2):
            want=sum(r[f'c{ch}']*r['dt'] for r in expected[last+1:at+1]);assert integral[ch]==want;total[ch]+=want
    last=at
assert last==19999 and fine==1800 and coarse==910
assert total==[sum(r[f'c{ch}']*r['dt'] for r in expected) for ch in range(2)]
print(json.dumps({'passed':True,'blobBytes':len(raw),'crc32':zlib.crc32(raw),'fineRows':fine,'coarseRows':coarse,
                  'coveredControlIntervals':20000,'rawCurrentAndRPMInt16Lossless':True,'commandIntegralsExact':True}))
