import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
const dir=path.dirname(fileURLToPath(import.meta.url)),root=path.resolve(dir,'../..'),mode=process.argv[2]||'host';
const parent=path.join(root,'05_实验代码/模型闭环_Q2_误差汇总40s_20261015/eassy_E5ID_Q2S_BLNN_HW6');
const fresh=path.join(root,'05_实验代码/辨识T1_全运动段_20261015/eassy_E5ID_T1F_BLNN_HW6'),task=path.join(fresh,'Task');
const read=p=>fs.readFileSync(p,'utf8').replaceAll('\r\n','\n'),hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const changed=['Task/motor_task.c','Task/identification_trace.h','Task/experiment5_formal_config.h'];let unchanged=0;
function walk(rel){for(const f of fs.readdirSync(path.join(parent,rel),{withFileTypes:true})){const next=path.posix.join(rel,f.name);if(f.isDirectory())walk(next);else if(!changed.includes(next)){assert.equal(hash(path.join(parent,next)),hash(path.join(fresh,next)),next);unchanged++;}}}
for(const p of ['Task','Core','Drivers','Middlewares','CAN-control'])walk(p);
assert.equal(hash(path.join(task,'identification_excitation.h')),hash(path.join(root,'05_实验代码/辨识T1_训练采集_20261014/eassy_E5ID_T1M_BLNN_HW6/Task/identification_excitation.h')));
assert.equal(hash(path.join(dir,'baseline_core.inc')),hash(path.join(task,'blnn_core.c')));
const old=read(path.join(parent,'Task/motor_task.c')),motor=read(path.join(task,'motor_task.c'));
function block(s,a,b){const i=s.indexOf(a),j=s.indexOf(b,i);assert(i>=0&&j>i,a);return s.slice(i,j);}
for(const [a,b] of [['static uint32_t health(','void motor_task('],['        /* VOFA-only serial ownership','        if(g_exp5_abort) fault|=32U;'],['        if(g_exp5_abort) fault|=32U;','        if(armed && !done && !fault) {'],['        /* Check time budget BEFORE enqueueing','        channels[0]'],['        whole_us=(float)(DWT->CYCCNT-begin)/cycles_per_us;\n        if(whole_us>=950.0f)','        id_pending=']])assert.equal(block(old,a,b),block(motor,a,b),'Guard/filter/arming/stop changed');
const priorTrace=read(path.join(parent,'Task/identification_trace.h')),trace=read(path.join(task,'identification_trace.h'));
assert.equal(block(priorTrace,'static int id_collect(','static void id_seal('),block(trace,'static int id_collect(','/* Nibble per preceding command interval:'),'Original recorder collection changed');
assert.equal(block(priorTrace,'static int id_allow_output(','#endif'),block(trace,'static int id_allow_output(','#endif'),'Original fault gating/CRC export changed');
assert.equal(read(path.join(parent,'MDK-ARM/eassy.uvprojx')).replaceAll('exp5ID_Q2S_BLNN_HW6','exp5ID_T1F_BLNN_HW6'),read(path.join(fresh,'MDK-ARM/eassy.uvprojx')));
assert.equal(read(path.join(parent,'MDK-ARM/eassy.uvoptx')).replaceAll('exp5ID_Q2S_BLNN_HW6','exp5ID_T1F_BLNN_HW6'),read(path.join(fresh,'MDK-ARM/eassy.uvoptx')));
assert(read(path.join(task,'experiment5_formal_config.h')).includes('#define E5_SELECTED_BUILD 68112U'));
const env={...process.env,PATH:'D:/MinGW/mingw64/bin;'+process.env.PATH},checks=[];
function run(cmd,args){const r=spawnSync(cmd,args,{cwd:dir,env,encoding:'utf8',maxBuffer:2e6});assert.equal(r.status,0,r.stdout+r.stderr);if(r.stdout.trim())checks.push(r.stdout.trim());}
if(mode==='host'){
 for(const precision of ['float','double']){
  const exe=path.join(dir,'test_excitation_'+precision+'.exe');
  run('D:/MinGW/mingw64/bin/gcc.exe',['-std=c99','-O2','-Wall','-Wextra','-Werror','-Wno-unused-function',...(precision==='double'?['-DE5_USE_DOUBLE']:[]),'-I',task,'test_excitation.c','baseline_wrapper.c',path.join(task,'blnn_core.c'),'-lm','-o',exe]);run(exe,[]);
 }
 for(const test of ['native','summary']){
  run('D:/MinGW/mingw64/bin/gcc.exe',['-std=c99','-O2','-Wall','-Wextra','-Werror','-Wno-unused-function','-I',task,'test_'+test+'.c','-lm','-o','test_'+test+'.exe']);
  run(path.join(dir,'test_'+test+'.exe'),test==='native'?['native.bin','expected.csv']:[]);
 }
 run(process.execPath,['test_decode.mjs']);run(process.execPath,['../identification_q0_safe_encoding_round44_20261014/test_encoding.mjs']);
 if(!fs.existsSync(path.join(dir,'request_manifest.json')))run(process.execPath,['manifest.mjs']);
 const a=fs.readFileSync(path.join(dir,'native.bin')),b=fs.readFileSync(path.join(root,'06_仿真与复现/identification_q2_summary40s_round61_20261015/native.bin'));
 assert(a.subarray(8,70944).equals(b.subarray(8)),'Original70944B recorder fields differ beyond version/build');
 const result={passed:true,build:68112,schema:4500,magic:4445,unchangedSourceFiles:unchanged,guardFilterArmingStopBlocksExact:true,excitationHeaderByteExact:true,
    originalRecordingAndSafeExportExact:true,originalSummaryUARTHeadersExact:true,originalPrefixSameExceptVersionBuild:true,
    checks,protocolSHA256:hash(path.join(dir,'protocol.json')),requestManifestSHA256:hash(path.join(dir,'request_manifest.json')),
    sourceHashes:Object.fromEntries([...changed,'Task/identification_excitation.h'].map(p=>[p,hash(path.join(fresh,p))])),assistantHardwareActions:false};
 fs.writeFileSync(path.join(dir,'host_verification.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(result,null,2));
}else if(mode==='linked'){
 const host=JSON.parse(read(path.join(dir,'host_verification.json')));assert(host.passed);
 for(const [p,h]of Object.entries(host.sourceHashes))assert.equal(hash(path.join(fresh,p)),h,'Post-host source change');
 const target='exp5ID_T1F_BLNN_HW6',build=path.join(fresh,'MDK-ARM',target),axf=path.join(build,target+'.axf'),hex=path.join(build,target+'.hex');
 assert(read(path.join(fresh,'MDK-ARM/T1F_build01.log')).includes('0 Error(s), 0 Warning(s).'));
 for(const p of Object.keys(host.sourceHashes))assert(fs.statSync(path.join(fresh,p)).mtimeMs<=fs.statSync(axf).mtimeMs,'Stale binary '+p);
 const map=read(path.join(build,target+'.map')),ram=map.match(/Execution Region RW_IRAM1[^\n]*Size: 0x([0-9a-f]+), Max: 0x([0-9a-f]+)/i);assert(ram);
 const used=parseInt(ram[1],16),max=parseInt(ram[2],16);assert(max-used>=3072,'LinkedRAM below3072B margin');
 assert(/identification_trace\s+0x[0-9a-f]+\s+Data\s+75076/i.test(map));assert(/identification_symbols\s+0x[0-9a-f]+\s+Data\s+64/i.test(map));
 run('D:/Keil_v5/ARM/ARMCC/bin/fromelf.exe',['--bin','--output',path.join(dir,'linked.bin'),axf]);
 let high=0,lo=Infinity,hi=0;const regions=[];
 for(const l of read(hex).trim().split('\n')){const b=Buffer.from(l.slice(1).trim(),'hex');assert.equal([...b].reduce((a,x)=>a+x,0)&255,0);const n=b[0],type=b[3],address=b.readUInt16BE(1);if(type===4)high=b.readUInt16BE(4)*65536;else if(type===0){const at=high+address;lo=Math.min(lo,at);hi=Math.max(hi,at+n);regions.push([at,b.subarray(4,4+n)]);}}
 assert.equal(lo,0x08000000);const image=Buffer.alloc(hi-lo);for(const[at,b]of regions)b.copy(image,at-lo);assert(image.equals(fs.readFileSync(path.join(dir,'linked.bin'))),'AXFHEX mismatch');
 const result={...host,project:path.join(fresh,'MDK-ARM/eassy.uvprojx'),target,hex,hexSHA256:hash(hex),compileErrors:0,compileWarnings:0,
    blobBytes:74988,traceBytes:75076,RAM:{used,max,remaining:max-used},AXFHEXByteExact:true,
    hardwareReleasedForOneManualTrainingTrial:true,onBoardTimingQualified:false,physicalRunsCollected:0,modelIdentified:false,
    independentValidationReleased:false,formalBatchReleased:false};
 fs.writeFileSync(path.join(dir,'verification.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({passed:true,project:result.project,target,hexSHA256:result.hexSHA256,RAM:result.RAM,build:68112,magic:4445,onBoardTimingQualified:false},null,2));
}else throw Error('Choose host/linked');
