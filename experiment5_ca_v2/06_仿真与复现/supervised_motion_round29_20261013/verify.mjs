import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import crypto from 'node:crypto';import {spawnSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
const dir=path.dirname(fileURLToPath(import.meta.url)),root=path.resolve(dir,'../../..');
const task=path.join(root,'experiment5_ca_v2/05_实验代码/自动监视_受控S3R2_20261013/eassy_E5SUP_A_S3R2_HW6/Task');
const r2=path.join(root,'experiment5_ca_v2/05_实验代码/S3R2_静止跟踪保持_20261013/eassy_E5R2_A_S3R2_HW6/Task');
const out=path.join(dir,process.argv[2]||'checks01');assert(!fs.existsSync(out));fs.mkdirSync(out);
const hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
for(const f of ['blnn_core.h','experiment5_ca_actuator.h','experiment5_formal_actuator.h','experiment5_motion.h','experiment5_hw_profile.h','periodic_release.h'])assert.equal(hash(path.join(task,f)),hash(path.join(r2,f)));
assert.equal(hash(path.join(dir,'r2_core.inc')),hash(path.join(r2,'blnn_core.c')));
const env={...process.env,PATH:'D:/MinGW/mingw64/bin;'+process.env.PATH},tests=[];
function run(exe,args){let r=spawnSync(exe,args,{env,encoding:'utf8',maxBuffer:2e6});assert.equal(r.status,0,r.stderr+r.stdout);return r.stdout.trim();}
function compile(args){run('D:/MinGW/mingw64/bin/gcc.exe',['-std=c99','-O2','-Wall','-Wextra','-Werror','-Wno-unused-function','-I',task,...args]);}
for(const precision of ['float','double']) {
 const flags=precision==='double'?['-DE5_USE_DOUBLE']:[],exe=path.join(out,'online_'+precision+'.exe');
 compile([...flags,path.join(dir,'test_online.c'),path.join(dir,'r2_wrapper.c'),'-lm','-o',exe]);
 tests.push({precision,result:run(exe,[])});console.log(tests.at(-1));
 const adapter=path.join(out,'adapter_'+precision+'.exe');compile([...flags,path.resolve(dir,'../projection_round06_20261012/test_adapter.c'),path.join(task,'blnn_core.c'),path.join(dir,'params_stub.c'),'-lm','-o',adapter]);
 tests.push({precision,type:'adapter',result:run(adapter,[])});console.log(tests.at(-1));
}
fs.writeFileSync(path.join(out,'verification.json'),JSON.stringify({tests,passed:true,defaultExactlyR2:true,motionEnabled:true,explicitArmRequired:true,prepareExpiry_ms:1000,watchdog_ms:1000,onBoardCommunicationVerified:false,onBoardTimingMeasured:false,physicalPerformanceProven:false},null,2));
