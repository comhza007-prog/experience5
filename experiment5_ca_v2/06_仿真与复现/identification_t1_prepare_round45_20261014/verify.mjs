import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
const dir=path.dirname(fileURLToPath(import.meta.url)),root=path.resolve(dir,'../..');
const old=path.join(root,'05_实验代码/辨识Q0_手动VOFA_安全编码_20261014/eassy_E5ID_Q0M3_BLNN_HW6');
const fresh=path.join(root,'05_实验代码/辨识T1_训练采集_20261014/eassy_E5ID_T1M_BLNN_HW6'),task=path.join(fresh,'Task');
const hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const read=p=>fs.readFileSync(p,'utf8').replaceAll('\r\n','\n');
const changed=['Task/motor_task.c','Task/identification_trace.h','Task/experiment5_formal_config.h','Task/online_protocol.h'];let unchanged=0;
function walk(rel){for(const f of fs.readdirSync(path.join(old,rel),{withFileTypes:true})){const next=path.posix.join(rel,f.name);if(f.isDirectory())walk(next);else if(!changed.includes(next)){assert.equal(hash(path.join(old,next)),hash(path.join(fresh,next)),next);unchanged++;}}}
for(const folder of ['Task','Core','Drivers','Middlewares','CAN-control'])walk(folder);
function block(s,a,b){const i=s.indexOf(a),j=s.indexOf(b,i);assert(i>=0&&j>i,a);return s.slice(i,j);}
const priorMotor=read(path.join(old,'Task/motor_task.c')),motor=read(path.join(task,'motor_task.c'));
for(const [a,b] of [['static uint32_t health(','void motor_task('],['        /* Check time budget BEFORE enqueueing','        channels[0]'],['        whole_us=(float)(DWT->CYCCNT-begin)/cycles_per_us;\n        if(whole_us>=950.0f)','        id_pending=']])assert.equal(block(priorMotor,a,b),block(motor,a,b),'Guard/CAN/timing mismatch');
const priorTrace=read(path.join(old,'Task/identification_trace.h')),trace=read(path.join(task,'identification_trace.h'));
assert.equal(block(priorTrace,'#define ID_EXPORT_PASSES','#endif'),block(trace,'#define ID_EXPORT_PASSES','#endif'),'Collector/export changed');
assert.equal(read(path.join(task,'online_protocol.h')),read(path.join(old,'Task/online_protocol.h')).replace('#define E5_OL_MOTION_ENABLED 1U','#define E5_OL_MOTION_ENABLED 1U /* User approved ONE manual T1 capture,2026-10-14 */'));
const checks=[],env={...process.env,PATH:'D:/MinGW/mingw64/bin;'+process.env.PATH};
function run(cmd,args){const r=spawnSync(cmd,args,{cwd:dir,env,encoding:'utf8'});assert.equal(r.status,0,r.stdout+r.stderr);if(r.stdout.trim())checks.push(r.stdout.trim());}
for(const precision of ['float','double']){
 const exe=path.join(dir,'active_test_'+precision+'.exe');
 run('D:/MinGW/mingw64/bin/gcc.exe',['-std=c99','-O2','-Wall','-Wextra','-Werror','-Wno-unused-function',...(precision==='double'?['-DE5_USE_DOUBLE']:[]),'-I',task,'test_t1.c','baseline_wrapper.c',path.join(task,'blnn_core.c'),'-lm','-o',exe]);
 run(exe,[path.join(dir,'active_native_'+precision+'.bin')]);
 run(process.execPath,['test_decode.mjs',path.join(dir,'active_native_'+precision+'.bin')]);
}
run(process.execPath,['../identification_q0_safe_encoding_round44_20261014/test_encoding.mjs']);
run(process.execPath,['../identification_q0_manual_round42_20261014/test.mjs']);
for(const precision of ['float','double'])run(process.execPath,['../identification_q0_safe_encoding_round44_20261014/test_decode.mjs','../identification_q0_safe_encoding_round44_20261014/native_'+precision+'.bin']);
const target='exp5ID_T1M_BLNN_HW6',buildDir=path.join(fresh,'MDK-ARM',target),axf=path.join(buildDir,target+'.axf'),hex=path.join(buildDir,target+'.hex');
assert(read(path.join(fresh,'MDK-ARM/T1M_build01.log')).includes('0 Error(s), 0 Warning(s).'));
for(const f of [...changed,'Task/identification_excitation.h'])assert(fs.statSync(path.join(fresh,f)).mtimeMs<=fs.statSync(axf).mtimeMs,'Stale '+f);
assert(fs.statSync(hex).mtimeMs>=fs.statSync(axf).mtimeMs);
const map=read(path.join(buildDir,target+'.map')),ram=map.match(/Execution Region RW_IRAM1[^\n]*Size: 0x([0-9a-f]+), Max: 0x([0-9a-f]+)/i);assert(ram);
const used=parseInt(ram[1],16),max=parseInt(ram[2],16);assert(max-used>=8192);
assert(/identification_trace\s+0x[0-9a-f]+\s+Data\s+63580/i.test(map));assert(/fault_trace\s+0x[0-9a-f]+\s+Data\s+1300/i.test(map));
const options=read(path.join(fresh,'MDK-ARM/eassy.uvoptx'));assert(options.includes('<pMon>BIN\\CMSIS_AGDI.dll</pMon>')&&options.includes('<TargetName>'+target+'</TargetName>'));
const result={build:67832,method:11,schema:4491,stopMagic:4442,profile:1,seed:39,target,project:path.join(fresh,'MDK-ARM/eassy.uvprojx'),hex,hexSHA256:hash(hex),unchangedSourceFiles:unchanged,coreFiltersTrajectoryAndGuardsUnchanged:true,knownRequestedExcitationExcludedFromOuterAW:true,zeroInjectionBitExact:true,safeEncodingAndCollectorUnchanged:true,compileErrors:0,compileWarnings:0,ARMTraceBytes:63580,RAM:{used,max,remaining:max-used},checks,protocolSHA256:hash(path.join(dir,'protocol.json')),sourceHashes:Object.fromEntries([...changed,'Task/identification_excitation.h'].map(f=>[f,hash(path.join(fresh,f))])),userApprovedOneT1:true,assistantFlashed:false,physicalRuns:0,onBoardTimingQualified:false,modelIdentified:false,V1Released:false,formalCollectionReleased:false};
fs.writeFileSync(path.join(dir,'verification.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
