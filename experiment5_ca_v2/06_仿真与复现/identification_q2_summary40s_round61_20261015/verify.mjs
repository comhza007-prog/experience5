import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const dir=path.dirname(fileURLToPath(import.meta.url)),root=path.resolve(dir,'../..');
const original=path.join(root,'05_实验代码/模型闭环_高采样率准入Q2_20261014/eassy_E5ID_Q2M_BLNN_HW6');
const fresh=path.join(root,'05_实验代码/模型闭环_Q2_误差汇总40s_20261015/eassy_E5ID_Q2S_BLNN_HW6');
const read=p=>fs.readFileSync(p,'utf8').replaceAll('\r\n','\n'),hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const allowed=['Task/identification_trace.h','Task/motor_task.c','Task/vofa_task.c','Task/experiment5_formal_config.h'];let unchanged=0;
function walk(rel){for(const e of fs.readdirSync(path.join(original,rel),{withFileTypes:true})){const p=path.posix.join(rel,e.name);if(e.isDirectory())walk(p);else if(!allowed.includes(p)){assert.equal(hash(path.join(original,p)),hash(path.join(fresh,p)),p);unchanged++;}}}
for(const p of ['Task','Core','Drivers','Middlewares','CAN-control'])walk(p);
const prior=JSON.parse(read(path.join(root,'06_仿真与复现/identification_q2_fullmoving_round60_20261014/verification.json')));assert.equal(hash(prior.hex),prior.hexSHA256,'Prior approved HEX unchanged');
assert.equal(read(path.join(original,'Task/motor_task.c'))
 .replace('#include "identification_trace.h"','#include "identification_trace.h"\n#include "experiment5_error_wave.h"')
 .replace('/* Q2 full-moving-rate BLNN logger, build68011/schema4498.','/* Q2S full-moving-rate BLNN logger, build68012/schema4499.')
 .replace('    taskENTER_CRITICAL();memcpy(values,published,sizeof(published));','    taskENTER_CRITICAL();memcpy(values,published,sizeof(published));\n    /* Original position/reference inputs BEFORE stopped payload substitution.\n     * I53/I54 are no longer in the logger payload map. No controller write. */\n    e5_error_wave(values);'),read(path.join(fresh,'Task/motor_task.c')),'Unexpected control/guard change');
assert.equal(read(path.join(original,'Task/identification_trace.h')).replace('4443U','4444U').replace('51,52,53,54,55,56','51,52,104,105,55,56'),read(path.join(fresh,'Task/identification_trace.h')),'Recorder collection/gating unchanged');
assert.equal(read(path.join(original,'Task/experiment5_formal_config.h')).replace('/* Q2 full-moving-rate BLNN qualification logger. ZERO excitation only.','/* Q2S logger plus UART-only40s error summary. ZERO excitation only.').replace('68011U','68012U').replace('4498U','4499U'),read(path.join(fresh,'Task/experiment5_formal_config.h')));
const oldUART=read(path.join(original,'Task/vofa_task.c'));
const expectedUART=oldUART.replace('#include "online_uart.h"','#include "online_uart.h"\n#include "experiment5_error_summary.h"')
 .replace('static Vofa_t Vofa;','static Vofa_t Vofa;\nstatic e5_error_summary error_summary;')
 .replace('uint32_t sequence=0,rebase=0,now;','uint32_t sequence=0,rebase=0,now,completed_before_send;')
 .replace('(void)argument;Vofa_tail_init();e5_online_uart_start();','(void)argument;Vofa_tail_init();e5_online_uart_start();e5_summary_reset(&error_summary);')
 .replace('        now=HAL_GetTick();','        now=HAL_GetTick();\n        e5_summary_complete(&error_summary,g_exp5_dma_completed,tx_error);')
 .replace('            tx_task_errors++;','            tx_task_errors++;\n            e5_summary_cancel_pending(&error_summary);')
 .replace('            e5_telemetry_snapshot(values);values[1]=(float)sequence;','            e5_telemetry_snapshot(values);values[1]=(float)sequence;\n            e5_summary_observe(&error_summary,values);\n            e5_summary_display(&error_summary,values);\n            completed_before_send=g_exp5_dma_completed;')
 .replace('            if(status!=HAL_OK) {','            if(status!=HAL_OK) {\n                e5_summary_rejected(&error_summary,values);')
 .replace('            }\n        }\n        sequence++;','            } else e5_summary_stage(&error_summary,values,sequence,completed_before_send);\n        }\n        sequence++;');
assert.equal(expectedUART,read(path.join(fresh,'Task/vofa_task.c')),'Only UART summary bookkeeping added; original RX/fault/framing unchanged');
for(const h of ['experiment5_error_summary.h','experiment5_error_wave.h'])assert.equal(hash(path.join(fresh,'Task',h)),hash(path.join(root,'05_实验代码/误差汇总40s_A_BLNN_S3R2_20261014/00_BLNN/eassy_E5F2_A_BLNN_HW6/Task',h)),'Summary definition unchanged');
for(const ext of ['uvprojx','uvoptx'])assert.equal(read(path.join(original,'MDK-ARM/eassy.'+ext)).replaceAll('exp5ID_Q2M_BLNN_HW6','exp5ID_Q2S_BLNN_HW6'),read(path.join(fresh,'MDK-ARM/eassy.'+ext)));
const env={...process.env,PATH:'D:/MinGW/mingw64/bin;'+process.env.PATH},checks=[];
function run(c,args){const r=spawnSync(c,args,{cwd:dir,env,encoding:'utf8'});assert.equal(r.status,0,r.stdout+r.stderr);if(r.stdout.trim())checks.push(r.stdout.trim());}
for(const test of ['native','summary']){
 run('D:/MinGW/mingw64/bin/gcc.exe',['-std=c99','-O2','-Wall','-Wextra','-Werror','-Wno-unused-function','-I',path.join(fresh,'Task'),'test_'+test+'.c','-lm','-o','test_'+test+'.exe']);
 run(path.join(dir,'test_'+test+'.exe'),test==='native'?['native.bin','expected.csv']:[]);
}
run(process.execPath,['test_decode.mjs']);run(process.execPath,['../identification_q0_safe_encoding_round44_20261014/test_encoding.mjs']);
const a=fs.readFileSync(path.join(dir,'native.bin')),b=fs.readFileSync(path.join(root,'06_仿真与复现/identification_q2_fullmoving_round60_20261014/native.bin'));
assert(a.subarray(0,4).equals(b.subarray(0,4))&&a.subarray(8).equals(b.subarray(8)),'Synthetic recorder blob exact except buildID');
const target='exp5ID_Q2S_BLNN_HW6',build=path.join(fresh,'MDK-ARM',target),axf=path.join(build,target+'.axf'),hex=path.join(build,target+'.hex');
assert(read(path.join(fresh,'MDK-ARM/Q2S_build01.log')).includes('0 Error(s), 0 Warning(s).'));
for(const p of [...allowed,'Task/experiment5_error_summary.h','Task/experiment5_error_wave.h'])assert(fs.statSync(path.join(fresh,p)).mtimeMs<fs.statSync(axf).mtimeMs,'Stale binary '+p);
const map=read(path.join(build,target+'.map')),ram=map.match(/Execution Region RW_IRAM1[^\n]*Size: 0x([0-9a-f]+), Max: 0x([0-9a-f]+)/i);assert(ram);
const used=parseInt(ram[1],16),max=parseInt(ram[2],16);assert(max-used>=3072);
assert(/identification_trace\s+0x[0-9a-f]+\s+Data\s+71032/i.test(map));assert(/error_summary\s+0x[0-9a-f]+\s+Data\s+96/i.test(map));
run('D:/Keil_v5/ARM/ARMCC/bin/fromelf.exe',['--bin','--output',path.join(dir,'linked.bin'),axf]);
let high=0,lo=Infinity,hi=0;const regions=[];
for(const l of read(hex).trim().split('\n')){assert(l.startsWith(':'));const b=Buffer.from(l.slice(1).trim(),'hex');assert.equal([...b].reduce((a,x)=>a+x,0)&255,0);const n=b[0],type=b[3],address=b.readUInt16BE(1);if(type===4)high=b.readUInt16BE(4)*65536;else if(type===0){const at=high+address;lo=Math.min(lo,at);hi=Math.max(hi,at+n);regions.push([at,b.subarray(4,4+n)]);}}
assert.equal(lo,0x08000000);const image=Buffer.alloc(hi-lo);for(const [at,b]of regions)b.copy(image,at-lo);assert(image.equals(fs.readFileSync(path.join(dir,'linked.bin'))),'AXF/HEX image mismatch');
const result={date:'2026-10-15',build:68012,schema:4499,magic:4444,project:path.join(fresh,'MDK-ARM/eassy.uvprojx'),target,hex,hexSHA256:hash(hex),unchangedHistoricalSourceFiles:unchanged,controlGuardsAndRecorderCollectionExact:true,originalUARTSafetyAndFramingUnchanged:true,originalSummaryDefinitionsByteExact:true,thresholdUptime_s:40,requireNormalPhase6:true,I53:'trackingRMSE_mm',I54:'syncRMS_mm',beforeSummary:'instantaneous signed errors mm',faultInvalidSummary:-1,packedPayloadDoesNotOverwrite53or54:true,summaryDoesNotOverwritePackedPayload:true,syntheticRecorderBlobExactExceptBuild:true,compileErrors:0,compileWarnings:0,ARMTraceBytes:71032,RAM:{used,max,remaining:max-used},AXFHEXByteExact:true,checks,onlyOneAlreadyApprovedQualification:true,replaces68011NotExtraRun:true,assistantFlashed:false,assistantMotorRun:false,onBoardTimingQualified:false,modelIdentified:false};
fs.writeFileSync(path.join(dir,'verification.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
