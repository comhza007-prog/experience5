import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import assert from 'node:assert/strict';import {spawnSync} from 'node:child_process';
process.on('uncaughtException',e=>{console.error(e.message);process.exitCode=1;});
const root=process.cwd(),dir=path.join(root,'experiment5_ca_v2/06_仿真与复现/sector_round02_20261012'),core=path.join(dir,'core');
const round1=path.join(root,'experiment5_ca_v2/06_仿真与复现/factorial_round01_20261012');
const original=path.join(root,'实验5整理_20261011/05_实验代码/正式对照_HW6_B/eassy_E5F_B_CA_BLNN_HW6/Task');
const outputName=process.argv[2]||'data';assert.match(outputName,/^data(?:_attempt\d+)?$/);
const out=path.join(dir,outputName),bin=path.join(dir,'bin');assert.ok(!fs.existsSync(out),'Do not overwrite existing data');fs.mkdirSync(out);fs.mkdirSync(bin,{recursive:true});
const variants=[{name:'BLNN',method:11,learning:0,sector:.25},...([.25,.5,.75].flatMap(sector=>[0,1].map(learning=>({name:(learning?'N':'O')+Math.round(sector*100),method:12,learning,sector}))))];
const hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const preserved=JSON.parse(fs.readFileSync(path.join(round1,'results_attempt02/preservation_before.json'),'utf8'));
for(const [p,h] of Object.entries(preserved))assert.equal(hash(p),h,'Original material changed');
for(const f of fs.readdirSync(path.join(round1,'core')))preserved[path.join(round1,'core',f)]=hash(path.join(round1,'core',f));
for(const f of ['diagnostic_results.json','rerun_verification.json'])preserved[path.join(round1,'results_attempt02',f)]=hash(path.join(round1,'results_attempt02',f));
fs.writeFileSync(path.join(out,'preservation.json'),JSON.stringify(preserved,null,2));
const protocol={date:'2026-10-12',registeredBeforeRun:true,variants,slew_counts_per_ms:2,nnAmplitude_counts:300,sectorBudgets:'fraction*40*sigmaY^2 and fraction*25*sigmaAlpha^2 in BOTH float preview and integer allocation/contraction',learningRule:'new learning retained only for proven pure slew, scaled by actual target-aligned fraction; all mixed constraints block',plant:'same uncalibrated assumed coupled plant and 36 fixed configurations as round01',hypotheses:['sector fraction may affect precision/correction tradeoff','pure-rate and mixed-projection must be distinguished','no assumption new learning or relaxed sector is superior'],safety:'host only; physical limit/rpm/stop guards unchanged; NO release/flash or hardware',noReportRequested:true};
fs.writeFileSync(path.join(out,'protocol.json'),JSON.stringify(protocol,null,2));
const sourcePaths=[...fs.readdirSync(core).map(f=>path.join(core,f)),...fs.readdirSync(dir).filter(f=>/\.(c|h|mjs)$/.test(f)).map(f=>path.join(dir,f))];
fs.writeFileSync(path.join(out,'sources.json'),JSON.stringify(Object.fromEntries(sourcePaths.map(p=>[path.relative(dir,p).replaceAll('\\','/'),hash(p)])),null,2));
const env={...process.env,PATH:'D:/MinGW/mingw64/bin;'+(process.env.PATH||process.env.Path||'')};const gcc='D:/MinGW/mingw64/bin/gcc.exe';let compilations=0;const tests=[];
function call(exe,args){const r=spawnSync(exe,args,{cwd:dir,env,encoding:'utf8',maxBuffer:32*1024*1024});if(r.status!==0){fs.writeFileSync(path.join(out,'failure.log'),(r.stderr||'')+'\n'+(r.stdout||'')+'\n'+(r.error?.message||''));throw Error('Failed '+path.basename(exe)+': '+(r.stderr||r.error?.message||r.stdout||''));}return r.stdout;}
function compile(args){call(gcc,['-std=c99','-Wall','-Wextra','-Werror','-Wno-unused-function','-O2',...args]);compilations++;}
function flags(v,p='float'){return [`-DDIAG_NEW_LEARNING=${v.learning}`,`-DDIAG_SLEW_COUNTS=2`,`-DDIAG_SECTOR_FRACTION=${v.sector}`,`-DTEST_METHOD=${v.method}`,...(p==='double'?['-DE5_USE_DOUBLE']:[])];}
for(const precision of ['float','double']){
 const pd=precision==='double'?['-DE5_USE_DOUBLE']:[],aliases=['-De5_reset=e5_reset_legacy','-De5_step=e5_step_legacy'];
 const oldObj=path.join(bin,'old_'+precision+'.o'),wrapperObj=path.join(bin,'wrapper_'+precision+'.o'),eq=path.join(bin,'equivalence_'+precision+'.exe');
 compile([...pd,...aliases,'-I',original,'-c',path.join(original,'blnn_core.c'),'-o',oldObj]);compile([...pd,...aliases,'-I',original,'-c',path.join(dir,'legacy_wrapper.c'),'-o',wrapperObj]);
 compile([...flags(variants[1],precision),'-I',core,path.join(dir,'test_equivalence.c'),path.join(core,'blnn_core.c'),oldObj,wrapperObj,'-lm','-o',eq]);tests.push(call(eq,[]));console.log(precision+': legacy .25 exact equivalence PASS');
 for(const v of variants.filter(v=>v.method===12)){
  const reason=path.join(bin,'reason_'+v.name+'_'+precision+'.exe'),adapter=path.join(bin,'adapter_'+v.name+'_'+precision+'.exe');
  compile([...flags(v,precision),'-I',core,path.join(dir,'test_reasons.c'),'-lm','-o',reason]);tests.push(v.name+' '+precision+' '+call(reason,[]));
  compile([...flags(v,precision),'-I',core,path.join(dir,'test_adapter.c'),path.join(core,'blnn_core.c'),'-lm','-o',adapter]);tests.push(v.name+' '+precision+' '+call(adapter,[]));console.log(v.name+' '+precision+': constraints and learning checks PASS');
 }
}
fs.writeFileSync(path.join(out,'host_tests.log'),tests.join('\n'));
const runs=[];
for(const v of variants){
 const exe=path.join(bin,'plant_'+v.name+'.exe');compile([...flags(v),'-I',core,path.join(dir,'test_plant.c'),path.join(core,'blnn_core.c'),'-lm','-o',exe]);
 const records=call(exe,[]).trim().split(/\r?\n/).map(l=>JSON.parse(l));fs.writeFileSync(path.join(out,v.name+'.json'),JSON.stringify(records));
 const second=call(exe,[]).trim().split(/\r?\n/).map(l=>JSON.parse(l));assert.ok(JSON.stringify(second)===JSON.stringify(records),'Rerun numerical JSON differs '+v.name);
 if(['BLNN','O25','N25'].includes(v.name)){
  const prior={BLNN:'BLNN',O25:'D0',N25:'D1'}[v.name],saved=JSON.parse(fs.readFileSync(path.join(round1,'results_attempt02/plant_'+prior+'.json'),'utf8'));
  assert.ok(JSON.stringify(records.filter(r=>r.type!=='mechanism'))===JSON.stringify(saved),'Unchanged .25 baseline differs from round1 '+v.name);
 }
 const starts=new Map(records.filter(r=>r.type==='start').map(r=>[r.case,r]));const mechanics=new Map(records.filter(r=>r.type==='mechanism').map(r=>[r.case,r]));
 for(const r of records.filter(r=>r.type==='result')){
  const rs=records.filter(t=>t.type==='trace'&&t.case===r.case),start=starts.get(r.case);assert.equal(r.complete,r.fault===0&&r.stop_ms===20000);
  assert.ok(rs.every((t,i)=>Math.abs(t.t-i*.04)<1e-12&&t.learning>=0&&t.learning<=1));assert.ok(rs.every(t=>t.commands.every((cmd,ch)=>Math.abs(cmd)<=(ch?start.right_limit:1200))));
  if(v.method===12){assert.ok(rs.every(t=>t.delta.every(d=>Math.abs(d)<=300)));assert.ok(rs.every(t=>v.learning?(t.reason===1?t.learning<=t.rho+1e-6:(t.mask===0&&t.reason===0)||t.learning===0):(t.mask===0||t.learning===0)));}
  if(r.complete)assert.equal(rs.filter(t=>t.phase>=2&&t.phase<=5).length,400);
  const full=r.complete&&r.motionSamples===16000;runs.push({...start,...r,variant:v.name,learningRule:v.learning,sectorFraction:v.sector,mechanism:mechanics.get(r.case),trackingRMSE_mm:full?r.partialTrackingRMSE_mm:null,syncRMS_mm:full?r.partialSyncRMS_mm:null});
 }
 console.log(v.name+': '+runs.filter(r=>r.variant===v.name&&r.complete).length+'/36 model runs complete; exact rerun PASS');
}
assert.equal(runs.length,252);const paired=[];
for(let c=1;c<=36;c++){const rs=runs.filter(r=>r.case===c);assert.equal(rs.length,7);if(rs.every(r=>r.complete&&r.motionSamples===16000))paired.push(c);}
const mean=x=>x.length?x.reduce((s,v)=>s+v,0)/x.length:null;
const summary=variants.map(v=>{const rs=runs.filter(r=>r.variant===v.name);return {...v,complete:rs.filter(r=>r.complete).length,simulatedFaults:rs.filter(r=>!r.complete).map(r=>({case:r.case,fault:r.fault,stop_ms:r.stop_ms}))};});
const effects=['A','B'].map(condition=>{const shared=paired.filter(c=>runs.find(r=>r.case===c).right_limit===(condition==='A'?1200:800));return {condition,matchedConfigurations:shared.length,variants:variants.map(v=>{const rs=runs.filter(r=>r.variant===v.name&&shared.includes(r.case));return {name:v.name,trackingRMSE_mm:mean(rs.map(r=>r.trackingRMSE_mm)),syncRMS_mm:mean(rs.map(r=>r.syncRMS_mm)),learningMean:mean(rs.map(r=>r.learningMean)),sectorMean:([0,1].map(ch=>mean(rs.map(r=>r.mechanism.sectorMean[ch])))),pureRate_pct:mean(rs.map(r=>r.pureRate_pct)),mixedProjection_pct:mean(rs.map(r=>100*r.mechanism.mixedProjection/r.mechanism.steps)),amplitude_pct:mean(rs.map(r=>100*r.mechanism.maskCounts[0]/r.mechanism.steps)),integerSector_pct:mean(rs.map(r=>100*r.mechanism.maskCounts[2]/r.mechanism.steps)),speedGuard_pct:mean(rs.map(r=>100*r.mechanism.maskCounts[3]/r.mechanism.steps))};})};});
for(const [p,h] of Object.entries(preserved))assert.equal(hash(p),h,'Preserved file changed');
const result={date:'2026-10-12',status:'OFFLINE_ONLY_NOT_RELEASED',reportGenerated:false,compilations,hostChecksPassed:true,legacyExact:true,round1BaselinesIdentical:true,all252RerunsIdentical:true,comparisonUsesSharedCompleteConfigurationsOnly:true,allSimulatedFaultsRetained:true,hardwareRuns:0,preservedFiles:Object.keys(preserved).length,summary,effects,runs,limitations:['same assumed plant reused for diagnostics, not calibrated hardware','not independent holdout or all-condition proof','sector budget altered only in host copies; not a safe-to-flash configuration']};
fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(result,null,2));
fs.writeFileSync(path.join(root,'experiment5_ca_v2/current_state.json'),JSON.stringify({date:result.date,lastRound:'sector_round02_20261012/'+outputName,hardwareReleased:false,hardwareRuns:0,reportGenerated:false},null,2));
console.log(JSON.stringify({status:result.status,compilations,summary:summary.map(v=>({name:v.name,complete:v.complete})),effects,preservedFiles:result.preservedFiles},null,2));
