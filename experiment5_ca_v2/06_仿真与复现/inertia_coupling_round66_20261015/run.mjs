import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
const dir=path.dirname(fileURLToPath(import.meta.url));
const mode=process.argv[2];assert(['test','fit','verify'].includes(mode));
const names={test:['test_solver.py','solver_verification.json'],fit:['fit.py','fit_results.json'],verify:['verify_prediction.py','prediction_verification.json']};
const [script,output]=names[mode];assert(!fs.existsSync(path.join(dir,output)),'Refusing to overwrite completed round');
const r=spawnSync('C:/Users/ele/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe',['-X','utf8',path.join(dir,script)],
 {cwd:dir,encoding:'utf8',env:{...process.env,PYTHONUTF8:'1',PATH:'D:/MinGW/mingw64/bin;'+process.env.PATH},maxBuffer:8e6});
if(r.status!==0){fs.writeFileSync(path.join(dir,mode+'_failure.txt'),r.stdout+r.stderr,{flag:'wx'});throw Error(r.stdout+r.stderr);}
const result=JSON.parse(r.stdout);assert(mode==='fit'||result.passed);
fs.writeFileSync(path.join(dir,output),JSON.stringify(result,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(mode==='fit'?{fit:result.fit,massEigenvalues:result.massEigenvalues,boundHits:result.numericalBoundHits,previews:result.continuous20sTrainingPreviews,stress:result.holdOrderingNative40msDifference}:result,null,2));
