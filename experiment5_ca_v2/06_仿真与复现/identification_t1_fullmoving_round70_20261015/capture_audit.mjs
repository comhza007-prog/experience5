import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {decodeRows,decodeBlob,payload,word,bytes,chunks,crc32} from './decode.mjs';
const source=path.resolve(process.argv[2]);
const raw=fs.readFileSync(source),sha=crypto.createHash('sha256').update(raw).digest('hex');
const lines=raw.toString('utf8').trim().split(/\r?\n/);
assert.equal(lines.shift().replace(/^\uFEFF/,''),Array.from({length:107},(_,i)=>'I'+i).join(','));
const rows=lines.map(l=>l.split(',').map(Number));
const blob=Buffer.alloc(bytes),copies=new Uint16Array(chunks),phases={};
let checksum=null,finished=null,standbyGaps=0,movingGaps=0,otherGaps=0;
for(let j=0;j<rows.length;j++){
 const v=rows[j];assert(v.length===107&&v.every(Number.isFinite));
 assert(v[63]===68112&&v[21]===11&&v[87]===6,'Identity');
 phases[v[2]]=(phases[v[2]]||0)+1;
 if(j){const prev=rows[j-1];assert(v[0]>prev[0]&&v[1]>prev[1],'Reset/mixed capture');
  const gap=v[1]-prev[1]-1;assert(Number.isInteger(gap)&&gap>=0);
  if(v[2]===0&&prev[2]===0)standbyGaps+=gap;
  else if([1,2,3,4,5].includes(v[2])||[1,2,3,4,5].includes(prev[2]))movingGaps+=gap;
  else otherGaps+=gap;
 }
 if(v[88]!==4445){assert.equal(v[93],4500);continue;}
 assert([6,9].includes(v[2])&&v[92]===bytes&&[2,3,4].includes(v[89]));
 if(v[89]===2)continue;
 const crc=(word(v[93])*65536+word(v[91]))>>>0;
 if(checksum===null)checksum=crc;else assert.equal(crc,checksum);
 const index=v[90];assert(Number.isInteger(index)&&index>=0&&index<chunks);
 const part=Buffer.alloc(96);payload.forEach((c,n)=>part.writeUInt16LE(word(v[c]),n*2));
 const count=Math.min(96,bytes-index*96);
 if(copies[index])assert(part.subarray(0,count).equals(blob.subarray(index*96,index*96+count)),'Conflicting copy');
 else part.copy(blob,index*96,0,count);
 if(v[89]===3)copies[index]++;
 if(v[89]===4){assert.equal(index,0);finished??=v[0];}
}
assert(copies.every(n=>n>=2),'Missing redundant chunks');assert.equal(crc32(blob),checksum);
const decoded=decodeBlob(blob),h=decoded.header;
const min=c=>Math.min(...rows.map(v=>v[c])),max=c=>Math.max(...rows.map(v=>v[c]));
const faults=[...new Set(rows.map(v=>v[22]))];
const stopped=rows.filter(v=>[0,6,9].includes(v[2]));
assert(stopped.every(v=>v[13]===0&&v[14]===0&&v[106]===0));
const errors=[22,28,45,57,59,70,71,72,94].filter(c=>max(c)!==0||min(c)!==0);
const m=rows.filter(v=>[2,3,4,5].includes(v[2])&&v[106]===1&&v[88]!==4445);
assert.equal(m.length,400,'Native task window');
const rmse=a=>Math.sqrt(a.reduce((s,x)=>s+x*x,0)/a.length);
const tracking=m.map(v=>((v[5]+v[6])/2-v[3])*1000),sync=m.map(v=>(v[5]-v[6])*1000);
const metrics={nativeSamples:m.length,window:'40ms native phase2..5, drive permitted, meters to mm',trackingRMSE_mm:rmse(tracking),syncRMS_mm:rmse(sync),trackingMaximumAbsolute_mm:Math.max(...tracking.map(Math.abs)),syncMaximumAbsolute_mm:Math.max(...sync.map(Math.abs))};
const display=rows.filter(v=>v[0]>=40&&v[2]===6);
const displayError=[Math.max(...display.map(v=>Math.abs(v[53]-metrics.trackingRMSE_mm))),Math.max(...display.map(v=>Math.abs(v[54]-metrics.syncRMS_mm)))];
assert(displayError.every(x=>x<=.00000051),'Summary mismatch');
let gateChecks=0,gateMismatch=0;
for(let n=1;n<decoded.fast.length;n++){
 const r=decoded.fast[n],prev=decoded.fast[n-1];if(r.phase!==prev.phase)continue;
 const expected=!!(r.symbol_code&1)&&prev.rpm.every(x=>Math.abs(x)<=10);
 gateChecks++;if(expected!==r.requested_injection_enabled)gateMismatch++;
}
const exposure=[2,4].map(phase=>{
 const a=decoded.fast.filter(v=>v.phase===phase),enabled=a.filter(v=>v.requested_injection_enabled);
 const modes=enabled.map(v=>[v.ungated_modal_counts[0]/20,v.ungated_modal_counts[1]/10]);
 const means=[0,1].map(j=>modes.reduce((s,v)=>s+v[j],0)/modes.length);
 const cov=[[0,0],[0,0]];for(const v of modes)for(let j=0;j<2;j++)for(let k=0;k<2;k++)cov[j][k]+=(v[j]-means[j])*(v[k]-means[k])/modes.length;
 const det=cov[0][0]*cov[1][1]-cov[0][1]**2,trace=cov[0][0]+cov[1][1];
 const root=Math.sqrt(Math.max(0,trace**2-4*det)),eigen=[(trace-root)/2,(trace+root)/2];
 const combinations={};for(const v of modes){const key=v.join(',');combinations[key]=(combinations[key]||0)+1;}
 return {phase,rows:a.length,ungated:a.filter(v=>v.symbol_code&1).length,requested:enabled.length,requestedFraction:enabled.length/a.length,normalizedModalMeans:means,normalizedModalCovariance:cov,eigenvalues:eigen,combinationCounts:combinations,requestedMaximumAxisCounts:Math.max(...a.flatMap(v=>v.requested_perturbation_counts).map(Math.abs)),actualMaximumQueuedAxisCounts:Math.max(...a.flatMap(v=>v.command_counts).map(Math.abs)),freshBoth:a.filter(v=>v.fresh_mask===3).length,drivePermitted:a.filter(v=>v.drive_permit===1).length};
});
const live=rows.filter(v=>v[88]!==4445&&[2,4].includes(v[2])&&v[106]===1);
const liveAudit={frames:live.length,available:false,actualMinusShadowCounts:null,reason:'e5_trace_next clears values96..103 even when no fault is latched. Live T1 request/shadow fields are overwritten; no zero requests or zero shadow inferred. Appended 1ms symbol metadata and total queued commands are unaffected.',allShadowChannelsZero:live.every(v=>v[100]===0&&v[101]===0),notDeliveredForce:true};
let strictResult=null,strictFailure=null;try{strictResult=decodeRows(rows);}catch(e){strictFailure=e.message;}
const tail=finished===null?null:rows.at(-1)[0]-finished;
const runtime={faults,errorChannels:errors,period_us:[h.period_min_us,h.period_max_us],corePeak_us:max(42),bodyPeak_us:max(60),stackMinimum_bytes:min(58),feedbackMaximumAge_ms:[max(47),max(48)],fastRecords:decoded.fast.length,holdRecords:decoded.slow.length,qualityFlags:h.quality_flags,allMovingFresh:decoded.fast.every(v=>v.fresh_mask===3),allMovingDrivePermitted:decoded.fast.every(v=>v.drive_permit===1)};
const recordUsable=h.fault===0&&h.quality_flags===0&&errors.length===0&&movingGaps===0&&h.steps===20000&&h.fast_count===8000&&h.slow_count===300&&h.period_min_us>=750&&h.period_max_us<=1250&&runtime.bodyPeak_us<1000&&runtime.stackMinimum_bytes>=512&&gateMismatch===0;
const audit={source,sourceSHA256:sha,sourceBytes:raw.length,frames:rows.length,phases,first_s:rows[0][0],last_s:rows.at(-1)[0],CRC32:checksum,minimumChunkCopies:Math.min(...copies),maximumChunkCopies:Math.max(...copies),completeChunkCount:copies.filter(v=>v>=2).length,totalChunks:chunks,completion_s:finished,completionTail_s:tail,requiredCompletionTail_s:10,completionTailProtocolMet:tail!==null&&tail>=9.99,userHistoryUnavailable:true,strictDecoderFailure:strictFailure,strictQualified:strictResult?.qualified??false,strictReasons:strictResult?.reasons??[],CSVGaps:{standby:standbyGaps,movingAndHolding:movingGaps,other:otherGaps},runtime,metrics,displayRoundingErrors_mm:displayError,exposure,gateAudit:{checks:gateChecks,mismatches:gateMismatch,excludedPhaseFirstIntervals:2,gateUsesPreviousRPMNotIntervalEnd:true},liveCommandAudit:liveAudit,transportBlobIntegrityPassed:true,completeMotionRecordUsableForTraining:recordUsable,inputVariationPresent:exposure.every(v=>v.eigenvalues[0]>0),causalResponseOrParameterIdentifiabilityProven:false,trainingInformationAdequateForModelFit:false,modelIdentified:false,independentValidationReleased:false,formalBatchReleased:false,controllerOrFirmwareChanged:false,assistantHardwareAction:false,interpretation:'Single perturbed ordinary-BLNN training trial. No superiority comparison, calibrated delivered force, persistent-excitation theorem, causal response identification or model closure inferred. Missing completion observation tail does not imply lost CRC-valid motion records. Original raw preserved.'};
const {fileURLToPath}=await import('node:url');
const dest=path.join(path.dirname(fileURLToPath(import.meta.url)),`build68112_${sha.slice(0,12)}_analysis.json`);
fs.writeFileSync(dest,JSON.stringify({...decoded,capture_audit:audit},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({output:dest,audit},null,2));
