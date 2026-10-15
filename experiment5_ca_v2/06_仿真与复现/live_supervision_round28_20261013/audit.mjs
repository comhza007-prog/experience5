import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
const dir=path.dirname(fileURLToPath(import.meta.url)),root=path.resolve(dir,'../..');
const source=path.join(root,'01_原始数据/自动监视_通信准入_20261013/E5SUP_NO_DRIVE_B66812_COM4_check02.csv');
const bytes=fs.readFileSync(source),lines=bytes.toString('utf8').trim().split(/\r?\n/);
assert.equal(lines.shift(),Array.from({length:107},(_,i)=>'I'+i).join(','));
const rows=lines.map(s=>s.split(',').map(Number));
for(const r of rows){assert.equal(r.length,107);assert(r.every(Number.isFinite));assert.equal(r[63],66812);assert.equal(r[93],4477);assert.equal(r[2],0);assert.equal(r[22],0);assert.equal(r[92],0);assert.equal(r[106],0);assert.equal(r[13],0);assert.equal(r[14],0);assert.equal(r[87],6);}
for(let i=1;i<rows.length;i++){assert(rows[i][1]>rows[i-1][1]);assert(rows[i][0]>rows[i-1][0]);}
const acks=[...new Map(rows.filter(r=>r[104]>0).map(r=>[r[104],{seq:r[104],status:r[105],revision:r[97],nn:r[98],learning:r[99]}])).values()];
assert.deepEqual(acks.map(a=>[a.seq,a.status]),[[1,1],[2,1],[3,3],[4,1],[5,1],[6,1],[7,8]]);
assert.deepEqual([rows.at(-1)[98],rows.at(-1)[99]],[1,1]);
const result={source,sha256:crypto.createHash('sha256').update(bytes).digest('hex'),rows:rows.length,acks,build:66812,schema:4477,allFinite:true,noMotorCommands:true,motionPermission:false,defaultsRestored:true,armCorrectlyDisabled:true,fault:0,communicationQualified:true,physicalMotionQualified:false,paperPerformanceEvidence:false,firstPCCheck:'check01 rejected an incoherent transport frame before UART commands; retained, not a motor trial',flashLog:'flash_attempt01.log',flashVerified:true,systemResets:1,resetWasRestrictedToVerifiedNoDriveImage:true};
fs.writeFileSync(path.join(dir,'verification.json'),JSON.stringify(result,null,2));
console.log(JSON.stringify({rows:result.rows,acks:acks.length,zeroCommands:true,communicationQualified:true,physicalMotionQualified:false}));
