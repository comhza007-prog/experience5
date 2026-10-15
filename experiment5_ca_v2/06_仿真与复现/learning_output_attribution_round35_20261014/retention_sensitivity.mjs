import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const dir=path.dirname(fileURLToPath(import.meta.url)),task=path.join(dir,'core'),out=path.join(dir,'retention_sensitivity01');
assert(!fs.existsSync(out));fs.mkdirSync(out);
const initial=JSON.parse(fs.readFileSync(path.join(dir,'checks02/verification.json'),'utf8'));
assert(initial.R2AndOrdinaryBaselineExactlyReproduced&&initial.copiedHeadersUnchanged);
const hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');assert.equal(hash(path.join(task,'blnn_core.c')),initial.sourceSHA256);
const env={...process.env,PATH:'D:/MinGW/mingw64/bin;'+process.env.PATH};
const call=(cmd,args)=>{const r=spawnSync(cmd,args,{env,encoding:'utf8',maxBuffer:40e6});assert.equal(r.status,0,r.stderr+r.stdout);return r.stdout;};
const variants=[{name:'BLNN',method:11,retention:1},{name:'S3R2',method:12,retention:1},{name:'NO_RETENTION_ABLATION',method:12,retention:0}];
const mean=(rows,k)=>rows.length?rows.reduce((s,r)=>s+r[k],0)/rows.length:null;
const settings=[];
for(const stiffness of [1000,2000,3000])for(const noise of [17,23]){
 const runs=[];
 for(const v of variants){
  const id=v.name+'_C'+stiffness+'_N'+noise,exe=path.join(out,id+'.exe');
  call('D:/MinGW/mingw64/bin/gcc.exe',['-std=c99','-O2','-Wall','-Wextra','-Werror','-Wno-unused-function','-I',task,
   '-DTEST_METHOD='+v.method,'-DE5_DIAG_PLAIN_LEARNING=0','-DDIAG_BOUNDED_REPAIR=1','-DDIAG_TRACKING_RETENTION='+v.retention,
   '-DTEST_COUPLING_STIFFNESS='+stiffness,'-DTEST_NOISE_PERIOD='+noise,path.join(dir,'test_plant.c'),path.join(task,'blnn_core.c'),'-lm','-o',exe]);
  const raw=call(exe,[]),data=raw.trim().split(/\r?\n/).map(l=>JSON.parse(l));fs.writeFileSync(path.join(out,id+'.json'),JSON.stringify(data));
  const rows=data.filter(r=>r.type==='result');assert.equal(rows.length,36);assert.deepEqual(rows.map(r=>r.case),Array.from({length:36},(_,i)=>i+1));runs.push({...v,rows});
 }
 const baseline=runs[1],ordinary=runs[0],population=baseline.rows.filter((r,i)=>r.complete&&ordinary.rows[i].complete).map(r=>r.case);
 const metrics=runs.map(v=>{
  const rows=v.rows.filter(r=>population.includes(r.case)),failed=rows.filter(r=>!r.complete).map(r=>r.case);
  return {name:v.name,completed:v.rows.filter(r=>r.complete).length,baselinePopulationN:population.length,
   failedPopulationCases:failed,newFailures:v.rows.filter((r,i)=>baseline.rows[i].complete&&!r.complete).map(r=>({case:r.case,fault:r.fault,stop_ms:r.stop_ms,terminalMax_mm:r.terminalMax_mm})),
   track:failed.length?null:mean(rows,'partialTrackingRMSE_mm'),sync:failed.length?null:mean(rows,'partialSyncRMS_mm')};
 });
 const b=metrics[1],a=metrics[2],o=metrics[0];
 const entry={stiffness,noise,baselinePopulationCases:population,metrics,
  syncChangeVsR2_pct:a.sync===null?null:100*(a.sync/b.sync-1),trackingChangeVsR2_pct:a.track===null?null:100*(a.track/b.track-1),
  syncChangeVsOrdinary_pct:a.sync===null?null:100*(a.sync/o.sync-1)};
 settings.push(entry);console.log(JSON.stringify({...entry,baselinePopulationCases:undefined}));
 fs.writeFileSync(path.join(out,'progress.json'),JSON.stringify({settings,complete:false,hardwareReleased:false},null,2));
}
const result={protocol:'retention_sensitivity_protocol.json',sourceSHA256:initial.sourceSHA256,settings,
 totalCaseOutcomes:settings.length*36*variants.length,
 newFailureInstances:settings.reduce((s,h)=>s+h.metrics[2].newFailures.length,0),
 settingsWithSyncGainVsR2:settings.filter(h=>h.syncChangeVsR2_pct!==null&&h.syncChangeVsR2_pct<0).length,
 settingsWithSyncGainVsOrdinary:settings.filter(h=>h.syncChangeVsOrdinary_pct!==null&&h.syncChangeVsOrdinary_pct<0).length,
 allOutcomesRetained:true,modelsIdentified:false,physicalBenefitProven:false,newInnovation:false,hardwareReleased:false};
fs.writeFileSync(path.join(out,'verification.json'),JSON.stringify(result,null,2));
console.log(JSON.stringify({...result,settings:undefined},null,2));
