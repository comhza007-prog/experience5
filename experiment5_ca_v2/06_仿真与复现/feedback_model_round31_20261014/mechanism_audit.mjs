import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
const dir=path.dirname(fileURLToPath(import.meta.url));
const rms=a=>Math.sqrt(a.reduce((s,v)=>s+v*v,0)/a.length);
const mean=a=>a.reduce((s,v)=>s+v,0)/a.length;
const count=(a,f)=>a.filter(f).length;
const bins=a=>Object.fromEntries([...new Set(a)].sort((a,b)=>a-b).map(v=>[v,count(a,x=>x===v)]));
const summary=rows=>({
  n:rows.length,
  rawRPM_RMS:[80,81].map(i=>rms(rows.map(r=>r[i]))),
  rawRPM_Above10_observed:[80,81].map(i=>count(rows,r=>Math.abs(r[i])>10)),
  rawRPM_Above30_observed:[80,81].map(i=>count(rows,r=>Math.abs(r[i])>30)),
  observedSpeedGuardFrames:count(rows,r=>r[86]!==0),
  maxAbsCommandCounts:[13,14].map(i=>Math.max(...rows.map(r=>Math.abs(r[i])))),
  filteredVelocityRMS_mmPerS:[7,8].map(i=>1000*rms(rows.map(r=>r[i]))),
  actualModalLearningMean:[17,18].map(i=>mean(rows.map(r=>r[i]))),
  actualModalLearningZeroFrames:[17,18].map(i=>count(rows,r=>r[i]===0)),
  sectorMean:[49,50].map(i=>mean(rows.map(r=>r[i]))),
  repairModeHistograms:[25,26].map(i=>bins(rows.map(r=>r[i]))),
  classifierHistogram:bins(rows.map(r=>r[88])),
  maskHistogram:bins(rows.map(r=>r[68])),
  growthNodesEnd:[35,36].map(i=>rows.at(-1)[i]),
  fractionNearAmplitudeEdge:[13,14].map(i=>count(rows,r=>Math.abs(r[i])>=1199)/rows.length),
  admittedNNRMS_counts:[66,67].map(i=>rms(rows.map(r=>r[i]))),
  maxCANAge_ms:[47,48].map(i=>Math.max(...rows.map(r=>r[i]))),
  gateMin:Math.min(...rows.map(r=>r[31]))
});
const output=[];
for(const method of ['BLNN','S3R2']){
  const audit=JSON.parse(fs.readFileSync(path.join(dir,method+'_run01_analysis.json'),'utf8'));
  const bytes=fs.readFileSync(audit.file);assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),audit.sha256);
  const all=bytes.toString('utf8').trim().split(/\r?\n/).slice(1).map(l=>l.split(',').map(Number));
  const rows=all.filter(r=>r[106]===1&&r[2]>=2&&r[2]<=5);assert.equal(rows.length,400);
  const trace=JSON.parse(fs.readFileSync(path.join(dir,method+'_run01_samples.json'),'utf8')).samples.filter(r=>r.ms>=4000&&r.ms<20000);
  assert.equal(trace.length,1600);
  const rpmSwitches=[0,1].map(ch=>{
    const signs=trace.map(r=>Math.sign(r.rpm[ch])).filter(x=>x!==0);
    return count(signs.slice(1),(v,i)=>v!==signs[i]);
  });
  const speedCountStart=all.find(r=>r[106]===1),speedCountEnd=all.find(r=>r[2]===6);
  const learningOverrides=method==='S3R2'?[0,1].map(ch=>{
    const nominal=r=>{
      const base=[r[9]-r[66],r[10]-r[67]];
      const headroom=Math.min(...base.map((v,j)=>(r[19+j]-Math.abs(v))/r[19+j]));
      const pre=Math.min(r[31],Math.max(0,Math.min(1,headroom/.15)));
      return r[88]===1?pre*r[89]:((r[68]||r[88])?0:pre);
    };
    return {axis:ch===0?'Y':'alpha',acceptedRepairFrames:count(rows,r=>r[25+ch]===1),
      acceptedRepairsAboveNominalLearningFrames:count(rows,r=>r[25+ch]===1&&r[17+ch]>nominal(r)+1e-6),
      acceptedRepairCauseHistogram:bins(rows.filter(r=>r[25+ch]===1).map(r=>r[88])),
      stationaryRetentionFrames:count(rows,r=>r[25+ch]===3),
      note:'Nominal pre-repair learning reconstructed from raw BASE=requested-admittedDelta,headroom,gate and classifier. Floating additions introduce small reconstruction error; override count uses1e-6 tolerance. Actual modal learning is I17/I18, not I32.'};
  }):null;
  output.push({method,source:audit.file,sha256:audit.sha256,motion:summary(rows),
    phases:[2,3,4,5].map(phase=>({phase,...summary(rows.filter(r=>r[2]===phase))})),
    finalCumulativeGuardedMs_byAxis:[84,85].map(i=>speedCountEnd[i]-speedCountStart[i]),
    finalAmplitudeEdgeMs_byAxis:[61,62].map(i=>speedCountEnd[i]-speedCountStart[i]),
    finalNodeCounts:[35,36].map(i=>speedCountEnd[i]),
    sampledRPMNonzeroSignSwitches:rpmSwitches,
    learningOverrides,
    prospectiveReplayWindowObserved:rows.filter(r=>r[79]>=5.36&&r[79]<5.72).map(r=>({ms:Math.round(r[79]*1000),cause:r[88],repairModes:[r[25],r[26]],actualLearning:[r[17],r[18]]})),
    eventFullNetworkStateAvailable:false});
}
const result={runs:output,limitations:[
  '40ms histograms are observations, not1ms trigger durations; speed intervention cumulative counters are authoritative only for their encoded guard definition.',
  '10msRPM sign changes may describe oscillation or feedback characteristics, not a demonstrated mechanical or sensor defect.',
  'Different closed-loop states prevent attributing a performance difference solely to learning suppression or a specific guard.',
  'No full1ms continuous input history or saved full initial network state; exact recurrent learning replay is not possible from these records.'
],codeFinding:'Both methods use identical filtered RPM velocity,1ms acceleration filter and baseline gains. Ordinary BLNN updates learning continuously; S3R2 changes output sector/allocation and actual per-mode learning. No hard-current limit increase is justified by these records.',causalDefectIdentified:false,newPerformanceCandidateReleased:false};
fs.writeFileSync(path.join(dir,'mechanism_verification.json'),JSON.stringify(result,null,2));
console.log(JSON.stringify(output.map(r=>({method:r.method,motion:r.motion,finalGuardedMs:r.finalCumulativeGuardedMs_byAxis,amplitudeEdgeMs:r.finalAmplitudeEdgeMs_byAxis,rpmSignSwitches:r.sampledRPMNonzeroSignSwitches})),null,2));
