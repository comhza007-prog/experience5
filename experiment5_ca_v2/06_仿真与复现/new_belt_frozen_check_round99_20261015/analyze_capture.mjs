import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {decodeRows} from '../identification_q2_summary40s_round61_20261015/decode.mjs';
const dir=path.dirname(fileURLToPath(import.meta.url)),prior=path.resolve(dir,'../motor_response_analysis_round93_20261015');
const sha=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const protocolFile=path.join(prior,'next_capture_protocol.json');
assert.equal(sha(protocolFile),'38cd6d2b0cf3d0d0e61c1cedd836a5826dd24b258d5714d43645f8ab65a65092');
const protocol=JSON.parse(fs.readFileSync(protocolFile,'utf8'));
assert.equal(sha(protocol.primaryCandidate),protocol.primaryCandidateSHA256);
for(const m of protocol.predeclaredComparators)assert.equal(sha(m.file),m.sha256);
assert.equal(sha(protocol.hex),protocol.hexSHA256);
for(const [name,hash] of Object.entries(protocol.codeHashes))assert.equal(sha(path.resolve(path.dirname(protocol.project),'..',name)),hash);
const source=protocol.newRawPath.replace('run08.csv','run011.csv'),raw=fs.readFileSync(source),sourceSHA256=sha(source);
const lines=raw.toString('utf8').trim().split(/\r?\n/);
assert.equal(lines.shift().replace(/^\uFEFF/,''),Array.from({length:107},(_,i)=>'I'+i).join(','));
const strings=lines.map(l=>l.split(',')),allRows=strings.map(a=>a.map(Number));
const cuts=[];for(let k=1;k<allRows.length;k++)if(allRows[k][0]<=allRows[k-1][0]||allRows[k][1]<=allRows[k-1][1])cuts.push(k);
assert.deepEqual(cuts,[]);
const rows=allRows;assert.equal(rows[0][2],0);
const gaps=[];for(let k=1;k<rows.length;k++)if(rows[k][1]-rows[k-1][1]!==1)gaps.push({before:rows[k-1][0],after:rows[k][0],missing:rows[k][1]-rows[k-1][1]-1,priorPhase:rows[k-1][2],nextPhase:rows[k][2]});
assert.deepEqual(gaps,[]);
const decoded=decodeRows(rows);
assert(decoded.transportValid&&decoded.qualified);assert.deepEqual(decoded.reasons,[]);
assert.equal(decoded.fast.length,8000);assert.equal(decoded.slow.length,300);assert.equal(decoded.minimumCopies,4);
assert.equal(decoded.header.fault,0);assert.equal(decoded.header.quality_flags,0);
// Shared frozen C trajectory; no reference fitted to this capture.
const q2root=path.resolve(path.dirname(protocol.project),'..');
const m1root=path.resolve(dir,'../../05_实验代码/模型闭环_电机响应M1_20261015/eassy_E5ID_MOTOR_BLNN_HW6');
assert.equal(sha(path.join(q2root,'Task/experiment5_motion.h')),sha(path.join(m1root,'Task/experiment5_motion.h')));
const referenceFile=path.join(prior,'reference.csv');
const reference=new Map(fs.readFileSync(referenceFile,'utf8').trim().split(/\r?\n/).slice(1).map(l=>{const [ms,phase,v]=l.split(',').map(Number);return [ms,v];}));
const lookup=new Map();let step=0;
for(const [mode,a,b] of [['slow',0,100],['fast',0,4000],['slow',100,150],['fast',4000,8000],['slow',150,300]])for(const r of decoded[mode].slice(a,b)){step+=mode==='slow'?40:1;lookup.set(step-1,r);}
assert.equal(step,20000);
const pitch=decoded.header.configured_meters_per_count,round6=x=>Math.round(x*1e6)/1e6;
const active=rows.filter(r=>r[106]===1&&r[2]>=2&&r[2]<=5);assert.equal(active.length,400);
const metric_samples=active.map(r=>{const k=r[46]-2,s=lookup.get(k);assert(s);const ms=Math.round(r[79]*1000),rv=reference.get(ms);assert.notEqual(rv,undefined);
  const p=s.encoder.map((e,ch)=>round6(Math.fround(Math.fround(e*pitch)*(ch?-1:1))));
  assert(p.every((v,ch)=>Math.abs(v-r[5+ch])<=5.00001e-6));assert(Math.abs(round6(rv)-r[3])<=5.00001e-6);
  return {step:k,elapsed_ms:ms,phase:r[2],reference_m:round6(rv),position_m:p};});
const rms=f=>Math.sqrt(metric_samples.reduce((sum,r)=>sum+f(r)**2,0)/400);
const metrics={native40msSamples:400,trackingRMSE_mm:rms(r=>(r.position_m.reduce((a,b)=>a+b)/2-r.reference_m)*1000),syncRMS_mm:rms(r=>(r.position_m[0]-r.position_m[1])*1000)};
const display=rows.filter(r=>r[0]>=40&&r[2]===6);assert(display.length&&display.every(r=>r[53]===display[0][53]&&r[54]===display[0][54]));
assert(Math.abs(metrics.trackingRMSE_mm-display[0][53])<=.0000051);assert(Math.abs(metrics.syncRMS_mm-display[0][54])<=.0000051);
const done=rows.find(r=>r[88]===4444&&r[89]===4&&r[90]===0),tail=rows.at(-1)[0]-done[0];assert(tail>=20&&rows.at(-1)[0]>=185);
const audit={source,sourceSHA256,bytes:raw.length,totalRawRows:allRows.length,currentSessionRows:rows.length,sessions:1,excludedResetPrefixRows:0,
  excludedPrefix:[],prefixExclusionReason:'None; single uninterrupted session.',
  fullRecordingProtocolQualified:true,qualificationScope:'Entire current capture',completeCRCVerifiedMotionSnapshotUsable:true,all400MetricSamplesUsable:true,
  reasons:decoded.reasons,missingCSVFrames:0,gaps,missingMotionCSVFrames:0,missingSamplesImputed:false,
  metricBasis:'CRC integer encoder snapshots and identical frozen production C trajectory, rounded6 decimal meters as firmware statistics; native CSV exported5 decimal positions.',
  metrics,firmware400PointMetrics:{trackingRMSE_mm:display[0][53],syncRMS_mm:display[0][54]},
  completionTail_s:tail,exportComplete_s:done[0],lastUptime_s:rows.at(-1)[0],referenceFileSHA256:sha(referenceFile),
  phaseCounts:Object.fromEntries([...new Set(rows.map(r=>r[2]))].map(p=>[p,rows.filter(r=>r[2]===p).length])),
  periodRange_us:[decoded.header.period_min_us,decoded.header.period_max_us],corePeak_us:Math.max(...rows.map(r=>r[42])),bodyPeak_us:Math.max(...rows.map(r=>r[60])),stackMinimum_bytes:Math.min(...rows.map(r=>r[58])),
  preCaptureProtocol:protocolFile,preCaptureProtocolSHA256:sha(protocolFile),noParameterFit:true,assistantHardwareAction:false};
decoded.source=source;decoded.sourceSHA256=sourceSHA256;decoded.capture_audit=audit;decoded.metric_samples=metric_samples;
const output=path.join(dir,'capture_analysis.json');fs.writeFileSync(output,JSON.stringify(decoded,null,2)+'\n',{flag:'wx'});
const py=spawnSync('C:/Users/ele/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe',['-X','utf8',path.join(dir,'check_capture.py'),source,output],{encoding:'utf8'});
assert.equal(py.status,0,py.stdout+py.stderr);const independent=JSON.parse(py.stdout);assert.equal(independent.crc32,decoded.crc32);
const verification={...audit,CRC32:decoded.crc32,minimumChunkCopies:decoded.minimumCopies,header:decoded.header,independentPythonFullDecodeCRCAndMetrics:independent};
fs.writeFileSync(path.join(dir,'capture_verification.json'),JSON.stringify(verification,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(verification,null,2));
