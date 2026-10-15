import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import crypto from 'node:crypto';import {spawnSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
const dir=path.dirname(fileURLToPath(import.meta.url)),root=path.resolve(dir,'../..'),task=path.join(dir,'core'),out=path.join(dir,process.argv[2]||'checks01');assert(!fs.existsSync(out));fs.mkdirSync(out);
const hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const refTask=path.join(root,'05_实验代码/自动监视_故障保留回放_20261014/eassy_E5REPLAY2_A_S3R2_HW6/Task');
for(const f of fs.readdirSync(task).filter(f=>f!=='experiment5_ca_actuator.h'))assert.equal(hash(path.join(task,f)),hash(path.join(refTask,f)));
const env={...process.env,PATH:'D:/MinGW/mingw64/bin;'+process.env.PATH};
const call=(exe,args)=>{const r=spawnSync(exe,args,{env,encoding:'utf8',maxBuffer:40e6});assert.equal(r.status,0,(r.stderr||'')+'\n'+(r.stdout||''));return r.stdout;};
const compile=args=>call('D:/MinGW/mingw64/bin/gcc.exe',['-std=c99','-O2','-Wall','-Wextra','-Werror','-Wno-unused-function','-I',task,...args]);
const native=[];
for(const precision of ['float','double'])for(const scope of [0,1]){
 const exe=path.join(out,'native_'+precision+'_'+scope+'.exe');compile([...(precision==='double'?['-DE5_USE_DOUBLE']:[]),'-DE5_SYNC_PRIORITY_PROJECTION='+scope,path.join(dir,'test_allocator.c'),path.join(dir,'r2_allocator.c'),'-lm','-o',exe]);
 native.push({precision,scope,result:call(exe,[]).trim()});console.log(native.at(-1));
}
const proof=JSON.parse(fs.readFileSync(path.join(root,'06_仿真与复现/fault_export_round33_20261014/physical_run01_analysis.json'),'utf8'));
assert(proof.baselineReplayPassed&&proof.sourceKind==='PHYSICAL_SERIAL_SNAPSHOT');
const binary=path.join(root,'06_仿真与复现/fault_export_round33_20261014/physical_run01_snapshot.bin');assert.equal(hash(binary),proof.snapshotSHA256);
const replay=[];for(const scope of [0,1]){
 const exe=path.join(out,'replay_'+scope+'.exe');compile(['-DE5_SYNC_PRIORITY_PROJECTION='+scope,path.join(dir,'replay_modal.c'),'-lm','-o',exe]);
 const raw=call(exe,[binary]);fs.writeFileSync(path.join(out,'replay_'+scope+'.csv'),raw,{flag:'wx'});const data=raw.trim().split(/\r?\n/).slice(1).map(l=>l.split(',').map(Number));assert.equal(data.length,360);replay.push({scope,data});
}
const reference=fs.readFileSync(path.join(root,'06_仿真与复现/fault_export_round33_20261014/physical_run01_baseline_R2.csv'),'utf8').trim();assert.equal(fs.readFileSync(path.join(out,'replay_0.csv'),'utf8').trim(),reference);
const replayEffects=replay.map(v=>({scope:v.scope,changedCommandSteps:v.data.filter((r,i)=>r[5]!==replay[0].data[i][5]||r[6]!==replay[0].data[i][6]).length,changedLearningSteps:v.data.filter((r,i)=>r[3]!==replay[0].data[i][3]||r[4]!==replay[0].data[i][4]).length,closedLoopCounterfactual:false}));console.log({replayEffects});
const variants=[{name:'BLNN',method:11,scope:0},{name:'S3R2',method:12,scope:0},{name:'SYNC_PRIORITY',method:12,scope:1}];
function run(v,stiffness=2000,noise=19){const id=v.name+'_C'+stiffness+'_N'+noise,exe=path.join(out,id+'.exe');compile(['-DTEST_METHOD='+v.method,'-DE5_SYNC_PRIORITY_PROJECTION='+v.scope,'-DTEST_COUPLING_STIFFNESS='+stiffness,'-DTEST_NOISE_PERIOD='+noise,path.join(dir,'test_plant.c'),path.join(task,'blnn_core.c'),'-lm','-o',exe]);const data=call(exe,[]).trim().split(/\r?\n/).map(l=>JSON.parse(l));fs.writeFileSync(path.join(out,id+'.json'),JSON.stringify(data),{flag:'wx'});const rows=data.filter(r=>r.type==='result');assert.equal(rows.length,36);console.log({id,completed:rows.filter(r=>r.complete).length});return {...v,data,rows};}
const mean=(a,k)=>a.length?a.reduce((s,v)=>s+v[k],0)/a.length:null;
function compare(runs){const r2=runs.find(v=>v.name==='S3R2'),ord=runs.find(v=>v.name==='BLNN'),ids=r2.rows.filter((r,i)=>r.complete&&ord.rows[i].complete).map(r=>r.case);
 const metrics=runs.map(v=>{const selected=v.rows.filter(r=>ids.includes(r.case)),failures=selected.filter(r=>!r.complete).map(r=>r.case),survivors=selected.filter(r=>r.complete);return {name:v.name,completed:v.rows.filter(r=>r.complete).length,baselinePopulation:ids.length,failedBaselineCases:failures,
 newFailures:v.rows.filter((r,i)=>r2.rows[i].complete&&!r.complete).map(r=>({case:r.case,fault:r.fault,stop_ms:r.stop_ms,terminalMax_mm:r.terminalMax_mm})),track:failures.length?null:mean(selected,'partialTrackingRMSE_mm'),sync:failures.length?null:mean(selected,'partialSyncRMS_mm'),secondarySurvivorOnly:{n:survivors.length,track:mean(survivors,'partialTrackingRMSE_mm'),sync:mean(survivors,'partialSyncRMS_mm'),efficacyProof:false}};});
 const b=metrics.find(v=>v.name==='S3R2'),o=metrics.find(v=>v.name==='BLNN');for(const v of metrics){v.syncChangeVsR2_pct=v.sync===null?null:100*(v.sync/b.sync-1);v.trackChangeVsR2_pct=v.track===null?null:100*(v.track/b.track-1);v.syncChangeVsOrdinary_pct=v.sync===null?null:100*(v.sync/o.sync-1);}return metrics;}
const initial=variants.map(v=>run(v));for(const v of initial.filter(v=>!v.scope)){const archive=JSON.parse(fs.readFileSync(path.join(root,'06_仿真与复现/sync_retention_round37_20261014/checks02',v.name+'_C2000_N19.json'),'utf8'));assert.deepEqual(v.data.filter(r=>r.type!=='modal_caps'),archive.filter(r=>r.type!=='modal_caps'));}
const initialMetrics=compare(initial);console.log(JSON.stringify({initialMetrics},null,2));const candidate=initialMetrics.find(v=>v.name==='SYNC_PRIORITY');
const initialPassed=candidate.newFailures.length===0&&candidate.sync!==null&&candidate.syncChangeVsR2_pct<0;
const holdout=[];if(initialPassed)for(const stiffness of [1000,2000,3000])for(const noise of [17,23]){const metrics=compare(variants.map(v=>run(v,stiffness,noise)));holdout.push({stiffness,noise,metrics});console.log(JSON.stringify(holdout.at(-1)));}
const admission={initialPassed,initialNewFailureInstances:candidate.newFailures.length,holdoutSettings:holdout.length,newFailureInstances:holdout.reduce((s,h)=>s+h.metrics.find(v=>v.name==='SYNC_PRIORITY').newFailures.length,0),settingsWithSyncGain:holdout.filter(h=>{const v=h.metrics.find(v=>v.name==='SYNC_PRIORITY');return v.sync!==null&&v.syncChangeVsR2_pct<0;}).length,settingsWithSyncGainVsOrdinary:holdout.filter(h=>{const v=h.metrics.find(v=>v.name==='SYNC_PRIORITY');return v.sync!==null&&v.syncChangeVsOrdinary_pct<0;}).length};
admission.screenPassed=initialPassed&&holdout.length===6&&admission.newFailureInstances===0&&admission.settingsWithSyncGain>=4;
const result={protocolSHA256:hash(path.join(dir,'protocol.json')),allocatorSHA256:hash(path.join(task,'experiment5_ca_actuator.h')),coreExactOriginal:true,otherHeadersExactOriginal:true,native,replayEffects,baselineExactlyReproduced:true,initialMetrics,holdout,admission,allOutcomesRetained:true,modelsIdentified:false,physicalBenefitProven:false,hardwareReleased:false};fs.writeFileSync(path.join(out,'verification.json'),JSON.stringify(result,null,2),{flag:'wx'});console.log(JSON.stringify({admission,hardwareReleased:false}));
