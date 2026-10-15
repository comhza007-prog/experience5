import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
const dir=path.dirname(fileURLToPath(import.meta.url)),root=path.resolve(dir,'../..');
const protocol=JSON.parse(fs.readFileSync(path.join(dir,'protocol.json'),'utf8'));
const sha=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const specs=[
 ['R33_S3R2','自动监视_故障保留回放_20261014/E5REPLAY2_A_S3R2_B67712_HW6_STATE360_L1200_R1200_M0g_S2mm_run01.csv',67712,12,'cfcb63b82bd8a04d4d7d573b249514a62980690c5ae444eca783dbc475423f18'],
 ['R31_S3R2','自动监视_反馈辨识_20261014/E5MODEL_A_S3R2_B67512_HW6_MODEL10_L1200_R1200_M0g_S2mm_run01.csv',67512,12,'2804eb9c2a605a03fa73f5bf46c2d8c30d973af97a90bf8c565031cd905e87ec'],
 ['R31_BLNN','自动监视_反馈辨识_20261014/E5MODEL_A_BLNN_B67511_HW6_MODEL10_L1200_R1200_M0g_S2mm_run01.csv',67511,11,'7c7e29db5ec9e1e8d57c99c550bc3dfd7d4831ec570c0163ee04f71b209adb9c'],
 ['R29_S3R2','自动监视_受控S3R2_20261013/E5SUP_A_S3R2_B67412_HW6_EVENT48_L1200_R1200_M0g_S2mm_run01.csv',67412,12,'469932327edd21ea7443c20516d5ca94bf7859b687d6c2142ad4b7a131958dd6']
];
const mean=a=>a.reduce((s,v)=>s+v,0)/a.length;
const quantile=(a,p)=>{const s=[...a].sort((x,y)=>x-y),i=(s.length-1)*p,j=Math.floor(i);return s[j]+(s[Math.min(j+1,s.length-1)]-s[j])*(i-j);};
const frac=(a,fn)=>100*a.filter(fn).length/a.length;
const exposure=(s,indices,limits)=>({limits,samples:s.length,axisExceed_pct:[0,1].map(ch=>frac(s,r=>Math.abs(r[indices[ch]])>limits[ch])),anyExceed_pct:frac(s,r=>indices.some((i,ch)=>Math.abs(r[i])>limits[ch])),closedLoopCounterfactual:false});
const sources=specs.map(([id,rel,build,method,hash])=>{
 const file=path.join(root,'01_原始数据',rel);assert.equal(sha(file),hash);
 const lines=fs.readFileSync(file,'utf8').trim().split(/\r?\n/);assert.equal(lines.shift(),Array.from({length:107},(_,i)=>'I'+i).join(','));
 const data=lines.map(l=>{const v=l.split(',');assert.equal(v.length,107);assert(v.every(x=>x.trim()!==''));const r=v.map(Number);assert(r.every(Number.isFinite));return r;});
 assert(data.every(r=>r[63]===build&&r[21]===method&&r[87]===6&&r[22]===0));assert.deepEqual([...new Set(data.map(r=>r[2]))],[0,1,2,3,4,5,6]);
 let gaps=0;for(let i=1;i<data.length;i++){assert(data[i][1]>data[i-1][1]);assert(data[i][0]>data[i-1][0]);gaps+=data[i][1]-data[i-1][1]-1;}
 const final=data.at(-1);assert.equal(final[46],20000);const rows=data.filter(r=>r[2]>=2&&r[2]<=5&&r[106]===1);assert.equal(rows.length,400);
 const result={id,file,sha256:hash,build,method,rows:data.length,gaps,motionRows:rows.length,
  limits:[...new Set(rows.map(r=>r[19]))][0]===1200&&rows.every(r=>r[20]===1200)?[1200,1200]:null,
  sampledCommands:[0,1].map(ch=>({peakAbs:Math.max(...rows.map(r=>Math.abs(r[13+ch]))),p95Abs:quantile(rows.map(r=>Math.abs(r[13+ch])),.95)})),
  full1msNearHardEdgeCounts:final.slice(61,63),nearEdgeCounterScope:'Entire20s active control; NOT all clipping interventions',
  sampledSpeedIntervention_pct:frac(rows,r=>r[86]!==0),
  sampledCA:method===12?{maskBits_pct:[1,2,4,8,16,32].map(b=>({bit:b,pct:frac(rows,r=>(r[68]&b)!==0)})),reasonBits_pct:[1,2,4].map(b=>({bit:b,pct:frac(rows,r=>(r[88]&b)!==0)})),nominalVsActualLearningDistinct:true}:null,
  hypotheticalExposure:protocol.predefinedConditions.map(c=>({id:c.id,...exposure(rows,[13,14],c.limits)})),
  batteryRange: [Math.min(...rows.map(r=>r[27])),Math.max(...rows.map(r=>r[27]))],
  notFormalRepeatedComparison:true};assert(result.limits);return result;
});
const dense=['S3R2','BLNN'].map(method=>{
 const model=JSON.parse(fs.readFileSync(path.join(root,'06_仿真与复现/feedback_model_round31_20261014',method+'_run01_samples.json'),'utf8'));
 assert.equal(sha(model.source),model.sourceSHA256);assert.equal(model.samples.length,2001);
 assert(model.samples.every((r,i)=>r.ms===i*10&&r.attemptedCommandCounts.every(v=>Number.isInteger(v)&&Math.abs(v)<=1200)));
 const s=model.samples.filter(r=>r.ms>=4000&&r.ms<20000).map(r=>r.attemptedCommandCounts);assert.equal(s.length,1600);
 return {method,source:model.source,sha256:model.sourceSHA256,samples:s.length,interval_ms:10,sampledPeaksLowerBounds:[0,1].map(ch=>Math.max(...s.map(r=>Math.abs(r[ch])))),hypotheticalExposure:protocol.predefinedConditions.map(c=>({id:c.id,...exposure(s,[0,1],c.limits)})),notFull1msPeaks:true};
});
const output={protocolSHA256:sha(path.join(dir,'protocol.json')),sources,dense,interpretation:'Only observed attempted-command exposure and sampled constraint diagnostics. No lower-limit closed-loop claim. No current-to-amp calibration. Do not select condition by candidate errors.',hardwareReleased:false};
fs.writeFileSync(path.join(dir,process.argv[2]||'recorded_exposure_audit.json'),JSON.stringify(output,null,2),{flag:'wx'});
console.log(JSON.stringify({sources:sources.map(s=>({id:s.id,commands:s.sampledCommands,nearEdges:s.full1msNearHardEdgeCounts,speedPct:s.sampledSpeedIntervention_pct,CA:s.sampledCA})),dense},null,2));
