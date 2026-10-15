import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const dir=path.dirname(fileURLToPath(import.meta.url)),root=path.resolve(dir,'../..');
const old=path.join(root,'05_实验代码/模型闭环_Q2_误差汇总40s_20261015/eassy_E5ID_Q2S_BLNN_HW6');
const fresh=path.join(root,'05_实验代码/模型闭环_电机响应M1_20261015/eassy_E5ID_MOTOR_BLNN_HW6');
const read=p=>fs.readFileSync(p,'utf8').replaceAll('\r\n','\n');
const sha=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const oldProtocol=JSON.parse(read(path.join(root,'06_仿真与复现/cumulative_micro_round90_20261015/next_capture_protocol.json')));
assert.equal(sha(oldProtocol.hex),oldProtocol.hexSHA256);
for(const [f,h]of Object.entries(oldProtocol.codeHashes))assert.equal(sha(path.join(old,f)),h);
const allowed=new Set(['Task/motor_task.c','Task/identification_trace.h','Task/experiment5_formal_config.h']);let unchanged=0;
function walk(rel){for(const e of fs.readdirSync(path.join(old,rel),{withFileTypes:true})){const p=path.posix.join(rel,e.name);if(e.isDirectory())walk(p);else if(!allowed.has(p)){assert.equal(sha(path.join(old,p)),sha(path.join(fresh,p)),p);unchanged++;}}}
for(const p of ['Task','Core','Drivers','Middlewares','CAN-control'])walk(p);
const expected=read(path.join(old,'Task/motor_task.c'))
 .replace('/* Q2S full-moving-rate BLNN logger, build68012/schema4499.','/* M1 mixed-rate motor-response BLNN logger, build68212/schema4501.')
 .replace('            uint32_t age[2];uint8_t fresh=0U;int64_t delta;',
  '            uint32_t age[2],battery_tick,battery_age;uint8_t fresh=0U,battery_valid;int64_t delta;\n            float battery_V;\n            taskENTER_CRITICAL();battery_V=Batvalt;battery_tick=g_exp5_bms_last_ms;\n            battery_valid=(uint8_t)(g_exp5_bms_valid!=0U);taskEXIT_CRITICAL();\n            battery_age=HAL_GetTick()-battery_tick;')
 .replace('                enc,previous_command,rpm,esc_current,previous_command,age,fresh,id_previous_phase,id_previous_flags);',
  '                enc,previous_command,rpm,esc_current,previous_command,age,fresh,id_previous_phase,id_previous_flags,\n                battery_V,battery_age,battery_valid);');
assert.equal(expected,read(path.join(fresh,'Task/motor_task.c')),'Unexpected control/guard/trajectory change');
assert.equal(read(path.join(old,'Task/experiment5_formal_config.h')).replace('/* Q2S logger plus UART-only40s error summary. ZERO excitation only.','/* M1 motor/drive-response logger plus UART-only40s error summary. ZERO excitation.').replace('68012U','68212U').replace('4499U','4501U'),read(path.join(fresh,'Task/experiment5_formal_config.h')));
for(const ext of ['uvprojx','uvoptx'])assert.equal(read(path.join(old,'MDK-ARM/eassy.'+ext)).replaceAll('exp5ID_Q2S_BLNN_HW6','exp5ID_MOTOR_BLNN_HW6'),read(path.join(fresh,'MDK-ARM/eassy.'+ext)));
assert.equal(sha(path.join(old,'MDK-ARM/startup_stm32f407xx.s')),sha(path.join(fresh,'MDK-ARM/startup_stm32f407xx.s')));
const checks=[],env={...process.env,PATH:'D:/MinGW/mingw64/bin;'+process.env.PATH};
function run(command,args){const r=spawnSync(command,args,{cwd:dir,env,encoding:'utf8'});assert.equal(r.status,0,r.stdout+r.stderr);checks.push(r.stdout.trim());return r.stdout;}
run('D:/MinGW/mingw64/bin/gcc.exe',['-std=c99','-O2','-Wall','-Wextra','-Werror','-Wno-unused-function','-Wno-misleading-indentation','-I',path.join(fresh,'Task'),'test_native.c','-lm','-o','test_native.exe']);
run(path.join(dir,'test_native.exe'),['native.bin','expected.csv']);
const independent=JSON.parse(run('C:/Users/ele/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe',['-X','utf8','check_fixture.py','native.bin','expected.csv']));
run(process.execPath,['test_decode.mjs']);run(process.execPath,['../identification_q0_safe_encoding_round44_20261014/test_encoding.mjs']);
const target='exp5ID_MOTOR_BLNN_HW6',buildDir=path.join(fresh,'MDK-ARM',target),axf=path.join(buildDir,target+'.axf'),hex=path.join(buildDir,target+'.hex');
assert(read(path.join(fresh,'MDK-ARM/M1_build03.log')).includes('0 Error(s), 0 Warning(s).'));
for(const p of allowed)assert(fs.statSync(path.join(fresh,p)).mtimeMs<=fs.statSync(axf).mtimeMs,'Stale binary '+p);
const map=read(path.join(buildDir,target+'.map')),region=map.match(/Execution Region RW_IRAM1[^\n]*Size: 0x([0-9a-f]+), Max: 0x([0-9a-f]+)/i);assert(region);
const used=parseInt(region[1],16),maximum=parseInt(region[2],16);assert(maximum-used>=3072);
assert(/identification_trace\s+0x[0-9a-f]+\s+Data\s+83968/i.test(map));
run('D:/Keil_v5/ARM/ARMCC/bin/fromelf.exe',['--bin','--output',path.join(dir,'linked.bin'),axf]);
let high=0,low=Infinity,last=0;const regions=[];
for(const l of read(hex).trim().split('\n')){const b=Buffer.from(l.slice(1).trim(),'hex');assert(l.startsWith(':')&&([...b].reduce((a,x)=>a+x,0)&255)===0);const n=b[0],type=b[3],address=b.readUInt16BE(1);if(type===4)high=b.readUInt16BE(4)*65536;else if(type===0){const at=high+address;low=Math.min(low,at);last=Math.max(last,at+n);regions.push([at,b.subarray(4,4+n)]);}}
assert.equal(low,0x08000000);const image=Buffer.alloc(last-low);for(const [at,b]of regions)b.copy(image,at-low);assert(image.equals(fs.readFileSync(path.join(dir,'linked.bin'))));
const sourceHashes=Object.fromEntries([...allowed,'Task/vofa_task.c','Task/blnn_core.c','Task/experiment5_motion.h','Task/experiment5_error_summary.h','Task/experiment5_error_wave.h'].map(p=>[p,sha(path.join(fresh,p))]));
const output={date:'2026-10-15',build:68212,schema:4501,magic:4446,ABI:4,project:path.join(fresh,'MDK-ARM/eassy.uvprojx'),target,hex,hexSHA256:sha(hex),sourceHashes,
 unchangedHistoricalSourceFiles:unchanged,controlGuardsTrajectoryAndUARTUnchanged:true,onlyRecorderAndIdentityChanged:true,
 compileErrors:0,compileWarnings:0,ARMTraceBytes:83968,blobBytes:83872,RAM:{used,maximum,remaining:maximum-used},AXFHEXByteExact:true,
 fine1msRowsExpected:1800,coarse20msRowsExpected:910,coveredControlIntervals:20000,independentPythonDecode:independent,
 rawCurrentUnitsNotCalibrated:true,batteryNotMotorTerminalVoltage:true,checks:checks.filter(Boolean),
 onBoardTimingQualified:false,motorModelIdentified:false,newParametersDerived:false,assistantFlashed:false,assistantMotorRun:false,
 manualQualificationRunsAuthorized:1,additionalExcitation:false};
fs.writeFileSync(path.join(dir,'verification.json'),JSON.stringify(output,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(output,null,2));
