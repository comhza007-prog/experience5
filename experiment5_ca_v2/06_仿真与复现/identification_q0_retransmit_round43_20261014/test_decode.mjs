import fs from 'node:fs';
import assert from 'node:assert/strict';
import {decodeManual} from '../identification_q0_manual_round42_20261014/analyze.mjs';
import {crc32} from '../identification_q0_round41_20261014/decode_q0.mjs';
const identity={build:67822,schema:4489,magic:4440,passes:2,recoverStoppedGaps:true};
const blob=fs.readFileSync(process.argv[2]),crc=crc32(blob),rows=[];let seq=1;
function frame(phase){const v=Array(107).fill(0);v[0]=seq*.04;v[1]=seq++;v[2]=phase;v[21]=11;v[63]=67822;v[87]=6;v[92]=1;v[93]=4489;v[46]=20000;return v;}
for(const phase of [0,1,2,3,4,5,6])rows.push(frame(phase));
for(let pass=0;pass<2;pass++)for(let n=0;n<3968;n++)for(let copy=0;copy<2;copy++){
 const index=pass===0?n:3967-n,v=frame(6);v[88]=4440;v[89]=3;v[90]=index;v[91]=crc&65535;v[92]=63488;v[93]=crc>>>16;
 for(let w=0;w<8;w++)v[96+w]=blob.readUInt16LE(index*16+w*2);rows.push(v);
}
for(let n=0;n<127;n++){const v=[...rows.at(-1)],clock=frame(6);v[0]=clock[0];v[1]=clock[1];v[89]=4;rows.push(v);}
const good=decodeManual(rows,identity);assert(good.qualified&&good.minimumCopies===4&&good.header.build===67822);
// Replay both observed missing blocks plus a disjoint second-pass10-frame loss.
const loss=rows.filter((v,j)=>!(v[89]===3&&(j<7943?[165,576].includes(v[90]):v[90]>=600&&v[90]<=604)));
const repaired=decodeManual(loss,identity);assert(repaired.qualified&&repaired.stoppedGapsRecovered&&repaired.minimumCopies===2&&repaired.gaps===14);
// Loss in BOTH passes is still rejected, never filled or concealed.
assert.throws(()=>decodeManual(rows.filter(v=>!(v[89]===3&&v[90]===165)),identity),/Missing chunks/);
// A motion-frame gap cannot be repaired by post-stop retransmission.
assert(!decodeManual(rows.filter((v,j)=>j!==3),identity).qualified);
const bad=rows.map(r=>[...r]);bad[8][96]^=1;assert.throws(()=>decodeManual(bad,identity),/Conflicting duplicate/);
const allCorrupt=rows.map(v=>{const r=[...v];if(r[89]===3&&r[90]===165)r[96]^=1;return r;});assert.throws(()=>decodeManual(allCorrupt,identity),/CRC failed/);
assert.throws(()=>decodeManual(rows.slice(0,-126),identity),/completion tail/);
const oldID=rows.map(r=>[...r]);oldID[0][63]=67821;assert.throws(()=>decodeManual(oldID,identity),/Identity mismatch/);
console.log('PASS float/double native ABI: two-pass4copies,14lostFramesRecovered, both-pass loss/active gap/CRC/corrupt duplicate/identity/tail rejected; no hardware');
