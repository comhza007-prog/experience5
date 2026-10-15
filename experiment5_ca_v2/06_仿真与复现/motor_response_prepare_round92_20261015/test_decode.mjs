import fs from 'node:fs';
import assert from 'node:assert/strict';
import {decodeBlob,decodeRows,crc32,payload,bytes,chunks,magic,build,schema} from './decode.mjs';
const blob=fs.readFileSync('native.bin'),d=decodeBlob(blob);
const lines=fs.readFileSync('expected.csv','utf8').trim().split(/\r?\n/),headers=lines.shift().split(',');
const expected=lines.map(l=>Object.fromEntries(l.split(',').map((v,k)=>[headers[k],Number(v)])));
assert.equal(d.rows.length,2710);let step=0,integrals=[0,0];
for(const r of d.rows){
 const e=expected[r.last_step];assert.equal(r.first_step,step);step+=r.interval_steps;
 assert.deepEqual([r.actual_us,...r.encoder,...r.command_counts,...r.esc_current_raw,...r.rpm,r.battery_mV,...r.feedback_age_ms,r.battery_age_ms],
  [e.us,e.p0,e.p1,e.c0,e.c1,e.i0,e.i1,e.r0,e.r1,e.mV,e.age0,e.age1,e.bms_age]);
 assert.equal(r.meta&511,e.meta);assert.equal(r.phase,e.phase);assert.equal(r.fresh_mask,(e.meta>>2)&3);
 for(let ch=0;ch<2;ch++){
  const want=expected.slice(r.first_step,r.last_step+1).reduce((s,e)=>s+e['c'+ch]*e.dt,0);
  assert.equal(r.mode==='fine'?r.command_counts[ch]*r.dt_us:r.command_integral_counts_us[ch],want);integrals[ch]+=want;
 }
}
assert.equal(step,20000);
const encode=w=>w<32768?65536+2*w:262144+8*(w-32768),checksum=crc32(blob),rows=[];let seq=0;
function frame(phase){const v=Array(107).fill(0);v[0]=seq*.04;v[1]=seq++;v[2]=phase;v[21]=11;v[63]=build;v[87]=6;v[93]=schema;v[46]=20000;v[58]=1024;return v;}
for(const phase of [0,1,2,3,4,5,6])rows.push(frame(phase));
for(let pass=0;pass<2;pass++)for(let n=0;n<chunks;n++)for(let copy=0;copy<2;copy++){
 const index=pass?chunks-1-n:n,r=frame(6);r[88]=magic;r[89]=3;r[90]=index;r[91]=encode(checksum&65535);r[92]=bytes;r[93]=encode(checksum>>>16);
 for(let k=0;k<payload.length;k++){const at=index*96+k*2;r[payload[k]]=encode(at<bytes?blob.readUInt16LE(at):0);}rows.push(r);
}
do{const r=[...rows.at(-1)],clock=frame(6);r[0]=clock[0];r[1]=clock[1];r[89]=4;r[90]=0;rows.push(r);}while(rows.at(-1)[0]<232);
const out=decodeRows(rows);assert(out.qualified&&out.minimumCopies===4&&out.rows.length===2710);
assert.throws(()=>decodeRows(rows.filter(r=>r[89]!==3||r[90]!==100)));
const conflicted=rows.map(r=>[...r]);conflicted[8][payload[0]]=encode(123);assert.throws(()=>decodeRows(conflicted));
const corrupt=rows.map(r=>{const v=[...r];if(v[89]===3&&v[90]===100)v[payload[1]]=encode(123);return v;});assert.throws(()=>decodeRows(corrupt));
assert(!decodeRows(rows.filter((_,i)=>i!==3)).qualified);
const wrong=rows.map(r=>[...r]);wrong[0][63]=68012;assert.throws(()=>decodeRows(wrong));
const short=rows.slice(0,7+chunks*4+2);assert(!decodeRows(short).qualified);
console.log('PASS JS decoder:2710 lossless samples/full20000step integral coverage;CRC/duplicate/identity/gap/tail checks;no hardware');
