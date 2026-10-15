"""Offline two-record loading and memory-model interface. Import performs no fit."""
import ctypes,hashlib,json,sys
from pathlib import Path
import numpy as np
HERE=Path(__file__).resolve().parent;ROOT=HERE.parents[1]
PRIOR=HERE.parent/'motor_response_analysis_round93_20261015';sys.path.insert(0,str(PRIOR))
from predict import sha,contig,describe
arr=np.ctypeslib.ndpointer(dtype=np.float64,flags='C_CONTIGUOUS')
def library():
    lib=ctypes.CDLL(str(HERE/'native_model.dll'))
    lib.model_rollout.argtypes=[ctypes.c_int,arr,arr,arr,arr,arr,arr];lib.model_rollout.restype=ctypes.c_int
    lib.model_memory_step.argtypes=[arr,arr,ctypes.c_double,arr,arr];lib.model_memory_step.restype=ctypes.c_int
    return lib
def load():
    records=[]
    for folder,label,hashvalue in [('q2_r96_frozen_check_round97_20261015','run010','398164810d2ee0462d895a7b5927c4b990eeb5ffb20784017d362b53852df02b'),
        ('new_belt_frozen_check_round99_20261015','run011','e7e38ee5980fca58f656ac36ffe52d37b505909b4dee49e53acba25dbd306173')]:
        path=HERE.parent/folder/'capture_analysis.json';d=json.loads(path.read_text());assert sha(d['source'])==hashvalue
        assert d['capture_audit']['fullRecordingProtocolQualified'];dt=[];u=[];idx=[];obs=[];pitch=d['header']['configured_meters_per_count'];sign=np.array([1,-1])
        for mode,a,b in [('slow',0,100),('fast',0,4000),('slow',100,150),('fast',4000,8000),('slow',150,300)]:
            for r in d[mode][a:b]:
                n=40 if mode=='slow' else 1;dt.extend([r['dt_us']/n/1e6]*n);v=np.array(r['command_integral_counts_us'] if mode=='slow' else r['command_counts'])*sign
                if mode=='slow':v=v/r['dt_us']
                u.extend([v]*n);idx.append(len(dt)-1);obs.append(np.array(r['encoder'])*sign*pitch)
        s=d['metric_samples'];records.append(dict(name='new_belt_'+label,raw=d['source'],rawSHA256=hashvalue,decoded=str(path),decodedSHA256=sha(path),
            dt=contig(dt),u=contig(u),idx=np.array(idx),observed=np.array(obs),pitch=pitch,at=np.array([r['step'] for r in s]),
            ref=np.array([r['reference_m'] for r in s]),actual=np.array([r['position_m'] for r in s]),
            targets=np.array([d['capture_audit']['metrics']['trackingRMSE_mm'],d['capture_audit']['metrics']['syncRMS_mm']])))
    return records
def rollout(lib,z,d):
    out=np.full((20000,2),np.nan);n=lib.model_rollout(20000,d['dt'],d['u'],np.zeros(2),np.zeros(2),contig(z),out)
    return out if n==20000 else None
