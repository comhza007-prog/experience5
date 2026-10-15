import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
const dir=path.dirname(fileURLToPath(import.meta.url)),root=path.resolve(dir,'../../..');
const code=path.join(root,'experiment5_ca_v2/05_实验代码');
const task=path.join(code,'S3R7_同步耗散余量_20261013/eassy_E5R7_A_S3R7_HW6/Task');
const r2=path.join(code,'S3R2_静止跟踪保持_20261013/eassy_E5R2_A_S3R2_HW6/Task');
const out=path.join(dir,process.argv[2]||'checks01');assert(!fs.existsSync(out));fs.mkdirSync(out);
const hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const walk=p=>fs.readdirSync(p,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(p,e.name)):[path.join(p,e.name)]);
const roots=fs.readdirSync(code).filter(n=>/^S3R[1-6]_/.test(n)).map(n=>path.join(code,n));roots.push(path.join(root,'experiment5_ca_v2/01_原始数据'));
const preserved=Object.fromEntries(roots.flatMap(walk).map(p=>[p,hash(p)]));
for(const f of ['blnn_core.h','motor_task.c','experiment5_motion.h','experiment5_hw_profile.h','experiment5_formal_actuator.h','periodic_release.h','experiment5_formal_metrics.h'])assert.equal(hash(path.join(task,f)),hash(path.join(r2,f)),f);
const env={...process.env,PATH:'D:/MinGW/mingw64/bin;'+process.env.PATH},tests=[];
function call(exe,args){const r=spawnSync(exe,args,{env,encoding:'utf8',maxBuffer:30e6});assert.equal(r.status,0,r.stderr+'\n'+r.stdout);return r.stdout;}
function compile(args,include=task){call('D:/MinGW/mingw64/bin/gcc.exe',['-std=c99','-O2','-Wall','-Wextra','-Werror','-Wno-unused-function','-I',include,...args]);}
for(const precision of ['float','double']) {
 const flags=precision==='double'?['-DE5_USE_DOUBLE']:[],obj=path.join(out,'r2_'+precision+'.o');
 compile([...flags,'-c',path.join(dir,'r2_wrapper.c'),'-o',obj],r2);
 for(const disabled of [false,true]) {
  const exe=path.join(out,'core_'+precision+(disabled?'_disabled':'')+'.exe');
  compile([...flags,...(disabled?['-DDIAG_JOINT_TRANSLATION=0']:[]),path.join(dir,'test_core.c'),path.join(task,'blnn_core.c'),obj,'-lm','-o',exe]);
  const result=call(exe,[]).trim();tests.push({precision,disabled,type:'sector/exact regression',result});console.log(tests.at(-1));
 }
 const exe=path.join(out,'adapter_'+precision+'.exe');
 compile([...flags,path.join(dir,'test_adapter.c'),path.join(task,'blnn_core.c'),'-lm','-o',exe]);
 tests.push({precision,type:'allocator/core/AW invariants',result:call(exe,[]).trim()});console.log(tests.at(-1));
}
const exe=path.join(out,'trace.exe');compile([path.join(dir,'test_trace.c'),'-o',exe]);tests.push({type:'EVENT48 serialization',result:call(exe,[]).trim()});console.log(tests.at(-1));
const variants=[];
for(const [name,source,method,flags,include]of [['BLNN',path.join(task,'blnn_core.c'),11,[],task],['R2',path.join(r2,'blnn_core.c'),12,[],r2],['R7',path.join(task,'blnn_core.c'),12,[],task],['R7_DISABLED',path.join(task,'blnn_core.c'),12,['-DDIAG_JOINT_TRANSLATION=0'],task]]) {
 const exe=path.join(out,name+'_plant.exe');compile(['-DTEST_METHOD='+method,...flags,path.join(dir,'test_plant.c'),source,'-lm','-o',exe],include);
 const result=call(exe,[]).trim().split(/\r?\n/).map(s=>JSON.parse(s));fs.writeFileSync(path.join(out,name+'_assumed.json'),JSON.stringify(result));variants.push({name,result});
 console.log({assumedModel:name,complete:result.filter(r=>r.type==='result'&&r.complete).length,total:36});
}
assert.deepEqual(variants[1].result,variants[3].result,'Disabled R7 exactly R2');
const rows=variants.map(v=>({name:v.name,rows:v.result.filter(r=>r.type==='result')}));
const newFailures=rows[2].rows.filter((r,i)=>rows[1].rows[i].complete&&!r.complete).map(r=>r.case);
const matched=rows[1].rows.filter((r,i)=>r.complete&&rows[2].rows[i].complete&&rows[0].rows[i].complete).map(r=>r.case);
const mean=(a,k)=>a.reduce((s,r)=>s+r[k],0)/a.length;
const performance=rows.map(v=>{const a=v.rows.filter(r=>matched.includes(r.case));return{name:v.name,n:a.length,tracking:mean(a,'partialTrackingRMSE_mm'),sync:mean(a,'partialSyncRMS_mm')};});
for(const[p,h]of Object.entries(preserved))assert.equal(hash(p),h,'Preserved file changed');
const result={date:'2026-10-13',tests,summary:rows.map(v=>({name:v.name,complete:v.rows.filter(r=>r.complete).length,total:36})),performance,newFailures,preserved,sources:Object.fromEntries(walk(path.dirname(task)).map(p=>[p,hash(p)])),hostChecksPassed:true,allPassed:newFailures.length===0,disabledExactlyR2:true,assumedModelIdentified:false,physicalEfficacyProven:false,onBoardTimingMeasured:false};
fs.writeFileSync(path.join(out,'verification.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({summary:result.summary,performance,newFailures,allPassed:result.allPassed},null,2));
assert.equal(newFailures.length,0,'New assumed-model failure: do not release');
