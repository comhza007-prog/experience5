import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {crc32} from '../identification_q0_round41_20261014/decode_q0.mjs';

export function decodeManual(rows,identity={build:67821,schema:4488,magic:4439,passes:null,recoverStoppedGaps:false}) {
 const blob=Buffer.alloc(63488),copies=new Uint16Array(3968);
 const wordBias=identity.wordBias??0;
 const unpack=w=>{
  let decoded=w-wordBias;
  if(identity.wordEncoding===1){decoded=w<262144?(w-65536)/2:32768+(w-262144)/8;assert(w<262144?w>=65536&&w<=131070:w>=262144&&w<=524280,'Invalid encoded range');}
  assert(Number.isInteger(decoded)&&decoded>=0&&decoded<=65535,'Invalid encoded word');return decoded;
 };
 let expectedCRC=null,completedAt=null,gaps=0,motionGaps=0;
 assert(rows.length>0,'Empty capture');
 for(let j=0;j<rows.length;j++){
  const v=rows[j];assert(v.length===107&&v.every(Number.isFinite),'Malformed frame');
  assert(v[63]===identity.build&&v[21]===11&&v[87]===6,'Identity mismatch');
  assert(Number.isInteger(v[1]),'Fractional sequence');
  if(j){assert(v[0]>rows[j-1][0]&&v[1]>rows[j-1][1],'Reset/mixed capture');const missing=v[1]-rows[j-1][1]-1;gaps+=missing;if(!([6,9].includes(v[2])&&[6,9].includes(rows[j-1][2])))motionGaps+=missing;}
  const stopped=[6,9].includes(v[2]),snapshot=stopped&&v[88]===identity.magic;
  if(!snapshot)assert(v[93]===identity.schema,'Live schema mismatch');
  if([0,6,9].includes(v[2]))assert(v[13]===0&&v[14]===0&&v[106]===0,'Nonzero stopped command');
  if(!snapshot)continue;
  assert(v[92]===63488&&[2,3,4].includes(v[89]),'Snapshot identity mismatch');
  if(v[89]===2)continue;
  const c=(unpack(v[93])*65536+unpack(v[91]))>>>0;
  if(expectedCRC===null)expectedCRC=c;else assert(c===expectedCRC,'Mixed snapshot CRC');
  const index=v[90];assert(Number.isInteger(index)&&index>=0&&index<3968,'Chunk out of range');
  const payload=Buffer.alloc(16);
  for(let k=0;k<8;k++)payload.writeUInt16LE(unpack(v[96+k]),k*2);
  if(copies[index])assert(payload.equals(blob.subarray(index*16,index*16+16)),'Conflicting duplicate');
  else payload.copy(blob,index*16);
  if(v[89]===3)copies[index]++;
  if(v[89]===4&&completedAt===null)completedAt=v[0];
 }
 assert(copies.every(n=>n>=2),'Missing chunks or duplicate evidence');
 assert(crc32(blob)===expectedCRC,'Whole snapshot CRC failed');
 assert(completedAt!==null&&rows.at(-1)[0]-completedAt>=4.99,'Missing completion tail');
 const u=o=>blob.readUInt32LE(o),s=o=>blob.readInt32LE(o),i=o=>blob.readInt16LE(o);
 assert(u(0)===1&&u(4)===identity.build&&u(8)===11&&u(12)===(identity.seed??0)&&u(16)===(identity.profile??0)&&u(100)===1,'Header/profile mismatch');
 if(identity.passes!==null)assert(u(104)===identity.passes,'Export-pass header mismatch');
 if(wordBias)assert(u(108)===wordBias,'Transport encoding header mismatch');
 if(identity.wordEncoding)assert(u(108)===identity.wordEncoding,'Transport encoding header mismatch');
 assert(rows.at(-1)[88]===identity.magic&&rows.at(-1)[89]===4,'Missing terminal completion');
 if(identity.passes===2)assert(rows.at(-1)[90]===0,'Second descending pass incomplete');
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
  if(!identity.profile||!(f.flags&4))assert.deepEqual(f.command_counts,f.zero_injection_shadow_counts,'Unexpected injection');
  else{
   assert([2,4].includes(f.phase)&&(f.flags&1),'Excitation outside permitted phase/drive');
   // Requested<=30 counts; float addition then integer truncation can create
   // a one-count boundary difference. This is not an enlarged hard limit.
   assert(f.command_counts.every((v,k)=>Math.abs(v-f.zero_injection_shadow_counts[k])<=31),'Unbounded injection increment');
  }
  fast.push(f);
 }
 const phases=[...new Set(rows.map(v=>v[2]))],faults=[...new Set(rows.map(v=>v[22]).filter(Boolean))];
 const steps=slow.reduce((a,r)=>a+r.steps,0),coreSteps=Math.max(...rows.map(v=>v[46])),reasons=[];
 if(identity.recoverStoppedGaps?motionGaps:gaps)reasons.push('Live frames missing');
 if(faults.length||u(36)||phases.includes(9))reasons.push('Latched fault');
 if(![0,1,2,3,4,5,6].every(p=>phases.includes(p)))reasons.push('Incomplete startup/motion');
 if(u(88))reasons.push('Recorder header quality flags');
 if(u(20)!==1000||u(24)!==400||steps!==coreSteps||u(32)<20000)reasons.push('Incomplete interval recording');
 if(slow.some(r=>(r.quality_flags&12)||r.max_age_ms.some(a=>a>50)))reasons.push('Timing/feedback-age quality');
 if(rows.some(v=>v[57]!==0||v[60]>=1000))reasons.push('Runtime timing not qualified');
 if(identity.motionEnabled!==undefined&&u(112)!==identity.motionEnabled)reasons.push('Motion release metadata mismatch');
 if(identity.profile&&(!u(116)||!u(120)))reasons.push('No recorded excitation/command-increment exposure');
 return {transportValid:true,qualified:reasons.length===0,reasons,crc32:expectedCRC,minimumCopies:Math.min(...copies),frames:rows.length,gaps,motionGaps,stoppedGapsRecovered:identity.recoverStoppedGaps&&gaps>0&&motionGaps===0,phases,faults,completionTime_s:completedAt,completionTail_s:rows.at(-1)[0]-completedAt,
  header:{version:u(0),build:u(4),method:u(8),seed:u(12),profile:u(16),slow_count:u(20),fast_count:u(24),last_ms:u(32),fault:u(36),first_fault_ms:u(40),quality_flags:u(88),period_min_us:u(80),period_max_us:u(84),origin_counts:[s(56),s(60)],last_encoder_counts:[s(64),s(68)],configured_meters_per_count:blob.readFloatLE(72),configured_right_sign:s(76),CPUclock_Hz:u(96),manualBootStart:u(100),motionEnabled:u(112),requestedExcitationSteps:u(116),actualIncrementSteps:u(120)},steps,coreSteps,slow,fast,
  interpretation:'Release-aligned attempted commands, motor-encoder displacement and ESC feedback counts; not delivered torque/CAN acknowledgement or independent carriage motion.',modelIdentified:false};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const source=path.resolve(process.argv[2]),raw=fs.readFileSync(source),lines=raw.toString('utf8').trim().split(/\r?\n/);
 assert.equal(lines.shift().replace(/^\uFEFF/,''),Array.from({length:107},(_,i)=>'I'+i).join(','));
 const all=lines.map((x,j)=>{const v=x.split(',').map(Number);assert(x.split(',').every(t=>t.trim()!==''),'Empty CSV field at '+(j+2));assert(v.length===107&&v.every(Number.isFinite),'Malformed CSV row '+(j+2));return v;});
 // A stale prefix is segmented only at an explicit new boot, never silently.
 const prefix=all[0][2]===9&&all[0][22]===512&&all[0][63]===0&&all[0][87]===0;
 if(prefix)assert(all[1][2]===0&&all[1][0]<all[0][0]&&all[1][1]<all[0][1],'No explicit new-session boundary');
 const rows=prefix?all.slice(1):all;
 let result;
 try{result=decodeManual(rows);}catch(e){
  // Missing transport bytes are not replaced with zeros or decoded as records.
  // Retain live diagnostics separately without claiming a qualified blob.
  assert.match(e.message,/Missing chunks or duplicate evidence/);
  const seen=new Map(),copies=new Uint16Array(3968),crcs=new Set(),gaps=[];
  for(let j=0;j<rows.length;j++){
   const v=rows[j];
   if(j&&v[1]-rows[j-1][1]>1)gaps.push({CSVRow:j+(prefix?3:2),missingFrames:v[1]-rows[j-1][1]-1,phase:v[2],boardTime_s:v[0]});
   if(v[88]!==4439||![3,4].includes(v[89]))continue;
   crcs.add((v[93]*65536+v[91])>>>0);const q=Buffer.alloc(16);
   for(let k=0;k<8;k++)q.writeUInt16LE(v[96+k],k*2);
   if(seen.has(v[90]))assert(q.equals(seen.get(v[90])),'Conflicting duplicate');else seen.set(v[90],q);
   if(v[89]===3)copies[v[90]]++;
  }
  const completedAt=rows.find(v=>v[88]===4439&&v[89]===4)?.[0]??null;
  result={transportValid:false,qualified:false,reasons:[e.message],frames:rows.length,missingLiveFrames:gaps.reduce((s,g)=>s+g.missingFrames,0),gaps,missingChunks:[...copies].flatMap((n,i)=>n===0?[i]:[]),singleCopyChunks:[...copies].flatMap((n,i)=>n===1?[i]:[]),receivedChunkCount:seen.size,expectedCRC32:[...crcs],wholeCRCVerified:false,decodedSlow:null,decodedFast:null,completionTime_s:completedAt,completionTail_s:completedAt===null?null:rows.at(-1)[0]-completedAt,phases:[...new Set(rows.map(v=>v[2]))],faults:[...new Set(rows.map(v=>v[22]).filter(Boolean))],modelIdentified:false};
 }
 result.source=source;result.sourceSHA256=crypto.createHash('sha256').update(raw).digest('hex');
 result.segmentation=prefix?{rawCSVQualifiedAsSingleSession:false,totalRows:all.length,stalePrefixCSVRow:2,stalePrefixValues:all[0],newSessionCSVRows:[3,all.length+1],rawUnchanged:true,reason:'One incompatible fault512 prefix frame, then board-time/sequence rollback and intact67821 boot. Prefix is preserved, not counted as this session outcome.'}:{rawCSVQualifiedAsSingleSession:true,totalRows:all.length,sessionCSVRows:[2,all.length+1],rawUnchanged:true};
 const live=rows.filter(v=>v[106]===1&&v[2]>=1&&v[2]<=5),active=live.filter(v=>v[2]>=2&&v[2]<=5);
 const range=k=>live.length?[Math.min(...live.map(v=>v[k])),Math.max(...live.map(v=>v[k]))]:null;
 const metric=a=>({n:a.length,rmse_mm:Math.sqrt(a.reduce((s,x)=>s+x*x,0)/a.length),max_abs_mm:Math.max(...a.map(Math.abs))});
 result.liveDiagnostics={activeWindow:'phases2..5 AND I106=1; 40ms live sampling, not full1ms tracking',voltage_V:range(27),rawRPM:[range(80),range(81)],attemptedCommand_counts:[range(13),range(14)],peakRPM:[Math.max(...rows.map(v=>v[82])),Math.max(...rows.map(v=>v[83]))],corePeak_us:Math.max(...rows.map(v=>v[42])),bodyPeak_us:Math.max(...rows.map(v=>v[60])),overruns:Math.max(...rows.map(v=>v[57])),canRejected:Math.max(...rows.map(v=>v[28])),stackHighWater_words:Math.min(...rows.map(v=>v[58])),tracking:metric(active.map(v=>1000*((v[5]+v[6])/2-v[3]))),sync:metric(active.map(v=>1000*(v[5]-v[6]))),finalPosition_mm:rows.at(-1).slice(5,7).map(v=>1000*v)};
 result.motionCompleted=rows.some(v=>v[2]===6)&&rows.every(v=>v[22]===0)&&rows.every(v=>v[2]!==9)&&[0,1,2,3,4,5,6].every(p=>rows.some(v=>v[2]===p));
 const output=path.join(path.dirname(fileURLToPath(import.meta.url)),'run01_'+result.sourceSHA256.slice(0,12)+'_analysis.json');
 fs.writeFileSync(output,JSON.stringify(result,null,2)+'\n',{flag:'wx'});
 console.log(JSON.stringify({...result,slow:undefined,fast:undefined,segmentation:{...result.segmentation,stalePrefixValues:undefined},output},null,2));
}
