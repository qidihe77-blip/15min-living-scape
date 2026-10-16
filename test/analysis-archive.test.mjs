import test from'node:test';import assert from'node:assert/strict';import{mkdtemp,mkdir,writeFile,rm}from'node:fs/promises';import{join,resolve,sep}from'node:path';import{createHash}from'node:crypto';import{createAnalysisArchive}from'../server/analysis-archive.mjs';
test('restart archive reads only matching hash-checked snapshots, clones output and keeps original classification/score',async()=>{
 const tmp=resolve('tmp');await mkdir(tmp,{recursive:true});const root=await mkdtemp(join(tmp,'archive-test-'));assert.ok(root.startsWith(tmp+sep));
 try{const id='fa-11111111-1111-4111-8111-111111111111',dir=join(root,'data/validation-runs/ui14-20261009T123456789Z');await mkdir(dir,{recursive:true});const job={analysisId:id,status:'partial',categoryMappingVersion:'facility-categories-v6',analysis:{version:6},score:{S_low:73.6,S_high:91.7}},report={analysisId:id,categoryMappingVersion:job.categoryMappingVersion};
  const files={'job.json':JSON.stringify(job),'report.json':JSON.stringify(report)};for(const[n,s]of Object.entries(files))await writeFile(join(dir,n),s);await writeFile(join(dir,'manifest.json'),JSON.stringify({sha256:Object.fromEntries(Object.entries(files).map(([n,s])=>[n,createHash('sha256').update(s).digest('hex')]))}));
  const archive=createAnalysisArchive(root),saved=await archive.find(id);assert.equal(saved.job.archiveReplay,true);assert.deepEqual(saved.job.score,job.score);saved.job.score.S_low=0;assert.equal((await archive.find(id)).job.score.S_low,73.6);assert.equal(await archive.find('../.env.local'),null);
  await writeFile(join(dir,'job.json'),JSON.stringify({...job,score:{S_low:5}}));assert.equal(await createAnalysisArchive(root).find(id),null);
 }finally{await rm(root,{recursive:true,force:true});}
});
