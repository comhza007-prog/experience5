import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {decodeRows} from './decode.mjs';
const dir=path.dirname(fileURLToPath(import.meta.url)),root=path.resolve(dir,'../..');
const sha=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const frozen=path.join(root,'06_仿真与复现/measurement_target_calibration_round79_20261015/model_parameters.json');
const frozenHash='2ec09510d85313fa468343837b398add271e7ffe12a06c9c8088e2f79ee8299b';
assert.equal(sha(frozen),frozenHash,'Model parameter file changed after pre-capture freeze');
const source=path.join(root,'01_原始数据/模型闭环_Q2_误差汇总40s_20261015/E5ID_Q2S_BLNN_B68012_HW6_L1200_R1200_M0g_S2mm_run03.csv');
const raw=fs.readFileSync(source),sourceSHA256=sha(source);
const lines=raw.toString('utf8').trim().split(/\r?\n/);
assert.equal(lines.shift().replace(/^\uFEFF/,''),Array.from({length:107},(_,i)=>'I'+i).join(','));
const all=lines.map(l=>l.split(',').map(Number)),cuts=[];
for(let k=1;k<all.length;k++)if(all[k][0]<=all[k-1][0]||all[k][1]<=all[k-1][1])cuts.push(k);
assert.deepEqual(cuts,[1]);
assert(all[0][2]===6&&all[0][87]===0&&all[1][2]===0&&all[1][63]===68012&&all[1][87]===6);
const rows=all.slice(1),decoded=decodeRows(rows);
assert.deepEqual(decoded.reasons.sort(),['Active CSV gaps','Completion tail shorter than 10 seconds'].sort());
assert(decoded.transportValid&&decoded.header.fault===0&&decoded.header.quality_flags===0);
assert.equal(decoded.fast.length,8000);assert.equal(decoded.slow.length,300);assert.equal(decoded.minimumCopies,4);
const active=rows.filter(r=>r[106]===1&&r[2]>=2&&r[2]<=5);
assert.equal(active.length,399);
const rms=f=>Math.sqrt(active.reduce((s,r)=>s+f(r)**2,0)/active.length);
const metrics={native40msSamples:399,trackingRMSE_mm:rms(r=>((r[5]+r[6])/2-r[3])*1000),syncRMS_mm:rms(r=>(r[5]-r[6])*1000)};
const done=rows.find(r=>r[88]===4444&&r[89]===4&&r[90]===0),tail=rows.at(-1)[0]-done[0];
const display=rows.filter(r=>r[0]>=40&&r[2]===6);
assert(display.length&&display.every(r=>r[53]===display[0][53]&&r[54]===display[0][54]));
const audit={source,sourceSHA256,bytes:raw.length,totalRawRows:all.length,currentSessionRows:rows.length,
  excludedResetPrefixRows:1,excludedPrefixReason:'One prior-session row identified by uptime/sequence reset and profile0; raw retained, not selected by outcome',
  fullRecordingProtocolQualified:false,completeCRCVerifiedMotionSnapshotUsable:true,
  reasons:decoded.reasons,missingCSVFrames:decoded.activeGaps,missingSamplesImputed:false,
  metrics,firmware400PointMetrics:{trackingRMSE_mm:display[0][53],syncRMS_mm:display[0][54]},
  completionTail_s:tail,exportComplete_s:done[0],phaseCounts:Object.fromEntries([...new Set(rows.map(r=>r[2]))].map(p=>[p,rows.filter(r=>r[2]===p).length])),
  periodRange_us:[decoded.header.period_min_us,decoded.header.period_max_us],corePeak_us:Math.max(...rows.map(r=>r[42])),bodyPeak_us:Math.max(...rows.map(r=>r[60])),stackMinimum_bytes:Math.min(...rows.map(r=>r[58])),
  frozenModel:frozen,frozenModelSHA256:frozenHash,noParameterFit:true,assistantHardwareAction:false};
decoded.source=source;decoded.sourceSHA256=sourceSHA256;decoded.capture_audit=audit;
const output=path.join(dir,'capture_analysis.json');
fs.writeFileSync(output,JSON.stringify(decoded,null,2)+'\n',{flag:'wx'});
const py=spawnSync('C:/Users/ele/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe',['-X','utf8',path.join(dir,'check_capture.py'),source,output],{encoding:'utf8',env:{...process.env,PYTHONUTF8:'1'}});
assert.equal(py.status,0,py.stdout+py.stderr);
const independent=JSON.parse(py.stdout);
assert.equal(independent.crc32,decoded.crc32);
assert.equal(sha(source),sourceSHA256);assert.equal(sha(frozen),frozenHash);
const verification={...audit,CRC32:decoded.crc32,minimumChunkCopies:decoded.minimumCopies,header:decoded.header,independentPythonFullDecodeCRCAndMetrics:independent};
fs.writeFileSync(path.join(dir,'capture_verification.json'),JSON.stringify(verification,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(verification,null,2));
