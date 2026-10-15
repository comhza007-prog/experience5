import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const dir=path.dirname(fileURLToPath(import.meta.url));
const c=spawnSync('D:/MinGW/mingw64/bin/gcc.exe',['-std=c99','-O3','-Wall','-Wextra','-Werror','-shared','-static-libgcc','native_model.c','-lm','-o','native_model.dll'],{cwd:dir,encoding:'utf8',env:{...process.env,PATH:'D:/MinGW/mingw64/bin;'+process.env.PATH}});
assert.equal(c.status,0,c.stdout+c.stderr);
const r=spawnSync('C:/Users/ele/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe',['-X','utf8',path.join(dir,'fit.py')],{cwd:dir,env:{...process.env,PYTHONUTF8:'1',PATH:'D:/MinGW/mingw64/bin;'+process.env.PATH},encoding:'utf8',maxBuffer:10e6});
if(r.status!==0){fs.writeFileSync(path.join(dir,'failed_attempt.txt'),r.stdout+'\n'+r.stderr,{flag:'wx'});throw new Error(r.stderr);}
const data=JSON.parse(r.stdout);assert(data.fit.modelHypothesesFitted===1&&!data.fit.S3R2DataRead&&!data.rawOrControllerChanged&&!data.hardwareAction);
fs.writeFileSync(path.join(dir,'candidate_fit_results.json'),JSON.stringify(data,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({...data,allOptimizationEvaluations:undefined},null,2));
