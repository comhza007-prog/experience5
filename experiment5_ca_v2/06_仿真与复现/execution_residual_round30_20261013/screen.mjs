import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import crypto from 'node:crypto';import {spawnSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
const dir=path.dirname(fileURLToPath(import.meta.url)),root=path.resolve(dir,'../..'),task=path.join(dir,'core'),out=path.join(dir,process.argv[2]||'checks01');assert(!fs.existsSync(out));fs.mkdirSync(out);
const hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex'),env={...process.env,PATH:'D:/MinGW/mingw64/bin;'+process.env.PATH};
const r2=path.join(root,'05_实验代码/同期复核A_封存固件_20261013/01_R2/eassy_E5R2_A_S3R2_HW6/Task');
for(const f of ['blnn_core.h','experiment5_ca_actuator.h','experiment5_formal_actuator.h','experiment5_motion.h','experiment5_hw_profile.h'])assert.equal(hash(path.join(task,f)),hash(path.join(r2,f)));
assert.equal(hash(path.join(dir,'r2_core.inc')),hash(path.join(r2,'blnn_core.c')));
function call(exe,args){const r=spawnSync(exe,args,{env,encoding:'utf8',maxBuffer:40e6});assert.equal(r.status,0,r.stderr+'\n'+r.stdout);return r.stdout;}
function compile(args){call('D:/MinGW/mingw64/bin/gcc.exe',['-std=c99','-O2','-Wall','-Wextra','-Werror','-Wno-unused-function','-I',task,...args]);}
const tests=[];
for(const precision of ['float','double'])for(const enabled of [false,true]) {
 const exe=path.join(out,'test_'+precision+'_'+Number(enabled)+'.exe');
 compile([...(precision==='double'?['-DE5_USE_DOUBLE']:[]),'-DDIAG_EXECUTION_RESIDUAL='+Number(enabled),path.join(dir,'test_residual.c'),path.join(dir,'r2_wrapper.c'),'-lm','-o',exe]);
 const result=call(exe,[]).trim();tests.push({precision,enabled,result});console.log(tests.at(-1));
}
const variants=[{name:'BLNN',method:11,enabled:0,scope:2,gain:5},{name:'S3R2',method:12,enabled:0,scope:2,gain:5},...[5,20].flatMap(gain=>[0,1,2].map(scope=>({name:'RES_'+scope+'_K'+gain,method:12,enabled:1,scope,gain})))];
const all=[];
for(const v of variants) {
 const exe=path.join(out,v.name+'.exe');compile(['-DTEST_METHOD='+v.method,'-DDIAG_EXECUTION_RESIDUAL='+v.enabled,'-DDIAG_RESIDUAL_SCOPE='+v.scope,'-DDIAG_RESIDUAL_GAIN='+v.gain,path.join(root,'06_仿真与复现/sync_priority_round22_20261013/test_plant.c'),path.join(task,'blnn_core.c'),'-lm','-o',exe]);
 const data=call(exe,[]).trim().split(/\r?\n/).map(s=>JSON.parse(s));fs.writeFileSync(path.join(out,v.name+'.json'),JSON.stringify(data));
 all.push({...v,data,rows:data.filter(r=>r.type==='result')});console.log({name:v.name,complete:all.at(-1).rows.filter(r=>r.complete).length,total:36});
}
const archived=JSON.parse(fs.readFileSync(path.join(root,'06_仿真与复现/sync_allocation_round25_20261013/checks02/S3R2_assumed.json')));assert.deepEqual(all[1].data,archived);
const common=all[1].rows.filter((r,i)=>all.every(v=>v.rows[i].complete)).map(r=>r.case),mean=(a,key)=>a.reduce((s,r)=>s+r[key],0)/a.length;
const performance=all.map(v=>{const a=v.rows.filter(r=>common.includes(r.case));return{name:v.name,scope:v.scope,gain:v.gain,n:a.length,track:mean(a,'partialTrackingRMSE_mm'),sync:mean(a,'partialSyncRMS_mm'),newFailures:v.rows.filter((r,i)=>all[1].rows[i].complete&&!r.complete).map(r=>r.case)};});
const baseline=performance[1],ordinary=performance[0];for(const p of performance){p.trackingChangeVsR2_pct=100*(p.track/baseline.track-1);p.syncChangeVsR2_pct=100*(p.sync/baseline.sync-1);p.syncChangeVsOrdinary_pct=100*(p.sync/ordinary.sync-1);}
const result={tests,protocol:'protocol.json',performance,allCasesRetained:true,disabledExactlyR2:true,allocatorAndHardGuardsUnchanged:true,localFixedFeaturePropertyOnly:true,assumedPlantIdentified:false,hardwareReleased:false,physicalPerformanceProven:false};
fs.writeFileSync(path.join(out,'verification.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({performance,hardwareReleased:false},null,2));
