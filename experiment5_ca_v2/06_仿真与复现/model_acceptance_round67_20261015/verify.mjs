import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';
import crypto from 'node:crypto';import {fileURLToPath} from 'node:url';
const dir=path.dirname(fileURLToPath(import.meta.url));const root=path.resolve(dir,'../..');
const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));const sha=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const a=read(path.join(dir,'audit_results.json'));assert.equal(sha(a.source),a.sourceSHA256);
assert.equal(sha(path.join(root,'06_仿真与复现/inertia_coupling_round66_20261015/fit_results.json')),a.frozenFitSHA256);
assert.equal(sha(path.join(dir,'protocol.json')),a.protocolSHA256);
const rows=fs.readFileSync(a.source,'utf8').replace(/^\uFEFF/,'').trim().split(/\r?\n/);assert.equal(rows.shift(),Array.from({length:107},(_,i)=>'I'+i).join(','));
const all=rows.map(x=>x.split(',').map(Number));assert.equal(all.length,4526);assert(all[1][0]<all[0][0]);
const active=all.slice(1).filter(r=>r[106]===1&&r[2]>=2&&r[2]<=5);assert.equal(active.length,400);
const rms=x=>Math.sqrt(x.reduce((s,v)=>s+v*v,0)/x.length);const close=(x,y)=>assert(Math.abs(x-y)<1e-12,`${x} versus ${y}`);
const track=[],sync=[],pm=[],ps=[],em=[],es=[];
for(let i=0;i<400;i++){
 const r=active[i],t=a.nativeComparisonTrace[i];assert.equal(t.coreStep,r[46]);assert.equal(t.phase,r[2]);assert.deepEqual(t.observed_m,r.slice(5,7));close(t.reference_m,r[3]);
 track.push(1000*((r[5]+r[6])/2-r[3]));sync.push(1000*(r[5]-r[6]));
 pm.push(1000*((t.modeled_m[0]+t.modeled_m[1])/2-r[3]));ps.push(1000*(t.modeled_m[0]-t.modeled_m[1]));
 em.push(pm[i]-track[i]);es.push(ps[i]-sync[i]);
}
for(const [i,actual,modeled] of [[0,rms(track),rms(pm)],[1,rms(sync),rms(ps)]]){
 close(actual,a.taskMetrics[i].actual);close(modeled,a.taskMetrics[i].modeled);
 close(modeled-actual,a.taskMetrics[i].signedDifference);
}
close(rms(em),a.nativePredictionResidual.meanSyncPredictionRMSE_mm[0]);close(rms(es),a.nativePredictionResidual.meanSyncPredictionRMSE_mm[1]);
assert(Math.abs(rms(pm)-rms(track))<=rms(em)+1e-12);assert(Math.abs(rms(ps)-rms(sync))<=rms(es)+1e-12);
for(const phase of a.phaseResiduals){
 const ids=active.map((r,i)=>r[2]===phase.phase?i:-1).filter(i=>i>=0);assert.equal(ids.length,phase.nativePoints);
 const m=ids.map(i=>em[i]),s=ids.map(i=>es[i]);close(rms(m),phase.meanSyncPredictionRMSE_mm[0]);close(rms(s),phase.meanSyncPredictionRMSE_mm[1]);
}
const acceptance=read(path.join(dir,'acceptance_design.json'));assert(Object.values(acceptance.pendingNumericalInputs).every(v=>v===null));
assert.equal(a.modelsRefitted,0);assert.equal(a.S3R2DataRead,false);assert.equal(a.physicalRunReleased,false);
const moving=a.phaseResiduals.filter(p=>p.phase===2||p.phase===4).map(p=>p.meanSyncTotalSSEContribution_percent).reduce((s,v)=>s.map((x,i)=>x+v[i]),[0,0]);
const out={passed:true,independentJSNative40msChecks:400,originalRawAndFrozenFitHashesUnchanged:true,
 movingMeanSyncPredictionSSEContribution_percent:moving,taskMetrics:a.taskMetrics,
 taskThresholdsRemainUnsetNotBackSolved:true,parameterRefits:0,S3R2DataRead:false,physicalRunReleased:false,
 policy:'Pointwise equality not required. Acceptable discrepancy must be tied to a predefined claim. Current sync magnitude is underpredicted; paired difference validity remains untested.',
 modelClosureComplete:false};
fs.writeFileSync(path.join(dir,'verification.json'),JSON.stringify(out,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(out,null,2));
