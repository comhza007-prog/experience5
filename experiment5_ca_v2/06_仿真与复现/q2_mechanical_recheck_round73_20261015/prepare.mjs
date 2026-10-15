import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
const dir=path.dirname(fileURLToPath(import.meta.url)),root=path.resolve(dir,'../..');
const sha=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const protocol=JSON.parse(fs.readFileSync(path.join(dir,'protocol.json'),'utf8'));
const prior=JSON.parse(fs.readFileSync(path.join(root,'06_仿真与复现/identification_q2_summary40s_round61_20261015/verification.json'),'utf8'));
assert.equal(sha(protocol.hex),protocol.hexSHA256);assert.equal(protocol.hexSHA256,prior.hexSHA256);
assert(fs.readFileSync(protocol.project,'utf8').includes('<TargetName>'+protocol.target+'</TargetName>'));
const code=path.resolve(path.dirname(protocol.project),'..');
const config=fs.readFileSync(path.join(code,'Task/experiment5_formal_config.h'),'utf8');
assert(/#define E5_SELECTED_METHOD 11U/.test(config)&&/#define E5_SELECTED_BUILD 68012U/.test(config)&&/#define E5_FORMAL_SCHEMA 4499U/.test(config));
const motor=fs.readFileSync(path.join(code,'Task/motor_task.c'),'utf8');
assert(!motor.includes('identification_excitation.h')&&!motor.includes('id_excitation_finalize'),'No T1 injection adapter');
const file=path.join(protocol.dataFolder,protocol.filename);assert(!fs.existsSync(file),'Do not overwrite an existing capture');
const oldQ2=path.join(protocol.dataFolder,'E5ID_Q2S_BLNN_B68012_HW6_L1200_R1200_M0g_S2mm_run01.csv');
assert.equal(sha(oldQ2),protocol.oldQ2SHA256);
const frozen=protocol.frozenModelPaths.map(p=>{const abs=path.join(root,p),v=JSON.parse(fs.readFileSync(abs,'utf8'));return {path:abs,SHA256:sha(abs),parameters:v.fit.parameters};});
const sourceFiles=['Task/motor_task.c','Task/blnn_core.c','Task/experiment5_formal_config.h','Task/identification_trace.h','Task/vofa_task.c','Task/experiment5_error_summary.h','Task/experiment5_error_wave.h'];
const result={prepared:true,protocolSHA256:sha(path.join(dir,'protocol.json')),build:68012,target:protocol.target,hexSHA256:sha(protocol.hex),
 oldQ2RawHashUnchanged:true,newRawDoesNotExist:true,frozenModels:frozen,
 currentSourceHashes:Object.fromEntries(sourceFiles.map(p=>[p,sha(path.join(code,p))])),
 noFirmwareEdited:true,noFlashingOrSerialPerformed:true,manualRunsApproved:1,modelsAccepted:false};
fs.writeFileSync(path.join(dir,'preparation.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(result,null,2));
