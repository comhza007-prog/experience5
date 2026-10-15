import fs from 'node:fs';import assert from 'node:assert/strict';
import {crc32} from '../identification_q0_round41_20261014/decode_q0.mjs';
import {decodeManual} from '../identification_q0_manual_round42_20261014/analyze.mjs';
const identity={build:67832,schema:4491,magic:4442,passes:2,recoverStoppedGaps:true,wordEncoding:1,profile:1,seed:39,motionEnabled:1};
const blob=fs.readFileSync(process.argv[2]),crc=crc32(blob),rows=[];let seq=1;
const enc=w=>w<32768?65536+2*w:262144+8*(w-32768);
const dec=w=>w<262144?(w-65536)/2:32768+(w-262144)/8;
function frame(phase){const v=Array(107).fill(0);v[0]=seq*.04;v[1]=seq++;v[2]=phase;v[21]=11;v[63]=67832;v[87]=6;v[92]=1;v[93]=4491;v[46]=20000;return v;}
for(const phase of [0,1,2,3,4,5,6])rows.push(frame(phase));
for(let pass=0;pass<2;pass++)for(let n=0;n<3968;n++)for(let copy=0;copy<2;copy++){
 const index=pass===0?n:3967-n,v=frame(6);v[88]=4442;v[89]=3;v[90]=index;v[91]=enc(crc&65535);v[92]=63488;v[93]=enc(crc>>>16);
 for(let w=0;w<8;w++)v[96+w]=enc(blob.readUInt16LE(index*16+w*2));rows.push(v);
}
for(let k=0;k<127;k++){const v=[...rows.at(-1)],clock=frame(6);v[0]=clock[0];v[1]=clock[1];v[89]=4;rows.push(v);}
const d=decodeManual(rows,identity);assert(d.qualified&&d.header.seed===39&&d.header.profile===1&&d.header.requestedExcitationSteps===8000&&d.header.actualIncrementSteps===8000);
assert(d.fast.some(r=>r.command_counts.some((x,k)=>x!==r.zero_injection_shadow_counts[k])));
const bad=rows.map(v=>[...v]);bad[8][96]=enc(dec(bad[8][96])^1);assert.throws(()=>decodeManual(bad,identity),/Conflicting duplicate/);
assert.throws(()=>decodeManual(rows,{...identity,seed:73}),/profile mismatch/);
assert.throws(()=>decodeManual(rows.filter(v=>!(v[89]===3&&v[90]===165)),identity),/Missing chunks/);
assert.throws(()=>decodeManual(rows.slice(0,-126),identity),/completion tail/);
assert(!decodeManual(rows.filter((v,j)=>j!==3),identity).qualified);
assert(!decodeManual(rows,{...identity,motionEnabled:0}).qualified);
console.log('PASS T1 seed/profile/release, injected-shadow400rows,1000slow,8000exposure,CRC/copies/tail/reset identity and active-loss checks; synthetic only');
