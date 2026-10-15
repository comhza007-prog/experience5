"""Host-only cumulative calibration helpers. No fitting runs on import."""
import csv,ctypes,hashlib,json
from pathlib import Path
import numpy as np
HERE=Path(__file__).resolve().parent;ROOT=HERE.parents[1]
PRIOR=ROOT/'06_仿真与复现/inertia_coupling_round66_20261015'
sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
protocol=json.loads((HERE/'protocol.json').read_text(encoding='utf-8'))
arr=np.ctypeslib.ndpointer(dtype=np.float64,flags='C_CONTIGUOUS')
contig=lambda a:np.ascontiguousarray(a,dtype=np.float64)
def library(p):
    lib=ctypes.CDLL(str(p));lib.model_rollout.argtypes=[ctypes.c_int,arr,arr,arr,arr,arr,arr]
    lib.model_rollout.restype=ctypes.c_int
    lib.model_one.argtypes=[arr,arr,arr,ctypes.c_double,arr,arr];lib.model_one.restype=ctypes.c_int
    return lib
oldlib=library(PRIOR/'native_model.dll');newlib=library(HERE/'native_model.dll')
def load_records():
    out=[]
    for spec in protocol['records']:
        decoded=ROOT/'06_仿真与复现'/spec['decoded'];d=json.loads(decoded.read_text(encoding='utf-8'))
        audit=d['capture_audit'];raw=Path(d.get('source',audit['source']))
        assert sha(raw)==spec['rawSHA256']
        with raw.open(newline='',encoding='utf-8-sig') as f:
            reader=csv.reader(f);assert next(reader)==[f'I{k}' for k in range(107)]
            allrows=np.array([[float(v) for v in r] for r in reader])
        prefix=spec['prefixRows'];cuts=(np.flatnonzero((np.diff(allrows[:,0])<=0)|(np.diff(allrows[:,1])<=0))+1).tolist()
        assert cuts==([1] if prefix else [])
        live=allrows[prefix:];assert np.all(np.diff(live[:,0])>0)
        if spec['name']=='Q2_run03':
            assert audit['completeCRCVerifiedMotionSnapshotUsable'] and audit['missingCSVFrames']==1
        assert d['header']['fault']==0 and d['header']['quality_flags']==0
        assert len(d['fast'])==8000 and len(d['slow'])==300
        pitch=d['header']['configured_meters_per_count'];sign=np.array([1.,-1.]);dt=[];u=[];idx=[];obs=[]
        for mode,a,b in [('slow',0,100),('fast',0,4000),('slow',100,150),('fast',4000,8000),('slow',150,300)]:
            for r in d[mode][a:b]:
                if mode=='slow':
                    dt.extend([r['dt_us']/40e6]*40)
                    u.extend([np.array(r['command_integral_counts_us'])*sign/r['dt_us']]*40)
                else:dt.append(r['dt_us']/1e6);u.append(np.array(r['command_counts'])*sign)
                idx.append(len(dt)-1);obs.append(np.array(r['encoder'])*sign*pitch)
        dt=contig(dt);u=contig(u);idx=np.array(idx);obs=np.array(obs)
        weights=np.sqrt(np.diff(np.r_[0.,np.cumsum(dt)[idx]]))
        active=live[(live[:,106]==1)&(live[:,2]>=2)&(live[:,2]<=5)]
        at=active[:,46].astype(int)-2
        assert len(dt)==20000 and len(idx)==8300 and len(at)==spec['nativeSamples']
        targets=np.array([np.sqrt(np.mean(((active[:,5:7].mean(axis=1)-active[:,3])*1000)**2)),np.sqrt(np.mean(((active[:,5]-active[:,6])*1000)**2))])
        out.append(dict(name=spec['name'],raw=str(raw),rawSHA256=sha(raw),decoded=str(decoded),decodedSHA256=sha(decoded),
                        dt=dt,u=u,idx=idx,observed=obs,weights=weights,active=active,at=at,pitch=pitch,targets=targets))
    return out
def rollout(theta,data):
    theta=contig(theta);lib=oldlib if len(theta)==9 else newlib
    positions=np.full((20000,2),np.nan)
    n=lib.model_rollout(20000,data['dt'],data['u'],np.zeros(2),np.zeros(2),theta,positions)
    return n==20000,positions,n
def residual(theta,records):
    blocks=[]
    for weight,d in zip(protocol['recordWeights'],records):
        valid,p,n=rollout(theta,d)
        if not valid:return None
        e=(p[d['idx']]-d['observed'])*1000
        w=np.sqrt(weight)*d['weights']/np.sqrt(sum(d['dt']))
        blocks.extend([w*e.mean(axis=1)/protocol['waveformScale_mm'][0],w*(e[:,0]-e[:,1])/protocol['waveformScale_mm'][1]])
        native=p[d['at']]
        metrics=np.array([np.sqrt(np.mean(((native.mean(axis=1)-d['active'][:,3])*1000)**2)),np.sqrt(np.mean(((native[:,0]-native[:,1])*1000)**2))])
        blocks.append(np.sqrt(weight)*(metrics/d['targets']-1)/protocol['metricRelativeScale'])
    scales=np.array(protocol['parameterScales'][:len(theta)])
    return np.r_[*blocks,np.sqrt(1e-8)*np.array(theta)/scales]
def waveform(e):
    return {'axisRMSE_mm':np.sqrt(np.mean(e*e,axis=0)).tolist(),
            'meanPositionRMSE_mm':float(np.sqrt(np.mean(e.mean(axis=1)**2))),
            'syncRMSE_mm':float(np.sqrt(np.mean((e[:,0]-e[:,1])**2)))}
def describe(theta,d):
    valid,p,n=rollout(theta,d);assert valid
    continuous=p[d['at']];mapped=np.round(np.sign(continuous)*np.floor(np.abs(continuous/d['pitch'])+.5)*d['pitch'],6)
    actual=d['active'][:,5:7];ref=d['active'][:,3]
    tracking=float(np.sqrt(np.mean(((mapped.mean(axis=1)-ref)*1000)**2)))
    sync=float(np.sqrt(np.mean(((mapped[:,0]-mapped[:,1])*1000)**2)))
    error=(mapped-actual)*1000;fullerror=(p[d['idx']]-d['observed'])*1000
    return {'record':d['name'],'nativeSamples':len(d['at']),'actualTrackingRMSE_mm':float(d['targets'][0]),
            'modeledTrackingRMSE_mm':tracking,'actualSyncRMS_mm':float(d['targets'][1]),'modeledSyncRMS_mm':sync,
            'trackingRelativeDifference_percent':100*(tracking/d['targets'][0]-1),
            'syncRelativeDifference_percent':100*(sync/d['targets'][1]-1),
            'nativeWaveformError':waveform(error),'all8300EndpointWaveformError':waveform(fullerror),
            'phaseErrors':[{'phase':phase,'samples':int(sum(d['active'][:,2]==phase)),
                            'waveformError':waveform(error[d['active'][:,2]==phase])} for phase in [2,3,4,5]],
            'nativeContinuousPosition_m':continuous.tolist(),
            'returnHoldFinalTrackingError_mm':float((mapped[-1].mean()-ref[-1])*1000),
            'actualReturnHoldFinalTrackingError_mm':float((actual[-1].mean()-ref[-1])*1000),
            'initialStateOnce':True,'measuredStateInjected':False,'recordUsedForCalibration':True}
