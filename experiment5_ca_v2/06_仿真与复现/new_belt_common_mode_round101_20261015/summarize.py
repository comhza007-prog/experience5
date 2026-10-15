"""Reject unsupported added terms; keep R100 current and record bounded negative tests."""
import json
import numpy as np
from fit import HERE,PRIOR,load,sha,library,rollout
data=load();lib=library();fit=json.loads((HERE/'fit_results.json').read_text());tests=json.loads((HERE/'solver_tests.json').read_text());inputs=json.loads((HERE/'input_audit.json').read_text())
selected=fit['selected'];assert selected['addedParameters']==[0.,0.];assert tests['passed']
base=json.loads((PRIOR/'model_parameters.json').read_text());assert sha(PRIOR/'model_parameters.json')=='a44665e79b254514302e0c39c3a3ebf288df7e684920e5dc2b76df49683ce486'
for d in data:assert sha(d['raw'])==d['rawSHA256']
out=dict(status='Common-mode extension tested and rejected; no improvement, R100 retained as experimental baseline',
    modifiedSource=str(HERE/'native_model.c'),sourceSHA256=sha(HERE/'native_model.c'),solverSHA256=sha(HERE/'native_model.dll'),
    selectedAddedCommonStiffness=0.,selectedAddedCommonDamping=0.,addedTermsAdopted=False,
    cases=selected['cases'],phaseDiagnosis=json.loads((HERE/'phase_diagnosis.json').read_text()),
    inputSensitivityResults=inputs['results'],
    inputSensitivityInterpretation='Two first-command/integral-consistent hold-input hypotheses change current predictions only slightly; these hypotheses do not explain observed tracking error. Unknown high-frequency hold inputs remain uncertain; this is not waveform recovery or exclusion of all input errors.',
    numericalVerification=tests,currentModelUnchanged=str(PRIOR/'model_parameters.json'),
    currentModelSHA256=sha(PRIOR/'model_parameters.json'),bothNewBeltRecordsDevelopmentOnly=True,
    previousFrozenFailuresRetained=True,physicalModelValidated=False,newPhysicalRunReleased=False,firmwareChanged=False,assistantHardwareAction=False,
    requiredHardwareMetadata='Whether only belt or also pulley/gearing changed; old/new belt pitch/model/width and tension. Requested from user. No guessed geometry or encoder scaling applied.',
    nextStep='Clarify new transmission geometry and tension before selecting another physical model law or widening parameters. Keep existing correctable partial result: sync aggregates within15percent but tracking not. Do not convert unsupported common elastic term into final model.')
with (HERE/'comparison_summary.json').open('x',encoding='utf-8') as f:json.dump(out,f,ensure_ascii=False,indent=2)
print(json.dumps(dict(summarySHA256=sha(HERE/'comparison_summary.json'),inputAuditSHA256=sha(HERE/'input_audit.json'),solverTestsPassed=tests['passed'])))
