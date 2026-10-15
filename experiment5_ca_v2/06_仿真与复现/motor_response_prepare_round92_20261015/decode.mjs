import assert from 'node:assert/strict';
export const bytes=83872,chunks=874,magic=4446,build=68212,schema=4501;
export {payload,crc32,word} from '../identification_q2_summary40s_round61_20261015/decode.mjs';
import {payload,crc32,word} from '../identification_q2_summary40s_round61_20261015/decode.mjs';
export const fineStep=n=>n<200||(n>=3800&&n<4200)||(n>=7800&&n<8200)||(n>=9800&&n<10200)||(n>=13800&&n<14200);
export function decodeBlob(blob){
 assert.equal(blob.length,bytes);const u=o=>blob.readUInt32LE(o),i=o=>blob.readInt32LE(o),s=o=>blob.readInt16LE(o);
 assert.equal(u(0),4);assert.equal(u(4),build);assert.equal(u(8),11);
 assert(u(44)===1000&&u(48)===36&&u(52)===28);
 assert(u(20)<=920&&u(24)<=1808);assert.deepEqual([u(112),u(116),u(120),u(124)],[1,20,1,schema]);
 function sample(o){const meta=blob.readUInt16LE(o+26);assert((meta&~16383)===0);return {
  actual_us:u(o),encoder:[s(o+4),s(o+6)],command_counts:[s(o+8),s(o+10)],
  esc_current_raw:[s(o+12),s(o+14)],rpm:[s(o+16),s(o+18)],battery_mV:blob.readUInt16LE(o+20),
  feedback_age_ms:[blob[o+22],blob[o+23]],battery_age_ms:blob.readUInt16LE(o+24),
  flags:meta&3,fresh_mask:(meta>>2)&3,phase:(meta>>4)&7,battery_valid:!!(meta&128),battery_numeric_valid:!!(meta&256),interval_steps:(meta>>9)&31,meta};}
 const fine=Array.from({length:u(24)},(_,n)=>({...sample(128+n*28),mode:'fine'}));
 const coarse=Array.from({length:u(20)},(_,n)=>{const o=128+1808*28+n*36;return {...sample(o),mode:'coarse',command_integral_counts_us:[i(o+28),i(o+32)]};});
 const rows=[...fine,...coarse].sort((a,b)=>a.actual_us-b.actual_us);let previous=0,steps=0;
 for(const row of rows){row.dt_us=row.actual_us-previous;assert(row.dt_us>0);previous=row.actual_us;
  assert(row.phase>=1&&row.phase<=5);assert(row.command_counts.every(c=>Math.abs(c)<=1200));
  assert(row.interval_steps>0&&row.interval_steps<=(row.mode==='fine'?1:20));
  row.first_step=steps;steps+=row.interval_steps;row.last_step=steps-1;
  if(u(88)===0)assert.equal(fineStep(row.first_step),row.mode==='fine');
  row.command_mean_counts=row.mode==='fine'?[...row.command_counts]:row.command_integral_counts_us.map(x=>x/row.dt_us);
 }
 assert.equal(steps,u(92),'Interval coverage differs from collected core steps');
 return {header:{version:u(0),build:u(4),method:u(8),max_age_ms:[u(12),u(16)],coarse_count:u(20),fine_count:u(24),
  first_ms:u(28),last_ms:u(32),fault:u(36),first_fault_ms:u(40),period_min_us:u(80),period_max_us:u(84),
  quality_flags:u(88),steps:u(92),clock:u(96),manual_mode:u(100),passes:u(104),encoding:u(108),
  configured_meters_per_count:blob.readFloatLE(72),right_sign:i(76)},fine,coarse,rows,
  interpretation:'Raw asynchronous ESC feedback plus previous queued command, not delivered torque. Fine1ms windows and coarse20ms endpoints/integrals, no invented within-block waveform.'};
}
export function decodeRows(rows){
 const blob=Buffer.alloc(bytes),copies=new Uint16Array(chunks),reasons=[],phases=new Set();let checksum=null,done=null,gaps=0;
 for(let k=0;k<rows.length;k++){
  const r=rows[k];assert(r.length===107&&r.every(Number.isFinite));assert(r[63]===build&&r[21]===11&&r[87]===6);
  if(k){assert(r[0]>rows[k-1][0]&&r[1]>rows[k-1][1]);gaps+=r[1]-rows[k-1][1]-1;}
  phases.add(r[2]);if([0,6,9].includes(r[2]))assert(r[13]===0&&r[14]===0&&r[106]===0);
  if(r[22]||r[94])reasons.push('Fault');if(r[57]||r[60]>=1000||r[45])reasons.push('Timing');
  if(r[28]||r[59]||r[70]||r[71]||r[72])reasons.push('CAN/UART/DMA/BMS');
  if(r[88]!==magic){assert.equal(r[93],schema);continue;}
  assert([6,9].includes(r[2])&&r[92]===bytes&&[2,3,4].includes(r[89]));if(r[89]===2)continue;
  const crc=(word(r[91])+65536*word(r[93]))>>>0;if(checksum===null)checksum=crc;assert.equal(crc,checksum);
  const index=r[90];assert(Number.isInteger(index)&&index>=0&&index<chunks);const part=Buffer.alloc(96);
  payload.forEach((channel,n)=>part.writeUInt16LE(word(r[channel]),n*2));const length=Math.min(96,bytes-index*96);
  if(copies[index])assert(part.subarray(0,length).equals(blob.subarray(index*96,index*96+length)));else part.copy(blob,index*96,0,length);
  if(r[89]===3)copies[index]++;
  if(r[89]===4){assert.equal(index,0);done??=r[0];}
 }
 assert(copies.every(c=>c>=2));assert.equal(crc32(blob),checksum);assert(done!==null);
 const d=decodeBlob(blob),h=d.header;if(gaps)reasons.push('CSV gaps');
 if(![0,1,2,3,4,5,6].every(x=>phases.has(x)))reasons.push('Incomplete phases');
 if(h.fault||h.quality_flags)reasons.push('Snapshot quality/fault');
 if(h.steps!==20000||h.fine_count!==1800||h.coarse_count!==910)reasons.push('Incomplete record');
 if(h.period_min_us<750||h.period_max_us>1250||h.max_age_ms.some(x=>x>50))reasons.push('Timing/feedback age');
 if(h.passes!==2||h.encoding!==1||h.manual_mode!==1||h.right_sign!==-1)reasons.push('Mode');
 if(rows.some(r=>r[58]<512))reasons.push('Stack margin');
 const tail=rows.at(-1)[0]-done;if(tail<20||rows.at(-1)[0]<230)reasons.push('Short completion tail');
 if(!h.quality_flags){assert(d.rows.every(r=>r.battery_valid&&r.battery_numeric_valid&&r.battery_age_ms<=100));}
 return {...d,qualified:reasons.length===0,reasons:[...new Set(reasons)],transportValid:true,crc32:checksum,
  minimumCopies:Math.min(...copies),gaps,done_s:done,completionTail_s:tail,frames:rows.length};
}
