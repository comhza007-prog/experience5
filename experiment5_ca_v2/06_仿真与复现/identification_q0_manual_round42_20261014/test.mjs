import assert from 'node:assert/strict';
import {crc32} from '../identification_q0_round41_20261014/decode_q0.mjs';
import {decodeManual} from './analyze.mjs';
const blob=Buffer.alloc(63488);
for(const [o,v] of [[0,1],[4,67821],[8,11],[20,1000],[24,400],[32,20000],[44,1000],[48,48],[52,36],[100,1]])blob.writeUInt32LE(v,o);
for(let n=0;n<1000;n++){let o=128+n*48;blob.writeUInt32LE((n+1)*20,o);blob.writeUInt32LE(20000,o+40);blob[o+44]=20;}
const crc=crc32(blob),rows=[];let seq=1;
function frame(phase){const v=Array(107).fill(0);v[0]=seq*.04;v[1]=seq++;v[2]=phase;v[21]=11;v[63]=67821;v[87]=6;v[92]=1;v[93]=4488;v[46]=20000;return v;}
for(const p of [0,1,2,3,4,5,6])rows.push(frame(p));
for(let c=0;c<3968;c++)for(let k=0;k<2;k++){const v=frame(6);v[88]=4439;v[89]=3;v[90]=c;v[91]=crc&65535;v[92]=63488;v[93]=crc>>>16;for(let w=0;w<8;w++)v[96+w]=blob.readUInt16LE(c*16+w*2);rows.push(v);}
for(let k=0;k<127;k++){const v=[...rows.at(-1)],clock=frame(6);v[0]=clock[0];v[1]=clock[1];v[89]=4;rows.push(v);}
assert(decodeManual(rows).qualified);
const clone=()=>rows.map(r=>[...r]);let bad=clone();bad[8][96]^=1;assert.throws(()=>decodeManual(bad),/Conflicting duplicate/);
bad=rows.filter((r,j)=>j!==8);assert.throws(()=>decodeManual(bad),/Missing chunks/);
assert.throws(()=>decodeManual(rows.slice(0,-126)),/completion tail/);
bad=clone();bad[0][63]=67811;assert.throws(()=>decodeManual(bad),/Identity mismatch/);
bad=clone();bad[2][93]=4487;assert.throws(()=>decodeManual(bad),/Live schema/);
bad=clone();bad[2][0]=bad[1][0];assert.throws(()=>decodeManual(bad),/Reset/);
bad=clone();bad[5][22]=512;assert(!decodeManual(bad).qualified);
bad=clone();bad[2][57]=1;assert(!decodeManual(bad).qualified);
bad=clone();bad[2][60]=1000;assert(!decodeManual(bad).qualified);
// Identical duplicate corruption must still be caught by whole-blob CRC.
bad=clone();bad[7][96]^=1;bad[8][96]^=1;assert.throws(()=>decodeManual(bad),/CRC failed/);
console.log('PASS manual identity/schema/reset,3968 duplicate chunks,CRC,ABI,transition,completion tail,fault and timing rejection; no hardware');
