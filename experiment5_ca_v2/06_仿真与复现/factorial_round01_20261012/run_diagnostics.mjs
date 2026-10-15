import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import assert from 'node:assert/strict';import {spawnSync} from 'node:child_process';
const root=process.cwd(),dir=path.join(root,'experiment5_ca_v2/06_仿真与复现/factorial_round01_20261012'),core=path.join(dir,'core');
const original=path.join(root,'实验5整理_20261011/05_实验代码/正式对照_HW6_B/eassy_E5F_B_CA_BLNN_HW6/Task');
const resultName=process.argv[2]||'results';assert.match(resultName,/^results(?:_attempt\d+)?$/);
const bin=path.join(dir,'bin'),results=path.join(dir,resultName);fs.mkdirSync(bin,{recursive:true});assert.ok(!fs.existsSync(results),'Do not overwrite any prior diagnostic results');fs.mkdirSync(results);
const hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const preserve=new Set(fs.readdirSync(core).filter(f=>fs.existsSync(path.join(original,f))).map(f=>path.join(original,f)));
const pack=JSON.parse(fs.readFileSync(path.join(root,'实验5整理_20261011/manifest.json'),'utf8'));
for(const e of pack.files)preserve.add(path.join(root,'实验5整理_20261011',e.path));
preserve.add(path.join(root,'实验5整理_20261011/manifest.json'));preserve.add(path.join(root,'实验5整理_20261011.zip'));
for(const line of fs.readFileSync(path.join(root,'step3_blnn/m3508_integration/V3_SNAPSHOT_CONTENTS.sha256'),'utf8').trim().split(/\r?\n/)){const m=line.match(/^([\da-f]{64})\s{2}(.+)$/i);assert.ok(m);const p=path.join(root,m[2]);assert.equal(hash(p),m[1].toLowerCase(),'Original snapshot mismatch');preserve.add(p);}
for(const f of fs.readdirSync(path.join(root,'step4_hardware_experiments/archives')))if(f.endsWith('.zip'))preserve.add(path.join(root,'step4_hardware_experiments/archives',f));
const before=Object.fromEntries([...preserve].map(p=>[p,hash(p)]));
fs.writeFileSync(path.join(results,'preservation_before.json'),JSON.stringify(before,null,2));
const sourceFiles=[...fs.readdirSync(core).map(f=>path.join(core,f)),...fs.readdirSync(dir).filter(f=>/\.(c|h|mjs|md)$/.test(f)).map(f=>path.join(dir,f))];
fs.writeFileSync(path.join(results,'code_manifest.json'),JSON.stringify({created:'2026-10-12',hostOnly:true,hardwarePermission:false,factors:{learning:['old','realized-fraction-for-proven-pure-slew'],slew_counts_per_ms:[2,4]},sources:Object.fromEntries(sourceFiles.map(p=>[path.relative(dir,p).replaceAll('\\','/'),hash(p)]))},null,2));
const variants=[{name:'BLNN',method:11,learning:0,slew:2},{name:'D0',method:12,learning:0,slew:2},{name:'D1',method:12,learning:1,slew:2},{name:'D2',method:12,learning:0,slew:4},{name:'D3',method:12,learning:1,slew:4}];
const env={...process.env,PATH:'D:/MinGW/mingw64/bin;'+(process.env.PATH||process.env.Path||'')};
const log=[];let compilationCount=0;
function call(exe,args){const r=spawnSync(exe,args,{cwd:dir,env,encoding:'utf8',maxBuffer:32*1024*1024});if(r.status!==0){fs.writeFileSync(path.join(results,'failure.log'),(r.stdout||'')+(r.stderr||'')+'\n'+(r.error?.message||''));throw Error('Diagnostic failed: '+path.basename(exe)+' '+args.join(' ')+'\n'+(r.stdout||'')+(r.stderr||'')+(r.error?.message||''));}return r.stdout;}
const gcc='D:/MinGW/mingw64/bin/gcc.exe',common=['-std=c99','-Wall','-Wextra','-Werror','-Wno-unused-function','-O2'];
function compile(args){call(gcc,[...common,...args]);compilationCount++;}
function defs(v,precision){return [`-DDIAG_NEW_LEARNING=${v.learning}`,`-DDIAG_SLEW_COUNTS=${v.slew}`,`-DTEST_METHOD=${v.method}`,...(precision==='double'?['-DE5_USE_DOUBLE']:[])];}
for(const precision of ['float','double']) {
 const pd=precision==='double'?['-DE5_USE_DOUBLE']:[];
 const oldObj=path.join(bin,'old_'+precision+'.o'),wrapperObj=path.join(bin,'wrapper_'+precision+'.o'),equivalenceExe=path.join(bin,'equivalence_'+precision+'.exe');
 const aliases=['-De5_reset=e5_reset_legacy','-De5_step=e5_step_legacy'];
 compile([...pd,...aliases,'-I',original,'-c',path.join(original,'blnn_core.c'),'-o',oldObj]);
 compile([...pd,...aliases,'-I',original,'-c',path.join(dir,'legacy_wrapper.c'),'-o',wrapperObj]);
 compile([...defs(variants[1],precision),'-I',core,path.join(dir,'test_equivalence.c'),path.join(core,'blnn_core.c'),oldObj,wrapperObj,'-lm','-o',equivalenceExe]);
 const equivalence=call(equivalenceExe,[]);log.push(precision+' '+equivalence);console.log(precision+': D0 exact equivalence PASS');
 for(const v of variants.filter(v=>v.method===12)) {
  const reasonExe=path.join(bin,'reasons_'+v.name+'_'+precision+'.exe'),adapterExe=path.join(bin,'adapter_'+v.name+'_'+precision+'.exe');
  compile([...defs(v,precision),'-I',core,path.join(dir,'test_reasons.c'),'-lm','-o',reasonExe]);
  log.push(v.name+' '+precision+' '+call(reasonExe,[]));
  compile([...defs(v,precision),'-I',core,path.join(dir,'test_adapter.c'),path.join(core,'blnn_core.c'),'-lm','-o',adapterExe]);
  log.push(v.name+' '+precision+' '+call(adapterExe,[]));console.log(v.name+' '+precision+': signed boundary/sector/speed/AW/learning invariants PASS');
 }
}
fs.writeFileSync(path.join(results,'host_tests.log'),log.join('\n'));
const runs=[],traces={};
for(const v of variants){
 const exe=path.join(bin,'plant_'+v.name+'.exe');compile([...defs(v,'float'),'-I',core,path.join(dir,'test_plant.c'),path.join(core,'blnn_core.c'),'-lm','-o',exe]);
 const records=call(exe,[]).trim().split(/\r?\n/).map(l=>JSON.parse(l));fs.writeFileSync(path.join(results,'plant_'+v.name+'.json'),JSON.stringify(records));
 const starts=new Map(records.filter(r=>r.type==='start').map(r=>[r.case,r]));
 for(const r of records.filter(r=>r.type==='result')){
  const {type,...parameters}=starts.get(r.case),full=r.complete&&r.motionSamples===16000;
  runs.push({...parameters,...r,variant:v.name,trackingRMSE_mm:full?r.partialTrackingRMSE_mm:null,syncRMS_mm:full?r.partialSyncRMS_mm:null});
  traces[v.name+'_'+r.case]=records.filter(t=>t.type==='trace'&&t.case===r.case);
 }
 console.log(v.name+': '+records.filter(r=>r.type==='result'&&r.complete).length+'/36 assumed-model runs completed; all outcomes retained');
}
assert.equal(runs.length,180);const matched=[];
for(let id=1;id<=36;id++){
 const rs=runs.filter(r=>r.case===id);assert.equal(rs.length,5);
 if(rs.every(r=>r.complete&&r.motionSamples===16000)){
  const by=Object.fromEntries(rs.map(r=>[r.variant,r]));matched.push({case:id,condition:by.D0.right_limit===800?'B':'A',...Object.fromEntries(['trackingRMSE_mm','syncRMS_mm'].map(k=>[k,{values:Object.fromEntries(rs.map(r=>[r.variant,r[k]])),learningAtOldSlew:by.D1[k]-by.D0[k],learningAtNewSlew:by.D3[k]-by.D2[k],slewAtOldLearning:by.D2[k]-by.D0[k],slewAtNewLearning:by.D3[k]-by.D1[k],interaction:(by.D3[k]-by.D2[k])-(by.D1[k]-by.D0[k])}]))});
 }
}
const mean=x=>x.length?x.reduce((s,v)=>s+v,0)/x.length:null;
const summary=variants.map(v=>{const rs=runs.filter(r=>r.variant===v.name),ok=rs.filter(r=>r.complete);return {variant:v.name,simulatedRuns:rs.length,complete:ok.length,faults:Object.fromEntries([...new Set(rs.filter(r=>!r.complete).map(r=>r.fault))].map(f=>[f,rs.filter(r=>r.fault===f).length])),learningMean_allRuns:mean(rs.map(r=>r.learningMean)),noPerformancePoolingAcrossUnequalCompletion:true};});
const effects=['A','B'].map(c=>{const ms=matched.filter(s=>s.condition===c);return {condition:c,nCompleteMatchedConfigurations:ms.length,metrics:Object.fromEntries(['trackingRMSE_mm','syncRMS_mm'].map(k=>[k,{mean:Object.fromEntries(variants.map(v=>[v.name,mean(ms.map(r=>r[k].values[v.name]))])),learningAtOldSlew_mean:mean(ms.map(r=>r[k].learningAtOldSlew)),learningAtNewSlew_mean:mean(ms.map(r=>r[k].learningAtNewSlew)),slewAtOldLearning_mean:mean(ms.map(r=>r[k].slewAtOldLearning)),slewAtNewLearning_mean:mean(ms.map(r=>r[k].slewAtNewLearning)),interaction_mean:mean(ms.map(r=>r[k].interaction))}]))};});
for(const [p,sha] of Object.entries(before))assert.equal(hash(p),sha,'Frozen file changed: '+p);
const result={date:'2026-10-12',status:'OFFLINE_DIAGNOSTIC_ONLY_NOT_RELEASED',protocol:'PROTOCOL.md',resultDirectory:resultName,compilationCount,hostTestsPassed:true,exactLegacyEquivalence:{float:true,double:true,stepsPerPrecision:90000},frozenFilesVerified:Object.keys(before).length,hardwareRuns:0,hexGenerated:false,variants,summary,effects,matchedConfigurations:matched,runs,limitations:['assumed coupled plant, NOT identified hardware','deterministic diagnostic grid, NOT independent statistical holdout','false/early-stop metrics kept only as partial diagnostics; no unequal-window RMSE comparisons','no MCU timing/WCET or hardware release approval','original frozen MATLAB v3, formal data and four old archives preserved']};
fs.writeFileSync(path.join(results,'diagnostic_results.json'),JSON.stringify(result,null,2));
const fmt=v=>v===null?'n/a':v.toFixed(4);
const md=['# 四组合离线诊断第一轮结果','','2026-10-12。仅主机与假设对象诊断，未烧录、未运行电机、未发布实物代码。','','## 程序检查','',`- ${compilationCount}次编译，启用-Wall/-Wextra/-Werror；通过float/double边界与学习规则检查。`,`- D0与冻结原实现：float和double各90000步逐项精确一致。`,`- ${Object.keys(before).length}份原件前后SHA256一致。`,'','## 假设对象结果（所有失败保留）','','| 版本 | 完整运行/36 | 模型中的故障计数 |','|---|---:|---|'];
for(const s of summary)md.push(`| ${s.variant} | ${s.complete}/36 | ${JSON.stringify(s.faults)} |`);
md.push('','固定窗口误差只在五方法全部完成的同一配置上比较；这不是实物成功率。','', '| 工况 | 完整匹配配置数 | 指标 | BLNN | D0 | D1 | D2 | D3 |','|---|---:|---|---:|---:|---:|---:|---:|');
for(const e of effects)for(const k of ['trackingRMSE_mm','syncRMS_mm'])md.push(`| ${e.condition} | ${e.nCompleteMatchedConfigurations} | ${k} | ${variants.map(v=>fmt(e.metrics[k].mean[v.name])).join(' | ')} |`);
md.push('','## 解释范围','','D1-D0与D3-D2检验学习因素，D2-D0与D3-D1检验变化率因素；交互项为两种学习效应之差。负值表示所列误差下降，不代表所有场景均改善。',`本次结果目录为${resultName}；逐配置结果及所有提前终止记录在该目录diagnostic_results.json中。首次results运行因测试驱动编译缩进警告中止，性能模拟尚未开始；失败日志保留，修复仅拆分两条统计语句，不改候选规则。`,'','本对象质量、摩擦、耦合和ESC动态是假设，不把这个结果称为论文独立验证，不预测上板成功率；不能根据完成配置子集隐藏故障。候选须进一步使用未参与选择的对象/场景与对应MATLAB实现复核，程序检查通过不等于闭环稳定性已证明。','','本轮仅建立因果诊断入口。未生成Keil工程或HEX，不安排正式18次采集，也不自动上传Git。','');
fs.writeFileSync(path.join(dir,'第一轮离线验证结果.md'),md.join('\n'));
console.log(JSON.stringify({status:result.status,hostTestsPassed:true,summary,effects,frozenFilesVerified:result.frozenFilesVerified},null,2));
