import test from'node:test';import assert from'node:assert/strict';
import{specialtyPoiRows,specialtyDiagnostics}from'../web/specialty-diagnostics.js';
import{progressPresentation}from'../web/report-state-ui.js';
import{radarTooltipPosition}from'../web/radar-presentation.js';
import{createAnalysisArchive}from'../server/analysis-archive.mjs';import{mkdtemp,mkdir,writeFile}from'node:fs/promises';import{join}from'node:path';import{createHash}from'node:crypto';
const origin={location:{lng:120,lat:30},uid:null};
const tree={categories:[{id:'medical',subtypes:[{id:'pharmacy',label:'药店'}]}],specialtySubtypeIds:['pharmacy']};
const job={analysis:{origin}};
const route=(id,distance=400)=>({routeStatus:'ok',mode:'walking',coordinateSystem:'BD-09LL',origin:origin.location,originUid:null,identityKey:'uid:'+id,facilityUid:id,destinationUid:id,distanceMeters:distance,durationSeconds:600,geometry:{type:'LineString',coordinates:[[120,30],[120.001,30.001]]}});
const poi=(id,subtypeIds=['pharmacy'],r=route(id))=>({uid:id,identityKey:'uid:'+id,name:id,location:{lng:120.001,lat:30.001},subtypeIds,routeEvidence:r});
test('specialty filter retains every confirmed matching POI, deduplicates repeated identities and excludes pending/nonbound/over15 evidence',()=>{
 const d=specialtyDiagnostics(job,tree),invalid=route('wrong');invalid.origin={lng:121,lat:30};
 const rows=specialtyPoiRows(job,[poi('a'),poi('b'),poi('a'),poi('pending',[]),poi('wrong',['pharmacy'],invalid),poi('over',['pharmacy'],route('over',1201)),poi('edge',['pharmacy'],route('edge',1200)),poi('mismatch',['pharmacy'],route('other'))],d);
 assert.deepEqual(rows.map(r=>r.identityKey),['uid:a','uid:b','uid:edge']);assert.equal(specialtyDiagnostics(job,tree)[0].status,'unknown','displaying cached POIs must not rewrite the dedicated diagnosis');
});
test('progress uses phase counters, handles zero/missing/out-of-bounds counters without inventing totals',()=>{
 const p=progressPresentation({phase:'reference_walking_sampling',completed:16,total:36});assert.equal(p.percent,44);assert.equal(p.counter,'已完成 16 / 36 个方向');assert.deepEqual(p.states,['active','active','pending','pending']);
 assert.equal(progressPresentation({phase:'queued'}).percent,null);assert.equal(progressPresentation({completed:5,total:0}).percent,null);assert.equal(progressPresentation({completed:37,total:36}).percent,null);
 const done=progressPresentation({phase:'circle_poi_routes',completed:98,total:98});assert.equal(done.percent,100);assert.deepEqual(done.states,['done','done','active','pending']);
});
test('radar tooltip stays beside the selected icon and inside chart bounds',()=>{
 const areas=[{id:'radar-icon-medical',x:15,y:140,w:30,h:30},{id:'radar-icon-leisure',x:480,y:140,w:30,h:30}];
 assert.deepEqual(radarTooltipPosition({id:'medical'},areas,530,360,[170,110]),[57,100]);assert.deepEqual(radarTooltipPosition({id:'leisure'},areas,530,360,[170,110]),[298,100]);
 const p=radarTooltipPosition({id:'medical'},areas,240,260,[190,120]);assert.ok(p[0]>=8&&p[0]+190<=232);
});
test('hash checked presentation archive retains real direction geometries on repeated UI reads',async()=>{
 const root=await mkdtemp(join(process.cwd(),'tmp/ui32-archive-')),dir=join(root,'data/validation-runs/ui31-20261012T081356231Z');await mkdir(dir,{recursive:true});const id='fa-12345678-1234-1234-1234-123456789abc',samples=[{sector:0,geometry:{type:'LineString',coordinates:[[120,30],[120.01,30]]}}],saved={analysisId:id,status:'partial',analysis:{categories:[]},score:{},presentationOnly:true,categoryMappingVersion:'facility-categories-v8',heatSamples:samples},report={analysisId:id,categoryMappingVersion:saved.categoryMappingVersion};
 const manifest={analysisId:id,sha256:{}};for(const[name,value]of[['job.json',saved],['report.json',report]]){const text=JSON.stringify(value);await writeFile(join(dir,name),text);manifest.sha256[name]=createHash('sha256').update(text).digest('hex');}await writeFile(join(dir,'manifest.json'),JSON.stringify(manifest));
 const archive=createAnalysisArchive(root);for(let i=0;i<2;i++){const j=(await archive.find(id,{view:'ui'})).job;assert.deepEqual(j.heatSamples,samples);assert.equal(j.presentationOnly,true);assert.equal(j.archiveReplay,true);}assert.equal(await archive.find('fa-00000000-0000-0000-0000-000000000000'),null);
});
