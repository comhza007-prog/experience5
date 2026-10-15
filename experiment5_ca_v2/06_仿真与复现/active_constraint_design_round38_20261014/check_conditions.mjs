import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import crypto from 'node:crypto';import {spawnSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
const dir=path.dirname(fileURLToPath(import.meta.url)),root=path.resolve(dir,'../..'),task=path.join(dir,'core');
const out=path.join(dir,process.argv[2]||'checks01');assert(!fs.existsSync(out));fs.mkdirSync(out);
const hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const refTask=path.join(root,'05_实验代码/自动监视_故障保留回放_20261014/eassy_E5REPLAY2_A_S3R2_HW6/Task');
for(const file of fs.readdirSync(task))assert.equal(hash(path.join(task,file)),hash(path.join(refTask,file)));
const protocol=JSON.parse(fs.readFileSync(path.join(dir,'protocol.json'),'utf8'));
const env={...process.env,PATH:'D:/MinGW/mingw64/bin;'+process.env.PATH};
const call=(exe,args)=>{const r=spawnSync(exe,args,{env,encoding:'utf8',maxBuffer:50e6});assert.equal(r.status,0,(r.stderr||'')+'\n'+(r.stdout||''));return r.stdout;};
const all=[],mean=a=>a.length?a.reduce((s,v)=>s+v,0)/a.length:null;
for(const [name,method] of [['BLNN',11],['S3R2',12]]){
 const exe=path.join(out,name+'.exe');call('D:/MinGW/mingw64/bin/gcc.exe',['-std=c99','-O2','-Wall','-Wextra','-Werror','-Wno-unused-function','-I',task,'-DTEST_METHOD='+method,path.join(dir,'test_conditions.c'),path.join(task,'blnn_core.c'),'-lm','-o',exe]);
 const archive=JSON.parse(fs.readFileSync(path.join(root,'06_仿真与复现/sync_retention_round37_20261014/checks02',name+'_C2000_N19.json'),'utf8'));
 for(const c of protocol.predefinedConditions){
  const data=call(exe,c.limits.map(String)).trim().split(/\r?\n/).map(l=>JSON.parse(l));fs.writeFileSync(path.join(out,name+'_'+c.id+'.json'),JSON.stringify(data),{flag:'wx'});
  const rows=data.filter(r=>r.type==='result'),activity=data.filter(r=>r.type==='condition_activity');assert.equal(rows.length,18);assert.equal(activity.length,18);
  if(c.id==='A_REF')assert.deepEqual(rows,archive.filter(r=>r.type==='result').slice(0,18),'Unchanged benchmark drifted');
  const complete=rows.filter(r=>r.complete),completeIds=new Set(complete.map(r=>r.case));
  const result={name,method,condition:c,complete:complete.length,total:rows.length,failures:rows.filter(r=>!r.complete).map(r=>({case:r.case,fault:r.fault,stop_ms:r.stop_ms,terminalMax_mm:r.terminalMax_mm})),
   allOutcomesRetained:true,completeCaseHardClipActive:activity.filter(r=>completeIds.has(r.case)&&r.hardClipSteps>0).length,
   allCaseHardClipActive:activity.filter(r=>r.hardClipSteps>0).length,
   completeOnlyClipPct:mean(activity.filter(r=>completeIds.has(r.case)).map(r=>100*r.hardClipSteps/r.motionSteps)),
   completeOnlyTracking_mm:mean(complete.map(r=>r.partialTrackingRMSE_mm)),completeOnlySync_mm:mean(complete.map(r=>r.partialSyncRMS_mm)),
   survivorOnlyMeansNotEfficacyProof:true,activity};all.push(result);console.log(JSON.stringify({...result,activity:undefined}));
 }
}
const summary={protocolSHA256:hash(path.join(dir,'protocol.json')),coreSHA256:hash(path.join(task,'blnn_core.c')),baselineExactlyReproduced:true,originalCoreAndHeadersUnchanged:true,conditions:all,modelsIdentified:false,hardwareReleased:false,newCandidateSelected:false,interpretation:'Finite uncalibrated models for qualification planning, not hardware safety or benefit evidence. No condition chosen by favourable comparison; failed cases retained.'};
fs.writeFileSync(path.join(out,'verification.json'),JSON.stringify(summary,null,2),{flag:'wx'});
