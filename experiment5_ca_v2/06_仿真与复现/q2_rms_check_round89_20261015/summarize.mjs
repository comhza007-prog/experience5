import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
const dir=path.dirname(fileURLToPath(import.meta.url));
const read=n=>JSON.parse(fs.readFileSync(path.join(dir,n),'utf8'));
const sha=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const a=read('rms_only_run06_addendum.json'),capture=read('capture_verification.json');
const newer=read('frozen_model_evaluation_R88.json'),older=read('frozen_model_evaluation_R86.json');
assert.equal(newer.modelLabel,'R88');assert.equal(older.modelLabel,'R86');
assert.equal(newer.sourceSHA256,older.sourceSHA256);assert.equal(sha(a.rawPath),newer.sourceSHA256);
assert.equal(sha(a.modelParameters),a.frozenModelSHA256);assert.equal(sha(a.comparatorModel),a.comparatorModelSHA256);
assert.equal(sha(path.join(dir,'rms_only_run06_addendum.json')),newer.rmsOnlyAddendumSHA256);
assert(capture.fullRecordingProtocolQualified&&capture.independentPythonFullDecodeCRCAndMetrics.passed);
for(const x of [newer,older])assert(x.independentNumericalVerification.passed&&!x.run06IncludedInTraining&&x.modelsRefitted===0);
const out={date:'2026-10-15',record:'Q2_run06',source:a.rawPath,sourceSHA256:newer.sourceSHA256,
  captureQualified:true,fault:0,missingCSVFrames:0,nativeSamples:400,movingSnapshotRows:8000,holdingSnapshotRows:300,
  CRC32:capture.CRC32,completionTail_s:capture.completionTail_s,
  addendumSHA256:sha(path.join(dir,'rms_only_run06_addendum.json')),
  evaluations:[{model:'R88',path:path.join(dir,'frozen_model_evaluation_R88.json'),sha256:sha(path.join(dir,'frozen_model_evaluation_R88.json'))},
               {model:'R86',path:path.join(dir,'frozen_model_evaluation_R86.json'),sha256:sha(path.join(dir,'frozen_model_evaluation_R86.json'))}],
  R88Metrics:newer.nativeMetrics,R86Metrics:older.nativeMetrics,
  R88ProvisionalAggregateScreen:newer.provisionalAggregateScreen,R86ProvisionalAggregateScreen:older.provisionalAggregateScreen,
  R88WaveformErrorsDiagnosticOnly:newer.nativeWaveformErrors,R86WaveformErrorsDiagnosticOnly:older.nativeWaveformErrors,
  phaseComparison:newer.phaseErrors.map(x=>({phase:x.phase,samples:x.samples,
    actualTrackingRMSE_mm:x.actualTrackingRMSE_mm,R88TrackingRMSE_mm:x.modeledTrackingRMSE_mm,
    R86TrackingRMSE_mm:older.phaseErrors.find(y=>y.phase===x.phase).modeledTrackingRMSE_mm,
    actualSyncRMS_mm:x.actualSyncRMS_mm,R88SyncRMS_mm:x.modeledSyncRMS_mm})),
  independentPythonSteps:40000,modelsRefitted:0,run06UsedForTraining:false,allRawParametersAndFirmwareUnchanged:true,
  conclusion:'Both declared models fail the pre-capture provisional RMS-only screen because tracking exceeds10percent; synchronization is within15percent. Waveform correlation is diagnostic only and is not a rejection reason. R88 and R86 predictions remain nearly identical; reduced parameter freedom has not resolved the aggregate tracking mismatch.',
  localization:'Return-hold phase5 trackingRMS actual0.015105 vsR88prediction0.116585mm; target-hold actual0.055203 vsprediction0.005209mm. These are model-output discrepancies, not identification of mechanical or motor cause.',
  physicalModelValidationDeclaredPassed:false,controlMethodBenefitProven:false,
  nextRecommendedStep:'No further identical capture automatically. Diagnose holding-segment input approximation/execution dynamics using existing data. Motor-response logging remains paused unless user resumes it; any refit or controller/logging changes require a new scoped request. Preserve this before-fit independent test.',
  newPhysicalRunReleased:false,assistantHardwareAction:false};
fs.writeFileSync(path.join(dir,'comparison_summary.json'),JSON.stringify(out,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({summarySHA256:sha(path.join(dir,'comparison_summary.json')),captureQualified:true,
  R88Metrics:out.R88Metrics,R88Screen:out.R88ProvisionalAggregateScreen,modelsRefitted:0},null,2));
