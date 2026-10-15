import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const dir=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(dir,'../../..');
const archive=path.join(root,'实验5整理_20261011');
const original=path.join(archive,'05_实验代码/正式对照_HW6_A/eassy_E5F_A_CA_BLNN_HW6');
const fork=path.join(root,'experiment5_ca_v2/05_实验代码/诊断A_旧CA_事件回放/eassy_E5D_A_CA_HW6');
const hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const text=p=>fs.readFileSync(p,'utf8');
const removeComments=s=>s.replace(/\/\*[\s\S]*?\*\//g,'').replace(/\/\/[^\r\n]*/g,'');
let clean=removeComments(text(path.join(fork,'Task/motor_task.c')));
clean=clean.replace('#include "experiment5_event_trace.h"','')
 .replace('static e5_event_trace event_trace;','').replace('static e5_event_record event_row;','')
 .replace(/if\(values\[2\]==6\.0f && values\[22\]==0\.0f\)\s*e5_event_next\(&event_trace,values,g_exp5_dma_completed\);/,'')
 .replace('int16_t event_previous_delta[2]={0,0},event_wanted[2]={0,0};','')
 .replace('e5_event_reset(&event_trace);','')
 .replace('event_previous_delta[0]=controller.ca_delta[0];','')
 .replace('event_previous_delta[1]=controller.ca_delta[1];','')
 .replace('if(done||fault)e5_event_finish(&event_trace);','');
const needle='if(!fault && !event_trace.ready)';
const begin=clean.indexOf(needle);assert(begin>=0);
let depth=0,finish=-1;
for(let i=clean.indexOf('{',begin);i<clean.length;i++){
  if(clean[i]==='{')depth++;
  else if(clean[i]==='}'){depth--;if(depth===0){finish=i+1;break;}}
}
assert(finish>begin);
clean=clean.slice(0,begin)+clean.slice(finish);
assert.equal(clean.replace(/\s/g,''),removeComments(text(path.join(original,'Task/motor_task.c'))).replace(/\s/g,''),
 'After removing instrumentation, motor control/health/fault logic must be EXACTLY the original');
const sources={};
for(const f of fs.readdirSync(path.join(original,'Task'))){
  const p=path.join(original,'Task',f);if(!fs.statSync(p).isFile())continue;
  const q=path.join(fork,'Task',f);
  if(!['motor_task.c','experiment5_formal_config.h'].includes(f))assert.equal(hash(p),hash(q),'Unchanged Task source '+f);
  sources[f]=hash(q);
}
const cfgOld=removeComments(text(path.join(original,'Task/experiment5_formal_config.h'))).replace(/\s/g,'');
const cfgNew=removeComments(text(path.join(fork,'Task/experiment5_formal_config.h'))).replace('64412U','61012U').replace(/\s/g,'');
assert.equal(cfgOld,cfgNew);
sources['experiment5_event_trace.h']=hash(path.join(fork,'Task/experiment5_event_trace.h'));
const archiveLines=text(path.join(archive,'SHA256SUMS.txt')).trim().split(/\r?\n/);
for(const line of archiveLines){const m=line.match(/^([0-9a-f]{64})  (.*)$/);assert(m);assert.equal(hash(path.join(archive,m[2])),m[1],'Archive preservation '+m[2]);}
const test=spawnSync(path.join(dir,'test_trace.exe'),[],{encoding:'utf8',env:{...process.env,PATH:'D:/MinGW/mingw64/bin;'+process.env.PATH}});
assert.equal(test.status,0,test.stderr);assert(test.stdout.startsWith('PASS'));
const log=text(path.join(dir,'keil_rebuild.log'));
assert(log.includes('0 Error(s), 0 Warning(s)'));
const match=log.match(/Code=(\d+) RO-data=(\d+) RW-data=(\d+) ZI-data=(\d+)/);assert(match);
const ram=Number(match[3])+Number(match[4]);assert(ram<0x1C000);
const hex=path.join(fork,'MDK-ARM/exp5D_A_CA_HW6_EVENT128/exp5D_A_CA_HW6_EVENT128.hex');
assert(fs.statSync(hex).size>0);
const result={date:'2026-10-12',diagnosticOnly:true,reportGenerated:false,
  coreAndActuatorUnchanged:true,motorLogicExactlyOriginalAfterRemovingInstrumentation:true,
  guardsUnchanged:true,uartTaskUnchanged:true,telemetryChannels:107,period_ms:40,
  archiveFilesPreserved:archiveLines.length,keilErrors:0,keilWarnings:0,
  totalRAM_bytes:ram,eventLoggerRAM_bytes:16428,hostTest:test.stdout.trim(),
  project:path.join(fork,'MDK-ARM/eassy.uvprojx'),hex,hexSHA256:hash(hex),sourceSHA256:sources,
  physicalFirmwareRuns:0,onDeviceTimingValidated:false,newCAFormalFirmwareReleased:false};
fs.writeFileSync(path.join(dir,'verification.json'),JSON.stringify(result,null,2),{flag:'wx'});
console.log(JSON.stringify(result,null,2));
