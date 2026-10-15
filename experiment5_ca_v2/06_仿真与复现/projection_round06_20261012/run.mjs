import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const dir=path.dirname(fileURLToPath(import.meta.url)),root=path.resolve(dir,'../../..');
const core=path.join(dir,'core'),bin=path.join(dir,'bin'),out=path.join(dir,process.argv[2]||'data');
assert(!fs.existsSync(out),'Do not overwrite earlier attempt');fs.mkdirSync(out);fs.mkdirSync(bin,{recursive:true});
const prior=path.resolve(dir,'../sector_round02_20261012'),eventDir=path.resolve(dir,'../event_logger_round05_20261012');
const recorded=path.join(eventDir,'record_analysis_aafbaf477c33.json');
const original=path.join(root,'实验5整理_20261011/05_实验代码/正式对照_HW6_B/eassy_E5F_B_CA_BLNN_HW6/Task');
const variants=[{name:'BLNN',method:11,projection:0,learning:0},
 {name:'S0_old',method:12,projection:0,learning:0},
 {name:'S1_learning',method:12,projection:0,learning:1},
 {name:'S2_projection',method:12,projection:1,learning:0},
 {name:'S3_both',method:12,projection:1,learning:1}];
const protocol={date:'2026-10-12',hostOnly:true,registeredBeforeDynamicSweep:true,
 recordedRegressionAlreadyInspected:true,variants,sectorFraction:.25,slew_counts_per_ms:2,nnCap_counts:300,
 newProjection:'Old 36 ray candidates retained; up to 20 strictly balanced [z,-z] candidates, only in existing contraction exception when normal slew is infeasible. Select only strictly closer to current target under original magnitude/history sign/envelope/sector bounds. No assertion of global optimality.',
 learning:'Existing round01 rule, partial target-aligned learning for proven pure-rate states ONLY; all contraction/withdrawal/mixed states freeze. Weight leakage unchanged.',
 requiredChecks:['Float/double legacy exact 90000-step equivalence','Float/double same-state no-worse-distance stress','Full archived adapter and actual-core invariants','127 complete recorded snapshots with missing row excluded','Five-method 36-case assumed-plant factorial, all fault outcomes retained, exact rerun'],
 model:'UNCHANGED UNCALIBRATED round02 assumed coupled plant. Feedback identification failed. Dynamic comparison is a sensitivity diagnostic, NOT validation of physical superiority.',
 physicalCase:'One recorded diagnostic; same-state inputs and rounded sigma. Not independent holdout. No closed-loop counterfactual claim.',
 reportGenerated:false,hardwareReleased:false,newFirmwareGenerated:false};
fs.writeFileSync(path.join(out,'protocol.json'),JSON.stringify(protocol,null,2));
const hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const archivedManifest=path.join(root,'实验5整理_20261011/SHA256SUMS.txt');
const preserved={};
for(const line of fs.readFileSync(archivedManifest,'utf8').trim().split(/\r?\n/)){
 const m=line.match(/^([0-9a-f]{64})  (.*)$/);assert(m);const p=path.join(root,'实验5整理_20261011',m[2]);assert.equal(hash(p),m[1]);preserved[p]=m[1];
}
const data=JSON.parse(fs.readFileSync(recorded,'utf8'));
assert.equal(hash(data.source),data.sourceSHA256);
for(const p of [recorded,data.source,path.join(eventDir,'verification.json'),
 ...fs.readdirSync(path.join(prior,'core')).map(f=>path.join(prior,'core',f)),
 ...['O25.json','N25.json','BLNN.json','results.json'].map(f=>path.join(prior,'data_attempt02',f))])preserved[p]=hash(p);
fs.writeFileSync(path.join(out,'preservation.json'),JSON.stringify(preserved,null,2));
const sourcePaths=[...fs.readdirSync(core).map(f=>path.join(core,f)),...fs.readdirSync(dir).filter(f=>/\.(c|h|mjs)$/.test(f)).map(f=>path.join(dir,f))];
fs.writeFileSync(path.join(out,'sources.json'),JSON.stringify(Object.fromEntries(sourcePaths.map(p=>[p,hash(p)])),null,2));
const env={...process.env,PATH:'D:/MinGW/mingw64/bin;'+process.env.PATH},gcc='D:/MinGW/mingw64/bin/gcc.exe';
let compilations=0;const testLog=[];
function call(exe,args=[],input){const r=spawnSync(exe,args,{cwd:dir,env,input,encoding:'utf8',maxBuffer:36e6});if(r.status!==0){fs.writeFileSync(path.join(out,'failure.log'),(r.stderr||'')+'\n'+(r.stdout||''));throw Error(r.stderr||r.stdout||r.error?.message||'native failure');}return r.stdout;}
function compile(args){call(gcc,['-std=c99','-O2','-Wall','-Wextra','-Werror','-Wno-unused-function',...args]);compilations++;}
function flags(v,precision='float'){return [`-DDIAG_BALANCED_CONTRACTION=${v.projection}`,`-DDIAG_NEW_LEARNING=${v.learning}`,`-DTEST_METHOD=${v.method}`,'-DDIAG_SECTOR_FRACTION=.25','-DDIAG_SLEW_COUNTS=2',...(precision==='double'?['-DE5_USE_DOUBLE']:[])];}
function runTest(name,args,exeArgs=[]){const exe=path.join(bin,name+'.exe');compile([...args,'-o',exe]);const output=call(exe,exeArgs);testLog.push({name,output:output.trim()});return output;}
const recordedInput=data.event.records.filter(r=>r.complete).map(r=>[r.index,...r.values].join(' ')).join('\n')+'\n';
const recordedChecks=[];
for(const precision of ['float','double']){
 const pd=precision==='double'?['-DE5_USE_DOUBLE']:[],aliases=['-De5_reset=e5_reset_legacy','-De5_step=e5_step_legacy'];
 const obj=path.join(bin,'old_'+precision+'.o'),wrap=path.join(bin,'wrapper_'+precision+'.o');
 compile([...pd,...aliases,'-I',original,'-c',path.join(original,'blnn_core.c'),'-o',obj]);
 compile([...pd,...aliases,'-I',original,'-c',path.join(dir,'legacy_wrapper.c'),'-o',wrap]);
 runTest('equivalence_'+precision,[...flags(variants[1],precision),'-I',core,path.join(dir,'test_equivalence.c'),path.join(core,'blnn_core.c'),obj,wrap,'-lm']);
 console.log(precision+': full old-core exact equivalence PASS');
 for(const v of variants.filter(v=>v.method===12)){
  runTest('adapter_'+v.name+'_'+precision,[...flags(v,precision),'-I',core,path.join(dir,'test_adapter.c'),path.join(core,'blnn_core.c'),'-lm']);
  runTest('reasons_'+v.name+'_'+precision,[...flags(v,precision),'-I',core,path.join(dir,'test_reasons.c'),'-lm']);
  console.log(v.name+' '+precision+': 65536 zero-NN, 200000 allocations, 40000 actual-core gate/AW checks PASS');
 }
 for(const projection of [0,1]){
  const v=variants.find(v=>v.projection===projection&&v.method===12&&v.learning===0);
  runTest('projection_'+projection+'_'+precision,[...flags(v,precision),'-I',core,path.join(dir,'test_projection.c')]);
  const exe=path.join(bin,'recorded_'+projection+'_'+precision+'.exe');
  compile([...flags(v,precision),'-I',core,path.join(dir,'replay_allocator.c'),'-o',exe]);
  const output=call(exe,[],recordedInput).trim().split(/\r?\n/).map(s=>JSON.parse(s));assert.equal(output.length,127);
  recordedChecks.push({precision,projection,output});
 }
 const old=recordedChecks.find(v=>v.precision===precision&&v.projection===0).output;
 const newer=recordedChecks.find(v=>v.precision===precision&&v.projection===1).output;
 const records=data.event.records.filter(r=>r.complete);
 for(let i=0;i<127;i++){
  const row=records[i].values;assert.equal(old[i].mask,row[22]);assert.deepEqual(old[i].delta,row.slice(18,20));
  assert(newer[i].distanceSquared<=old[i].distanceSquared);
  if(newer[i].delta[0]!==old[i].delta[0]||newer[i].delta[1]!==old[i].delta[1])assert(newer[i].normalFeasibleCount===0);
 }
 const event=newer.find(v=>v.index===113);assert.deepEqual(event.delta,[23,-23]);assert.equal(event.distanceSquared,13);
 console.log(precision+': recorded 127 same-state snapshots PASS; event 113 retains 23,-23 instead of 2,-2');
}
fs.writeFileSync(path.join(out,'host_tests.json'),JSON.stringify(testLog,null,2));
fs.writeFileSync(path.join(out,'recorded_replay.json'),JSON.stringify(recordedChecks,null,2));
const runs=[];
for(const v of variants){
 const exe=path.join(bin,'plant_'+v.name+'.exe');compile([...flags(v),'-I',core,path.join(dir,'test_plant.c'),path.join(core,'blnn_core.c'),'-lm','-o',exe]);
 const first=call(exe).trim().split(/\r?\n/).map(s=>JSON.parse(s));
 const second=call(exe).trim().split(/\r?\n/).map(s=>JSON.parse(s));assert.equal(JSON.stringify(first),JSON.stringify(second));
 const priorName={BLNN:'BLNN',S0_old:'O25',S1_learning:'N25'}[v.name];
 if(priorName)assert.equal(JSON.stringify(first),JSON.stringify(JSON.parse(fs.readFileSync(path.join(prior,'data_attempt02',priorName+'.json'),'utf8'))));
 fs.writeFileSync(path.join(out,v.name+'.json'),JSON.stringify(first));
 for(const r of first.filter(r=>r.type==='result')){
  const start=first.find(a=>a.type==='start'&&a.case===r.case),m=first.find(a=>a.type==='mechanism'&&a.case===r.case);
  const trace=first.filter(a=>a.type==='trace'&&a.case===r.case);
  assert.equal(r.complete,r.stop_ms===20000&&r.fault===0);
  if(r.complete)assert.equal(trace.filter(t=>t.phase>=2&&t.phase<=5).length,400);
  runs.push({...start,...r,variant:v.name,mechanism:m,trackingRMSE_mm:r.complete?r.partialTrackingRMSE_mm:null,syncRMS_mm:r.complete?r.partialSyncRMS_mm:null});
 }
 console.log(v.name+': '+runs.filter(r=>r.variant===v.name&&r.complete).length+'/36 assumed-model complete; exact rerun PASS');
}
assert.equal(runs.length,180);
const paired=Array.from({length:36},(_,i)=>i+1).filter(c=>runs.filter(r=>r.case===c).every(r=>r.complete));
const mean=values=>values.length?values.reduce((s,v)=>s+v,0)/values.length:null;
const effects=['A','B'].map(condition=>{
 const ids=paired.filter(c=>condition==='A'?c<=18:c>18);
 return {condition,sharedCompleteCases:ids.length,variants:variants.map(v=>{
  const rs=runs.filter(r=>r.variant===v.name&&ids.includes(r.case));
  return {name:v.name,trackingRMSE_mm:mean(rs.map(r=>r.trackingRMSE_mm)),syncRMS_mm:mean(rs.map(r=>r.syncRMS_mm)),
    withdrawals:mean(rs.map(r=>r.withdrawals)),contractions:mean(rs.map(r=>r.contractions)),learningMean:mean(rs.map(r=>r.learningMean))};
 })};
});
const summaries=variants.map(v=>({name:v.name,complete:runs.filter(r=>r.variant===v.name&&r.complete).length,
 faults:runs.filter(r=>r.variant===v.name&&!r.complete).map(r=>({case:r.case,fault:r.fault,stop_ms:r.stop_ms}))}));
for(const [p,h]of Object.entries(preserved))assert.equal(hash(p),h,'Preserved material changed');
const result={date:'2026-10-12',status:'OFFLINE_ONLY',reportGenerated:false,newFirmwareGenerated:false,hardwareReleased:false,
 compilations,hostInvariantsPassed:true,legacyExactlyReproduced:true,all180DynamicRerunsIdentical:true,preservedFiles:Object.keys(preserved).length,
 normalSlewCountsPerMs:2,sectorFraction:.25,nnCapCounts:300,maxExceptionalCandidateCount:56,
 recordedSameStateReplay:{frames:127,missingRecordExcluded:80,precisions:['float','double'],oldEventDelta:[2,-2],newEventDelta:[23,-23],oldDistanceSquared:1105,newDistanceSquared:13,
  closesPhysicalPerformanceEvidence:false},summaries,effects,runs,
 caveats:['Uncalibrated assumed plant only: dynamic gains/losses do not validate real motor performance.',
 'Candidate depends on observed event; recorded replay is regression, not independent validation.',
 '56-candidate exception search has no board timing measurement and is not released firmware.',
 'No same-state target-distance degradation is not a closed-loop tracking/stability theorem.',
 'Exceptional contraction intentionally can exceed normal 2-count slew, as in the archived policy.']};
fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(result,null,2));
console.log(JSON.stringify({status:result.status,compilations,recordedSameStateReplay:result.recordedSameStateReplay,summaries,effects,preservedFiles:result.preservedFiles},null,2));
