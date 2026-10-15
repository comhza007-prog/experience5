"""Single training-only effective mechanical candidate, NumPy only.
Results go to stdout; caller saves generated analysis, never raw observations.
"""
import hashlib
import itertools
import json
from pathlib import Path
import numpy as np

ROOT = Path(__file__).resolve().parents[2]
OLD = ROOT/'06_仿真与复现/feedback_model_round31_20261014'
DT = .010
VELOCITY_WINDOW = 5
IMPULSE_WINDOW = 10
RIDGE = 1e-6
NAMES = ['inputGainLeft','inputGainRight','dampingLeft','dampingRight',
         'reciprocalSpring','reciprocalDamping','smoothFrictionLeft','smoothFrictionRight']

def digest(p):
    return hashlib.sha256(Path(p).read_bytes()).hexdigest()

def load(method):
    f = OLD/(method+'_run01_samples.json')
    source = json.loads(f.read_text(encoding='utf-8'))
    raw = Path(source['source'].replace('C:\\Users\\ele\\Desktop\\lunwen', 'D:\\lunwen2'))
    assert digest(raw) == source['sourceSHA256']
    rows = source['samples']
    t = np.asarray([r['ms']/1000 for r in rows])
    assert len(rows)==2001 and np.max(np.abs(np.diff(t)-DT)) < 1e-9
    p = np.asarray([r['position_m'] for r in rows])
    u = np.asarray([r['attemptedCommandCounts'] for r in rows],float)*[1,-1]
    measured_current = np.asarray([r['feedbackCurrentCounts'] for r in rows],float)
    return {'method':method,'source':str(f),'SHA256':digest(f),'raw':str(raw),'rawSHA256':digest(raw),
            't':t,'p':p,'u':u,'current':measured_current,'rows':rows,
            'pitch':source['configuredKinematics']['metersPerCount']}

train = load('BLNN')
# Do not load S3R2 observations until all coefficients are frozen.
velocity_scale = train['pitch']/(VELOCITY_WINDOW*DT)
v = np.zeros_like(train['p'])
tt = np.arange(VELOCITY_WINDOW+1)*DT
tc = tt-tt.mean()
for k in range(VELOCITY_WINDOW,len(v)):
    v[k] = (tc[:,None]*train['p'][k-VELOCITY_WINDOW:k+1]).sum(axis=0)/(tc@tc)

xx,yy = [],[]
for start in range(VELOCITY_WINDOW,len(v)-IMPULSE_WINDOW):
    end = start+IMPULSE_WINDOW
    sl = slice(start,end)
    impulse = train['u'][sl].sum(axis=0)*DT
    displacement = train['p'][end]-train['p'][start]
    skew_impulse = (train['p'][sl,1]-train['p'][sl,0]).sum()*DT
    skew_change = displacement[1]-displacement[0]
    friction_impulse = np.tanh(v[sl]/velocity_scale).sum(axis=0)*DT
    xx.extend([[impulse[0],0,-displacement[0],0,skew_impulse,skew_change,-friction_impulse[0],0],
               [0,impulse[1],0,-displacement[1],-skew_impulse,-skew_change,0,-friction_impulse[1]]])
    yy.extend(v[end]-v[start])
X,Y = np.asarray(xx),np.asarray(yy)
scale = np.linalg.norm(X,axis=0)
assert np.all(scale>0)
A = X/scale
G = A.T@A+RIDGE*np.eye(8)
q = A.T@Y
best = None
for mask in itertools.product([False,True],repeat=8):
    ix = np.flatnonzero(mask)
    z = np.zeros(8)
    if len(ix):
        z[ix] = np.linalg.solve(G[np.ix_(ix,ix)],q[ix])
    if np.any(z < -1e-15):
        continue
    score = np.linalg.norm(A@z-Y)**2+RIDGE*(z@z)
    if best is None or score < best[0]:
        best = (float(score),z.copy())
assert best is not None
z = np.maximum(best[1],0)
theta = z/scale
kkt = G@z-q
assert np.all(kkt[z==0]>=-1e-12) and np.max(np.abs(kkt[z>0]))<1e-12
frozen = theta.copy()

gain = theta[:2]
B = np.diag(theta[2:4])+theta[5]*np.array([[1,-1],[-1,1]],float)
K = theta[4]*np.array([[1,-1],[-1,1]],float)
friction = theta[6:8]
assert np.linalg.eigvalsh(B).min() >= -1e-12 and np.linalg.eigvalsh(K).min() >= -1e-12

def step(position,velocity,input_value):
    h = .001
    M = np.eye(2)+h*B+h*h*K
    rhs = velocity+h*(gain*input_value-K@position)
    candidate = velocity.copy()
    def residual(w):
        return M@w+h*friction*np.tanh(w/velocity_scale)-rhs
    def objective(w):
        # Stable logcosh expression for the convex implicit friction energy.
        x = w/velocity_scale
        logcosh = np.logaddexp(x,-x)-np.log(2)
        return .5*(w@M@w)-rhs@w+h*velocity_scale*(friction@logcosh)
    converged = False
    for iteration in range(40):
        tanh = np.tanh(candidate/velocity_scale)
        r = residual(candidate)
        if np.max(np.abs(r)) <= 1e-13:
            converged = True
            break
        J = M+np.diag(h*friction*(1-tanh*tanh)/velocity_scale)
        direction = np.linalg.solve(J,r)
        old_obj = objective(candidate)
        rate = 1.
        for search in range(35):
            proposal = candidate-rate*direction
            if objective(proposal) <= old_obj-1e-4*rate*(r@direction)+1e-24:
                candidate = proposal
                break
            rate *= .5
    assert converged or np.max(np.abs(residual(candidate))) < 1e-11
    return position+h*candidate,candidate

def rollout(data):
    position = data['p'][0].copy()
    velocity = np.zeros(2)
    result = [position.copy()]
    for i in range(len(data['t'])-1):
        for substep in range(10):
            position,velocity = step(position,velocity,data['u'][i])
        if not np.all(np.isfinite(position)) or np.max(np.abs(position)) > 1:
            break
        result.append(position.copy())
    result = np.asarray(result)
    error = result-data['p'][:len(result)]
    mask = data['t'][:len(result)] >= 4
    def metrics(e):
        return {'axisRMSE_mm':(1000*np.sqrt(np.mean(e**2,axis=0))).tolist(),
                'meanPositionRMSE_mm':float(1000*np.sqrt(np.mean(e.mean(axis=1)**2))),
                'syncDifferenceRMSE_mm':float(1000*np.sqrt(np.mean((e[:,0]-e[:,1])**2))),
                'axisMaxAbs_mm':(1000*np.max(np.abs(e),axis=0)).tolist()}
    return {'method':data['method'],'completed':len(result)==len(data['p']),
            'predictedPoints':len(result),'expectedPoints':len(data['p']),
            'motionForcedResponseErrors':metrics(error[mask]),
            'noMotionBaselineErrors':metrics((data['p'][0]-data['p'][:len(result)])[mask]),
            'terminalError_mm':(1000*error[-1]).tolist(),
            'measuredPositionUsedOnlyAtInitialization':True,'futureRPMOrPositionUsedInRollout':False,
            'positionsPredicted_m':result.tolist(),'sampleTimes_s':data['t'][:len(result)].tolist()}

pre = (train['t']<4)&np.all(train['u']==0,axis=1)
sensor = {'zeroCommandPreholdSamples':int(pre.sum()),
          'zeroCommandPositionRange_m':np.ptp(train['p'][pre],axis=0).tolist(),
          'feedbackCurrentMean_counts':train['current'][pre].mean(axis=0).tolist(),
          'feedbackCurrentStd_counts':train['current'][pre].std(axis=0).tolist(),
          'feedbackCurrentRange_counts':np.stack((train['current'][pre].min(axis=0),train['current'][pre].max(axis=0)),axis=1).tolist(),
          'nonzeroFeedbackCurrentDoesNotIdentifyTrueForce':True}
fit_info = {'parameterNames':NAMES,'parameters':theta.tolist(),'velocityScale_mPerS':velocity_scale,
            'effectiveNormalizedUnitsNotPhysicalMassOrForce':True,
            'weakRows':len(Y),'designRank':int(np.linalg.matrix_rank(A)),
            'conditionNumber':float(np.linalg.cond(A)),
            'activeCoefficientNames':[NAMES[i] for i in np.flatnonzero(z>0)],
            'zeroCoefficientNames':[NAMES[i] for i in np.flatnonzero(z==0)],
            'ridge':RIDGE,'weakResidualRMS_mPerS':float(np.sqrt(np.mean((X@theta-Y)**2))),
            'positiveInputGains':bool(np.all(gain>0)),
            'weakFitEqualsPhysicalIdentification':False}
results = [rollout(train)]
validation = load('S3R2')
assert np.array_equal(theta,frozen)
results.append(rollout(validation))
assert np.array_equal(theta,frozen)
out = {'trainingSource':{k:train[k] for k in ['source','SHA256','raw','rawSHA256']},
       'retrospectiveCrossMethodSource':{k:validation[k] for k in ['source','SHA256','raw','rawSHA256']},
       'sensorSeparation':sensor,'fit':fit_info,'rollouts':results,
       'postValidationRefit':False,'newModelsFitted':1,'rawAndMCUSourcesChanged':False,
       'recordedCommandZOHNotRecovered1msActuation':True,
       'crossMethodDataWereAlreadyObservedNotNewIndependentValidation':True,
       'physicalParametersIdentified':False,'counterfactualClosedLoopAdmitted':False,
       'micrometerResolutionAdmitted':False,'newPhysicalRunReleased':False,
       'candidateWarning':'Smooth friction/equalnormalized inertia/effective gains are hypotheses. Closed-loopcorrelation,velocity-proxy lag and10msinputdecimation limitphysicalidentifiability.',
       'codeSHA256':digest(__file__)}
print(json.dumps(out,ensure_ascii=False))
