import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {decodeRows} from '../motor_response_prepare_round92_20261015/decode.mjs';
const dir=path.dirname(fileURLToPath(import.meta.url)),root=path.resolve(dir,'../..');
const sha=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const p=JSON.parse(fs.readFileSync(path.join(root,'06_仿真与复现/motor_response_prepare_round92_20261015/protocol.json'),'utf8'));
assert.equal(sha(p.hex),p.hexSHA256);const project=path.resolve(path.dirname(p.project),'..');
for(const [f,h]of Object.entries(p.sourceHashes))assert.equal(sha(path.join(project,f)),h);
const registry=[['R90','cumulative_micro_round90_20261015','ffc2988f6943390e991294edb19ee0a7415f3e05b0dba3ffe80c9f585fe90b87'],
 ['R86','cumulative_micro_round86_20261015','b5fa79668e254f166c765a8444fd79733625633dc0e4ac8147e0c891da96580a'],
 ['R82','tracking_refine_round82_20261015','b0c586fc4e7f74c4a73b7140a372c4d60ee7a6940d9179a9a2cbd2a81a40d1a0']]
 .map(([label,d,h])=>{const file=path.join(root,'06_仿真与复现',d,'model_parameters.json');assert.equal(sha(file),h);return {label,file,sha256:h};});
const manifests=[];
const refs=new Map(fs.readFileSync(path.join(dir,'reference.csv'),'utf8').trim().split(/\r?\n/).slice(1).map(l=>{const v=l.split(',').map(Number);return [v[0],{phase:v[1],reference:v[2]}];}));
for(let run=1;run<=5;run++){
 const source=p.rawPath.replace('_run01.csv',`_run${String(run).padStart(2,'0')}.csv`),raw=fs.readFileSync(source);
 const lines=raw.toString('utf8').trim().split(/\r?\n/);assert.equal(lines.shift().replace(/^\uFEFF/,''),Array.from({length:107},(_,i)=>'I'+i).join(','));
 const all=lines.map(l=>l.split(',').map(Number)),cuts=[];
 for(let k=1;k<all.length;k++)if(all[k][0]<=all[k-1][0]||all[k][1]<=all[k-1][1])cuts.push(k);
 const prefix=[1,3,4].includes(run)?1:0;assert.deepEqual(cuts,prefix?[1]:[]);
 if(prefix)assert([6,9].includes(all[0][2])&&all[1][2]===0);
 const rows=all.slice(prefix),d=decodeRows(rows);
 assert.deepEqual(d.reasons,['CSV gaps']);assert.equal(d.gaps,1);assert.equal(d.minimumCopies,4);
 const gaps=[];for(let k=1;k<rows.length;k++)if(rows[k][1]!==rows[k-1][1]+1){
  assert(rows[k][2]===6&&rows[k-1][2]===6&&rows[k][89]===2&&rows[k-1][89]===2);
  gaps.push({prior:rows[k-1].slice(0,3),next:rows[k].slice(0,3),stage:'Stopped CRC preparation, before payload'});
 }
 const active=rows.filter(r=>r[106]===1&&r[2]>=2&&r[2]<=5);assert.equal(active.length,400);
 const rms=f=>Math.sqrt(active.reduce((s,r)=>s+f(r)**2,0)/active.length);
 const directCSVmetrics={trackingRMSE_mm:rms(r=>((r[5]+r[6])/2-r[3])*1000),syncRMS_mm:rms(r=>(r[5]-r[6])*1000)};
 const snapshotMap=new Map(d.rows.map(r=>[r.last_step,r]));const sign=[1,-1],pitch=d.header.configured_meters_per_count;
 const metricSamples=[];const round6=x=>Math.round(x*1e6)/1e6;
 for(const r of active){const endpoint=snapshotMap.get(r[46]-2);assert(endpoint,'Native frame must align with logged endpoint');
  const position=endpoint.encoder.map((v,ch)=>Math.fround(Math.fround(v*pitch)*sign[ch]));
  const ref=refs.get(Math.round(r[79]*1000));assert(ref&&ref.phase===r[2]);
  const digits=run<=3?6:5,quant=x=>Number(x.toFixed(digits));
  assert(position.every((v,ch)=>Math.abs(quant(v)-r[5+ch])<1e-12));assert(Math.abs(quant(ref.reference)-r[3])<1e-12);
  metricSamples.push({step:r[46]-2,elapsed_ms:Math.round(r[79]*1000),phase:r[2],reference_m:round6(ref.reference),position_m:position.map(round6)});
 }
 const rmsSample=f=>Math.sqrt(metricSamples.reduce((s,r)=>s+f(r)**2,0)/metricSamples.length);
 const metrics={trackingRMSE_mm:rmsSample(r=>((r.position_m[0]+r.position_m[1])/2-r.reference_m)*1000),syncRMS_mm:rmsSample(r=>(r.position_m[0]-r.position_m[1])*1000)};
 const display=rows.filter(r=>r[0]>=40&&r[2]===6);assert(display.length);
 const displayTolerance=run<=3?.00000051:.0000051;
 assert(display.every(r=>Math.abs(r[53]-metrics.trackingRMSE_mm)<displayTolerance&&Math.abs(r[54]-metrics.syncRMS_mm)<displayTolerance));
 const audit={run,source,sourceSHA256:sha(source),totalRows:all.length,prefixRows:prefix,
  prefixRow:prefix?{time:all[0][0],phase:all[0][2],fault:all[0][22],build:all[0][63]}:null,
  prefixReason:prefix?'One cached prior-session stopped/fault row separated by uptime and sequence reset; raw retained':'None',
  strictFullProtocolQualified:false,snapshotAnd400PointMetricsUsable:true,limitations:d.reasons,
  activeSamples:400,gaps,metrics,directCSVmetrics,CSVdecimalPlaces:run<=3?6:5,
  metricBasis:'CRC-verified encoder snapshots with frozen C trajectory at logged control times, same six-decimal-metre statistics as firmware. Native CSV rounding independently checked; no missing active sample imputed.',
  firmwareDisplayedRMS:[display[0][53],display[0][54]],completionTail_s:d.completionTail_s,crc32:d.crc32,minimumCopies:d.minimumCopies,
  periodRange_us:[d.header.period_min_us,d.header.period_max_us],corePeak_us:Math.max(...rows.map(r=>r[42])),
  bodyPeak_us:Math.max(...rows.map(r=>r[60])),stackMinimum_bytes:Math.min(...rows.map(r=>r[58])),
  fault:d.header.fault,qualityFlags:d.header.quality_flags,missingActiveSamplesImputed:false,
  phaseCounts:Object.fromEntries([...new Set(active.map(r=>r[2]))].map(phase=>[phase,active.filter(r=>r[2]===phase).length]))};
 assert(audit.fault===0&&audit.qualityFlags===0);d.source=source;d.sourceSHA256=audit.sourceSHA256;d.capture_audit=audit;d.metric_samples=metricSamples;
 const file=path.join(dir,`run${String(run).padStart(2,'0')}_decoded.json`);
 fs.writeFileSync(file,JSON.stringify(d,null,2)+'\n',{flag:'wx'});
 manifests.push({run,source,sourceSHA256:audit.sourceSHA256,decoded:file,decodedSHA256:sha(file),prefixRows:prefix,metrics,
   strictFullProtocolQualified:false,snapshotUsable:true,activeSamples:400,CRC32:d.crc32,minimumCopies:d.minimumCopies,completionTail_s:d.completionTail_s});
 console.log(JSON.stringify(audit));
}
const out={date:'2026-10-15',authorization:'User states five records already collected and requests all three frozen predictions, then motor-informed model update. Additional collection beyond original one was operator action, not assistant-generated trials.',
 records:manifests,registry,firmwareProject:p.project,firmwareHEX:p.hex,firmwareHEXSHA256:p.hexSHA256,
 limitations:'Each CSV has one missing stopped CRC-preparation frame; active400 frames and full four-copy blob restored. Run04/05 CSV positions rounded5decimal metres; metrics independently reconstructed from integer encoder snapshots and frozen trajectory, checked against firmware RMS. Cached prior fault rows inrun01/03 retained and separated by reset boundary. No full old fault run can be assessed from one row.',
 inputApproximation:'M1 fine1ms windows plus20ms means outside windows differ from Q2 old1ms motion/40ms holding. Frozen model errors must not be attributed solely to motor dynamics.',
 modelsRefitted:0,oldRawAndFrozenModelsUnchanged:true,assistantHardwareAction:false};
fs.writeFileSync(path.join(dir,'capture_manifest.json'),JSON.stringify(out,null,2)+'\n',{flag:'wx'});
