import fs from 'node:fs';import crypto from 'node:crypto';import assert from 'node:assert/strict';
import path from 'node:path';import {fileURLToPath} from 'node:url';
const dir=path.dirname(fileURLToPath(import.meta.url));
const analysis=JSON.parse(fs.readFileSync(path.join(dir,'analysis.json'),'utf8'));
const inputs=JSON.parse(fs.readFileSync(path.join(dir,'quadratic_input_hypotheses.json'),'utf8'));
const sha=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
assert.equal(analysis.frozenParametersSHA256,'b0c586fc4e7f74c4a73b7140a372c4d60ee7a6940d9179a9a2cbd2a81a40d1a0');
assert.equal(sha(analysis.frozenParameters),analysis.frozenParametersSHA256);
const checks=[],sign=[1,-1];
for(const source of analysis.sourceHashes){
 assert.equal(sha(source.raw),source.rawSHA256);assert.equal(sha(source.decoded),source.decodedSHA256);
 const decoded=JSON.parse(fs.readFileSync(source.decoded,'utf8'));
 const all=fs.readFileSync(source.raw,'utf8').trim().split(/\r?\n/).slice(1).map(l=>l.split(',').map(Number));
 const rows=source.name==='T1'?all:all.slice(1);
 const anchors=new Map(rows.filter(r=>[1,2,3,4,5].includes(r[2])).map(r=>[Math.round(r[46])-1,r.slice(13,15).map((v,i)=>v*sign[i])]));
 const u=inputs.find(r=>r.record===source.name).inputs;assert.equal(u.length,20000);
 let maxIntegralError=0,anchorChecks=0,movingChecks=0,holdChecks=0;
 for(let n=0;n<decoded.fast.length;n++){
  const index=n<4000?4000+n:10000+n-4000;
  for(let ch=0;ch<2;ch++)assert.equal(u[index][ch],decoded.fast[n].command_counts[ch]*sign[ch]);
  movingChecks++;
 }
 for(let n=0;n<decoded.slow.length;n++){
  const start=n<100?n*40:n<150?8000+(n-100)*40:14000+(n-150)*40;
  const row=decoded.slow[n],h=row.dt_us/40,anchor=anchors.get(start);
  for(let ch=0;ch<2;ch++){
   const sum=u.slice(start,start+40).reduce((s,r)=>s+r[ch]*h,0),target=row.command_integral_counts_us[ch]*sign[ch];
   maxIntegralError=Math.max(maxIntegralError,Math.abs(sum-target));assert(Math.abs(sum-target)<1e-5);
   if(anchor)assert(Math.abs(u[start][ch]-anchor[ch])<1e-9);
   for(let k=start;k<start+40;k++)assert(Math.abs(u[k][ch])<=1200+1e-6);
  }
  if(anchor)anchorChecks++;
  holdChecks++;
 }
 for(const row of analysis.holdingInputAudits.filter(r=>r.record===source.name)){
  const anchor=anchors.get(row.start);assert.equal(!!anchor,row.anchorObserved);
  if(anchor)for(let ch=0;ch<2;ch++)assert(Math.abs(anchor[ch]-row.anchor_counts[ch])<1e-9);
 }
 checks.push({record:source.name,holdingBlocks:holdChecks,observedAnchors:anchorChecks,unchangedMovingRows:movingChecks,maximumIntegralError_count_us:maxIntegralError});
}
const result={passed:true,checkerSHA256:sha(fileURLToPath(import.meta.url)),analysisSHA256:sha(path.join(dir,'analysis.json')),
 checks,allRawAndFrozenParameterHashesUnchanged:true,constructedInputsVerifiedNotRecovered:true,
 noModelFit:true,noNewHardwareAction:true};
fs.writeFileSync(path.join(dir,'input_verification.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(result));
