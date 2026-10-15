import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';
import assert from 'node:assert/strict';import {spawnSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
const dir=path.dirname(fileURLToPath(import.meta.url)),root=path.resolve(dir,'../../..');
const base=path.join(root,'experiment5_ca_v2/05_实验代码/S3R1_有界纠错_20261013');
const hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const verification=JSON.parse(fs.readFileSync(path.join(dir,'checks_final/verification.json'),'utf8'));assert(verification.allPassed);
for(const [p,h]of Object.entries(verification.sources))assert.equal(hash(p),h,'Source changed after verification: '+p);
for(const [p,h]of Object.entries(verification.preserved))assert.equal(hash(p),h,'Prior five-code/data files changed: '+p);
let archive=0;for(const s of fs.readFileSync(path.join(root,'实验5整理_20261011/SHA256SUMS.txt'),'utf8').trim().split(/\r?\n/)) {
 const m=s.match(/^([a-f0-9]{64})  (.*)$/);assert(m);assert.equal(hash(path.join(root,'实验5整理_20261011',m[2])),m[1]);archive++;
}
const rows=[['BLNN','eassy_E5R1_A_BLNN_HW6','exp5R1_A_BLNN_HW6_EVENT48',66111],['S3R1','eassy_E5R1_A_S3R1_HW6','exp5R1_A_S3R1_HW6_EVENT48',66112],['NO_DRIVE','eassy_E5T6_S3R1_HW6_NO_DRIVE','exp5T6_S3R1_HW6_NO_DRIVE',66212]];
const builds=rows.map(([name,project,target,build])=>{
 const md=path.join(base,project,'MDK-ARM'),log=fs.readFileSync(path.join(md,'build_R1_final.log'),'utf8');
 assert(log.includes('Build target \''+target+'\''));assert(log.includes('0 Error(s), 0 Warning(s).'));
 const hex=path.join(md,target,target+'.hex'),axf=path.join(md,target,target+'.axf');assert(fs.statSync(hex).size>0);assert(fs.statSync(axf).size>0);
 const cfg=fs.readFileSync(path.join(base,project,'Task/experiment5_formal_config.h'),'utf8');assert(cfg.includes('#define E5_SELECTED_BUILD '+build+'U'));
 const stats=log.match(/Program Size: Code=(\d+) RO-data=(\d+) RW-data=(\d+) ZI-data=(\d+)/);assert(stats);assert(Number(stats[3])+Number(stats[4])<112*1024);
 return {name,build,project:path.join(md,'eassy.uvprojx'),target,hex,hexSHA256:hash(hex),axf,axfSHA256:hash(axf),errors:0,warnings:0,codeBytes:+stats[1],roBytes:+stats[2],rwBytes:+stats[3],ziBytes:+stats[4]};
});
const dis=spawnSync('D:/Keil_v5/ARM/ARMCC/bin/fromelf.exe',['--text','-c',builds[2].axf],{encoding:'utf8',maxBuffer:20e6});assert.equal(dis.status,0);
const asm=dis.stdout.replaceAll('\r','');
const marker=asm.indexOf('\n    CAN_cmd_3508\n');assert(marker>=0);
const ending=asm.indexOf('\n    $d',marker+6);assert(ending>marker);const fn=asm.slice(marker,ending);
assert(/MOVS\s+r0,#0/.test(fn));assert(/STR\s+r0,\[sp,#0x18\]/.test(fn));assert(/STR\s+r0,\[sp,#0x1c\]/.test(fn));
assert(/ADD\s+r5,sp,#0x18/.test(fn));assert(/MOV\s+r2,r5/.test(fn));assert(/HAL_CAN_AddTxMessage/.test(fn));
fs.writeFileSync(path.join(dir,'build_manifest.json'),JSON.stringify({date:'2026-10-13',builds,checkedSourceHashes:verification.sources,priorFiveFilesUnchanged:Object.keys(verification.preserved).length,archivedFilesUnchanged:archive,linkedProbeCANFrameAll8BytesZero:true,probeBinaryFunction:fn,boardTimingPending:true,newMotionReleased:false,closedLoopSuperiorityProven:false},null,2));
console.log(JSON.stringify({builds,priorFiveFilesUnchanged:Object.keys(verification.preserved).length,archivedFilesUnchanged:archive,probeCANZeroVerified:true,boardTimingPending:true},null,2));
