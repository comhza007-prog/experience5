import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import crypto from 'node:crypto';import {spawnSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
const dir=path.dirname(fileURLToPath(import.meta.url)),task=path.join(dir,'core'),out=path.join(dir,process.argv[2]||'protected01');assert(!fs.existsSync(out));fs.mkdirSync(out);
const env={...process.env,PATH:'D:/MinGW/mingw64/bin;'+process.env.PATH};
function call(exe,args){const r=spawnSync(exe,args,{env,encoding:'utf8',maxBuffer:40e6});assert.equal(r.status,0,r.stderr+r.stdout);return r.stdout;}
function compile(args){call('D:/MinGW/mingw64/bin/gcc.exe',['-std=c99','-O2','-Wall','-Wextra','-Werror','-Wno-unused-function','-I',task,...args]);}
const tests=[];for(const policy of [1,2])for(const precision of ['float','double']){const exe=path.join(out,'native_P'+policy+'_'+precision+'.exe');compile([...(precision==='double'?['-DE5_USE_DOUBLE']:[]),'-DDIAG_EXECUTION_RESIDUAL=1','-DDIAG_RESIDUAL_SCOPE=0','-DDIAG_RESIDUAL_GAIN=5','-DDIAG_RESIDUAL_POLICY='+policy,path.join(dir,'test_residual.c'),path.join(dir,'r2_wrapper.c'),'-lm','-o',exe]);tests.push({policy,precision,result:call(exe,[]).trim()});console.log(tests.at(-1));}
const summaries=[],mean=(a,k)=>a.reduce((s,r)=>s+r[k],0)/a.length;
for(const [stiffness,noisePeriod] of [[2000,19],...[1000,2000,3000].flatMap(c=>[17,23].map(n=>[c,n]))]) {
 const parent=noisePeriod===19?'checks02':'holdout01',suffix=noisePeriod===19?'':'_C'+stiffness+'_N'+noisePeriod;
 const old=['BLNN','S3R2'].map(name=>JSON.parse(fs.readFileSync(path.join(dir,parent,name+suffix+'.json'))).filter(r=>r.type==='result'));
 for(const policy of [1,2]) {
  const id='P'+policy+'_C'+stiffness+'_N'+noisePeriod,exe=path.join(out,id+'.exe');compile(['-DTEST_METHOD=12','-DDIAG_EXECUTION_RESIDUAL=1','-DDIAG_RESIDUAL_SCOPE=0','-DDIAG_RESIDUAL_GAIN=5','-DDIAG_RESIDUAL_POLICY='+policy,'-DTEST_COUPLING_STIFFNESS='+stiffness,'-DTEST_NOISE_PERIOD='+noisePeriod,path.join(dir,'test_holdout.c'),path.join(task,'blnn_core.c'),'-lm','-o',exe]);
  const data=call(exe,[]).trim().split(/\r?\n/).map(s=>JSON.parse(s));fs.writeFileSync(path.join(out,id+'.json'),JSON.stringify(data));const rows=data.filter(r=>r.type==='result');
  const newFailures=rows.filter((r,i)=>old[1][i].complete&&!r.complete).map(r=>r.case),ids=old[1].filter((r,i)=>r.complete&&old[0][i].complete&&rows[i].complete).map(r=>r.case);
  const a=rows.filter(r=>ids.includes(r.case)),b=old[1].filter(r=>ids.includes(r.case)),o=old[0].filter(r=>ids.includes(r.case));
  const summary={policy,stiffness,noisePeriod,newFailures,n:ids.length,track:mean(a,'partialTrackingRMSE_mm'),sync:mean(a,'partialSyncRMS_mm'),trackingChangeVsR2_pct:100*(mean(a,'partialTrackingRMSE_mm')/mean(b,'partialTrackingRMSE_mm')-1),syncChangeVsR2_pct:100*(mean(a,'partialSyncRMS_mm')/mean(b,'partialSyncRMS_mm')-1),syncChangeVsOrdinary_pct:100*(mean(a,'partialSyncRMS_mm')/mean(o,'partialSyncRMS_mm')-1),applications:data.filter(r=>r.type==='residual').reduce((s,r)=>s+r.updates[0]+r.updates[1],0)};
  summaries.push(summary);console.log(JSON.stringify(summary));
 }
}
const decisions=[1,2].map(policy=>{const a=summaries.filter(r=>r.policy===policy),base=a.find(r=>r.noisePeriod===19),holdout=a.filter(r=>r.noisePeriod!==19);return{policy,newFailures:a.reduce((s,r)=>s+r.newFailures.length,0),baseSyncBenefit:base.syncChangeVsR2_pct<0,holdoutBenefitSettings:holdout.filter(r=>r.syncChangeVsR2_pct<0).length,settings:6,robustScreenPassed:a.every(r=>r.newFailures.length===0)&&base.syncChangeVsR2_pct<0&&holdout.filter(r=>r.syncChangeVsR2_pct<0).length>=4};});
const result={protocol:'protected_protocol.json',tests,summaries,decisions,sourceSHA256:crypto.createHash('sha256').update(fs.readFileSync(path.join(task,'blnn_core.c'))).digest('hex'),hardGuardsUnchanged:true,modelsIdentified:false,hardwareReleased:false,physicalBenefitProven:false};
fs.writeFileSync(path.join(out,'verification.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({decisions,hardwareReleased:false},null,2));
