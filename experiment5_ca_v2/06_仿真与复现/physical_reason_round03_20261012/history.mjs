import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
const dir=path.dirname(fileURLToPath(import.meta.url));
const d=JSON.parse(await fs.readFile(path.join(dir,'diagnosis.json'),'utf8'));
const results=[];
for(const run of d.runs){
  const bytes=await fs.readFile(run.source);
  assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),run.sourceSHA256);
  const rows=bytes.toString('utf8').trim().split(/\r?\n/).slice(1).map(s=>s.split(',').map(Number));
  const motion=rows.filter(r=>r[106]===1&&r[2]>=2&&r[2]<=5);
  const first=rows.findIndex(r=>r[106]===1),end=rows.findIndex((r,i)=>i>first&&r[2]===6);
  assert(first>0&&end>first);
  const startRow=rows[first-1],endRow=rows[end];
  const metrics={id:run.id,totalCoreSteps:endRow[46]-startRow[46],
    totalWithdrawals:endRow[77]-startRow[77],totalContractions:endRow[105]-startRow[105],
    totalSpeedGuardSteps:[endRow[84]-startRow[84],endRow[85]-startRow[85]],
    motionIntervals:motion.length-1,intervalsWithWithdrawal:0,intervalsWithContraction:0,
    onlyProjectedEndpointsAfterWithdrawal:0,onlyProjectedEndpointsAfterContraction:0,
    pureEndpoints:0,pureEndpointsFollowingOtherConstraint:0,
    slewBoundExceededAcrossSampleInterval:0,largestWithdrawalCountIn40ms:0,
    sameStateLearningReplay:{oldFrozen:0,newFrozen:0,oldLearningSum:0,newLearningSum:0,
      claim:'Instantaneous rule evaluation on OLD trajectory, not a new hardware run or accuracy prediction.'}};
  assert.equal(metrics.totalCoreSteps,20000);
  for(let i=0;i<motion.length;i++){
    const r=motion[i],record=run.records.find(v=>v.csvLine===rows.indexOf(r)+2);
    assert(record);
    const headroom=Math.min((r[19]-Math.abs(record.rawBase[0]))/r[19],
                           (r[20]-Math.abs(record.rawBase[1]))/r[20]);
    const pre=Math.min(r[31],Math.max(0,Math.min(1,headroom/.15)));
    const learning=record.category==='confirmed_pure_rate'?pre*record.rho:r[32];
    const s=metrics.sameStateLearningReplay;
    s.oldLearningSum+=r[32];s.newLearningSum+=learning;
    if(r[32]===0)s.oldFrozen++;if(learning===0)s.newFrozen++;
    if(i===0)continue;
    const previous=motion[i-1],w=r[77]-previous[77],c=r[105]-previous[105];
    const speed=(r[84]>previous[84])||(r[85]>previous[85]);
    assert(w>=0&&c>=0);assert(Math.abs((r[79]-previous[79])-.04)<.00001);
    if(w>0)metrics.intervalsWithWithdrawal++;
    if(c>0)metrics.intervalsWithContraction++;
    metrics.largestWithdrawalCountIn40ms=Math.max(metrics.largestWithdrawalCountIn40ms,w);
    if(r[68]===2){
      metrics.pureEndpoints++;
      if(w>0)metrics.onlyProjectedEndpointsAfterWithdrawal++;
      if(c>0)metrics.onlyProjectedEndpointsAfterContraction++;
      if(w>0||c>0||speed)metrics.pureEndpointsFollowingOtherConstraint++;
    }
    const steps=r[46]-previous[46];
    if(Math.abs(r[66]-previous[66])>2*steps||Math.abs(r[67]-previous[67])>2*steps)
      metrics.slewBoundExceededAcrossSampleInterval++;
  }
  const s=metrics.sameStateLearningReplay;
  s.frames=motion.length;s.oldMean=s.oldLearningSum/s.frames;s.newMean=s.newLearningSum/s.frames;
  s.oldFrozen_pct=100*s.oldFrozen/s.frames;s.newFrozen_pct=100*s.newFrozen/s.frames;
  results.push(metrics);
}
const groups=['A','B'].map(condition=>{
  const rs=results.filter(r=>r.id[0]===condition),sum=key=>rs.reduce((s,r)=>s+r[key],0);
  return {condition,totalCoreSteps:sum('totalCoreSteps'),totalWithdrawals:sum('totalWithdrawals'),
    totalContractions:sum('totalContractions'),motionIntervals:sum('motionIntervals'),
    intervalsWithWithdrawal:sum('intervalsWithWithdrawal'),intervalsWithContraction:sum('intervalsWithContraction'),
    pureEndpoints:sum('pureEndpoints'),pureEndpointsFollowingOtherConstraint:sum('pureEndpointsFollowingOtherConstraint'),
    sameStateLearningReplay:{frames:1200,
      oldFrozen_pct:rs.reduce((s,r)=>s+r.sameStateLearningReplay.oldFrozen,0)/12,
      newFrozen_pct:rs.reduce((s,r)=>s+r.sameStateLearningReplay.newFrozen,0)/12,
      oldMean:rs.reduce((s,r)=>s+r.sameStateLearningReplay.oldLearningSum,0)/1200,
      newMean:rs.reduce((s,r)=>s+r.sameStateLearningReplay.newLearningSum,0)/1200}};
});
const out={groups,results,limits:'Cumulative counters recover event totals, NOT timing/order inside 40-ms intervals. Pure at one endpoint does not imply pure constraints throughout the interval.'};
await fs.writeFile(path.join(dir,'history.json'),JSON.stringify(out,null,2),{flag:'wx'});
console.log(JSON.stringify(out,null,2));
