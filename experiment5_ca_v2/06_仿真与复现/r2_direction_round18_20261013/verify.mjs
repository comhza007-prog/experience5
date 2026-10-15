import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
const dir=path.dirname(fileURLToPath(import.meta.url)),root=path.resolve(dir,'../../..');
const code=path.join(root,'experiment5_ca_v2/05_实验代码');
const task=path.join(code,'S3R6_R2定向修复_20261013/eassy_E5R6_A_S3R6_HW6/Task');
const r2=path.join(code,'S3R2_静止跟踪保持_20261013/eassy_E5R2_A_S3R2_HW6/Task');
const out=path.join(dir,process.argv[2]||'checks01');assert(!fs.existsSync(out));fs.mkdirSync(out);
const hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const walk=p=>fs.readdirSync(p,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(p,e.name)):[path.join(p,e.name)]);
const roots=['S3R1_有界纠错_20261013','S3R2_静止跟踪保持_20261013','S3R3_分通道接纳学习_20261013','S3R4_运动跟踪恢复_20261013','S3R5_换向补偿修复_20261013'].map(p=>path.join(code,p));
roots.push(path.join(root,'experiment5_ca_v2/01_原始数据'));
const preserved=Object.fromEntries(roots.flatMap(walk).map(p=>[p,hash(p)]));
for(const file of ['blnn_core.h','motor_task.c','experiment5_ca_actuator.h','experiment5_motion.h','experiment5_hw_profile.h','experiment5_formal_actuator.h','periodic_release.h','experiment5_formal_metrics.h'])assert.equal(hash(path.join(task,file)),hash(path.join(r2,file)),'Unscoped change: '+file);
assert.equal(hash(path.join(dir,'r2_core.inc')),hash(path.join(r2,'blnn_core.c')));
const env={...process.env,PATH:'D:/MinGW/mingw64/bin;'+process.env.PATH},tests=[];
function call(exe,args){const r=spawnSync(exe,args,{env,encoding:'utf8',maxBuffer:30e6});assert.equal(r.status,0,r.stderr+'\n'+r.stdout);return r.stdout;}
function compile(args){call('D:/MinGW/mingw64/bin/gcc.exe',['-std=c99','-O2','-Wall','-Wextra','-Werror','-Wno-unused-function','-I',task,...args]);}
for(const precision of ['float','double']) {
 const flags=precision==='double'?['-DE5_USE_DOUBLE']:[],exe=path.join(out,'direction_'+precision+'.exe');
 compile([...flags,path.join(dir,'test_direction.c'),path.join(dir,'r2_wrapper.c'),'-lm','-o',exe]);
 tests.push({precision,type:'fixed-feature repair and exact R2 regression',result:call(exe,[]).trim()});console.log(tests.at(-1));
 const adapter=path.join(out,'adapter_'+precision+'.exe');
 compile([...flags,path.resolve(dir,'../projection_round06_20261012/test_adapter.c'),path.join(task,'blnn_core.c'),'-lm','-o',adapter]);
 tests.push({precision,type:'allocator/core/AW invariants',result:call(adapter,[]).trim()});console.log(tests.at(-1));
}
const traceExe=path.join(out,'trace.exe');compile([path.join(dir,'test_trace.c'),'-o',traceExe]);
tests.push({type:'R6 EVENT48 serialization',result:call(traceExe,[]).trim()});console.log(tests.at(-1));
const assumed=[];
for(const [name,source,method,flags]of [['BLNN',path.join(task,'blnn_core.c'),11,[]],['S3R2',path.join(dir,'r2_core.inc'),12,['-DDIAG_DIRECTIONAL_REPAIR=0']],['S3R6',path.join(task,'blnn_core.c'),12,[]],['R6_DISABLED',path.join(task,'blnn_core.c'),12,['-DDIAG_DIRECTIONAL_REPAIR=0']]]) {
 const exe=path.join(out,name+'_plant.exe');compile(['-DTEST_METHOD='+method,...flags,path.join(dir,'test_plant.c'),'-x','c',source,'-lm','-o',exe]);
 const result=call(exe,[]).trim().split(/\r?\n/).map(s=>JSON.parse(s));
 fs.writeFileSync(path.join(out,name+'_assumed.json'),JSON.stringify(result));assumed.push({name,result});
 console.log({assumedModel:name,complete:result.filter(r=>r.type==='result'&&r.complete).length,total:36});
}
assert.deepEqual(assumed[1].result,assumed[3].result,'Disabled R6 must reproduce all R2 outcomes');
assert.deepEqual(assumed[1].result.filter(r=>r.case>=19),assumed[2].result.filter(r=>r.case>=19),'Asymmetric R6 must reproduce all R2 traces/outcomes');
const results=assumed.map(v=>({name:v.name,rows:v.result.filter(r=>r.type==='result')}));
const prior=results[1].rows,newRows=results[2].rows;
const newFailures=newRows.filter((r,i)=>prior[i].complete&&!r.complete).map(r=>r.case);
const recovered=newRows.filter((r,i)=>!prior[i].complete&&r.complete).map(r=>r.case);
const matched=prior.filter((r,i)=>r.complete&&newRows[i].complete).map(r=>r.case);
const mean=(rows,key)=>rows.reduce((s,r)=>s+r[key],0)/rows.length;
const performance=results.map(v=>{const rows=v.rows.filter(r=>matched.includes(r.case));return {name:v.name,n:rows.length,tracking:mean(rows,'partialTrackingRMSE_mm'),sync:mean(rows,'partialSyncRMS_mm')};});
for(const[p,h]of Object.entries(preserved))assert.equal(hash(p),h,'Preserved file changed');
const sources=Object.fromEntries(walk(path.dirname(task)).map(p=>[p,hash(p)]));
const summary=results.map(v=>({name:v.name,complete:v.rows.filter(r=>r.complete).length,total:v.rows.length}));
const result={date:'2026-10-13',tests,summary,performance,newFailures,recovered,disabledExactlyR2:true,asymmetricExactlyR2:true,preserved,sources,hostChecksPassed:true,allPassed:newFailures.length===0,onBoardTimingMeasured:false,physicalEfficacyProven:false,assumedModelIdentified:false};
fs.writeFileSync(path.join(out,'verification.json'),JSON.stringify(result,null,2));
console.log(JSON.stringify({summary,performance,newFailures,recovered,allPassed:result.allPassed,physicalEfficacyProven:false},null,2));
assert.equal(newFailures.length,0,'Do not release: new assumed-model failure vs R2');
