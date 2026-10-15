import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';
import assert from 'node:assert/strict';import {spawnSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
const dir=path.dirname(fileURLToPath(import.meta.url)),root=path.resolve(dir,'../../..');
const old=path.join(root,'experiment5_ca_v2/05_实验代码/准入A_S2_仅改收缩/eassy_E5Q_A_CA_S2_HW6');
const candidate=path.join(root,'experiment5_ca_v2/05_实验代码/准入A_S2_计算优化/eassy_E5Q_A_CA_S2OPT_HW6');
const probe=path.join(root,'experiment5_ca_v2/05_实验代码/测速V2_计算优化_不驱动电机/eassy_E5T2_CA_S2OPT_HW6');
const prev=path.resolve(dir,'../projection_round06_20261012');
const out=path.join(dir,process.argv[2]||'checks');assert(!fs.existsSync(out),'Preserve earlier check');fs.mkdirSync(out);
const hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const txt=p=>fs.readFileSync(p,'utf8');
function walk(p){return fs.readdirSync(p,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(p,e.name)):[path.join(p,e.name)]);}
let archiveFiles=0;for(const line of txt(path.join(root,'实验5整理_20261011/SHA256SUMS.txt')).trim().split(/\r?\n/)){
 const m=line.match(/^([a-f0-9]{64})  (.*)$/);assert(m);assert.equal(hash(path.join(root,'实验5整理_20261011',m[2])),m[1]);archiveFiles++;
}
const preserved=Object.fromEntries(walk(old).map(p=>[p,hash(p)]));
const oldProbe=path.join(root,'experiment5_ca_v2/05_实验代码/测速_不驱动电机/eassy_E5T_CA_S2_HW6');
for(const p of walk(oldProbe))preserved[p]=hash(p);
const recorded=path.join(root,'experiment5_ca_v2/01_原始数据/静止测速_S2/E5T_CA_S2_HW6_NO_DRIVE_run01.csv');
assert.equal(hash(recorded),'885a910580fbe03432dd65c91c951b16a575f6e2a0d332aa55e86dafdfc70202');preserved[recorded]=hash(recorded);
const changed=[];for(const p of walk(old).filter(p=>!p.includes(path.sep+'MDK-ARM'+path.sep))){
 const rel=path.relative(old,p);if(hash(p)!==hash(path.join(candidate,rel)))changed.push(rel.replaceAll('\\','/'));
}
assert.deepEqual(changed.sort(),['Task/blnn_core.c','Task/experiment5_formal_config.h']);
assert.equal(hash(path.join(candidate,'Task/blnn_core.c')),hash(path.join(probe,'Task/blnn_core.c')));
assert.equal(hash(path.join(old,'Task/blnn_core.c')),hash(path.join(probe,'Task/blnn_core_reference.inc')));
assert.equal(hash(path.join(oldProbe,'CAN-control/CAN_receive.c')),hash(path.join(probe,'CAN-control/CAN_receive.c')));
assert.equal(hash(path.join(oldProbe,'Task/experiment5_timing_fixtures.h')),hash(path.join(probe,'Task/experiment5_timing_fixtures.h')));
const motor=txt(path.join(probe,'Task/motor_task.c')).replace(/\s/g,'');assert(!motor.includes('g_exp5_drive_permit=1'));
assert.equal((motor.match(/CAN_cmd_3508\(/g)||[]).length,(motor.match(/CAN_cmd_3508\(0,0\)/g)||[]).length);
assert(txt(path.join(candidate,'Task/blnn_core.c')).includes('if(actuation.mask) learn=0;'));
const env={...process.env,PATH:'D:/MinGW/mingw64/bin;'+process.env.PATH},gcc='D:/MinGW/mingw64/bin/gcc.exe';let builds=0;const checks=[];
function call(exe,args,input){const r=spawnSync(exe,args,{cwd:dir,env,input,encoding:'utf8',maxBuffer:25e6});assert.equal(r.status,0,r.stderr||r.stdout||r.error?.message);return r.stdout;}
function compile(args){call(gcc,['-std=c99','-O2','-Wall','-Wextra','-Werror','-Wno-unused-function',...args]);builds++;}
const task=path.join(candidate,'Task'),oldTask=path.join(old,'Task'),probeTask=path.join(probe,'Task');
for(const precision of ['float','double']){
 const flags=precision==='double'?['-DE5_USE_DOUBLE']:[];
 const obj=path.join(out,precision+'_old.o'),wrap=path.join(out,precision+'_wrap.o'),growth=path.join(out,precision+'_growth.o');
 compile([...flags,'-De5_reset=e5_reset_legacy','-De5_step=e5_step_legacy','-I',oldTask,'-c',path.join(oldTask,'blnn_core.c'),'-o',obj]);
 compile([...flags,'-I',oldTask,'-I',prev,'-c',path.join(dir,'legacy_wrapper.c'),'-o',wrap]);
 compile([...flags,'-I',oldTask,'-c',path.join(dir,'growth_reference.c'),'-o',growth]);
 let exe=path.join(out,precision+'_trajectory.exe');compile([...flags,'-I',task,'-I',prev,path.join(dir,'test_equivalence.c'),path.join(task,'blnn_core.c'),obj,wrap,'-lm','-o',exe]);
 checks.push({precision,type:'90000-step exact S2 equivalence',result:call(exe,[]).trim()});
 exe=path.join(out,precision+'_extended.exe');compile([...flags,'-I',task,'-I',probeTask,path.join(dir,'test_equivalence_extended.c'),path.join(probeTask,'blnn_reference.c'),obj,wrap,growth,'-lm','-o',exe]);
 checks.push({precision,type:'unique-center, ties, growth and paired MCU reference schedule',result:call(exe,[]).trim()});
 exe=path.join(out,precision+'_fixtures.exe');compile([...flags,'-I',probeTask,path.resolve(dir,'../mcu_qualification_round07_20261012/test_timing_fixtures.c'),path.join(task,'blnn_core.c'),'-lm','-o',exe]);
 checks.push({precision,type:'All old 18000 synthetic fixtures',result:call(exe,[]).trim()});
}
for(const [p,h] of Object.entries(preserved))assert.equal(hash(p),h,'Earlier material changed');
const sourceHashes=Object.fromEntries([...walk(candidate),...walk(probe)].filter(p=>!p.includes(path.sep+'MDK-ARM'+path.sep)||p.endsWith('.uvprojx')).map(p=>[p,hash(p)]));
fs.writeFileSync(path.join(out,'verification.json'),JSON.stringify({date:'2026-10-13',builds,checks,changedSourceFiles:changed,archiveFilesUnchanged:archiveFiles,earlierMaterialUnchanged:true,sourceHashes,stateABIUnchanged:true,controllerPolicyUnchanged:true,boardExactEqualityPending:true,boardTimingPending:true,screen_us:600,motionReleased:false},null,2));
console.log(JSON.stringify({builds,checks,archiveFiles,stateABIUnchanged:true,controllerPolicyUnchanged:true,boardTimingPending:true},null,2));
