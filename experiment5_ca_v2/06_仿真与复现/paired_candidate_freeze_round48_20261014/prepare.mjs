// Prepare immutable-byte copies and a prospective schedule. No hardware APIs.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const dir=path.dirname(fileURLToPath(import.meta.url));
const e5=path.resolve(dir,'../..');
const protocolFile=path.join(dir,'protocol.json');
const p=JSON.parse(fs.readFileSync(protocolFile,'utf8'));
const digest=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const walk=folder=>fs.readdirSync(folder,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(folder,e.name)):[path.join(folder,e.name)]);
const old=JSON.parse(fs.readFileSync(path.join(e5,p.historicalManifest),'utf8'));
const priorProtocol=JSON.parse(fs.readFileSync(path.join(e5,p.predecessor),'utf8'));
const destination=path.join(e5,p.frozenBundle);
assert(!fs.existsSync(destination),'Frozen bundle already exists; do not overwrite.');
assert(!fs.existsSync(path.join(dir,'freeze_manifest.json')),'Manifest exists; do not overwrite.');

function intelImage(file) {
  const bytes=new Map();let upper=0,eof=false;
  for(const line of fs.readFileSync(file,'utf8').trim().split(/\r?\n/)) {
    assert(line.startsWith(':')&&!eof);
    const b=Buffer.from(line.slice(1),'hex');
    assert.equal(b.length,b[0]+5);assert.equal([...b].reduce((s,v)=>(s+v)&255,0),0);
    const type=b[3],addr=b.readUInt16BE(1);
    if(type===4)upper=b.readUInt16BE(4)*65536;
    if(type===0) {
      assert(upper+addr>=0x08000000&&upper+addr+b[0]<=0x08100000);
      for(let i=0;i<b[0];i++) {const a=upper+addr+i;if(bytes.has(a))assert.equal(bytes.get(a),b[4+i]);bytes.set(a,b[4+i]);}
    }
    if(type===1)eof=true;
  }
  assert(eof&&bytes.size>0);
  return [...bytes].sort((a,b)=>a[0]-b[0]);
}

const records=[];
// Verify BEFORE copying, including historical source hashes remapped to D.
for(const [name,m] of Object.entries(p.methods)) {
  const priorName=name==='S3R2'?'R2':name;
  const previous=old.records.find(r=>r.method===priorName);assert(previous);
  const project=path.join(e5,p.sourceBundle,m.project);
  const sourceRoot=path.resolve(project,'../..');
  const expectedMarker=p.sourceBundle.replaceAll('/','\\')+'\\';
  let historicalSourceFiles=0;
  for(const [historicFile,hash] of Object.entries(previous.copiedHashes)) {
    if(!/\.(c|h|s|uvprojx)$/i.test(historicFile))continue;
    const normalized=historicFile.replaceAll('/','\\');
    const start=normalized.indexOf(expectedMarker);assert(start>=0);
    const relative=normalized.slice(start+expectedMarker.length);
    const current=path.join(e5,p.sourceBundle,relative);
    assert.equal(digest(current),hash,'Historical source mismatch: '+current);historicalSourceFiles++;
  }
  assert(historicalSourceFiles>100);
  const md=path.dirname(project),hex=path.join(md,m.target,m.target+'.hex'),axf=path.join(md,m.target,m.target+'.axf');
  assert.equal(digest(hex),m.hexSHA256);
  const axfContainerMatchesPriorManifest=digest(axf)===previous.axfSHA256;
  const config=fs.readFileSync(path.join(sourceRoot,'Task/experiment5_formal_config.h'),'utf8');
  assert(config.includes('#define E5_SELECTED_BUILD '+m.build+'U'));
  assert(config.includes('#define E5_SELECTED_METHOD '+m.methodID+'U'));
  assert(config.includes('#define E5_FORMAL_SCHEMA '+m.activeSchema+'U'));
  const trace=fs.readFileSync(path.join(sourceRoot,'Task/experiment5_event_trace.h'),'utf8');
  assert(trace.includes('#define E5_EVENT_MAGIC '+m.eventMagic+'U'));
  assert(trace.includes('#define E5_EVENT_WIDTH '+m.eventWidth+'U'));
  const opts=fs.readFileSync(path.join(md,'eassy.uvoptx'),'utf8');
  assert(opts.includes('CMSIS_AGDI.dll'),'CMSIS-DAP option missing');
  const extracted=path.join(dir,name+'_verified_AXF_image.hex');
  assert(!fs.existsSync(extracted));
  const r=spawnSync('D:/Keil_v5/ARM/ARMCC/bin/fromelf.exe',['--i32combined','--output',extracted,axf],{encoding:'utf8'});
  assert.equal(r.status,0,r.stdout+'\n'+r.stderr);
  assert.deepEqual(intelImage(extracted),intelImage(hex),'AXF load image mismatch');
  records.push({method:name,build:m.build,sourceRoot,projectRelative:m.project,target:m.target,
                historicalSourceFilesChecked:historicalSourceFiles,sourceHashes:Object.fromEntries(walk(sourceRoot).map(f=>[path.relative(sourceRoot,f),digest(f)])),
                hexSHA256:digest(hex),axfSHA256:digest(axf),priorManifestAXF_SHA256:previous.axfSHA256,axfContainerMatchesPriorManifest,
                currentContainerDiscrepancyNote:axfContainerMatchesPriorManifest?null:'Container differs from previous manifest; origin unknown. Complete Flash load bytes must independently match historically sealed HEX; no claim of whole-container historical identity.',
                historicalAXFContainerNote:previous.axfDifferenceNote??null,
                fullFlashImageMatchesHistoricalHex:true,flashImageBytes:intelImage(hex).length,CMSISDAPOptionsPresent:true});
}
for(const file of ['experiment5_motion.h','experiment5_hw_profile.h','periodic_release.h'])
  assert.equal(digest(path.join(records[0].sourceRoot,'Task',file)),digest(path.join(records[1].sourceRoot,'Task',file)),'Common hardware guard differs');
assert.deepEqual(p.conditions.limits_counts,[1200,1200]);
assert.equal(p.conditions.stroke_mm,2);assert.equal(p.conditions.load_g,0);
assert.equal(priorProtocol.methods.R2.build,p.methods.S3R2.build);
fs.mkdirSync(destination,{recursive:true});
for(const record of records) {
  const project=path.join(destination,record.projectRelative),copiedRoot=path.resolve(project,'../..');
  fs.mkdirSync(path.dirname(copiedRoot),{recursive:true});
  fs.cpSync(record.sourceRoot,copiedRoot,{recursive:true,errorOnExist:true,force:false,preserveTimestamps:true});
  for(const [relative,hash] of Object.entries(record.sourceHashes))assert.equal(digest(path.join(copiedRoot,relative)),hash);
  record.project=project;record.frozenRoot=copiedRoot;record.allCopiedBytesExact=true;
}
let step=0;
const order=p.design.blockOrders.flatMap((methods,i)=>methods.map(method=>{
  const m=p.methods[method],pair=String(i+1).padStart(2,'0');
  const filename=`E5P_A_${method}_B${m.build}_HW6_L1200_R1200_M0g_S2mm_pair${pair}_attempt01.csv`;
  const folder=path.join(e5,p.dataRoot,m.dataSubfolder);
  fs.mkdirSync(folder,{recursive:true});assert(!fs.existsSync(path.join(folder,filename)));
  return {step:++step,pair:i+1,method,build:m.build,project:path.join(destination,m.project),filename,savePath:path.join(folder,filename)};
}));
assert.equal(order.length,10);
assert.equal(new Set(order.map(o=>o.savePath)).size,10);
for(const method of Object.keys(p.methods))assert.equal(order.filter(o=>o.method===method).length,5);
const result={date:p.date,allPassed:true,protocolSHA256:digest(protocolFile),preparationCodeSHA256:digest(fileURLToPath(import.meta.url)),
  originalHistoricalManifestSHA256:digest(path.join(e5,p.historicalManifest)),records,order,
  commonMotionHardwareAndPeriodGuardsIdentical:true,algorithmOrSourceChanged:false,newCompile:false,assistantFlashed:false,
  hardwareAPIAccess:false,motorStarted:false,firstManualPairPrepared:true,plannedPairs:5,physicalRecordsCollected:0,
  noBenefitPresumed:true,V1Released:false,priorRawDataUnchanged:true};
fs.writeFileSync(path.join(dir,'freeze_manifest.json'),JSON.stringify(result,null,2),{flag:'wx'});
console.log(JSON.stringify({allPassed:true,records:records.map(r=>({method:r.method,build:r.build,historicalSourceFilesChecked:r.historicalSourceFilesChecked,allCopiedBytesExact:r.allCopiedBytesExact,project:r.project,hexSHA256:r.hexSHA256})),
                            order,assistantFlashed:false,algorithmChanged:false},null,2));
