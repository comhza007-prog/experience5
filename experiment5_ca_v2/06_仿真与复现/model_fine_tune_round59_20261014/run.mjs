import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';import {fileURLToPath} from 'node:url';
const dir=path.dirname(fileURLToPath(import.meta.url));
const child=spawn('C:/Users/ele/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe',['-X','utf8',path.join(dir,'tune.py')],{env:{...process.env,PYTHONUTF8:'1'},stdio:['ignore','pipe','pipe']});
let output='',diagnostics='';child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');
child.stdout.on('data',s=>{output+=s;});
child.stderr.on('data',s=>{diagnostics+=s;process.stdout.write(s);});
const status=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',resolve);});
fs.writeFileSync(path.join(dir,'run_log_solverfix.txt'),diagnostics,{flag:'wx'});
assert.equal(status,0,diagnostics);
const result=JSON.parse(output);
fs.writeFileSync(path.join(dir,'tuning_verification_final.json'),JSON.stringify(result,null,2),{flag:'wx'});
console.log(JSON.stringify({selected:result.selected,trainingChanges:result.trainingChanges,crossMethodChanges:result.crossMethodChanges,
  crossMethodCheckCompleted:result.selectedCrossMethodRollout.completed,hardwareAction:false,counterfactualClosedLoopAdmitted:false},null,2));
