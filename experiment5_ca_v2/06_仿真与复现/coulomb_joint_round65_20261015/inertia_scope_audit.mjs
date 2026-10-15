import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
const dir=path.dirname(fileURLToPath(import.meta.url));
const fit=JSON.parse(fs.readFileSync(path.join(dir,'joint_fit_results.json'),'utf8'));
const [gL,gR]=fit.fit.parameters,gbar=(gL+gR)/2,gdiff=(gL-gR)/2;
// y=(pL+pR)/2,s=(pL-pR)/2; uc=(uL+uR)/2,ud=(uL-uR)/2.
// Current diagonal normalized inertia/diagonal command gain implies
// acceleration input matrix[[gbar,gdiff],[gdiff,gbar]],equal modal diagonals.
for(const [uL,uR]of [[1,1],[1,-1],[2,3],[-5,7]]){
 const uc=(uL+uR)/2,ud=(uL-uR)/2;
 assert(Math.abs((gL*uL+gR*uR)/2-(gbar*uc+gdiff*ud))<1e-14);
 assert(Math.abs((gL*uL-gR*uR)/2-(gdiff*uc+gbar*ud))<1e-14);
}
// A generic beam-like coordinate assumption T=1/2*m*ydot^2+
// 1/2*J*(sdot/a)^2 yields an off-diagonal axis inertia unless J=m*a^2.
// This is an algebraic scope check,NOT identified mass/J or proof of hardware.
const result={date:'2026-10-15',currentEightCoefficientScope:{
  modalInputGainMatrix:[[gbar,gdiff],[gdiff,gbar]],independentCommonVsDifferenceInertialGainNotAvailable:true,
  equalNormalizedAxisInertiaAssumption:true,viscousSpringCouplingIsNotInertialCoupling:true},
  algebraicRigidBodyHypothesis:{coordinates:'y=(pL+pR)/2,s=(pL-pR)/2,angle=s/a',
   kineticEnergy:'0.5*m*ydot^2+0.5*(J/a^2)*sdot^2',
   axisDiagonalInertia:'(m+J/a^2)/4',axisOffDiagonalInertia:'(m-J/a^2)/4',
   diagonalOnlyCondition:'J=m*a^2',actualPlatformSatisfiesThisRigidBodyAssumptionNotEstablished:true,
   motorEncoderProjectedPositionsNotIndependentCarriagePositions:true},
  possibleSingleExtraStructuralFreedom:{normalizedMass:'[[1,eta],[eta,1]]',positiveDefiniteCondition:'-1<eta<1',
   commonInertia:'1+eta',differenceInertia:'1-eta',etaFitted:false,anotherCandidateImplemented:false},
  interpretation:'Currentmodelrestrictscommon/differencemodeinertialgains. This is a specific structuralscope limitation toinspectbeforeanothercalibration,NOTproofetaisnonzeroorwillfixobservedpredictionerrors.',
  newModelFitted:false,newParametersSelected:false,controllerChanged:false,newPhysicalCaptureReleased:false};
fs.writeFileSync(path.join(dir,'inertia_scope_audit.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(result,null,2));
