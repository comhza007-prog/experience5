"""Compact source-backed handoff; no raw or model overwrite."""
import json
from predict import HERE,sha
read=lambda p:json.loads((HERE/p).read_text(encoding='utf-8'))
frozen=read('frozen_predictions.json');motor=read('motor_block_parameters.json');fit=read('plant_fit_results.json');protocol=read('next_capture_protocol.json');capture=read('capture_manifest.json')
table=[]
for i in range(1,6):
    name=f'M1_run{i:02d}';rows=[r for r in frozen['results'] if r['record']==name]
    table.append(dict(record=name,actualTrackingRMSE_mm=rows[0]['actualTrackingRMSE_mm'],actualSyncRMS_mm=rows[0]['actualSyncRMS_mm'],
        frozen=[{k:r[k] for k in ['model','predictedTrackingRMSE_mm','predictedSyncRMS_mm','trackingDifference_percent','syncDifference_percent','bothWithin15Percent']} for r in rows],
        motorRefit=next(r for r in fit['cases'] if r['record']==name and r['case']=='motor_refit_candidate')))
out=dict(status='Five captures usable with documented recording limitations; old models fail aggregate prediction; exploratory motor candidate fitted and frozen, not adopted as final model',
    records=table,frozenModelsBothMetricsPassCounts={label:sum(r['bothWithin15Percent'] for r in frozen['results'] if r['model']==label) for label in ['R90','R86','R82']},
    captureQuality=dict(fiveSnapshotsCRCVerified=True,fourIdenticalCopiesEach=True,activeMetricSamplesEach=400,
        allMotionFaultsZero=True,strictFullRecordingProtocolsQualified=0,stoppedCRCPreparationMissingFramesEach=1,
        cachedPriorSessionRowsRuns=[1,3,4],CSVDecimalPrecisionHandledFromIntegerEncoderAndFrozenCReference=True),
    motorCurrentLOORMSEImprovement_percent=[a['improvement_percent'] for a in motor['axes']],
    motorTimeConstantGridBoundary_ms=10,motorConstantsPhysicallyIdentified=False,
    cumulativePlantDataLoss=dict(unchangedR90=fit['baselineLoss'],staticRefit=fit['fits']['static_refit_control']['loss'],motorRefit=fit['fits']['motor_refit_candidate']['loss'],
        motorVsStaticRefitImprovement_percent=100*(1-fit['fits']['motor_refit_candidate']['loss']/fit['fits']['static_refit_control']['loss'])),
    newM1MotorRefitBothMetricsPassCount=sum(r['motorRefit']['bothWithin15Percent'] for r in table),
    all12RecordsCalibration=True,oldNegativeOutcomesRetained=True,modelPhysicalValidationPassed=False,
    nextCaptureProtocol=str(HERE/'next_capture_protocol.json'),nextCaptureProtocolSHA256=sha(HERE/'next_capture_protocol.json'),
    nextRaw=protocol['newRawPath'],newPhysicalRunsRecommended=1,newFirmwareWritten=False,assistantHardwareAction=False,
    sources={p:sha(HERE/p) for p in ['capture_verification.json','frozen_predictions.json','motor_block_parameters.json','plant_fit_results.json','input_sensitivity.json','numerical_verification.json','model_parameters.json']})
with (HERE/'comparison_summary.json').open('x',encoding='utf-8') as f:json.dump(out,f,ensure_ascii=False,indent=2)
print(json.dumps(dict(summarySHA256=sha(HERE/'comparison_summary.json'),loss=out['cumulativePlantDataLoss']),ensure_ascii=False))
