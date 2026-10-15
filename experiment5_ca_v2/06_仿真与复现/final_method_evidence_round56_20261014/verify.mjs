// Freeze/source and assumed-model evidence audit. Never edits MCU sources.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const dir=path.dirname(fileURLToPath(import.meta.url)),root=path.resolve(dir,'../..');
const old=path.join(root,'06_仿真与复现/learning_output_attribution_round35_20261014');
const r2=path.join(root,'05_实验代码/误差汇总40s_A_BLNN_S3R2_20261014/01_R2/eassy_E5R2_A_S3R2_HW6/Task');
const blnn=path.join(root,'05_实验代码/误差汇总40s_A_BLNN_S3R2_20261014/00_BLNN/eassy_E5F2_A_BLNN_HW6/Task');
const original=path.join(root,'05_实验代码/S3R2_静止跟踪保持_20261013/eassy_E5R2_A_S3R2_HW6/Task');
const out=path.join(dir,'checks02');assert(!fs.existsSync(out));fs.mkdirSync(out);
const sha=f=>crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const hashes=Object.fromEntries([r2,blnn].flatMap(d=>fs.readdirSync(d).filter(n=>/\.[ch]$/.test(n)).map(n=>path.join(d,n))).map(f=>[f,sha(f)]));
const controlFiles=['blnn_core.c','blnn_core.h','experiment5_ca_actuator.h','experiment5_hw_profile.h','experiment5_motion.h','experiment5_formal_actuator.h','diagnostic_config.h'];
for(const f of controlFiles)assert.equal(sha(path.join(r2,f)),sha(path.join(original,f)));
const harness=path.join(dir,'test_plant.c');
const variants=[{name:'BLNN',method:11,classification:1,repair:1,retention:1,task:blnn},
  {name:'CA_ALL_FREEZE',method:12,classification:0,repair:0,retention:0,task:r2},
  {name:'CA_CLASS',method:12,classification:1,repair:0,retention:0,task:r2},
  {name:'CA_CLASS_REPAIR',method:12,classification:1,repair:1,retention:0,task:r2},
  {name:'S3R2',method:12,classification:1,repair:1,retention:1,task:r2}];
const env={...process.env,PATH:'D:/MinGW/mingw64/bin;'+process.env.PATH};
function call(exe,args) {
  const p=spawnSync(exe,args,{env,encoding:'utf8',maxBuffer:40e6});
  assert.equal(p.status,0,`${exe}: ${p.stderr}\n${p.stdout}`);return p.stdout;
}
const mean=x=>x.reduce((s,v)=>s+v,0)/x.length;
const rms=x=>Math.sqrt(mean(x.map(v=>v*v)));
const records=[];
for(const precision of ['float','double'])for(const v of variants) {
  const executable=path.join(out,v.name+'_'+precision+'.exe');
  call('D:/MinGW/mingw64/bin/gcc.exe',['-std=c99','-O2','-Wall','-Wextra','-Werror','-Wno-unused-function',
    '-I',v.task,'-DTEST_METHOD='+v.method,'-DDIAG_NEW_LEARNING='+v.classification,
    '-DDIAG_BOUNDED_REPAIR='+v.repair,'-DDIAG_TRACKING_RETENTION='+v.retention,
    ...(precision==='double'?['-DE5_USE_DOUBLE']:[]),harness,path.join(v.task,'blnn_core.c'),path.join(dir,'modal_stub.c'),'-lm','-o',executable]);
  const data=call(executable,[]).trim().split(/\r?\n/).map(l=>JSON.parse(l));
  fs.writeFileSync(path.join(out,v.name+'_'+precision+'.json'),JSON.stringify(data),{flag:'wx'});
  const outcomes=data.filter(r=>r.type==='result');assert.equal(outcomes.length,36);
  assert.deepEqual(outcomes.map(r=>r.case),Array.from({length:36},(_,i)=>i+1));
  // Preserve the unmodified tester's native1ms diagnostics. Additionally
  // derive native40ms phase2..5 values from model traces, rounding model
  // positions/reference to1um. This is NOT evidence of an identified plant
  // or exact reproduction of MCU feedback/telemetry arithmetic.
  const sampled=outcomes.map(result=>{
    const rr=data.filter(r=>r.type==='trace'&&r.case===result.case&&r.phase>=2&&r.phase<=5);
    const q=x=>Math.sign(x)*Math.floor(Math.abs(x)*1000+.5)/1000; // mm ->1um ->mm
    const error=rr.map(r=>{const p=r.positions_mm.map(q);return [(p[0]+p[1])/2-q(r.ref_mm),p[0]-p[1]];});
    if(result.complete)assert.equal(rr.length,400);
    return {case:result.case,complete:result.complete,N:rr.length,
      trackingRMSE_mm:error.length?rms(error.map(e=>e[0])):null,
      syncRMS_mm:error.length?rms(error.map(e=>e[1])):null};
  });
  let historicalExact=null;
  if(precision==='float'&&['BLNN','S3R2','CA_CLASS','CA_CLASS_REPAIR'].includes(v.name)) {
    const reference=JSON.parse(fs.readFileSync(path.join(old,'checks02',v.name+'.json'),'utf8'));
    assert.deepEqual(data,reference,'Unchanged archived diagnostic drift: '+v.name);
    historicalExact=true;
  }
  records.push({...v,precision,outcomes,sampled,historicalExact,
    filename:path.join(out,v.name+'_'+precision+'.json')});
  console.log(JSON.stringify({precision,variant:v.name,completed:outcomes.filter(r=>r.complete).length,cases:36,historicalExact}));
}
const summaries=[];
for(const precision of ['float','double']) {
  const rr=records.filter(r=>r.precision===precision),b=rr.find(r=>r.name==='BLNN'),s=rr.find(r=>r.name==='S3R2');
  const ids=s.outcomes.filter((r,i)=>r.complete&&b.outcomes[i].complete).map(r=>r.case);
  for(const v of rr) {
    const failed=v.outcomes.filter(r=>ids.includes(r.case)&&!r.complete).map(r=>r.case);
    const pop=v.outcomes.filter(r=>ids.includes(r.case)),sampled=v.sampled.filter(r=>ids.includes(r.case));
    summaries.push({precision,variant:v.name,completedAll36:v.outcomes.filter(r=>r.complete).length,
      faultOutcomes:v.outcomes.filter(r=>!r.complete).map(r=>({case:r.case,fault:r.fault,stop_ms:r.stop_ms})),
      fixedComparisonPopulationCaseIDs:ids,failedInFixedPopulation:failed,
      primaryMeanUnavailableIfAnyFixedPopulationFailure:true,
      diagnostics1ms:failed.length?null:{tracking:mean(pop.map(r=>r.partialTrackingRMSE_mm)),sync:mean(pop.map(r=>r.partialSyncRMS_mm))},
      modelTrace40ms:failed.length?null:{tracking:mean(sampled.map(r=>r.trackingRMSE_mm)),sync:mean(sampled.map(r=>r.syncRMS_mm))},
      sameCaseModelTrace40msSyncWinsVsOrdinary:sampled.filter((r,i)=>r.syncRMS_mm<b.sampled.find(x=>x.case===r.case).syncRMS_mm).length});
  }
}
const contrasts=[];
for(const precision of ['float','double'])for(const [from,to] of [['BLNN','S3R2'],['CA_ALL_FREEZE','CA_CLASS'],['CA_CLASS','CA_CLASS_REPAIR'],['CA_CLASS_REPAIR','S3R2']]) {
  const a=summaries.find(r=>r.precision===precision&&r.variant===from),b=summaries.find(r=>r.precision===precision&&r.variant===to);
  const diff=(!a.modelTrace40ms||!b.modelTrace40ms)?null:Object.fromEntries(['tracking','sync'].map(k=>[k,100*(b.modelTrace40ms[k]/a.modelTrace40ms[k]-1)]));
  contrasts.push({precision,from,to,change_pct:diff,notPhysicalCausalProof:true});
}
for(const [f,h] of Object.entries(hashes))assert.equal(sha(f),h);
const evidence={date:'2026-10-14',currentBuilds:{BLNN:67931,S3R2:67932},controlMatchesOriginal66312:true,
  sourceHashes:hashes,testHarnessSource:harness,testHarnessSHA256:sha(harness),harnessPlantAndControlUnchanged:true,
  harnessDiagnosticOnlyAdaptation:'Ordinary65511ABI lacks actual learning/repair fields; diagnostic actual learning reported1 fromsource-defined ordinary gradient,repair/retentionzero. No plant/control change. First failedcompile retainedinchecks.',
  compilationFlags:'O2,float/double; current sources directly compiled; no MCU image built or flashed',
  variants:variants.map(({task,...v})=>v),casesPerPrecisionBranch:36,totalAssumedClosedLoopRuns:records.length*36,
  historicalFloatBranchExactChecks:records.filter(r=>r.historicalExact).map(r=>r.name),summaries,contrasts,
  modelIdentified:false,independentModelValidation:false,
  native1msAnd40msDefinitionsSeparated:true,
  modelTraceQuantization:'Model-position/reference values at40ms rounded to1um with nearest/half-away-fromzero. Not exact MCU six-decimal arithmetic; no claim that model equals physical telemetry pipeline.',
  comparisonPopulation:'Ordinary+S3R2 jointly complete cases fixed before ablation means; all36 failure outcomes retained. This is conditional completed-case diagnostic comparison, not unconditional efficacy.',
  oldV3IsNotFinalS3R2:true,oldV3TheoryNotTransferred:true,
  availableProperties:['Finite nodes and componentwise projected weights','Bounded guarded integer increments','Measured-sigma sector check','Fixed-feature accepted repair non-enlargement'],
  propertiesAreNotClosedLoopStabilityProof:true,
  gaps:['Model-to-hardware predictive validation missing; simulated and observed ordinary/S3R2 mean ordering must not be called consistent.',
    'No closed-loop theorem forfinalS3R2/discrete filters/quantization/guard switching established inthis audit.',
    'Physical repeated comparisons arewhole-controller preliminary,not component-isolating ablations.',
    'No task-derived tracking tolerance; report tradeoffs rather thanacceptablecost.',
    'Physical current hard-saturation benefit untested inlatest unloaded2mm observations.'],
  firmwareAndRawUnchanged:true,hardwareAction:false,additionalPhysicalRunReleased:false,formalArchiveComplete:false,
  auditSHA256:sha(fileURLToPath(import.meta.url))};
fs.writeFileSync(path.join(dir,'evidence_verification.json'),JSON.stringify(evidence,null,2),{flag:'wx'});
console.log(JSON.stringify({summaries:summaries.map(({fixedComparisonPopulationCaseIDs,faultOutcomes,...v})=>({...v,N:fixedComparisonPopulationCaseIDs.length,faults:faultOutcomes.length})),contrasts,gaps:evidence.gaps},null,2));
