import{readFile,readdir,lstat,realpath,open}from'node:fs/promises';import{join,resolve,sep}from'node:path';import{createHash}from'node:crypto';
import {uiSnapshot} from './ui-snapshot.mjs';
import {restoreWalkingBoundary}from'./restore-walking-boundary.mjs';
import{buildFacilityDisplay}from'./facility-display.mjs';
import{adaptiveBoundarySetting}from'./adaptive-directions.mjs';
import{reachabilityEvidence}from'./reachability-evidence.mjs';
import{serviceGapEvidence}from'./service-gap-evidence.mjs';
// Read-only, hash-checked actual validation snapshots. Never schedules or rescales a task.
export function createAnalysisArchive(rootDir,{adaptiveDirectionsEnabled=true}={}){
 const root=resolve(rootDir,'data/validation-runs'),cache=new Map();
 async function find(id,{view='full'}={}){
  if(!/^fa-[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/.test(id??''))return null;
  const result=saved=>view==='ui'?{job:structuredClone(saved.uiJob??=(saved.job.presentationOnly?saved.job:uiSnapshot(saved.job)))}:structuredClone({job:saved.job,report:saved.report});
  if(cache.has(id))return result(cache.get(id));
  let entries,base;try{base=await realpath(root);entries=await readdir(root,{withFileTypes:true});}catch{return null;}
  entries.sort((a,b)=>(b.name.match(/\d{8}T\d{9}Z$/)?.[0]??'').localeCompare(a.name.match(/\d{8}T\d{9}Z$/)?.[0]??''));
  for(const entry of entries.slice(0,1000)){if(!entry.isDirectory()||!/^ui(?:-v[56]|14|16|19|20|22|23|25|31|34|36|45|46|50|51|52|60)-\d{8}T\d{9}Z$/.test(entry.name))continue;
   try{const dir=join(root,entry.name),manifest=JSON.parse(await readFile(join(dir,'manifest.json'),'utf8'));
    if(manifest.analysisId&&manifest.analysisId!==id)continue;
    // Read a small prefix to skip other legacy IDs before their large SHA/JSON
    // work. A match is still accepted only after the complete hash checks below.
    if(!manifest.analysisId){const file=await open(join(dir,'job.json'),'r');let prefix;try{const buffer=Buffer.alloc(4096);const {bytesRead}=await file.read(buffer,0,4096,0);prefix=buffer.subarray(0,bytesRead).toString('utf8');}finally{await file.close();}const found=prefix.match(/"analysisId"\s*:\s*"(fa-[\da-f-]+)"/);if(found&&found[1]!==id)continue;}
    async function verified(name){const path=join(dir,name);if(!(await lstat(path)).isFile()||!(await realpath(path)).toLowerCase().startsWith((base+sep).toLowerCase()))throw Error('Invalid archive path');const text=await readFile(path,'utf8');if(createHash('sha256').update(text).digest('hex')!==manifest.sha256?.[name])throw Error('Archive hash mismatch');return JSON.parse(text);}
    const job=await verified('job.json');if(job.analysisId!==id||!['complete','partial'].includes(job.status)||!job.analysis||!job.score)continue;
    const report=await verified('report.json');if(report.analysisId!==id||report.categoryMappingVersion!==job.categoryMappingVersion)continue;
    const restored=adaptiveBoundarySetting(await restoreWalkingBoundary(job),adaptiveDirectionsEnabled),geometry=restored!==job?reachabilityEvidence(restored):null;
    if(Array.isArray(restored.analysis?.poiMarkers)&&Array.isArray(restored.analysis?.categories)&&restored.analysis.categories.every(g=>Array.isArray(g.subtypeResults)))restored.display=buildFacilityDisplay(restored);
    restored.serviceGapEvidence=serviceGapEvidence(restored);
    const saved={job:{...restored,archiveReplay:true},report:{...report,...(geometry?{geometry,geojson:geometry.geojson,rangeSamples:restored.rangeSamples,rangeDiagnostics:restored.rangeDiagnostics,display:restored.display}:{}),rangeDiagnostics:restored.rangeDiagnostics??report.rangeDiagnostics,archiveReplay:true}};if(cache.size>=32)cache.delete(cache.keys().next().value);cache.set(id,saved);return result(saved);
   }catch{/* Invalid/incomplete artifacts never become application results. */}
  }
  return null;
 }
 return{find};
}
