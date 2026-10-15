import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
const dir=path.dirname(fileURLToPath(import.meta.url)),result=JSON.parse(fs.readFileSync(path.join(dir,'audit_complete.json'),'utf8'));
const data=JSON.parse(fs.readFileSync(result.sources.decoded,'utf8'));
const sha=f=>crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
assert.equal(sha(result.sources.raw),result.sources.rawSHA256);assert.equal(sha(result.sources.decoded),result.sources.decodedSHA256);
const pitch=data.header.configured_meters_per_count,mpr=pitch*8192/60;
for(const [phase,start,end,anchor]of [[2,0,4000,99],[4,4000,8000,149]]){
 const r=result.lowSpeedMeasurementAudit.find(x=>x.phase===phase),origin=data.slow[anchor];let prior=origin.actual_us;const impulse=[0,0];
 for(const f of data.fast.slice(start,end)){const dt=(f.actual_us-prior)*1e-6;for(let ch=0;ch<2;ch++)impulse[ch]+=f.rpm[ch]*mpr*dt;prior=f.actual_us;}
 for(let ch=0;ch<2;ch++){
  const encoder=(data.fast[end-1].encoder[ch]-origin.encoder[ch])*pitch;
  assert(Math.abs(encoder*1000-r.integratedRawEncoderDisplacement_mm[ch])<1e-10);
  assert(Math.abs(impulse[ch]*1000-r.integratedRawRPMDisplacement_mm[ch])<1e-10);
  assert(Math.abs((encoder-impulse[ch])*1000-r.rawEncoderMinusRPMDisplacement_mm[ch])<1e-10);
 }
}
let previous=[0,0];const observed={};
for(let n=0;n<data.slow.length;n++){
 if(n===100)previous=[...data.fast[3999].encoder];if(n===150)previous=[...data.fast[7999].encoder];
 const r=data.slow[n];observed[r.phase]??={rows:0,both:0,nonzero:[0,0]};const o=observed[r.phase];o.rows++;
 if(r.encoder.every((v,ch)=>v===previous[ch]))o.both++;
 for(let ch=0;ch<2;ch++)if(r.encoder[ch]===previous[ch]&&Math.abs(r.command_integral_counts_us[ch]/r.dt_us)>1)o.nonzero[ch]++;
 previous=[...r.encoder];
}
for(const r of result.holdEndpointCommandAudit){assert.equal(observed[r.phase].rows,r.rows);assert.equal(observed[r.phase].both,r.bothEndpointsUnchangedRows);assert.deepEqual(observed[r.phase].nonzero,r.nonzeroMeanCommandWithUnchangedEndpointRows);}
assert(result.modelsFitted===0&&!result.rootCauseConfirmed&&!result.modelClosureComplete&&!result.newPhysicalRunReleased);
assert(result.weakRegressorRank.normalizedRank===8&&result.weakRegressorRank.rows===156&&result.weakRegressorRank.fullRankNotCausalOrPhysicalIdentification);
const checked={date:'2026-10-15',independentJSDisplacementIntegralAndHoldingCountsPassed:true,sourceHashesUnchanged:true,fullRankIsNotIdentification:true,rawRPMSideBiasObservedNotItsCauseProven:true,stictionOrDeliveryHypothesisNotCalibrated:true,modelsFitted:0,controllerChanged:false,newPhysicalCaptureReleased:false,modelClosureComplete:false,auditSHA256:sha(path.join(dir,'audit_complete.json'))};
fs.writeFileSync(path.join(dir,'verification.json'),JSON.stringify(checked,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(checked,null,2));
