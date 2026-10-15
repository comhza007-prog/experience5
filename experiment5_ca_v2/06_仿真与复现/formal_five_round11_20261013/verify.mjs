import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
const dir=path.dirname(fileURLToPath(import.meta.url)),root=path.resolve(dir,'../../..');
const prior=path.resolve(dir,'../projection_round06_20261012'),reference=path.join(prior,'core');
const code=path.join(root,'experiment5_ca_v2/05_实验代码');
const master=path.join(code,'准入A_S3_搜索计算优化V2/eassy_E5Q_A_CA_S3OPT2_HW6');
const probe=path.join(code,'测速五方案_F5_不驱动电机/eassy_E5T5_F5_HW6'),probeTask=path.join(probe,'Task');
const rows=[['00_BLNN','BLNN',11,0,0,65511,'BLNN'],['01_S0','S0',12,0,0,65612,'S0_old'],
 ['02_S1','S1',12,1,0,65712,'S1_learning'],['03_S2','S2',12,0,1,65812,'S2_projection'],['04_S3','S3',12,1,1,65912,'S3_both']];
const variants=rows.map(([ord,name,method,learning,projection,build,priorName])=>({ord,name,method,learning,projection,build,priorName,base:path.join(code,'正式对照A_五方案_F5',ord,'eassy_E5F2_A_'+name+'_HW6')}));
const out=path.join(dir,process.argv[2]||'checks');assert(!fs.existsSync(out),'Preserve earlier attempt');fs.mkdirSync(out);
const hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex'),txt=p=>fs.readFileSync(p,'utf8');
const strip=s=>s.replace(/\/\*[\s\S]*?\*\//g,'').replace(/\/\/[^\n]*/g,'').replace(/\s/g,'');
function walk(p){return fs.readdirSync(p,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(p,e.name)):[path.join(p,e.name)]);}
let archive=0;for(const line of txt(path.join(root,'实验5整理_20261011/SHA256SUMS.txt')).trim().split(/\r?\n/)){
 const m=line.match(/^([a-f0-9]{64})  (.*)$/);assert(m);assert.equal(hash(path.join(root,'实验5整理_20261011',m[2])),m[1]);archive++;}
const priorVerified=JSON.parse(txt(path.resolve(dir,'../search_timing_round10_20261013/checks_attempt01/verification.json')));
for(const [p,h]of Object.entries(priorVerified.sources))assert.equal(hash(p),h,'Qualified source changed');
const preserved={};for(const p of [...walk(master),...walk(path.join(root,'experiment5_ca_v2/01_原始数据')),path.join(prior,'data/results.json')])preserved[p]=hash(p);
const common=[];for(const v of variants) {
 const changed=[];for(const p of walk(master).filter(p=>!p.includes(path.sep+'MDK-ARM'+path.sep))){
  const rel=path.relative(master,p).replaceAll('\\','/');if(hash(p)!==hash(path.join(v.base,rel)))changed.push(rel);}
 assert.deepEqual(changed.sort(),['Task/experiment5_event_trace.h','Task/experiment5_formal_config.h','Task/motor_task.c']);
 assert.equal(hash(path.join(v.base,'Task/blnn_core.c')),hash(path.join(master,'Task/blnn_core.c')));
 assert.equal(hash(path.join(v.base,'Task/experiment5_ca_actuator.h')),hash(path.join(master,'Task/experiment5_ca_actuator.h')));
 const cfg=txt(path.join(v.base,'Task/experiment5_formal_config.h'));
 for(const [key,val]of Object.entries({E5_SELECTED_METHOD:v.method,E5_SELECTED_BUILD:v.build,E5_SELECTED_NEW_LEARNING:v.learning,E5_SELECTED_BALANCED:v.projection,E5_SELECTED_VARIANT:variants.indexOf(v),E5_FORMAL_SCHEMA:4466}))
  assert(cfg.includes('#define '+key+' '+val+'U'));
 for(const p of walk(v.base).filter(p=>!p.includes(path.sep+'MDK-ARM'+path.sep)&&!p.endsWith('experiment5_formal_config.h'))){
  const rel=path.relative(v.base,p);assert.equal(hash(p),hash(path.join(variants[0].base,rel)),'Five-method scaffold differs: '+rel);}
 let motor=txt(path.join(v.base,'Task/motor_task.c'));
 motor=motor.replace('#include "experiment5_formal_metrics.h"','')
  .replace('int16_t before_guard[2]={0,0};','int16_t before_guard[2]={0,0};int32_t guard_delta[2]={0,0};')
  .replace('before_guard[0]=0;before_guard[1]=0;','before_guard[0]=0;before_guard[1]=0;guard_delta[0]=0;guard_delta[1]=0;')
  .replace('if(speed_guard_mask&(1U<<ch))speed_guard_count[ch]++;','if(speed_guard_mask&(1U<<ch))speed_guard_count[ch]++;guard_delta[ch]=(int32_t)command[ch]-(int32_t)before_guard[ch];')
  .replace('int16_t diagnostic_previous_delta[2]={0,0};','')
  .replaceAll('event_previous_delta[0]=diagnostic_previous_delta[0];','event_previous_delta[0]=controller.ca_delta[0];')
  .replaceAll('event_previous_delta[1]=diagnostic_previous_delta[1];','event_previous_delta[1]=controller.ca_delta[1];')
  .replace('event_wanted[ch]=e5_formal_pre_guard_wanted(E5_SELECTED_METHOD,&output,before_guard,ch);','event_wanted[ch]=(int16_t)output.ca_before_guard[ch];')
  .replace('event_row.v[23]=e5_formal_effective_learning(E5_SELECTED_METHOD,&output);','event_row.v[23]=output.learning_gate;')
  .replace('event_row.v[32]=e5_formal_cause(E5_SELECTED_METHOD,&output);','event_row.v[32]=(float)output.diagnostic_reason;')
  .replace('event_row.v[33]=e5_formal_rho(E5_SELECTED_METHOD,&output);','event_row.v[33]=output.admitted_fraction;')
  .replace('event_row.v[34]=e5_formal_pre_learning(E5_SELECTED_METHOD,&output);','event_row.v[34]=output.learning_before_reason;')
  .replace('event_row.v[35]=e5_formal_pre_guard_wanted(E5_SELECTED_METHOD,&output,before_guard,0);','event_row.v[35]=output.ca_before_guard[0];')
  .replace('event_row.v[36]=e5_formal_pre_guard_wanted(E5_SELECTED_METHOD,&output,before_guard,1);','event_row.v[36]=output.ca_before_guard[1];')
  .replace(/event_row\.v\[3[7-9]\]=[^;]+;/g,'')
  .replace('if(!fault)for(ch=0;ch<2;ch++)diagnostic_previous_delta[ch]=(int16_t)output.ca_delta[ch];','')
  .replace('e5_formal_effective_learning(E5_SELECTED_METHOD,&output):0.0f;','(E5_SELECTED_METHOD==E5_BLNN?1.0f:output.learning_gate):0.0f;')
  .replace('channels[88]=(armed&&!done&&!fault)?e5_formal_cause(E5_SELECTED_METHOD,&output):0;','channels[88]=(armed&&!done&&!fault)?(float)output.diagnostic_reason:0;')
  .replace('channels[89]=(armed&&!done&&!fault)?e5_formal_rho(E5_SELECTED_METHOD,&output):0;','channels[89]=(armed&&!done&&!fault)?output.admitted_fraction:0;')
  .replace('channels[90]=(float)E5_SELECTED_VARIANT;channels[91]=(float)E5_SELECTED_NEW_LEARNING;','channels[90]=(float)before_guard[0];channels[91]=(float)before_guard[1];')
  .replace('channels[92]=(float)E5_SELECTED_BALANCED;channels[93]=(float)E5_FORMAL_SCHEMA;','channels[92]=(float)guard_delta[0];channels[93]=(float)guard_delta[1];');
 assert.equal(strip(motor),strip(txt(path.join(master,'Task/motor_task.c'))),'Non-observational motor change');
 common.push({variant:v.name,onlyConfiguredFactorsChange:true,motorControlAndSafetyUnchanged:true});}
const probeMotor=strip(txt(path.join(probeTask,'motor_task.c')));
assert(!probeMotor.includes('g_exp5_drive_permit=1'));
assert.equal((probeMotor.match(/CAN_cmd_3508\(/g)||[]).length,(probeMotor.match(/CAN_cmd_3508\(0,0\)/g)||[]).length);
assert.equal(hash(path.join(probe,'CAN-control/CAN_receive.c')),hash(path.join(code,'测速S1S3_V2_不驱动电机/eassy_E5T4_CA_S1S3OPT2_HW6/CAN-control/CAN_receive.c')));
assert.equal(hash(path.join(probeTask,'blnn_core.c')),hash(path.join(master,'Task/blnn_core.c')));
assert.equal(hash(path.join(probeTask,'experiment5_ca_actuator.h')),hash(path.join(master,'Task/experiment5_ca_actuator.h')));
assert.equal(hash(path.join(probeTask,'experiment5_formal_metrics.h')),hash(path.join(variants[0].base,'Task/experiment5_formal_metrics.h')));
const env={...process.env,PATH:'D:/MinGW/mingw64/bin;'+process.env.PATH};let builds=0;const tests=[];
function call(exe,args=[],input){const r=spawnSync(exe,args,{env,cwd:dir,encoding:'utf8',input,maxBuffer:30e6});if(r.status!==0){
 fs.writeFileSync(path.join(out,'failure.log'),r.stderr+'\n'+r.stdout);throw Error(r.stderr||r.stdout||r.error?.message);}return r.stdout;}
function compile(args){call('D:/MinGW/mingw64/bin/gcc.exe',['-std=c99','-O2','-Wall','-Wextra','-Werror','-Wno-unused-function',...args]);builds++;}
for(const v of variants){const task=path.join(v.base,'Task');
 for(const precision of ['float','double']){const flags=precision==='double'?['-DE5_USE_DOUBLE']:[];
  const prefix=v.name+'_'+precision,ref=path.join(out,prefix+'_ref.o'),wrap=path.join(out,prefix+'_wrap.o');
  const factors=['-DDIAG_NEW_LEARNING='+v.learning,'-DDIAG_BALANCED_CONTRACTION='+v.projection];
  compile([...flags,...factors,'-De5_reset=e5_reset_legacy','-De5_step=e5_step_legacy','-I',reference,'-c',path.join(reference,'blnn_core.c'),'-o',ref]);
  compile([...flags,'-I',reference,'-c',path.join(dir,'legacy_wrapper.c'),'-o',wrap]);
  let exe=path.join(out,prefix+'_equivalence.exe');compile([...flags,'-I',task,path.join(dir,'test_equivalence.c'),path.join(task,'blnn_core.c'),ref,wrap,'-lm','-o',exe]);
  tests.push({variant:v.name,precision,type:'90000-step full exact policy regression',result:call(exe).trim()});
  exe=path.join(out,prefix+'_adapter.exe');compile([...flags,'-I',task,path.join(prior,'test_adapter.c'),path.join(task,'blnn_core.c'),'-lm','-o',exe]);
  tests.push({variant:v.name,precision,type:'full guard/core invariants',result:call(exe).trim()});
  exe=path.join(out,prefix+'_reasons.exe');compile([...flags,'-I',task,path.join(prior,'test_reasons.c'),'-lm','-o',exe]);
  tests.push({variant:v.name,precision,type:'explicit reason fixtures',result:call(exe).trim()});
  exe=path.join(out,prefix+'_search.exe');compile([...flags,...factors,'-I',probeTask,path.join(dir,'test_search.c'),'-lm','-o',exe]);
  tests.push({variant:v.name,precision,type:'600000 each exact allocator/direct-exception/sector-cache comparisons',result:call(exe).trim()});
 }
 const exe=path.join(out,v.name+'_plant.exe');compile(['-DTEST_METHOD='+v.method,'-I',task,path.join(prior,'test_plant.c'),path.join(task,'blnn_core.c'),'-lm','-o',exe]);
 const result=call(exe).trim().split(/\r?\n/).map(s=>JSON.parse(s));
 assert.deepEqual(result,JSON.parse(txt(path.join(prior,'data/'+v.priorName+'.json'))));
 tests.push({variant:v.name,type:'36 assumed-model cases, retain failures',exactPriorResults:true,complete:result.filter(r=>r.type==='result'&&r.complete).length});}
for(const precision of ['float','double']){
 const flags=precision==='double'?['-DE5_USE_DOUBLE']:[],exe=path.join(out,'probe_'+precision+'.exe');
 compile([...flags,'-I',probeTask,path.join(dir,'test_probe.c'),...['blnn_core.c','blnn_opt_s0.c','blnn_opt_s1.c','blnn_opt_s2.c','blnn_ref_s0.c','blnn_ref_s1.c','blnn_ref_s2.c','blnn_ref_s3.c'].map(f=>path.join(probeTask,f)),'-lm','-o',exe]);
 tests.push({precision,type:'entire five-method board probe schedule',result:call(exe).trim()});
 const metrics=path.join(out,'metrics_'+precision+'.exe');
 compile([...flags,'-I',probeTask,path.join(dir,'test_metrics.c'),'-o',metrics]);
 tests.push({precision,type:'read-only method-aware metric semantics',result:call(metrics).trim()});}
const trace=path.join(out,'trace.exe');compile(['-I',path.join(variants[0].base,'Task'),path.join(dir,'test_trace.c'),'-o',trace]);
tests.push({type:'fixed-time shared EVENT40 ring/TC/serialization',result:call(trace).trim()});
for(const [p,h]of Object.entries(preserved))assert.equal(hash(p),h,'Earlier code/data changed');
for(const [p,h]of Object.entries(priorVerified.sources))assert.equal(hash(p),h,'Earlier qualified source changed');
const sources=Object.fromEntries([...variants.flatMap(v=>walk(v.base)),...walk(probe)].filter(p=>!p.includes(path.sep+'MDK-ARM'+path.sep)||p.endsWith('.uvprojx')).map(p=>[p,hash(p)]));
fs.writeFileSync(path.join(out,'verification.json'),JSON.stringify({date:'2026-10-13',builds,tests,common,sources,preservedFiles:Object.keys(preserved).length,archiveFilesUnchanged:archive,allChecksPassed:true,allFivePolicyResultsExactlyPreserved:true,motorControlAndSafetyUnchanged:true,commonReadOnlyTelemetrySchema:4466,fixedEventTrigger_ms:5000,dualProbeAlwaysZero:true,boardTimingAndEqualityPending:true,formalMotionReleased:false},null,2));
console.log(JSON.stringify({builds,tests,archive,boardTimingAndEqualityPending:true,formalMotionReleased:false},null,2));
