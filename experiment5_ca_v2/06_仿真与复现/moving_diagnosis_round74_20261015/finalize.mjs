import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
const dir=path.dirname(fileURLToPath(import.meta.url)),root=path.resolve(dir,'../..');
const sha=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const a=JSON.parse(fs.readFileSync(path.join(dir,'audit_results.json'),'utf8'));
const prep=JSON.parse(fs.readFileSync(path.join(root,'06_仿真与复现/q2_mechanical_recheck_round73_20261015/preparation.json'),'utf8'));
const project=path.resolve(path.dirname(JSON.parse(fs.readFileSync(path.join(root,'06_仿真与复现/q2_mechanical_recheck_round73_20261015/protocol.json'),'utf8')).project),'..');
for(const [file,expected] of Object.entries(prep.currentSourceHashes))assert.equal(sha(path.join(project,file)),expected);
for(const source of a.sourceInfo){assert.equal(sha(source.raw),source.rawSHA256);assert.equal(sha(source.decoded),source.decodedSHA256);}
const t1=path.join(root,'05_实验代码/辨识T1_全运动段_20261015/eassy_E5ID_T1F_BLNN_HW6');
const files=['CAN-control/CAN_receive.c','Core/Src/freertos.c'];
for(const file of files)assert.equal(sha(path.join(project,file)),sha(path.join(t1,file)));
const can=fs.readFileSync(path.join(project,files[0]),'utf8'),rtos=fs.readFileSync(path.join(project,files[1]),'utf8');
assert(can.includes('motor->speed_rpm = (int16_t)(((uint16_t)data[2] << 8) | data[3]);'));
assert(can.includes('motor->given_current = (int16_t)(((uint16_t)data[4] << 8) | data[5]);'));
assert.equal((rtos.match(/osThreadDef\(MOTOR_Task, motor_task/g)||[]).length,1);
const q=a.records.find(r=>r.record==='newQ2');
const out={date:'2026-10-15',auditSHA256:sha(path.join(dir,'audit_results.json')),
 frozenModelSHA256:a.frozenModelSHA256,records:a.sourceInfo,
 codePathAudit:{applicationSourceInspection:'CAN command calls occur in motor_task only; other calls there are zero-command fault stops. One motor_task registered. No duplicate motor command writer found in inspected application sources.',
 signedRPMAndCurrentFieldsDecodedDirectly:true,CANSlots:'0x203/0x204 -> M3/M4 in0x200',
 sourceHashes:Object.fromEntries(files.map(file=>[file,sha(path.join(project,file))])),T1AndQ2PathsByteExact:true,
 noMCUCodeOrFlashChanged:true,notProofOfDeliveredMotorTorque:true},
 newQ2MotionResults:q.phases.map(p=>({phase:p.phase,
   fullSyncPredictionRMSE_mm:p.fullTaskNative100Errors.syncPredictionRMSE_mm,
   conditionalSyncPredictionRMSE_mm:p.conditionalNative100Errors.syncPredictionRMSE_mm,
   conditionalMeanPositionPredictionRMSE_mm:p.conditionalNative100Errors.meanPositionPredictionRMSE_mm,
   alignment:p.alignment,encoderVsRPM50stepMeanEquivalentRawRPM:p.encoderRPMDiagnostics[0].meanResidualEquivalentRawRPM})),
 conditionalVelocityInitialization:'Preceding80step encoder estimate, not true measured instantaneous velocity; each4s prediction conditioned once, no future-state injection.',
 modelTimeConstants_ms:a.modelModeDiagnostics.timeConstants_ms,
 conclusions:[
  'Timing/encoder/RPM/native-new-command mapping has0mismatches across396motion frames fromT1/newQ2; no indexing repair justified.',
  'Outward starts at observedzero position/velocity, and its conditional/fullsweep errors coincide. Return conditional initial states do not remove sync mismatch. Holding-state accumulation is not a sufficient sole explanation, but conditional tests do not uniquely identify its contribution.',
  'ESC reportedcurrent vs queuedcommand is not one-to-one; fixedlookback comparisons show improvements atshortpositive lags but no universal lag/gain has been identified. It is not calibrated deliveredtorque.',
  'Encoder-vs-ENDsampleRPM-integral systematic differences persist inboth tightened records. No correction/filter/quantizer was fitted. This observation issue affects free closedloop sensor modeling, but the current forcedposition solver does not consumeRPM, so alteringRPM alone cannot fix its position replay.',
  'Frozen model has0.3518msfast mass/damping timeconstant below1msrecording period; this is an estimatedmodel diagnostic, not evidence of actualhardware damping or a theorem of nonidentifiability.'
 ],
 decision:'Keep model unadmitted; stop blind mechanical-gain adjustments. Next prospectively define ONE actuator/reported-current dynamic hypothesis using T1 for calibration only and reserve newQ2for explicitly exploratory cross-record checking, because it has now informed hypothesis development. No old/newQ2 fitting or new hardware trial in this round.',
 independentChecks:{conditionalPythonSteps:a.independentConditionalPythonChecks.reduce((s,r)=>s+r.steps,0),maximumNativePythonPositionDifference_m:Math.max(...a.independentConditionalPythonChecks.map(r=>r.nativePythonMaximumDifference_m)),allRawAndSourceHashesUnchanged:true},
 modelClosureComplete:false,modelsFitted:0,controllerChanged:false,newPhysicalRunReleased:false,assistantHardwareAction:false};
fs.writeFileSync(path.join(dir,'decision.json'),JSON.stringify(out,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({newQ2MotionResults:out.newQ2MotionResults,independentChecks:out.independentChecks,decision:out.decision},null,2));
