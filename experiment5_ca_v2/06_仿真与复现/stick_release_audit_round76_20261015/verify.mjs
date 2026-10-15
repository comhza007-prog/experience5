import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
const dir=path.dirname(fileURLToPath(import.meta.url)),root=path.resolve(dir,'../..');
const sha=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const a=JSON.parse(fs.readFileSync(path.join(dir,'audit_results.json'),'utf8'));
assert.equal(sha(path.join(dir,'protocol.json')),a.protocolSHA256);
let windows=0,eventClusters=0;const counts=[];
for(const source of a.sources){
 assert.equal(sha(source.raw),source.rawSHA256);assert.equal(sha(source.decoded),source.decodedSHA256);
 const d=JSON.parse(fs.readFileSync(source.decoded,'utf8'));
 const expectedRecord=a.records.find(r=>r.record===source.record);let total=0;
 for(const [phase,first,anchor] of [[2,0,99],[4,4000,149]]){
  const fast=d.fast.slice(first,first+4000),enc=[d.slow[anchor].encoder,...fast.map(r=>r.encoder)];
  const expectedPhase=expectedRecord.phases.find(r=>r.phase===phase);
  for(const axis of [0,1]){
   for(const width of [20,50]){
    let lowCount=0,loadedCount=0,nonoverlap=0,loadedNonoverlap=0;
    for(let end=width;end<=4000;end++){
     const vals=enc.slice(end-width,end+1).map(v=>v[axis]);
     const low=Math.max(...vals)-Math.min(...vals)<=1;
     const mean=fast.slice(end-width,end).reduce((s,r)=>s+Math.abs(r.command_counts[axis]),0)/width;
     const loaded=low&&mean>=50;
     lowCount+=low;loadedCount+=loaded;
     if(end%width===0){nonoverlap+=low;loadedNonoverlap+=loaded;}
     windows++;
    }
    const e=expectedPhase.windowAxisDiagnostics.find(r=>r.axis===axis&&r.windowSteps===width);
    assert.equal(lowCount,e.lowMotionOverlapWindows);assert.equal(loadedCount,e.loadedLowMotionOverlapWindows);
    assert.equal(nonoverlap,e.lowMotionNonoverlapWindows);assert.equal(loadedNonoverlap,e.loadedLowMotionNonoverlapWindows);
   }
   const candidates=[];
   for(let end=50;end<=3980;end++){
    const prior=enc.slice(end-50,end+1).map(v=>v[axis]);
    if(Math.max(...prior)-Math.min(...prior)>1||Math.abs(enc[end+20][axis]-enc[end][axis])<5)continue;
    const u=fast.slice(end-50,end).map(r=>r.command_counts[axis]);
    const mean=u.reduce((s,v)=>s+Math.abs(v),0)/50;
    const sign=Math.max(u.filter(v=>v>0).length,u.filter(v=>v<0).length)/50;
    candidates.push({end,loaded:mean>=50&&sign>=.8});
   }
   const clusters=[];for(const r of candidates){if(clusters.length&&r.end===clusters.at(-1).at(-1).end+1)clusters.at(-1).push(r);else clusters.push([r]);}
   const chosen=clusters.map(c=>c.at(-1)),e=expectedPhase.releaseEvents.find(r=>r.axis===axis);
   assert.equal(candidates.length,e.overlapReleaseCandidates);assert.equal(chosen.length,e.releaseClusters);
   assert.deepEqual(chosen.map(r=>r.end),e.events.map(r=>r.endpointStep));
   const loaded=chosen.filter(r=>r.loaded).length;assert.equal(loaded,e.loadedSignConsistentClusters);total+=loaded;
   eventClusters+=chosen.length;
  }
 }
 counts.push({record:source.record,loadedReleaseClusters:total});
}
const prep=JSON.parse(fs.readFileSync(path.join(root,'06_仿真与复现/q2_mechanical_recheck_round73_20261015/preparation.json'),'utf8'));
for(const r of prep.frozenModels)assert.equal(sha(r.path),r.SHA256);
const project=path.join(root,'05_实验代码/模型闭环_Q2_误差汇总40s_20261015/eassy_E5ID_Q2S_BLNN_HW6');
for(const [file,hash] of Object.entries(prep.currentSourceHashes))assert.equal(sha(path.join(project,file)),hash);
const verification={passed:true,independentWindowAxisChecks:windows,independentReleaseClusters:eventClusters,loadedReleaseCounts:counts,
 allRawDecodedModelAndSevenControlSourceHashesPreserved:true,modelsFitted:0,physicalFrictionIdentified:false,hardwareAction:false};
const decision={date:'2026-10-15',auditSHA256:sha(path.join(dir,'audit_results.json')),verification,
 encoderResolution_mm:.0012110374427720672,windowSteps:[20,50],loadedThreshold_counts:50,
 newQ250stepLowMotionSSEOverlap_pct:a.records.find(r=>r.record==='newQ2').phases.map(p=>({phase:p.phase,
   lowMotionNativeSamples:p.windowUnionNativeErrorDiagnostics.find(r=>r.windowSteps===50).anyAxisLowMotionNativeSamples,
   nativeSamplesWithFullWindow:p.windowUnionNativeErrorDiagnostics.find(r=>r.windowSteps===50).validNativeSamples,
   syncPredictionSSEOverlap_percent:p.windowUnionNativeErrorDiagnostics.find(r=>r.windowSteps===50).syncPredictionSSEInAnyAxisLowMotion_percent})),
 interpretation:'Finite-resolution low-motion and subsequent displacement events exist inboth records. Counts are within-run descriptive clusters,not independent repetitions. Small contemporaneous SSEoverlap does NOT bound causal friction contribution: errors can persist after release. Neither intrinsic staticfriction nor backlash nor its predominance has been identified. Do not add friction-memory parameters just to matchRMS.',
 nextStep:'Offline feasibility/information design only for more closely synchronized queuedcommand,encoder andESC reportedcurrent capture during motion/release. Assess recorderRAM,precision,exceptions,transport andtasktiming before requesting any additional manual run. Aim at one targeted capture only if justified; not a batch or promise of closure. Preserve existingRPM observations and do not equate reportedcurrent with calibrated deliveredtorque.',
 modelClosureComplete:false,controllerChanged:false,newPhysicalCaptureApproved:false,additionalFrictionModelApproved:false};
fs.writeFileSync(path.join(dir,'verification.json'),JSON.stringify(verification,null,2)+'\n',{flag:'wx'});
fs.writeFileSync(path.join(dir,'decision.json'),JSON.stringify(decision,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({verification,overlap:decision.newQ250stepLowMotionSSEOverlap_pct},null,2));
