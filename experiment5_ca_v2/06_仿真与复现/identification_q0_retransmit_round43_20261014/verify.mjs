import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const dir=path.dirname(fileURLToPath(import.meta.url)),root=path.resolve(dir,'../..');
const old=path.join(root,'05_实验代码/辨识Q0_手动VOFA_20261014/eassy_E5ID_Q0M_BLNN_HW6');
const fresh=path.join(root,'05_实验代码/辨识Q0_手动VOFA_双轮补传_20261014/eassy_E5ID_Q0M2_BLNN_HW6');
const hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const read=p=>fs.readFileSync(p,'utf8').replaceAll('\r\n','\n');
const exceptions=['Task/motor_task.c','Task/identification_trace.h','Task/experiment5_formal_config.h'];
let unchanged=0;
function walk(rel){for(const f of fs.readdirSync(path.join(old,rel),{withFileTypes:true})){
 const next=path.posix.join(rel,f.name);if(f.isDirectory())walk(next);
 else if(!exceptions.includes(next)){assert.equal(hash(path.join(old,next)),hash(path.join(fresh,next)),next);unchanged++;}
}}
for(const folder of ['Task','Core','Drivers','Middlewares','CAN-control'])walk(folder);
const priorMotor=read(path.join(old,'Task/motor_task.c')),newMotor=read(path.join(fresh,'Task/motor_task.c'));
const allowedMotor=priorMotor.replace('build67821/schema4488.','build67822/schema4489.\n * Stop-only two-pass export: ascending then descending, two copies/pass.\n * Re-export is NOT another motor run; control and guards are unchanged.').replace('    identification_trace.blob.header.reserved[1]=1U; /* user-operated boot-start mode */','    identification_trace.blob.header.reserved[1]=1U; /* user-operated boot-start mode */\n    identification_trace.blob.header.reserved[2]=2U; /* two stop-only export passes */');
assert.equal(newMotor,allowedMotor,'Unexpected motor control/guard change');
assert.equal(read(path.join(fresh,'Task/experiment5_formal_config.h')),read(path.join(old,'Task/experiment5_formal_config.h')).replace('67821U','67822U').replace('4488U','4489U'));
const oldHeader=read(path.join(old,'Task/identification_trace.h')),newHeader=read(path.join(fresh,'Task/identification_trace.h'));
function block(s,a,b){const i=s.indexOf(a),j=s.indexOf(b,i);assert(i>=0&&j>i);return s.slice(i,j);}
assert.equal(block(oldHeader,'static uint32_t id_fast_index','/* Bounded CRC'),block(newHeader,'static uint32_t id_fast_index','/* Bounded CRC'),'Recorder/phase/fault gating changed');
const checks=[],env={...process.env,PATH:'D:/MinGW/mingw64/bin;'+process.env.PATH};
function run(cmd,args){const r=spawnSync(cmd,args,{cwd:dir,env,encoding:'utf8'});assert.equal(r.status,0,r.stdout+r.stderr);checks.push(r.stdout.trim());}
for(const precision of ['float','double']){
 const exe=path.join(dir,'test_'+precision+'.exe'),task=path.join(fresh,'Task');
 run('D:/MinGW/mingw64/bin/gcc.exe',['-std=c99','-O2','-Wall','-Wextra','-Werror','-Wno-unused-function',...(precision==='double'?['-DE5_USE_DOUBLE']:[]),'-I',task,'test_native.c','baseline_wrapper.c',path.join(task,'blnn_core.c'),'-lm','-o',exe]);
 run(exe,[path.join(dir,'native_'+precision+'.bin')]);
 run(process.execPath,['test_decode.mjs',path.join(dir,'native_'+precision+'.bin')]);
}
run(process.execPath,['../identification_q0_manual_round42_20261014/test.mjs']);
const target='exp5ID_Q0M2_BLNN_HW6',buildDir=path.join(fresh,'MDK-ARM',target),axf=path.join(buildDir,target+'.axf'),hex=path.join(buildDir,target+'.hex');
assert(read(path.join(fresh,'MDK-ARM/Q0M2_build01.log')).includes('0 Error(s), 0 Warning(s).'));
for(const f of exceptions)assert(fs.statSync(path.join(fresh,f)).mtimeMs<=fs.statSync(axf).mtimeMs,'Stale AXF '+f);
assert(fs.statSync(hex).mtimeMs>=fs.statSync(axf).mtimeMs,'Stale HEX');
const map=read(path.join(buildDir,target+'.map')),ram=map.match(/Execution Region RW_IRAM1[^\n]*Size: 0x([0-9a-f]+), Max: 0x([0-9a-f]+)/i);assert(ram);
const used=parseInt(ram[1],16),max=parseInt(ram[2],16);assert(max-used>=8192);
assert(/identification_trace\s+0x[0-9a-f]+\s+Data\s+63580/i.test(map));
assert(/fault_trace\s+0x[0-9a-f]+\s+Data\s+1300/i.test(map));
const options=read(path.join(fresh,'MDK-ARM/eassy.uvoptx'));assert(options.includes('<pMon>BIN\\CMSIS_AGDI.dll</pMon>')&&options.includes('<TargetName>'+target+'</TargetName>'));
const result={build:67822,method:11,schema:4489,stopMagic:4440,target,project:path.join(fresh,'MDK-ARM/eassy.uvprojx'),hex,hexSHA256:hash(hex),unchangedSourceFiles:unchanged,motorControlGuardsExact:true,coreAndOtherSourcesExact:true,collectionAndFaultExportGateExact:true,compileErrors:0,compileWarnings:0,ARMTraceBytes:63580,RAM:{used,max,remaining:max-used},checks:checks.filter(Boolean),protocolSHA256:hash(path.join(dir,'protocol.json')),flashed:false,physicalRuns:0,onBoardTimingQualified:false,modelIdentified:false,performanceBenefitProven:false};
fs.writeFileSync(path.join(dir,'verification.json'),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result,null,2));
