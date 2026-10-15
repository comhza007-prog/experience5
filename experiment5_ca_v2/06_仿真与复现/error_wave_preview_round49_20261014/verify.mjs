import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const dir=path.dirname(fileURLToPath(import.meta.url)),e5=path.resolve(dir,'../..');
const p=JSON.parse(fs.readFileSync(path.join(dir,'protocol.json'),'utf8'));
const old=JSON.parse(fs.readFileSync(path.join(dir,'../paired_candidate_freeze_round48_20261014/freeze_manifest.json'),'utf8'));
const hash=f=>crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const text=f=>fs.readFileSync(f,'utf8').replaceAll('\r\n','\n');
const withoutComments=s=>s.replace(/\/\*[\s\S]*?\*\//g,'').replace(/\/\/[^\n]*/g,'').replace(/\s+/g,'');
const walk=folder=>fs.readdirSync(folder,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(folder,e.name)):[path.join(folder,e.name)]);
const records=[];
for(const [name,m] of Object.entries(p.methods)) {
  const previous=old.records.find(r=>r.method===name);assert(previous);
  const project=path.join(e5,p.codeRoot,m.project),root=path.resolve(project,'../..');
  let unchangedSources=0;
  for(const [relative,h] of Object.entries(previous.sourceHashes)) {
    assert.equal(hash(path.join(previous.frozenRoot,relative)),h,'Old frozen package changed: '+relative);
    if(!/\.(c|h|s|uvprojx)$/i.test(relative))continue;
    const rel=relative.replaceAll('\\','/');
    if(rel==='Task/vofa_task.c'||rel==='Task/experiment5_formal_config.h')continue;
    assert.equal(hash(path.join(root,relative)),h,'Unexpected source change: '+relative);unchangedSources++;
  }
  const vpath='Task/vofa_task.c',config='Task/experiment5_formal_config.h';
  const expectedVofa=text(path.join(previous.frozenRoot,vpath))
    .replace('#include "periodic_release.h"','#include "periodic_release.h"\n#include "experiment5_error_wave.h"')
    .replace('            e5_telemetry_snapshot(values);values[1]=(float)sequence;',
             '            e5_telemetry_snapshot(values);values[1]=(float)sequence;\n            e5_error_wave(values);');
  assert.equal(text(path.join(root,vpath)),expectedVofa,'Unexpected UART edit');
  const expectedConfig=text(path.join(previous.frozenRoot,config))
    .replace('#define E5_SELECTED_BUILD '+m.previousBuild+'U','#define E5_SELECTED_BUILD '+m.build+'U')
    .replace('#define E5_FORMAL_SCHEMA '+m.previousSchema+'U','#define E5_FORMAL_SCHEMA '+m.schema+'U');
  assert.equal(withoutComments(text(path.join(root,config))),withoutComments(expectedConfig),'Unexpected configuration change');
  const macro=text(path.join(root,config));assert(macro.includes('#define E5_FORMAL_TELEMETRY_CHANNELS 107U'));
  const newSources=walk(root).filter(f=>/\.(c|h|s|uvprojx)$/i.test(f)&&!Object.hasOwn(previous.sourceHashes,path.relative(root,f)));
  assert.deepEqual(newSources.map(f=>path.relative(root,f).replaceAll('\\','/')),['Task/experiment5_error_wave.h']);
  assert.equal(hash(path.join(root,'Task/experiment5_error_wave.h')),hash(path.join(e5,p.codeRoot,p.methods.BLNN.project,'../../Task/experiment5_error_wave.h')));
  const log=fs.readFileSync(path.join(dir,'build_'+name+'.log'),'utf8');
  assert(/0 Error\(s\), 0 Warning\(s\)/.test(log),'ARM build failed or warning');
  const size=log.match(/Program Size: Code=(\d+) RO-data=(\d+) RW-data=(\d+) ZI-data=(\d+)/);
  const md=path.dirname(project),hex=path.join(md,m.target,m.target+'.hex'),axf=path.join(md,m.target,m.target+'.axf');
  assert(fs.statSync(hex).size>0&&fs.statSync(axf).size>0);
  assert(fs.readFileSync(path.join(md,'eassy.uvoptx'),'utf8').includes('CMSIS_AGDI.dll'));
  const folder=path.join(e5,p.dataRoot,m.subfolder);fs.mkdirSync(folder,{recursive:true});
  assert(!fs.existsSync(path.join(folder,m.filename)),'Existing capture, do not overwrite');
  records.push({method:name,build:m.build,schema:m.schema,project,target:m.target,hex,axf,hexSHA256:hash(hex),axfSHA256:hash(axf),
    previousControlBuild:m.previousBuild,unchangedHistoricalSourceFiles:unchangedSources,
    exactMotorTaskAndCoreSource:true,onlyUARTViewAndBuildSchemaChanged:true,compileErrors:0,compileWarnings:0,
    programSize:size?{code:Number(size[1]),ROdata:Number(size[2]),RWdata:Number(size[3]),ZIdata:Number(size[4])}:null,
    sourceHashes:Object.fromEntries(walk(root).filter(f=>/\.(c|h|s|uvprojx)$/i.test(f)).map(f=>[path.relative(root,f),hash(f)])),
    savePath:path.join(folder,m.filename),CMSISDAPOptionsPresent:true,onBoardTimingVerified:false});
}
const test=spawnSync(path.join(dir,'test_error_wave.exe'),[],{encoding:'utf8'});
assert.equal(test.status,0,test.stdout+'\n'+test.stderr);assert(test.stdout.includes('PASS:100000'));
const result={allPassed:true,protocolSHA256:hash(path.join(dir,'protocol.json')),verificationCodeSHA256:hash(fileURLToPath(import.meta.url)),
  hostTestCodeSHA256:hash(path.join(dir,'test_error_wave.c')),hostTestBinarySHA256:hash(path.join(dir,'test_error_wave.exe')),
  hostTestResult:test.stdout.trim(),fixtures:100000,unmodifiedChannelValues:105,oldFrozenFilesUnchanged:true,
  records,channels:107,frameBytes:432,cadence_ms:40,baud:115200,
  observationOnly:true,controllerOrGuardChanges:false,compileIsNotOnBoardTimingProof:true,
  manualPreviewOnly:true,plannedRuns:2,tenRunBatchSuspended:true,assistantFlashed:false,motorStarted:false};
fs.writeFileSync(path.join(dir,'verification.json'),JSON.stringify(result,null,2),{flag:'wx'});
console.log(JSON.stringify({allPassed:true,hostTestResult:result.hostTestResult,records:records.map(({sourceHashes,...r})=>r),plannedRuns:2,assistantFlashed:false},null,2));
