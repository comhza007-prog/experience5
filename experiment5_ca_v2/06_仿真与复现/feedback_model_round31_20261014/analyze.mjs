import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import crypto from 'node:crypto';import {fileURLToPath} from 'node:url';
const dir=path.dirname(fileURLToPath(import.meta.url)),root=path.resolve(dir,'../..'),method=process.argv[2]||'S3R2';assert(['S3R2','BLNN'].includes(method));
const build=method==='BLNN'?67511:67512,id=method==='BLNN'?11:12;
const file=path.join(root,'01_原始数据/自动监视_反馈辨识_20261014/E5MODEL_A_'+method+'_B'+build+'_HW6_MODEL10_L1200_R1200_M0g_S2mm_run01.csv');
const bytes=fs.readFileSync(file),lines=bytes.toString('utf8').trim().split(/\r?\n/);assert.equal(lines.shift(),Array.from({length:107},(_,i)=>'I'+i).join(','));
const a=lines.map(l=>l.split(',').map(Number));assert(a.every(r=>r.length===107&&r.every(Number.isFinite)));
assert(a.every(r=>r[63]===build&&r[21]===id&&r[87]===6&&r[22]===0));
assert.deepEqual([...new Set(a.map(r=>r[2]))],[0,1,2,3,4,5,6]);
let gaps=0;for(let i=1;i<a.length;i++){assert(a[i][1]>a[i-1][1]);gaps+=a[i][1]-a[i-1][1]-1;assert(a[i][0]>a[i-1][0]);}
assert(a.every(r=>r[45]===0&&r[57]===0&&r[28]===0&&r[59]===0));
assert(a.filter(r=>[0,6,9].includes(r[2])).every(r=>r[13]===0&&r[14]===0&&r[106]===0));
assert.equal(a.at(-1)[46],20000);
const rows=new Map();let copies=0,declared;
for(const r of a.filter(r=>r[2]===6&&r[88]===4435&&r[89]===3)) {
 assert(r[91]===0&&r[93]===10);const key=r[90],payload=r.slice(96,104);declared=r[92];copies++;
 if(rows.has(key))assert.deepEqual(rows.get(key),payload);else rows.set(key,payload);
}
assert.equal(rows.size,declared);assert(declared>=1990&&declared<=2001);
const raw=Array.from({length:declared},(_,i)=>rows.get(i));assert(raw.every(r=>r?.length===8));
const f32=Math.fround,metersPerCount=f32(f32(f32(2*f32(Math.PI))*f32(.03))/f32(19*8192)),metersPerSecondPerRPM=metersPerCount*8192/60;
const samples=raw.map(v=>{assert(v.every(x=>x===Math.trunc(x)));const packed=v[7],commands=[Math.floor(packed/2401)-1200,packed%2401-1200];assert(commands.every(c=>Math.abs(c)<=1200));return{ms:v[0],encoder:[v[1],v[2]],rpm:[v[3],v[4]],feedbackCurrentCounts:[v[5],v[6]],attemptedCommandCounts:commands,position_m:[v[1]*metersPerCount,-v[2]*metersPerCount]};});
assert.equal(samples[0].ms,0);assert.equal(samples.at(-1).ms,20000);
const rms=v=>Math.sqrt(v.reduce((s,x)=>s+x*x,0)/v.length),mean=v=>v.reduce((s,x)=>s+x,0)/v.length;
const intervals=samples.slice(1).map((r,i)=>r.ms-samples[i].ms);assert(Math.min(...intervals)>=10&&Math.max(...intervals)<=11);
const encoderRPMResidual=samples.slice(1).map((s,i)=>s.position_m.map((p,ch)=>1000*((p-samples[i].position_m[ch])-(ch?-1:1)*metersPerSecondPerRPM*(s.rpm[ch]+samples[i].rpm[ch])*.5*(s.ms-samples[i].ms)/1000)));
const correlation=(x,y)=>{const ax=mean(x),ay=mean(y),vx=x.map(v=>v-ax),vy=y.map(v=>v-ay);return vx.reduce((s,v,i)=>s+v*vy[i],0)/Math.sqrt(vx.reduce((s,v)=>s+v*v,0)*vy.reduce((s,v)=>s+v*v,0));};
const response=[0,1].map(ch=>Array.from({length:11},(_,lag)=>({lagSamples:lag,nominalLag_ms:10*lag,correlation:correlation(samples.slice(0,samples.length-lag||samples.length).map(r=>r.attemptedCommandCounts[ch]),samples.slice(lag).map(r=>r.feedbackCurrentCounts[ch]))})));
const active=a.filter(r=>r[106]===1),motion=active.filter(r=>r[2]>=2&&r[2]<=5),metrics=r=>({n:r.length,trackingRMSE_mm:rms(r.map(v=>1000*((v[5]+v[6])/2-v[3]))),syncRMS_mm:rms(r.map(v=>1000*(v[5]-v[6]))),maxSync_mm:Math.max(...r.map(v=>1000*Math.abs(v[5]-v[6])))});
const done=a.find(r=>r[2]===6&&r[88]===4435&&r[89]===4);assert(done&&a.at(-1)[0]-done[0]>=4.98);
const result={file,sha256:crypto.createHash('sha256').update(bytes).digest('hex'),method,build,schema:4484,rows:a.length,missingTelemetryFrames:gaps,fault:0,controllerSteps:20000,motion:metrics(motion),phases:[2,3,4,5].map(ph=>({phase:ph,...metrics(motion.filter(r=>r[2]===ph))})),modelRecords:samples.length,modelCopies:copies,modelInterval_ms:[Math.min(...intervals),Math.max(...intervals)],modelDuration_ms:20000,retainedAfterCompletion_s:a.at(-1)[0]-done[0],corePeak_us:a.at(-1)[42],bodyPeak_us:a.at(-1)[60],stackRemaining_bytes:a.at(-1)[58],late:0,overruns:0,voltageRange:[Math.min(...active.map(r=>r[27])),Math.max(...active.map(r=>r[27]))],encoderRPMIntegrationResidualRMS_mm:[0,1].map(ch=>rms(encoderRPMResidual.map(r=>r[ch]))),commandFeedbackCorrelation:response,configuredKinematics:{metersPerCount,metersPerSecondPerRPM},interpretation:'Diagnostic encoder/RPM/current consistency only. Positions are inferred from motor encoders using configured rigid-transmission kinematics, not independent linear-displacement measurements.10ms decimation does not recover every1ms controller state. Closed-loop identification and model adequacy still require independent prediction checks.',dataValid:true,formalEfficacyEvidence:false,modelIdentified:false};
fs.writeFileSync(path.join(dir,method+'_run01_samples.json'),JSON.stringify({source:file,sourceSHA256:result.sha256,configuredKinematics:result.configuredKinematics,samples},null,2));
fs.writeFileSync(path.join(dir,method+'_run01_analysis.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
