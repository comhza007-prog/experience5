import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
const dir=path.dirname(fileURLToPath(import.meta.url)),root=path.resolve(dir,'../..');
const file=path.join(root,'01_原始数据/自动监视_网络回放_20261014/E5REPLAY_A_S3R2_B67612_HW6_STATE360_L1200_R1200_M0g_S2mm_run01.csv');
const bytes=fs.readFileSync(file),lines=bytes.toString('utf8').trim().split(/\r?\n/);
assert.equal(lines.shift(),Array.from({length:107},(_,i)=>'I'+i).join(','));
const rows=lines.map(l=>l.split(',').map(Number));assert(rows.every(r=>r.length===107&&r.every(Number.isFinite)&&r[63]===67612&&r[21]===12&&r[87]===6));
let gaps=0;for(let i=1;i<rows.length;i++){assert(rows[i][1]>rows[i-1][1]);gaps+=rows[i][1]-rows[i-1][1]-1;}
const first=rows.find(r=>r[22]!==0),tail=rows.filter(r=>r[2]===9);assert(first&&first[22]===512&&first[94]===512);
assert(tail.every(r=>r[13]===0&&r[14]===0&&r[106]===0));
const faults=new Map();for(const r of tail){
 const index=r[103];assert(Number.isInteger(index)&&index>=0&&index<64);
 const payload=r.slice(96,103);if(faults.has(index))assert.deepEqual(faults.get(index),payload);else faults.set(index,payload);
}
assert.equal(faults.size,64);const history=Array.from({length:64},(_,i)=>({index:i,relative_ms:faults.get(i)[0],rawRPM:faults.get(i).slice(1,3),encoderFrameRPM:faults.get(i).slice(3,5),previousCommandCounts:faults.get(i).slice(5,7)}));
assert.equal(history[0].relative_ms,0);assert.equal(history[63].relative_ms,-63);
const result={file,sha256:crypto.createHash('sha256').update(bytes).digest('hex'),build:67612,schema:4485,
 rows:rows.length,missingFrames:gaps,phases:[...new Set(rows.map(r=>r[2]))],fault:512,firstFaultElapsed_s:first[95],lastSuccessfulControllerSteps:rows.at(-1)[46],
 normalCompletion:false,fullNetworkSnapshotExported:false,allFaultCommandsAndDrivePermitZero:true,
 faultTailSeconds:rows.at(-1)[0]-first[0],faultReplayComplete:true,faultReplay:history,
 rawPeakRPM:[rows.at(-1)[82],rows.at(-1)[83]],
 lastObservedPosition_mm:[1000*first[5],1000*first[6]],lastObservedSync_mm:1000*(first[5]-first[6]),
 corePeak_us:rows.at(-1)[42],bodyPeak_us:rows.at(-1)[60],late:rows.at(-1)[45],overruns:rows.at(-1)[57],UARTerrors:rows.at(-1)[59],
 triggerHistory:history.slice(0,16),
 interpretation:'Failed diagnostic run, preserved as failure; not a formal efficacy run.512 is the unchanged rawRPM hard guard. Encoder-frameRPM is computed from the same motor encoder and CAN frame timing, not an independent sensor or necessarily contemporaneous rawRPM. A mismatch alone cannot prove a bad sensor. No guard weakening, reset or automatic retry.'};
fs.writeFileSync(path.join(dir,'run01_fault_analysis.json'),JSON.stringify(result,null,2));
console.log(JSON.stringify({...result,faultReplay:undefined},null,2));
