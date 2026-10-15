import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import assert from 'node:assert/strict';import {spawnSync} from 'node:child_process';import {fileURLToPath} from 'node:url';import {decodeBlob,crc32} from './decode.mjs';
const dir=path.dirname(fileURLToPath(import.meta.url)),root=path.resolve(dir,'../..'),prior=path.join(root,'05_实验代码/20mm准入_显式启动_20261015/eassy_E5ID_Q20_BLNN_HW6'),fresh=path.join(root,'05_实验代码/20mm手动VOFA_20261015/eassy_E5ID_Q20M_BLNN_HW6'),manualOld=path.join(root,'05_实验代码/模型闭环_Q2_误差汇总40s_20261015/eassy_E5ID_Q2S_BLNN_HW6');
const sha=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex'),read=p=>fs.readFileSync(p,'utf8').replaceAll('\r\n','\n'),block=(s,a,b)=>s.slice(s.indexOf(a),s.indexOf(b,s.indexOf(a)));let unchanged=0;
for(const folder of ['Task','Core','Drivers','Middlewares','CAN-control']){function walk(rel){for(const e of fs.readdirSync(path.join(prior,rel),{withFileTypes:true})){const p=path.join(rel,e.name);if(e.isDirectory())walk(p);else if(!['Task/motor_task.c','Task/experiment5_formal_config.h'].includes(p.replaceAll('\\','/'))){assert.equal(sha(path.join(prior,p)),sha(path.join(fresh,p)),p);unchanged++;}}}walk(folder);}
const old=read(path.join(prior,'Task/motor_task.c')),s=read(path.join(fresh,'Task/motor_task.c')),manual=read(path.join(manualOld,'Task/motor_task.c'));
assert.equal(s.slice(s.indexOf('        if(g_exp5_abort) fault|=32U;')),old.slice(old.indexOf('        if(g_exp5_abort) fault|=32U;')));
assert.equal(block(s,'static uint32_t health(','void motor_task('),block(old,'static uint32_t health(','void motor_task('));
const normalize=t=>t.replace(/\/\*[\s\S]*?\*\//g,'').replace(/\s/g,'');
assert.equal(normalize(block(s,'        for(online_budget=','        if(g_exp5_abort) fault|=32U;')),normalize(block(manual,'        for(online_budget=','        if(g_exp5_abort) fault|=32U;')));
assert(s.includes('E5_OL_MOTION_ENABLED && now-boot>=E5_ARM_MS'));assert(!s.includes('online_arm_request')&&!s.includes('e5_ol_watchdog_expired('));
const checks=[],env={...process.env,PATH:'D:/MinGW/mingw64/bin;'+process.env.PATH},task=path.join(fresh,'Task');
function run(exe,args){const r=spawnSync(exe,args,{cwd:dir,env,encoding:'utf8'});assert.equal(r.status,0,r.stdout+r.stderr);if(r.stdout.trim())checks.push(r.stdout.trim());}
run('D:/MinGW/mingw64/bin/gcc.exe',['-std=c99','-O2','-Wall','-Wextra','-Werror','-Wno-unused-function','-Wno-misleading-indentation','-I',task,path.join(dir,'test_candidate.c'),'-lm','-o',path.join(dir,'test_candidate.exe')]);
run(path.join(dir,'test_candidate.exe'),[path.join(dir,'native_blob.bin'),path.join(dir,'expected_intervals.csv')]);
run('C:/Users/ele/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe',['-X','utf8',path.join(dir,'check_blob.py')]);
const b=fs.readFileSync(path.join(dir,'native_blob.bin')),decoded=decodeBlob(b),independent=JSON.parse(read(path.join(dir,'independent_verification.json')));assert(independent.passed&&crc32(b)===independent.CRC32);assert.equal(decoded.ordered.at(-1).step,27999);assert.equal(decoded.header.manual_mode,1);
const target='exp5ID_Q20M_BLNN_HW6',build=path.join(fresh,'MDK-ARM',target),hex=path.join(build,target+'.hex'),axf=path.join(build,target+'.axf'),map=read(path.join(build,target+'.map'));assert(read(path.join(dir,'build01.log')).includes('0 Error(s), 0 Warning(s).'));
for(const f of ['motor_task.c','experiment5_formal_config.h'])assert(fs.statSync(path.join(task,f)).mtimeMs<=fs.statSync(axf).mtimeMs);
const r=map.match(/Execution Region RW_IRAM1[^\n]*Size: 0x([0-9a-f]+), Max: 0x([0-9a-f]+)/i);assert(r);const used=parseInt(r[1],16),max=parseInt(r[2],16);assert(max-used>=8192);
assert(read(path.join(fresh,'MDK-ARM/eassy.uvoptx')).includes('CMSIS_AGDI.dll'));
assert.equal(sha(path.join(prior,'MDK-ARM/exp5ID_Q20_BLNN_HW6/exp5ID_Q20_BLNN_HW6.hex')),'50c82415a9b1092716b336acb86249f450caeff564985ed725588d31d5d26832');
const out={status:'Manual single20mm qualification prepared and offline checked; no assistant hardware action',build:68412,schema:4502,stopMagic:4445,
 project:path.join(fresh,'MDK-ARM/eassy.uvprojx'),target,hex,hexSHA256:sha(hex),axfSHA256:sha(axf),compileErrors:0,compileWarnings:0,RAM:{used,max,remaining:max-used},unchangedSourceFiles:unchanged,
 startupMode:'One boot-start attempt after8seconds with health+500msstationarity; unhealthy attempt faults with no retry',
 startupPolicyMatchesPreviouslyUsed68012Except20mmTrajectoryAndTravelEnvelope:true,
 hostHeartbeatAbortEnabled:false,manualEmergencyStopRequired:true,remoteArmAndSetDisabled:true,CRCValidStopRetained:true,
 physicalAndControlGuardsSameAs68312:true,stroke_mm:20,forward_s:8,return_s:8,total_s:28,limits:[1200,1200],travelEnvelope_mm:[-4,22],insideExisting10to30rpmTaper:true,
 loggerABI:3,blobBytes:69312,movingInterval_ms:4,holdingInterval_ms:40,controlPeriod_ms:1,nativeMetricSamples:600,intraInterval1msCommandsRecoverable:false,
 completion:'I63=68412,I2=6,I22=0,I88=4445,I89=4,I90=0; completiontail>=20s AND I0>=185s',checks,
 sourceHashes:Object.fromEntries(['motor_task.c','experiment5_formal_config.h','experiment5_motion.h','identification_trace_v3.h','experiment5_error_summary.h','blnn_core.c','experiment5_formal_actuator.h','experiment5_hw_profile.h','online_protocol.h','vofa_task.c'].map(f=>[f,sha(path.join(task,f))])),
 protocolSHA256:sha(path.join(dir,'protocol.json')),decoderSHA256:sha(path.join(dir,'decode.mjs')),oldCodeAndDataPreserved:true,assistantHardwareAction:false,flashed:false,physicalRuns:0,onboardTimingQualified:false,
 limitation:'Prior mechanism difficulty unresolved. This is a new single-run qualification, not proof longer stroke fixes it or release for20runs. No model retrained or validation result claimed.'};
fs.writeFileSync(path.join(dir,'verification.json'),JSON.stringify(out,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(out,null,2));
