import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import crypto from 'node:crypto';import {spawnSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
const dir=path.dirname(fileURLToPath(import.meta.url)),root=path.resolve(dir,'../../..');
const project=path.join(root,'experiment5_ca_v2/05_实验代码/在线调参_通信准入_20261013/eassy_E5OL_A_NO_DRIVE'),md=path.join(project,'MDK-ARM'),target='exp5OL_A_NO_DRIVE_PROTOCOL';
const hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const checks=JSON.parse(fs.readFileSync(path.join(dir,'checks02/verification.json'),'utf8'));assert(checks.passed&&!checks.motionEnabled);
const log=fs.readFileSync(path.join(md,'build_online_final.log'),'utf8');assert(log.includes('0 Error(s), 0 Warning(s).'));assert(log.includes("Rebuild target '"+target+"'"));
const size=log.match(/Program Size: Code=(\d+) RO-data=(\d+) RW-data=(\d+) ZI-data=(\d+)/);assert(size);assert(+size[3]+ +size[4]<112*1024);
const hex=path.join(md,target,target+'.hex'),axf=path.join(md,target,target+'.axf');let upper=0,eof=false,n=0;
for(const line of fs.readFileSync(hex,'utf8').trim().split(/\r?\n/)) {
 const b=Buffer.from(line.slice(1),'hex');assert(line.startsWith(':')&&b.length===b[0]+5);assert.equal([...b].reduce((s,v)=>(s+v)&255,0),0);assert(!eof);
 if(b[3]===4)upper=b.readUInt16BE(4)*65536;
 if(b[3]===0){let addr=upper+b.readUInt16BE(1);assert(addr>=0x08000000&&addr+b[0]<=0x08100000);n++;}
 if(b[3]===1)eof=true;
}assert(eof&&n>0);
const dis=fs.readFileSync(path.join(dir,'disassembly.txt'),'utf8');assert(!/\bBL\s+e5_step\b/.test(dis));assert.equal((dis.match(/\bBL\s+CAN_cmd_3508\b/g)||[]).length,4);
const h=fs.readFileSync(path.join(project,'Task/online_protocol.h'),'utf8');assert(h.includes('#define E5_OL_MOTION_ENABLED 0U'));
const cfg=fs.readFileSync(path.join(project,'Task/experiment5_formal_config.h'),'utf8');assert(cfg.includes('#define E5_SELECTED_BUILD 66812U'));assert(cfg.includes('#define E5_FORMAL_SCHEMA 4477U'));
const ps=spawnSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(dir,'test_host.ps1')],{encoding:'utf8'});assert.equal(ps.status,0,ps.stderr+ps.stdout);
const files=['blnn_core.c','online_uart.c','online_uart.h','online_protocol.h','motor_task.c','vofa_task.c','experiment5_formal_config.h'];
const sources=Object.fromEntries(files.map(f=>[path.join(project,'Task',f),hash(path.join(project,'Task',f))]));
const result={build:66812,schema:4477,project:path.join(md,'eassy.uvprojx'),target,hex,hexSHA256:hash(hex),axfSHA256:hash(axf),errors:0,warnings:0,hexChecksumsAndFlashRangePassed:true,programBytes:{code:+size[1],ro:+size[2],rw:+size[3],zi:+size[4]},hostChecksPassed:true,defaultExactlyR2:true,motionEnabled:false,noMotorCoreCallInLinkedQualificationBinary:true,canCallSitesReviewed:4,powerShellOfflineTests:ps.stdout.trim(),wrongFirmwareReadOnlyRefusalVerified:true,sources,onBoardCommunicationVerified:false,onBoardTimingMeasured:false,flashed:false,physicalPerformanceProven:false};
fs.writeFileSync(path.join(dir,'build_manifest.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({build:66812,hexSHA256:result.hexSHA256,errors:0,warnings:0,hostChecksPassed:true,motionEnabled:false,flashed:false,onBoardCommunicationVerified:false},null,2));
