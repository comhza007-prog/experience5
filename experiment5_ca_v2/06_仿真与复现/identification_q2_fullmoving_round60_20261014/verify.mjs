import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const dir=path.dirname(fileURLToPath(import.meta.url)),root=path.resolve(dir,'../..');
const original=path.join(root,'05_实验代码/辨识Q0_手动VOFA_安全编码_20261014/eassy_E5ID_Q0M3_BLNN_HW6');
const fresh=path.join(root,'05_实验代码/模型闭环_高采样率准入Q2_20261014/eassy_E5ID_Q2M_BLNN_HW6');
const read=p=>fs.readFileSync(p,'utf8').replaceAll('\r\n','\n'),hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const allowed=['Task/identification_trace.h','Task/motor_task.c','Task/experiment5_formal_config.h'];let unchanged=0;
function walk(rel){for(const e of fs.readdirSync(path.join(original,rel),{withFileTypes:true})){const p=path.posix.join(rel,e.name);if(e.isDirectory())walk(p);else if(!allowed.includes(p)){assert.equal(hash(path.join(original,p)),hash(path.join(fresh,p)),p);unchanged++;}}}
for(const p of ['Task','Core','Drivers','Middlewares','CAN-control'])walk(p);
assert.equal(read(path.join(original,'Task/motor_task.c')).replace('/* Q0 ordinary BLNN identification logger, build67823/schema4490.','/* Q2 full-moving-rate BLNN logger, build68011/schema4498.'),read(path.join(fresh,'Task/motor_task.c')),'Any runtime hook/control/guard change');
assert.equal(read(path.join(original,'Task/experiment5_formal_config.h')).replace('/* Q0 ordinary BLNN identification logger. ZERO excitation only.','/* Q2 full-moving-rate BLNN qualification logger. ZERO excitation only.').replace('67823U','68011U').replace('4490U','4498U'),read(path.join(fresh,'Task/experiment5_formal_config.h')));
for(const ext of ['uvprojx','uvoptx'])assert.equal(read(path.join(original,'MDK-ARM/eassy.'+ext)).replaceAll('exp5ID_Q0M3_BLNN_HW6','exp5ID_Q2M_BLNN_HW6'),read(path.join(fresh,'MDK-ARM/eassy.'+ext)));
const env={...process.env,PATH:'D:/MinGW/mingw64/bin;'+process.env.PATH},checks=[];
function run(c,args){const r=spawnSync(c,args,{cwd:dir,env,encoding:'utf8'});assert.equal(r.status,0,r.stdout+r.stderr);if(r.stdout.trim())checks.push(r.stdout.trim());}
run('D:/MinGW/mingw64/bin/gcc.exe',['-std=c99','-O2','-Wall','-Wextra','-Werror','-Wno-unused-function','-I',path.join(fresh,'Task'),'test_native.c','-o','test_native.exe']);
run(path.join(dir,'test_native.exe'),['native.bin','expected.csv']);run(process.execPath,['test_decode.mjs']);
run(process.execPath,['../identification_q0_safe_encoding_round44_20261014/test_encoding.mjs']);
const target='exp5ID_Q2M_BLNN_HW6',build=path.join(fresh,'MDK-ARM',target),axf=path.join(build,target+'.axf'),hex=path.join(build,target+'.hex');
assert(read(path.join(fresh,'MDK-ARM/Q2_build01.log')).includes('0 Error(s), 0 Warning(s).'));
for(const p of allowed)assert(fs.statSync(path.join(fresh,p)).mtimeMs<fs.statSync(axf).mtimeMs,'Stale binary '+p);
assert(fs.statSync(hex).mtimeMs>=fs.statSync(axf).mtimeMs);
const map=read(path.join(build,target+'.map')),ram=map.match(/Execution Region RW_IRAM1[^\n]*Size: 0x([0-9a-f]+), Max: 0x([0-9a-f]+)/i);assert(ram,'RAM region');
const used=parseInt(ram[1],16),max=parseInt(ram[2],16);assert(max-used>=3072,'InsufficientRAM margin');
assert(/identification_trace\s+0x[0-9a-f]+\s+Data\s+71032/i.test(map),'ARM trace ABI');assert(/fault_trace\s+0x[0-9a-f]+\s+Data\s+1300/i.test(map));
// Independently recover IntelHEX bytes and compare linked executable BIN.
run('D:/Keil_v5/ARM/ARMCC/bin/fromelf.exe',['--bin','--output',path.join(dir,'linked.bin'),axf]);
let high=0,lo=Infinity,hi=0;const regions=[];
for(const l of read(hex).trim().split('\n')){assert(l.startsWith(':'));const b=Buffer.from(l.slice(1).trim(),'hex');assert.equal([...b].reduce((a,x)=>a+x,0)&255,0,'HEX checksum');const n=b[0],type=b[3],address=b.readUInt16BE(1);if(type===4)high=b.readUInt16BE(4)*65536;else if(type===0){const at=high+address;lo=Math.min(lo,at);hi=Math.max(hi,at+n);regions.push([at,b.subarray(4,4+n)]);}}
assert.equal(lo,0x08000000);const image=Buffer.alloc(hi-lo);for(const [at,b]of regions)b.copy(image,at-lo);assert(image.equals(fs.readFileSync(path.join(dir,'linked.bin'))),'AXF/HEX image mismatch');
const result={created:'2026-10-14',checked:'2026-10-15',build:68011,schema:4498,magic:4443,project:path.join(fresh,'MDK-ARM/eassy.uvprojx'),target,hex,hexSHA256:hash(hex),unchangedSourceFiles:unchanged,motorTaskExceptCommentExact:true,controlAndProtectionUnchanged:true,compileErrors:0,compileWarnings:0,ARMTraceBytes:71032,RAM:{used,max,remaining:max-used},blobBytes:70944,chunks:739,exportFrames:2956,checks,AXF_HEX_ByteExact:true,manualQualificationUserApproved:true,releaseOnlyOneZeroExcitationRun:true,assistantFlashed:false,assistantMotorRun:false,onBoardTimingQualified:false,modelIdentified:false,paperModelClosureComplete:false};
fs.writeFileSync(path.join(dir,'verification.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
