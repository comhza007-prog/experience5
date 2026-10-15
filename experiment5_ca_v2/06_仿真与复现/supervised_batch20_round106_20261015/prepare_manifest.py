"""Generate predetermined data roles only, no serial/debug/hardware imports."""
import hashlib,json
from pathlib import Path
HERE=Path(__file__).resolve().parent;ROOT=HERE.parents[1]
protocol=json.loads((HERE/'protocol.json').read_text(encoding='utf-8'));folder=ROOT/'01_原始数据/自动采集Q2_20组_20261015'
entries=[dict(slot=i,role='heldout' if i in protocol['heldOutSlots'] else 'training',
    file=str(folder/f'E5ID_Q2B_BLNN_B68212_HW6_L1200_R1200_M0g_S2mm_batch01_run{i:02d}.csv'),status='not_collected') for i in range(1,21)]
assert all(not Path(e['file']).exists() for e in entries)
with (HERE/'manifest.json').open('x',encoding='utf-8') as f:json.dump(dict(protocolSHA256=hashlib.sha256((HERE/'protocol.json').read_bytes()).hexdigest(),records=entries,completed=0,firmwareFlashed=True,modelRetrained=False),f,ensure_ascii=False,indent=2)
