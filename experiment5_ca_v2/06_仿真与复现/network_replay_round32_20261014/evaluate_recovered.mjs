import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const dir=path.dirname(fileURLToPath(import.meta.url)),root=path.resolve(dir,'../..');
const task=path.join(root,'05_实验代码/自动监视_网络回放_20261014/eassy_E5REPLAY_A_S3R2_HW6/Task');
const file=path.join(root,'01_原始数据/自动监视_网络回放_20261014/E5REPLAY_A_S3R2_B67612_HW6_STATE360_L1200_R1200_M0g_S2mm_run01_ram.bin');
const proof=JSON.parse(fs.readFileSync(path.join(dir,'ram_recovery_verification.json'),'utf8'));
assert(proof.doubleReadExact&&proof.cpuResetCommands===0&&proof.cpuHaltCommands===0&&proof.memoryWrites===0&&proof.controlRegisterWrites===0);
const bytes=fs.readFileSync(file),hash=crypto.createHash('sha256').update(bytes).digest('hex');assert.equal(hash,proof.sha256);assert.equal(bytes.length,39536);
const header=Array.from({length:10},(_,i)=>bytes.readUInt32LE(i*4));assert.deepEqual(header.slice(0,7),[1,67612,12,5348,48,80,360]);assert.equal(header[9],1000);
const env={...process.env,PATH:'D:/MinGW/mingw64/bin;'+process.env.PATH};
const call=(command,args)=>spawnSync(command,args,{cwd:dir,env,encoding:'utf8'});
let r=call('D:/MinGW/mingw64/bin/gcc.exe',['-std=c99','-O2','-Wall','-Wextra','-Werror','-Wno-unused-function','-I',task,'test_replay.c','-lm','-o','test_replay.exe']);assert.equal(r.status,0,r.stderr);
r=call(path.join(dir,'test_replay.exe'),[file]);
const result={file,sha256:hash,header,recoveryProof:'ram_recovery_verification.json',sourceKind:'EARLY_IMMUTABLE_SNAPSHOT_FROM_FAILED512_PHYSICAL_RUN',
 physicalRunComplete:false,physicalFault:512,baselineReplayPassed:r.status===0,baselineOutput:r.stdout+r.stderr,
 ablations:[],closedLoopCounterfactual:false,performanceBenefitProven:false};
if(r.status!==0){
 result.finding='Baseline native replay did not reproduce saved physical state within unchanged validation rules; no ablation interpretation permitted. Investigate source,ABI or floating implementation without loosening checks.';
 fs.writeFileSync(path.join(dir,'recovered_snapshot_analysis.json'),JSON.stringify(result,null,2));
 console.log(JSON.stringify(result,null,2));process.exitCode=1;
}else{
 const protocol=JSON.parse(fs.readFileSync(path.join(dir,'ablation_protocol.json'),'utf8')),branches=[];
 for(const v of protocol.variants){
  const exe=v.name+'.exe';r=call('D:/MinGW/mingw64/bin/gcc.exe',['-std=c99','-O2','-Wall','-Wextra','-Wno-unused-function','-I',task,...['DIAG_NEW_LEARNING','DIAG_BOUNDED_REPAIR','DIAG_TRACKING_RETENTION'].map(k=>'-D'+k+'='+v[k]),'replay_ablation.c','-lm','-o',exe]);assert.equal(r.status,0,r.stderr);
  r=call(path.join(dir,exe),[file]);assert.equal(r.status,0,r.stderr);
  const lines=r.stdout.trim().split(/\r?\n/),columns=lines.shift().split(','),data=lines.map(l=>l.split(',').map(Number));assert.equal(data.length,360);assert(data.every(row=>row.length===15&&row.every(Number.isFinite)));
  fs.writeFileSync(path.join(dir,'recovered_run01_'+v.name+'.csv'),r.stdout);branches.push({variant:v.name,columns,data});
 }
 const baseline=branches[0].data,mean=a=>a.reduce((s,v)=>s+v,0)/a.length;
 assert.deepEqual(baseline,branches.find(b=>b.variant==='retention_off').data,'Moving reference retention must have no effect');
 for(const b of branches){
  assert.deepEqual(b.data[0].slice(0,3),baseline[0].slice(0,3));
  result.ablations.push({variant:b.variant,steps:b.data.length,changedCommandSteps:b.data.filter((row,i)=>row[5]!==baseline[i][5]||row[6]!==baseline[i][6]).length,
   changedLearningSteps:b.data.filter((row,i)=>row[3]!==baseline[i][3]||row[4]!==baseline[i][4]).length,
   meanActualModalLearning:[mean(b.data.map(row=>row[3])),mean(b.data.map(row=>row[4]))],
   repairSteps:[b.data.filter(row=>row[11]===1).length,b.data.filter(row=>row[12]===1).length],
   pureRateSteps:b.data.filter(row=>row[10]===1).length,
   nominalFreezeSteps:b.data.filter(row=>row[3]===0&&row[4]===0).length,
   finalNodes:b.data.at(-1).slice(13,15)});
 }
 result.finding='Baseline physical learning snapshot replay validated; single-factor diagnostics show recorded-input rule effects only. Cannot infer alternate tracking or sync RMSE, full-trajectory stability or efficacy. Original512 failure retained.';
 fs.writeFileSync(path.join(dir,'recovered_snapshot_analysis.json'),JSON.stringify(result,null,2));
 console.log(JSON.stringify({...result,baselineOutput:result.baselineOutput.trim()},null,2));
}
