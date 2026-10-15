import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
export function crc32(buf){let c=0xffffffff;for(const b of buf){c^=b;for(let k=0;k<8;k++)c=(c>>>1)^((c&1)?0xedb88320:0);}return (c^0xffffffff)>>>0;}
export function decodeRows(rows){
 const blob=Buffer.alloc(63488),copies=new Uint16Array(3968);let expectedCRC=null,completedAt=null,gaps=0;
 assert(rows.length>0,'Empty capture');
 for(let j=0;j<rows.length;j++){
  const v=rows[j];assert(v.length===107&&v.every(Number.isFinite),'Malformed frame');
  assert(v[63]===67811&&v[21]===11&&v[87]===6,'Identity mismatch');
  if(j){assert(v[0]>rows[j-1][0]&&v[1]>rows[j-1][1],'Reset/mixed capture');gaps+=v[1]-rows[j-1][1]-1;}
  assert(Number.isInteger(v[1]),'Fractional frame sequence');
  if(v[2]!==6&&!(v[2]===9&&v[88]===4438))assert(v[93]===4487,'Live schema mismatch');
  if([0,6,9].includes(v[2]))assert(v[13]===0&&v[14]===0&&v[106]===0,'Nonzero stopped command');
  if(v[88]!==4438||![6,9].includes(v[2]))continue;
  assert(v[92]===63488&&[2,3,4].includes(v[89]),'Snapshot identity mismatch');
  if(v[89]===2)continue;
  const c=(v[93]*65536+v[91])>>>0;
  if(expectedCRC===null)expectedCRC=c;else assert(c===expectedCRC,'Mixed snapshot CRC');
  const index=v[90];assert(Number.isInteger(index)&&index>=0&&index<3968,'Chunk out of range');
  const payload=Buffer.alloc(16);
  for(let k=0;k<8;k++){const w=v[96+k];assert(Number.isInteger(w)&&w>=0&&w<=65535,'Corrupt word');payload.writeUInt16LE(w,k*2);}
  if(copies[index])assert(payload.equals(blob.subarray(index*16,index*16+16)),'Conflicting duplicate');
  else payload.copy(blob,index*16);
  if(v[89]===3)copies[index]++;
  if(v[89]===4&&completedAt===null)completedAt=v[0];
 }
 assert(copies.every(n=>n>=2),'Missing chunks or duplicate evidence');
 assert(crc32(blob)===expectedCRC,'Whole snapshot CRC failed');
 assert(completedAt!==null&&rows.at(-1)[0]-completedAt>=4.99,'Missing completion tail');
 const u=o=>blob.readUInt32LE(o),s=o=>blob.readInt32LE(o),i=o=>blob.readInt16LE(o);
 assert(u(0)===1&&u(4)===67811&&u(8)===11&&u(12)===0&&u(16)===0,'Header/profile mismatch');
 assert(u(44)===1000&&u(48)===48&&u(52)===36,'ABI mismatch');
 assert(u(20)>0&&u(20)<=1020&&u(24)<=400,'Bad record count');
 const slow=[],fast=[];
 for(let n=0;n<u(20);n++){
  const o=128+n*48,dt=u(o+40),steps=blob[o+44];assert(steps>0&&steps<=20&&dt>0,'Invalid interval');
  slow.push({end_ms:u(o),encoder:[s(o+4),s(o+8)],command_integral_counts_us:[s(o+12),s(o+16)],command_mean_counts:[s(o+12)/dt,s(o+16)/dt],feedback_sum_counts:[s(o+20),s(o+24)],command_min_counts:[i(o+28),i(o+30)],command_max_counts:[i(o+32),i(o+34)],rpm:[i(o+36),i(o+38)],elapsed_us:dt,steps,quality_flags:blob[o+45],max_age_ms:[blob[o+46],blob[o+47]]});
 }
 for(let n=0;n<u(24);n++){
  const o=128+1020*48+n*36;
  const f={ms:u(o),actual_us:u(o+4),encoder:[s(o+8),s(o+12)],rpm:[i(o+16),i(o+18)],command_counts:[i(o+20),i(o+22)],feedback_counts:[i(o+24),i(o+26)],zero_injection_shadow_counts:[i(o+28),i(o+30)],age_ms:[blob[o+32],blob[o+33]],phase:blob[o+34],flags:blob[o+35]};
  assert.deepEqual(f.command_counts,f.zero_injection_shadow_counts,'Q0 injection detected');fast.push(f);
 }
 const phases=[...new Set(rows.map(v=>v[2]))],faults=[...new Set(rows.map(v=>v[22]).filter(Boolean))];
 const steps=slow.reduce((a,r)=>a+r.steps,0),coreSteps=Math.max(...rows.map(v=>v[46]));
 const reasons=[];
 if(gaps)reasons.push('Live frames missing');
 if(faults.length||u(36)||phases.includes(9))reasons.push('Latched fault');
 if(![1,2,3,4,5,6].every(p=>phases.includes(p)))reasons.push('Incomplete motion');
 if(u(88))reasons.push('Recorder header quality flags');
 if(u(24)!==400||steps!==coreSteps||u(32)<20000)reasons.push('Incomplete interval recording');
 if(slow.some(r=>(r.quality_flags&12)||r.max_age_ms.some(a=>a>50)))reasons.push('Timing/feedback-age quality');
 if(rows.some(v=>v[57]!==0||v[60]>=1000))reasons.push('Runtime timing not qualified');
 return {transportValid:true,qualified:reasons.length===0,reasons,crc32:expectedCRC,minimumCopies:Math.min(...copies),frames:rows.length,gaps,phases,faults,
  header:{version:u(0),build:u(4),method:u(8),slow_count:u(20),fast_count:u(24),last_ms:u(32),fault:u(36),quality_flags:u(88),period_min_us:u(80),period_max_us:u(84),configured_meters_per_count:blob.readFloatLE(72),configured_right_sign:s(76)},steps,coreSteps,slow,fast,
  interpretation:'Release-aligned attempted commands, encoder-derived displacement, and ESC feedback counts. No torque calibration or CAN delivery acknowledgement.',modelIdentified:false};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const source=path.resolve(process.argv[2]),raw=fs.readFileSync(source),lines=raw.toString('utf8').trim().split(/\r?\n/);
 assert.equal(lines.shift().replace(/^\uFEFF/,''),Array.from({length:107},(_,i)=>'I'+i).join(','));
 const result=decodeRows(lines.map(x=>x.split(',').map(Number)));
 result.source=source;result.sourceSHA256=crypto.createHash('sha256').update(raw).digest('hex');
 const output=source+'.q0.json';fs.writeFileSync(output,JSON.stringify(result,null,2)+'\n',{flag:'wx'});
 console.log(JSON.stringify({qualified:result.qualified,reasons:result.reasons,steps:result.steps,coreSteps:result.coreSteps,header:result.header,output},null,2));
}
