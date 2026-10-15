import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const dir=path.dirname(fileURLToPath(import.meta.url)),root=path.resolve(dir,'../../..');
const source=path.join(root,'experiment5_ca_v2/01_原始数据/事件诊断_A/E5D_A_CA_HW6_EVENT128_L1200_R1200_M0g_S2mm_run01.csv');
const bytes=fs.readFileSync(source),sha=crypto.createHash('sha256').update(bytes).digest('hex');
const lines=bytes.toString('utf8').replace(/^\uFEFF/,'').trim().split(/\r?\n/);
assert.equal(lines[0],Array.from({length:107},(_,i)=>'I'+i).join(','));
const rows=lines.slice(1).map((s,i)=>{assert.match(s,/^[\d.,eE+\-]+$/);const v=s.split(',').map(Number);assert.equal(v.length,107);assert(v.every(Number.isFinite));return {line:i+2,v};});
assert(rows.every(r=>r.v[63]===64412&&r.v[21]===12));
const active=rows.filter(r=>r.v[106]===1),motion=active.filter(r=>r.v[2]>=2&&r.v[2]<=5);
assert.equal(active.length,500);assert.equal(motion.length,400);
const seqGaps=[];
for(let i=1;i<rows.length;i++){
  assert(rows[i].v[0]>rows[i-1].v[0],'Mixed/restarted history');
  if(rows[i].v[1]!==rows[i-1].v[1]+1)seqGaps.push({lines:[rows[i-1].line,rows[i].line],sequence:[rows[i-1].v[1],rows[i].v[1]]});
}
const replay=rows.filter(r=>r.v[88]===4421),chunks=new Map(),missing=[],records=[];
assert(replay.length>0);assert(replay.every(r=>r.v[2]===6&&r.v[22]===0&&r.v[13]===0&&r.v[14]===0&&r.v[106]===0));
const count=replay[0].v[92],triggerMs=replay[0].v[93];
for(const r of replay){
  const [index,chunk]=r.v.slice(90,92);assert(Number.isInteger(index)&&index>=0&&index<count);assert(Number.isInteger(chunk)&&chunk>=0&&chunk<4);
  assert.equal(r.v[92],count);assert.equal(r.v[93],triggerMs);
  const key=index+':'+chunk,value=r.v.slice(96,104);
  if(chunks.has(key))assert.deepEqual(chunks.get(key),value,'Conflicting duplicate payload');
  chunks.set(key,value);
}
for(let i=0;i<count;i++){
  const parts=[0,1,2,3].map(j=>chunks.get(i+':'+j));
  const missingChunks=parts.map((v,j)=>v?null:j).filter(v=>v!==null);
  if(missingChunks.length){missing.push({index:i,chunks:missingChunks});records.push({index:i,complete:false,parts});}
  else records.push({index:i,complete:true,values:parts.flat()});
}
const complete=records.filter(r=>r.complete),continuityErrors=[];
for(let i=1;i<count;i++){
  if(!records[i].complete||!records[i-1].complete)continue;
  const a=records[i-1].values,b=records[i].values;
  assert.equal(b[0]-a[0],1);
  if(a[18]!==b[20]||a[19]!==b[21])continuityErrors.push(i);
}
assert.equal(continuityErrors.length,0);
for(const r of complete){const v=r.values;assert.equal(v[6],v[14]+v[18]);assert.equal(v[7],v[15]+v[19]);assert.equal(Boolean(v[22]),v[23]===0);}
const archivedTask=path.join(root,'实验5整理_20261011/05_实验代码/正式对照_HW6_A/eassy_E5F_A_CA_BLNN_HW6/Task');
const env={...process.env,PATH:'D:/MinGW/mingw64/bin;'+process.env.PATH},nativeChecks=[];
const input=complete.map(r=>[r.index,...r.values].join(' ')).join('\n')+'\n';
for(const precision of ['float','double']){
  const exe=path.join(dir,'replay_allocator_'+precision+'.exe');
  const build=spawnSync('D:/MinGW/mingw64/bin/gcc.exe',['-std=c99','-O2','-Wall','-Wextra','-Werror','-Wno-unused-function',
    ...(precision==='double'?['-DE5_USE_DOUBLE']:[]),'-I',archivedTask,path.join(dir,'replay_allocator.c'),'-o',exe],{env,encoding:'utf8'});
  assert.equal(build.status,0,build.stderr);
  const test=spawnSync(exe,[],{env,encoding:'utf8',input,maxBuffer:2e6});assert.equal(test.status,0,test.stderr);
  const output=test.stdout.trim().split(/\r?\n/).map(s=>JSON.parse(s));assert.equal(output.length,complete.length);
  const mismatch=output.filter((a,i)=>a.mask!==complete[i].values[22]||a.delta[0]!==complete[i].values[18]||a.delta[1]!==complete[i].values[19]);
  nativeChecks.push({precision,frames:output.length,mismatches:mismatch,events:output.filter(a=>[64,113].includes(a.index)),output});
}
const range=(col,rs=rows)=>[Math.min(...rs.map(r=>r.v[col])),Math.max(...rs.map(r=>r.v[col]))];
const finish=replay.find(r=>r.v[89]===4),terminal=rows.find(r=>r.v[2]===6);
const eventRows=complete.filter(r=>r.values[22]&(16|32));
const cadence=[0,1].map(axis=>{
  const differences=[];
  for(let i=1;i<count;i++)if(records[i].complete&&records[i-1].complete)differences.push(records[i].values[27+axis]-records[i-1].values[27+axis]);
  const histogram={};for(const v of differences)histogram[v]=(histogram[v]||0)+1;
  return {axis,intervals:differences.length,rxCountIncrementHistogram:histogram,ageRange_ms:[Math.min(...complete.map(r=>r.values[29+axis])),Math.max(...complete.map(r=>r.values[29+axis]))]};
});
const result={source,sourceSHA256:sha,date:'2026-10-12',reportGenerated:false,
  rowCount:rows.length,seqGaps,phaseChanges:rows.filter((r,i)=>i===0||r.v[2]!==rows[i-1].v[2]).map(r=>({line:r.line,t:r.v[0],phase:r.v[2]})),
  motionCompleted:true,faults:[...new Set(rows.map(r=>r.v[22]))],
  controlPeriod_us:range(43,active),corePeak_us:range(42)[1],wholePeak_us:range(60)[1],
  late:range(45)[1],overruns:range(57)[1],uartErrors:range(59)[1],dmaSkipped:range(70)[1],canRejected:range(28)[1],
  battery_V:range(27),terminalPositions_m:terminal.v.slice(5,7),
  event:{recordCount:count,completeRecords:complete.length,missing,distinctChunks:chunks.size,triggerMs,
    transmitCompleted:Boolean(finish),completionUptime_s:finish?.v[0],endUptime_s:rows.at(-1).v[0],postCompletion_s:finish?rows.at(-1).v[0]-finish.v[0]:null,
    receivedAllChunks:missing.length===0,continuityErrors,events:eventRows,cadence,records},
  nativeChecks,
  limitations:['One 8-float chunk missing at index 80; it is NOT interpolated. Both actual contraction events are fully received.',
    'Allocator replay uses measured target quantization representatives and rounded sigma; it does NOT reconstruct network weights.',
    'Balanced witness feasibility at these states is NOT evidence of closed-loop accuracy or safe new firmware.',
    'CAN cadence is measured locally over the received event window, not certified over the whole run.']};
assert.equal(crypto.createHash('sha256').update(fs.readFileSync(source)).digest('hex'),sha);
const outputPath=path.join(dir,'record_analysis_'+sha.slice(0,12)+'.json');
fs.writeFileSync(outputPath,JSON.stringify(result,null,2),{flag:'wx'});
console.log(JSON.stringify({...result,event:{...result.event,records:undefined},nativeChecks:nativeChecks.map(v=>({...v,output:undefined}))},null,2));
