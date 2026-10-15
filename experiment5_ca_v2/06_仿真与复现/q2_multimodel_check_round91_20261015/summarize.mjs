import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
const dir=path.dirname(fileURLToPath(import.meta.url));
const read=n=>JSON.parse(fs.readFileSync(path.join(dir,n),'utf8'));
const sha=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const p=read('protocol.json'),capture=read('capture_verification.json'),names=['R82','R86','R90','R88'];
assert(capture.fullRecordingProtocolQualified&&capture.independentPythonFullDecodeCRCAndMetrics.passed);
const evaluations=names.map(name=>{
  const file=path.join(dir,`frozen_model_evaluation_${name}.json`),v=read(`frozen_model_evaluation_${name}.json`);
  assert.equal(v.modelLabel,name);assert.equal(v.sourceSHA256,capture.sourceSHA256);
  assert.equal(sha(v.source),v.sourceSHA256);assert.equal(sha(v.frozenModel),v.frozenModelSHA256);
  assert.equal(sha(path.join(dir,'evaluate_frozen.py')),v.scriptSHA256);
  assert.equal(v.preCaptureProtocolSHA256,sha(path.join(dir,'protocol.json')));
  assert(v.independentNumericalVerification.passed&&v.modelsRefitted===0&&!v.run07IncludedInTraining);
  assert.equal(v.provisionalAggregateScreen.trackingLimit_percent,15);assert.equal(v.provisionalAggregateScreen.syncLimit_percent,15);
  return {model:name,evaluation:file,evaluationSHA256:sha(file),frozenModelSHA256:v.frozenModelSHA256,
    comparisonRole:v.comparisonRole,nativeMetrics:v.nativeMetrics,screen:v.provisionalAggregateScreen,
    waveformDiagnostics:v.nativeWaveformErrors,phaseComparison:v.phaseErrors,
    finalTrackingError_mm:{actual:v.actualReturnHoldFinalTrackingError_mm,modeled:v.returnHoldFinalTrackingError_mm},
    numericalVerification:v.independentNumericalVerification};
});
assert.equal(sha(p.modelParameters),p.frozenModelSHA256);
const out={date:'2026-10-15',record:'Q2_run07',source:p.newRawPath,sourceSHA256:capture.sourceSHA256,
  captureQualified:true,sessions:1,nativeSamples:400,missingCSVFrames:0,fault:0,CRC32:capture.CRC32,
  movingSnapshotRows:8000,holdingSnapshotRows:300,completionTail_s:capture.completionTail_s,
  preCaptureProtocolSHA256:sha(path.join(dir,'protocol.json')),prospectiveCandidate:'R90',preCaptureComparator:'R88',
  additionalComparatorsRequestedByUserAfterCapture:['R82','R86'],modelSelectedFromRun07Outcome:false,
  actualTrackingRMSE_mm:capture.metrics.trackingRMSE_mm,actualSyncRMS_mm:capture.metrics.syncRMS_mm,
  thresholds:p.provisionalAggregateThresholds,evaluations,
  independentPythonSteps:80000,modelsRefitted:0,run07UsedForCalibration:false,
  rawAllFrozenModelsAndFirmwareUnchanged:true,aggregateScreenPassed:false,
  conclusion:'All four frozen models pass15percent synchronization RMS screening but fail15percent tracking RMS screening on this independently captured record. Requested R82/R86/R90 tracking relative differences are29.99/27.07/27.21percent. R90 does not demonstrate a material gain over R86. Waveform correlation is diagnostic only, not a rejection criterion.',
  scope:'Same observed400point window, previous queued-input forced replay and holding40step means retained; not autonomous closed-loop simulation or control-method performance comparison.',
  nextRecommendedStep:'Preserve this negative test. No further identical capture or automatic refit authorized. Prioritize existing-record diagnosis of holding/input/execution representation instead of choosing a favorable record or model after testing.',
  newPhysicalRunReleased:false,assistantHardwareAction:false};
fs.writeFileSync(path.join(dir,'comparison_summary.json'),JSON.stringify(out,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({summarySHA256:sha(path.join(dir,'comparison_summary.json')),
  actual:[out.actualTrackingRMSE_mm,out.actualSyncRMS_mm],models:evaluations.map(v=>({model:v.model,
  trackingPrediction:v.nativeMetrics.modeledTrackingRMSE_mm,syncPrediction:v.nativeMetrics.modeledSyncRMS_mm,
  trackingError_percent:v.nativeMetrics.trackingRelativeDifference_percent,syncError_percent:v.nativeMetrics.syncRelativeDifference_percent,
  passed:v.screen.passed,returnHold:v.phaseComparison.find(x=>x.phase===5)}))},null,2));
