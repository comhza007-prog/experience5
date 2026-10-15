import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
const dir=path.dirname(fileURLToPath(import.meta.url));const output=path.join(dir,'audit_results.json');assert(!fs.existsSync(output));
const r=spawnSync('C:/Users/ele/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe',['-X','utf8',path.join(dir,'audit.py')],
 {cwd:dir,encoding:'utf8',env:{...process.env,PYTHONUTF8:'1',PATH:'D:/MinGW/mingw64/bin;'+process.env.PATH},maxBuffer:3e6});
if(r.status!==0){fs.writeFileSync(path.join(dir,'failure.txt'),r.stdout+r.stderr,{flag:'wx'});throw Error(r.stdout+r.stderr);}
const result=JSON.parse(r.stdout);assert(!result.S3R2DataRead&&result.modelsFitted===0);
fs.writeFileSync(output,JSON.stringify(result,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({cases:result.fixedCouplingKnockouts.map(({nativeModeledPositions_m,...r})=>r),sensor:result.sensorConditionalChecks,RPMProbe:result.RPMDependencyProbe,fixture:result.symmetricCommonModeFixtureMaxDifference_m},null,2));
