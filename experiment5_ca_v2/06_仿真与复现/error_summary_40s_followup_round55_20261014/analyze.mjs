// Analyze ALL supplied attempts. Never repair/drop raw frames or tune firmware.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
const here=path.dirname(fileURLToPath(import.meta.url)),root=path.resolve(here,'../..');
const protocolFile=path.join(root,'06_仿真与复现/error_summary_40s_round52_20261014/protocol.json');
const protocol=JSON.parse(fs.readFileSync(protocolFile,'utf8'));
const sha=f=>crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const rms=x=>Math.sqrt(x.reduce((s,v)=>s+v*v,0)/x.length);
const mean=x=>x.reduce((s,v)=>s+v,0)/x.length;
const range=x=>[Math.min(...x),Math.max(...x)];
const metric=rows=>{
  if(!rows.length)return null;
  const tracking=rows.map(r=>1000*((r.v[5]+r.v[6])/2-r.v[3]));
  const sync=rows.map(r=>1000*(r.v[5]-r.v[6]));
  return {N:rows.length,elapsed_s:range(rows.map(r=>r.v[79])),trackingRMSE_mm:rms(tracking),syncRMS_mm:rms(sync),
    maxTracking_mm:Math.max(...tracking.map(Math.abs)),maxSync_mm:Math.max(...sync.map(Math.abs))};
};
assert(Math.abs(rms([-.1,.1])-.1)<1e-15);
const results=[];
for(const [method,cfg] of Object.entries(protocol.methods)) {
  const folder=path.join(root,protocol.dataRoot,cfg.subfolder);
  const files=fs.readdirSync(folder).filter(n=>n.endsWith('.csv')).sort();assert(files.length>0);
  for(const name of files) {
    const file=path.join(folder,name),hash=sha(file),parts=name.match(/_pair(\d+)_attempt(\d+)\.csv$/);assert(parts);
    const lines=fs.readFileSync(file,'utf8').replace(/^\uFEFF/,'').trim().split(/\r?\n/);
    assert.equal(lines.shift(),Array.from({length:107},(_,i)=>'I'+i).join(','));
    const rows=lines.map((s,i)=>{const v=s.split(',').map(Number);assert(v.length===107&&v.every(Number.isFinite));return {line:i+2,v};});
    // Split by identity OR clock/sequence reset, not by performance. Retain
    // each segment and require a unique identified segment with active motion.
    const segments=[[]];
    for(let i=0;i<rows.length;i++) {
      const r=rows[i],prev=rows[i-1];
      if(prev&&(r.v[0]<=prev.v[0]||r.v[1]<=prev.v[1]||r.v[21]!==prev.v[21]||r.v[63]!==prev.v[63]))segments.push([]);
      segments.at(-1).push(r);
    }
    const candidates=segments.filter(s=>s.every(r=>r.v[21]===cfg.methodID&&r.v[63]===cfg.build)&&s.some(r=>r.v[106]===1));
    assert.equal(candidates.length,1,'Multiple/absent active sessions must not be silently selected: '+name);
    const session=candidates[0],excluded=segments.filter(s=>s!==session).flat();
    const gaps=[];
    for(let i=1;i<session.length;i++) {
      const a=session[i-1],b=session[i];
      assert(b.v[0]>a.v[0]&&b.v[1]>a.v[1]);
      if(b.v[1]!==a.v[1]+1)gaps.push({sourceLine:b.line,sequence:[a.v[1],b.v[1]],missing:Math.round(b.v[1]-a.v[1]-1),
        uptime_s:[a.v[0],b.v[0]],elapsed_s:[a.v[79],b.v[79]],phase:[a.v[2],b.v[2]],drivePermit:[a.v[106],b.v[106]],
        precedingDMACompleted:a.v[69],followingDMACompleted:b.v[69],precedingMask:a.v[68],followingMask:b.v[68]});
    }
    const active=session.filter(r=>r.v[106]===1),motion=active.filter(r=>r.v[2]>=2&&r.v[2]<=5);
    const changes=session.filter((r,i)=>!i||r.v[2]!==session[i-1].v[2]).map(r=>({line:r.line,uptime_s:r.v[0],phase:r.v[2]}));
    const motionGaps=gaps.filter(g=>g.drivePermit.some(v=>v===1)||g.phase.some(v=>v>=1&&v<=5));
    const counters=Object.fromEntries(Object.entries({fault:22,late:45,overrun:57,UARTerror:59,DMAskipped:70,CANrejected:28}).map(([k,col])=>[k,Math.max(...session.map(r=>r.v[col]))]));
    const settingsErrors=active.filter(r=>r.v[19]!==1200||r.v[20]!==1200||r.v[87]!==6||r.v[104]!==0||r.v[93]!==cfg.schema).map(r=>r.line);
    const primary=metric(motion);
    const motionComplete=JSON.stringify(changes.map(r=>r.phase))==='[0,1,2,3,4,5,6]'&&counters.fault===0&&Math.max(...session.map(r=>r.v[46]))===20000;
    const recordingComplete=motionComplete&&active.length===500&&motionGaps.length===0&&primary.N>=399&&primary.N<=401&&
      primary.elapsed_s[1]-primary.elapsed_s[0]>=15.90&&settingsErrors.length===0&&Object.values(counters).every(x=>x===0);
    const summaryRows=session.filter(r=>r.v[0]>=40&&r.v[2]===6&&r.v[22]===0);
    const summaryValues=[...new Set(summaryRows.map(r=>JSON.stringify(r.v.slice(53,55))))].map(s=>JSON.parse(s));
    const summaryAvailable=summaryValues.length===1&&summaryValues[0].every(x=>x>=0);
    const summary=summaryAvailable?{firstUptime_s:summaryRows[0].v[0],trackingRMSE_mm:summaryValues[0][0],syncRMS_mm:summaryValues[0][1]}:null;
    const summaryDifferences=summary?{tracking_mm:summary.trackingRMSE_mm-primary.trackingRMSE_mm,sync_mm:summary.syncRMS_mm-primary.syncRMS_mm}:null;
    const summaryMatches=recordingComplete&&summaryAvailable&&Object.values(summaryDifferences).every(x=>Math.abs(x)<=.00000051);
    const instantaneousErrors=motion.map(r=>[r.v[53]-1000*((r.v[5]+r.v[6])/2-r.v[3]),r.v[54]-1000*(r.v[5]-r.v[6])]);
    const instantMax=[0,1].map(ch=>Math.max(...instantaneousErrors.map(v=>Math.abs(v[ch]))));
    assert(instantMax.every(x=>x<=.00101));
    const exportRows=session.filter(r=>r.v[88]===cfg.eventMagic),chunkCount=method==='BLNN'?5:6,trigger=method==='BLNN'?5000:18000;
    const chunks=new Map(),duplicateConflicts=[];let metadataErrors=0;
    for(const r of exportRows) {
      const i=r.v[90],c=r.v[91];
      if(r.v[2]!==6||r.v[22]!==0||r.v[106]!==0||r.v[92]!==128||r.v[93]!==trigger||!Number.isInteger(i)||i<0||i>=128||!Number.isInteger(c)||c<0||c>=chunkCount){metadataErrors++;continue;}
      const key=i+':'+c,value=r.v.slice(96,104);
      if(chunks.has(key)&&JSON.stringify(chunks.get(key))!==JSON.stringify(value))duplicateConflicts.push(key);
      chunks.set(key,value);
    }
    const missing=[];let completeEventRecords=0;
    for(let i=0;i<128;i++) {
      let complete=true;
      for(let c=0;c<chunkCount;c++)if(!chunks.has(i+':'+c)){missing.push(i+':'+c);complete=false;}
      if(complete)completeEventRecords++;
    }
    const status4=exportRows.find(r=>r.v[89]===4),tail=status4?session.at(-1).v[0]-status4.v[0]:null;
    assert.equal(sha(file),hash);
    results.push({method,attempt:+parts[2],filenamePair:+parts[1],source:file,sourceSHA256:hash,rawUnchanged:true,totalRows:rows.length,
      allSessionSegments:segments.map(s=>({rows:s.length,firstLine:s[0].line,lastLine:s.at(-1).line,methodID:s[0].v[21],build:s[0].v[63],uptime_s:[s[0].v[0],s.at(-1).v[0]],containsActive:s.some(r=>r.v[106]===1)})),
      excludedPrefixRows:excluded.map(r=>({line:r.line,uptime_s:r.v[0],sequence:r.v[1],phase:r.v[2],methodID:r.v[21],build:r.v[63]})),
      prefixExcludedByIdentityOrClockNotOutcome:true,wholeCSVPristineSingleSession:segments.length===1,
      currentRunCompleted:motionComplete,completeCSVPrimaryWindow:recordingComplete,activeSamples:active.length,primarySamples:motion.length,counters,
      allSequenceGaps:gaps,motionSequenceGaps:motionGaps,settingsErrors,primaryMetrics:primary,
      primaryMetricsFromIncompleteWindowAreNotQualified:!recordingComplete,
      phaseMetrics:[2,3,4,5].map(phase=>({phase,...metric(motion.filter(r=>r.v[2]===phase))})),
      onboardSummary:summary,onboardSummaryStable:summaryAvailable,summaryMinusObservedCSV_mm:summaryDifferences,
      summaryAgreesWithCompleteCSV:summaryMatches,summaryComparisonTolerance_mm:.00000051,
      noImputationOrSummarySubstitution:!recordingComplete,
      instantaneousWaveMaxDifference_mm:instantMax,
      environment:{motionBatteryMean_V:mean(motion.map(r=>r.v[27])),motionBatteryRange_V:range(motion.map(r=>r.v[27])),temperatureMax_C:[29,30].map(c=>Math.max(...motion.map(r=>r.v[c]))),rpmPeak:[82,83].map(c=>Math.max(...session.map(r=>r.v[c])))},
      timing:{activePeriodRange_us:range(active.map(r=>r.v[43])),corePeak_us:Math.max(...session.map(r=>r.v[42])),bodyPeak_us:Math.max(...session.map(r=>r.v[60])),observedFiniteCoverageNotWCET:true},
      event:{completeRecords:completeEventRecords,missingChunks:missing,duplicateConflicts,metadataErrors,status4Seen:Boolean(status4),tail_s:tail,
        complete:missing.length===0&&duplicateConflicts.length===0&&metadataErrors===0&&Boolean(status4)&&tail>=10,notMatchedMechanismWindows:true}});
  }
}
const attempts=[...new Set(results.map(r=>r.attempt))].sort((a,b)=>a-b);
const comparison=attempts.map(attempt=>{
  const b=results.find(r=>r.method==='BLNN'&&r.attempt===attempt),s=results.find(r=>r.method==='S3R2'&&r.attempt===attempt);
  const valid=Boolean(b&&s&&b.completeCSVPrimaryWindow&&s.completeCSVPrimaryWindow);
  const differences=valid?Object.fromEntries(['trackingRMSE_mm','syncRMS_mm','maxTracking_mm','maxSync_mm'].map(k=>[k,{absolute_mm:s.primaryMetrics[k]-b.primaryMetrics[k],percent:100*(s.primaryMetrics[k]/b.primaryMetrics[k]-1)}])):null;
  const board=b?.onboardSummary&&s?.onboardSummary?Object.fromEntries(['trackingRMSE_mm','syncRMS_mm'].map(k=>[k,{absolute_mm:s.onboardSummary[k]-b.onboardSummary[k],percent:100*(s.onboardSummary[k]/b.onboardSummary[k]-1)}])):null;
  return {attempt,matchingIsByUserFilenameNotPreregisteredRandomizedBlock:true,completePairedCSV:valid,S3R2_minus_BLNN:differences,
    secondaryOnboardSummaryComparison:board,onboardSummaryDoesNotReplaceIncompleteCSV:!valid,
    reason:valid?'Complete same-window CSV comparison; retain prefix disclosure and stopped-only gaps.':'S3R2 attempt01 has one missing active return frame. Do not fill it or silently replace primary metrics with board summary.'};
});
// Deterministic framing vulnerability, not proof of actual raw-wire cause.
// Float0 followed by1022 creates an embedded standard JustFloat delimiter.
const fixture=Buffer.alloc(8);fixture.writeFloatLE(0,0);fixture.writeFloatLE(1022,4);
const delimiter=Buffer.from([0,0,0x80,0x7f]);assert.equal(fixture.indexOf(delimiter),3);
const stop1022=results.map(r=>({method:r.method,attempt:r.attempt,gaps:r.allSequenceGaps.filter(g=>g.sequence[0]===1021&&g.sequence[1]===1023)}));
const output={results,comparison,filesAnalyzed:results.length,allOutcomesRetained:true,rawUnchanged:true,
  primaryFormula:'RMS over native40ms phase2..5/I106=1,using unchanged six-decimal metre I3/I5/I6 fields',
  noInterpolation:true,noMissingFrameReconstruction:true,noControllerChanges:true,noAutomaticExtraCapture:true,
  transportAudit:{stoppedSequence1022AbsentInAllFiles:stop1022.every(x=>x.gaps.length===1),stoppedSequenceGaps:stop1022,
    adjacentFloat0And1022BytesHex:fixture.toString('hex'),embeddedTailOffset:3,
    sourcePattern:'At phase6 I68 mask is0 and I69 DMA-completed can reach1022; this adjacent-float pattern is structurally delimiter-vulnerable.',
    actualWireBytesCaptured:false,actualLossCauseIndependentlyProven:false,
    interpretation:'Same stopped-frame sequence loss is consistent with a JustFloat payload delimiter collision, not independently confirmed wire loss. Do not attribute active missingsequence500 to this fixture.'},
  validPairedCSVComparisons:comparison.filter(p=>p.completePairedCSV).length,
  repeatedCausalSuperiorityProven:false,trackingTaskTolerance_mm:null,
  conclusion:'All six identified motion runs completed with fault0. Completeattempt02 andattempt03 filename-matched pairs both show lower S3R2 syncRMS,higher trackingRMSE ANDhighermaxSync. Attempt01S3R2CSV lacks an active frame; its board summary remains secondary descriptive evidence,not a repaired primary trace. Five complete-windowCSV summaries agree with40s displays. Attempt03 file save order isS3R2 thenBLNN,but actual run order isnot independently established byboard-uptime CSVs or file modification times. No randomized/statistical/causal superiority,all-phase superiority or acceptable-tracking claim.',
  protocolSHA256:sha(protocolFile),analysisCodeSHA256:sha(fileURLToPath(import.meta.url))};
fs.writeFileSync(path.join(here,'all_attempts_analysis_final.json'),JSON.stringify(output,null,2),{flag:'wx'});
console.log(JSON.stringify({filesAnalyzed:results.length,results:results.map(r=>({method:r.method,attempt:r.attempt,completed:r.currentRunCompleted,completeCSV:r.completeCSVPrimaryWindow,
  prefix:r.excludedPrefixRows,metrics:r.primaryMetrics,onboardSummary:r.onboardSummary,summaryAgrees:r.summaryAgreesWithCompleteCSV,
  motionGaps:r.motionSequenceGaps,event:r.event,counters:r.counters,timing:r.timing})),comparison,transportAudit:output.transportAudit,conclusion:output.conclusion},null,2));
