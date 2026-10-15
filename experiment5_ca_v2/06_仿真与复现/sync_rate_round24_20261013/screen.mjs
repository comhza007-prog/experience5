import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {spawnSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
const dir=path.dirname(fileURLToPath(import.meta.url)),root=path.resolve(dir,'../../..'),task=path.join(root,'experiment5_ca_v2/05_实验代码/S3R10_纯变化率同步学习_20261013/eassy_E5R10_A_S3R10_HW6/Task');
const output=path.join(dir,'scope_screen');assert(!fs.existsSync(output));fs.mkdirSync(output);
const baseline=JSON.parse(fs.readFileSync(path.join(dir,'checks03/S3R2_assumed.json'),'utf8')).filter(r=>r.type==='result');
const env={...process.env,PATH:'D:/MinGW/mingw64/bin;'+process.env.PATH},summary=[];
for(const scope of [0,1,2]) {
 const exe=path.join(output,'scope'+scope+'.exe');let r=spawnSync('D:/MinGW/mingw64/bin/gcc.exe',['-std=c99','-O2','-Wall','-Wextra','-Werror','-Wno-unused-function','-I',task,'-DTEST_METHOD=12','-DDIAG_SYNC_RATE_SCOPE='+scope,path.resolve(dir,'../sync_priority_round22_20261013/test_plant.c'),path.join(task,'blnn_core.c'),'-lm','-o',exe],{env,encoding:'utf8'});assert.equal(r.status,0,r.stderr);
 r=spawnSync(exe,[],{env,encoding:'utf8',maxBuffer:35e6});assert.equal(r.status,0,r.stderr);const all=r.stdout.trim().split(/\r?\n/).map(s=>JSON.parse(s)),rows=all.filter(r=>r.type==='result');fs.writeFileSync(path.join(output,'scope'+scope+'.json'),JSON.stringify(all));
 const matched=rows.filter((r,i)=>r.complete&&baseline[i].complete),old=baseline.filter((r,i)=>r.complete&&rows[i].complete),mean=(a,k)=>a.reduce((s,v)=>s+v[k],0)/a.length;
 const item={scope,positionSupport:true,complete:rows.filter(r=>r.complete).length,newFailures:rows.filter((r,i)=>baseline[i].complete&&!r.complete).map(r=>r.case),n:matched.length,track:mean(matched,'partialTrackingRMSE_mm'),sync:mean(matched,'partialSyncRMS_mm'),baseTrack:mean(old,'partialTrackingRMSE_mm'),baseSync:mean(old,'partialSyncRMS_mm')};summary.push(item);console.log(JSON.stringify(item));
}
fs.writeFileSync(path.join(output,'summary.json'),JSON.stringify({summary,assumedModelIdentified:false,exploratoryDevelopmentOnly:true,notValidationOrHardwareEvidence:true},null,2));
