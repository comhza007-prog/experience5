import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const dir=path.dirname(fileURLToPath(import.meta.url)),root=path.resolve(dir,'../..');
const old=path.join(root,'05_实验代码/自动监视_反馈辨识_20261014/eassy_E5MODEL_A_S3R2_HW6');
const fresh=path.join(root,'05_实验代码/自动监视_网络回放_20261014/eassy_E5REPLAY_A_S3R2_HW6');
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const results=[];
const ablation=JSON.parse(fs.readFileSync(path.join(dir,'ablation_preparation_verification.json'),'utf8'));
assert(ablation.baselineValidated&&ablation.dedicatedRateClassificationTestPassed&&ablation.retentionMovingNegativeControlExact);
for(const [file,expected] of Object.entries(ablation.sourceHashes))assert.equal(hash(path.join(dir,file)),expected,'Native checks must correspond to current source');
const env={...process.env,PATH:'D:/MinGW/mingw64/bin;'+process.env.PATH};
for(const [command,args] of [[path.join(dir,'test_replay.exe'),[]],[process.execPath,[path.join(dir,'test_decode.mjs')]],[path.join(dir,'test_replay.exe'),[path.join(dir,'decoded_synthetic_replay.bin')]],['pwsh',['-NoProfile','-File',path.join(dir,'test_host.ps1')]]]){
 const r=spawnSync(command,args,{cwd:dir,env,encoding:'utf8'});assert.equal(r.status,0,r.stdout+r.stderr);results.push(r.stdout.trim());
}
let checked=0;
for(const folder of ['CAN-control','Core','Drivers','Middlewares','Task']){
 const walk=relative=>{for(const item of fs.readdirSync(path.join(old,relative),{withFileTypes:true})){
  const next=path.join(relative,item.name);if(item.isDirectory())walk(next);
  else if(!['Task/motor_task.c','Task/experiment5_formal_config.h'].includes(next.replaceAll('\\','/'))){assert.equal(hash(path.join(old,next)),hash(path.join(fresh,next)),next);checked++;}
 }};walk(folder);
}
const prior=fs.readFileSync(path.join(old,'Task/motor_task.c'),'utf8');
let motor=fs.readFileSync(path.join(fresh,'Task/motor_task.c'),'utf8');
motor=motor.replace('#include "network_trace.h"','#include "model_trace.h"').replace('static e5_replay_trace replay_trace;','static e5_model_trace model_trace;').replace('e5_replay_next(&replay_trace,values,g_exp5_dma_completed);','e5_model_next(&model_trace,values,g_exp5_dma_completed);').replace('e5_replay_reset(&replay_trace);','e5_model_reset(&model_trace);');
motor=motor.replace('    e5_ol_command online_command;\n','    e5_ol_command online_command;\n    int32_t model_encoder[2];int16_t model_rpm[2],model_current[2];\n');
motor=motor.replace('                    if(!e5_replay_before(&replay_trace,elapsed,&controller,&input,E5_MOTION_BUILD)) fault|=64U;\n','').replace('                    if(!e5_replay_after(&replay_trace,&controller,&output,command)) fault|=64U;\n','').replace('                    core_begin=DWT->CYCCNT;\n','').replace('                    input.raw_rpm[0]=','                    core_begin=DWT->CYCCNT;\n                    input.raw_rpm[0]=');
const start=prior.indexOf('        /* Diagnostic copy only, after final CAN/950us guard handling.');
const end=prior.indexOf('        publish();',start);assert(start>0&&end>start);
motor=motor.replace('        publish();\n',prior.slice(start,end)+'        publish();\n');
assert.equal(motor,prior,'Outside precisely identified diagnostic replacements motor behavior must be verbatim unchanged');
const log=fs.readFileSync(path.join(dir,'build_attempt02.log'),'utf8');assert(log.includes('0 Error(s), 0 Warning(s).'));
const target='exp5REPLAY_A_S3R2_HW6',buildDir=path.join(fresh,'MDK-ARM',target);
const axf=path.join(buildDir,target+'.axf');
for(const file of ['motor_task.c','network_trace.h','experiment5_formal_config.h'])assert(fs.statSync(path.join(fresh,'Task',file)).mtimeMs<=fs.statSync(axf).mtimeMs,'Firmware source modified after ARM build; recompile before attesting');
const map=fs.readFileSync(path.join(buildDir,target+'.map'),'utf8');
const ram=map.match(/Execution Region RW_IRAM1[^\n]*Size: 0x([0-9a-f]+), Max: 0x([0-9a-f]+)/i);assert(ram);
const used=parseInt(ram[1],16),max=parseInt(ram[2],16);assert.equal(max,0x1c000);assert(max-used>=8192);
const result={build:67612,method:12,schema:4485,postStopMagic:4436,
  project:path.join(fresh,'MDK-ARM/eassy.uvprojx'),target,hex:path.join(buildDir,target+'.hex'),hexSHA256:hash(path.join(buildDir,target+'.hex')),axfSHA256:hash(path.join(buildDir,target+'.axf')),
  unchangedSourceFilesChecked:checked,coreExactlyUnchanged:true,motorOutsideDiagnosticReplacementsVerbatimUnchanged:true,
  checks:results,compileErrors:0,compileWarnings:0,RAM:{used,max,unallocated:max-used,traceBytes:39576},
  snapshotAndTransportSyntheticQualified:true,hardwareFlashed:false,physicalRuns:0,onBoardTimingQualified:false,
  learnerCounterfactualEfficacy:false,closedLoopPlantIdentified:false,
  offlineSingleFactorReplayPrepared:true,syntheticFixtures:2,branchesPerFixture:4,syntheticNotPhysicalEvidence:true,
  sourceHashes:Object.fromEntries(['motor_task.c','network_trace.h','blnn_core.c','experiment5_formal_config.h'].map(f=>[f,hash(path.join(fresh,'Task',f))]))};
fs.writeFileSync(path.join(dir,'verification.json'),JSON.stringify(result,null,2));
console.log(JSON.stringify({build:result.build,sourceFiles:checked,RAM:result.RAM,checks:results,hardwareFlashed:false},null,2));
