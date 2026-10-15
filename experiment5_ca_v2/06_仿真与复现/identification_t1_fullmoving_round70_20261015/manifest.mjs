import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import crypto from 'node:crypto';import {fileURLToPath} from 'node:url';
const dir=path.dirname(fileURLToPath(import.meta.url));const header=path.resolve(dir,'../../05_实验代码/辨识T1_全运动段_20261015/eassy_E5ID_T1F_BLNN_HW6/Task/identification_excitation.h');
function symbols(seed){let state=seed&31;if(!state)state=1;const s=[];for(let i=0;i<31;i++){s.push(state&1?1:-1);state=(state>>1)|((((state>>0)^(state>>2))&1)<<4);}s.push(-1);return s;}
const tables=[symbols(39),symbols(3*39+1)],requests=[];
for(const [phase,begin,direction] of [[2,4000,1],[4,10000,-1]])for(let local=0;local<4000;local++){
 const modal=[direction*20*tables[0][(Math.floor(local/32))&31],direction*10*tables[1][(Math.floor(local/16))&31]];
 requests.push([begin+local,phase,...modal,modal[0]+modal[1],-modal[0]+modal[1]]);
}
assert(requests.length===8000&&requests.every(r=>Math.abs(r[4])<=30&&Math.abs(r[5])<=30));
assert(requests.reduce((s,r)=>s+r[2],0)===0&&requests.reduce((s,r)=>s+r[3],0)===0);
const result={seed:39,profile:1,periodsNominal_ms:[32,16],symbolTables:tables,
 columns:['nominal_elapsed_ms','phase','ungated_common_counts','ungated_sync_counts','ungated_left_counts','ungated_right_counts'],
 requests,headerSHA256:crypto.createHash('sha256').update(fs.readFileSync(header)).digest('hex'),
 nominalScheduleNotActualTimeOrActualGatedExposure:true,actualRecordedSymbolsAuthoritative:true,notDeliveredForceOrExogeneityProof:true};
fs.writeFileSync(path.join(dir,'request_manifest.json'),JSON.stringify(result)+'\n',{flag:'wx'});console.log('Saved frozen nominal8000interval request manifest,seed39/profile1');
