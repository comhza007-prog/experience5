// Re-run existing finite rule/property fixtures against the frozen MCU core.
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';
import crypto from 'node:crypto';import {spawnSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
const dir=path.dirname(fileURLToPath(import.meta.url)),root=path.resolve(dir,'../..');
const task=path.join(root,'05_实验代码/误差汇总40s_A_BLNN_S3R2_20261014/01_R2/eassy_E5R2_A_S3R2_HW6/Task');
const old=path.join(root,'06_仿真与复现/retention_round13_20261013');
const env={...process.env,PATH:'D:/MinGW/mingw64/bin;'+process.env.PATH};
const sha=f=>crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const sourceHash=sha(path.join(task,'blnn_core.c'));
const tests=[];
function call(exe,args){const r=spawnSync(exe,args,{env,encoding:'utf8',maxBuffer:1e6});assert.equal(r.status,0,r.stderr+'\n'+r.stdout);return r.stdout.trim();}
for(const precision of ['float','double']) {
  const exe=path.join(dir,'checks02','properties_'+precision+'.exe');
  call('D:/MinGW/mingw64/bin/gcc.exe',['-std=c99','-O2','-Wall','-Wextra','-Werror','-Wno-unused-function','-I',task,
    ...(precision==='double'?['-DE5_USE_DOUBLE']:[]),path.join(old,'test_retention.c'),path.join(old,'r1_wrapper.c'),'-lm','-o',exe]);
  const result=call(exe,[]);assert(result.startsWith('PASS rejectionBoundaries=13;'));
  tests.push({precision,result});console.log(JSON.stringify(tests.at(-1)));
}
assert.equal(sha(path.join(task,'blnn_core.c')),sourceHash);
fs.writeFileSync(path.join(dir,'properties_verification.json'),JSON.stringify({tests,currentCoreSHA256:sourceHash,
  fixture:path.join(old,'test_retention.c'),fixtureSHA256:sha(path.join(old,'test_retention.c')),
  scope:'Finite synthetic boundaries/same-state regression. Not closed-loop theorem, physical efficacy orWCET.',
  noSourceChanges:true,noNewPhysicalRuns:true},null,2),{flag:'wx'});
