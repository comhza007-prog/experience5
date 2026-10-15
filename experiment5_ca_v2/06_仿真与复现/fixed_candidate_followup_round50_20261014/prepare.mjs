import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
const here=path.dirname(fileURLToPath(import.meta.url)),root=path.resolve(here,'../..');
const sha=f=>crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const p=JSON.parse(fs.readFileSync(path.join(here,'protocol.json'),'utf8'));
const previous=JSON.parse(fs.readFileSync(path.join(root,p.sourceVerification),'utf8'));
const records=[];
for(const [name,m] of Object.entries(p.methods)) {
  const before=previous.records.find(r=>r.method===name);assert(before);
  const project=path.join(root,p.codeRoot,m.project);assert.equal(project,before.project);
  const sourceRoot=path.resolve(project,'../..');
  for(const [f,h] of Object.entries(before.sourceHashes))assert.equal(sha(path.join(sourceRoot,f)),h,'Frozen source changed: '+f);
  assert.equal(sha(before.hex),m.hexSHA256);assert.equal(sha(before.axf),before.axfSHA256);
  const folder=path.join(root,p.dataRoot,m.subfolder);fs.mkdirSync(folder,{recursive:true});
  records.push({method:name,build:m.build,project,target:m.target,hexSHA256:sha(before.hex),axfSHA256:sha(before.axf),
                sourceFilesChecked:Object.keys(before.sourceHashes).length,sourceChanged:false,dataFolder:folder});
}
const order=p.order.map(item=>{
  const method=p.methods[item.method],savePath=path.join(root,p.dataRoot,method.subfolder,item.filename);
  assert(!fs.existsSync(savePath),'Existing data file; do not overwrite');
  return {...item,build:method.build,project:path.join(root,p.codeRoot,method.project),savePath};
});
assert.equal(order.length,4);assert.equal(new Set(order.map(x=>x.savePath)).size,4);
for(let i=1;i<=2;i++)assert.deepEqual(order.filter(x=>x.block===i).map(x=>x.method).sort(),['BLNN','S3R2']);
assert.deepEqual(order.map(x=>x.method),['S3R2','BLNN','BLNN','S3R2']);
const result={date:p.date,allPassed:true,protocolSHA256:sha(path.join(here,'protocol.json')),preparationCodeSHA256:sha(fileURLToPath(import.meta.url)),
  previousVerificationSHA256:sha(path.join(root,p.sourceVerification)),records,order,preparedFreshBlocks:2,preparedFreshRuns:4,
  previewExcludedFromFreshPrimarySummary:true,previousTenRunPlanSuspended:true,algorithmChanged:false,
  sourceChanged:false,newCompile:false,assistantFlashed:false,hardwareAPIAccess:false,physicalRecordsCollected:0};
fs.writeFileSync(path.join(here,'manifest.json'),JSON.stringify(result,null,2),{flag:'wx'});
console.log(JSON.stringify(result,null,2));
