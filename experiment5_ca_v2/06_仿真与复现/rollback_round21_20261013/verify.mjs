import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
const dir=path.dirname(fileURLToPath(import.meta.url)),root=path.resolve(dir,'../../..');
const code=path.join(root,'experiment5_ca_v2/05_实验代码');
const task=path.join(code,'S3R8_恢复R2基线_20261013/eassy_E5R8_A_S3R8_HW6/Task');
const r2=path.join(code,'S3R2_静止跟踪保持_20261013/eassy_E5R2_A_S3R2_HW6/Task');
const out=path.join(dir,'checks01');assert(!fs.existsSync(out));fs.mkdirSync(out);
const hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const control=['blnn_core.c','blnn_core.h','motor_task.c','diagnostic_config.h','experiment5_ca_actuator.h','experiment5_motion.h','experiment5_hw_profile.h','experiment5_formal_actuator.h','periodic_release.h','experiment5_formal_metrics.h'];
for(const f of control)assert.equal(hash(path.join(task,f)),hash(path.join(r2,f)),f);
const env={...process.env,PATH:'D:/MinGW/mingw64/bin;'+process.env.PATH},tests=[];
function call(exe,args){const r=spawnSync(exe,args,{env,encoding:'utf8',maxBuffer:30e6});assert.equal(r.status,0,r.stderr+'\n'+r.stdout);return r.stdout;}
function compile(args,include=task){call('D:/MinGW/mingw64/bin/gcc.exe',['-std=c99','-O2','-Wall','-Wextra','-Werror','-Wno-unused-function','-I',include,...args]);}
for(const precision of ['float','double']) {
 const flags=precision==='double'?['-DE5_USE_DOUBLE']:[],obj=path.join(out,'r2_'+precision+'.o');
 compile([...flags,'-c',path.resolve(dir,'../joint_budget_round20_20261013/r2_wrapper.c'),'-o',obj],r2);
 const exe=path.join(out,'exact_'+precision+'.exe');
 compile([...flags,'-DDIAG_JOINT_TRANSLATION=0',path.resolve(dir,'../joint_budget_round20_20261013/test_core.c'),path.join(task,'blnn_core.c'),obj,'-lm','-o',exe]);
 tests.push({precision,type:'90000 BASE/BLNN/CA exact R2 steps + sector checks',result:call(exe,[]).trim()});console.log(tests.at(-1));
 const adapter=path.join(out,'adapter_'+precision+'.exe');compile([...flags,path.resolve(dir,'../projection_round06_20261012/test_adapter.c'),path.join(task,'blnn_core.c'),'-lm','-o',adapter]);
 tests.push({precision,type:'original separate-sector allocator/core/AW',result:call(adapter,[]).trim()});console.log(tests.at(-1));
}
const exe=path.join(out,'trace.exe');compile([path.join(dir,'test_trace.c'),'-o',exe]);tests.push({type:'EVENT48/4430',result:call(exe,[]).trim()});console.log(tests.at(-1));
const prior=JSON.parse(fs.readFileSync(path.resolve(dir,'../joint_budget_round20_20261013/checks01/verification.json'),'utf8'));
for(const[p,h]of Object.entries(prior.preserved))assert.equal(hash(p),h,'Historical file changed');
const sources=Object.fromEntries(fs.readdirSync(task).filter(n=>fs.statSync(path.join(task,n)).isFile()).map(n=>[path.join(task,n),hash(path.join(task,n))]));
const result={build:67012,schema:4479,baseBuild:66312,tests,controlExactlyR2:true,ordinaryComparatorUnchanged:true,hostChecksPassed:true,allPassed:true,earlierFilesUnchanged:Object.keys(prior.preserved).length,sources,onBoardTimingMeasured:false,newPhysicalPerformanceMeasured:false,superiorityClaimed:false,automaticFlash:false,assumedModelRegression:'Core, allocator, motion, profile and finalization sources exactly R2; no new model performance claimed. R2 results remain 30/36 on the unidentified assumed model.'};
fs.writeFileSync(path.join(out,'verification.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({allPassed:true,controlExactlyR2:true,ordinaryComparatorUnchanged:true,earlierFilesUnchanged:result.earlierFilesUnchanged}));
