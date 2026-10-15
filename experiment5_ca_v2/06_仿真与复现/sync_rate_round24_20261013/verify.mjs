import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import crypto from 'node:crypto';import {spawnSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
const dir=path.dirname(fileURLToPath(import.meta.url)),root=path.resolve(dir,'../../..'),e5=path.join(root,'experiment5_ca_v2');
const task=path.join(e5,'05_实验代码/S3R10_纯变化率同步学习_20261013/eassy_E5R10_A_S3R10_HW6/Task');
const r2=path.join(e5,'05_实验代码/同期复核A_封存固件_20261013/01_R2/eassy_E5R2_A_S3R2_HW6/Task');
const output=path.join(dir,process.argv[2]||'checks01');assert(!fs.existsSync(output));fs.mkdirSync(output);
const hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const walk=p=>fs.readdirSync(p,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(p,e.name)):[path.join(p,e.name)]);
const preserve=[path.join(e5,'01_原始数据'),path.join(e5,'05_实验代码/同期复核A_封存固件_20261013')];
const preserved=Object.fromEntries(preserve.flatMap(walk).map(p=>[p,hash(p)]));
for(const f of ['experiment5_ca_actuator.h','experiment5_motion.h','experiment5_hw_profile.h','periodic_release.h','experiment5_formal_actuator.h'])assert.equal(hash(path.join(task,f)),hash(path.join(r2,f)),f);
const env={...process.env,PATH:'D:/MinGW/mingw64/bin;'+process.env.PATH},tests=[];
function call(exe,args){const r=spawnSync(exe,args,{env,encoding:'utf8',maxBuffer:35e6});assert.equal(r.status,0,r.stderr+'\n'+r.stdout);return r.stdout;}
function compile(args,include=task){call('D:/MinGW/mingw64/bin/gcc.exe',['-std=c99','-O2','-Wall','-Wextra','-Werror','-Wno-unused-function','-I',include,...args]);}
for(const precision of ['float','double']) {
 const flags=precision==='double'?['-DE5_USE_DOUBLE']:[],obj=path.join(output,'r2_'+precision+'.o');compile([...flags,'-c',path.join(dir,'r2_wrapper.c'),'-o',obj],r2);
 for(const disabled of [false,true]) {const exe=path.join(output,'sync_'+precision+(disabled?'_disabled':'')+'.exe');compile([...flags,...(disabled?['-DDIAG_SYNC_RATE_LEARNING=0']:[]),path.join(dir,'test_sync_rate.c'),obj,'-lm','-o',exe]);const result=call(exe,[]).trim();tests.push({precision,disabled,result});console.log(tests.at(-1));}
 const exe=path.join(output,'adapter_'+precision+'.exe');compile([...flags,path.resolve(dir,'../projection_round06_20261012/test_adapter.c'),path.join(task,'blnn_core.c'),'-lm','-o',exe]);const result=call(exe,[]).trim();tests.push({precision,type:'original allocator safety regression',result});console.log(tests.at(-1));
}
const variants=[];
for(const [name,source,method,flags,inc]of [['BLNN',path.join(task,'blnn_core.c'),11,[],task],['S3R2',path.join(r2,'blnn_core.c'),12,[],r2],['S3R10',path.join(task,'blnn_core.c'),12,[],task],['S3R10_DISABLED',path.join(task,'blnn_core.c'),12,['-DDIAG_SYNC_RATE_LEARNING=0'],task]]){
 const exe=path.join(output,name+'_plant.exe');compile(['-DTEST_METHOD='+method,...flags,path.resolve(dir,'../sync_priority_round22_20261013/test_plant.c'),source,'-lm','-o',exe],inc);const result=call(exe,[]).trim().split(/\r?\n/).map(s=>JSON.parse(s));fs.writeFileSync(path.join(output,name+'_assumed.json'),JSON.stringify(result));variants.push({name,result});console.log({name,complete:result.filter(r=>r.type==='result'&&r.complete).length,total:36});
}
assert.deepEqual(variants[1].result,variants[3].result,'Disabled candidate must restore S3R2 exactly');
const rows=variants.map(x=>({name:x.name,rows:x.result.filter(r=>r.type==='result')}));const newFailures=rows[2].rows.filter((r,i)=>rows[1].rows[i].complete&&!r.complete).map(r=>r.case);
const common=rows[0].rows.filter((r,i)=>r.complete&&rows[1].rows[i].complete&&rows[2].rows[i].complete).map(r=>r.case);const mean=(a,k)=>a.reduce((s,v)=>s+v[k],0)/a.length;
const performance=rows.map(x=>{const a=x.rows.filter(r=>common.includes(r.case));return{name:x.name,n:a.length,track:mean(a,'partialTrackingRMSE_mm'),sync:mean(a,'partialSyncRMS_mm')};});
for(const [p,h]of Object.entries(preserved))assert.equal(hash(p),h,'Preserved file changed');
const sources=Object.fromEntries(walk(path.dirname(task)).filter(p=>/\.(c|h|s|uvprojx)$/.test(p)).map(p=>[p,hash(p)]));
const result={tests,summary:rows.map(x=>({name:x.name,complete:x.rows.filter(r=>r.complete).length,total:36})),newFailures,performance,preserved,sources,allPassed:newFailures.length===0,assumedModelIdentified:false,physicalEfficacyProven:false,onBoardTimingMeasured:false};
fs.writeFileSync(path.join(output,'verification.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({summary:result.summary,newFailures,performance,allPassed:result.allPassed},null,2));assert.equal(newFailures.length,0,'Regression: do not flash');
