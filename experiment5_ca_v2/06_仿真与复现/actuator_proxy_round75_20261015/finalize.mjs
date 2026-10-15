import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
const dir=path.dirname(fileURLToPath(import.meta.url)),root=path.resolve(dir,'../..');
const sha=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const proxy=JSON.parse(fs.readFileSync(path.join(dir,'fit_results.json'),'utf8'));
const plant=JSON.parse(fs.readFileSync(path.join(dir,'plant_sensitivity_results.json'),'utf8'));
assert.equal(plant.proxyFitSHA256,sha(path.join(dir,'fit_results.json')));
for(const source of proxy.sources){assert.equal(sha(source.raw),source.rawSHA256);assert.equal(sha(source.decoded),source.decodedSHA256);}
const prep=JSON.parse(fs.readFileSync(path.join(root,'06_仿真与复现/q2_mechanical_recheck_round73_20261015/preparation.json'),'utf8'));
for(const model of prep.frozenModels)assert.equal(sha(model.path),model.SHA256);
const project=path.join(root,'05_实验代码/模型闭环_Q2_误差汇总40s_20261015/eassy_E5ID_Q2S_BLNN_HW6');
for(const [file,expected] of Object.entries(prep.currentSourceHashes))assert.equal(sha(path.join(project,file)),expected);
const dynamicCases=proxy.cases.map(({prediction_counts,observation_counts,...r})=>r);
const q2=dynamicCases.filter(r=>r.record==='newQ2');
assert(q2.every(r=>r.dynamicRMSE_counts<r.staticRMSE_counts));
const out={date:'2026-10-15',proxyFitSHA256:sha(path.join(dir,'fit_results.json')),plantSensitivitySHA256:sha(path.join(dir,'plant_sensitivity_results.json')),
 fittedProxyGains:proxy.fits.map(r=>r.parameters[0]),fittedProxyTimeConstants_ms:proxy.fits.map(r=>r.parameters[1]),
 currentPredictionCases:dynamicCases,newQ2CurrentRMSEImprovementRange_percent:[Math.min(...q2.map(r=>-r.dynamicVsStaticRMSEChange_percent)),Math.max(...q2.map(r=>-r.dynamicVsStaticRMSEChange_percent))],
 plantSensitivityCases:plant.cases.map(({nativeContinuousAxisPosition_m,phaseErrors,...r})=>r),
 verification:{gainTauJacobianChecks:proxy.gradientVerification.length,trapezoidCases:proxy.independentIntegrationVerification.length,
   maximumIndependentCurrentIntegrationDifference_counts:Math.max(...proxy.independentIntegrationVerification.map(r=>r.maxEndpointDifference_counts)),
   independentMechanicalSteps:plant.verification.reduce((s,r)=>s+r.independentMechanicalSteps,0),
   maximumNativePythonPositionDifference_m:Math.max(...plant.verification.map(r=>r.maxNativePythonPositionDifference_m)),
   rawModelAndSevenControlSourceHashesUnchanged:true},
 conclusion:'First-order reported-current proxy improves bothT1/newQ2allaxisphasemeasures compared with staticgain. Unitgain lag added alone to frozenmechanics does not resolve sync waveform/amplitude mismatch. This does not rule out relevance under a separately justified joint model, and is not deliveredtorque identification. No fullclosedloop model admitted.',
 nextStep:'Prospectively inspect resolvable low-speed sticking/release patterns from existingT1/newQ2encoder andqueuedinput windows before adding any friction-memory model. Encoderquantization, coupledforces andreportedcurrent uncertainty must not be mistaken for measuredstaticfriction. No physical run, control modification or newQ2fitting released.',
 newQ2UsedForCalibration:false,newQ2ExploratoryCheckNotUntouchedIndependentValidation:true,
 mechanicalParametersChanged:false,controllerChanged:false,hardwareAction:false,newPhysicalRunReleased:false,modelClosureComplete:false};
fs.writeFileSync(path.join(dir,'decision.json'),JSON.stringify(out,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({timeConstants_ms:out.fittedProxyTimeConstants_ms,currentPredictionImprovementRange_percent:out.newQ2CurrentRMSEImprovementRange_percent,verification:out.verification,modelClosureComplete:false},null,2));
