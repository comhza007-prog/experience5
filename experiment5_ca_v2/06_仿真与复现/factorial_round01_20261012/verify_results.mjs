import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import assert from 'node:assert/strict';import {spawnSync} from 'node:child_process';
const root=process.cwd(),dir=path.join(root,'experiment5_ca_v2/06_仿真与复现/factorial_round01_20261012'),dest=path.join(dir,'results_attempt02');
const data=JSON.parse(fs.readFileSync(path.join(dest,'diagnostic_results.json'),'utf8'));
const mean=x=>x.reduce((s,v)=>s+v,0)/x.length,rerun=[];
const env={...process.env,PATH:'D:/MinGW/mingw64/bin;'+(process.env.PATH||process.env.Path||'')};
for(const variant of data.variants){
 const saved=JSON.parse(fs.readFileSync(path.join(dest,'plant_'+variant.name+'.json'),'utf8'));
 const r=spawnSync(path.join(dir,'bin/plant_'+variant.name+'.exe'),[],{cwd:dir,env,encoding:'utf8',maxBuffer:32*1024*1024});assert.equal(r.status,0,r.stderr);
 const again=r.stdout.trim().split(/\r?\n/).map(l=>JSON.parse(l));
 // The saved JSON writer normalizes -0 to 0. Compare the same representation;
 // do not mistake a discarded zero sign bit for changed motion or commands.
 assert.ok(JSON.stringify(again)===JSON.stringify(saved),'Numeric JSON rerun differs: '+variant.name);
 for(let caseId=1;caseId<=36;caseId++){
  const end=saved.find(t=>t.type==='result'&&t.case===caseId),start=saved.find(t=>t.type==='start'&&t.case===caseId),tr=saved.filter(t=>t.type==='trace'&&t.case===caseId);
  assert.equal(end.complete,end.fault===0&&end.stop_ms===20000);assert.ok(tr.every((t,i)=>Math.abs(t.t-i*.04)<1e-12));
  assert.ok(tr.every(t=>t.commands.every((v,ch)=>Math.abs(v)<=(ch?start.right_limit:1200))));
  assert.ok(tr.every(t=>t.learning>=0&&t.learning<=1));
  if(variant.method===12){
   assert.ok(tr.every(t=>t.delta.every(v=>Math.abs(v)<=300)));
   if(variant.learning===0)assert.ok(tr.every(t=>t.mask===0||t.learning===0));
   else assert.ok(tr.every(t=>t.reason===1?t.learning<=t.rho+1e-6:(t.mask===0&&t.reason===0)||t.learning===0));
  }
  if(end.complete)assert.equal(tr.filter(t=>t.phase>=2&&t.phase<=5).length,400);
 }
 rerun.push({variant:variant.name,cases:36,allSavedRecordsIdentical:true});console.log(variant.name+': all 36 reruns and every saved trajectory point identical');
}
for(const m of data.matchedConfigurations){
 const cases=data.runs.filter(r=>r.case===m.case);assert.equal(cases.length,5);assert.ok(cases.every(r=>r.complete&&r.motionSamples===16000));
 const map=Object.fromEntries(cases.map(r=>[r.variant,r]));
 for(const k of ['trackingRMSE_mm','syncRMS_mm']){
  const actual=(map.D3[k]-map.D2[k])-(map.D1[k]-map.D0[k]);assert.ok(Math.abs(actual-m[k].interaction)<1e-14);
 }
}
for(const e of data.effects){const ms=data.matchedConfigurations.filter(m=>m.condition===e.condition);assert.equal(ms.length,e.nCompleteMatchedConfigurations);
 for(const k of ['trackingRMSE_mm','syncRMS_mm'])for(const v of data.variants)assert.ok(Math.abs(mean(ms.map(m=>m[k].values[v.name]))-e.metrics[k].mean[v.name])<1e-14);
}
const before=JSON.parse(fs.readFileSync(path.join(dest,'preservation_before.json'),'utf8'));
for(const [p,h] of Object.entries(before))assert.equal(crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex'),h);
const result={date:'2026-10-12',rerun,exactSavedTrajectoryRecords:true,zeroSignConvention:'JSON serialization normalizes negative zero; comparison is identical JSON numeric representation, not raw float sign bits',timestampTolerance_s:1e-12,all180OutcomesRetained:true,factorialEffectsRecomputed:true,summaryRecomputed:true,frozenFileHashesUnchanged:Object.keys(before).length,hardwareRuns:0,releaseDecision:'NOT_APPROVED_FOR_HARDWARE',limitation:'deterministic assumed-plant diagnostic; not identified hardware or independent holdout'};
fs.writeFileSync(path.join(dest,'rerun_verification.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
