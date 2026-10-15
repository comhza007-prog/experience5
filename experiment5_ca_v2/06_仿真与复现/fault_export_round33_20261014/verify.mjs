import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import crypto from 'node:crypto';import {spawnSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
const dir=path.dirname(fileURLToPath(import.meta.url)),root=path.resolve(dir,'../..');
const prior=path.join(root,'05_实验代码/自动监视_网络回放_20261014/eassy_E5REPLAY_A_S3R2_HW6');
const fresh=path.join(root,'05_实验代码/自动监视_故障保留回放_20261014/eassy_E5REPLAY2_A_S3R2_HW6');
const task=path.join(fresh,'Task'),hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex'),env={...process.env,PATH:'D:/MinGW/mingw64/bin;'+process.env.PATH};
const checks=[];
const run=(cmd,args)=>{const r=spawnSync(cmd,args,{cwd:dir,env,encoding:'utf8'});assert.equal(r.status,0,r.stdout+r.stderr);checks.push(r.stdout.trim());};
run('D:/MinGW/mingw64/bin/gcc.exe',['-std=c99','-O2','-Wall','-Wextra','-Werror','-Wno-unused-function','-I',task,'test_replay.c','-lm','-o','test_replay.exe']);
run(path.join(dir,'test_replay.exe'),[]);run(path.join(dir,'test_replay.exe'),['--fault-test']);run(process.execPath,['test_decode.mjs']);run('pwsh',['-NoProfile','-File','test_host.ps1']);
let unchanged=0;
function walk(relative){for(const f of fs.readdirSync(path.join(prior,relative),{withFileTypes:true})){
 const next=path.join(relative,f.name);if(f.isDirectory())walk(next);
 else if(!['Task/motor_task.c','Task/network_trace.h','Task/experiment5_formal_config.h'].includes(next.replaceAll('\\','/'))){assert.equal(hash(path.join(prior,next)),hash(path.join(fresh,next)),next);unchanged++;}
}}
for(const folder of ['Task','Core','Drivers','Middlewares','CAN-control'])walk(folder);
let motor=fs.readFileSync(path.join(task,'motor_task.c'),'utf8');
motor=motor.replace('    if(e5_replay_allow_output((uint32_t)values[2],(uint32_t)values[22],\n        HAL_GetTick()-fault_trace.fault_ms,fault_trace.cursor,fault_trace.count,replay_trace.ready))','    if(values[2]==6.0f && values[22]==0.0f)');
assert.equal(motor,fs.readFileSync(path.join(prior,'Task/motor_task.c'),'utf8'),'Only post-stop telemetry eligibility may change in motor task');
let header=fs.readFileSync(path.join(task,'network_trace.h'),'utf8').replace('#define E5_REPLAY_MAGIC 4437U','#define E5_REPLAY_MAGIC 4436U');
const a=header.indexOf('/* A failure stays a failure:'),b=header.indexOf('static int e5_replay_before',a);assert(a>0&&b>a);header=header.slice(0,a)+header.slice(b);
assert.equal(header,fs.readFileSync(path.join(prior,'Task/network_trace.h'),'utf8'),'Capture/storage/CRC/transport identical outside export predicate');
const target='exp5REPLAY2_A_S3R2_HW6',build=path.join(fresh,'MDK-ARM',target),axf=path.join(build,target+'.axf'),hex=path.join(build,target+'.hex');
const log=fs.readFileSync(path.join(dir,'build_attempt01.log'),'utf8');assert(log.includes('0 Error(s), 0 Warning(s).'));
for(const f of ['network_trace.h','motor_task.c','experiment5_formal_config.h'])assert(fs.statSync(path.join(task,f)).mtimeMs<=fs.statSync(axf).mtimeMs);
const map=fs.readFileSync(path.join(build,target+'.map'),'utf8'),ram=map.match(/Execution Region RW_IRAM1[^\n]*Size: 0x([0-9a-f]+), Max: 0x([0-9a-f]+)/i);assert(ram);const used=parseInt(ram[1],16),max=parseInt(ram[2],16);assert.equal(max,0x1c000);assert(max-used>=8192);
const options=fs.readFileSync(path.join(fresh,'MDK-ARM/eassy.uvoptx'),'utf8');assert(options.includes('<pMon>BIN\\CMSIS_AGDI.dll</pMon>')&&options.includes('<TargetName>'+target+'</TargetName>'));
const result={build:67712,method:12,schema:4486,replayMagic:4437,project:path.join(fresh,'MDK-ARM/eassy.uvprojx'),target,hex,hexSHA256:hash(hex),axfSHA256:hash(axf),
 unchangedSourceFiles:unchanged,controlCoreAndSafetyIdentical:true,onlyPostStopSerialExportEligibilityChanged:true,
 checks:checks.filter(Boolean),compileErrors:0,compileWarnings:0,RAM:{used,max,remaining:max-used},CMSISDAPOptionsIncluded:true,
 sourceHashes:Object.fromEntries(['motor_task.c','network_trace.h','experiment5_formal_config.h'].map(f=>[f,hash(path.join(task,f))])),
 flashed:false,physicalRuns:0,onBoardTimingQualified:false,newPerformanceCandidate:false,formalEfficacyEvidence:false,
 faultCaptureRemainsFailedEvenIfSnapshotValid:true,releaseScope:'One explicitly ready diagnostic run only; no change to control gains/current/guards; no positive scientific result promised'};
fs.writeFileSync(path.join(dir,'verification.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({build:67712,unchangedSourceFiles:unchanged,RAM:result.RAM,checks:result.checks,flashed:false},null,2));
