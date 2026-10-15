import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
const dir=path.dirname(fileURLToPath(import.meta.url)),root=path.resolve(dir,'../..');
const sha=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const prior=path.join(root,'06_仿真与复现/cumulative_micro_round86_20261015');
const old=JSON.parse(fs.readFileSync(path.join(prior,'protocol.json'),'utf8'));
const source=path.join(prior,'model_parameters.json');assert.equal(sha(source),'b5fa79668e254f166c765a8444fd79733625633dc0e4ac8147e0c891da96580a');
const model=JSON.parse(fs.readFileSync(source,'utf8'));
const previous=path.join(root,'06_仿真与复现/q2_frozen_r86_check_round87_20261015/comparison_summary.json');
assert.equal(sha(previous),'199eef874364e9ca3a859a6c7aa1567b7a167599d447cf818e6dbd24ebba979a');
const p={...old,authorization:'User requests trying reduced-dependence-on-single-mechanical-state modeling, then one manual new capture. Offline parameter changes only; no controller changes or assistant hardware operation.',
  sourceModel:'cumulative_micro_round86_20261015/model_parameters.json',sourceModelSHA256:sha(source),initialParameters:model.parameters,
  records:[...old.records,{name:'Q2_run05',decoded:'q2_frozen_r86_check_round87_20261015/capture_analysis.json',rawSHA256:'1a2901e72e3430f86212668ad8ee9c7883d7cd6fef7d43023cd8b9e0f1a8eb00',prefixRows:0,nativeSamples:400}],
  recordWeights:[.2,.2,.2,.2,.2],observedNativeSamples:[400,400,399,400,400],
  fixedCoreIndices:[2,3,4,5,8],freeIndices:[0,1,6,7,9,10],
  fixedCoreRationale:'Keep R86 numerical nominal damping, elastic/damping coupling and inertia coupling fixed. These are not independently identified physical constants. This changes estimation freedom, not physical plant coupling strength.',
  localRelativeBound:.1,localEtaAbsoluteBound:.02,
  optimizer:{method:'One deterministic bounded Nelder-Mead seed per declared scheme, normalized local-radius coordinates',maximumEvaluations:700,maximumIterations:500,initialStep:.1},
  schemes:[{label:'full11_control',freeIndices:[0,1,2,3,4,5,6,7,8,9,10],driftPenaltyWeight:0},
           {label:'stable6_regularized',freeIndices:[0,1,6,7,9,10],driftPenaltyWeight:.25}],
  driftPenalty:'weight*mean((parameter deviation/local radius)^2), centered on R86; no per-record adjustment. The reduced scheme combines fixing core and drift regularization, not separate independent ablations.',
  objective:'Same full-record mean/differential waveform and task RMS loss terms as R86, equal weights across five records, plus declared drift penalty for reduced scheme. Report before/after every record. Full11 matched data/budget/bounds is diagnostic comparator, not a guaranteed global optimum.',
  candidateEligibility:'Reduced scheme cumulative unpenalized loss must not exceed unchanged R86, and no individual unpenalized record loss may exceed its R86 baseline by10percent. This is a screening guard, not physical model acceptance. Preserve failure and do not expand trials to force passing.',
  inputLimitations:'Recorded queued commands, not delivered torque; holding40step means retained. No residual model/noise realization/output correction added. Mechanical uncertainty ranges are not identified by this exercise.',
  oldIndependentTestSummary:previous,oldIndependentTestSummarySHA256:sha(previous),
  previousHoldoutResult:'q2_frozen_r86_check_round87_20261015/comparison_summary.json',
  run05UsedForCalibration:true,run06UsedForCalibration:false,
  newPhysicalTest:'One unchanged manual Q2run06 after reduced candidate frozen and numerically verified. Not formal batch. Evaluate candidate and frozen R86 before any refit.',
  proposedFutureScreenOnly:{syncCorrelationMinimum:.8,syncWaveformRMSEOverActualRMSMaximum:.5,syncTaskRMSRelativeErrorMaximum:.15,
    status:'Proposed engineering screening values from discussion; not a universal standard or sufficient closed-loop/control-benefit validation.'},
  newPhysicalRunReleased:false,assistantHardwareAction:false};
fs.writeFileSync(path.join(dir,'protocol.json'),JSON.stringify(p,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({protocolSHA256:sha(path.join(dir,'protocol.json')),records:5,fixed: p.fixedCoreIndices,free:p.freeIndices}));
