import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const dir=path.dirname(fileURLToPath(import.meta.url));
const r=spawnSync('C:/Users/ele/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe',['-X','utf8',path.join(dir,'test_candidate.py')],{cwd:dir,env:{...process.env,PYTHONUTF8:'1'},encoding:'utf8',maxBuffer:1e6});
if(r.status!==0){fs.writeFileSync(path.join(dir,'candidate_test_failure.txt'),r.stdout+'\n'+r.stderr,{flag:'wx'});throw new Error(r.stderr);}
const data=JSON.parse(r.stdout);assert(data.passed&&data.nineActiveSetImplicitCoulombCoreReady&&!data.modelIdentified&&!data.wholeTaskSimulationValidated);
fs.writeFileSync(path.join(dir,'candidate_core_verification.json'),JSON.stringify(data,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(data,null,2));
