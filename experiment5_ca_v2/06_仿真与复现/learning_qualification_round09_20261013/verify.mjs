import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
const dir=path.dirname(fileURLToPath(import.meta.url)),root=path.resolve(dir,'../../..');
const prior=path.resolve(dir,'../projection_round06_20261012'),reference=path.join(prior,'core');
const code=path.join(root,'experiment5_ca_v2/05_实验代码');
const old=path.join(code,'准入A_S2_计算优化/eassy_E5Q_A_CA_S2OPT_HW6');
const variants=[{name:'S1',projection:0,folder:'准入A_S1_仅改学习/eassy_E5Q_A_CA_S1OPT_HW6'},
 {name:'S3',projection:1,folder:'准入A_S3_学习加收缩/eassy_E5Q_A_CA_S3OPT_HW6'}];
const probe=path.join(code,'测速S1S3_不驱动电机/eassy_E5T3_CA_S1S3OPT_HW6');
const out=path.join(dir,process.argv[2]||'checks');assert(!fs.existsSync(out),'Preserve earlier attempt');fs.mkdirSync(out);
const hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const txt=p=>fs.readFileSync(p,'utf8');const strip=s=>s.replace(/\/\*[\s\S]*?\*\//g,'').replace(/\/\/[^\n]*/g,'').replace(/\s/g,'');
function walk(p){return fs.readdirSync(p,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(p,e.name)):[path.join(p,e.name)]);}
let archive=0;for(const line of txt(path.join(root,'实验5整理_20261011/SHA256SUMS.txt')).trim().split(/\r?\n/)){
 const m=line.match(/^([a-f0-9]{64})  (.*)$/);assert(m);assert.equal(hash(path.join(root,'实验5整理_20261011',m[2])),m[1]);archive++;
}
const preserved={};for(const p of [...walk(old),...walk(path.join(root,'experiment5_ca_v2/01_原始数据')),path.join(prior,'data/results.json')])preserved[p]=hash(p);
const allowed=['Task/blnn_core.c','Task/blnn_core.h','Task/experiment5_ca_actuator.h','Task/experiment5_event_trace.h','Task/experiment5_formal_config.h','Task/motor_task.c'];
const sourceChanges=[];
for(const v of variants){const base=path.join(code,v.folder),task=path.join(base,'Task'),changed=[];
 for(const p of walk(old).filter(p=>!p.includes(path.sep+'MDK-ARM'+path.sep))){const rel=path.relative(old,p).replaceAll('\\','/');if(hash(p)!==hash(path.join(base,rel)))changed.push(rel);}
 assert.deepEqual(changed.sort(),allowed);sourceChanges.push({variant:v.name,changed,added:'Task/diagnostic_config.h'});
 assert.equal(strip(txt(path.join(task,'experiment5_ca_actuator.h'))),strip(txt(path.join(reference,'experiment5_ca_actuator.h'))));
 let motor=txt(path.join(task,'motor_task.c'));
 motor=motor.replace('memset(&event_row,0,sizeof(event_row));','');
 motor=motor.replace(/event_row\.v\[3[2-6]\]=[^;]+;/g,'');
 motor=motor.replace('channels[88]=(armed&&!done&&!fault)?(float)output.diagnostic_reason:0;','channels[88]=measured_velocity[0]-.30f*measured_velocity[1];');
 motor=motor.replace('channels[89]=(armed&&!done&&!fault)?output.admitted_fraction:0;','channels[89]=measured_velocity[0]+.30f*measured_velocity[1];');
 assert.equal(strip(motor),strip(txt(path.join(old,'Task/motor_task.c'))),'Motor/control safety changed outside logging');
}
const probeMotor=strip(txt(path.join(probe,'Task/motor_task.c')));assert(!probeMotor.includes('g_exp5_drive_permit=1'));
assert.equal((probeMotor.match(/CAN_cmd_3508\(/g)||[]).length,(probeMotor.match(/CAN_cmd_3508\(0,0\)/g)||[]).length);
assert(txt(path.join(probe,'CAN-control/CAN_receive.c')).includes('M1=0;M2=0; /* TIMING PROBE'));
const env={...process.env,PATH:'D:/MinGW/mingw64/bin;'+process.env.PATH};let builds=0;const tests=[];
function call(exe,args=[],input){const r=spawnSync(exe,args,{env,cwd:dir,encoding:'utf8',input,maxBuffer:30e6});if(r.status!==0){fs.writeFileSync(path.join(out,'failure.log'),r.stderr+'\n'+r.stdout);throw Error(r.stderr||r.stdout||r.error?.message);}return r.stdout;}
function compile(args){call('D:/MinGW/mingw64/bin/gcc.exe',['-std=c99','-O2','-Wall','-Wextra','-Werror','-Wno-unused-function',...args]);builds++;}
for(const v of variants){const task=path.join(code,v.folder,'Task');
 for(const precision of ['float','double']){const flags=precision==='double'?['-DE5_USE_DOUBLE']:[];
  const prefix=v.name+'_'+precision,ref=path.join(out,prefix+'_ref.o'),wrap=path.join(out,prefix+'_wrap.o');
  const factors=['-DDIAG_NEW_LEARNING=1','-DDIAG_BALANCED_CONTRACTION='+v.projection];
  compile([...flags,...factors,'-De5_reset=e5_reset_legacy','-De5_step=e5_step_legacy','-I',reference,'-c',path.join(reference,'blnn_core.c'),'-o',ref]);
  compile([...flags,'-I',reference,'-c',path.join(dir,'legacy_wrapper.c'),'-o',wrap]);
  let exe=path.join(out,prefix+'_equivalence.exe');compile([...flags,'-I',task,path.join(dir,'test_equivalence.c'),path.join(task,'blnn_core.c'),ref,wrap,'-lm','-o',exe]);
  tests.push({variant:v.name,precision,type:'90000-step exact full offline policy equivalence',result:call(exe).trim()});
  exe=path.join(out,prefix+'_adapter.exe');compile([...flags,'-I',task,path.join(prior,'test_adapter.c'),path.join(task,'blnn_core.c'),'-lm','-o',exe]);
  tests.push({variant:v.name,precision,type:'full adapter and core safety/learning invariants',result:call(exe).trim()});
  exe=path.join(out,prefix+'_reasons.exe');compile([...flags,'-I',task,path.join(prior,'test_reasons.c'),'-lm','-o',exe]);
  tests.push({variant:v.name,precision,type:'pure-rate versus mixed/hard/speed/reversal classification',result:call(exe).trim()});
 }
 const exe=path.join(out,v.name+'_plant.exe');compile(['-DTEST_METHOD=12','-I',task,path.join(prior,'test_plant.c'),path.join(task,'blnn_core.c'),'-lm','-o',exe]);
 const result=call(exe).trim().split(/\r?\n/).map(s=>JSON.parse(s));
 assert.deepEqual(result,JSON.parse(txt(path.join(prior,'data/'+(v.name==='S1'?'S1_learning':'S3_both')+'.json'))));
 tests.push({variant:v.name,type:'36 uncalibrated assumed-model cases, faults retained',exactPriorResults:true,complete:result.filter(r=>r.type==='result'&&r.complete).length});
}
const probeTask=path.join(probe,'Task');for(const precision of ['float','double']){
 const flags=precision==='double'?['-DE5_USE_DOUBLE']:[],exe=path.join(out,'probe_'+precision+'.exe');
 compile([...flags,'-I',probeTask,path.join(dir,'test_probe.c'),...['blnn_core.c','blnn_s1.c','blnn_reference_s1.c','blnn_reference_s3.c'].map(f=>path.join(probeTask,f)),'-lm','-o',exe]);
 tests.push({precision,type:'entire dual-variant probe schedule',result:call(exe).trim()});
}
const trace=path.join(out,'trace.exe');compile(['-I',probeTask,path.join(dir,'test_trace.c'),'-o',trace]);tests.push({type:'EVENT40 ring/TC retry/serialization tests',result:call(trace).trim()});
for(const [p,h]of Object.entries(preserved))assert.equal(hash(p),h,'Earlier source/data changed');
const sources=Object.fromEntries([...variants.flatMap(v=>walk(path.join(code,v.folder))),...walk(probe)].filter(p=>!p.includes(path.sep+'MDK-ARM'+path.sep)||p.endsWith('.uvprojx')).map(p=>[p,hash(p)]));
fs.writeFileSync(path.join(out,'verification.json'),JSON.stringify({date:'2026-10-13',builds,tests,sourceChanges,sources,preservedFiles:Object.keys(preserved).length,archiveFilesUnchanged:archive,allChecksPassed:true,policyExactlyMatchesOfflineFactors:true,motionControlAndSafetyUnchanged:true,EVENT40Verified:true,dualProbeAlwaysZero:true,boardTimingAndEqualityPending:true,motionReleased:false},null,2));
console.log(JSON.stringify({builds,tests,archive,boardTimingAndEqualityPending:true,motionReleased:false},null,2));
