import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import assert from 'node:assert/strict';
const source=path.resolve(process.argv[2]),raw=fs.readFileSync(source),lines=raw.toString('utf8').trim().split(/\r?\n/);assert(lines.shift().includes('I106'));
const rows=lines.map(x=>x.split(',').map(Number)).filter(v=>v.length===107&&v.every(Number.isFinite));
const live=rows.filter(v=>v[106]===1&&v[2]>=1&&v[2]<=5),firstFault=rows.find(v=>v[22]!==0);
const traceMap=new Map();
for(const v of rows)if(v[2]===9&&v[88]!==4438&&Number.isInteger(v[103])&&v[103]>=0&&v[103]<64&&!traceMap.has(v[103]))traceMap.set(v[103],{index:v[103],relative_ms:v[96],rpm:[v[97],v[98]],encoder_rpm:[v[99],v[100]],previous_command_counts:[v[101],v[102]]});
const trace=[...traceMap.values()].sort((a,b)=>a.relative_ms-b.relative_ms),range=(k,arr=live)=>arr.length?[Math.min(...arr.map(v=>v[k])),Math.max(...arr.map(v=>v[k]))]:null;
const result={source,sourceSHA256:crypto.createHash('sha256').update(raw).digest('hex'),frames:rows.length,liveFrames:live.length,phases:[...new Set(rows.map(v=>v[2]))],firstFault:firstFault?{boardTime_s:firstFault[0],elapsed_s:firstFault[79],fault:firstFault[22],firstFault:firstFault[94],firstFault_elapsed_s:firstFault[95],voltage:firstFault[27],encoder_position_mm:[firstFault[5]*1000,firstFault[6]*1000],RPMpeaks:[firstFault[82],firstFault[83]],speedGuardCounts:[firstFault[84],firstFault[85]],overruns:firstFault[57],bodyPeak_us:firstFault[60]}:null,
 liveRanges:{voltage:range(27),position_mm:[range(5)?.map(x=>x*1000),range(6)?.map(x=>x*1000)],command_counts:[range(13),range(14)],rawRPM:[range(80),range(81)]},
 faultTraceCount:trace.length,faultTrace:trace,activeRPMGuardEvidence:trace.filter(r=>r.rpm.some(v=>Math.abs(v)>120)),
 limitations:['ESC and encoder speed are not independent physical sensors; sampled live40ms data cannot exclude1ms excursions.','This run faulted and does not qualify Q0 or identify the platform.'],qualified:false};
if(process.argv.includes('--save'))fs.writeFileSync(source+'.diagnosis.json',JSON.stringify(result,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({...result,faultTrace:trace.slice(-12)},null,2));
