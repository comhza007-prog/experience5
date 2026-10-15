import fs from 'node:fs';import assert from 'node:assert/strict';import crypto from 'node:crypto';import path from 'node:path';import {fileURLToPath} from 'node:url';
export const bytes=69312,chunks=722,payload=[3,4,5,6,7,8,9,10,11,12,15,16,17,18,23,24,25,26,29,30,31,32,33,34,35,36,37,38,39,40,49,50,51,52,104,105,55,56,61,62,64,65,66,67,68,74,75,76];
export function crc32(b){let c=0xffffffff;for(const x of b){c^=x;for(let k=0;k<8;k++)c=(c>>>1)^((c&1)?0xedb88320:0);}return(c^0xffffffff)>>>0;}
export function word(v){assert(Number.isInteger(v));const w=v<262144?(v-65536)/2:32768+(v-262144)/8;assert(Number.isInteger(w)&&w>=0&&w<=65535&&(w<32768?65536+2*w:262144+8*(w-32768))===v);return w;}
export function decodeBlob(b){
 assert.equal(b.length,bytes);const u=o=>b.readUInt32LE(o),h=Array.from({length:32},(_,i)=>u(i*4));
 assert.deepEqual(h.slice(0,3),[3,68612,11]);assert.deepEqual(h.slice(11,14),[1000,16,16]);
 assert(h[5]<=304&&h[6]<=4020&&h[29]<=h[6]&&h[30]+h[31]<=h[5]);assert.deepEqual(h.slice(25,29),[1,2,1,4]);
 const read=(base,n)=>Array.from({length:n},(_,i)=>{const o=base+i*16;return {actual_us:u(o),encoder:[b.readInt16LE(o+4),b.readInt16LE(o+6)],command_integral_counts_us:[b.readInt32LE(o+8),b.readInt32LE(o+12)]};});
 const slow=read(128,h[5]),fast=read(128+304*16,h[6]);let time=0,step=0;const ordered=[];
 for(const [data,a,end,phase,stride] of [[slow,0,h[30],1,40],[fast,0,h[29],2,4],[slow,h[30],h[30]+h[31],3,40],[fast,h[29],h[6],4,4],[slow,h[30]+h[31],h[5],5,40]]){
  for(const r of data.slice(a,end)){r.dt_us=r.actual_us-time;assert(r.dt_us>0);time=r.actual_us;step+=stride;r.step=step-1;r.phase=phase;r.nominal_interval_steps=stride;r.command_mean_counts=r.command_integral_counts_us.map(v=>v/r.dt_us);assert(r.command_mean_counts.every(v=>Math.abs(v)<=1200.000001));ordered.push(r);}
 }
 return {header:{version:3,build:h[1],method:h[2],max_age_ms:h.slice(3,5),slow_count:h[5],fast_count:h[6],first_ms:h[7],last_ms:h[8],fault:h[9],first_fault_ms:h[10],core_dt_us:h[11],row_bytes:16,configured_meters_per_count:b.readFloatLE(72),right_sign:b.readInt32LE(76),period_min_us:h[20],period_max_us:h[21],quality_flags:h[22],steps:h[23],clock:h[24],manual_mode:h[25],passes:h[26],encoding:h[27],fast_interval_steps:h[28],forward_count:h[29],initial_hold_count:h[30],top_hold_count:h[31]},slow,fast,ordered,interpretation:'Exact interval integrals and endpoint encoders; no recovery of intra4ms commands or1ms RPM. Mean-input replay is an approximation, not delivered torque.'};
}
export function decodeRows(rows){
 const b=Buffer.alloc(bytes),copies=new Uint16Array(chunks);let crc=null,done=null;const reasons=new Set();assert(rows.length);
 for(let i=0;i<rows.length;i++){
  const v=rows[i];assert(v.length===107&&v.every(Number.isFinite));assert(v[63]===68612&&v[21]===11&&v[87]===6);
  if(i){assert(v[0]>rows[i-1][0]&&v[1]>rows[i-1][1]);if(v[1]!==rows[i-1][1]+1)reasons.add('CSV gaps');}
  if(v[22]||v[94])reasons.add('Fault');if([0,6,9].includes(v[2]))assert(v[13]===0&&v[14]===0&&v[106]===0);
  if(v[57]||v[59]||v[28]||v[70]||v[71]||v[72])reasons.add('Runtime/CAN/UART/DMA/BMS error');
  if(v[88]!==4445){assert.equal(v[93],4504);continue;}
  assert([6,9].includes(v[2])&&v[92]===bytes&&[2,3,4,5].includes(v[89]));if([2,5].includes(v[89]))continue;
  const c=(65536*word(v[93])+word(v[91]))>>>0;if(crc===null)crc=c;assert.equal(crc,c);
  const index=v[90];assert(Number.isInteger(index)&&index>=0&&index<chunks);const part=Buffer.alloc(96);payload.forEach((channel,k)=>part.writeUInt16LE(word(v[channel]),2*k));
  if(copies[index])assert(part.equals(b.subarray(index*96,index*96+96)));else part.copy(b,index*96);
  if(v[89]===3)copies[index]++;if(v[89]===4){assert(index===0);if(done===null)done=v[0];}
 }
 assert(copies.every(c=>c>=4),'Incomplete fourcopy snapshot');assert.equal(crc32(b),crc,'CRC mismatch');assert(done!==null&&rows.at(-1)[0]-done>=19.99&&rows.at(-1)[0]>=185,'Export/tail incomplete');
 const d=decodeBlob(b),h=d.header;if(h.fault||h.quality_flags)reasons.add('Recorder fault/quality');
 if(h.fast_count!==4000||h.slow_count!==300||h.steps!==28000||h.last_ms!==28000)reasons.add('Incomplete trajectory');
 if(h.period_min_us<750||h.period_max_us>1250||h.max_age_ms.some(v=>v>50))reasons.add('Timing/feedback');
 const native=rows.filter(v=>v[106]===1&&v[2]>=2&&v[2]<=5);if(native.length!==600)reasons.add('Not600native metric points');
 if(![1,2,3,4,5,6].every(p=>rows.some(v=>v[2]===p)))reasons.add('Incomplete phases');
 return {...d,transportValid:true,CRC32:crc,minimumCopies:Math.min(...copies),qualified:reasons.size===0,reasons:[...reasons],nativeMetricPoints:native.length,completionTail_s:rows.at(-1)[0]-done};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const source=path.resolve(process.argv[2]),raw=fs.readFileSync(source),lines=raw.toString('utf8').trim().split(/\r?\n/);assert.equal(lines.shift().replace(/^\uFEFF/,''),Array.from({length:107},(_,i)=>'I'+i).join(','));
 const d=decodeRows(lines.map(l=>l.split(',').map(Number)));d.source=source;d.sourceSHA256=crypto.createHash('sha256').update(raw).digest('hex');fs.writeFileSync(source+'.q20.json',JSON.stringify(d,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({qualified:d.qualified,reasons:d.reasons,header:d.header,minimumCopies:d.minimumCopies}));
}
