import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const dir=path.dirname(fileURLToPath(import.meta.url)),root=path.resolve(dir,'../..');
const prior=path.join(root,'05_实验代码/自动监视_故障保留回放_20261014/eassy_E5REPLAY2_A_S3R2_HW6');
const ordinary=path.join(root,'05_实验代码/自动监视_反馈辨识_20261014/eassy_E5MODEL_A_BLNN_HW6');
const fresh=path.join(root,'05_实验代码/辨识Q0_零扰动记录_20261014/eassy_E5ID_Q0_A_BLNN_HW6'),task=path.join(fresh,'Task');
const hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const read=p=>fs.readFileSync(p,'utf8').replaceAll('\r\n','\n');
const env={...process.env,PATH:'D:/MinGW/mingw64/bin;'+process.env.PATH},checks=[];
function run(cmd,args){const r=spawnSync(cmd,args,{cwd:dir,env,encoding:'utf8'});assert.equal(r.status,0,r.stdout+r.stderr);if(r.stdout.trim())checks.push(r.stdout.trim());}
for(const precision of ['float','double']){
 const exe=path.join(dir,'test_native_'+precision+'.exe');
 run('D:/MinGW/mingw64/bin/gcc.exe',['-std=c99','-O2','-Wall','-Wextra','-Werror','-Wno-unused-function',...(precision==='double'?['-DE5_USE_DOUBLE']:[]),'-I',task,'test_native.c','baseline_wrapper.c',path.join(task,'blnn_core.c'),'-lm','-o',exe]);
 run(exe,[path.join(dir,'native_'+precision+'.bin')]);
 run(process.execPath,['test_decode.mjs',path.join(dir,'native_'+precision+'.bin')]);
}
run('pwsh',['-NoProfile','-File','test_host.ps1']);
assert.equal(hash(path.join(dir,'baseline_core.inc')),hash(path.join(ordinary,'Task/blnn_core.c')));
for(const f of ['blnn_core.c','blnn_core.h','experiment5_formal_actuator.h','experiment5_motion.h','online_protocol.h'])assert.equal(hash(path.join(task,f)),hash(path.join(ordinary,'Task',f)),f);
const macros=s=>s.match(/^#define E5_\w+ .+$/gm).filter(x=>!/^#define E5_(SELECTED_BUILD|FORMAL_SCHEMA) /.test(x));
assert.deepEqual(macros(read(path.join(task,'experiment5_formal_config.h'))),macros(read(path.join(ordinary,'Task/experiment5_formal_config.h'))));
let unchanged=0;
function walk(relative){for(const f of fs.readdirSync(path.join(prior,relative),{withFileTypes:true})){
 const next=path.join(relative,f.name);if(f.isDirectory())walk(next);
 else if(!['Task/motor_task.c','Task/experiment5_formal_config.h'].includes(next.replaceAll('\\','/'))){assert.equal(hash(path.join(prior,next)),hash(path.join(fresh,next)),next);unchanged++;}
}}
for(const folder of ['Task','Core','Drivers','Middlewares','CAN-control'])walk(folder);
const old=read(path.join(prior,'Task/motor_task.c')),motor=read(path.join(task,'motor_task.c'));
function block(s,a,b){const i=s.indexOf(a),j=s.indexOf(b,i);assert(i>=0&&j>i,a);return s.slice(i,j);}
for(const [a,b] of [
 ['static uint32_t health(', 'void motor_task('],
 ['        trace_row.ms=now;','                    id_started='],
 ['        if(g_exp5_abort) fault|=32U;','                    input.raw_rpm[0]='],
 ['                    core_begin=DWT->CYCCNT;','                    if(!e5_replay_after'],
 ['        /* Check time budget BEFORE enqueueing','        previous_command[0]=command[0];']
]){
 if(a==='        trace_row.ms=now;'){
  assert.equal(block(motor,a,'                    id_started='),block(old,a,'                }\n            }\n        }\n        if(g_exp5_abort)'));
 }else if(a==='                    core_begin=DWT->CYCCNT;'){
  assert.equal(block(motor,a,'                }\n            }\n        }\n        /* Check time'),block(old,a,b));
 }else if(a==='        /* Check time budget BEFORE enqueueing'){
  assert.equal(block(motor,a,'        id_pending=id_core_called'),block(old,a,b));
 }else assert.equal(block(motor,a,b),block(old,a,b));
}
const header=read(path.join(task,'identification_trace.h'));
assert(!/id_excitation\s*\(|id_symbol\s*\(/.test(header));
assert(motor.includes('enc,previous_command,rpm,esc_current,previous_command,age,fresh,id_previous_phase,id_previous_flags)'));
assert(motor.indexOf('id_collect(')<motor.indexOf('last_cycles=begin;'));
const target='exp5ID_Q0_A_BLNN_HW6',buildDir=path.join(fresh,'MDK-ARM',target),axf=path.join(buildDir,target+'.axf'),hex=path.join(buildDir,target+'.hex');
const log=read(path.join(fresh,'MDK-ARM/Q0_build02.log'));assert(log.includes('0 Error(s), 0 Warning(s).'));
for(const f of ['identification_trace.h','motor_task.c','experiment5_formal_config.h'])assert(fs.statSync(path.join(task,f)).mtimeMs<=fs.statSync(axf).mtimeMs);
assert(fs.statSync(hex).mtimeMs>=fs.statSync(axf).mtimeMs);
const map=read(path.join(buildDir,target+'.map')),ram=map.match(/Execution Region RW_IRAM1[^\n]*Size: 0x([0-9a-f]+), Max: 0x([0-9a-f]+)/i);assert(ram);
const used=parseInt(ram[1],16),max=parseInt(ram[2],16);assert.equal(max,0x1c000);assert(max-used>=8192);
assert(/identification_trace\s+0x[0-9a-f]+\s+Data\s+63580/i.test(map));
assert(/fault_trace\s+0x[0-9a-f]+\s+Data\s+1300/i.test(map));
const options=read(path.join(fresh,'MDK-ARM/eassy.uvoptx'));
assert(options.includes('<pMon>BIN\\CMSIS_AGDI.dll</pMon>')&&options.includes('<TargetName>'+target+'</TargetName>'));
const result={build:67811,method:11,schema:4487,stopMagic:4438,project:path.join(fresh,'MDK-ARM/eassy.uvprojx'),target,hex,
 hexSHA256:hash(hex),axfSHA256:hash(axf),unchangedSourceFiles:unchanged,ordinaryCoreAndConfigExact:true,
 coreFilterActuatorHealthDeadlineCANAndFaultBlocksUnchanged:true,noExcitationAPI:true,checks,
 compileErrors:0,compileWarnings:0,RAM:{used,max,remaining:max-used},ARMTraceABI_bytes:63580,ARMLegacyFaultABI_bytes:1300,
 sourceHashes:Object.fromEntries(['motor_task.c','identification_trace.h','experiment5_formal_config.h'].map(f=>[f,hash(path.join(task,f))])),
 hostSHA256:hash(path.join(dir,'q0_host.ps1')),flashed:false,physicalRuns:0,onBoardTimingQualified:false,
 scope:'Q0 logging qualification only. Fresh drive-OFF for flash/reset/idle; fresh drive-ON/onsite before one2mm run. No T1/V1 authorization.',
 performanceImprovementProven:false,modelsIdentified:false};
fs.writeFileSync(path.join(dir,'verification.json'),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({build:result.build,checks,RAM:result.RAM,unchangedSourceFiles:unchanged,hexSHA256:result.hexSHA256,flashed:false},null,2));
