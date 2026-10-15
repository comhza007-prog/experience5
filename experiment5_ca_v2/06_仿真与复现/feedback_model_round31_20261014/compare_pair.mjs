import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
const dir=path.dirname(fileURLToPath(import.meta.url));
const methods=['BLNN','S3R2'];
const inputs=methods.map(m=>JSON.parse(fs.readFileSync(path.join(dir,m+'_run01_analysis.json'),'utf8')));
const rows=inputs.map(info=>{
  const bytes=fs.readFileSync(info.file);
  assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),info.sha256);
  const lines=bytes.toString('utf8').trim().split(/\r?\n/);
  assert.equal(lines.shift(),Array.from({length:107},(_,i)=>'I'+i).join(','));
  const selected=lines.map(l=>l.split(',').map(Number)).filter(r=>r[106]===1&&r[2]>=2&&r[2]<=5);
  const map=new Map(selected.map(r=>[Math.round(r[79]*1000),r]));
  assert.equal(map.size,selected.length); assert.equal(selected.length,400);
  return map;
});
const keys=rows.map(r=>[...r.keys()]);
const offsets=keys[0].map((k,i)=>k-keys[1][i]);
for(let i=0;i<400;i++){const [a,b]=rows.map((r,j)=>r.get(keys[j][i])); assert.equal(a[2],b[2]); assert(a[22]===0&&b[22]===0);}
assert.equal(new Set(offsets).size,1);
const rms=a=>Math.sqrt(a.reduce((s,v)=>s+v*v,0)/a.length);
const metrics=(map,ks)=>{
  const r=ks.map(k=>map.get(k));
  return {n:r.length,trackingRMSE_mm:rms(r.map(v=>1000*((v[5]+v[6])/2-v[3]))),syncRMS_mm:rms(r.map(v=>1000*(v[5]-v[6]))),maxSync_mm:Math.max(...r.map(v=>1000*Math.abs(v[5]-v[6])))};
};
const all=Object.fromEntries(methods.map((m,i)=>[m,metrics(rows[i],keys[i])]));
const difference=Object.fromEntries(['trackingRMSE_mm','syncRMS_mm','maxSync_mm'].map(k=>[k,{absolute:all.S3R2[k]-all.BLNN[k],percent:100*(all.S3R2[k]/all.BLNN[k]-1)}]));
const traces=methods.map(m=>JSON.parse(fs.readFileSync(path.join(dir,m+'_run01_samples.json'),'utf8')).samples.filter(r=>r.ms>=4000&&r.ms<20000));
assert.equal(traces[0].length,1600); assert.equal(traces[1].length,1600);
for(let i=0;i<1600;i++)assert.equal(traces[0][i].ms,traces[1][i].ms);
// Analytic double-precision version of the unchanged firmware quintic2mm reference.
// Primary40ms metrics above still use transmitted float32 references and positions.
const reference=ms=>{
  if(ms>=14000)return 0;
  if(ms>=8000&&ms<10000)return .002;
  const outward=ms<8000,u=(ms-(outward?4000:10000))/4000;
  const s=u*u*u*(10+u*(-15+6*u)); return .002*(outward?s:1-s);
};
const aligned=Object.fromEntries(methods.map((m,i)=>[m,{n:1600,
  trackingRMSE_mm:rms(traces[i].map(r=>1000*((r.position_m[0]+r.position_m[1])/2-reference(r.ms)))),
  syncRMS_mm:rms(traces[i].map(r=>1000*(r.position_m[0]-r.position_m[1])))}]));
const result={inputs:inputs.map(i=>({method:i.method,file:i.file,sha256:i.sha256})),
  samplesPerMethod:400,exactCommonTelemetryTimestamps:keys[0].filter(k=>rows[1].has(k)).length,
  telemetryElapsedOffset_BLNN_minus_S3R2_ms:offsets[0],phaseCountsEqual:true,referenceAndTimeExactlyEqual:false,interpolation:false,
  primaryWindow:'Drive permitted, phase2..5; same task window with different40ms sampling offsets. Unchanged from previous evaluations. These are whole-window scalar metrics, not pointwise paired errors.',
  metrics:all,S3R2_minus_BLNN:difference,
  secondaryAlignedEncoderReplay:{timeWindow_ms:[4000,20000],endExclusive:true,referencePrecision:'analytic double; primary40ms uses firmware floats',positionSource:'raw motor encoder counts and configured kinematics',metrics:aligned,primaryMetricReplaced:false},
  phases:[2,3,4,5].map(phase=>({phase,metrics:Object.fromEntries(methods.map((m,i)=>[m,metrics(rows[i],keys[i].filter(k=>rows[i].get(k)[2]===phase))]))})),
  replicatesPerMethod:1,formalRepeatedEvidence:false,
  conclusion:'Both diagnostic records complete and fault-free. This pair does not show an overall S3R2 synchronization benefit; tracking is worse. Hold-phase gains are descriptive only and do not replace the predefined full-motion primary window. No new mechanism was tested.'};
fs.writeFileSync(path.join(dir,'paired_comparison.json'),JSON.stringify(result,null,2));
console.log(JSON.stringify({samplesPerMethod:400,exactCommonTelemetryTimestamps:result.exactCommonTelemetryTimestamps,elapsedOffset_ms:offsets[0],metrics:all,difference,alignedEncoderReplay:aligned,conclusion:result.conclusion},null,2));
