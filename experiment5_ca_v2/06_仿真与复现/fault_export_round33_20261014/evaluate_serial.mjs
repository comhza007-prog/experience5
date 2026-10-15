import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {decode} from './decode.mjs';
const dir=path.dirname(fileURLToPath(import.meta.url)),root=path.resolve(dir,'../..');
const synthetic=process.argv.includes('--synthetic');
const source=path.resolve(process.argv[2]);
const prefix=synthetic?'synthetic_ablation':'physical_run01';
const report=path.join(dir,prefix+'_analysis.json');
assert(!fs.existsSync(report),'Preserve existing analysis; no silent overwrite');
const raw=fs.readFileSync(source),lines=raw.toString('utf8').trim().split(/\r?\n/);
assert.equal(lines.shift(),Array.from({length:107},(_,i)=>'I'+i).join(','));
const rows=lines.map(l=>l.split(',').map(Number)),snapshot=decode(rows);
const primary=rows.filter(v=>v[2]>=2&&v[2]<=5&&v[106]===1);
const rms=a=>a.length?Math.sqrt(a.reduce((s,v)=>s+v*v,0)/a.length):null;
const maxColumn=i=>Math.max(...rows.map(v=>v[i]));
const missingFrames=rows.slice(1).reduce((n,v,i)=>n+Math.max(0,v[1]-rows[i][1]-1),0);
const phases=[...new Set(rows.map(v=>v[2]))];
const runMetrics={rows:rows.length,phases,missingFrames,primaryWindow:'phase2..5 AND drivePermit1; unchanged40ms primary window',
 primarySamples:primary.length,trackingRMSE_mm:rms(primary.map(v=>1000*((v[5]+v[6])/2-v[3]))),
 syncRMS_mm:rms(primary.map(v=>1000*(v[5]-v[6]))),
 corePeak_us:maxColumn(42),bodyPeak_us:maxColumn(60),late:maxColumn(45),overruns:maxColumn(57),UARTerrors:maxColumn(59),steps:maxColumn(46)};
const binary=path.join(dir,prefix+'_snapshot.bin');
assert(!fs.existsSync(binary));fs.writeFileSync(binary,snapshot.bytes,{flag:'wx'});
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const task=path.join(root,'05_实验代码/自动监视_故障保留回放_20261014/eassy_E5REPLAY2_A_S3R2_HW6/Task');
const env={...process.env,PATH:'D:/MinGW/mingw64/bin;'+process.env.PATH};
const call=(command,args)=>spawnSync(command,args,{cwd:dir,env,encoding:'utf8'});
let r=call('D:/MinGW/mingw64/bin/gcc.exe',['-std=c99','-O2','-Wall','-Wextra','-Werror','-Wno-unused-function','-I',task,'test_replay.c','-lm','-o','test_replay.exe']);
assert.equal(r.status,0,r.stderr);
r=call(path.join(dir,'test_replay.exe'),[binary]);
const result={source,sourceSHA256:sha(raw),snapshotSHA256:sha(snapshot.bytes),header:snapshot.header,
 CRC32:snapshot.CRC32,chunks:snapshot.chunks,copies:snapshot.copies,snapshotValid:true,
 sourceKind:synthetic?'SYNTHETIC_NOT_PHYSICAL':'PHYSICAL_SERIAL_SNAPSHOT',
 faultObserved:snapshot.faultObserved,physicalRunComplete:!synthetic&&!snapshot.faultObserved&&rows.some(v=>v[2]===6),
 runMetrics,baselineReplayPassed:r.status===0,baselineOutput:r.stdout+r.stderr,ablations:[],
 closedLoopCounterfactual:false,performanceBenefitProven:false,formalEfficacyEvidence:false};
if(r.status!==0){
 result.finding='Baseline replay failed unchanged acceptance criteria. No ablation interpretation permitted; preserve failure and investigate ABI/source/floating-point differences.';
 fs.writeFileSync(report,JSON.stringify(result,null,2),{flag:'wx'});
 console.log(JSON.stringify(result,null,2));process.exitCode=1;
}else{
 const protocol=JSON.parse(fs.readFileSync(path.join(dir,'ablation_protocol.json'),'utf8'));
 const branches=[];
 for(const v of protocol.variants){
  const exe=v.name+'.exe';
  r=call('D:/MinGW/mingw64/bin/gcc.exe',['-std=c99','-O2','-Wall','-Wextra','-Werror','-Wno-unused-function','-I',task,
   ...['DIAG_NEW_LEARNING','DIAG_BOUNDED_REPAIR','DIAG_TRACKING_RETENTION'].map(k=>'-D'+k+'='+v[k]),'replay_ablation.c','-lm','-o',exe]);
  assert.equal(r.status,0,r.stderr);r=call(path.join(dir,exe),[binary]);assert.equal(r.status,0,r.stderr);
  const output=path.join(dir,prefix+'_'+v.name+'.csv');assert(!fs.existsSync(output));fs.writeFileSync(output,r.stdout,{flag:'wx'});
  const data=r.stdout.trim().split(/\r?\n/).slice(1).map(l=>l.split(',').map(Number));
  assert.equal(data.length,360);assert(data.every(row=>row.length===15&&row.every(Number.isFinite)));
  branches.push({variant:v.name,data});
 }
 const baseline=branches[0].data,mean=a=>a.reduce((s,v)=>s+v,0)/a.length;
 assert.deepEqual(baseline,branches.find(b=>b.variant==='retention_off').data,'Moving retention negative control mismatch');
 for(const b of branches)result.ablations.push({variant:b.variant,steps:b.data.length,
  changedCommandSteps:b.data.filter((row,i)=>row[5]!==baseline[i][5]||row[6]!==baseline[i][6]).length,
  changedLearningSteps:b.data.filter((row,i)=>row[3]!==baseline[i][3]||row[4]!==baseline[i][4]).length,
  meanActualModalLearning:[mean(b.data.map(row=>row[3])),mean(b.data.map(row=>row[4]))],
  repairSteps:[b.data.filter(row=>row[11]===1).length,b.data.filter(row=>row[12]===1).length],
  pureRateSteps:b.data.filter(row=>row[10]===1).length,
  bothAxesZeroLearningSteps:b.data.filter(row=>row[3]===0&&row[4]===0).length,finalNodes:b.data.at(-1).slice(13,15)});
 result.finding='Baseline recurrent snapshot validated. Single-factor branches explain only recorded-input learning/command effects, not alternative trajectory RMSE, stability or physical benefit. Faults remain failed runs.';
 fs.writeFileSync(report,JSON.stringify(result,null,2),{flag:'wx'});console.log(JSON.stringify(result,null,2));
}
