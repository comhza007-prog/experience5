import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
export const payload=[3,4,5,6,7,8,9,10,11,12,15,16,17,18,23,24,25,26,29,30,31,32,33,34,35,36,37,38,39,40,49,50,51,52,104,105,55,56,61,62,64,65,66,67,68,74,75,76];
export const bytes=70944,chunks=Math.ceil(bytes/96);
export function crc32(b){let c=0xffffffff;for(const x of b){c^=x;for(let k=0;k<8;k++)c=(c>>>1)^((c&1)?0xedb88320:0);}return(c^0xffffffff)>>>0;}
export const encode=w=>w<32768?65536+2*w:262144+8*(w-32768);
export function word(v){assert(Number.isInteger(v),'Noninteger packed word');const w=v<262144?(v-65536)/2:32768+(v-262144)/8;assert(Number.isInteger(w)&&w>=0&&w<=65535&&encode(w)===v,'Corrupt packed word');return w;}
const sign=(v,b)=>v>=2**(b-1)?v-2**b:v;
export function decodeBlob(blob){
 assert.equal(blob.length,bytes,'Blob size');const u=o=>blob.readUInt32LE(o),i=o=>blob.readInt32LE(o),s=o=>blob.readInt16LE(o);
 assert(u(0)===2&&u(4)===68012&&u(8)===11,'Header identity/version');
 assert(u(44)===1000&&u(48)===16&&u(52)===8,'ABI');
 const ns=u(20),nf=u(24),ne=u(112),forward=u(116),hold1=u(120),hold3=u(124);
 assert(ns<=304&&nf<=8020&&ne<=64&&forward<=nf&&hold1+hold3<=ns,'Counts');
 const slow=[],fast=[],exception=new Map();
 for(let n=0;n<ns;n++){const o=128+n*16;slow.push({actual_us:u(o),encoder:[s(o+4),s(o+6)],command_integral_counts_us:[i(o+8),i(o+12)]});}
 for(let n=0;n<ne;n++){const o=128+304*16+8020*8+n*28,index=u(o);assert(index<nf&&!exception.has(index),'Exception index');exception.set(index,{actual_us:u(o+4),encoder:[i(o+8),i(o+12)],command_counts:[s(o+16),s(o+18)],rpm:[s(o+20),s(o+22)],age_ms:[blob[o+24],blob[o+25]],flags:blob[o+26]});}
 let encoder=[0,0],time=0;
 for(let n=0;n<nf;n++){
  if(n===0){assert(hold1>0,'Missing first hold anchor');const a=slow[hold1-1];encoder=[...a.encoder];time=a.actual_us;}
  if(n===forward&&n>0){assert(hold3>0,'Missing return anchor');const a=slow[hold1+hold3-1];encoder=[...a.encoder];time=a.actual_us;}
  const o=128+304*16+n*8,w=blob.readBigUInt64LE(o),field=(shift,b)=>Number((w>>BigInt(shift))&((1n<<BigInt(b))-1n));
  const command=[sign(field(0,12),12),sign(field(12,12),12)],rpm=[sign(field(36,8),8),sign(field(44,8),8)],f=field(60,4),dt=1000+sign(field(52,8),8);
  const previous_us=time;time+=dt;encoder=[encoder[0]+sign(field(24,6),6),encoder[1]+sign(field(30,6),6)];
  let row={actual_us:time,dt_us:dt,encoder:[...encoder],command_counts:command,rpm,phase:n<forward?2:4,drive_permit:f&1,fresh_mask:(f>>1)&3,exception:!!(f&8)};
  if(f&8){assert(exception.has(n),'Missing exception');const e=exception.get(n);time=e.actual_us;encoder=[...e.encoder];assert.deepEqual(command,e.command_counts,'Exception command mismatch');row={...row,...e,actual_us:time,dt_us:time-previous_us,encoder:[...encoder]};}
  else assert(!exception.has(n),'Unmarked exception');
  assert(row.dt_us>0,'Nonmonotonic moving clock');fast.push(row);
 }
 // Compute hold dt/integral means using anchors; do not invent hold waveforms.
 for(let n=0;n<slow.length;n++){
  let start=n?slow[n-1].actual_us:0;
  if(n===hold1&&forward>0)start=fast[forward-1].actual_us;
  if(n===hold1+hold3&&nf>forward)start=fast[nf-1].actual_us;
  const r=slow[n];r.dt_us=r.actual_us-start;r.phase=n<hold1?1:n<hold1+hold3?3:5;
  assert(r.dt_us>0,'Nonmonotonic hold clock');r.command_mean_counts=r.command_integral_counts_us.map(x=>x/r.dt_us);
 }
 return {header:{version:u(0),build:u(4),method:u(8),max_age_ms:[u(12),u(16)],slow_count:ns,fast_count:nf,exception_count:ne,forward_count:forward,first_ms:u(28),last_ms:u(32),fault:u(36),quality_flags:u(88),steps:u(92),period_min_us:u(80),period_max_us:u(84),configured_meters_per_count:blob.readFloatLE(72),right_sign:i(76),clock:u(96),manual_mode:u(100),passes:u(104),encoding:u(108)},slow,fast};
}
export function decodeRows(rows){
 assert(rows.length,'Empty capture');const blob=Buffer.alloc(bytes),copies=new Uint16Array(chunks);let crc=null,finished=null,activeGaps=0,stoppedGaps=0;const reasons=[],phases=new Set();
 for(let j=0;j<rows.length;j++){
  const v=rows[j];assert(v.length===107&&v.every(Number.isFinite),'Malformed107channel frame');
  assert(v[63]===68012&&v[21]===11&&v[87]===6,'Identity mismatch');assert(Number.isInteger(v[1]),'Frame sequence');phases.add(v[2]);
  if(j){const prior=rows[j-1];assert(v[0]>prior[0]&&v[1]>prior[1],'Reset/mixed capture');const gap=v[1]-prior[1]-1;assert(gap>=0,'Sequence reversed');if(gap){if([6,9].includes(v[2])&&[6,9].includes(prior[2]))stoppedGaps+=gap;else activeGaps+=gap;}}
  if([0,6,9].includes(v[2]))assert(v[13]===0&&v[14]===0&&v[106]===0,'Nonzero stopped command');
  if(v[22]!==0||v[94]!==0)reasons.push('Fault');
  if(v[57]!==0||v[60]>=1000||v[45]!==0)reasons.push('Timing guard');
  if(v[28]!==0||v[59]!==0||v[70]!==0||v[71]!==0||v[72]!==0)reasons.push('CAN/UART/DMA/BMS error');
  if(v[88]!==4444){assert(v[93]===4499,'Live schema');continue;}
  assert([6,9].includes(v[2])&&v[92]===bytes&&[2,3,4].includes(v[89]),'Snapshot identity');
  if(v[89]===2)continue;
  const checksum=(word(v[93])*65536+word(v[91]))>>>0;if(crc===null)crc=checksum;else assert(crc===checksum,'Mixed snapshot CRC');
  const index=v[90];assert(Number.isInteger(index)&&index>=0&&index<chunks,'Chunk index');const part=Buffer.alloc(96);
  payload.forEach((c,n)=>part.writeUInt16LE(word(v[c]),n*2));const count=Math.min(96,bytes-index*96);
  if(copies[index])assert(part.subarray(0,count).equals(blob.subarray(index*96,index*96+count)),'Conflicting duplicate');else part.copy(blob,index*96,0,count);
  if(v[89]===3)copies[index]++;
  if(v[89]===4){assert(index===0,'Invalid completed cursor');if(finished===null)finished=v[0];}
 }
 assert(copies.every(c=>c>=2),'Missing chunks/duplicate evidence');assert.equal(crc32(blob),crc,'Whole CRC failed');
 assert(finished!==null,'Snapshot export completion absent');
 if(rows.at(-1)[0]-finished<9.99)reasons.push('Completion tail shorter than 10 seconds');
 const result=decodeBlob(blob),h=result.header;
 if(h.quality_flags||h.fault)reasons.push('Recorder quality/fault');if(activeGaps)reasons.push('Active CSV gaps');
 if(![1,2,3,4,5,6].every(p=>phases.has(p)))reasons.push('Incomplete phases');
 if(h.last_ms<20000||h.steps!==Math.max(...rows.map(v=>v[46])))reasons.push('Incomplete core intervals');
 if(h.period_min_us<750||h.period_max_us>1250||h.max_age_ms.some(x=>x>50))reasons.push('Timing/feedback age');
 if(h.passes!==2||h.encoding!==1||h.manual_mode!==1||h.right_sign!==-1)reasons.push('Header mode');
 if(!rows.some(v=>v[58]>=512)||rows.some(v=>v[58]<512))reasons.push('Motor stack margin below512bytes');
 return {...result,qualified:reasons.length===0,reasons:[...new Set(reasons)],transportValid:true,crc32:crc,minimumCopies:Math.min(...copies),frames:rows.length,activeGaps,stoppedGaps,stoppedGapsRecovered:stoppedGaps>0,modelIdentified:false,interpretation:'Queued command,raw endpoint encoder/RPM; not delivered current/torque. Holds40step command integrals only.'};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const source=path.resolve(process.argv[2]),raw=fs.readFileSync(source),lines=raw.toString('utf8').trim().split(/\r?\n/);assert.equal(lines.shift().replace(/^\uFEFF/,''),Array.from({length:107},(_,i)=>'I'+i).join(','));
 const result=decodeRows(lines.map(l=>l.split(',').map(Number)));result.source=source;result.sourceSHA256=crypto.createHash('sha256').update(raw).digest('hex');
 const output=source+'.q2.json';fs.writeFileSync(output,JSON.stringify(result,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({qualified:result.qualified,reasons:result.reasons,header:result.header,output},null,2));
}
