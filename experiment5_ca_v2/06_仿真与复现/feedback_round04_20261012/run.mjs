import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const dir=path.dirname(fileURLToPath(import.meta.url)),root=path.resolve(dir,'../../..');
const core=path.join(dir,'core'),out=path.join(dir,'data'),bin=path.join(dir,'bin');
assert(!fs.existsSync(out),'Never overwrite a previous attempt');
fs.mkdirSync(out);fs.mkdirSync(bin,{recursive:true});
const physicalPath=path.join(root,'实验5整理_20261011/03_统计汇总/analysis.json');
const previous=path.resolve(dir,'../sector_round02_20261012');
const reason=path.resolve(dir,'../physical_reason_round03_20261012');
const hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const original=path.join(root,'实验5整理_20261011/05_实验代码/正式对照_HW6_B/eassy_E5F_B_CA_BLNN_HW6/Task');
const readPaths=[physicalPath,...['diagnosis.json','history.json','verification.json'].map(p=>path.join(reason,p)),
  ...['O25.json','BLNN.json','results.json'].map(p=>path.join(previous,'data_attempt02',p)),
  ...fs.readdirSync(core).map(p=>path.join(previous,'core',p)),
  ...['blnn_core.c','blnn_core.h','experiment5_ca_actuator.h','experiment5_motion.h','motor_task.c','vofa_task.c'].map(p=>path.join(original,p))];
const preserved=Object.fromEntries(readPaths.map(p=>[p,hash(p)]));
for(const f of fs.readdirSync(core))assert.equal(hash(path.join(core,f)),hash(path.join(previous,'core',f)));
fs.writeFileSync(path.join(out,'preservation.json'),JSON.stringify(preserved,null,2));
const protocol={date:'2026-10-12',hostOnly:true,reportGenerated:false,hardwareReleased:false,
  profiles:[
    {id:0,name:'P0_legacy',model:'previous every-1ms feedback; 3ms RPM smoothing; +1 rpm each 19th ms; current position sampled without packet delay'},
    {id:1,name:'P1_hold2_noNoise',model:'position/RPM in one held packet every 2ms; axis offset 1ms; same queue delay, no added noise'},
    {id:2,name:'P2_hold2_symmetric1',model:'P1 plus reproducible symmetric +/-1 RPM packet perturbation'},
    {id:3,name:'P3_hold5_symmetric1',model:'held packets every 5ms; axis offset 2ms; reproducible symmetric +/-1 RPM perturbation'}
  ],
  modelCaveat:'Packet timing/perturbation are assumptions. 40-ms physical exports do not identify actual 1-ms feedback history.',
  plantGrid:'Existing grid only: per-axis mass 3/6/9kg, static friction 400/600 counts, queue setting 0/3/6ms (queue adds one tick); common parameters for A and B; existing asymmetric right-axis mass/friction unchanged.',
  controller:'EXACT unchanged round02 old CA: sector .25, slew 2 counts/ms, 300-count NN cap; identical gains and safety guards for all profiles/methods.',
  fitIds:['A_BASE_1','A_BASE_2','B_BASE_1','B_BASE_2'],
  validationIds:['A_BASE_3','B_BASE_3','A_BLNN_1','A_BLNN_2','A_BLNN_3','B_BLNN_1','B_BLNN_2','B_BLNN_3'],
  mechanismOnlyIds:['A_CA_BLNN_1','A_CA_BLNN_2','A_CA_BLNN_3','B_CA_BLNN_1','B_CA_BLNN_2','B_CA_BLNN_3'],
  splitCaveat:'These are existing records, previously inspected. This is a computational fitting split, NOT a newly collected independent holdout.',
  fitObjective:'mean position RMSE on four BASE training trajectories (400 40-ms points x 2 axes), plus .05mm times relative per-axis command-RMS discrepancy. Both A/B model runs must finish; faults retained but ineligible for fitting.',
  selection:'Select best P0 baseline and best P1/P2/P3 alternative on BASE TRAINING score alone; never tune to CA masks or prefer candidate-method accuracy.',
  validationGate:'For each A/B BASE run03, position RMSE <= max(.1mm,2*RMSE(physical run03 vs mean physical runs01/02)); require completion of BLNN and old-CA simulation too.',
  mechanismGate:'For each condition, modeled old-CA motion only-PROJECTED percentage and full-activity withdrawal/contraction totals must lie within the empirical range of three physical runs. This is a diagnostic acceptance rule, not a statistical equivalence test.',
  reproducibility:'Every BASE profile and both selected method evaluations rerun numerically identically; P0 BLNN and old CA reproduce prior round02 records exactly excluding newly-added feedback records.'};
fs.writeFileSync(path.join(out,'protocol.json'),JSON.stringify(protocol,null,2));
const physical=JSON.parse(fs.readFileSync(physicalPath,'utf8'));
const diagnosis=JSON.parse(fs.readFileSync(path.join(reason,'diagnosis.json'),'utf8'));
const history=JSON.parse(fs.readFileSync(path.join(reason,'history.json'),'utf8'));
const env={...process.env,PATH:'D:/MinGW/mingw64/bin;'+(process.env.PATH||'')};
const gcc='D:/MinGW/mingw64/bin/gcc.exe';let compilations=0;
const sourcePaths=[...fs.readdirSync(core).map(p=>path.join(core,p)),path.join(dir,'test_plant.c'),fileURLToPath(import.meta.url)];
fs.writeFileSync(path.join(out,'sources.json'),JSON.stringify(Object.fromEntries(sourcePaths.map(p=>[p,hash(p)])),null,2));
function compile(profile,method){
  const exe=path.join(bin,`P${profile}_M${method}.exe`);
  if(fs.existsSync(exe))return exe;
  const c=spawnSync(gcc,['-std=c99','-O2','-Wall','-Wextra','-Werror','-Wno-unused-function',
    `-DFEEDBACK_PROFILE=${profile}`,`-DTEST_METHOD=${method}`,'-DDIAG_NEW_LEARNING=0',
    '-DDIAG_SECTOR_FRACTION=.25','-DDIAG_SLEW_COUNTS=2','-I',core,
    path.join(dir,'test_plant.c'),path.join(core,'blnn_core.c'),'-lm','-o',exe],{env,encoding:'utf8'});
  assert.equal(c.status,0,c.stderr);compilations++;return exe;
}
function call(exe,args=[]){
  const r=spawnSync(exe,args.map(String),{env,encoding:'utf8',maxBuffer:40e6});
  if(r.status!==0){fs.writeFileSync(path.join(out,'failure.log'),r.stderr+'\n'+r.stdout);throw Error(r.stderr||r.error?.message||'native failed');}
  return r.stdout.trim().split(/\r?\n/).map(s=>JSON.parse(s));
}
function run(profile,method,args=[]){
  const exe=compile(profile,method),a=call(exe,args),b=call(exe,args);
  assert.equal(JSON.stringify(a),JSON.stringify(b),'determinism');return a;
}
function split(records){
  return records.filter(r=>r.type==='result').map(result=>({
    result,start:records.find(r=>r.type==='start'&&r.case===result.case),
    trace:records.filter(r=>r.type==='trace'&&r.case===result.case&&r.phase>=2&&r.phase<=5),
    feedback:records.filter(r=>r.type==='feedback'&&r.case===result.case&&r.t>=4&&r.t<20)}));
}
const mean=a=>a.reduce((s,v)=>s+v,0)/a.length;
function compare(model,targets){
  if(!model.result.complete)return {complete:false,positionRMSE_mm:null,commandRMSRelativeError:null,fitScore:null,fault:model.result.fault};
  assert.equal(model.trace.length,400);
  let squares=0,cmdRel=[];
  for(const target of targets){
    assert.equal(target.trajectory.length,400);
    for(let i=0;i<400;i++){
      const p=target.trajectory[i],m=model.trace[i];assert(Math.abs(p.t_s-m.t)<.00001);
      squares+=(p.left_mm-m.positions_mm[0])**2+(p.right_mm-m.positions_mm[1])**2;
    }
    for(let axis=0;axis<2;axis++){
      const modelRMS=Math.sqrt(mean(model.trace.map(r=>r.commands[axis]**2)));
      const actualRMS=target.metrics[axis?'rightCmdRMS_counts':'leftCmdRMS_counts'];
      cmdRel.push(Math.abs(modelRMS-actualRMS)/actualRMS);
    }
  }
  const positionRMSE_mm=Math.sqrt(squares/(800*targets.length)),commandRMSRelativeError=mean(cmdRel);
  return {complete:true,positionRMSE_mm,commandRMSRelativeError,fitScore:positionRMSE_mm+.05*commandRMSRelativeError};
}
const find=(condition,name,run)=>physical.selected.find(v=>v.condition===condition&&v.name===name&&v.run===run);
const candidates=[],baseRecords=[];
for(let p=0;p<4;p++){
  const records=run(p,10);fs.writeFileSync(path.join(out,`P${p}_BASE.json`),JSON.stringify(records));
  const models=split(records);assert.equal(models.length,36);baseRecords[p]=models;
  for(let c=1;c<=18;c++){
    const A=models.find(v=>v.result.case===c),B=models.find(v=>v.result.case===c+18);
    const aa=compare(A,[find('A','BASE',1),find('A','BASE',2)]);
    const bb=compare(B,[find('B','BASE',1),find('B','BASE',2)]);
    candidates.push({profile:p,caseA:c,caseB:c+18,parameters:A.start,training:{A:aa,B:bb},
      score:aa.complete&&bb.complete?mean([aa.fitScore,bb.fitScore]):null});
  }
  console.log(`P${p}: 36 BASE model runs, exact repeat PASS; ${models.filter(v=>v.result.complete).length}/36 complete`);
}
const rank=rs=>rs.filter(v=>v.score!==null).sort((a,b)=>a.score-b.score||a.profile-b.profile||a.caseA-b.caseA);
const old=rank(candidates.filter(v=>v.profile===0))[0],alternative=rank(candidates.filter(v=>v.profile>0))[0];
assert(old&&alternative);
// Store selection before reading CA outcomes. Do not revise it afterwards.
fs.writeFileSync(path.join(out,'selection.json'),JSON.stringify({old,alternative,candidates},null,2));
console.log(`Training selection frozen: P0 case ${old.caseA}, alternative P${alternative.profile} case ${alternative.caseA}`);
const legacyChecks={};
const priorMethods={11:'BLNN',12:'O25'};
const priorModels={};
for(const method of [11,12]){
  const records=run(0,method),prior=JSON.parse(fs.readFileSync(path.join(previous,'data_attempt02',priorMethods[method]+'.json'),'utf8'));
  assert.equal(JSON.stringify(records.filter(r=>r.type!=='feedback')),JSON.stringify(prior),'P0 exact legacy reproduction');
  fs.writeFileSync(path.join(out,`P0_${priorMethods[method]}.json`),JSON.stringify(records));
  priorModels[method]=split(records);legacyChecks[priorMethods[method]]=true;
  console.log(`P0 ${priorMethods[method]}: 36 previous model outcomes reproduced exactly`);
}
function repeatError(condition){
  const p1=find(condition,'BASE',1),p2=find(condition,'BASE',2),p3=find(condition,'BASE',3);
  let sum=0;
  for(let i=0;i<400;i++)for(const col of ['left_mm','right_mm'])sum+=(p3.trajectory[i][col]-.5*(p1.trajectory[i][col]+p2.trajectory[i][col]))**2;
  return Math.sqrt(sum/800);
}
function empirical(condition){
  const rs=diagnosis.runs.filter(v=>v.id[0]===condition),hs=history.results.filter(v=>v.id[0]===condition);
  const range=xs=>[Math.min(...xs),Math.max(...xs)];
  return {onlyProjected_pct:range(rs.map(v=>100*v.motion.onlyProjected/v.motion.frames)),
    withdrawals:range(hs.map(v=>v.totalWithdrawals)),contractions:range(hs.map(v=>v.totalContractions))};
}
const evaluations=[];
for(const selection of [old,alternative]){
  const ev={profile:selection.profile,parameters:selection.parameters,trainingScore:selection.score,conditions:[]};
  for(const condition of ['A','B']){
    const c=selection[condition==='A'?'caseA':'caseB'];
    const base=baseRecords[selection.profile].find(v=>v.result.case===c);
    const baseValidation=compare(base,[find(condition,'BASE',3)]);
    const repeatRMSE=repeatError(condition),positionThreshold=Math.max(.1,2*repeatRMSE);
    const row={condition,baseValidation,physicalRepeatRMSE_mm:repeatRMSE,positionThreshold_mm:positionThreshold,
      basePositionGate:baseValidation.complete&&baseValidation.positionRMSE_mm<=positionThreshold,methods:[]};
    for(const method of [11,12]){
      let model;
      if(selection.profile===0)model=priorModels[method].find(v=>v.result.case===c);
      else {
        const records=run(selection.profile,method,[c]);
        fs.writeFileSync(path.join(out,`P${selection.profile}_M${method}_${condition}.json`),JSON.stringify(records));
        model=split(records)[0];
      }
      const name=method===11?'BLNN':'CA_BLNN';
      const m={name,result:model.result,accuracyValidation:compare(model,[1,2,3].map(r=>find(condition,name,r)))};
      if(method===12){
        const rate=100*model.trace.filter(v=>v.mask===2).length/model.trace.length;
        const ranges=empirical(condition),within=(v,r)=>v>=r[0]&&v<=r[1];
        m.mechanism={onlyProjected_pct:rate,withdrawals:model.result.withdrawals,contractions:model.result.contractions,physicalEmpiricalRanges:ranges,
          rateGate:model.result.complete&&within(rate,ranges.onlyProjected_pct),
          withdrawalGate:model.result.complete&&within(model.result.withdrawals,ranges.withdrawals),
          contractionGate:model.result.complete&&within(model.result.contractions,ranges.contractions)};
        m.mechanism.allPassed=m.mechanism.rateGate&&m.mechanism.withdrawalGate&&m.mechanism.contractionGate;
      }
      row.methods.push(m);
    }
    ev.conditions.push(row);
  }
  ev.adequacyPassed=ev.conditions.every(c=>c.basePositionGate&&c.methods.every(m=>m.result.complete)&&c.methods.find(m=>m.name==='CA_BLNN').mechanism.allPassed);
  evaluations.push(ev);console.log(`P${ev.profile}: held-out adequacy ${ev.adequacyPassed?'PASS':'NOT PASSED'}; no physical release`);
}
for(const [p,h] of Object.entries(preserved))assert.equal(hash(p),h,'source modified');
const result={date:'2026-10-12',status:'HOST_MODEL_ADEQUACY_CHECK',reportGenerated:false,hardwareRuns:0,hardwareReleased:false,
  compilations,baselineModelRuns:144,allOutcomesRetained:true,determinismPassed:true,legacyChecks,preservationPassed:true,
  physicalSource:physicalPath,physicalSourceSHA256:preserved[physicalPath],evaluations,
  calibratedHardwareModelEstablished:evaluations.find(e=>e.profile>0).adequacyPassed,
  caveats:['Empirical range gates based on three physical repetitions are diagnostic only.',
    'Packet timings are hypotheses, not inferred actual CAN cadence.',
    'BASE fitting does not identify unique physical mass, friction, delay or sensor noise.',
    'Existing record split is not independent new experimental validation.',
    'No candidate learning rule or physical firmware was altered in this round.']};
fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(result,null,2));
console.log(JSON.stringify(result,null,2));
