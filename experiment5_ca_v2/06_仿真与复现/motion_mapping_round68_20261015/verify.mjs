import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import crypto from 'node:crypto';import {fileURLToPath} from 'node:url';
const dir=path.dirname(fileURLToPath(import.meta.url));const root=path.resolve(dir,'../..');
const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));const sha=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const a=read(path.join(dir,'audit_results.json'));assert.equal(sha(a.source),a.sourceSHA256);
assert.equal(sha(path.join(root,'06_仿真与复现/inertia_coupling_round66_20261015/fit_results.json')),a.frozenFitSHA256);
for(const p of a.controllerSourceHashes)assert.equal(sha(p.path),p.SHA256);
const rms=x=>Math.sqrt(x.reduce((s,v)=>s+v*v,0)/x.length);const close=(x,y)=>assert(Math.abs(x-y)<1e-12,`${x} vs ${y}`);
for(const c of a.fixedCouplingKnockouts){
 if(!c.completed)continue;assert.equal(c.nativeModeledPositions_m.length,400);
 const pm=[],ps=[],em=[],es=[];
 c.nativeModeledPositions_m.forEach((p,i)=>{const o=a.nativeObservedPositions_m[i];pm.push(1000*((p[0]+p[1])/2-a.nativeReference_m[i]));ps.push(1000*(p[0]-p[1]));em.push(1000*((p[0]+p[1]-o[0]-o[1])/2));es.push(1000*(p[0]-p[1]-o[0]+o[1]));});
 close(rms(pm),c.predictedTrackingRMSE_mm);close(rms(ps),c.predictedSyncRMS_mm);
 close(rms(em),c.native40msPredictionErrors.meanPositionPredictionRMSE_mm);close(rms(es),c.native40msPredictionErrors.syncPredictionRMSE_mm);
}
const record=read(path.join(root,'06_仿真与复现/identification_q2_summary40s_round61_20261015/build68012_0b743a60e6ed_analysis.json'));
const pitch=record.header.configured_meters_per_count,factor=pitch*8192/60;
for(const [j,start,anchor] of [[0,0,99],[1,4000,149]]){
 const rows=record.fast.slice(start,start+4000),duration=rows.reduce((s,r)=>s+r.dt_us*1e-6,0),disp=[0,0];
 for(const r of rows)for(let ch=0;ch<2;ch++)disp[ch]+=r.dt_us*1e-6*r.rpm[ch]*factor;
 const s=a.sensorConditionalChecks[j];close(duration,s.duration_s);
 for(let ch=0;ch<2;ch++){
  close(disp[ch]*1000,s.rawRPMSumDisplacement_mm[ch]);const observed=(rows.at(-1).encoder[ch]-record.slow[anchor].encoder[ch])*pitch;
  for(const [h,lo,hi] of [[s.hypotheses[0],-.5,.5],[s.hypotheses[1],0,1]]){
   const lower=disp[ch]+lo*duration*factor,upper=disp[ch]+hi*duration*factor;
   close(lower*1000,h.displacementInterval_raw_mm[ch][0]);close(upper*1000,h.displacementInterval_raw_mm[ch][1]);
   const gap=Math.max(lower-observed-2*pitch,0)+Math.max(observed-2*pitch-upper,0);close(gap*1000,h.outsideIntervalGap_mm[ch]);
  }
 }
}
const result={passed:true,independentJSCaseMetricPoints:1600,fixedCases:a.fixedCouplingKnockouts.map(({nativeModeledPositions_m,...c})=>c),
 RPMOnlyChangeCannotFixForcedPositionReplay:a.RPMDependencyProbe.RPMOnlyChangeCannotFixThisForcedPositionReplay,
 nearestIntervalMeanConditionalChecks:[false,false,false,false],floorIntervalMeanCompatibilityNotHardwareProof:true,
 rawAndControllerHashesUnchanged:true,modelsFitted:0,S3R2DataRead:false,physicalCaptureReleased:false,modelClosureComplete:false};
fs.writeFileSync(path.join(dir,'verification.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({passed:true,metricChecks:1600,modelsFitted:0,physicalCaptureReleased:false}));
