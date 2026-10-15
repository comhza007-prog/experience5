"""Diagnostic associations only: ESCfeedback is not a calibrated force."""
import csv, hashlib, json
from pathlib import Path
import numpy as np

DIR=Path(__file__).resolve().parent
ROOT=DIR.parents[1]
fit=json.loads((DIR/'candidate_fit_results.json').read_text(encoding='utf-8'))
record=ROOT/'06_仿真与复现/identification_q2_summary40s_round61_20261015/build68012_0b743a60e6ed_analysis.json'
data=json.loads(record.read_text(encoding='utf-8'))
raw=Path(data['source'])
assert hashlib.sha256(raw.read_bytes()).hexdigest()==data['sourceSHA256']==fit['sourceSHA256']
with raw.open(newline='',encoding='utf-8-sig') as handle:
    reader=csv.reader(handle);assert next(reader)==[f'I{k}' for k in range(107)]
    live=np.array([[float(v) for v in row] for row in reader])[1:]
sign=np.array([1.,-1.]);pitch=data['header']['configured_meters_per_count']
pre=live[(live[:,2]==1)&(live[:,106]==1)]
assert np.all(pre[:,13:15]==0)
pre_current=pre[:,15:17]
baseline={'nativeSamples':len(pre),'queuedCommandsExactlyZero':True,
          'ESCFeedbackMean_rawCounts':pre_current.mean(axis=0).tolist(),
          'ESCFeedbackStd_rawCounts':pre_current.std(axis=0).tolist(),
          'ESCFeedbackRange_rawCounts':np.stack([pre_current.min(axis=0),pre_current.max(axis=0)],axis=1).tolist(),
          'rawPositionRange_mm':(np.ptp(pre[:,5:7],axis=0)*1000).tolist(),
          'notAForceZeroCalibration':True}
active=live[(live[:,106]==1)&np.isin(live[:,2],[2,4])]
aligned=[];boundary=[]
for row in active:
    endpoint=int(row[46])-1
    index=endpoint-4001 if row[2]==2 else 4000+endpoint-10001
    if endpoint in (4000,10000):
        boundary.append(int(endpoint));continue
    assert 0<=index<8000 and (index<4000)==(row[2]==2)
    f=data['fast'][index]
    assert np.max(np.abs(np.array(f['encoder'])*sign*pitch-row[5:7]))<=.00000051
    assert np.array_equal(f['rpm'],row[80:82])
    aligned.append((row,index))
correlation=[]
for lag in [0,1,2,5,10,20]:
    values=[]
    for row,index in aligned:
        local=index if index<4000 else index-4000
        if local<lag:continue
        u=np.array(data['fast'][index-lag]['command_counts'],float)*sign
        feedback=row[15:17]*sign
        values.append((u,feedback))
    x=np.array([v[0] for v in values]);y=np.array([v[1] for v in values])
    axes=[]
    for ch in range(2):
        A=np.c_[x[:,ch],np.ones(len(x))]
        beta=np.linalg.lstsq(A,y[:,ch],rcond=None)[0]
        residual=y[:,ch]-A@beta
        axes.append({'axis':ch,'correlation':float(np.corrcoef(x[:,ch],y[:,ch])[0,1]),
                     'associationSlope':float(beta[0]),'associationOffset_counts':float(beta[1]),
                     'residualRMS_counts':float(np.sqrt(np.mean(residual**2)))})
    correlation.append({'lagControlSteps':lag,'nominalLag_ms':lag,'samples':len(x),'axes':axes})

# Holdingdiagnostic: compute minimum effective threshold needed under MEAN
# queuedinput and OBSERVEDposition,not truefriction or inferred1ms state.
theta=np.array(fit['fit']['parameters']);g=theta[:2];K=theta[4]*np.array([[1,-1],[-1,1]])
previous=np.array([0.,0.]);margins=[]
for k,r in enumerate(data['slow']):
    if k==100:previous=np.array(data['fast'][3999]['encoder'],float)
    if k==150:previous=np.array(data['fast'][7999]['encoder'],float)
    e=np.array(r['encoder'],float)
    if np.array_equal(e,previous) and r['phase'] in (3,5):
        p=e*sign*pitch;u=np.array(r['command_integral_counts_us'],float)*sign/r['dt_us']
        required=np.abs(g*u-K@p)
        margins.append({'phase':r['phase'],'required':required,'springAcceleration':K@p,'commandAcceleration':g*u})
    previous=e
hold=[]
for phase in [3,5]:
    rows=[r for r in margins if r['phase']==phase]
    needed=np.array([r['required'] for r in rows])
    hold.append({'phase':phase,'bothUnchangedEndpointRows':len(rows),
                 'fittedCoulombThreshold_normalized':theta[6:8].tolist(),
                 'meanInputBalanceRequiredThresholdMedian_normalized':np.median(needed,axis=0).tolist(),
                 'meanInputBalanceRequiredThresholdMaximum_normalized':needed.max(axis=0).tolist(),
                 'springAccelerationMedianMagnitude_normalized':np.median(np.abs(np.array([r['springAcceleration'] for r in rows])),axis=0).tolist(),
                 'commandAccelerationMedianMagnitude_normalized':np.median(np.abs(np.array([r['commandAcceleration'] for r in rows])),axis=0).tolist(),
                 'appliesOnlyToUnvalidatedFittedHypothesis':True,'notPhysicalForceOrActualStaticFriction':True})
out={'date':'2026-10-15','source':str(raw),'sourceSHA256':fit['sourceSHA256'],
     'zeroCommandPreholdFeedback':baseline,'alignedNative40msMovingSamples':len(aligned),
     'alignedEncoderAndRawRPMMatchFastRecordsExactlyWithinCSVPrecision':True,
     'excludedFirstMotionBoundaryStepsWithNoExactHoldCommand':boundary,
     'fixedLagAssociations':correlation,
     'lagsNotCertifiedActuatorDelay':True,'noLagSelectedToRetuneMechanicalModel':True,
     'feedbackCurrentNotCalibratedForce':True,'measurementEndpointSamplesNotFull1msCurrentWaveform':True,
     'holdingFailureDiagnostic':hold,
     'fittedSpringDampingLargeAndLeftCoulombZero':True,
     'mechanicalStructureOrActuationMappingMismatchNotSoleCauseIdentified':True,
     'modelRefitted':False,'controllerChanged':False,'newPhysicalCaptureReleased':False,
     'recommendation':'Do not declare instantqueuedcommand=deliveredforce or a fittedcouplingvalue as physicalidentification. Existingmovingtrainingresponse errors are alreadylarge before holdabstraction,so merely fillingholdinput cannotbeclaimed tofix thiscandidate. Do notstart independentphysicalvalidation ofthisfailedmechanicalcandidate; nextdefineactuator/transmissionmemoryhypothesis and its necessaryobservations before anotherfit.'}
print(json.dumps(out,ensure_ascii=False))
