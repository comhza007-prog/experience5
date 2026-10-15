import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import assert from 'node:assert/strict';import {spawnSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
const dir=path.dirname(fileURLToPath(import.meta.url)),root=path.resolve(dir,'../..');
const file=path.join(root,'01_原始数据/自动监视_受控S3R2_20261013/E5SUP_A_S3R2_B67412_HW6_EVENT48_L1200_R1200_M0g_S2mm_run01.csv');
const bytes=fs.readFileSync(file),lines=bytes.toString('utf8').trim().split(/\r?\n/);assert.equal(lines.shift(),Array.from({length:107},(_,i)=>'I'+i).join(','));
const a=lines.map(l=>l.split(',').map(Number));assert(a.every(r=>r.length===107&&r.every(Number.isFinite)));
assert(a.every(r=>r[63]===67412&&r[21]===12&&r[87]===6&&r[22]===0));
assert.deepEqual([...new Set(a.map(r=>r[2]))],[0,1,2,3,4,5,6]);
for(let i=1;i<a.length;i++){assert.equal(a[i][1]-a[i-1][1],1);assert(a[i][0]>a[i-1][0]);}
assert(a.every(r=>r[45]===0&&r[57]===0&&r[28]===0&&r[59]===0));
assert(a.filter(r=>[0,6,9].includes(r[2])).every(r=>r[13]===0&&r[14]===0&&r[106]===0));
const idle=a.filter(r=>r[2]===0);assert(idle.every(r=>r[98]===1&&r[99]===1&&r[35]===4&&r[36]===4&&r[46]===0));
assert.equal(a.at(-1)[46],20000);
const chunks=new Map();let transmissions=0;
for(const r of a.filter(r=>r[2]===6&&r[88]===4434&&r[89]===3)) {
 const key=r[90]+':'+r[91],payload=r.slice(96,104);assert(r[90]>=0&&r[90]<128&&r[91]>=0&&r[91]<6);transmissions++;
 if(chunks.has(key))assert.deepEqual(chunks.get(key),payload);else chunks.set(key,payload);
}
assert.equal(chunks.size,768);
const events=Array.from({length:128},(_,i)=>Array.from({length:6},(_,j)=>chunks.get(i+':'+j)).flat());
const done=a.find(r=>r[2]===6&&r[88]===4434&&r[89]===4);assert(done&&a.at(-1)[0]-done[0]>=4.99);
const env={...process.env,PATH:'D:/MinGW/mingw64/bin;'+process.env.PATH},exe=path.join(dir,'event_check_float.exe');
const task=path.join(root,'05_实验代码/自动监视_受控S3R2_20261013/eassy_E5SUP_A_S3R2_HW6/Task');
let r=spawnSync('D:/MinGW/mingw64/bin/gcc.exe',['-std=c99','-O2','-Wall','-Wextra','-Werror','-Wno-unused-function','-I',task,path.join(root,'06_仿真与复现/frozen_chain_round26_20261013/check_event.c'),'-lm','-o',exe],{env,encoding:'utf8'});assert.equal(r.status,0,r.stderr);
const input=events.map(v=>[v[12],v[13],v[10],v[11],v[44],v[45],v[25],v[26],v[24],v[2],v[3],v[20],v[21]].join(' ')).join('\n')+'\n';
r=spawnSync(exe,[],{env,encoding:'utf8',input});assert.equal(r.status,0,r.stderr);
const computed=r.stdout.trim().split(/\r?\n/).map(l=>l.split(' ').map(Number));assert.equal(computed.length,128);
const mismatches=events.flatMap((v,i)=>{const c=computed[i];return c[0]!==v[18]||c[1]!==v[19]||c[2]!==v[22]||c[3]!==v[32]?[{ms:v[0],observed:[v[18],v[19],v[22],v[32]],calculated:c.slice(0,4)}]:[];});
const rms=x=>Math.sqrt(x.reduce((s,v)=>s+v*v,0)/x.length);
const metrics=rows=>({n:rows.length,trackingRMSE_mm:rms(rows.map(v=>1000*((v[5]+v[6])/2-v[3]))),syncRMS_mm:rms(rows.map(v=>1000*(v[5]-v[6]))),maxSync_mm:Math.max(...rows.map(v=>1000*Math.abs(v[5]-v[6])))});
const motion=a.filter(v=>v[2]>=2&&v[2]<=5&&v[106]===1),active=a.filter(v=>v[106]===1),end=motion.at(-1);
const result={file,sha256:crypto.createHash('sha256').update(bytes).digest('hex'),rows:a.length,build:67412,schema:4483,phaseChain:[0,1,2,3,4,5,6],fault:0,missingTelemetryFrames:0,controllerSteps:20000,motion:metrics(motion),phases:[2,3,4,5].map(ph=>({phase:ph,...metrics(motion.filter(r=>r[2]===ph))})),terminal_mm:[1000*end[5],1000*end[6]],voltageRange:[Math.min(...active.map(v=>v[27])),Math.max(...active.map(v=>v[27]))],corePeak_us:a.at(-1)[42],bodyPeak_us:a.at(-1)[60],stackRemaining_bytes:a.at(-1)[58],late:0,overruns:0,UARTerrors:0,event:{records:128,uniqueChunks:chunks.size,transmissions,first_ms:events[0][0],last_ms:events.at(-1)[0],fixedTrigger_ms:5360,retainedAfterCompletion_s:a.at(-1)[0]-done[0],allocatorExactMatches:128-mismatches.length,mismatches},fieldObservation:'User reported basically smooth completion, no significant abnormality',supervisedCaptureQualified:true,watchdogPhysicalDisconnectTested:false,scope:'Single software-supervision qualification only. Not a frozen formal comparison or proof of improved CA performance.',originalDataReadOnly:true};
fs.writeFileSync(path.join(dir,'run01_analysis.json'),JSON.stringify(result,null,2));
console.log(JSON.stringify(result,null,2));
