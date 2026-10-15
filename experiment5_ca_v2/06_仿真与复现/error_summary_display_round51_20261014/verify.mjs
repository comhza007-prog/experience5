import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const dir=path.dirname(fileURLToPath(import.meta.url)),root=path.resolve(dir,'../..');
const sha=f=>crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const text=f=>fs.readFileSync(f,'utf8').replaceAll('\r\n','\n');
const noComments=s=>s.replace(/\/\*[\s\S]*?\*\//g,'').replace(/\/\/[^\n]*/g,'').replace(/\s+/g,'');
const walk=folder=>fs.readdirSync(folder,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(folder,e.name)):[path.join(folder,e.name)]);
const protocol=JSON.parse(fs.readFileSync(path.join(dir,'protocol.json'),'utf8'));
const old=JSON.parse(fs.readFileSync(path.join(root,protocol.sourceVerification),'utf8'));
const pair=JSON.parse(fs.readFileSync(path.join(root,protocol.previousPairAnalysis),'utf8'));
function imageMap(file) {
  const map=new Map();let upper=0,eof=false;
  for(const line of fs.readFileSync(file,'utf8').trim().split(/\r?\n/)) {
    assert(line.startsWith(':')&&!eof);const b=Buffer.from(line.slice(1),'hex');
    assert.equal(b.length,b[0]+5);assert.equal([...b].reduce((s,v)=>(s+v)&255,0),0);
    if(b[3]===4)upper=b.readUInt16BE(4)*65536;
    if(b[3]===0) {const a=upper+b.readUInt16BE(1);assert(a>=0x08000000&&a+b[0]<=0x08100000);
      for(let i=0;i<b[0];i++){if(map.has(a+i))assert.equal(map.get(a+i),b[4+i]);map.set(a+i,b[4+i]);}}
    if(b[3]===1)eof=true;
  }
  assert(eof&&map.size>0);return [...map].sort((a,b)=>a[0]-b[0]);
}
const records=[];
for(const [name,m] of Object.entries(protocol.methods)) {
  const prior=old.records.find(r=>r.method===name);assert(prior);
  const source=path.resolve(prior.project,'../..'),project=path.join(root,protocol.codeRoot,m.project),newRoot=path.resolve(project,'../..');
  let unchanged=0;
  for(const [rel,h] of Object.entries(prior.sourceHashes)) {
    assert.equal(sha(path.join(source,rel)),h,'Baseline source changed: '+rel);
    if(['Task/vofa_task.c','Task/experiment5_formal_config.h'].includes(rel.replaceAll('\\','/')))continue;
    assert.equal(sha(path.join(newRoot,rel)),h,'Unexpected control source edit: '+rel);unchanged++;
  }
  assert.equal(sha(prior.hex),prior.hexSHA256);
  const oldAXFCurrentHash=sha(prior.axf);
  let expected=text(path.join(source,'Task/vofa_task.c'));
  for(const [a,b] of [
    ['#include "experiment5_error_wave.h"','#include "experiment5_error_wave.h"\n#include "experiment5_error_summary.h"'],
    ['static Vofa_t Vofa;','static Vofa_t Vofa;\nstatic e5_error_summary error_summary;'],
    ['uint32_t sequence=0,rebase=0,now;','uint32_t sequence=0,rebase=0,now,completed_before_send;'],
    ['(void)argument;Vofa_tail_init();','(void)argument;Vofa_tail_init();e5_summary_reset(&error_summary);'],
    ['        now=HAL_GetTick();','        now=HAL_GetTick();\n        e5_summary_complete(&error_summary,g_exp5_dma_completed,tx_error);'],
    ['            tx_task_errors++;','            tx_task_errors++;\n            e5_summary_cancel_pending(&error_summary);'],
    ['            e5_telemetry_snapshot(values);values[1]=(float)sequence;','            e5_telemetry_snapshot(values);values[1]=(float)sequence;\n            e5_summary_observe(&error_summary,values);'],
    ['            e5_error_wave(values);','            e5_error_wave(values);\n            e5_summary_display(&error_summary,values);\n            completed_before_send=g_exp5_dma_completed;'],
    ['            if(status!=HAL_OK) {','            if(status!=HAL_OK) {\n                e5_summary_rejected(&error_summary,values);'],
    ['                g_exp5_uart_last_error=huart6.ErrorCode;\n            }','                g_exp5_uart_last_error=huart6.ErrorCode;\n            } else e5_summary_stage(&error_summary,values,sequence,completed_before_send);']
  ]) {assert(expected.includes(a),'Missing source anchor');expected=expected.replace(a,b);}
  assert.equal(text(path.join(newRoot,'Task/vofa_task.c')),expected,'Unexpected UART-side change');
  const expectedConfig=text(path.join(source,'Task/experiment5_formal_config.h'))
    .replace('#define E5_SELECTED_BUILD '+m.previousBuild+'U','#define E5_SELECTED_BUILD '+m.build+'U')
    .replace('#define E5_FORMAL_SCHEMA '+m.previousSchema+'U','#define E5_FORMAL_SCHEMA '+m.schema+'U');
  assert.equal(noComments(text(path.join(newRoot,'Task/experiment5_formal_config.h'))),noComments(expectedConfig));
  const header=path.join(newRoot,'Task/experiment5_error_summary.h');
  const firstHeader=path.join(path.resolve(root,protocol.codeRoot,protocol.methods.BLNN.project,'../..'),'Task/experiment5_error_summary.h');
  assert.equal(sha(header),sha(firstHeader));
  const additions=walk(newRoot).filter(f=>/\.(c|h|s|uvprojx)$/i.test(f)&&!Object.hasOwn(prior.sourceHashes,path.relative(newRoot,f)));
  assert.deepEqual(additions.map(f=>path.relative(newRoot,f).replaceAll('\\','/')),['Task/experiment5_error_summary.h']);
  const sourceRecord=pair.results[name];assert.equal(sha(sourceRecord.source),sourceRecord.sourceSHA256);
  const csv=fs.readFileSync(sourceRecord.source,'utf8').trim().split(/\r?\n/);
  assert.equal(csv.shift(),Array.from({length:107},(_,i)=>'I'+i).join(','));
  const all=csv.map(line=>line.split(',').map(Number));
  const rows=all.filter(r=>r[63]===m.previousBuild&&r[21]===m.methodID);
  const replay=spawnSync(path.join(dir,'test_summary.exe'),['--replay'],{encoding:'utf8',input:rows.map(r=>r.join(' ')).join('\n')+'\n',maxBuffer:1e6});
  assert.equal(replay.status,0,replay.stdout+'\n'+replay.stderr);
  const replayResult=JSON.parse(replay.stdout.trim());assert(replayResult.valid&&replayResult.samples===400);
  const expectedMetrics=sourceRecord.metrics;
  assert(Math.abs(replayResult.trackingRMSE_mm-expectedMetrics.trackingRMSE_mm)<5e-8);
  assert(Math.abs(replayResult.syncRMS_mm-expectedMetrics.syncRMS_mm)<5e-8);
  const log=fs.readFileSync(path.join(dir,'build_'+name+'.log'),'utf8');
  assert(/0 Error\(s\), 0 Warning\(s\)/.test(log));
  const size=log.match(/Program Size: Code=(\d+) RO-data=(\d+) RW-data=(\d+) ZI-data=(\d+)/);assert(size);
  const md=path.dirname(project),hex=path.join(md,m.target,m.target+'.hex'),axf=path.join(md,m.target,m.target+'.axf');
  const extracted=path.join(dir,name+'_AXF_image.hex');assert(!fs.existsSync(extracted));
  const from=spawnSync('D:/Keil_v5/ARM/ARMCC/bin/fromelf.exe',['--i32combined','--output',extracted,axf],{encoding:'utf8'});
  assert.equal(from.status,0,from.stderr);assert.deepEqual(imageMap(extracted),imageMap(hex));
  assert(fs.readFileSync(path.join(md,'eassy.uvoptx'),'utf8').includes('CMSIS_AGDI.dll'));
  const folder=path.join(root,protocol.dataRoot,m.subfolder);fs.mkdirSync(folder,{recursive:true});assert(!fs.existsSync(path.join(folder,m.filename)));
  records.push({method:name,build:m.build,schema:m.schema,project,target:m.target,hex,axf,
    hexSHA256:sha(hex),axfSHA256:sha(axf),allFlashAddressesAndBytesMatchHEX:true,
    unchangedHistoricalSourceFiles:unchanged,motorTaskAndCoreByteExact:true,onlyUARTSummaryAndIdentityChanges:true,
    baselineSourceAndHEXUnchanged:true,baselineAXFCurrentSHA256:oldAXFCurrentHash,baselineAXFOriginalSHA256:prior.axfSHA256,
    baselineAXFContainerMatchesOldManifest:oldAXFCurrentHash===prior.axfSHA256,baselineAXFNotUsedAsNewReleaseImage:true,
    hostCSVReplay:{source:sourceRecord.source,sourceSHA256:sourceRecord.sourceSHA256,excludedUnidentifiedPrefixRows:all.length-rows.length,
      result:replayResult,expected:expectedMetrics,maximumAllowedAbsoluteDifference_mm:5e-8},
    compileErrors:0,compileWarnings:0,programSize:{code:+size[1],ROdata:+size[2],RWdata:+size[3],ZIdata:+size[4]},
    sourceHashes:Object.fromEntries(walk(newRoot).filter(f=>/\.(c|h|s|uvprojx)$/i.test(f)).map(f=>[path.relative(newRoot,f),sha(f)])),
    savePath:path.join(folder,m.filename),newBoardTimingVerified:false});
}
const unit=spawnSync(path.join(dir,'test_summary.exe'),[],{encoding:'utf8'});assert.equal(unit.status,0,unit.stdout+'\n'+unit.stderr);
const result={allPassed:true,protocolSHA256:sha(path.join(dir,'protocol.json')),verificationCodeSHA256:sha(fileURLToPath(import.meta.url)),
  hostTestCodeSHA256:sha(path.join(dir,'test_summary.c')),hostTestBinarySHA256:sha(path.join(dir,'test_summary.exe')),unitTestResult:unit.stdout.trim(),
  decimalRoundtripFixtures:100000,records,controllerChanged:false,displayOnly:true,statisticsWindow:'Native40ms phase2..5/I106=1,CSV6decimal metre definition',
  thresholdUptime_s:100,invalidSummarySentinel:-1,UARTTCisNotHostReceptionACK:true,oldRawDataUnchanged:true,
  telemetryChannels:107,frameBytes:432,telemetryPeriod_ms:40,baud:115200,
  freshARMRebuilds:true,newBoardTimingVerified:false,assistantFlashed:false,assistantStartedMotor:false,
  noTenRunRelease:true,noV1Release:true};
fs.writeFileSync(path.join(dir,'verification.json'),JSON.stringify(result,null,2),{flag:'wx'});
console.log(JSON.stringify({...result,records:records.map(({sourceHashes,...r})=>r)},null,2));
