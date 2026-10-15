import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const dir=path.dirname(fileURLToPath(import.meta.url));
const pack=path.resolve(dir,'../../../实验5整理_20261011');
const originalTask=path.join(pack,'05_实验代码/正式对照_HW6_B/eassy_E5F_B_CA_BLNN_HW6/Task');
const result=JSON.parse(await fs.readFile(path.join(dir,'diagnosis.json'),'utf8'));
const env={...process.env,PATH:'D:/MinGW/mingw64/bin;'+process.env.PATH};
const records=result.runs.flatMap(run=>run.records.map(r=>({...r,lim:run.id[0]==='A'?[1200,1200]:[1200,800]})));
const input=records.map(r=>[...r.rpm,...r.wanted,...r.base,...r.actual,...r.lim,...r.sigma].join(' ')).join('\n')+'\n';
const checks=[];
for(const precision of ['float','double']){
  const exe=path.join(dir,'check_'+precision+'.exe');
  const compile=spawnSync('D:/MinGW/mingw64/bin/gcc.exe',[
    '-std=c99','-O2','-Wall','-Wextra','-Werror','-Wno-unused-function',
    ...(precision==='double'?['-DE5_USE_DOUBLE']:[]),'-I',originalTask,
    path.join(dir,'check_native.c'),'-o',exe],{env,encoding:'utf8'});
  assert.equal(compile.status,0,compile.stdout+compile.stderr);
  const native=spawnSync(exe,[],{input,env,encoding:'utf8',maxBuffer:2e6});
  assert.equal(native.status,0,native.stderr);
  const rows=native.stdout.trim().split(/\r?\n/).map(s=>s.split(' ').map(Number));
  assert.equal(rows.length,records.length);
  let robustSectorFrames=0,onlyProjectedRoundedSectorViolations=0;
  for(let i=0;i<rows.length;i++){
    const r=records[i],v=rows[i];assert.deepEqual(v.slice(0,2),r.target);
    assert.equal(Boolean(v[5]&&v[6]&&r.target.every(x=>Math.abs(x)<=300)),r.targetLegal);
    if(r.targetSectorStatus!=='uncertain'){
      assert.equal(Boolean(v[4]),r.targetSectorStatus==='pass');robustSectorFrames++;
    }
    if(r.mask===2&&v[4]===0)onlyProjectedRoundedSectorViolations++;
    if(r.category==='confirmed_pure_rate')assert.equal(v[4],1);
  }
  checks.push({precision,rows:rows.length,targetAndEnvelopeMatches:true,robustSectorFrames,
    robustSectorMatches:true,onlyProjectedRoundedSectorViolations});
}
for(const run of result.runs){
  assert(Object.values(run.active.mechanismConsistency).every(v=>v===0),run.id+' consistency');
}
const summary={frozenSourceNativeFunctions:true,checks,
  allMechanismChecksPassed:true,limitations:'Float/double native sector checks use rounded sigma; uncertain interval cases remain uncertain. This is not full allocator/history replay.'};
await fs.writeFile(path.join(dir,'verification.json'),JSON.stringify(summary,null,2),{flag:'wx'});
console.log(JSON.stringify(summary,null,2));
