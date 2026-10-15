// Read-only CSV check. Preserve prefixes, every outcome and source hashes.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
const dir=path.dirname(fileURLToPath(import.meta.url)),root=path.resolve(dir,'../..');
const protocol=JSON.parse(fs.readFileSync(path.join(dir,'protocol.json'),'utf8'));
const sha=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const rms=a=>Math.sqrt(a.reduce((s,v)=>s+v*v,0)/a.length);
const mean=a=>a.reduce((s,v)=>s+v,0)/a.length;
const range=a=>[Math.min(...a),Math.max(...a)];
const metrics=rows=>{
  if(!rows.length)return null;
  const tracking=rows.map(r=>1000*((r.v[5]+r.v[6])/2-r.v[3]));
  const sync=rows.map(r=>1000*(r.v[5]-r.v[6]));
  return {samples:rows.length,elapsed_s:range(rows.map(r=>r.v[79])),trackingRMSE_mm:rms(tracking),syncRMS_mm:rms(sync),
          maxTracking_mm:Math.max(...tracking.map(Math.abs)),maxSync_mm:Math.max(...sync.map(Math.abs)),
          transmittedWaveTrackingRMSE_mm:rms(rows.map(r=>r.v[53])),transmittedWaveSyncRMS_mm:rms(rows.map(r=>r.v[54]))};
};
const results={};
for(const [method,cfg] of Object.entries(protocol.methods)) {
  const file=path.join(root,protocol.dataRoot,cfg.subfolder,cfg.filename),hash=sha(file);
  const lines=fs.readFileSync(file,'utf8').replace(/^\uFEFF/,'').trim().split(/\r?\n/);
  assert.equal(lines.shift(),Array.from({length:107},(_,i)=>'I'+i).join(','));
  const rows=lines.map((line,i)=>{const v=line.split(',').map(Number);assert(v.length===107&&v.every(Number.isFinite));return {line:i+2,v};});
  const first=rows.findIndex(r=>r.v[21]===cfg.methodID&&r.v[63]===cfg.build);assert(first>=0);
  const prefix=rows.slice(0,first),session=rows.slice(first);
  const identityErrors=session.filter(r=>r.v[21]!==cfg.methodID||r.v[63]!==cfg.build).map(r=>r.line);
  const resets=[],gaps=[];
  for(let i=1;i<session.length;i++) {
    const a=session[i-1],b=session[i];
    if(b.v[0]<=a.v[0]||b.v[1]<=a.v[1])resets.push({line:b.line,time:[a.v[0],b.v[0]],seq:[a.v[1],b.v[1]]});
    if(b.v[1]!==a.v[1]+1)gaps.push({line:b.line,seq:[a.v[1],b.v[1]],phase:[a.v[2],b.v[2]],drive:[a.v[106],b.v[106]]});
  }
  const active=session.filter(r=>r.v[106]===1);
  const motion=active.filter(r=>r.v[2]>=2&&r.v[2]<=5);
  const phases=session.filter((r,i)=>!i||r.v[2]!==session[i-1].v[2]).map(r=>({line:r.line,uptime_s:r.v[0],elapsed_s:r.v[79],phase:r.v[2]}));
  const counters=Object.fromEntries(Object.entries({fault:22,late:45,overrun:57,UARTerrors:59,DMAskipped:70,CANrejected:28}).map(([label,col])=>[label,Math.max(...session.map(r=>r.v[col]))]));
  const activeGaps=gaps.filter(g=>g.drive.some(x=>x===1)||g.phase.some(x=>x>=1&&x<=5));
  const settingsErrors=active.filter(r=>r.v[19]!==1200||r.v[20]!==1200||r.v[87]!==6||r.v[104]!==0||r.v[93]!==cfg.schema).map(r=>r.line);
  const waveErrors=motion.map(r=>({line:r.line,trackingDifference_mm:r.v[53]-1000*((r.v[5]+r.v[6])/2-r.v[3]),syncDifference_mm:r.v[54]-1000*(r.v[5]-r.v[6])}));
  const waveDifferenceMax=[Math.max(...waveErrors.map(r=>Math.abs(r.trackingDifference_mm))),Math.max(...waveErrors.map(r=>Math.abs(r.syncDifference_mm)))];
  // Source coordinates are rounded to6decimals in metres, whereas wave fields
  // are rounded in mm. Two independent rounded position/reference errors can
  // yield up to about1micrometre difference. Never overwrite either source.
  const waveWithinRecordedRoundingBudget=waveDifferenceMax.every(x=>x<=.00101);
  const primary=metrics(motion);
  const firstDone=session.find(r=>r.v[2]===6&&r.v[22]===0);
  const exportRows=session.filter(r=>r.v[88]===cfg.eventMagic),chunks=new Map(),conflicts=[];
  let metadataErrors=0;
  const expectedChunks=method==='BLNN'?5:6,trigger=method==='BLNN'?5000:18000;
  for(const r of exportRows) {
    const index=r.v[90],chunk=r.v[91];
    if(r.v[2]!==6||r.v[22]!==0||r.v[106]!==0||r.v[92]!==128||r.v[93]!==trigger||
       !Number.isInteger(index)||index<0||index>=128||!Number.isInteger(chunk)||chunk<0||chunk>=expectedChunks) {metadataErrors++;continue;}
    const key=index+':'+chunk,payload=r.v.slice(96,104);
    if(chunks.has(key)&&JSON.stringify(chunks.get(key))!==JSON.stringify(payload))conflicts.push(key);
    chunks.set(key,payload);
  }
  const missing=[],eventRecords=[];
  for(let i=0;i<128;i++) {
    const pieces=Array.from({length:expectedChunks},(_,j)=>chunks.get(i+':'+j));
    for(let j=0;j<expectedChunks;j++)if(!pieces[j])missing.push(i+':'+j);
    if(pieces.every(Boolean))eventRecords.push(pieces.flat());
  }
  const complete=exportRows.find(r=>r.v[89]===4);
  const tail_s=complete?session.at(-1).v[0]-complete.v[0]:null;
  const activeSteps=Math.max(...session.map(r=>r.v[46]));
  const orderedPhases=phases.map(r=>r.phase);
  const motionQualified=identityErrors.length===0&&resets.length===0&&JSON.stringify(orderedPhases)==='[0,1,2,3,4,5,6]'&&
    active.length===500&&motion.length>=399&&motion.length<=401&&primary.elapsed_s[1]-primary.elapsed_s[0]>=15.90&&
    activeGaps.length===0&&settingsErrors.length===0&&Object.values(counters).every(x=>x===0)&&activeSteps===20000;
  const eventQualified=metadataErrors===0&&missing.length===0&&conflicts.length===0&&Boolean(complete)&&tail_s>=10&&session.at(-1).v[0]>=100;
  assert.equal(sha(file),hash);
  results[method]={source:file,sourceSHA256:hash,rawUnchanged:true,totalRows:rows.length,currentSessionRows:session.length,
    prefix:{rows:prefix.length,excludedFromMetrics:prefix.length>0,records:prefix.map(r=>({line:r.line,uptime_s:r.v[0],phase:r.v[2],methodID:r.v[21],build:r.v[63]})),
      attribution:prefix.length?'Unidentified pre-session prefix; identity does not match either expected current record. Do not claim its phase9 belongs to this completed run. Original retained.':null},
    entireCSVSingleCleanSession:prefix.length===0&&resets.length===0,identityErrors,resets,phaseChanges:phases,activeSamples:active.length,
    motionQualified,currentSessionFaultFree:counters.fault===0,counters,allSequenceGaps:gaps,activeSequenceGaps:activeGaps,settingsErrors,
    coreSteps:activeSteps,primaryWindow:'Native40ms rows,phase2..5 AND drivePermit=1. Original I3/I5/I6 formulas, no interpolation or selection by performance.',
    metrics:primary,phaseMetrics:[2,3,4,5].map(phase=>({phase,...metrics(motion.filter(r=>r.v[2]===phase))})),
    waveCheck:{sampledSignedValuesNotRMS:true,maximumDifferenceFromRoundedCoordinates_mm:waveDifferenceMax,roundingBudget_mm:.00101,
      withinRoundingBudget:waveWithinRecordedRoundingBudget,primaryNotReplacedByWaveFields:true},
    environment:{motionBatteryRange_V:range(motion.map(r=>r.v[27])),motionBatteryMean_V:mean(motion.map(r=>r.v[27])),
      motionTemperatureMax_C:[29,30].map(col=>Math.max(...motion.map(r=>r.v[col]))),rawRPMpeak:[82,83].map(col=>Math.max(...session.map(r=>r.v[col])))},
    timing:{observedActivePeriodRange_us:range(active.map(r=>r.v[43])),latchedMaxPeriod_us:Math.max(...session.map(r=>r.v[44])),
      latchedCorePeak_us:Math.max(...session.map(r=>r.v[42])),latchedBodyPeak_us:Math.max(...session.map(r=>r.v[60])),
      minimumTaskStack_bytes:Math.min(...session.map(r=>r.v[58])),observedFiniteCoverageNotWCETProof:true},
    terminal:{firstDoneUptime_s:firstDone?.v[0]??null,firstDonePositions_mm:firstDone?firstDone.v.slice(5,7).map(x=>x*1000):null},
    event:{expectedRecords:128,completeRecords:eventRecords.length,missingChunks:missing,duplicateConflicts:conflicts,metadataErrors,
      status4Seen:Boolean(complete),firstStatus4Uptime_s:complete?.v[0]??null,tailAfterStatus4_s:tail_s,finalUptime_s:session.at(-1).v[0],
      complete:eventQualified,differentTriggersNotMatchedMechanismSamples:true},
    qualifiedForThisDescriptivePreview:motionQualified&&waveWithinRecordedRoundingBudget,
    protocolDeviation:prefix.length?'One unidentified prefix row and backward time transition before the sole identified current session. Excluded and disclosed, raw preserved; not a pristine fresh-history CSV.':null};
}
const bothQualified=Object.values(results).every(r=>r.qualifiedForThisDescriptivePreview);
const difference=bothQualified?Object.fromEntries(['trackingRMSE_mm','syncRMS_mm','maxTracking_mm','maxSync_mm'].map(k=>
  [k,{absolute_mm:results.S3R2.metrics[k]-results.BLNN.metrics[k],percent:100*(results.S3R2.metrics[k]/results.BLNN.metrics[k]-1)}])):null;
const output={results,bothCurrentMotionRecordsQualified:bothQualified,
  S3R2_minus_BLNN:difference,replicatesPerMethod:1,rawUnchanged:true,
  nextPhysicalRunAutomaticallyReleased:false,tenRunBatchStillSuspended:true,controllerChanges:false,
  conclusion:bothQualified?'This preview pair shows lower S3R2 synchronization error and higher tracking error. A tradeoff, not both-metric deterioration or repeatable-superiority proof. Keep unidentified BLNN prefix disclosed. No task-based tracking tolerance supplied. No parameter tuning or further trial automatically authorized.':'Record-quality issue: do not infer a method ranking from invalid motion records.',
  limitations:['Single observation per method, not randomized/repeated causal evidence.',
    'One unidentified first BLNN row is excluded by identity/time, not by its performance; original CSV is unchanged.',
    'Different event windows cannot identify component efficacy; whole-controller comparison only.',
    'Positions derive from motor encoders and configured kinematics; current commands are counts, not calibrated amperes.'],
  protocolSHA256:sha(path.join(dir,'protocol.json')),analysisCodeSHA256:sha(fileURLToPath(import.meta.url))};
const outputFile=path.join(dir,'pair01_analysis.json');
fs.writeFileSync(outputFile,JSON.stringify(output,null,2),{flag:'wx'});
console.log(JSON.stringify({bothCurrentMotionRecordsQualified:bothQualified,
  results:Object.fromEntries(Object.entries(results).map(([k,r])=>[k,{sourceSHA256:r.sourceSHA256,metrics:r.metrics,counters:r.counters,
    prefix:r.prefix,event:r.event,timing:r.timing,waveCheck:r.waveCheck,environment:r.environment,phaseMetrics:r.phaseMetrics}])),
  S3R2_minus_BLNN:difference,conclusion:output.conclusion},null,2));
