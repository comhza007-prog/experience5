import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import crypto from 'node:crypto';import {spawnSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
const dir=path.dirname(fileURLToPath(import.meta.url)),root=path.resolve(dir,'../../..');
const project=path.join(root,'experiment5_ca_v2/05_实验代码/S3R9_同步主导平移协调_20261013/eassy_E5R9_A_S3R9_HW6');
const target='exp5R9_A_S3R9_HW6_EVENT48',md=path.join(project,'MDK-ARM'),task=path.join(project,'Task'),checksDir=path.join(dir,'checks01');
const hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const checks=JSON.parse(fs.readFileSync(path.join(checksDir,'verification.json'),'utf8'));assert(checks.allPassed&&checks.newFailures.length===0&&checks.disabledExactlyR8&&checks.asymmetricExactlyR8);
for(const[p,h]of Object.entries(checks.sources))assert.equal(hash(p),h,'Source changed after checks');for(const[p,h]of Object.entries(checks.preserved))assert.equal(hash(p),h,'Historical file changed');
/* Strengthened no-growth and same-feature repair assertions: rerun both
 * precisions without rerunning an unchanged firmware/assumed-plant source. */
const env={...process.env,PATH:'D:/MinGW/mingw64/bin;'+process.env.PATH},additionalTests=[];
function call(exe,args){const r=spawnSync(exe,args,{env,encoding:'utf8',maxBuffer:30e6});assert.equal(r.status,0,r.stderr+'\n'+r.stdout);return r.stdout;}
for(const precision of ['float','double']) {
 const flags=precision==='double'?['-DE5_USE_DOUBLE']:[],exe=path.join(checksDir,'strengthened_'+precision+'.exe');
 call('D:/MinGW/mingw64/bin/gcc.exe',['-std=c99','-O2','-Wall','-Wextra','-Werror','-Wno-unused-function','-I',task,...flags,path.join(dir,'test_priority.c'),path.join(checksDir,'r8_'+precision+'.o'),'-lm','-o',exe]);
 additionalTests.push({precision,result:call(exe,[]).trim()});
}
const log=fs.readFileSync(path.join(md,'build_R9_final.log'),'utf8');assert(log.includes('0 Error(s), 0 Warning(s).'));assert(log.includes("Rebuild target '"+target+"'"));
const size=log.match(/Program Size: Code=(\d+) RO-data=(\d+) RW-data=(\d+) ZI-data=(\d+)/);assert(size);assert(+size[3]+ +size[4]<112*1024);
const hex=path.join(md,target,target+'.hex'),axf=path.join(md,target,target+'.axf');assert(fs.statSync(hex).size>0&&fs.statSync(axf).size>0);
const cfg=fs.readFileSync(path.join(task,'experiment5_formal_config.h'),'utf8'),trace=fs.readFileSync(path.join(task,'experiment5_event_trace.h'),'utf8');assert(cfg.includes('#define E5_SELECTED_BUILD 67112U')&&cfg.includes('#define E5_FORMAL_SCHEMA 4480U'));assert(trace.includes('#define E5_EVENT_MAGIC 4431U')&&trace.includes('#define E5_EVENT_TRIGGER_MS 8500U'));
let upper=0,eof=false,records=0;for(const line of fs.readFileSync(hex,'utf8').trim().split(/\r?\n/)) {assert(line.startsWith(':'));const b=Buffer.from(line.slice(1),'hex');assert.equal(b.length,b[0]+5);assert.equal([...b].reduce((s,v)=>(s+v)&255,0),0);const addr=b.readUInt16BE(1),type=b[3];assert(!eof);if(type===4)upper=b.readUInt16BE(4)*65536;if(type===0){assert(upper+addr>=0x08000000&&upper+addr+b[0]<=0x08100000);records++;}if(type===1)eof=true;}assert(eof&&records>0);
const callgraph=fs.readFileSync(path.join(md,target,target+'.htm'),'utf8'),stack=callgraph.match(/Maximum Stack Usage =\s*(\d+) bytes \+ Unknown/);assert(stack);
const result={build:67112,schema:4480,project:path.join(md,'eassy.uvprojx'),target,hex,hexSHA256:hash(hex),axfSHA256:hash(axf),hexChecksumsAndFlashRangePassed:true,errors:0,warnings:0,programBytes:{code:+size[1],ro:+size[2],rw:+size[3],zi:+size[4]},linkerKnownStackBytes:+stack[1],linkerStackHasUnknownComponents:true,stackCertificationClaimed:false,checkedSourceHashes:checks.sources,earlierFilesUnchanged:Object.keys(checks.preserved).length,hostChecksPassed:true,additionalTests,disabledExactlyR8:true,asymmetricExactlyR8:true,ordinaryComparatorUnchanged:true,assumedSummary:checks.summary,assumedPerformance:checks.performance,newAssumedFailures:checks.newFailures,onBoardTimingMeasured:false,automaticFlash:false,singleExploratoryMotionReleased:true,physicalEfficacyProven:false,superiorityClaimed:false,assumedModelIdentified:false};
fs.writeFileSync(path.join(dir,'build_manifest.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({build:result.build,hexSHA256:result.hexSHA256,errors:0,warnings:0,hostChecksPassed:true,hexChecksumsAndFlashRangePassed:true,newAssumedFailures:[],earlierFilesUnchanged:result.earlierFilesUnchanged,linkerKnownStackBytes:+stack[1],onBoardTimingMeasured:false},null,2));
