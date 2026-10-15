"""One fixed coupled interval-state model, four internal blocked checks."""
import hashlib
import json
from pathlib import Path
import sys
import numpy as np

HERE = Path(__file__).resolve().parent
PRIOR = HERE.parent/'identification_t1_prepare_round45_20261014'
sys.path.insert(0, str(PRIOR))
from train_arx_audit import errors

def sha(p):
    return hashlib.sha256(p.read_bytes()).hexdigest()

def feature(p, v, u, up, ch):
    return np.array([v[ch], v[1-ch], u[ch]/1000, u[1-ch]/1000,
                     up[ch]/1000, up[1-ch]/1000, p[0]-p[1], 1.])

def fit(p, v, u, up, y):
    models = []
    for ch in range(2):
        x = np.array([feature(a, b, c, e, ch) for a, b, c, e in zip(p, v, u, up)])
        scale = x.std(axis=0); scale[scale < 1e-12] = 1
        coef, _, rank, sv = np.linalg.lstsq(x/scale, y[:, ch], rcond=None)
        models.append({'axis': ch, 'beta': (coef/scale).tolist(), 'rank': int(rank),
                       'columns': 8, 'scaledCondition': float(sv[0]/sv[-1]) if sv[-1] > 0 else None})
    return models

def replay(models, p, v, u, up, dt):
    h = []
    p, v = p.copy(), v.copy()
    for c, cp, span in zip(u, up, dt):
        v = np.array([feature(p, v, c, cp, ch) @ np.array(models[ch]['beta']) for ch in range(2)])
        p += span*v
        if not np.isfinite(p).all() or np.max(np.abs(p)) > 1e12:
            return None
        h.append(p.copy())
    return np.array(h)

def poles(models, h):
    b = np.array([m['beta'] for m in models])
    a = np.array([[b[0,0], b[0,1]], [b[1,1], b[1,0]]])
    k = b[:,6,None] @ np.array([[1., -1.]])
    transition = np.block([[np.eye(2)+h*k, h*a], [k,a]])
    eig = np.linalg.eigvals(transition)
    translation = int(np.argmin(np.abs(eig-1)))
    other = np.delete(eig, translation)
    return {'augmentedEigenvalues': [[float(z.real),float(z.imag)] for z in eig],
            'oneTranslationPoleError': float(abs(eig[translation]-1)),
            'otherPoleMaxMagnitude': float(np.max(np.abs(other))),
            'relativePositionCoefficients': b[:,6].tolist(),
            'restoringSignPattern': bool(b[0,6] <= 0 and b[1,6] >= 0),
            'oneMillisecondContinuousEmbeddingNotEstablished': True}

def self_test():
    rng = np.random.default_rng(4602)
    truth = np.array([[.3,.04,.8,.1,.05,.01,-.8,.001], [.4,.02,.7,.1,.06,.03,.9,-.001]])
    u = rng.normal(size=(801,2))*200; up,u=u[:-1],u[1:]
    ps,vs,ys=[],[],[]
    p,v=np.array([.02,-.01]),np.array([.01,-.01])
    for c,cp in zip(u,up):
        ps.append(p.copy());vs.append(v.copy())
        v=np.array([feature(p,v,c,cp,ch) @ truth[ch] for ch in range(2)])
        p=p+.02*v;ys.append(v.copy())
    m=fit(np.array(ps),np.array(vs),u,up,np.array(ys))
    assert np.max(np.abs(np.array([a['beta'] for a in m])-truth))<1e-9
    pred=replay(m,np.array(ps)[0],np.array(vs)[0],u,up,np.full(800,.02))
    assert np.max(np.abs(pred-(np.array(ps)[0]+np.cumsum(np.array(ys)*.02,axis=0))))<1e-9

def main():
    self_test()
    source=PRIOR/'build67832_0da7ed24d02b_analysis.json'
    d=json.loads(source.read_text(encoding='utf-8'))
    assert d['qualified'] and sha(Path(d['source']))==d['sourceSHA256']
    dt=np.array([r['elapsed_us'] for r in d['slow']])/1e6
    p=np.array([r['encoder'] for r in d['slow']],dtype=float)*d['header']['configured_meters_per_count']*1000;p[:,1]*=-1
    pp=np.vstack((np.zeros(2),p));v=np.diff(pp,axis=0)/dt[:,None]
    u=np.array([r['command_mean_counts'] for r in d['slow']],dtype=float);u[:,1]*=-1
    idx=np.arange(200,1000)
    models=fit(pp[idx],v[idx-1],u[idx],u[idx-1],v[idx])
    h=replay(models,pp[200],v[199],u[idx],u[idx-1],dt[idx])
    full={'models':models,**poles(models,float(np.mean(dt[idx]))),
          'trainingRecordedInputRecursiveErrors':errors(h-p[idx]) if h is not None else None}
    folds=[]
    for block in range(4):
        held=idx[block*200:(block+1)*200];train=np.setdiff1d(idx,held)
        m=fit(pp[train],v[train-1],u[train],u[train-1],v[train])
        pred=replay(m,pp[held[0]],v[held[0]-1],u[held],u[held-1],dt[held])
        folds.append({'block':block,'heldEndpoint_ms':[int((held[0]+1)*20),int((held[-1]+1)*20)],
                      'trainIntervals':600,'heldIntervals':200,'models':m,**poles(m,float(np.mean(dt[held]))),
                      'trainingInternalHeldBlockErrors':errors(pred-p[held]) if pred is not None else None,
                      'samePhysicalRunNotIndependentValidation':True})
    result={'source':d['source'],'sourceSHA256':d['sourceSHA256'],'protocolSHA256':sha(HERE/'coupled_state_protocol.json'),
            'codeSHA256':sha(Path(__file__)),'syntheticRoundtripPassed':True,'fullTrainingFit':full,
            'allFourTrainingInternalBlockedChecks':folds,'Q0UsedForFitting':False,'V1ReadOrAcquired':False,
            'modelIdentified':False,'V1Released':False,'MCUFirmwareChanged':False,'newPhysicalRuns':0}
    with (HERE/'coupled_state.json').open('x',encoding='utf-8') as stream:
        json.dump(result,stream,ensure_ascii=False,indent=2,allow_nan=False)
    print(json.dumps({'fullTrainingFit':{k:v for k,v in full.items() if k!='models'},
                     'allFourBlockedChecks':[{k:v for k,v in f.items() if k!='models'} for f in folds]},indent=2,allow_nan=False))

if __name__=='__main__':
    main()
