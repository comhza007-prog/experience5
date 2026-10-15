import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import assert from 'node:assert/strict';import {spawnSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
const dir=path.dirname(fileURLToPath(import.meta.url)),root=path.resolve(dir,'../..');
const prior=path.join(root,'05_实验代码/模型闭环_Q2_误差汇总40s_20261015/eassy_E5ID_Q2S_BLNN_HW6'),fresh=path.join(root,'05_实验代码/自动采集Q2_显式启动_20261015/eassy_E5ID_Q2B_BLNN_HW6'),task=path.join(fresh,'Task');
const sha=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex'),read=p=>fs.readFileSync(p,'utf8').replaceAll('\r\n','\n');let unchanged=0;
for(const folder of ['Task','Core','Drivers','Middlewares','CAN-control']){
 function walk(rel){for(const e of fs.readdirSync(path.join(prior,rel),{withFileTypes:true})){const r=path.join(rel,e.name);if(e.isDirectory())walk(r);else if(!['Task/motor_task.c','Task/experiment5_formal_config.h'].includes(r.replaceAll('\\','/'))){assert.equal(sha(path.join(prior,r)),sha(path.join(fresh,r)),r);unchanged++;}}}walk(folder);
}
const old=read(path.join(prior,'Task/motor_task.c')),s=read(path.join(task,'motor_task.c'));
assert.equal(s.slice(s.indexOf('static uint32_t health('),s.indexOf('void motor_task(')),old.slice(old.indexOf('static uint32_t health('),old.indexOf('void motor_task(')));
assert.equal(s.slice(s.indexOf('        if(g_exp5_abort) fault|=32U;')),old.slice(old.indexOf('        if(g_exp5_abort) fault|=32U;')));
assert(s.includes('E5_OL_MOTION_ENABLED && online_arm_request && now-boot>=E5_ARM_MS'));
assert(!s.includes('if(E5_OL_MOTION_ENABLED && now-boot>=E5_ARM_MS)'));
assert(s.includes('if(online_command.op==E5_OL_SET)')&&s.includes('e5_ol_watchdog_expired(&online,armed&&!done,now)'));
const checks=[],env={...process.env,PATH:'D:/MinGW/mingw64/bin;'+process.env.PATH};
function run(exe,args){const r=spawnSync(exe,args,{cwd:dir,env,encoding:'utf8'});assert.equal(r.status,0,r.stdout+r.stderr);if(r.stdout.trim())checks.push(r.stdout.trim());}
run('D:/MinGW/mingw64/bin/gcc.exe',['-std=c99','-O2','-Wall','-Wextra','-Werror','-Wno-unused-function','-I',task,'test_start.c','-o',path.join(dir,'test_start.exe')]);run(path.join(dir,'test_start.exe'),[]);
run('D:/MinGW/mingw64/bin/gcc.exe',['-std=c99','-O2','-Wall','-Wextra','-Werror','-Wno-unused-function','-I',task,path.join(dir,'../identification_q2_summary40s_round61_20261015/test_native.c'),'-o',path.join(dir,'test_logger.exe')]);run(path.join(dir,'test_logger.exe'),[path.join(dir,'test_logger.bin')]);
run('pwsh',['-NoProfile','-File',path.join(dir,'test_host.ps1')]);
const log=read(path.join(dir,'build01.log'));assert(log.includes('0 Error(s), 0 Warning(s).'));
const build=path.join(fresh,'MDK-ARM/exp5ID_Q2B_BLNN_HW6'),hex=path.join(build,'exp5ID_Q2B_BLNN_HW6.hex'),axf=path.join(build,'exp5ID_Q2B_BLNN_HW6.axf'),map=read(path.join(build,'exp5ID_Q2B_BLNN_HW6.map'));
const ram=map.match(/Execution Region RW_IRAM1[^\n]*Size: 0x([0-9a-f]+), Max: 0x([0-9a-f]+)/i);assert(ram);const used=parseInt(ram[1],16),max=parseInt(ram[2],16);assert(max-used>=8192);
for(const f of ['motor_task.c','experiment5_formal_config.h'])assert(fs.statSync(path.join(task,f)).mtimeMs<=fs.statSync(axf).mtimeMs);
const result={build:68212,schema:4500,project:path.join(fresh,'MDK-ARM/eassy.uvprojx'),target:'exp5ID_Q2B_BLNN_HW6',hex,hexSHA256:sha(hex),axfSHA256:sha(axf),unchangedSourceFiles:unchanged,checks,compileErrors:0,compileWarnings:0,RAM:{used,max,remaining:max-used},sourceHashes:Object.fromEntries(['motor_task.c','experiment5_formal_config.h','blnn_core.c','experiment5_motion.h','identification_trace.h','online_protocol.h','vofa_task.c'].map(f=>[f,sha(path.join(task,f))])),hostSHA256:sha(path.join(dir,'q2_host.ps1')),protocolSHA256:sha(path.join(dir,'protocol.json')),physicalRuns:0,flashed:false,onboardTimingQualified:false,scope:'Single explicit ARM, same core/trajectory/actuator/physical guards; new startup handshake and restored heartbeat abort. Native checks not proof of physical safety.'};
fs.writeFileSync(path.join(dir,'verification.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(result,null,2));
