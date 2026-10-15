import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
const dir=path.dirname(fileURLToPath(import.meta.url)),root=path.resolve(dir,'../..');
const sha=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const prior=path.join(root,'06_仿真与复现/stable_core_round88_20261015');
const old=JSON.parse(fs.readFileSync(path.join(prior,'protocol.json'),'utf8'));
const source=path.join(prior,'model_parameters.json');assert.equal(sha(source),'d02d8d331321c39e4196b3016a4dfe0c4c91edfe6aa0a0d9d94abd4098f8e0ca');
const model=JSON.parse(fs.readFileSync(source,'utf8'));
const previous=path.join(root,'06_仿真与复现/q2_rms_check_round89_20261015/comparison_summary.json');
assert.equal(sha(previous),'69af68be1d6b6962adf223270a3022822d091fe36d091b74945812efc99689aa');
const p={...old,authorization:'User explicitly requests cumulative small parameter refinement based on run06, future tracking/sync tolerances both15percent, then one new manual capture. Preserve prior10/15percent run06 failure; no retroactive reclassification.',
  sourceModel:'stable_core_round88_20261015/model_parameters.json',sourceModelSHA256:sha(source),initialParameters:model.parameters,
  records:[...old.records,{name:'Q2_run06',decoded:'q2_rms_check_round89_20261015/capture_analysis.json',rawSHA256:'170186d20947fc3fe622b020d454a72f559ff8ea1b133a9146f5d4717fb19fc6',prefixRows:0,nativeSamples:400}],
  recordWeights:Array(6).fill(1/6),observedNativeSamples:[400,400,399,400,400,400],
  fixedCoreRationale:'R88 nominal core remains fixed exactly. Six drive/friction parameters share one set across all six calibration records; no newly introduced dynamics, correction, excitation or control changes.',
  localParameterBounds:'Six free positive parameters within10percent of frozenR88; five core parameters fixed.',
  optimizer:{...old.optimizer,maximumEvaluations:900,maximumIterations:650},
  schemes:[{label:'stable6_regularized',freeIndices:[0,1,6,7,9,10],driftPenaltyWeight:.25}],
  driftPenalty:'Same weight0.25*mean(normalizedLocalDeviationSquared) as R88, now centered on frozenR88. Acceptance tolerance is not an objective term.',
  objective:'Same R88 waveform and task-RMS loss terms with equal weights across six retained calibration records, plus same local drift penalty. No outcomes removed; old limitations retained. No guarantee of convergence to global optimum or new-record passage.',
  candidateEligibility:'Cumulative unpenalized loss no worse than unchangedR88 and no single-record data loss more than10percent worse. This numerical guard is separate from future15/15percent provisional aggregate acceptance.',
  oldIndependentTestSummary:previous,oldIndependentTestSummarySHA256:sha(previous),
  previousHoldoutResult:'q2_rms_check_round89_20261015/comparison_summary.json',
  run06UsedForCalibration:true,run07UsedForCalibration:false,
  proposedFutureScreenOnly:{trackingTaskRMSRelativeErrorMaximum:.15,syncTaskRMSRelativeErrorMaximum:.15,waveformIsHardGate:false,status:'User-requested prospective engineering tolerance for run07; not a universal standard or full-model validation.'},
  priorRun06TrackingToleranceRemains:.10,priorRun06SyncToleranceRemains:.15,priorRun06FailureRetained:true,
  newPhysicalTest:'One unchanged manual Q2run07 after new offline parameters frozen. Empty2mm,1200/1200,no new perturbation, protections unchanged. Evaluate R90 and declaredR88 before refit.',
  newPhysicalRunReleased:false,assistantHardwareAction:false};
fs.writeFileSync(path.join(dir,'protocol.json'),JSON.stringify(p,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({records:6,oldFailureRetained:true,futureTolerances:[.15,.15],protocolSHA256:sha(path.join(dir,'protocol.json'))}));
