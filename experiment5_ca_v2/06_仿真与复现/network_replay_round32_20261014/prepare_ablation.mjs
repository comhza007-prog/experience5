import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {decode} from './decode.mjs';
const dir=path.dirname(fileURLToPath(import.meta.url)),root=path.resolve(dir,'../..');
const task=path.join(root,'05_实验代码/自动监视_网络回放_20261014/eassy_E5REPLAY_A_S3R2_HW6/Task');
const protocol=JSON.parse(fs.readFileSync(path.join(dir,'ablation_protocol.json'),'utf8'));
const env={...process.env,PATH:'D:/MinGW/mingw64/bin;'+process.env.PATH};
const run=(command,args)=>{const r=spawnSync(command,args,{cwd:dir,env,encoding:'utf8'});assert.equal(r.status,0,r.stdout+r.stderr);return r.stdout;};
// Always compile from the current source; never attest using a stale native binary.
run('D:/MinGW/mingw64/bin/gcc.exe',['-std=c99','-O2','-Wall','-Wextra','-Wno-unused-function','-Werror','-I',task,'test_replay.c','-lm','-o','test_replay.exe']);
run(path.join(dir,'test_replay.exe'),[]);
run(process.execPath,['test_decode.mjs']);run(process.execPath,['decode.mjs']);
run(path.join(dir,'test_replay.exe'),['decoded_synthetic_replay.bin']);
run(path.join(dir,'test_replay.exe'),['--rate-test']);
const rateRows=fs.readFileSync(path.join(dir,'synthetic_rate_replay.csv'),'utf8').trim().split(/\r?\n/).slice(1).map(l=>l.split(',').map(Number));
const rateBytes=decode(rateRows).bytes;assert.deepEqual(rateBytes,fs.readFileSync(path.join(dir,'synthetic_rate_replay.bin')));
fs.writeFileSync(path.join(dir,'decoded_synthetic_rate_replay.bin'),rateBytes);
run(path.join(dir,'test_replay.exe'),['decoded_synthetic_rate_replay.bin']);
const columns='ms,predictionY,predictionAlpha,learningY,learningAlpha,commandL,commandR,deltaL,deltaR,mask,cause,repairY,repairAlpha,nodesY,nodesAlpha'.split(',');
const fixtures=[{name:'repair_active',bin:'decoded_synthetic_replay.bin',rows:[]},{name:'rate_only',bin:'decoded_synthetic_rate_replay.bin',rows:[]}];
for(const variant of protocol.variants){
 const exe=variant.name+'.exe';
 run('D:/MinGW/mingw64/bin/gcc.exe',['-std=c99','-O2','-Wall','-Wextra','-Wno-unused-function','-I',task,...['DIAG_NEW_LEARNING','DIAG_BOUNDED_REPAIR','DIAG_TRACKING_RETENTION'].map(k=>'-D'+k+'='+variant[k]),'replay_ablation.c','-lm','-o',exe]);
 for(const fixture of fixtures){
 const output=run(path.join(dir,exe),[fixture.bin]);
 const lines=output.trim().split(/\r?\n/);assert.equal(lines.shift(),columns.join(','));
 const data=lines.map(l=>l.split(',').map(Number));assert.equal(data.length,360);assert(data.every(r=>r.length===15&&r.every(Number.isFinite)));
 fs.writeFileSync(path.join(dir,'synthetic_'+fixture.name+'_'+variant.name+'.csv'),output);
 fixture.rows.push({variant:variant.name,data});
 }
}
for(const fixture of fixtures){
const rows=fixture.rows,blob=fs.readFileSync(path.join(dir,fixture.bin)),offset=40+2*5348;
for(let i=0;i<360;i++){
 const r=rows[0].data[i],start=offset+80*i;
 assert.equal(r[0],blob.readUInt32LE(start));
 for(let ch=0;ch<2;ch++){
  assert.equal(r[5+ch],blob.readInt16LE(start+52+2*ch));
  for(const [column,at] of [[1+ch,start+56+4*ch],[3+ch,start+64+4*ch]]){const value=blob.readFloatLE(at);assert(Math.abs(r[column]-value)<=1e-5+2e-5*Math.abs(value));}
 }
 assert.equal(r[9],blob.readUInt32LE(start+72));assert.equal(r[10],blob.readUInt32LE(start+76));
}
assert.deepEqual(rows[0].data,rows.find(r=>r.variant==='retention_off').data,'Moving-window retention negative control must be exact');
for(const branch of rows.slice(1))assert.deepEqual(branch.data[0].slice(0,3),rows[0].data[0].slice(0,3),'All start from identical state/prediction');
}
const rateFixture=fixtures[1].rows;
assert(rateFixture[0].data.some(r=>r[10]===1),'Rate-only fixture must exercise rate-only classifier');
assert(rateFixture.find(r=>r.variant==='classification_off').data.some((r,i)=>r[3]!==rateFixture[0].data[i][3]),'Classification ablation must change learning in dedicated rate-only fixture');
assert.deepEqual(rateFixture[0].data,rateFixture.find(r=>r.variant==='repair_off').data,'Useful-output fixture must not trigger wrong-direction repair');
const result={protocol:'ablation_protocol.json',sourceKind:'SYNTHETIC_LOGGER_TEST_NOT_PHYSICAL_DATA',baselineValidated:true,
  nativeBranches:protocol.variants.map(v=>v.name),stepsPerBranch:360,retentionMovingNegativeControlExact:true,
  firmwareCoreChanged:false,hardwareUsed:false,physicalBenefitProven:false,realSnapshotAvailable:false,
  dedicatedRateClassificationTestPassed:true,
  fixtures:fixtures.map(({name,rows})=>({name,branchComparisons:rows.slice(1).map(branch=>({variant:branch.variant,changedCommandSteps:branch.data.filter((r,i)=>r[5]!==rows[0].data[i][5]||r[6]!==rows[0].data[i][6]).length,changedLearningSteps:branch.data.filter((r,i)=>r[3]!==rows[0].data[i][3]||r[4]!==rows[0].data[i][4]).length}))})),
  sourceHashes:Object.fromEntries(['replay_ablation.c','test_replay.c','ablation_protocol.json'].map(f=>[f,crypto.createHash('sha256').update(fs.readFileSync(path.join(dir,f))).digest('hex')])),
  interpretation:'Toolchain readiness only. These synthetic request/update differences are not evidence of any real motor improvement. No baseline method chosen or discarded based on these outputs.'};
fs.writeFileSync(path.join(dir,'ablation_preparation_verification.json'),JSON.stringify(result,null,2));
console.log(JSON.stringify(result,null,2));
