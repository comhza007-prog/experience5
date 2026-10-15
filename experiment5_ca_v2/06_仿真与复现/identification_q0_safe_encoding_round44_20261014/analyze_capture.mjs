import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {decodeManual} from '../identification_q0_manual_round42_20261014/analyze.mjs';
const prior=process.argv.includes('--prior-67822');
const identity=prior?{build:67822,schema:4489,magic:4440,passes:2,recoverStoppedGaps:true}:{build:67823,schema:4490,magic:4441,passes:2,recoverStoppedGaps:true,wordEncoding:1};
const source=path.resolve(process.argv[2]),raw=fs.readFileSync(source),lines=raw.toString('utf8').trim().split(/\r?\n/);
assert.equal(lines.shift().replace(/^\uFEFF/,''),Array.from({length:107},(_,i)=>'I'+i).join(','));
const rows=lines.map((l,j)=>{const t=l.split(',');assert(t.every(v=>v.trim()!==''),'Empty field');const v=t.map(Number);assert(v.length===107&&v.every(Number.isFinite),'Bad CSV row'+(j+2));return v;});
const gaps=[];for(let j=0;j<rows.length;j++){
 const v=rows[j];assert(v[63]===identity.build&&v[21]===11&&v[87]===6,'Identity');
 if(j){assert(v[0]>rows[j-1][0]&&v[1]>rows[j-1][1],'Reset/mixed run');if(v[1]-rows[j-1][1]>1)gaps.push({CSVRow:j+2,missing:v[1]-rows[j-1][1]-1,phase:v[2],priorPhase:rows[j-1][2],boardTime_s:v[0],index:v[90]});}
}
let result;try{result=decodeManual(rows,identity);}catch(e){
 assert.match(e.message,/Missing chunks or duplicate evidence|Missing completion tail/);
 const copies=new Uint16Array(3968);for(const v of rows)if(v[88]===identity.magic&&v[89]===3){assert(Number.isInteger(v[90])&&v[90]>=0&&v[90]<3968);copies[v[90]]++;}
 const complete=rows.find(v=>v[88]===identity.magic&&v[89]===4)?.[0]??null;
 const tail=complete===null?null:rows.at(-1)[0]-complete;
 const missing=[...copies].flatMap((n,i)=>n===0?[i]:[]),single=[...copies].flatMap((n,i)=>n===1?[i]:[]);
 result={qualified:false,transportValid:false,reasons:[...(missing.length||single.length?['Missing chunks or duplicate evidence']:[]),...(tail===null||tail<4.99?['Missing completion tail']:[])],missingChunks:missing,singleCopyChunks:single,wholeCRCVerified:false,decodedRecords:null,completionTime_s:complete,completionTail_s:tail};
}
const active=rows.filter(v=>v[106]===1&&v[2]>=2&&v[2]<=5),live=rows.filter(v=>v[106]===1&&v[2]>=1&&v[2]<=5);
const metric=a=>a.length?{n:a.length,rmse_mm:Math.sqrt(a.reduce((s,v)=>s+v*v,0)/a.length),max_abs_mm:Math.max(...a.map(Math.abs))}:null;
const range=(k,r=live)=>r.length?[Math.min(...r.map(v=>v[k])),Math.max(...r.map(v=>v[k]))]:null;
Object.assign(result,{source,sourceSHA256:crypto.createHash('sha256').update(raw).digest('hex'),identity,frames:rows.length,singleSession:true,rawUnchanged:true,gaps,motionMissingFrames:gaps.filter(g=>![6,9].includes(g.phase)||![6,9].includes(g.priorPhase)).reduce((s,g)=>s+g.missing,0),totalMissingFrames:gaps.reduce((s,g)=>s+g.missing,0),phases:[...new Set(rows.map(v=>v[2]))],faults:[...new Set(rows.map(v=>v[22]).filter(Boolean))],motionCompleted:[0,1,2,3,4,5,6].every(p=>rows.some(v=>v[2]===p))&&rows.every(v=>v[22]===0&&v[2]!==9),modelIdentified:false,
 liveDiagnostics:{window:'I2 phases2..5 AND I106=1,40ms sampling',tracking:metric(active.map(v=>1000*((v[5]+v[6])/2-v[3]))),sync:metric(active.map(v=>1000*(v[5]-v[6]))),voltage_V:range(27),peakRPM:[range(82,rows)?.[1],range(83,rows)?.[1]],corePeak_us:range(42,rows)?.[1],bodyPeak_us:range(60,rows)?.[1],overruns:range(57,rows)?.[1],uartErrors:range(59,rows)?.[1],DMASkipped:range(70,rows)?.[1],CANRejected:range(28,rows)?.[1],finalPosition_mm:rows.at(-1).slice(5,7).map(v=>v*1000)}});
const dir=path.dirname(fileURLToPath(import.meta.url)),output=path.join(dir,'build'+identity.build+'_'+result.sourceSHA256.slice(0,12)+'_analysis.json');
fs.writeFileSync(output,JSON.stringify(result,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({...result,slow:undefined,fast:undefined,output},null,2));
