import assert from 'node:assert/strict';
import fs from 'node:fs';
import {crc32,decodeRows} from './decode_q0.mjs';
const blob=Buffer.alloc(63488);blob.writeUInt32LE(1,0);blob.writeUInt32LE(67811,4);blob.writeUInt32LE(11,8);blob.writeUInt32LE(1000,20);blob.writeUInt32LE(400,24);blob.writeUInt32LE(20000,32);blob.writeUInt32LE(1000,44);blob.writeUInt32LE(48,48);blob.writeUInt32LE(36,52);
for(let n=0;n<1000;n++){let o=128+n*48;blob.writeUInt32LE((n+1)*20,o);blob.writeUInt32LE(20000,o+40);blob[o+44]=20;}
if(process.argv[2]){const native=fs.readFileSync(process.argv[2]);assert.equal(native.length,blob.length);native.copy(blob);}
const crc=crc32(blob),rows=[];let seq=1;
function frame(phase){const v=Array(107).fill(0);v[0]=seq*.04;v[1]=seq++;v[2]=phase;v[21]=11;v[63]=67811;v[87]=6;v[92]=1;v[93]=4487;v[46]=20000;return v;}
for(const p of [0,1,2,3,4,5,6])rows.push(frame(p));
for(let c=0;c<3968;c++)for(let copy=0;copy<2;copy++){const v=frame(6);v[88]=4438;v[89]=3;v[90]=c;v[91]=crc&65535;v[92]=63488;v[93]=crc>>>16;for(let w=0;w<8;w++)v[96+w]=blob.readUInt16LE(c*16+w*2);rows.push(v);}
for(let k=0;k<127;k++){const v=[...rows.at(-1)],clock=frame(6);v[0]=clock[0];v[1]=clock[1];v[89]=4;rows.push(v);}
const decoded=decodeRows(rows);assert(decoded.qualified);
if(process.argv[2]){assert.equal(decoded.slow[0].feedback_sum_counts[0],-655360);assert.equal(decoded.fast[0].encoder[0],5400);assert.equal(decoded.fast[200].encoder[0],11400);}
let bad=rows.map(r=>[...r]);bad[8][96]^=1;assert.throws(()=>decodeRows(bad),/Conflicting duplicate/);
bad=rows.filter((r,j)=>j!==8);assert.throws(()=>decodeRows(bad),/Missing chunks/);
bad=rows.map(r=>[...r]);bad[5][22]=512;assert(!decodeRows(bad).qualified);
assert.throws(()=>decodeRows(rows.slice(0,-126)),/completion tail/);
console.log('PASS 3968 duplicate chunks/CRC/ABI/transition/complete tail; corruption, missing chunk and fault rejection');
