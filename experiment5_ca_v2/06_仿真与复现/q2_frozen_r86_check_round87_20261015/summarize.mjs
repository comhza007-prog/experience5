import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
const dir=path.dirname(fileURLToPath(import.meta.url));
const read=n=>JSON.parse(fs.readFileSync(path.join(dir,n),'utf8'));
const sha=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const p=read('protocol.json'),capture=read('capture_verification.json');
const newer=read('frozen_model_evaluation_R86.json'),older=read('frozen_model_evaluation_R82.json');
assert.equal(newer.modelLabel,'R86');assert.equal(older.modelLabel,'R82');
assert.equal(newer.sourceSHA256,older.sourceSHA256);assert.equal(sha(p.newRawPath),newer.sourceSHA256);
assert.equal(sha(newer.frozenModel),p.frozenModelSHA256);assert.equal(sha(older.frozenModel),older.frozenModelSHA256);
assert.equal(sha(path.join(dir,'protocol.json')),newer.preCaptureProtocolSHA256);
assert.equal(sha(p.previousR82FrozenEvaluation),p.previousR82FrozenEvaluationSHA256);
assert(capture.fullRecordingProtocolQualified&&capture.independentPythonFullDecodeCRCAndMetrics.passed);
for(const x of [newer,older])assert(x.independentNumericalVerification.passed&&!x.run05IncludedInTraining&&x.modelsRefitted===0);
const taskError=(x,metric)=>Math.abs(x.nativeMetrics['modeled'+metric]-x.nativeMetrics['actual'+metric]);
const comparisons=['TrackingRMSE_mm','SyncRMS_mm'].map(metric=>({metric,
  actual:newer.nativeMetrics['actual'+metric],R82:older.nativeMetrics['modeled'+metric],R86:newer.nativeMetrics['modeled'+metric],
  absolutePredictionErrorR82:taskError(older,metric),absolutePredictionErrorR86:taskError(newer,metric),
  absolutePredictionErrorReduction_percent:100*(1-taskError(newer,metric)/taskError(older,metric))}));
const out={date:'2026-10-15',record:'Q2_run05',source:p.newRawPath,sourceSHA256:newer.sourceSHA256,
  captureQualified:true,fault:0,missingCSVFrames:0,nativeSamples:400,movingSnapshotRows:8000,holdingSnapshotRows:300,
  CRC32:capture.CRC32,completionTail_s:capture.completionTail_s,
  evaluations:[{model:'R82',path:path.join(dir,'frozen_model_evaluation_R82.json'),sha256:sha(path.join(dir,'frozen_model_evaluation_R82.json'))},
               {model:'R86',path:path.join(dir,'frozen_model_evaluation_R86.json'),sha256:sha(path.join(dir,'frozen_model_evaluation_R86.json'))}],
  comparisons,R82Metrics:older.nativeMetrics,R86Metrics:newer.nativeMetrics,
  R82WaveformErrors:older.nativeWaveformErrors,R86WaveformErrors:newer.nativeWaveformErrors,
  independentPythonSteps:40000,modelsRefitted:0,run05UsedForTraining:false,allRawParametersAndFirmwareUnchanged:true,
  conclusion:'Both scalar RMS predictions are relatively close, but R86 improves tracking and slightly worsens sync relative to frozen R82 on this held-out run. Sync waveform prediction remains weak (R86 correlation0.1329, waveformRMSE0.05219mm). This does not demonstrate uniformly improved modeling or autonomous closed-loop predictive validity.',
  remainingPhaseMismatch:'R86 target-hold tracking RMS0.003118 vsactual0.047975mm; return-hold tracking0.083039 vsactual0.020232mm. Aggregate tracking RMS closeness conceals these discrepancies.',
  predeclaredApplicationTolerance:false,physicalCauseIdentified:false,physicalModelValidationDeclaredPassed:false,
  modelSelectedFromRun05Outcome:false,newPhysicalRunReleased:false,assistantHardwareAction:false,
  nextRecommendedStep:'Pause identical repeat acquisition. Diagnose systematic holding and differential-waveform mismatch using existing data. Any subsequent refit must retain this before-fit test and treat run05 as calibration thereafter.',
  analysisLabelBug:'Initial evaluator reused the model label variable while packing inputs. This affected output filenames/modelLabel only, not theta or rollout. Debug artifacts and original script retained; label fixed, both declared evaluations independently rerun and verified.'};
fs.writeFileSync(path.join(dir,'comparison_summary.json'),JSON.stringify(out,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({comparisons,summarySHA256:sha(path.join(dir,'comparison_summary.json')),captureQualified:true,modelsRefitted:0},null,2));
