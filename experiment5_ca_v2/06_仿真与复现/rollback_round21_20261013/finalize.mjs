import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import crypto from 'node:crypto';import {fileURLToPath} from 'node:url';
const dir=path.dirname(fileURLToPath(import.meta.url)),root=path.resolve(dir,'../../..');
const project=path.join(root,'experiment5_ca_v2/05_实验代码/S3R8_恢复R2基线_20261013/eassy_E5R8_A_S3R8_HW6');
const target='exp5R8_A_S3R8_HW6_EVENT48',md=path.join(project,'MDK-ARM');
const hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const checks=JSON.parse(fs.readFileSync(path.join(dir,'checks01/verification.json'),'utf8'));assert(checks.allPassed&&checks.controlExactlyR2);
for(const[p,h]of Object.entries(checks.sources))assert.equal(hash(p),h,'Source changed after checks');
const log=fs.readFileSync(path.join(md,'build_R8_final.log'),'utf8');assert(log.includes('0 Error(s), 0 Warning(s).'));assert(log.includes("Rebuild target '"+target+"'"));
const size=log.match(/Program Size: Code=(\d+) RO-data=(\d+) RW-data=(\d+) ZI-data=(\d+)/);assert(size);assert(+size[3]+ +size[4]<112*1024);
const hex=path.join(md,target,target+'.hex'),axf=path.join(md,target,target+'.axf');assert(fs.statSync(hex).size>0&&fs.statSync(axf).size>0);
let upper=0,eof=false,records=0;
for(const line of fs.readFileSync(hex,'utf8').trim().split(/\r?\n/)) {
 assert(line.startsWith(':'));const b=Buffer.from(line.slice(1),'hex');assert.equal(b.length,b[0]+5);assert.equal([...b].reduce((s,v)=>(s+v)&255,0),0);
 const addr=b.readUInt16BE(1),type=b[3];assert(!eof);
 if(type===4)upper=b.readUInt16BE(4)*65536;
 if(type===0){assert(upper+addr>=0x08000000&&upper+addr+b[0]<=0x08100000);records++;}
 if(type===1)eof=true;
}assert(eof&&records>0);
const callgraph=fs.readFileSync(path.join(md,target,target+'.htm'),'utf8'),stack=callgraph.match(/Maximum Stack Usage =\s*(\d+) bytes \+ Unknown/);assert(stack);
const result={build:67012,schema:4479,project:path.join(md,'eassy.uvprojx'),target,hex,hexSHA256:hash(hex),axfSHA256:hash(axf),hexChecksumsAndFlashRangePassed:true,errors:0,warnings:0,programBytes:{code:+size[1],ro:+size[2],rw:+size[3],zi:+size[4]},linkerKnownStackBytes:+stack[1],linkerStackHasUnknownComponents:true,stackCertificationClaimed:false,checkedSourceHashes:checks.sources,earlierFilesUnchanged:checks.earlierFilesUnchanged,hostChecksPassed:true,controlExactlyR2:true,onBoardTimingMeasured:false,automaticFlash:false,physicalEfficacyProven:false,superiorityClaimed:false,assumedModelIdentified:false};
fs.writeFileSync(path.join(dir,'build_manifest.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({build:result.build,hexSHA256:result.hexSHA256,errors:0,warnings:0,hostChecksPassed:true,controlExactlyR2:true,hexChecksumsAndFlashRangePassed:true,onBoardTimingMeasured:false},null,2));
