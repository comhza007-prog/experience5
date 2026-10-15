import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
const dir=path.dirname(fileURLToPath(import.meta.url)),root=path.resolve(dir,'../../..');
const project=path.join(root,'experiment5_ca_v2/05_实验代码/S3R6_R2定向修复_20261013/eassy_E5R6_A_S3R6_HW6');
const target='exp5R6_A_S3R6_HW6_EVENT48',md=path.join(project,'MDK-ARM');
const hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const checks=JSON.parse(fs.readFileSync(path.join(dir,'checks01/verification.json'),'utf8'));assert(checks.allPassed&&checks.newFailures.length===0&&checks.asymmetricExactlyR2);
for(const[p,h]of Object.entries(checks.sources))assert.equal(hash(p),h,'Source changed after checks');
for(const[p,h]of Object.entries(checks.preserved))assert.equal(hash(p),h,'Prior code/raw changed');
const log=fs.readFileSync(path.join(md,'build_R6_final.log'),'utf8');assert(log.includes('0 Error(s), 0 Warning(s).'));assert(log.includes("Rebuild target '"+target+"'"));
const size=log.match(/Program Size: Code=(\d+) RO-data=(\d+) RW-data=(\d+) ZI-data=(\d+)/);assert(size);assert(+size[3]+ +size[4]<112*1024);
const hex=path.join(md,target,target+'.hex'),axf=path.join(md,target,target+'.axf');assert(fs.statSync(hex).size>0&&fs.statSync(axf).size>0);
const cfg=fs.readFileSync(path.join(project,'Task/experiment5_formal_config.h'),'utf8'),trace=fs.readFileSync(path.join(project,'Task/experiment5_event_trace.h'),'utf8');
assert(cfg.includes('#define E5_SELECTED_BUILD 66712U'));assert(cfg.includes('#define E5_FORMAL_SCHEMA 4476U'));assert(cfg.includes('#define E5_SELECTED_DIRECTIONAL_REPAIR 1U'));assert(trace.includes('#define E5_EVENT_MAGIC 4428U'));assert(trace.includes('#define E5_EVENT_TRIGGER_MS 10050U'));
let upper=0,eof=false,records=0;
for(const line of fs.readFileSync(hex,'utf8').trim().split(/\r?\n/)) {
 assert(line.startsWith(':'));const b=Buffer.from(line.slice(1),'hex');assert.equal(b.length,b[0]+5);assert.equal([...b].reduce((s,v)=>(s+v)&255,0),0);
 const addr=b.readUInt16BE(1),type=b[3];assert(!eof);
 if(type===4)upper=b.readUInt16BE(4)*65536;
 if(type===0){assert(upper+addr>=0x08000000&&upper+addr+b[0]<=0x08100000);records++;}
 if(type===1)eof=true;
}assert(eof&&records>0);
const callgraph=fs.readFileSync(path.join(md,target,target+'.htm'),'utf8');const stack=callgraph.match(/Maximum Stack Usage =\s*(\d+) bytes \+ Unknown/);assert(stack);
const result={date:'2026-10-13',build:66712,project:path.join(md,'eassy.uvprojx'),target,hex,hexSHA256:hash(hex),axfSHA256:hash(axf),hexChecksumsAndFlashRangePassed:true,errors:0,warnings:0,programBytes:{code:+size[1],ro:+size[2],rw:+size[3],zi:+size[4]},linkerKnownStackBytes:+stack[1],linkerStackHasUnknownComponents:true,stackCertificationClaimed:false,checkedSourceHashes:checks.sources,earlierFilesUnchanged:Object.keys(checks.preserved).length,hostChecksPassed:true,disabledExactlyR2:true,asymmetricExactlyR2:true,onBoardTimingMeasured:false,singleExploratoryMotionReleased:true,physicalEfficacyProven:false,assumedModelIdentified:false,assumedComplete:checks.summary,assumedPerformance:checks.performance};
fs.writeFileSync(path.join(dir,'build_manifest.json'),JSON.stringify(result,null,2));
console.log(JSON.stringify({build:result.build,hexSHA256:result.hexSHA256,errors:0,warnings:0,hostChecksPassed:true,hexChecksumsAndFlashRangePassed:true,earlierFilesUnchanged:result.earlierFilesUnchanged,linkerKnownStackBytes:+stack[1],onBoardTimingMeasured:false},null,2));
