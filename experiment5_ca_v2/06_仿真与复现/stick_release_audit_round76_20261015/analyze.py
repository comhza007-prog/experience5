import csv,hashlib,json
from pathlib import Path
import numpy as np
from numpy.lib.stride_tricks import sliding_window_view

HERE=Path(__file__).resolve().parent;ROOT=HERE.parents[1];SIM=ROOT/'06_仿真与复现'
sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
protocol=json.loads((HERE/'protocol.json').read_text(encoding='utf-8'))
primary=json.loads((SIM/'q2_mechanical_recheck_round73_20261015/frozen_model_evaluation.json').read_text(encoding='utf-8'))
training=json.loads((SIM/'t1_training_fit_round72_20261015/fit_results.json').read_text(encoding='utf-8'))
sources=[];results=[]
for kind,relative in zip(['T1','newQ2'],protocol['sources']):
    p=SIM/relative;d=json.loads(p.read_text(encoding='utf-8'))
    raw=Path(d.get('source',d.get('capture_audit',{}).get('source')))
    expected=d.get('sourceSHA256',d.get('capture_audit',{}).get('sourceSHA256'))
    assert sha(raw)==expected
    with raw.open(newline='',encoding='utf-8-sig') as f:
        r=csv.reader(f);assert next(r)==[f'I{k}' for k in range(107)]
        allrows=np.array([[float(v) for v in row] for row in r])
    cuts=np.flatnonzero((np.diff(allrows[:,0])<=0)|(np.diff(allrows[:,1])<=0)).tolist()
    assert cuts==([] if kind=='T1' else [0]);live=allrows if kind=='T1' else allrows[1:]
    active=live[(live[:,106]==1)&(live[:,2]>=2)&(live[:,2]<=5)]
    if kind=='T1':
        pred=np.array(next(r for r in training['cases'] if r['record']=='T1' and r['case']=='frozenT1Refit')['nativeContinuousPosition_m'])
    else:pred=np.array(primary['evaluatedModels'][1]['nativeContinuousAxisPosition_m'])
    assert pred.shape==(400,2)
    pitch=d['header']['configured_meters_per_count']
    mapped=np.sign(pred)*np.floor(np.abs(pred/pitch)+.5)*pitch;mapped=np.round(mapped,6)
    sync_error=(mapped[:,0]-mapped[:,1]-active[:,5]+active[:,6])*1000
    sources.append({'record':kind,'decoded':str(p),'decodedSHA256':sha(p),'raw':str(raw),'rawSHA256':expected})
    phases=[]
    for phase,start,anchor,step0 in [(2,0,99,4000),(4,4000,149,10000)]:
        rows=d['fast'][start:start+4000]
        enc=np.array([d['slow'][anchor]['encoder']]+[r['encoder'] for r in rows],int)
        t=np.array([d['slow'][anchor]['actual_us']]+[r['actual_us'] for r in rows])/1000
        u=np.array([r['command_counts'] for r in rows],float)
        phase_mask=active[:,2]==phase;native=active[phase_mask];native_error=sync_error[phase_mask]
        endpoint=native[:,46].astype(int)-1-step0
        axis_stats=[];masks={};events=[]
        for width in protocol['windowSteps']:
            encoder_windows=sliding_window_view(enc,width+1,axis=0)
            ranges=np.ptp(encoder_windows,axis=2)
            command_windows=sliding_window_view(np.abs(u),width,axis=0)
            mean_abs=np.mean(command_windows,axis=2)
            assert len(ranges)==len(mean_abs)==4001-width
            low=ranges<=protocol['rangeMaximumCounts'];loaded=low&(mean_abs>=protocol['commandPresenceMeanAbsCounts'])
            masks[width]=(low,loaded)
            for axis in [0,1]:
                nonoverlap_end=np.arange(width,4001,width)
                rows_index=nonoverlap_end-width
                valid_native=endpoint>=width;indices=endpoint[valid_native]-width
                sse=native_error[valid_native]**2
                axis_stats.append({'axis':axis,'windowSteps':width,'actualDurationRange_ms':[float(np.min(t[width:]-t[:-width])),float(np.max(t[width:]-t[:-width]))],
                    'overlapWindows':len(low),'lowMotionOverlapWindows':int(low[:,axis].sum()),'loadedLowMotionOverlapWindows':int(loaded[:,axis].sum()),
                    'nonoverlapWindows':len(rows_index),'lowMotionNonoverlapWindows':int(low[rows_index,axis].sum()),'loadedLowMotionNonoverlapWindows':int(loaded[rows_index,axis].sum()),
                    'nativeSamplesWithFullPriorWindow':int(valid_native.sum()),'nativeSamplesWithoutFullPriorWindow':int((~valid_native).sum()),
                    'nativeLowMotionSamples':int(low[indices,axis].sum()),'nativeLoadedLowMotionSamples':int(loaded[indices,axis].sum()),
                    'nativeSyncErrorSSEInLowMotion_percent':float(100*sse[low[indices,axis]].sum()/sse.sum()),
                    'nativeSyncErrorSSEInLoadedLowMotion_percent':float(100*sse[loaded[indices,axis]].sum()/sse.sum())})
        low,loaded=masks[50]
        for axis in [0,1]:
            candidates=[]
            for end in range(50,3981):
                j=end-50
                if not low[j,axis]:continue
                future=int(enc[end+20,axis]-enc[end,axis])
                if abs(future)<5:continue
                request=u[end-50:end,axis]
                sign_fraction=max(np.mean(request>0),np.mean(request<0))
                candidates.append({'endpointStep':end,'phaseTime_ms':float(t[end]-t[0]),
                    'priorRange_counts':int(np.ptp(enc[end-50:end+1,axis])),
                    'priorMeanAbsCommand_counts':float(np.mean(np.abs(request))),'priorMeanCommand_counts':float(np.mean(request)),
                    'commandMajoritySignFraction':float(sign_fraction),'future20stepDisplacement_counts':future,
                    'otherAxisPriorDisplacement_counts':int(enc[end,1-axis]-enc[end-50,1-axis]),
                    'loadedSignConsistent':bool(loaded[j,axis] and sign_fraction>=protocol['signConsistencyMinimum']),
                    'nearPhaseBoundary250steps':bool(end<=250 or end>=3750)})
            clusters=[]
            for candidate in candidates:
                if clusters and candidate['endpointStep']==clusters[-1][-1]['endpointStep']+1:clusters[-1].append(candidate)
                else:clusters.append([candidate])
            chosen=[cluster[-1] for cluster in clusters]
            events.append({'axis':axis,'overlapReleaseCandidates':len(candidates),'releaseClusters':len(chosen),
                'loadedSignConsistentClusters':sum(r['loadedSignConsistent'] for r in chosen),
                'interiorLoadedClusters':sum(r['loadedSignConsistent'] and not r['nearPhaseBoundary250steps'] for r in chosen),
                'events':chosen,'clusteringRule':'Consecutive candidate endpoints, last endpoint retained; all clusters reported.'})
        union=[]
        for width in [20,50]:
            low,loaded=masks[width];valid=endpoint>=width;j=endpoint[valid]-width;sse=native_error[valid]**2
            union.append({'windowSteps':width,'validNativeSamples':int(valid.sum()),'missingPriorWindowNativeSamples':int((~valid).sum()),
                'anyAxisLowMotionNativeSamples':int(np.any(low[j],axis=1).sum()),'anyAxisLoadedLowMotionNativeSamples':int(np.any(loaded[j],axis=1).sum()),
                'syncPredictionSSEInAnyAxisLowMotion_percent':float(100*sse[np.any(low[j],axis=1)].sum()/sse.sum()),
                'syncPredictionSSEInAnyAxisLoadedLowMotion_percent':float(100*sse[np.any(loaded[j],axis=1)].sum()/sse.sum())})
        phases.append({'phase':phase,'movingRows':4000,'encoderPitch_mm':pitch*1000,
            'single1msZeroIncrementFractions':np.mean(np.diff(enc,axis=0)==0,axis=0).tolist(),
            'windowAxisDiagnostics':axis_stats,'windowUnionNativeErrorDiagnostics':union,'releaseEvents':events,
            'rawCountsRetainedNotConvertedToExactVelocity':True})
    results.append({'record':kind,'phases':phases})
    assert sha(raw)==expected
out={'date':'2026-10-15','protocolSHA256':sha(HERE/'protocol.json'),'scriptSHA256':sha(__file__),
    'sources':sources,'records':results,'modelsFitted':0,'frictionParametersIdentified':False,
    'newQ2UsedForCalibration':False,'controllerChanged':False,'rawChanged':False,'newPhysicalRunReleased':False,'modelClosureComplete':False}
with (HERE/'audit_results.json').open('x',encoding='utf-8') as f:json.dump(out,f,ensure_ascii=False,indent=2,allow_nan=False)
print(json.dumps({'records':[{'record':r['record'],'phases':[{'phase':p['phase'],'zeroIncrementFraction':p['single1msZeroIncrementFractions'],
    'nativeUnion':p['windowUnionNativeErrorDiagnostics'],'releaseEvents':p['releaseEvents']} for p in r['phases']]} for r in results]},ensure_ascii=False))
