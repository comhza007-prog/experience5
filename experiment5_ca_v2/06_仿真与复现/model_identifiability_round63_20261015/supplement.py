import csv, hashlib, json
from pathlib import Path
import numpy as np

DIR=Path(__file__).resolve().parent
ROOT=DIR.parents[1]
base=json.loads((DIR/'audit_results.json').read_text(encoding='utf-8'))
data=json.loads(Path(base['sources']['decoded']).read_text(encoding='utf-8'))
raw=Path(base['sources']['raw'])
assert hashlib.sha256(raw.read_bytes()).hexdigest()==base['sources']['rawSHA256']
pitch=data['header']['configured_meters_per_count']
mpr=pitch*8192/60
direction=np.array([1.,-1.])
sensor=[]
for phase,start,end,anchor in [(2,0,4000,99),(4,4000,8000,149)]:
    rows=data['fast'][start:end]
    t=np.array([data['slow'][anchor]['actual_us']]+[r['actual_us'] for r in rows])*1e-6
    e=np.array([data['slow'][anchor]['encoder']]+[r['encoder'] for r in rows],float)
    r=np.array([x['rpm'] for x in rows],float)
    displacement=(e[-1]-e[0])*pitch
    rpm_displacement=(r*np.diff(t)[:,None]*mpr).sum(axis=0)
    residual=displacement-rpm_displacement
    mean_bias=residual/(t[-1]-t[0])/mpr
    k=100
    rpm_int=np.vstack([np.zeros(2),np.cumsum(r*np.diff(t)[:,None],axis=0)])
    elapsed=t[k:]-t[:-k]
    rpm_mean=(rpm_int[k:]-rpm_int[:-k])/elapsed[:,None]
    fixed=(e[k:]==e[:-k])
    sensor.append({'phase':phase,'integratedRawEncoderDisplacement_mm':(1000*displacement).tolist(),
                   'integratedRawRPMDisplacement_mm':(1000*rpm_displacement).tolist(),
                   'rawEncoderMinusRPMDisplacement_mm':(1000*residual).tolist(),
                   'rawEncoderMinusRPMMeanEquivalent_rpm':mean_bias.tolist(),
                   'rawRPMMeanOn100msZeroEncoderDisplacementWindows':[float(rpm_mean[fixed[:,ch],ch].mean()) for ch in range(2)],
                   'zeroDisplacementWindowCounts':fixed.sum(axis=0).tolist(),
                   'rawDirectionsBeforeRightAxisSignCorrection':True,
                   'zeroEndpointDisplacementNotProofOfNoInterimMotion':True,
                   'quantizationOffsetDelayHypothesesNotIdentified':True})

previous=np.array([0,0],dtype=int)
hold_rows=[]
for k,r in enumerate(data['slow']):
    if k==100:previous=np.array(data['fast'][3999]['encoder'])
    if k==150:previous=np.array(data['fast'][7999]['encoder'])
    current=np.array(r['encoder'])
    mean=np.array(r['command_integral_counts_us'])/r['dt_us']
    unchanged=current==previous
    hold_rows.append({'phase':r['phase'],'unchanged':unchanged,'bothUnchanged':bool(unchanged.all()),'mean':mean})
    previous=current
holds=[]
for phase in [1,3,5]:
    rows=[r for r in hold_rows if r['phase']==phase]
    fixed=np.array([r['unchanged'] for r in rows])
    means=np.array([r['mean'] for r in rows])
    both=np.array([r['bothUnchanged'] for r in rows])
    holds.append({'phase':phase,'rows':len(rows),'unchangedEndpointFractions':fixed.mean(axis=0).tolist(),
                  'bothEndpointsUnchangedRows':int(both.sum()),
                  'nonzeroMeanCommandWithUnchangedEndpointRows':((np.abs(means)>1)&fixed).sum(axis=0).tolist(),
                  'meanCommandOnUnchangedEndpoint_counts':[float(means[fixed[:,ch],ch].mean()) if fixed[:,ch].any() else None for ch in range(2)],
                  'meanCommandRangeOnBothUnchangedEndPoints_counts':np.stack([means[both].min(axis=0),means[both].max(axis=0)],axis=1).tolist() if both.any() else None,
                  'observedQueuedCommandsNotActualCalibratedFrictionForce':True,
                  'noClaimUnobservedIntraIntervalMotionIsZero':True})

old=ROOT/'06_仿真与复现/final_method_evidence_round56_20261014/test_plant.c'
code=old.read_text(encoding='utf-8')
assert 'rpm[ch]=(int16_t)lround' in code
assert 'dt/(.003+dt)' in code
assert 'TEST_NOISE_PERIOD' in code
# Independent numerical proof of the toy same-impulse/different-position fact.
g=6.255890569243181e-6
h=.001
A=1000
v=p=0.
for u in [A]*20+[-A]*20:
    v+=h*g*u
    p+=h*v
assert abs(v)<1e-15 and abs(p-g*A*.04**2/4)<1e-15

result={**base,'lowSpeedMeasurementAudit':sensor,'holdEndpointCommandAudit':holds,
        'oldSimulationMeasurementHypothesis':{'source':str(old),'sourceSHA256':hashlib.sha256(old.read_bytes()).hexdigest(),
         'rounding':'lround nearest,not an observed drive quantizer','assumedSensorLag_s':.003,
         'periodicPlus1RPMNoiseNotDataCalibrated':True,'newDataNegativeRawRPMSideBiasBothAxesObserved':True,
         'actualQuantizerFloorNotProven':True,'measuredOffsetNotSoleMismatchCauseProven':True},
        'sameImpulseToyNumericalCheck':{'passed':True,'steps':40,'gainIsOldUnvalidatedIllustration':True,
         'meanInputCounts':0,'terminalVelocity_m_s':v,'positionDifference_um':p*1e6,
         'doesNotEstablishActualHoldInputUncertaintyMagnitude':True},
        'updatedPriorities':['Inspect and model low-speed RPM measurement effects without changing the frozen controller feedback',
         'Account for sticking/drive-deadzone or delivery uncertainty in holding; smooth tanh alone is an unverified hypothesis',
         'Resolve hold input timing information or quantify justified multirate uncertainty before whole-task micrometer claims',
         'Predefine train-only fitting/freeze/independent ordinary-andS3R2 predictions before any additional physical run'],
        'rootCauseConfirmed':False,'modelsFitted':0,'modelClosureComplete':False,
        'newPhysicalRunReleased':False,'controllerSensorOffsetCorrected':False}
print(json.dumps(result,ensure_ascii=False))
