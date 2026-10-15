import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {decodeRows} from '../identification_q2_summary40s_round61_20261015/decode.mjs';
const dir=path.dirname(fileURLToPath(import.meta.url));
const sha=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const protocol=JSON.parse(fs.readFileSync(path.join(dir,'protocol.json'),'utf8'));
assert.equal(sha(path.join(dir,'protocol.json')),'b4f1af259f3d5dfffecb6c27f91ede11e0e64138efe80fdebec1c9e1a641ff78','Pre-capture protocol changed');
assert.equal(sha(protocol.modelParameters),protocol.frozenModelSHA256);
const source=protocol.newRawPath,raw=fs.readFileSync(source),sourceSHA256=sha(source);
const lines=raw.toString('utf8').trim().split(/\r?\n/);
assert.equal(lines.shift().replace(/^\uFEFF/,''),Array.from({length:107},(_,i)=>'I'+i).join(','));
const rows=lines.map(l=>l.split(',').map(Number)),cuts=[];
for(let k=1;k<rows.length;k++)if(rows[k][0]<=rows[k-1][0]||rows[k][1]<=rows[k-1][1])cuts.push(k);
assert.deepEqual(cuts,[]);assert.equal(rows[0][2],0);
const decoded=decodeRows(rows);
assert(decoded.qualified&&decoded.transportValid);assert.deepEqual(decoded.reasons,[]);
assert.equal(decoded.fast.length,8000);assert.equal(decoded.slow.length,300);
assert.equal(decoded.minimumCopies,4);assert.equal(decoded.activeGaps,0);assert.equal(decoded.stoppedGaps,0);
const active=rows.filter(r=>r[106]===1&&r[2]>=2&&r[2]<=5);assert.equal(active.length,400);
const rms=f=>Math.sqrt(active.reduce((s,r)=>s+f(r)**2,0)/active.length);
const metrics={native40msSamples:400,trackingRMSE_mm:rms(r=>((r[5]+r[6])/2-r[3])*1000),syncRMS_mm:rms(r=>(r[5]-r[6])*1000)};
const done=rows.find(r=>r[88]===4444&&r[89]===4&&r[90]===0),tail=rows.at(-1)[0]-done[0];
assert(tail>=20&&rows.at(-1)[0]>=185);
const display=rows.filter(r=>r[0]>=40&&r[2]===6);
assert(display.length&&display.every(r=>r[53]===display[0][53]&&r[54]===display[0][54]));
const audit={source,sourceSHA256,bytes:raw.length,totalRawRows:rows.length,currentSessionRows:rows.length,
  sessions:1,excludedResetPrefixRows:0,fullRecordingProtocolQualified:true,completeCRCVerifiedMotionSnapshotUsable:true,
  reasons:[],missingCSVFrames:0,missingSamplesImputed:false,metrics,
  firmware400PointMetrics:{trackingRMSE_mm:display[0][53],syncRMS_mm:display[0][54]},
  completionTail_s:tail,exportComplete_s:done[0],lastUptime_s:rows.at(-1)[0],
  phaseCounts:Object.fromEntries([...new Set(rows.map(r=>r[2]))].map(p=>[p,rows.filter(r=>r[2]===p).length])),
  periodRange_us:[decoded.header.period_min_us,decoded.header.period_max_us],corePeak_us:Math.max(...rows.map(r=>r[42])),
  bodyPeak_us:Math.max(...rows.map(r=>r[60])),stackMinimum_bytes:Math.min(...rows.map(r=>r[58])),
  frozenModel:protocol.modelParameters,frozenModelSHA256:protocol.frozenModelSHA256,noParameterFit:true,assistantHardwareAction:false};
decoded.source=source;decoded.sourceSHA256=sourceSHA256;decoded.capture_audit=audit;
const output=path.join(dir,'capture_analysis.json');fs.writeFileSync(output,JSON.stringify(decoded,null,2)+'\n',{flag:'wx'});
const py=spawnSync('C:/Users/ele/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe',
  ['-X','utf8',path.join(dir,'check_capture.py'),source,output],{encoding:'utf8',env:{...process.env,PYTHONUTF8:'1'}});
assert.equal(py.status,0,py.stdout+py.stderr);const independent=JSON.parse(py.stdout);assert.equal(independent.crc32,decoded.crc32);
assert.equal(sha(source),sourceSHA256);assert.equal(sha(protocol.modelParameters),protocol.frozenModelSHA256);
const verification={...audit,CRC32:decoded.crc32,minimumChunkCopies:decoded.minimumCopies,header:decoded.header,
  independentPythonFullDecodeCRCAndMetrics:independent};
fs.writeFileSync(path.join(dir,'capture_verification.json'),JSON.stringify(verification,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(verification,null,2));
