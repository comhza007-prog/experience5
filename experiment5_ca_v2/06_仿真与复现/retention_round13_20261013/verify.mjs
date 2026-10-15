import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
const dir=path.dirname(fileURLToPath(import.meta.url)),root=path.resolve(dir,'../../..');
const task=path.join(root,'experiment5_ca_v2/05_实验代码/S3R2_静止跟踪保持_20261013/eassy_E5R2_A_S3R2_HW6/Task');
const r1=path.join(root,'experiment5_ca_v2/05_实验代码/S3R1_有界纠错_20261013/eassy_E5R1_A_S3R1_HW6/Task');
const out=path.join(dir,process.argv[2]||'checks01');assert(!fs.existsSync(out));fs.mkdirSync(out);
const hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const walk=p=>fs.readdirSync(p,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(p,e.name)):[path.join(p,e.name)]);
const preserved=Object.fromEntries([...walk(path.dirname(r1)),...walk(path.join(root,'experiment5_ca_v2/01_原始数据/S3R1_有界纠错_20261013')),...walk(path.join(root,'experiment5_ca_v2/01_原始数据/正式对照A_五方案_F5'))].map(p=>[p,hash(p)]));
for(const f of ['experiment5_ca_actuator.h','experiment5_motion.h','experiment5_hw_profile.h','experiment5_formal_actuator.h','periodic_release.h','experiment5_formal_metrics.h'])assert.equal(hash(path.join(task,f)),hash(path.join(r1,f)),'Unchanged controller/guard file altered');
assert.equal(hash(path.join(dir,'r1_core.inc')),hash(path.join(r1,'blnn_core.c')));
const env={...process.env,PATH:'D:/MinGW/mingw64/bin;'+process.env.PATH};const tests=[];
function call(exe,args){let r=spawnSync(exe,args,{env,encoding:'utf8',maxBuffer:30e6});assert.equal(r.status,0,r.stderr+'\n'+r.stdout);return r.stdout;}
function compile(args){return call('D:/MinGW/mingw64/bin/gcc.exe',['-std=c99','-O2','-Wall','-Wextra','-Werror','-Wno-unused-function','-I',task,...args]);}
for(const p of ['float','double']) {
 const flags=p==='double'?['-DE5_USE_DOUBLE']:[],exe=path.join(out,'retention_'+p+'.exe');
 compile([...flags,path.join(dir,'test_retention.c'),path.join(dir,'r1_wrapper.c'),'-lm','-o',exe]);
 tests.push({precision:p,type:'R2 one-factor/eligibility/regression',result:call(exe,[]).trim()});
 const adapter=path.join(out,'adapter_'+p+'.exe');
 compile([...flags,path.resolve(dir,'../projection_round06_20261012/test_adapter.c'),path.join(task,'blnn_core.c'),'-lm','-o',adapter]);
 tests.push({precision:p,type:'full allocator/core/AW regression',result:call(adapter,[]).trim()});
}
const assumed=[];
const traceExe=path.join(out,'trace.exe');compile([path.join(dir,'test_trace.c'),'-o',traceExe]);
tests.push({type:'R2 terminal EVENT48',result:call(traceExe,[]).trim()});
for(const [name,source,method,flags]of [['BLNN',path.join(task,'blnn_core.c'),11,[]],['S3R1',path.join(dir,'r1_core.inc'),12,[]],['S3R2',path.join(task,'blnn_core.c'),12,[]],['R2_DISABLED',path.join(task,'blnn_core.c'),12,['-DDIAG_TRACKING_RETENTION=0']]]) {
 const exe=path.join(out,name+'_plant.exe');compile(['-DTEST_METHOD='+method,...flags,path.join(dir,'test_plant.c'),'-x','c',source,'-lm','-o',exe]);
 const result=call(exe,[]).trim().split(/\r?\n/).map(s=>JSON.parse(s));
 fs.writeFileSync(path.join(out,name+'_assumed.json'),JSON.stringify(result));assumed.push({name,result});
}
assert.deepEqual(assumed[1].result,assumed[3].result,'Disabled R2 must exactly reproduce R1, including all36 failure outcomes and traces');
for(const [p,h]of Object.entries(preserved))assert.equal(hash(p),h,'Earlier code/raw changed');
const summary=assumed.map(v=>({name:v.name,complete:v.result.filter(r=>r.type==='result'&&r.complete).length,total:v.result.filter(r=>r.type==='result').length}));
const sources=Object.fromEntries(walk(path.dirname(task)).filter(p=>!p.includes(path.sep+'MDK-ARM'+path.sep)||p.endsWith('.uvprojx')).map(p=>[p,hash(p)]));
fs.writeFileSync(path.join(out,'verification.json'),JSON.stringify({date:'2026-10-13',tests,summary,retentionDisabledExactlyR1:true,preserved,sources,allPassed:true,onBoardTimingMeasured:false,superiorityProven:false,assumedModelIdentified:false},null,2));
console.log(JSON.stringify({tests,summary,retentionDisabledExactlyR1:true,allPassed:true,onBoardTimingMeasured:false,superiorityProven:false},null,2));
