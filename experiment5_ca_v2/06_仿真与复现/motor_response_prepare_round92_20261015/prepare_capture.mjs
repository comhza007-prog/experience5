import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
const dir=path.dirname(fileURLToPath(import.meta.url)),root=path.resolve(dir,'../..');
const sha=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const v=JSON.parse(fs.readFileSync(path.join(dir,'verification.json'),'utf8'));
assert(v.compileErrors===0&&v.compileWarnings===0&&v.RAM.remaining>=3072&&v.AXFHEXByteExact);
assert.equal(sha(v.hex),v.hexSHA256);
const raw=path.join(root,'01_原始数据/电机响应M1_20261015/E5ID_M1_BLNN_B68212_HW6_L1200_R1200_M0g_S2mm_run01.csv');assert(!fs.existsSync(raw));
const p={date:'2026-10-15',authorization:'User requests testing motor performance and using observations to improve simulation parameters. This releases ONE operator-run admission record only, not automatic hardware operation or additional excitation.',
 project:v.project,target:v.target,hex:v.hex,hexSHA256:v.hexSHA256,sourceHashes:v.sourceHashes,
 verification:path.join(dir,'verification.json'),verificationSHA256:sha(path.join(dir,'verification.json')),
 build:68212,schema:4501,magic:4446,ABI:4,telemetryChannels:107,
 rawPath:raw,rawAbsentAtPreparation:true,manualRunsAuthorized:1,manualRunsCollected:0,
 scope:'Same ordinaryBLNN/HW6,empty2mm out/back,1200/1200limits,one boot-start attempt after8s. No controller/trajectory/guard/voltage-threshold change. Operator remains responsible for physical safety and emergency stop. No automatic repeat.',
 intent:'Identify effective queued-command to ESC-current-feedback response and characterize left/right differences, input representation and battery covariation. Not a full unloaded-motor bench test, torque calibration or saturated-performance test.',
 records:{fineRows:1800,fineCadence_ms:1,fineStepWindows:[[0,200],[3800,4200],[7800,8200],[9800,10200],[13800,14200]],
   coarseRows:910,coarseCadence_ms:20,coarseCommandIntegralsExact:true,allControlIntervals:20000,blobBytes:83872,chunkCount:874,copiesPerChunk:4},
 recordedFields:['actual_us','interval_steps','phase','previous_queued_command_counts_LR','encoder_counts_LR','ESC_current_raw_LR','motor_RPM_LR','CAN_feedback_age_ms_LR','fresh_since_previous_control_snapshot_mask','battery_ADC_mV','battery_age_ms','battery_valid','drive_flags'],
 units:'Current remains raw signed ESC protocol counts until independent scaling verified. Battery ADC estimate is not motor terminal voltage. Encoder is motor-side derived, not an independent carriage sensor. Fresh mask does not imply synchronous actuator feedback.',
 recording:'VOFA115200 JustFloat107channels, clear history before one run, capture before phase1. I63=68212. Existing I53/I54 summary after40s retained. Do not decode stopped payload channels as live motor values.',
 completion:'Normal phaseI2=6/faultI22=0; wait forI88=4446,I89=4,I90=0,then retain>=20s AND I0>=230s. Typically about4minutes total, status takes precedence over estimate. Do not reset/reflash/clear history before complete export. Abnormal motion: stop safely,preserve history,no automatic rerun.',
 analysisPlan:[
  'First verify source identity/sessions/CRC/four-copy agreement, timestamps,1ms-window/20ms coverage, native400point metrics, runtime guards and feedback freshness.',
  'Check units/signs/age and excitation before fitting. Separate raw sampled-feedback artifacts from actual motor/driver response; closed-loop associations alone do not establish causality.',
  'Compare a static current-response baseline with parsimonious causal nonnegative-delay/first-order effective-current candidates per axis using valid fine windows. Reject unidentifiable time constants or unsupported voltage/dead-zone terms rather than inventing values.',
  'Any accepted actuator block must generate its own response from command in forward replay, not inject future measured current and call it autonomous prediction. Keep mechanical/actuator gain confounding explicit; current feedback is not calibrated torque.',
  'Refit shared plant parameters cumulatively only if response data support the block, retain no-actuator baseline and all previous errors. New fitted record is calibration, not independent proof. A subsequent frozen new-record test needs separate user authorization.'
 ],
 futureAggregateModelScreen:{trackingRelativeErrorMaximum:.15,syncRelativeErrorMaximum:.15,waveformIsHardGate:false,status:'Future engineering screen only; not admission to full model/control-benefit validation.'},
 rawArchivesAndOldFirmwarePreserved:true,motorModelIdentified:false,newParametersDerived:false,
 onBoardTimingQualified:false,formalBatchReleased:false,assistantHardwareAction:false};
fs.writeFileSync(path.join(dir,'protocol.json'),JSON.stringify(p,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({protocolSHA256:sha(path.join(dir,'protocol.json')),verificationSHA256:p.verificationSHA256,
 project:p.project,rawPath:raw,hexSHA256:p.hexSHA256,manualRunsAuthorized:1},null,2));
