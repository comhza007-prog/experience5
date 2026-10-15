import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {decodeRows} from '../identification_q2_summary40s_round61_20261015/decode.mjs';
const dir=path.dirname(fileURLToPath(import.meta.url)),root=path.resolve(dir,'../..');
const prior=path.join(root,'06_仿真与复现/identification_q2_summary40s_round61_20261015');
const protocol=JSON.parse(fs.readFileSync(path.join(dir,'protocol.json'),'utf8'));
const preparation=JSON.parse(fs.readFileSync(path.join(dir,'preparation.json'),'utf8'));
const hash=b=>crypto.createHash('sha256').update(b).digest('hex'),sha=p=>hash(fs.readFileSync(p));
assert.equal(sha(path.join(dir,'protocol.json')),preparation.protocolSHA256);
assert.equal(sha(protocol.hex),preparation.hexSHA256);
const project=path.resolve(path.dirname(protocol.project),'..');
for(const [file,expected] of Object.entries(preparation.currentSourceHashes))assert.equal(sha(path.join(project,file)),expected);
for(const model of preparation.frozenModels)assert.equal(sha(model.path),model.SHA256);
const oldRaw=path.join(protocol.dataFolder,'E5ID_Q2S_BLNN_B68012_HW6_L1200_R1200_M0g_S2mm_run01.csv');
assert.equal(sha(oldRaw),protocol.oldQ2SHA256);
const source=path.join(protocol.dataFolder,protocol.filename),raw=fs.readFileSync(source),sourceSHA256=hash(raw);
const lines=raw.toString('utf8').trim().split(/\r?\n/);
assert.equal(lines.shift().replace(/^\uFEFF/,''),Array.from({length:107},(_,i)=>'I'+i).join(','));
const all=lines.map(l=>l.split(',').map(Number)),cuts=[];
for(let i=1;i<all.length;i++)if(all[i][0]<=all[i-1][0]||all[i][1]<=all[i-1][1])cuts.push(i);
assert.deepEqual(cuts,[1],'Unexpected session boundaries; no outcome-based session selection');
assert(all[0][2]===6&&all[0][63]===0&&all[0][87]===0&&all[1][2]===0&&all[1][63]===68012);
const rows=all.slice(1),decoded=decodeRows(rows);assert(decoded.qualified,JSON.stringify(decoded.reasons));
const m=rows.filter(v=>[2,3,4,5].includes(v[2])&&v[106]===1);
assert.equal(m.length,400);
const rms=f=>Math.sqrt(m.reduce((s,v)=>s+f(v)**2,0)/m.length);
const metrics={native40msSamples:m.length,trackingRMSE_mm:rms(v=>((v[5]+v[6])/2-v[3])*1000),syncRMS_mm:rms(v=>(v[5]-v[6])*1000),maxTracking_mm:Math.max(...m.map(v=>Math.abs(((v[5]+v[6])/2-v[3])*1000))),maxSync_mm:Math.max(...m.map(v=>Math.abs((v[5]-v[6])*1000)))};
const display=rows.filter(v=>v[0]>=40&&v[2]===6);
assert(display.every(v=>Math.abs(v[53]-metrics.trackingRMSE_mm)<=.00000051&&Math.abs(v[54]-metrics.syncRMS_mm)<=.00000051));
const done=rows.find(v=>v[88]===4444&&v[89]===4&&v[90]===0);
const audit={qualified:true,source,sourceSHA256,bytes:raw.length,totalRawRows:all.length,newSessionRows:rows.length,
 selectionRule:'Exclude exactly ONE pre-reset residual row solely from uptime/sequence reset and build/profile0; retain original raw. No outcome-based selection.',excludedPrefixRows:1,excludedRow:all[0],
 phaseCounts:Object.fromEntries([...new Set(rows.map(v=>v[2]))].map(p=>[p,rows.filter(v=>v[2]===p).length])),
 mechanicalCondition:'User-confirmed tightened, matching prior T1; oldQ2user-reported loose retained separately',metrics,
 displayAfter40MatchesWithinSixDecimalRounding:true,displayRows:display.length,exportComplete_s:done[0],completionTail_s:rows.at(-1)[0]-done[0],
 periodRange_us:[decoded.header.period_min_us,decoded.header.period_max_us],corePeak_us:Math.max(...rows.map(v=>v[42])),bodyPeak_us:Math.max(...rows.map(v=>v[60])),stackMinimum_bytes:Math.min(...rows.map(v=>v[58])),
 feedbackMaximumAge_ms:decoded.header.max_age_ms,fault:decoded.header.fault,qualityFlags:decoded.header.quality_flags,
 moving1msRows:decoded.fast.length,hold40stepRows:decoded.slow.length,activeCSVGaps:decoded.activeGaps,stoppedCSVGaps:decoded.stoppedGaps,CRC32:decoded.crc32,minimumChunkCopies:decoded.minimumCopies,
 originalHEXAndSevenSourceHashesUnchanged:true,frozenModelsUnchanged:true,oldRawHashUnchanged:true,
 qualifiedRecordingNotModelAdmission:true,noParameterRefitting:true,noNewPhysicalRunReleased:true,assistantHardwareAction:false};
decoded.source=source;decoded.sourceSHA256=sourceSHA256;decoded.capture_audit=audit;
const output=path.join(dir,`build68012_${sourceSHA256.slice(0,12)}_analysis.json`);
fs.writeFileSync(output,JSON.stringify(decoded,null,2)+'\n',{flag:'wx'});
const native=spawnSync(path.join(prior,'test_summary.exe'),['--replay'],{cwd:prior,encoding:'utf8',input:rows.map(v=>v.join(' ')).join('\n')+'\n',maxBuffer:1024*1024});
assert.equal(native.status,0,native.stdout+native.stderr);const c=JSON.parse(native.stdout);
assert(c.valid&&c.samples===400&&Math.abs(c.trackingRMSE_mm-metrics.trackingRMSE_mm)<5e-8&&Math.abs(c.syncRMS_mm-metrics.syncRMS_mm)<5e-8);
const py=spawnSync('C:/Users/ele/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe',['-X','utf8',path.join(prior,'check_capture.py'),source,output],{cwd:prior,encoding:'utf8',env:{...process.env,PYTHONUTF8:'1'}});
assert.equal(py.status,0,py.stdout+py.stderr);const independent=JSON.parse(py.stdout);
assert.equal(sha(source),sourceSHA256);
const verification={...audit,excludedRow:undefined,analysis:output,header:decoded.header,nativeCMetricReplay:c,independentPythonFullDecodeCRCAndMetrics:independent,rawUnchanged:true};
fs.writeFileSync(path.join(dir,`build68012_${sourceSHA256.slice(0,12)}_verification.json`),JSON.stringify(verification,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(verification,null,2));
