import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const dir=path.dirname(fileURLToPath(import.meta.url)),root=path.resolve(dir,'../..');
const proof=JSON.parse(fs.readFileSync(path.join(dir,'physical_run01_analysis.json'),'utf8'));
assert(proof.baselineReplayPassed&&proof.sourceKind==='PHYSICAL_SERIAL_SNAPSHOT');
const task=path.join(root,'05_实验代码/自动监视_故障保留回放_20261014/eassy_E5REPLAY2_A_S3R2_HW6/Task');
const env={...process.env,PATH:'D:/MinGW/mingw64/bin;'+process.env.PATH};
const call=(cmd,args)=>spawnSync(cmd,args,{cwd:dir,env,encoding:'utf8'});
let r=call('D:/MinGW/mingw64/bin/gcc.exe',['-std=c99','-O2','-Wall','-Wextra','-Werror','-Wno-unused-function','-I',task,'audit_modal.c','-lm','-o','audit_modal.exe']);
assert.equal(r.status,0,r.stderr);r=call(path.join(dir,'audit_modal.exe'),[path.join(dir,'physical_run01_snapshot.bin')]);assert.equal(r.status,0,r.stderr);
fs.writeFileSync(path.join(dir,'physical_run01_modal_audit.csv'),r.stdout,{flag:'wx'});
const rows=r.stdout.trim().split(/\r?\n/).slice(1).map(l=>l.split(',').map(Number));assert.equal(rows.length,360);
const rate=rows.filter(v=>v[1]===1),details=rate.map(v=>{
 const fractions=[0,1].map(ch=>{const req=v[7+ch],actual=v[9+ch];return Math.abs(req)<=1e-6?null:Math.max(0,Math.min(1,actual/req));});
 return {ms:v[0],rho:v[3],fractions,actualLearning:v.slice(5,7),repair:v.slice(13,15)};
});
const mean=a=>a.length?a.reduce((s,v)=>s+v,0)/a.length:null;
const summary={source:proof.source,sourceSHA256:proof.sourceSHA256,window_ms:[5360,5719],steps:360,pureRateSteps:rate.length,
 requestMagnitudeSensitivity:[1e-6,1e-5,1e-4,1e-3].map(threshold=>({threshold,
  syncEligibleSteps:rate.filter(v=>Math.abs(v[8])>threshold).length,
  syncBelowCommonByPoint1Steps:rate.filter(v=>Math.abs(v[8])>threshold&&Math.max(0,Math.min(1,v[10]/v[8]))<v[3]-.1).length,
  syncOppositeDirectionSteps:rate.filter(v=>Math.abs(v[8])>threshold&&v[8]*v[10]<0).length})),
 modalDirectionOrAdmissionMismatchSteps:rate.filter(v=>v[7]*v[9]<0||v[8]*v[10]<0).length,
 modalFractionMean:[0,1].map(ch=>mean(details.map(v=>v.fractions[ch]).filter(v=>v!==null))),
 commonRhoMean:mean(details.map(v=>v.rho)),
 fractionAboveCommonByPoint1Steps:[0,1].map(ch=>details.filter(v=>v.fractions[ch]!==null&&v.fractions[ch]>v.rho+.1).length),
 fractionBelowCommonByPoint1Steps:[0,1].map(ch=>details.filter(v=>v.fractions[ch]!==null&&v.fractions[ch]<v.rho-.1).length),
 definition:'Modal admitted fractions are exploratory force-coordinate ratios, clipped0..1; exclude request<=1e-6. Not an energy/stability certificate or delivered torque measurement.',
 prospectiveHypothesis:'Only if modal admission differs: investigate separate translation/sync learning admission in pure-rate states while retaining all output guards; no gains changed or hardware candidate released.',
 localDiagnosticsOnly:true,closedLoopBenefitProven:false,details};
fs.writeFileSync(path.join(dir,'physical_run01_modal_audit.json'),JSON.stringify(summary,null,2),{flag:'wx'});
console.log(JSON.stringify({...summary,details:undefined},null,2));
