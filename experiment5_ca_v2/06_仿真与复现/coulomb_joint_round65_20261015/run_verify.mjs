import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
const dir=path.dirname(fileURLToPath(import.meta.url));
const r=spawnSync('C:/Users/ele/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe',['-X','utf8',path.join(dir,'verify_prediction.py')],{cwd:dir,encoding:'utf8',env:{...process.env,PYTHONUTF8:'1',PATH:'D:/MinGW/mingw64/bin;'+process.env.PATH},maxBuffer:2e6});
assert.equal(r.status,0,r.stdout+r.stderr);const result=JSON.parse(r.stdout);assert(result.passed&&result.notIndependentPredictionValidation);
fs.writeFileSync(path.join(dir,'prediction_verification.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(result,null,2));
