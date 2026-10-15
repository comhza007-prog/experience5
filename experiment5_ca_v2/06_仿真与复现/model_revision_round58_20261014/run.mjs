import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
const dir=path.dirname(fileURLToPath(import.meta.url));
const result=spawnSync('C:/Users/ele/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe',['-X','utf8',path.join(dir,'revise.py')],{env:{...process.env,PYTHONUTF8:'1'},encoding:'utf8',maxBuffer:10e6});
if(result.status!==0){fs.writeFileSync(path.join(dir,'failed_attempt.txt'),result.stderr+'\n'+result.stdout,{flag:'wx'});throw new Error(result.stderr);}
const data=JSON.parse(result.stdout);
// Original metadata-encoding attempt is retained; this is the exact same
// deterministic fit/rollout with Unicode I/O corrected, not another model.
const before=JSON.parse(fs.readFileSync(path.join(dir,'candidate_verification.json'),'utf8'));
assert.deepEqual(data.fit,before.fit);
assert.deepEqual(data.rollouts,before.rollouts);
for(const source of [data.trainingSource,data.retrospectiveCrossMethodSource])assert(fs.existsSync(source.source)&&fs.existsSync(source.raw));
data.firstAttemptUnicodeMetadataCorrupted=true;
data.sameFitAndRolloutsExactlyReproducedAfterUTF8Fix=true;
fs.writeFileSync(path.join(dir,'candidate_verification_final.json'),JSON.stringify(data,null,2),{flag:'wx'});
console.log(JSON.stringify({...data,rollouts:data.rollouts.map(({positionsPredicted_m,sampleTimes_s,...r})=>r)},null,2));
