import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const dir=path.dirname(fileURLToPath(import.meta.url));
const r=spawnSync('C:/Users/ele/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe',['-X','utf8',path.join(dir,'audit.py')],{cwd:dir,env:{...process.env,PYTHONUTF8:'1'},encoding:'utf8',maxBuffer:5e6});
if(r.status!==0){fs.writeFileSync(path.join(dir,'failed_attempt.txt'),r.stdout+'\n'+r.stderr,{flag:'wx'});throw new Error(r.stderr);}
const data=JSON.parse(r.stdout);assert(data.modelsFitted===0&&data.controlOrRawChanged===false&&data.newPhysicalRunReleased===false);
fs.writeFileSync(path.join(dir,'audit_results.json'),JSON.stringify(data,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(data,null,2));
