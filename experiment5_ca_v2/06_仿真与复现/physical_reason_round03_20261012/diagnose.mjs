import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';

// Read-only, same-state diagnosis. Never substitute a 40-ms sample for the
// allocator's previous 1-ms state. Does not predict closed-loop performance.
const dir=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(dir,'../..');
const pack=path.resolve(root,'../实验5整理_20261011');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const read=async p=>{const b=await fs.readFile(p);return {bytes:b,text:b.toString('utf8'),sha:hash(b)};};
const sourceMap=JSON.parse((await read(path.join(pack,'02_处理后数据/selected_source_map.json'))).text);
const preservationPath=path.join(root,'06_仿真与复现/sector_round02_20261012/data_attempt02/preservation.json');
const preservation=JSON.parse((await read(preservationPath)).text);
for(const [p,sha] of Object.entries(preservation)) assert.equal((await read(p)).sha,sha,`preservation: ${p}`);

const k=.006197916666666667;
const interval=(x,r=.0000005)=>[x-r,x+r];
const add=(a,b)=>[a[0]+b[0],a[1]+b[1]];
const mul=(a,b)=>{const v=[a[0]*b[0],a[0]*b[1],a[1]*b[0],a[1]*b[1]];return [Math.min(...v),Math.max(...v)];};
const scale=(a,s)=>mul(a,[s,s]);
const enlarge=(a,r)=>[a[0]-r,a[1]+r];
const clip=(x,l)=>Math.max(-l,Math.min(l,x));
function guard(rpm,cmd){
  const speed=Math.abs(rpm),old=cmd;
  if(speed<=30){
    if(speed>10&&rpm*old>0) return {cmd:Math.trunc(old*(30-speed)/20),hit:true};
    return {cmd,hit:false};
  }
  const braking=Math.min(200,10*(speed-30)),aligned=rpm>0?old:-old;
  return aligned>-braking?{cmd:rpm>0?-braking:braking,hit:true}:{cmd,hit:false};
}
function envelope(rpm,cmd,limit){
  if(Math.abs(cmd)>limit)return false;
  const speed=Math.abs(rpm),aligned=rpm>0?cmd:-cmd;
  if(speed>30)return aligned<=-Math.min(200,10*(speed-30));
  if(speed>10)return aligned<=Math.trunc(limit*(30-speed)/20);
  return true;
}
function sectorStatus(sigma,delta){
  // Bound a*s-b*s^2 over each decimal-rounding interval, with a conservative
  // float32 evaluation allowance. Integer deltas and rpm are exact in CSV.
  let uncertain=false;
  for(let ch=0;ch<2;ch++){
    const a=ch?-0.3*k*(delta[0]+delta[1]):k*(delta[0]-delta[1]);
    const b=ch?6.25:10,[lo,hi]=interval(sigma[ch]);
    const f=s=>a*s-b*s*s;
    const values=[f(lo),f(hi)],vertex=a/(2*b);
    if(vertex>=lo&&vertex<=hi)values.push(f(vertex));
    const m=Math.max(Math.abs(lo),Math.abs(hi));
    const allowance=2e-7*(Math.abs(a)*m+b*m*m)+1e-10*(1+b*m*m);
    if(Math.min(...values)>allowance)return 'fail';
    if(Math.max(...values)>-allowance)uncertain=true;
  }
  // A zero component of work (including delta=[0,0]) is analytically safe,
  // regardless of the sign/rounding of sigma.
  if(delta[0]===0&&delta[1]===0)return 'pass';
  return uncertain?'uncertain':'pass';
}
function correctionBounds(row){
  const gate=interval(row[31]),ny=scale(mul(interval(row[49]),interval(row[33])),-1);
  const na=scale(mul(interval(row[50]),interval(row[34])),-1);
  return [add(scale(ny,1/(2*k)),scale(na,-1/(.6*k))),
          add(scale(ny,-1/(2*k)),scale(na,-1/(.6*k)))].map(v=>enlarge(mul(v,gate),.002));
}
function increment(obj,key){obj[key]=(obj[key]??0)+1;}
function summarize(records){
  const s={frames:records.length,masks:{},categories:{},phase:{},frozen:0,
    onlyProjected:0,confirmedPureRate:0,pureRatePositiveRho:0,pureRateZeroRho:0,
    rhoSum:0,mechanismConsistency:{projectedMismatch:0,commandMismatch:0,
      baselineMismatch:0,wantedQuantizationMismatch:0,amplitudeMismatch:0,
      sectorFlagMismatch:0,speedFlagMismatch:0,learningMaskMismatch:0},
    sectorAttenuated:[0,0],meanSector:[0,0],
    continuousCorrectionPeak:0,targetZeroWhileProjected:0,
    medianTargetNorm:null,medianActualNorm:null};
  for(const r of records){
    increment(s.masks,r.mask);increment(s.categories,r.category);
    s.phase[r.phase]??={frames:0,confirmedPureRate:0,frozen:0};
    s.phase[r.phase].frames++;
    if(r.learn===0){s.frozen++;s.phase[r.phase].frozen++;}
    if(r.mask===2)s.onlyProjected++;
    if(r.category==='confirmed_pure_rate'){
      s.confirmedPureRate++;s.phase[r.phase].confirmedPureRate++;
      s.rhoSum+=r.rho;
      if(r.rho>0)s.pureRatePositiveRho++;else s.pureRateZeroRho++;
    }
    if(r.mask&2 && r.target[0]===0&&r.target[1]===0)s.targetZeroWhileProjected++;
    for(const [name,passed] of Object.entries(r.checks))if(!passed)s.mechanismConsistency[name]++;
    for(let c=0;c<2;c++){
      s.meanSector[c]+=r.sector[c];if(r.sector[c]<.999999)s.sectorAttenuated[c]++;
    }
    s.continuousCorrectionPeak=Math.max(s.continuousCorrectionPeak,r.correctionPeakEstimate);
  }
  s.meanSector=s.meanSector.map(v=>v/records.length);
  s.meanPureRateRho=s.confirmedPureRate?s.rhoSum/s.confirmedPureRate:null;
  const median=a=>{a.sort((x,y)=>x-y);return (a[Math.floor((a.length-1)/2)]+a[Math.floor(a.length/2)])/2;};
  s.medianTargetNorm=median(records.map(r=>Math.hypot(...r.target)));
  s.medianActualNorm=median(records.map(r=>Math.hypot(...r.actual)));
  return s;
}

const runs=[];
for(const entry of sourceMap.filter(v=>v.id.includes('CA_BLNN'))){
  const csvPath=path.join(pack,'02_处理后数据',entry.id+'_selected107.csv');
  const csv=await read(csvPath),lines=csv.text.replace(/^\uFEFF/,'').trim().split(/\r?\n/);
  assert.equal(lines[0],Array.from({length:107},(_,i)=>'I'+i).join(','));
  // The canonical selected source segment is rechecked against its raw export.
  const raw=await read(path.join(pack,entry.rawPackagePath));
  assert.equal(raw.sha,entry.sourceSHA256);
  const rawLines=raw.text.replace(/^\uFEFF/,'').trim().split(/\r?\n/);
  assert.deepEqual(lines.slice(1),rawLines.slice(entry.csvLines[0]-1,entry.csvLines[1]));
  const data=lines.slice(1).map((s,index)=>{
    assert.match(s,/^[\d.,+\-eE]+$/);
    const r=s.split(',').map(Number);assert.equal(r.length,107);
    assert(r.every(Number.isFinite));return {r,csvLine:index+2};
  });
  const active=data.filter(({r})=>r[106]===1);
  assert.equal(active.length,500);
  const records=active.map(({r,csvLine})=>{
    assert.equal(r[21],12);assert.equal(r[22],0);assert.equal(r[63],entry.build);
    assert.equal(r[19],entry.limits[0]);assert.equal(r[20],entry.limits[1]);
    const base=[r[64],r[65]],actual=[r[66],r[67]],rpm=[r[80],r[81]],lim=[r[19],r[20]],mask=r[68];
    const wanted=[r[90],r[91]],guarded=wanted.map((v,c)=>guard(rpm[c],v));
    const target=guarded.map((v,c)=>v.cmd-base[c]);
    const bi=[r[9]-actual[0],r[10]-actual[1]],corr=correctionBounds(r);
    const maxAbs=v=>Math.max(Math.abs(v[0]),Math.abs(v[1]));
    const minAbs=v=>v[0]<=0&&v[1]>=0?0:Math.min(Math.abs(v[0]),Math.abs(v[1]));
    const peakLo=Math.max(...corr.map(minAbs)),peakHi=Math.max(...corr.map(maxAbs));
    const ampScale=[Math.min(1,300/peakHi),Math.min(1,300/peakLo)];
    const requestedBounds=corr.map((v,c)=>enlarge(add(interval(bi[c],.00025),mul(v,ampScale)),.00025));
    const clipStatus=requestedBounds.some((v,c)=>v[0]>lim[c]||v[1]<-lim[c])?'fail':
      requestedBounds.every((v,c)=>v[0]>=-lim[c]&&v[1]<=lim[c])?'pass':'uncertain';
    let baselineMatch=true,wantedMatch=true,speedPossible=[];
    for(let c=0;c<2;c++){
      const beforeBase=[Math.trunc(clip(bi[c]-.00025,lim[c])),Math.trunc(clip(bi[c]+.00025,lim[c]))];
      const options=[];
      for(let v=beforeBase[0];v<=beforeBase[1];v++)options.push(guard(rpm[c],v));
      if(!options.some(v=>v.cmd===base[c]))baselineMatch=false;
      speedPossible.push(options.map(v=>v.hit));
      const [lo,hi]=requestedBounds[c].map(v=>Math.trunc(clip(v,lim[c])));
      if(wanted[c]<lo||wanted[c]>hi)wantedMatch=false;
    }
    const speedCertainly=guarded.some(v=>v.hit)||speedPossible.some(a=>a.every(Boolean));
    const speedImpossible=!guarded.some(v=>v.hit)&&speedPossible.every(a=>a.every(v=>!v));
    const sector=sectorStatus([r[39],r[40]],target);
    const targetLegal=target.every(v=>Math.abs(v)<=300)&&guarded.every((v,c)=>envelope(rpm[c],v.cmd,lim[c]));
    const pure=mask===2&&clipStatus==='pass'&&sector==='pass'&&targetLegal&&baselineMatch&&wantedMatch;
    const category=mask===0?'no_allocator_constraint':pure?'confirmed_pure_rate':
      mask===2?'only_projected_uncertain':(mask&~2)?'mixed_or_other_constraint':'unexpected';
    const dot=actual[0]*target[0]+actual[1]*target[1],den=target[0]**2+target[1]**2;
    const rho=den?Math.max(0,Math.min(1,dot/den)):0;
    const ampMismatch=peakLo>300?!(mask&1):peakHi<300?Boolean(mask&1):false;
    return {csvLine,t:r[79],phase:r[2],mask,learn:r[32],base,actual,wanted,target,rpm,
      sigma:[r[39],r[40]],sector:[r[49],r[50]],rawBase:bi,
      correctionPeakEstimate:(peakLo+peakHi)/2,correctionBounds:corr,
      requestedBounds,clipStatus,targetSectorStatus:sector,targetLegal,
      rho,category,checks:{
        projectedMismatch:Boolean(mask&2)===(target.some((v,c)=>v!==actual[c])),
        commandMismatch:r[13]===base[0]+actual[0]&&r[14]===base[1]+actual[1],
        baselineMismatch:baselineMatch,wantedQuantizationMismatch:wantedMatch,
        amplitudeMismatch:!ampMismatch,
        sectorFlagMismatch:sector==='uncertain'||Boolean(mask&4)===(sector==='fail'),
        speedFlagMismatch:(!speedCertainly||Boolean(mask&8))&&(!speedImpossible||!(mask&8)),
        learningMaskMismatch:Boolean(mask)===(r[32]===0)
      }};
  });
  const motion=records.filter(v=>v.phase>=2&&v.phase<=5);assert.equal(motion.length,400);
  runs.push({id:entry.id,source:csvPath,sourceSHA256:csv.sha,rawSource:entry.rawPackagePath,
    active:summarize(records),motion:summarize(motion),records});
  assert.equal((await read(csvPath)).sha,csv.sha);
}
const groups={};
for(const cond of ['A','B']){
  const records=runs.filter(v=>v.id.startsWith(cond+'_')).flatMap(v=>v.records);
  groups[cond]={active:summarize(records),motion:summarize(records.filter(v=>v.phase>=2&&v.phase<=5))};
}
for(const [p,sha] of Object.entries(preservation)) assert.equal((await read(p)).sha,sha);
const result={date:'2026-10-12',scope:'Six frozen HW6 physical CA runs, same-state 40-ms observations; no closed-loop counterfactual',
  preservationFiles:Object.keys(preservation).length,preservationPassed:true,
  uncertainty:{decimalHalfWidth:.0000005,rawBaseCountsPadding:.00025,correctionCountsPadding:.002,
    cannotRecover:'Previous 1-ms allocator state or missed trigger durations. rho is an instantaneous diagnostic, not predicted performance.'},
  groups,runs};
await fs.writeFile(path.join(dir,'diagnosis.json'),JSON.stringify(result,null,2),{flag:'wx'});
console.log(JSON.stringify({preserved:result.preservationFiles,groups,
  perRun:runs.map(v=>({id:v.id,motion:v.motion}))},null,2));
