// Existing-data diagnostic. No fitting, parameter tuning or hardware action.
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';
import crypto from 'node:crypto';import {fileURLToPath} from 'node:url';
const here=path.dirname(fileURLToPath(import.meta.url)),root=path.resolve(here,'../..');
const read=f=>JSON.parse(fs.readFileSync(f,'utf8'));
const sha=f=>crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const mean=a=>a.reduce((s,x)=>s+x,0)/a.length;
const rms=a=>Math.sqrt(mean(a.map(x=>x*x)));
const range=a=>[Math.min(...a),Math.max(...a)];
const distribution=a=>{const s=[...a].sort((x,y)=>x-y);return {N:a.length,mean:mean(a),median:s.length%2?s[(s.length-1)/2]:(s[s.length/2-1]+s[s.length/2])/2,range:range(a)};};
const earlier=path.join(root,'06_仿真与复现/error_summary_40s_followup_round55_20261014/all_attempts_analysis_final.json');
const prior=read(earlier),physical=[];
// Configured kinematics, not an independently measured carriage sensor.
const mmPerRpmPerSecond=1000*2*Math.PI*.03/(19*60);
for(const p of prior.results){
  assert.equal(sha(p.source),p.sourceSHA256);
  const raw=fs.readFileSync(p.source,'utf8').replace(/^\uFEFF/,'').trim().split(/\r?\n/).slice(1).map(l=>l.split(',').map(Number));
  const seg=p.allSessionSegments.find(s=>s.containsActive),rows=raw.slice(seg.firstLine-2,seg.lastLine-1);
  const phases=[2,3,4,5].map(phase=>{
    const rr=rows.filter(r=>r[106]===1&&r[2]===phase);
    const e=rr.map(r=>1000*((r[5]+r[6])/2-r[3])),s=rr.map(r=>1000*(r[5]-r[6]));
    return {phase,N:rr.length,trackingRMSE_mm:rms(e),syncRMS_mm:rms(s),
      rawRPM_RMS:[80,81].map(c=>rms(rr.map(r=>r[c]))),
      commandRMS_counts:[13,14].map(c=>rms(rr.map(r=>r[c]))),feedbackCurrentRMS_counts:[15,16].map(c=>rms(rr.map(r=>r[c]))),
      commandPeak_counts:[13,14].map(c=>Math.max(...rr.map(r=>Math.abs(r[c])))),
      positionRange_mm:[5,6].map(c=>range(rr.map(r=>1000*r[c]))),
      speedGuardObservedSnapshots:rr.filter(r=>r[86]!==0).length,
      maxCANAge_ms:[47,48].map(c=>Math.max(...rr.map(r=>r[c])))};
  });
  const late=rows.filter(r=>r[106]===1&&r[2]===5&&r[79]>=18),last=rows.filter(r=>r[106]===1).at(-1);
  const width=p.method==='BLNN'?5:6,magic=p.method==='BLNN'?4422:4424,chunks=new Map();
  rows.filter(r=>r[88]===magic).forEach(r=>chunks.set(r[90]+':'+r[91],r.slice(96,104)));
  assert(p.event.complete);const ev=Array.from({length:128},(_,i)=>Array.from({length:width},(_,c)=>{assert(chunks.has(i+':'+c));return chunks.get(i+':'+c);}).flat());
  for(let i=1;i<ev.length;i++)assert.equal(ev[i][0]-ev[i-1][0],1);
  const eventAxes=[0,1].map(ch=>{
    const sign=ch?-1:1;let integral=0,periodIntegral=0;
    for(let i=1;i<ev.length;i++){
      const rpm=.5*(ev[i-1][2+ch]+ev[i][2+ch]);
      integral+=sign*mmPerRpmPerSecond*rpm*.001;
      periodIntegral+=sign*mmPerRpmPerSecond*rpm*ev[i][31]*1e-6;
    }
    const encoderDisplacement=1000*(ev.at(-1)[4+ch]-ev[0][4+ch]);
    return {axis:ch,encoderEndpointDisplacement_mm:encoderDisplacement,
      nominal1msTrapezoidRPMDisplacement_mm:integral,periodAdjustedTrapezoidRPMDisplacement_mm:periodIntegral,
      nominalIntegralMinusEncoder_mm:integral-encoderDisplacement,
      periodAdjustedIntegralMinusEncoder_mm:periodIntegral-encoderDisplacement,
      rawRPMRange:range(ev.map(e=>e[2+ch])),feedbackAgeRange_ms:range(ev.map(e=>e[29+ch])),
      repeatedRXCounterPairs:ev.slice(1).filter((e,i)=>e[27+ch]===ev[i][27+ch]).length,
      repeatedRoundedPositionPairs:ev.slice(1).filter((e,i)=>e[4+ch]===ev[i][4+ch]).length};
  });
  physical.push({method:p.method,attempt:p.attempt,source:p.source,SHA256:p.sourceSHA256,primaryComplete:p.completeCSVPrimaryWindow,
    phaseStatisticsAreObservedSnapshots:true,phases,
    lateOriginHold:{N:late.length,elapsed_s:range(late.map(r=>r[79])),meanPositionRMS_mm:rms(late.map(r=>500*(r[5]+r[6]))),
      syncRMS_mm:rms(late.map(r=>1000*(r[5]-r[6]))),commandRMS_counts:[13,14].map(c=>rms(late.map(r=>r[c]))),
      rawRPM_RMS:[80,81].map(c=>rms(late.map(r=>r[c])))},
    lastActivePosition_mm:last.slice(5,7).map(x=>1000*x),motionBatteryRange_V:p.environment.motionBatteryRange_V,
    event:{elapsed_ms:range(ev.map(e=>e[0])),nominalInterval_ms:1,periodRange_us:range(ev.map(e=>e[31])),axes:eventAxes,
      samplingAndCANSkewNotRemoved:true,notContinuousFullRunCoverage:true,notMatchedBetweenMethods:true}});
  assert.equal(sha(p.source),p.sourceSHA256);
}
const evidenceFile=path.join(root,'06_仿真与复现/final_method_evidence_round56_20261014/evidence_verification.json'),evidence=read(evidenceFile);
const model=[];
for(const method of ['BLNN','S3R2']){
  const file=path.join(root,'06_仿真与复现/final_method_evidence_round56_20261014/checks02',method+'_float.json'),data=read(file);
  const ids=evidence.summaries.find(r=>r.precision==='float'&&r.variant===method).fixedComparisonPopulationCaseIDs;
  const cases=ids.map(id=>{
    const start=data.find(r=>r.type==='start'&&r.case===id),result=data.find(r=>r.type==='result'&&r.case===id);assert(result.complete);
    const phase5=data.filter(r=>r.type==='trace'&&r.case===id&&r.phase===5),late=phase5.filter(r=>r.t>=18);
    const moving=data.filter(r=>r.type==='trace'&&r.case===id&&r.phase>=2&&r.phase<=5);
    const err=rr=>rms(rr.map(r=>(r.positions_mm[0]+r.positions_mm[1])/2-r.ref_mm));
    const sync=rr=>rms(rr.map(r=>r.positions_mm[0]-r.positions_mm[1]));
    assert.equal(phase5.length,150);assert.equal(late.length,50);
    const q=x=>Math.sign(x)*Math.floor(Math.abs(x)*1000+.5)/1000;
    const quantized=moving.map(r=>{const p=r.positions_mm.map(q);return [(p[0]+p[1])/2-q(r.ref_mm),p[0]-p[1]];});
    return {case:id,massAxisAssumed:start.massAxis,frictionCountsAssumed:start.friction_counts,delay_ms:start.delay_ms,rightLimit:start.right_limit,
      whole40msTrackingRMSE_mm:rms(quantized.map(e=>e[0])),whole40msSyncRMS_mm:rms(quantized.map(e=>e[1])),
      originHoldTrackingRMSE_mm:err(phase5),originHoldSyncRMS_mm:sync(phase5),lateOriginMeanPositionRMS_mm:err(late),lateOriginSyncRMS_mm:sync(late),
      lateCommandRMS_counts:[0,1].map(ch=>rms(late.map(r=>r.commands[ch]))),terminalMax_mm:result.terminalMax_mm};
  });
  const sameLimit=cases.filter(r=>r.rightLimit===1200);
  model.push({method,source:file,SHA256:sha(file),conditionalPopulationN:ids.length,all36FailureOutcomesPreviouslyRetained:true,cases,
    distributions:Object.fromEntries(['originHoldTrackingRMSE_mm','originHoldSyncRMS_mm','lateOriginMeanPositionRMS_mm','lateOriginSyncRMS_mm','terminalMax_mm'].map(k=>[k,distribution(cases.map(r=>r[k]))])),
    scenarioHasOnly1200_1200:sameLimit.map(r=>r.case),
    sameLimitDistributions:Object.fromEntries(['whole40msTrackingRMSE_mm','whole40msSyncRMS_mm','lateOriginMeanPositionRMS_mm','lateOriginSyncRMS_mm','terminalMax_mm'].map(k=>[k,distribution(sameLimit.map(r=>r[k]))]))});
}
const resolutionFile=path.join(root,'06_仿真与复现/identification_resolution_audit_round47_20261014/audit.json'),resolution=read(resolutionFile);
const physicalSyncBenefits=prior.comparison.filter(p=>p.completePairedCSV).map(p=>-p.S3R2_minus_BLNN.syncRMS_mm.absolute_mm);
const sameLimitComparison=Object.fromEntries(['whole40msTrackingRMSE_mm','whole40msSyncRMS_mm'].map(k=>{
  const b=model.find(r=>r.method==='BLNN').sameLimitDistributions[k].mean,s=model.find(r=>r.method==='S3R2').sameLimitDistributions[k].mean;
  return [k,{BLNN:b,S3R2:s,change_pct:100*(s/b-1)}];
}));
const report={physical,assumedModels:model,sameLimitComparison,
  sameLimitStillNotMatchedIdentifiedPlant:true,configuredKinematics:{radius_m:.03,gearRatio:19,encoderCPR:8192,mmPerRpmPerSecond},
  existingHighRateEvidence:{source:resolutionFile,SHA256:sha(resolutionFile),
    captured1msIntervals:resolution.capturedResolutionAudit.capturedFastIntervals,
    fullRun1msIntervals:resolution.capturedResolutionAudit.coreIntervalsTotal,
    fullRun1msCommandShapeAvailable:resolution.capturedResolutionAudit.fullRunOneMillisecondInputShapeAvailable,
    captured20msIntervalCommandRanges_counts:resolution.capturedResolutionAudit.maxCapturedWithinIntervalCommandRange_counts,
    sameT1InputCandidateModelSyncPredictionRangeRMS_mm:resolution.frozenModelSensitivity.sameInputSyncPredictionRangeRMS_mm,
    notIndependentValidation:true,notThe36AssumedModelPredictionError:true,
    recentMeasuredSyncRMSBenefits_mm:physicalSyncBenefits,
    diagnosticSpreadToBenefitScaleRatio:physicalSyncBenefits.map(x=>resolution.frozenModelSensitivity.sameInputSyncPredictionRangeRMS_mm/x),
    ratioIsIllustrativeNotFormalErrorBudgetOrStatisticalTest:true},
  modelAssumptionsNotIdentified:{massAxisValues:[3,6,9],staticFrictionCounts:[400,600],rightFrictionMultiplier:1.4,
    slidingFrictionFractionOfStatic:.2,couplingStiffnessAssumed:2000,couplingDampingAssumed:40,
    feedbackDelay_ms:[0,3,6],ESCspeedFilter_s:.003,currentDynamicsPerStepBlend:1/3,
    RPMNoise:'Deterministic+1every19steps',torqueCountToForceAssumed:.006197916666666667,
    missingSupplyVoltageAndMeasuredDriveTransfer:true,noIndependentCarriagePosition:true,
    frictionCountsDoNotRepresentCalibratedAmperes:true},
  boundaries:['Latehold stage comparison diagnoses modelbehavior only; not a new primary metric or a task tolerance.',
    'Encoder/RPM integration in128ms windows includes quantization,estimator dynamics and CAN age. Not evidence of the exact sensor error or a hardware fault.',
    'BLNN5s andS3R218s events are unmatched; no comparative cause claim.',
    '40ms samples cannot reconstruct arbitrary1ms actuation or current dynamics.',
    'No fitting or selecting a model on either favourable physical comparison. No new models or tests requested.'],
  noParametersChanged:true,noModelsFitted:true,noFirmwareChanged:true,noRawChanged:true,noHardwareAction:true,
  controllerDirectionUnchanged:true,auditSHA256:sha(fileURLToPath(import.meta.url))};
fs.writeFileSync(path.join(here,'mismatch_diagnosis_complete.json'),JSON.stringify(report,null,2),{flag:'wx'});
console.log(JSON.stringify({physicalLateHold:physical.map(r=>({method:r.method,attempt:r.attempt,complete:r.primaryComplete,late:r.lateOriginHold})),
  sameLimitComparison,modelSameLimitLateHold:model.map(r=>({method:r.method,caseIDs:r.scenarioHasOnly1200_1200,
  meanPosition:r.sameLimitDistributions.lateOriginMeanPositionRMS_mm,sync:r.sameLimitDistributions.lateOriginSyncRMS_mm})),
  olderTrainingOnlyModelSpread:report.existingHighRateEvidence},null,2));
