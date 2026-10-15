import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
const dir=path.dirname(fileURLToPath(import.meta.url));
const r=spawnSync('C:/Users/ele/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe',['-X','utf8',path.join(dir,'joint.py')],{cwd:dir,encoding:'utf8',env:{...process.env,PYTHONUTF8:'1',PATH:'D:/MinGW/mingw64/bin;'+process.env.PATH},maxBuffer:10e6});
if(r.status!==0){fs.writeFileSync(path.join(dir,'failure.txt'),r.stdout+'\n'+r.stderr,{flag:'wx'});throw new Error(r.stderr);}
const data=JSON.parse(r.stdout);assert(data.ordinaryOnly&&!data.S3R2DataRead&&!data.rawOrControllerChanged&&!data.hardwareAction);
fs.writeFileSync(path.join(dir,'joint_fit_results.json'),JSON.stringify(data,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({...data,allCalibrationEvaluations:undefined},null,2));
