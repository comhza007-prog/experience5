// Existing-data audit only. No firmware changes, interpolation or new capture.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
const here=path.dirname(fileURLToPath(import.meta.url)),root=path.resolve(here,'../..');
const prior=JSON.parse(fs.readFileSync(path.join(root,'06_仿真与复现/error_summary_40s_analysis_round53_20261014/all_attempts_analysis.json'),'utf8'));
const sha=f=>crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const hist=x=>Object.fromEntries([...new Set(x)].sort((a,b)=>a-b).map(k=>[k,x.filter(v=>v===k).length]));
const range=x=>[Math.min(...x),Math.max(...x)];
const err=r=>[1000*((r[5]+r[6])/2-r[3]),1000*(r[5]-r[6])];
const flags={amplitude:1,projected:2,sector:4,speed:8,withdrawn:16,contracted:32};
const core=path.join(root,'05_实验代码/误差汇总40s_A_BLNN_S3R2_20261014/01_R2/eassy_E5R2_A_S3R2_HW6/Task');
const sourceFiles=['blnn_core.c','experiment5_ca_actuator.h','motor_task.c','diagnostic_config.h','experiment5_formal_config.h'].map(f=>path.join(core,f));
const sourceHashes=Object.fromEntries(sourceFiles.map(f=>[f,sha(f)]));
const results=prior.results.map(p=>{
  assert.equal(sha(p.source),p.sourceSHA256);
  const raw=fs.readFileSync(p.source,'utf8').replace(/^\uFEFF/,'').trim().split(/\r?\n/).slice(1).map(l=>l.split(',').map(Number));
  const seg=p.allSessionSegments.find(s=>s.containsActive);
  assert(seg);const rows=raw.slice(seg.firstLine-2,seg.lastLine-1),active=rows.filter(r=>r[106]===1);
  assert.equal(active.length,p.activeSamples);
  const phaseStats=[1,2,3,4,5].map(phase=>{
    const rr=active.filter(r=>r[2]===phase),r2=p.method==='S3R2';
    return {phase,N:rr.length,maskHistogram:r2?hist(rr.map(r=>r[68])):null,
      maskFlagSampleCounts:r2?Object.fromEntries(Object.entries(flags).map(([k,b])=>[k,rr.filter(r=>(r[68]&b)!==0).length])):null,
      reasonHistogram:r2?hist(rr.map(r=>r[88])):null,
      actualLearning:r2?[17,18].map(c=>({range:range(rr.map(r=>r[c])),zeroSamples:rr.filter(r=>r[c]===0).length,positiveSamples:rr.filter(r=>r[c]>0).length})):null,
      repairModeHistograms:r2?[25,26].map(c=>hist(rr.map(r=>r[c]))):null,
      speedGuardSampleCount:rr.filter(r=>r[86]!==0).length,
      sectorReducedSamples:[49,50].map(c=>rr.filter(r=>r[c]<.999999).length),
      maxAttemptedCommand_counts:[13,14].map(c=>Math.max(...rr.map(r=>Math.abs(r[c])))),
      maxAdmittedNNIncrement_counts:r2?[66,67].map(c=>Math.max(...rr.map(r=>Math.abs(r[c])))):null};
  });
  const magic=p.method==='S3R2'?4424:4422,nchunks=p.method==='S3R2'?6:5,map=new Map();
  rows.filter(r=>r[88]===magic).forEach(r=>{assert.equal(r[92],128);map.set(r[90]+':'+r[91],r.slice(96,104));});
  const event=Array.from({length:128},(_,i)=>Array.from({length:nchunks},(_,c)=>{assert(map.has(i+':'+c));return map.get(i+':'+c);}).flat());
  let eventDetails={elapsed_ms:range(event.map(e=>e[0])),phaseHistogram:hist(event.map(e=>e[1])),notMatchedToOtherMethodEventTime:true};
  if(p.method==='S3R2'){
    const accepted=[];
    event.forEach((e,i)=>[0,1].forEach(ch=>{if(e[42+ch]===1){
      const before=e[44+ch],after=e[46+ch],tol=1.1e-6;
      const ok=Math.abs(after)<=Math.abs(before)+tol&&before*after>=-tol;
      accepted.push({index:i,axis:ch,before,after,passesRoundedLocalNonEnlargement:ok});
    }}));
    eventDetails={...eventDetails,maskHistogram:hist(event.map(e=>e[22])),reasonHistogram:hist(event.map(e=>e[32])),
      repairModeHistograms:[42,43].map(c=>hist(event.map(e=>e[c]))),actualLearningRange:[40,41].map(c=>range(event.map(e=>e[c]))),
      acceptedLocalRepairChecks:accepted,localCheckNotClosedLoopCausalProof:true};
  }
  const motion=active.filter(r=>r[2]>=2&&r[2]<=5),extrema=[0,1].map(c=>{
    const r=motion.reduce((a,b)=>Math.abs(err(b)[c])>Math.abs(err(a)[c])?b:a);
    return {metric:c?'sync':'tracking',absolute_mm:Math.abs(err(r)[c]),signed_mm:err(r)[c],phase:r[2],elapsed_s:r[79],uptime_s:r[0],sequence:r[1],rawRPM:r.slice(80,82),speedGuardMask:r[86],caMask:r[68]};
  });
  const counters=Object.fromEntries(Object.entries({growth:74,projectionY:75,projectionAlpha:76,withdrawal:77,contraction:105,hardSaturationL:61,hardSaturationR:62,speedGuardL:84,speedGuardR:85}).map(([k,c])=>[k,Math.max(...rows.map(r=>r[c]))]));
  const mechanism=p.method==='S3R2'?{
    rateOnlySamples:motion.filter(r=>r[88]===1).length,
    rateOnlyPositiveLearningSamples:[17,18].map(c=>motion.filter(r=>r[88]===1&&r[c]>0).length),
    rateOnlyFractionalLearningSamples:[17,18].map(c=>motion.filter(r=>r[88]===1&&r[c]>0&&r[c]<1).length),
    liveRepairAcceptedSamples:[25,26].map(c=>motion.filter(r=>r[c]===1).length),
    retentionObservations:motion.filter(r=>r[25]===3).map(r=>({phase:r[2],elapsed_s:r[79],tracking_mm:err(r)[0],sync_mm:err(r)[1],rawRPM:r.slice(80,82),learning:r[17],mask:r[68]})),
    sampledAmplitudeMaskSeen:motion.some(r=>(r[68]&1)!==0),
    sampledHardClipReasonSeen:motion.some(r=>(r[88]&2)!==0)
  }:null;
  assert.equal(sha(p.source),p.sourceSHA256);
  return {method:p.method,attempt:p.attempt,source:p.source,sourceSHA256:p.sourceSHA256,primaryWindowComplete:p.completeCSVPrimaryWindow,
    phaseStats,event:eventDetails,counters,mechanism,finalNodes:[35,36].map(c=>Math.max(...rows.map(r=>r[c]))),extrema,
    sampleCountsAre40msSnapshotsNotCountsOfAll1msUpdates:true,rawUnchanged:true};
});
const ordinary=prior.results.find(r=>r.method==='BLNN'&&r.attempt===2),r2=prior.results.find(r=>r.method==='S3R2'&&r.attempt===2);
assert(ordinary.completeCSVPrimaryWindow&&r2.completeCSVPrimaryWindow);
const decomposition=[2,3,4,5].map(phase=>{
  const b=ordinary.phaseMetrics.find(p=>p.phase===phase),s=r2.phaseMetrics.find(p=>p.phase===phase);assert.equal(b.N,s.N);
  const delta=Object.fromEntries(['trackingRMSE_mm','syncRMS_mm'].map(k=>[k,{BLNN:b[k],S3R2:s[k],changePercent:100*(s[k]/b[k]-1),contributionToTotalMSEChange_mm2:b.N*(s[k]**2-b[k]**2)/400}]));
  return {phase,N:b.N,...delta};
});
for(const k of ['trackingRMSE_mm','syncRMS_mm']){
  const summed=decomposition.reduce((sum,p)=>sum+p[k].contributionToTotalMSEChange_mm2,0);
  assert(Math.abs(summed-(r2.primaryMetrics[k]**2-ordinary.primaryMetrics[k]**2))<1e-14);
}
const netSyncMSE=r2.primaryMetrics.syncRMS_mm**2-ordinary.primaryMetrics.syncRMS_mm**2;
const returnShare=100*decomposition.find(p=>p.phase===4).syncRMS_mm.contributionToTotalMSEChange_mm2/netSyncMSE;
for(const [f,h] of Object.entries(sourceHashes))assert.equal(sha(f),h);
const output={results,attempt02PhaseDecomposition:decomposition,returnShareOfNetSyncMSEDecrease_pct:returnShare,
  units:'errors:mm; squared contributions:mm^2; command counts NOT calibrated amperes',
  limitations:['Only one complete filename-matched pair, fixed BLNN thenS3R2 order; not randomized or replicated causal validation.',
    'Attempt01S3R2 missing active sequence500; retain all recorded activity descriptively, never fill or substitute its incomplete primary window.',
    'Live flag/mode counts are40ms snapshots, not duty fractions/counts of all1ms control updates.',
    'BLNN andS3R2 event snapshots areat5s and18s respectively; no matched-event comparison.',
    'CompositeCA differs in output envelope,sector,gating,allocation,learning andrepair; mechanism activation alone does not isolate cause.',
    'No task-derived tracking tolerance provided; cannot assert acceptable cost.',
    'Common stopped1022framing vulnerability already documented; active500loss cause remains unknown.'],
  sourceHashes,noFirmwareChanges:true,noNewCapture:true,noHardwareActions:true,
  noControllerTuning:true,noImputation:true,analysisSHA256:sha(fileURLToPath(import.meta.url))};
fs.writeFileSync(path.join(here,'mechanism_audit_complete.json'),JSON.stringify(output,null,2),{flag:'wx'});
console.log(JSON.stringify({results:results.map(r=>({method:r.method,attempt:r.attempt,complete:r.primaryWindowComplete,mechanism:r.mechanism,
  eventModes:r.event.repairModeHistograms,eventAcceptedRepairs:r.event.acceptedLocalRepairChecks?.length,
  eventRepairChecksAllPass:r.event.acceptedLocalRepairChecks?.every(c=>c.passesRoundedLocalNonEnlargement)})),
  decomposition,returnShare},null,2));
