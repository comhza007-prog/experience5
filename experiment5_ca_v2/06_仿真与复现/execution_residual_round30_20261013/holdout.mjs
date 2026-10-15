import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import crypto from 'node:crypto';import {spawnSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
const dir=path.dirname(fileURLToPath(import.meta.url)),task=path.join(dir,'core'),out=path.join(dir,'holdout01');assert(!fs.existsSync(out));fs.mkdirSync(out);
const env={...process.env,PATH:'D:/MinGW/mingw64/bin;'+process.env.PATH},hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
function call(exe,args){const r=spawnSync(exe,args,{env,encoding:'utf8',maxBuffer:40e6});assert.equal(r.status,0,r.stderr+r.stdout);return r.stdout;}
function compile(args){call('D:/MinGW/mingw64/bin/gcc.exe',['-std=c99','-O2','-Wall','-Wextra','-Werror','-Wno-unused-function','-I',task,...args]);}
const native=[];for(const precision of ['float','double'])for(const enabled of [false,true]){const exe=path.join(out,'native_'+precision+'_'+Number(enabled)+'.exe');compile([...(precision==='double'?['-DE5_USE_DOUBLE']:[]),'-DDIAG_EXECUTION_RESIDUAL='+Number(enabled),path.join(dir,'test_residual.c'),path.join(dir,'r2_wrapper.c'),'-lm','-o',exe]);native.push({precision,enabled,result:call(exe,[]).trim()});console.log(native.at(-1));}
const summaries=[],variants=[['BLNN',11,0],['S3R2',12,0],['RES_0_K5',12,1]],mean=(a,k)=>a.reduce((s,v)=>s+v[k],0)/a.length;
for(const stiffness of [1000,2000,3000])for(const noisePeriod of [17,23]) {
 const runs=[];
 for(const[name,method,enabled]of variants){const id=name+'_C'+stiffness+'_N'+noisePeriod,exe=path.join(out,id+'.exe');compile(['-DTEST_METHOD='+method,'-DDIAG_EXECUTION_RESIDUAL='+enabled,'-DDIAG_RESIDUAL_SCOPE=0','-DDIAG_RESIDUAL_GAIN=5','-DTEST_COUPLING_STIFFNESS='+stiffness,'-DTEST_NOISE_PERIOD='+noisePeriod,path.join(dir,'test_holdout.c'),path.join(task,'blnn_core.c'),'-lm','-o',exe]);const data=call(exe,[]).trim().split(/\r?\n/).map(s=>JSON.parse(s));fs.writeFileSync(path.join(out,id+'.json'),JSON.stringify(data));runs.push({name,rows:data.filter(r=>r.type==='result'),updates:data.filter(r=>r.type==='residual')});}
 const newFailures=runs[2].rows.filter((r,i)=>runs[1].rows[i].complete&&!r.complete).map(r=>r.case);
 const ids=runs[1].rows.filter((r,i)=>r.complete&&runs[0].rows[i].complete&&runs[2].rows[i].complete).map(r=>r.case);
 const metrics=runs.map(v=>{const a=v.rows.filter(r=>ids.includes(r.case));return{name:v.name,n:a.length,completed:v.rows.filter(r=>r.complete).length,track:mean(a,'partialTrackingRMSE_mm'),sync:mean(a,'partialSyncRMS_mm')};});
 const effects=runs[2].rows.filter(r=>ids.includes(r.case)).map(r=>({case:r.case,track:r.partialTrackingRMSE_mm-runs[1].rows.find(b=>b.case===r.case).partialTrackingRMSE_mm,sync:r.partialSyncRMS_mm-runs[1].rows.find(b=>b.case===r.case).partialSyncRMS_mm}));
 const summary={stiffness,noisePeriod,newFailures,metrics,syncChangeVsR2_pct:100*(metrics[2].sync/metrics[1].sync-1),trackingChangeVsR2_pct:100*(metrics[2].track/metrics[1].track-1),syncChangeVsBLNN_pct:100*(metrics[2].sync/metrics[0].sync-1),improvingCases:effects.filter(r=>r.sync<0).length,caseEffects:effects,extraUpdates:runs[2].updates.reduce((s,r)=>s+r.updates[0]+r.updates[1],0)};
 summaries.push(summary);console.log(JSON.stringify({...summary,caseEffects:undefined}));
}
const result={protocol:'holdout_protocol.json',candidateFrozen:'RES_0_K5',native,summaries,newFailureCount:summaries.reduce((s,r)=>s+r.newFailures.length,0),settingsWithMeanSyncBenefitVsR2:summaries.filter(r=>r.syncChangeVsR2_pct<0).length,settings:6,sourceSHA256:hash(path.join(task,'blnn_core.c')),assumedModelsIdentified:false,physicalBenefitProven:false,hardwareReleased:false};
result.robustScreenPassed=result.newFailureCount===0&&result.settingsWithMeanSyncBenefitVsR2>=4;
fs.writeFileSync(path.join(out,'verification.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({...result,native:undefined,summaries:undefined},null,2));
