import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';import {fileURLToPath} from 'node:url';import crypto from 'node:crypto';
const dir=path.dirname(fileURLToPath(import.meta.url)),root=path.resolve(dir,'../../..');
const code=path.join(root,'experiment5_ca_v2/05_实验代码/S3R1_有界纠错_20261013');
const probe=path.join(code,'eassy_E5T6_S3R1_HW6_NO_DRIVE/Task'),s3=path.join(code,'eassy_E5R1_A_S3R1_HW6/Task'),blnn=path.join(code,'eassy_E5R1_A_BLNN_HW6/Task');
const hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const out=path.join(dir,process.argv[2]||'checks01');assert(!fs.existsSync(out));fs.mkdirSync(out);
const walk=p=>fs.readdirSync(p,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(p,e.name)):[path.join(p,e.name)]);
const original=path.join(root,'experiment5_ca_v2/05_实验代码/正式对照A_五方案_F5');
const preserved=Object.fromEntries([...walk(original),...walk(path.join(root,'experiment5_ca_v2/01_原始数据/正式对照A_五方案_F5'))].map(p=>[p,hash(p)]));
for(const f of ['blnn_core.c','blnn_core.h','experiment5_ca_actuator.h','diagnostic_config.h','experiment5_event_trace.h','experiment5_formal_metrics.h']) {
 assert.equal(hash(path.join(s3,f)),hash(path.join(blnn,f)));assert.equal(hash(path.join(s3,f)),hash(path.join(probe,f)));
}
assert.equal(hash(path.join(s3,'motor_task.c')),hash(path.join(blnn,'motor_task.c')));
for(const task of [s3,blnn])for(const f of ['experiment5_ca_actuator.h','experiment5_motion.h','experiment5_hw_profile.h','experiment5_formal_actuator.h','experiment5_motion_health.h']) {
 if(fs.existsSync(path.join(task,f)))assert.equal(hash(path.join(task,f)),hash(path.join(original,'04_S3/eassy_E5F2_A_S3_HW6/Task',f)));
}
const env={...process.env,PATH:'D:/MinGW/mingw64/bin;'+process.env.PATH};const tests=[];
function call(exe,args){const r=spawnSync(exe,args,{env,encoding:'utf8',maxBuffer:30e6});assert.equal(r.status,0,r.stderr+'\n'+r.stdout);return r.stdout;}
for(const precision of ['float','double']) {
 const exe=path.join(out,precision+'.exe');
 call('D:/MinGW/mingw64/bin/gcc.exe',['-std=c99','-O2','-Wall','-Wextra','-Werror','-Wno-unused-function',...(precision==='double'?['-DE5_USE_DOUBLE']:[]),'-I',probe,path.join(dir,'test_repair.c'),path.join(probe,'blnn_old.c'),'-lm','-o',exe]);
 tests.push({precision,result:call(exe,[]).trim()});
}
const traceExe=path.join(out,'trace.exe');
call('D:/MinGW/mingw64/bin/gcc.exe',['-std=c99','-O2','-Wall','-Wextra','-Werror','-I',s3,path.join(dir,'test_trace.c'),'-o',traceExe]);
tests.push({type:'EVENT48 ring and transmission',result:call(traceExe,[]).trim()});
for(const precision of ['float','double']) {
 const exe=path.join(out,'adapter_'+precision+'.exe');
 call('D:/MinGW/mingw64/bin/gcc.exe',['-std=c99','-O2','-Wall','-Wextra','-Werror','-Wno-unused-function',...(precision==='double'?['-DE5_USE_DOUBLE']:[]),'-I',s3,path.resolve(dir,'../projection_round06_20261012/test_adapter.c'),path.join(s3,'blnn_core.c'),'-lm','-o',exe]);
 tests.push({precision,type:'signedRPM allocator/core regression',result:call(exe,[]).trim()});
}
const assumed=[];
for(const [name,task,source,method]of [['BLNN',blnn,path.join(blnn,'blnn_core.c'),11],['oldS3',probe,path.join(probe,'blnn_old.inc'),12],['S3R1',s3,path.join(s3,'blnn_core.c'),12]]) {
 const exe=path.join(out,name+'_plant.exe');
 call('D:/MinGW/mingw64/bin/gcc.exe',['-std=c99','-O2','-Wall','-Wextra','-Werror','-Wno-unused-function','-DTEST_METHOD='+method,'-I',task,path.join(dir,'test_plant.c'),'-x','c',source,'-lm','-o',exe]);
 const rows=call(exe,[]).trim().split(/\r?\n/).map(s=>JSON.parse(s));
 fs.writeFileSync(path.join(out,name+'_assumed.json'),JSON.stringify(rows));
 assumed.push({name,results:rows.filter(r=>r.type==='result')});
}
fs.writeFileSync(path.join(out,'assumed_summary.json'),JSON.stringify({assumed,limitation:'Unidentified assumed plant; all faults retained. Not evidence of physical efficacy.'},null,2));
for(const [p,h]of Object.entries(preserved))assert.equal(hash(p),h);
const probeMotor=fs.readFileSync(path.join(probe,'motor_task.c'),'utf8');assert(!probeMotor.includes('g_exp5_drive_permit=1'));
assert.equal((probeMotor.match(/CAN_cmd_3508\(/g)||[]).length,(probeMotor.match(/CAN_cmd_3508\(0,0\)/g)||[]).length);
assert(fs.readFileSync(path.join(probe,'../CAN-control/CAN_receive.c'),'utf8').includes('M1=0;M2=0;'));
const sources=Object.fromEntries(walk(code).filter(p=>!p.includes(path.sep+'MDK-ARM'+path.sep)||p.endsWith('.uvprojx')).map(p=>[p,hash(p)]));
fs.writeFileSync(path.join(out,'verification.json'),JSON.stringify({date:'2026-10-13',tests,assumedComplete:assumed.map(v=>({name:v.name,complete:v.results.filter(r=>r.complete).length,total:v.results.length})),preserved,sources,allPassed:true,physicalBenefitProven:false,motionReleased:false,boardTimingPending:true},null,2));
console.log(JSON.stringify({tests,assumedComplete:assumed.map(v=>({name:v.name,complete:v.results.filter(r=>r.complete).length,total:v.results.length})),preservedFiles:Object.keys(preserved).length,allPassed:true,boardTimingPending:true},null,2));
