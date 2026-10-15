import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const dir=path.dirname(fileURLToPath(import.meta.url)),root=path.resolve(dir,'../..'),task=path.join(dir,'core');
const out=path.join(dir,process.argv[2]||'checks01');assert(!fs.existsSync(out));fs.mkdirSync(out);
const hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const r33=path.join(root,'05_实验代码/自动监视_故障保留回放_20261014/eassy_E5REPLAY2_A_S3R2_HW6/Task');
for(const file of fs.readdirSync(task).filter(f=>f.endsWith('.h')))assert.equal(hash(path.join(task,file)),hash(path.join(r33,file)));
assert.equal(hash(path.join(dir,'r2_core.inc')),hash(path.join(r33,'blnn_core.c')));
const env={...process.env,PATH:'D:/MinGW/mingw64/bin;'+process.env.PATH};
const call=(exe,args)=>{const r=spawnSync(exe,args,{env,encoding:'utf8',maxBuffer:40e6});assert.equal(r.status,0,r.stderr+'\n'+r.stdout);return r.stdout;};
const compile=args=>call('D:/MinGW/mingw64/bin/gcc.exe',['-std=c99','-O2','-Wall','-Wextra','-Werror','-Wno-unused-function','-I',task,...args]);
const native=[];
for(const precision of ['float','double'])for(const scope of [0,1]){
 const exe=path.join(out,'native_'+precision+'_'+scope+'.exe');
 compile([...(precision==='double'?['-DE5_USE_DOUBLE']:[]),'-DE5_JOINT_PROJECTION='+scope,path.join(dir,'test_joint.c'),path.join(dir,'r2_wrapper.c'),'-lm','-o',exe]);
 native.push({precision,scope,result:call(exe,[]).trim()});console.log(native.at(-1));
}
const proof=JSON.parse(fs.readFileSync(path.join(root,'06_仿真与复现/fault_export_round33_20261014/physical_run01_analysis.json'),'utf8'));
assert(proof.baselineReplayPassed&&proof.sourceKind==='PHYSICAL_SERIAL_SNAPSHOT');
const binary=path.join(root,'06_仿真与复现/fault_export_round33_20261014/physical_run01_snapshot.bin');assert.equal(hash(binary),proof.snapshotSHA256);
const replay=[];
for(const scope of [0,1]){
 const exe=path.join(out,'replay_'+scope+'.exe');compile(['-DE5_JOINT_PROJECTION='+scope,path.join(dir,'replay_modal.c'),'-lm','-o',exe]);
 const raw=call(exe,[binary]);fs.writeFileSync(path.join(out,'replay_'+scope+'.csv'),raw);
 const data=raw.trim().split(/\r?\n/).slice(1).map(l=>l.split(',').map(Number));assert.equal(data.length,360);replay.push({scope,data});
}
const reference=fs.readFileSync(path.join(root,'06_仿真与复现/fault_export_round33_20261014/physical_run01_baseline_R2.csv'),'utf8').trim();
assert.equal(fs.readFileSync(path.join(out,'replay_0.csv'),'utf8').trim(),reference,'Disabled recurrent baseline changed');
const replayEffects=replay.map(v=>({scope:v.scope,changedCommandSteps:v.data.filter((r,i)=>r[5]!==replay[0].data[i][5]||r[6]!==replay[0].data[i][6]).length,
 changedLearningSteps:v.data.filter((r,i)=>r[3]!==replay[0].data[i][3]||r[4]!==replay[0].data[i][4]).length,
 finalNodes:v.data.at(-1).slice(13,15),closedLoopCounterfactual:false}));console.log({replayEffects});
const variants=[{name:'BLNN',method:11,scope:0},{name:'S3R2',method:12,scope:0},{name:'JOINT_FINAL_PROJECTION',method:12,scope:1}];
function runPlant(v,stiffness=2000,noise=19){
 const id=v.name+'_C'+stiffness+'_N'+noise,exe=path.join(out,id+'.exe');
 compile(['-DTEST_METHOD='+v.method,'-DE5_JOINT_PROJECTION='+v.scope,'-DTEST_COUPLING_STIFFNESS='+stiffness,'-DTEST_NOISE_PERIOD='+noise,path.join(dir,'test_plant.c'),path.join(task,'blnn_core.c'),'-lm','-o',exe]);
 const data=call(exe,[]).trim().split(/\r?\n/).map(l=>JSON.parse(l));fs.writeFileSync(path.join(out,id+'.json'),JSON.stringify(data));
 const rows=data.filter(r=>r.type==='result');assert.equal(rows.length,36);assert.deepEqual(rows.map(r=>r.case),Array.from({length:36},(_,i)=>i+1));
 const run={...v,data,rows,caps:data.find(r=>r.type==='modal_caps').counts};console.log({id,completed:rows.filter(r=>r.complete).length,caps:run.caps});return run;
}
const mean=(a,key)=>a.length?a.reduce((s,v)=>s+v[key],0)/a.length:null;
function compare(runs){
 const baseline=runs.find(v=>v.name==='S3R2'),ordinary=runs.find(v=>v.name==='BLNN');
 const ids=baseline.rows.filter((r,i)=>r.complete&&ordinary.rows[i].complete).map(r=>r.case);
 const metrics=runs.map(v=>{
  const selected=v.rows.filter(r=>ids.includes(r.case)),failures=selected.filter(r=>!r.complete).map(r=>r.case);
  const commonCompleted=v.rows.filter((r,i)=>baseline.rows[i].complete&&ordinary.rows[i].complete&&r.complete);
  return {name:v.name,scope:v.scope,completed:v.rows.filter(r=>r.complete).length,baselinePopulationN:ids.length,
   newFailures:v.rows.filter((r,i)=>baseline.rows[i].complete&&!r.complete).map(r=>({case:r.case,fault:r.fault,stop_ms:r.stop_ms,terminalMax_mm:r.terminalMax_mm})),
   failedBaselinePopulationCases:failures,track:failures.length?null:mean(selected,'partialTrackingRMSE_mm'),sync:failures.length?null:mean(selected,'partialSyncRMS_mm'),
   secondarySurvivorOnly:{n:commonCompleted.length,track:mean(commonCompleted,'partialTrackingRMSE_mm'),sync:mean(commonCompleted,'partialSyncRMS_mm'),efficacyEvidence:false},caps:v.caps};
 });
 const base=metrics.find(v=>v.name==='S3R2'),ord=metrics.find(v=>v.name==='BLNN');
 for(const p of metrics){p.syncChangeVsR2_pct=p.sync===null?null:100*(p.sync/base.sync-1);p.trackingChangeVsR2_pct=p.track===null?null:100*(p.track/base.track-1);
  p.syncChangeVsOrdinary_pct=p.sync===null?null:100*(p.sync/ord.sync-1);}
 return metrics;
}
const initial=variants.map(v=>runPlant(v));
const archived=JSON.parse(fs.readFileSync(path.join(root,'06_仿真与复现/sync_allocation_round25_20261013/checks02/S3R2_assumed.json'),'utf8'));
assert.deepEqual(initial[1].data.filter(v=>!['modal_caps','actual_learning'].includes(v.type)),archived,'Unchanged R2 assumed plant baseline drifted');
const initialMetrics=compare(initial);console.log(JSON.stringify({initialMetrics},null,2));
const eligible=initialMetrics.filter(v=>v.scope&&v.newFailures.length===0&&v.syncChangeVsR2_pct!==null&&v.syncChangeVsR2_pct<0);
const holdout=[];
if(eligible.length){
 for(const stiffness of [1000,2000,3000])for(const noise of [17,23]){
  const runs=variants.filter(v=>v.scope===0||eligible.some(p=>p.name===v.name)).map(v=>runPlant(v,stiffness,noise));
  const metrics=compare(runs);holdout.push({stiffness,noise,metrics});console.log(JSON.stringify(holdout.at(-1)));
 }
}
const admission=variants.filter(v=>v.scope).map(v=>({name:v.name,initialPassed:eligible.some(p=>p.name===v.name),
 holdoutSettings:holdout.length,newFailureInstances:holdout.reduce((s,h)=>s+(h.metrics.find(p=>p.name===v.name)?.newFailures.length||0),0),
 settingsWithSyncGain:holdout.filter(h=>{const p=h.metrics.find(p=>p.name===v.name);return p&&p.syncChangeVsR2_pct!==null&&p.syncChangeVsR2_pct<0;}).length}));
for(const p of admission){
 p.screenPassed=p.initialPassed&&p.holdoutSettings===6&&p.newFailureInstances===0&&p.settingsWithSyncGain>=4;
 p.settingsWithSyncGainVsOrdinary=holdout.filter(h=>{const v=h.metrics.find(m=>m.name===p.name);return v&&v.syncChangeVsOrdinary_pct!==null&&v.syncChangeVsOrdinary_pct<0;}).length;
 p.initialOrdinarySyncGoalMet=initialMetrics.find(v=>v.name===p.name).syncChangeVsOrdinary_pct<0;
 p.paperOrdinarySyncBenefitNotProven=true;
}
const result={protocol:'protocol.json',native,replayEffects,initialMetrics,holdout,admission,sourceSHA256:hash(path.join(task,'blnn_core.c')),
 copiedHeadersUnchanged:true,disabledExactlyR2:true,allCasesRetained:true,assumedModelsIdentified:false,physicalBenefitProven:false,hardwareReleased:false};
fs.writeFileSync(path.join(out,'verification.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({admission,hardwareReleased:false},null,2));
