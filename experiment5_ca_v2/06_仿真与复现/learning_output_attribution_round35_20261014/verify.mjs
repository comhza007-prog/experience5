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
for(const f of fs.readdirSync(task).filter(f=>f.endsWith('.h')))assert.equal(hash(path.join(task,f)),hash(path.join(r33,f)));
assert.equal(hash(path.join(dir,'r2_core.inc')),hash(path.join(r33,'blnn_core.c')));
const env={...process.env,PATH:'D:/MinGW/mingw64/bin;'+process.env.PATH};
const call=(exe,args)=>{const r=spawnSync(exe,args,{env,encoding:'utf8',maxBuffer:40e6});assert.equal(r.status,0,r.stderr+'\n'+r.stdout);return r.stdout;};
const compile=args=>call('D:/MinGW/mingw64/bin/gcc.exe',['-std=c99','-O2','-Wall','-Wextra','-Werror','-Wno-unused-function','-I',task,...args]);
const variants=[{name:'BLNN',method:11,plain:0,repair:1,retention:1},
 {name:'CA_PLAIN',method:12,plain:1,repair:0,retention:0},
 {name:'CA_CLASS',method:12,plain:0,repair:0,retention:0},
 {name:'CA_CLASS_REPAIR',method:12,plain:0,repair:1,retention:0},
 {name:'S3R2',method:12,plain:0,repair:1,retention:1}];
const flags=v=>['-DE5_DIAG_PLAIN_LEARNING='+v.plain,'-DDIAG_BOUNDED_REPAIR='+v.repair,'-DDIAG_TRACKING_RETENTION='+v.retention];
const native=[];
for(const precision of ['float','double'])for(const v of variants.filter(v=>['CA_PLAIN','S3R2'].includes(v.name))){
 const exe=path.join(out,'native_'+precision+'_'+v.name+'.exe');
 compile([...(precision==='double'?['-DE5_USE_DOUBLE']:[]),...flags(v),path.join(dir,'test_attribution.c'),path.join(dir,'r2_wrapper.c'),'-lm','-o',exe]);
 native.push({precision,variant:v.name,result:call(exe,[]).trim()});console.log(native.at(-1));
}
const proof=JSON.parse(fs.readFileSync(path.join(root,'06_仿真与复现/fault_export_round33_20261014/physical_run01_analysis.json'),'utf8'));
assert(proof.baselineReplayPassed);const binary=path.join(root,'06_仿真与复现/fault_export_round33_20261014/physical_run01_snapshot.bin');assert.equal(hash(binary),proof.snapshotSHA256);
const replays=[];
for(const v of variants.filter(v=>v.method===12)){
 const exe=path.join(out,'replay_'+v.name+'.exe');compile([...flags(v),path.join(dir,'replay_modal.c'),'-lm','-o',exe]);
 const raw=call(exe,[binary]);fs.writeFileSync(path.join(out,'replay_'+v.name+'.csv'),raw);
 const data=raw.trim().split(/\r?\n/).slice(1).map(l=>l.split(',').map(Number));assert.equal(data.length,360);replays.push({...v,data});
}
const reference=fs.readFileSync(path.join(root,'06_仿真与复现/fault_export_round33_20261014/physical_run01_baseline_R2.csv'),'utf8').trim();
assert.equal(fs.readFileSync(path.join(out,'replay_S3R2.csv'),'utf8').trim(),reference);
const baseReplay=replays.find(v=>v.name==='S3R2').data;
const replayEffects=replays.map(v=>({name:v.name,changedCommandSteps:v.data.filter((r,i)=>r[5]!==baseReplay[i][5]||r[6]!==baseReplay[i][6]).length,
 changedLearningSteps:v.data.filter((r,i)=>r[3]!==baseReplay[i][3]||r[4]!==baseReplay[i][4]).length,finalNodes:v.data.at(-1).slice(13,15),closedLoopCounterfactual:false}));
console.log({replayEffects});
const runs=[];
for(const v of variants){
 const exe=path.join(out,v.name+'.exe');compile(['-DTEST_METHOD='+v.method,...flags(v),path.join(dir,'test_plant.c'),path.join(task,'blnn_core.c'),'-lm','-o',exe]);
 const data=call(exe,[]).trim().split(/\r?\n/).map(l=>JSON.parse(l));fs.writeFileSync(path.join(out,v.name+'.json'),JSON.stringify(data));
 const rows=data.filter(r=>r.type==='result');assert.equal(rows.length,36);assert.deepEqual(rows.map(r=>r.case),Array.from({length:36},(_,i)=>i+1));
 runs.push({...v,data,rows});console.log({variant:v.name,completed:rows.filter(r=>r.complete).length});
}
const baseline=runs.find(v=>v.name==='S3R2'),ordinary=runs.find(v=>v.name==='BLNN');
const archived=JSON.parse(fs.readFileSync(path.join(root,'06_仿真与复现/modal_learning_round34_20261014/checks02/S3R2_C2000_N19.json'),'utf8'));
assert.deepEqual(baseline.data.filter(r=>r.type!=='actual_learning'),archived,'R2 baseline drift');
const archivedOrdinary=JSON.parse(fs.readFileSync(path.join(root,'06_仿真与复现/modal_learning_round34_20261014/checks02/BLNN_C2000_N19.json'),'utf8'));assert.deepEqual(ordinary.data.filter(r=>r.type!=='actual_learning'),archivedOrdinary);
const ids=baseline.rows.filter((r,i)=>r.complete&&ordinary.rows[i].complete).map(r=>r.case);
const mean=(a,k)=>a.length?a.reduce((s,v)=>s+v[k],0)/a.length:null;
const metrics=runs.map(v=>{
 const population=v.rows.filter(r=>ids.includes(r.case)),failed=population.filter(r=>!r.complete).map(r=>r.case);
 const mechanics=v.data.filter(r=>r.type==='mechanism'&&ids.includes(r.case));
 const actual=v.data.filter(r=>r.type==='actual_learning'&&ids.includes(r.case));
 return {name:v.name,baselinePopulationN:ids.length,completedTotal:v.rows.filter(r=>r.complete).length,
  failedPopulationCases:failed,newFailures:v.rows.filter((r,i)=>baseline.rows[i].complete&&!r.complete).map(r=>({case:r.case,fault:r.fault,stop_ms:r.stop_ms})),
  trackingRMSE_mm:failed.length?null:mean(population,'partialTrackingRMSE_mm'),syncRMS_mm:failed.length?null:mean(population,'partialSyncRMS_mm'),
  mechanismMeans:{nominalCommonZeroLearning_pct:mean(population,'learningZero_pct'),
   actualModalZeroLearning_pct:[0,1].map(ch=>mean(actual.map(r=>({v:r.zero_pct[ch]})),'v')),
   actualModalMeanLearning:[0,1].map(ch=>mean(actual.map(r=>({v:r.mean[ch]})),'v')),
   repairSteps:[0,1].map(ch=>actual.reduce((s,r)=>s+r.repairSteps[ch],0)),retentionSteps:actual.reduce((s,r)=>s+r.retentionSteps,0),
   pureRate_pct:mean(population,'pureRate_pct'),anyMask_pct:mean(population,'anyMask_pct'),
   NNIncrementRMS_counts:mean(population,'nnIncrementRMS_counts'),amplitudeHits:population.reduce((s,r)=>s+r.hardHits[0]+r.hardHits[1],0),
   meanSector:[mean(mechanics.map(r=>({v:r.sectorMean[0]})),'v'),mean(mechanics.map(r=>({v:r.sectorMean[1]})),'v')]}};
});
const contrasts=[['BLNN','CA_PLAIN'],['CA_PLAIN','CA_CLASS'],['CA_CLASS','CA_CLASS_REPAIR'],['CA_CLASS_REPAIR','S3R2']].map(([from,to])=>{
 const a=metrics.find(v=>v.name===from),b=metrics.find(v=>v.name===to);return {from,to,
  syncChange_pct:a.syncRMS_mm===null||b.syncRMS_mm===null?null:100*(b.syncRMS_mm/a.syncRMS_mm-1),
  trackingChange_pct:a.trackingRMSE_mm===null||b.trackingRMSE_mm===null?null:100*(b.trackingRMSE_mm/a.trackingRMSE_mm-1),
  boundary:from==='BLNN'?'Whole CA output-path contrast including sector/gate/allocator/AW, not allocator alone':'Successive learning-rule contrast; not additive contribution or physical causal evidence'};
});
const result={protocol:'protocol.json',native,replayEffects,metrics,contrasts,sourceSHA256:hash(path.join(task,'blnn_core.c')),
 copiedHeadersUnchanged:true,R2AndOrdinaryBaselineExactlyReproduced:true,all36CasesRetained:true,assumedModelsIdentified:false,physicalCauseProven:false,hardwareReleased:false};
fs.writeFileSync(path.join(out,'verification.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({metrics,contrasts,hardwareReleased:false},null,2));
