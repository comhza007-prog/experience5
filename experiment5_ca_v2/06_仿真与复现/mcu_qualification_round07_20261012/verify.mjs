import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const dir=path.dirname(fileURLToPath(import.meta.url)),root=path.resolve(dir,'../../..');
const previous=path.resolve(dir,'../projection_round06_20261012');
const source=path.join(root,'experiment5_ca_v2/05_实验代码/诊断A_旧CA_事件回放/eassy_E5D_A_CA_HW6');
const candidate=path.join(root,'experiment5_ca_v2/05_实验代码/准入A_S2_仅改收缩/eassy_E5Q_A_CA_S2_HW6');
const probe=path.join(root,'experiment5_ca_v2/05_实验代码/测速_不驱动电机/eassy_E5T_CA_S2_HW6');
const out=path.join(dir,process.argv[2]||'host_checks');assert(!fs.existsSync(out));fs.mkdirSync(out);
const hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const text=p=>fs.readFileSync(p,'utf8').replace(/\r\n/g,'\n');
const strip=s=>s.replace(/\/\*[\s\S]*?\*\//g,'').replace(/\/\/[^\n]*/g,'').replace(/\s+/g,'');
let preserved=0;
for(const line of text(path.join(root,'实验5整理_20261011/SHA256SUMS.txt')).trim().split('\n')){
 const m=line.match(/^([0-9a-f]{64})  (.*)$/);assert(m);assert.equal(hash(path.join(root,'实验5整理_20261011',m[2])),m[1]);preserved++;
}
function walk(p){return fs.readdirSync(p,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(p,e.name)):[path.join(p,e.name)]);}
const changed=[];
for(const p of walk(source).filter(p=>!p.includes(path.sep+'MDK-ARM'+path.sep))){
 const rel=path.relative(source,p),dest=path.join(candidate,rel);assert(fs.existsSync(dest));
 if(hash(p)!==hash(dest))changed.push(rel.replaceAll('\\','/'));
}
assert.deepEqual(changed.sort(),['Task/experiment5_ca_actuator.h','Task/experiment5_formal_config.h','Task/motor_task.c']);
assert.equal(strip(text(path.join(source,'Task/motor_task.c'))),strip(text(path.join(candidate,'Task/motor_task.c'))));
const ca=text(path.join(candidate,'Task/experiment5_ca_actuator.h'));
const original=text(path.join(source,'Task/experiment5_ca_actuator.h'));
const matchFunction=(s,name,next)=>s.slice(s.indexOf('static int '+name+'('),s.indexOf('static int '+next+'('));
const oldRay=original.slice(original.indexOf('static int e5_ca_contract('),original.indexOf('static int e5_ca_allocate('));
const newRay=ca.slice(ca.indexOf('static int e5_ca_contract_ray('),ca.indexOf('/* S2 QUALIFICATION:'));
assert.equal(strip(newRay.replace('e5_ca_contract_ray(', 'e5_ca_contract(')),strip(oldRay));
assert.equal(strip(ca.slice(ca.indexOf('static int e5_ca_allocate('))),strip(original.slice(original.indexOf('static int e5_ca_allocate('))));
let hostWrapper=matchFunction(text(path.join(previous,'core/experiment5_ca_actuator.h')),'e5_ca_contract','e5_ca_allocate');
hostWrapper=hostWrapper.replace('#if DIAG_BALANCED_CONTRACTION','').replace(/#else[\s\S]*?#endif/,'').replace('(DIAG_SECTOR_FRACTION*40)','10');
assert.equal(strip(matchFunction(ca,'e5_ca_contract','e5_ca_allocate')),strip(hostWrapper));
assert.equal(hash(path.join(source,'Task/blnn_core.c')),hash(path.join(candidate,'Task/blnn_core.c')));
assert(text(path.join(candidate,'Task/blnn_core.c')).includes('if(actuation.mask) learn=0;'));
const env={...process.env,PATH:'D:/MinGW/mingw64/bin;'+process.env.PATH};
let compilations=0;const tests=[];
function call(exe,args,input){const r=spawnSync(exe,args,{env,encoding:'utf8',input,maxBuffer:20e6});assert.equal(r.status,0,r.stderr||r.stdout||r.error?.message);return r.stdout;}
function compile(args){call('D:/MinGW/mingw64/bin/gcc.exe',['-std=c99','-O2','-Wall','-Wextra','-Werror','-Wno-unused-function',...args]);compilations++;}
const task=path.join(candidate,'Task'),core=path.join(previous,'core');
const record=JSON.parse(text(path.resolve(dir,'../event_logger_round05_20261012/record_analysis_aafbaf477c33.json')));
assert.equal(hash(record.source),record.sourceSHA256);
const input=record.event.records.filter(r=>r.complete).map(r=>[r.index,...r.values].join(' ')).join('\n')+'\n';
const checks=JSON.parse(text(path.join(previous,'data/recorded_replay.json')));
for(const precision of ['float','double']){
 const flags=precision==='double'?['-DE5_USE_DOUBLE']:[],aliases=['-De5_reset=e5_reset_legacy','-De5_step=e5_step_legacy'];
 const obj=path.join(out,precision+'.o'),wrap=path.join(out,precision+'_wrapper.o');
 compile([...flags,...aliases,'-DDIAG_BALANCED_CONTRACTION=1','-DDIAG_NEW_LEARNING=0','-I',core,'-c',path.join(core,'blnn_core.c'),'-o',obj]);
 compile([...flags,...aliases,'-I',core,'-c',path.join(previous,'legacy_wrapper.c'),'-o',wrap]);
 const eq=path.join(out,'equivalence_'+precision+'.exe');
 compile([...flags,'-I',task,'-I',previous,path.join(previous,'test_equivalence.c'),path.join(task,'blnn_core.c'),obj,wrap,'-lm','-o',eq]);
 tests.push({precision,test:'90000-step exact S2 host/production equivalence',output:call(eq,[]).trim()});
 const stress=path.join(out,'stress_'+precision+'.exe');
 compile([...flags,'-DDIAG_BALANCED_CONTRACTION=1','-I',task,path.join(previous,'test_projection.c'),'-o',stress]);
 tests.push({precision,test:'100000 same-state exceptional safety/distance',output:call(stress,[]).trim()});
 const exe=path.join(out,'recorded_'+precision+'.exe');
 compile([...flags,'-I',task,path.join(previous,'replay_allocator.c'),'-o',exe]);
 const replay=call(exe,[],input).trim().split(/\r?\n/).map(s=>JSON.parse(s));
 assert.deepEqual(replay,checks.find(c=>c.precision===precision&&c.projection===1).output);
 tests.push({precision,test:'127 complete recorded frames exact S2 equivalence',frames:replay.length});
}
const probeTask=path.join(probe,'Task');
for(const p of walk(candidate).filter(p=>!p.includes(path.sep+'MDK-ARM'+path.sep))){
 const rel=path.relative(candidate,p),dest=path.join(probe,rel);assert(fs.existsSync(dest));
 if(!['Task/motor_task.c','Task/experiment5_formal_config.h','CAN-control/CAN_receive.c'].includes(rel.replaceAll('\\','/')))assert.equal(hash(p),hash(dest),rel);
}
const probeMotor=strip(text(path.join(probeTask,'motor_task.c')));
assert(!probeMotor.includes('g_exp5_drive_permit=1'));
assert(!probeMotor.includes('e5_formal_finalize('));
assert.equal((probeMotor.match(/CAN_cmd_3508\(/g)||[]).length,(probeMotor.match(/CAN_cmd_3508\(0,0\)/g)||[]).length);
assert(text(path.join(probe,'CAN-control/CAN_receive.c')).includes('M1=0;M2=0; /* TIMING PROBE'));
const fixtures=path.join(out,'fixtures.exe');
compile(['-I',probeTask,path.join(dir,'test_timing_fixtures.c'),path.join(probeTask,'blnn_core.c'),'-lm','-o',fixtures]);
tests.push({test:'stationary timing fixtures: exhaustive scheduled inputs',output:call(fixtures,[]).trim()});
const sourceHashes=Object.fromEntries([...walk(candidate),...walk(probe)].filter(p=>!p.includes(path.sep+'MDK-ARM'+path.sep)||p.endsWith('.uvprojx')).map(p=>[p,hash(p)]));
fs.writeFileSync(path.join(out,'verification.json'),JSON.stringify({preservedArchiveFiles:preserved,changedCandidateSourceFiles:changed,motorLogicUnchanged:true,oldLearningByteIdentical:true,compilations,tests,sourceHashes,probeAlwaysZeroCommand:true,boardTimingMeasured:false,formalHardwareReleased:false},null,2));
console.log(JSON.stringify({preserved,compilations,tests,probeAlwaysZeroCommand:true,boardTimingMeasured:false},null,2));
