import fs from 'node:fs';
import assert from 'node:assert/strict';
import {decodeBlob,decodeRows,crc32,payload,bytes,chunks,encode} from './decode.mjs';
const blob=fs.readFileSync('native.bin'),expected=fs.readFileSync('expected.csv','utf8').trim().split(/\r?\n/).slice(1).map(l=>l.split(',').map(Number)),result=decodeBlob(blob);
let nf=0,ns=0,integral=[0,0],steps=0,holdPhase=0;
for(const x of expected){
 const [n,phase,us,p0,p1,c0,c1,r0,r1,dt]=x;
 if(phase===2||phase===4){const r=result.fast[nf++];assert.deepEqual([r.phase,r.actual_us,...r.encoder,...r.command_counts,...r.rpm,r.dt_us],[phase,us,p0,p1,c0,c1,r0,r1,dt]);assert.equal(r.fresh_mask,3);}
 else{
  assert(!holdPhase||holdPhase===phase);holdPhase=phase;integral[0]+=c0*dt;integral[1]+=c1*dt;steps++;
  if(steps===40){const r=result.slow[ns++];assert.deepEqual([r.phase,r.actual_us,...r.encoder,...r.command_integral_counts_us],[phase,us,p0,p1,...integral]);integral=[0,0];steps=0;holdPhase=0;}
 }
}
assert.equal(nf,8000);assert.equal(ns,300);
const rows=[],crc=crc32(blob);let seq=1;
function frame(phase){const v=Array(107).fill(0);v[0]=seq*.04;v[1]=seq++;v[2]=phase;v[21]=11;v[63]=68011;v[87]=6;v[93]=4498;v[46]=20000;v[58]=1024;return v;}
for(const phase of [0,1,2,3,4,5,6])rows.push(frame(phase));
for(let pass=0;pass<2;pass++)for(let n=0;n<chunks;n++)for(let copy=0;copy<2;copy++){
 const index=pass?n===0?chunks-1:chunks-1-n:n,v=frame(6);v[88]=4443;v[89]=3;v[90]=index;v[91]=encode(crc&65535);v[92]=bytes;v[93]=encode(crc>>>16);
 for(let k=0;k<payload.length;k++){const o=index*96+k*2;v[payload[k]]=encode(o<bytes?blob.readUInt16LE(o):0);}rows.push(v);
}
for(let n=0;n<252;n++){const v=[...rows.at(-1)],clock=frame(6);v[0]=clock[0];v[1]=clock[1];v[89]=4;rows.push(v);}
let good=decodeRows(rows);assert(good.qualified&&good.minimumCopies===4);
const loss=rows.filter((v,j)=>!(v[89]===3&&(j<7+chunks*2?v[90]===165:v[90]===600)));
good=decodeRows(loss);assert(good.qualified&&good.minimumCopies===2&&good.stoppedGapsRecovered&&good.stoppedGaps===4);
assert.throws(()=>decodeRows(rows.filter(v=>v[89]!==3||v[90]!==165)),/Missing chunks/);
assert(!decodeRows(rows.filter((v,j)=>j!==3)).qualified);
const conflict=rows.map(r=>[...r]);conflict[8][payload[0]]=encode(12345);assert.throws(()=>decodeRows(conflict),/Conflicting duplicate/);
const corrupt=rows.map(v=>{const r=[...v];if(v[89]===3&&v[90]===165)r[payload[0]]=encode(12345);return r;});assert.throws(()=>decodeRows(corrupt),/CRC failed/);
assert.throws(()=>decodeRows(rows.slice(0,-251)),/completion tail/);
const old=rows.map(v=>[...v]);old[0][63]=67823;assert.throws(()=>decodeRows(old),/Identity mismatch/);
const stale=Buffer.from(blob);stale.writeUInt32LE(1,0);assert.throws(()=>decodeBlob(stale),/version/);
const wire=Buffer.alloc(432);rows[8].forEach((v,n)=>wire.writeFloatLE(v,n*4));wire.set([0,0,128,127],428);assert.equal(wire.subarray(0,428).indexOf(Buffer.from([0,0,128,127])),-1,'Synthetic stopped payload delimiter');
console.log('PASS independent decoder:8000 exact moving rows,300exact integral holds;4copies/loss recovery;active gaps/CRC/duplicate/version/identity/tail checks; no hardware');
