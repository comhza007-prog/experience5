import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
const dir=path.dirname(fileURLToPath(import.meta.url));
export function crc32(data){let c=0xffffffff;for(const b of data){c^=b;for(let j=0;j<8;j++)c=(c>>>1)^((c&1)?0xedb88320:0);}return (c^0xffffffff)>>>0;}
export function decode(rows){
 const chunks=new Map(),counts=new Map();let declaredCRC,done=false;
 for(const r of rows){
  assert.equal(r.length,107);assert(r.every(Number.isFinite));assert.equal(r[63],67612);assert.equal(r[21],12);assert.equal(r[22],0);
  if(r[2]!==6)continue;
  assert.equal(r[13],0);assert.equal(r[14],0);assert.equal(r[106],0);assert.equal(r[88],4436);assert.equal(r[92],39536);
  assert([2,3,4].includes(r[89]));if(r[89]===2)continue;
  for(const i of [90,91,93,96,97,98,99,100,101,102,103])assert(Number.isInteger(r[i])&&r[i]>=0&&r[i]<=65535);
  const index=r[90];assert(index<2471);
  const crc=r[91]+65536*r[93];if(declaredCRC===undefined)declaredCRC=crc;else assert.equal(declaredCRC,crc);
  const payload=Buffer.alloc(16);for(let i=0;i<8;i++)payload.writeUInt16LE(r[96+i],i*2);
  if(chunks.has(index))assert.deepEqual(chunks.get(index),payload,'Duplicate payload differs');else chunks.set(index,payload);
  if(r[89]===3)counts.set(index,(counts.get(index)||0)+1);else done=true;
 }
 assert(done,'Complete marker missing');assert.equal(chunks.size,2471);
 for(let i=0;i<2471;i++)assert.equal(counts.get(i),2,'Exactly two status3 copies required');
 const bytes=Buffer.concat(Array.from({length:2471},(_,i)=>chunks.get(i))).subarray(0,39536);
 assert.equal(crc32(bytes),declaredCRC,'CRC32 mismatch');
 const header=Array.from({length:10},(_,i)=>bytes.readUInt32LE(i*4));
 assert.deepEqual(header.slice(0,7),[1,67612,12,5348,48,80,360]);assert.equal(header[9],1000);
 assert(header[7]>=5360&&header[8]>header[7]);
 const rowOffset=40+2*5348;
 for(let i=0;i<360;i++){
  const offset=rowOffset+i*80,ms=bytes.readUInt32LE(offset);assert(i===0?ms===header[7]:ms>bytes.readUInt32LE(offset-80));
  for(let j=0;j<11;j++)assert(Number.isFinite(bytes.readFloatLE(offset+4+j*4)));
  for(let j=0;j<2;j++){assert(Math.abs(bytes.readInt16LE(offset+52+j*2))<=1200);assert(Number.isFinite(bytes.readFloatLE(offset+56+j*4)));assert(Number.isFinite(bytes.readFloatLE(offset+64+j*4)));}
 }
 assert.equal(bytes.readUInt32LE(rowOffset+359*80),header[8]);
 return {bytes,header,CRC32:declaredCRC,chunks:chunks.size,copies:4942};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const file=path.resolve(process.argv[2]||path.join(dir,'synthetic_replay.csv'));
 const raw=fs.readFileSync(file),lines=raw.toString('utf8').trim().split(/\r?\n/);
 assert.equal(lines.shift(),Array.from({length:107},(_,i)=>'I'+i).join(','));
 const decoded=decode(lines.map(l=>l.split(',').map(Number)));
 const output=path.join(dir,process.argv[2]?'captured_replay.bin':'decoded_synthetic_replay.bin');
 if(process.argv[2])assert(!fs.existsSync(output),'Preserve existing captured replay output');
 fs.writeFileSync(output,decoded.bytes);
 console.log(JSON.stringify({source:file,sourceSHA256:crypto.createHash('sha256').update(raw).digest('hex'),output,bytes:decoded.bytes.length,header:decoded.header,chunks:decoded.chunks,copies:decoded.copies,CRC32:decoded.CRC32}));
}
