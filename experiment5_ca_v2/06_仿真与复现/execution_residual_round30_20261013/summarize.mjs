import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';
const dir=path.dirname(fileURLToPath(import.meta.url)),out=path.join(dir,'checks02'),summary=JSON.parse(fs.readFileSync(path.join(out,'verification.json')));
const names=['BLNN','S3R2','RES_0_K5','RES_1_K5','RES_2_K5','RES_0_K20','RES_1_K20','RES_2_K20'];
const all=names.map(name=>({name,rows:JSON.parse(fs.readFileSync(path.join(out,name+'.json'))).filter(r=>r.type==='result')}));
const mean=(a,key)=>a.reduce((s,r)=>s+r[key],0)/a.length;
const baseline=all[1],ordinary=all[0],primaryCases=baseline.rows.filter((r,i)=>r.complete&&ordinary.rows[i].complete).map(r=>r.case);
summary.primaryComparisons=all.slice(2).map(v=>{
 const failed=v.rows.filter(r=>primaryCases.includes(r.case)&&!r.complete).map(r=>r.case);
 const ids=primaryCases.filter(id=>v.rows.find(r=>r.case===id).complete);
 const a=v.rows.filter(r=>ids.includes(r.case)),b=baseline.rows.filter(r=>ids.includes(r.case)),o=ordinary.rows.filter(r=>ids.includes(r.case));
 return{name:v.name,baselineCompletedCases:primaryCases.length,newFailures:failed,performanceOnlyOnCompletedOverlap:failed.length>0,n:ids.length,track:mean(a,'partialTrackingRMSE_mm'),sync:mean(a,'partialSyncRMS_mm'),trackingChangeVsR2_pct:100*(mean(a,'partialTrackingRMSE_mm')/mean(b,'partialTrackingRMSE_mm')-1),syncChangeVsR2_pct:100*(mean(a,'partialSyncRMS_mm')/mean(b,'partialSyncRMS_mm')-1),syncChangeVsBLNN_pct:100*(mean(a,'partialSyncRMS_mm')/mean(o,'partialSyncRMS_mm')-1),casesWithSyncBenefitVsR2:a.filter((r,i)=>r.partialSyncRMS_mm<b[i].partialSyncRMS_mm).length,qualifiedForFurtherOfflineCheck:failed.length===0&&mean(a,'partialSyncRMS_mm')<mean(b,'partialSyncRMS_mm')};
});
summary.exploratorySelection='RES_0_K5 selected for fixed independent sensitivity checks, not firmware release: largest primary30-case mean synchronization gain among no-new-failure branches, with tracking cost and benefit in only13/30 cases. Other mildly improving branches are retained, not claimed nonexistent.';
summary.firstTestAttempt='checks01 stopped at a harness error: ordinary BLNN requires its existing outer finalize speed guard. Corrected harness applied original finalize for every method; no controller guard relaxed.';
fs.writeFileSync(path.join(out,'verification.json'),JSON.stringify(summary,null,2));console.log(JSON.stringify(summary.primaryComparisons,null,2));
