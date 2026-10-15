import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const dir=path.dirname(fileURLToPath(import.meta.url)),root=path.resolve(dir,'../..');
const sha=f=>crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const plain=f=>fs.readFileSync(f,'utf8').replace(/\/\*[\s\S]*?\*\//g,'').replace(/\/\/[^\n]*/g,'').replace(/\s+/g,'');
const walk=d=>fs.readdirSync(d,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(d,e.name)):[path.join(d,e.name)]);
const protocol=JSON.parse(fs.readFileSync(path.join(dir,'protocol.json'),'utf8'));
const before=JSON.parse(fs.readFileSync(path.join(root,protocol.previousVerification),'utf8'));
const pair=JSON.parse(fs.readFileSync(path.join(root,protocol.priorPairAnalysis),'utf8'));
function image(file) {
  const map=new Map();let upper=0,eof=false;
  for(const line of fs.readFileSync(file,'utf8').trim().split(/\r?\n/)) {
    assert(line.startsWith(':')&&!eof);const b=Buffer.from(line.slice(1),'hex');
    assert.equal(b.length,b[0]+5);assert.equal([...b].reduce((s,v)=>(s+v)&255,0),0);
    if(b[3]===4)upper=b.readUInt16BE(4)*65536;
    if(b[3]===0) {const a=upper+b.readUInt16BE(1);assert(a>=0x08000000&&a+b[0]<=0x08100000);
      for(let i=0;i<b[0];i++){if(map.has(a+i))assert.equal(map.get(a+i),b[4+i]);map.set(a+i,b[4+i]);}}
    if(b[3]===1)eof=true;
  }
  assert(eof&&map.size);return [...map].sort((a,b)=>a[0]-b[0]);
}
const records=[];
for(const [method,m] of Object.entries(protocol.methods)) {
  const previous=before.records.find(r=>r.method===method);assert(previous);
  const oldRoot=path.resolve(previous.project,'../..'),project=path.join(root,protocol.codeRoot,m.project),newRoot=path.resolve(project,'../..');
  let unchanged=0;
  for(const [f,h] of Object.entries(previous.sourceHashes)) {
    assert.equal(sha(path.join(oldRoot,f)),h,'Previous source changed: '+f);
    if(['Task/experiment5_error_summary.h','Task/experiment5_formal_config.h'].includes(f.replaceAll('\\','/')))continue;
    assert.equal(sha(path.join(newRoot,f)),h,'Unexpected source edit: '+f);unchanged++;
  }
  assert.equal(sha(previous.hex),previous.hexSHA256);
  const expectedHeader=plain(path.join(oldRoot,'Task/experiment5_error_summary.h')).replace(
    'if(v[0]<100.0f)return;',
    'if(v[0]<40.0f)return;if(v[2]!=6.0f){if(v[2]==9.0f||v[22]!=0.0f||s->invalid){v[53]=-1.0f;v[54]=-1.0f;}return;}');
  assert.equal(plain(path.join(newRoot,'Task/experiment5_error_summary.h')),expectedHeader,'Only display gate may change');
  const expectedConfig=plain(path.join(oldRoot,'Task/experiment5_formal_config.h'))
    .replace('E5_SELECTED_BUILD'+m.previousBuild+'U','E5_SELECTED_BUILD'+m.build+'U')
    .replace('E5_FORMAL_SCHEMA'+m.previousSchema+'U','E5_FORMAL_SCHEMA'+m.schema+'U');
  assert.equal(plain(path.join(newRoot,'Task/experiment5_formal_config.h')),expectedConfig);
  const additions=walk(newRoot).filter(f=>/\.(c|h|s|uvprojx)$/i.test(f)&&!Object.hasOwn(previous.sourceHashes,path.relative(newRoot,f)));
  assert.equal(additions.length,0);
  const firstRoot=path.resolve(root,protocol.codeRoot,protocol.methods.BLNN.project,'../..');
  assert.equal(sha(path.join(newRoot,'Task/experiment5_error_summary.h')),sha(path.join(firstRoot,'Task/experiment5_error_summary.h')));
  const source=pair.results[method];assert.equal(sha(source.source),source.sourceSHA256);
  const csv=fs.readFileSync(source.source,'utf8').trim().split(/\r?\n/);assert.equal(csv.shift(),Array.from({length:107},(_,i)=>'I'+i).join(','));
  const all=csv.map(line=>line.split(',').map(Number)),fixtureBuild=method==='BLNN'?67911:67912;
  const selected=all.filter(r=>r[63]===fixtureBuild&&r[21]===m.methodID);
  const replay=spawnSync(path.join(dir,'test_summary.exe'),['--replay'],{encoding:'utf8',input:selected.map(r=>r.join(' ')).join('\n')+'\n',maxBuffer:1e6});
  assert.equal(replay.status,0,replay.stdout+'\n'+replay.stderr);const r=JSON.parse(replay.stdout.trim());
  assert(r.valid&&r.samples===400&&r.firstSummaryUptime_s>=40&&r.firstSummaryUptime_s<40.05);
  assert(Math.abs(r.trackingRMSE_mm-source.metrics.trackingRMSE_mm)<5e-8);
  assert(Math.abs(r.syncRMS_mm-source.metrics.syncRMS_mm)<5e-8);
  const log=fs.readFileSync(path.join(dir,'build_'+method+'.log'),'utf8');assert(/0 Error\(s\), 0 Warning\(s\)/.test(log));
  const size=log.match(/Program Size: Code=(\d+) RO-data=(\d+) RW-data=(\d+) ZI-data=(\d+)/);assert(size);
  const md=path.dirname(project),hex=path.join(md,m.target,m.target+'.hex'),axf=path.join(md,m.target,m.target+'.axf');
  const extracted=path.join(dir,method+'_AXF_image.hex');assert(!fs.existsSync(extracted));
  const from=spawnSync('D:/Keil_v5/ARM/ARMCC/bin/fromelf.exe',['--i32combined','--output',extracted,axf],{encoding:'utf8'});
  assert.equal(from.status,0,from.stderr);assert.deepEqual(image(hex),image(extracted));
  assert(fs.readFileSync(path.join(md,'eassy.uvoptx'),'utf8').includes('CMSIS_AGDI.dll'));
  const dataFolder=path.join(root,protocol.dataRoot,m.subfolder);fs.mkdirSync(dataFolder,{recursive:true});assert(!fs.existsSync(path.join(dataFolder,m.filename)));
  records.push({method,build:m.build,schema:m.schema,project,target:m.target,hex,axf,hexSHA256:sha(hex),axfSHA256:sha(axf),
    allNewFlashAddressesAndBytesMatchHEX:true,unchangedHistoricalSourceFiles:unchanged,motorCoreGuardsAndUARTTaskByteExact:true,
    statisticalAccumulationUnchanged:true,onlyDisplayGateAndBuildSchemaChanged:true,
    CSVReplay:{source:source.source,sourceSHA256:source.sourceSHA256,excludedUnidentifiedPrefixRows:all.length-selected.length,result:r,expected:source.metrics},
    compileErrors:0,compileWarnings:0,programSize:{code:+size[1],ROdata:+size[2],RWdata:+size[3],ZIdata:+size[4]},
    sourceHashes:Object.fromEntries(walk(newRoot).filter(f=>/\.(c|h|s|uvprojx)$/i.test(f)).map(f=>[path.relative(newRoot,f),sha(f)])),
    savePath:path.join(dataFolder,m.filename),newBoardTimingVerified:false});
}
const unit=spawnSync(path.join(dir,'test_summary.exe'),[],{encoding:'utf8'});assert.equal(unit.status,0,unit.stdout+'\n'+unit.stderr);
const result={allPassed:true,protocolSHA256:sha(path.join(dir,'protocol.json')),verificationCodeSHA256:sha(fileURLToPath(import.meta.url)),
  hostTestCodeSHA256:sha(path.join(dir,'test_summary.c')),hostTestBinarySHA256:sha(path.join(dir,'test_summary.exe')),unitResult:unit.stdout.trim(),records,
  decimalRoundtripFixtures:100000,thresholdUptime_s:40,requirePhase6BeforeSummary:true,delayedMotionNotCutShort:true,
  allOther105ChannelMappingsPreserved:true,oldSourceAndRawDataUnchanged:true,freshARMRebuilds:true,
  controllerChanged:false,telemetryChannels:107,frameBytes:432,period_ms:40,baud:115200,
  fullExportStillRequiresStatus4Plus10seconds:true,newBoardTimingVerified:false,
  assistantFlashed:false,assistantStartedMotor:false,tenRunBatchReleased:false,V1Released:false};
fs.writeFileSync(path.join(dir,'verification.json'),JSON.stringify(result,null,2),{flag:'wx'});
console.log(JSON.stringify({...result,records:records.map(({sourceHashes,...r})=>r)},null,2));
