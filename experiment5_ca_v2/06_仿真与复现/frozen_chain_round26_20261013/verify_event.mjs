import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {spawnSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
const dir=path.dirname(fileURLToPath(import.meta.url)),root=path.resolve(dir,'../../..'),task=path.join(root,'experiment5_ca_v2/05_实验代码/同期复核A_封存固件_20261013/01_R2/eassy_E5R2_A_S3R2_HW6/Task');
const diag=JSON.parse(fs.readFileSync(path.join(dir,'diagnosis.json'),'utf8')),env={...process.env,PATH:'D:/MinGW/mingw64/bin;'+process.env.PATH};
const exe=path.join(dir,'check_event_float.exe');let r=spawnSync('D:/MinGW/mingw64/bin/gcc.exe',['-std=c99','-O2','-Wall','-Wextra','-Werror','-Wno-unused-function','-I',task,path.join(dir,'check_event.c'),'-lm','-o',exe],{env,encoding:'utf8'});assert.equal(r.status,0,r.stderr);const results=[];
for(const run of diag.runs.filter(r=>r.method==='S3R2')) {
 const rows=fs.readFileSync(run.file,'utf8').trim().split(/\r?\n/).slice(1).map(l=>l.split(',').map(Number)),chunks=new Map();
 for(const r of rows.filter(r=>r[88]===4424&&r[89]===3))chunks.set(r[90]+':'+r[91],r.slice(96,104));
 const events=Array.from({length:128},(_,i)=>Array.from({length:6},(_,j)=>chunks.get(i+':'+j)).flat());
 const input=events.map(v=>[v[12],v[13],v[10],v[11],v[44],v[45],v[25],v[26],v[24],v[2],v[3],v[20],v[21]].join(' ')).join('\n')+'\n';
 r=spawnSync(exe,[],{env,encoding:'utf8',input});assert.equal(r.status,0,r.stderr);const computed=r.stdout.trim().split(/\r?\n/).map(l=>l.split(' ').map(Number));assert.equal(computed.length,128);
 const mismatch=events.flatMap((v,i)=>{const c=computed[i],deltaError=Math.max(Math.abs(c[0]-v[18]),Math.abs(c[1]-v[19]));return deltaError||c[2]!==v[22]||c[3]!==v[32]?[{ms:v[0],deltaError,recorded:v.slice(18,20),computed:c.slice(0,2),mask:[v[22],c[2]],reason:[v[32],c[3]]}]:[];});
 results.push({file:run.file,records:128,exactMatch:128-mismatch.length,mismatch,largeDeltaMismatch:mismatch.filter(v=>v.deltaError>1).length,interpretation:'Six-decimal float export causes ambiguous quantization/sector-boundary cases; this checks frozen allocation only, not network replay or closed-loop causality.'});
}
const out={results,rawDataReadOnly:true,previousDeltaIsActual1msEventMemory:true};fs.writeFileSync(path.join(dir,'event_verification.json'),JSON.stringify(out,null,2));console.log(JSON.stringify(out,null,2));
