import{readFileSync}from'node:fs';
export const specialtyTree=JSON.parse(readFileSync(new URL('../../data/facility-categories-v8.json',import.meta.url),'utf8'));
export const specialtyIds=['market','pharmacy','primary_school'];
export function isolationFixture(){
 const origin={uid:'origin',location:{lng:120,lat:30}},categories=specialtyTree.categories.map(g=>({categoryId:g.id,subtypeResults:g.subtypes.map(s=>({subtypeId:s.id,searchComplete:false,searchTruncated:true,searchStatus:'partial',confirmedCandidateCount:0,pendingClassificationCount:0,invalidCandidateCount:0,candidateDiagnostics:[],routes:[],searchPages:[{keyword:s.searchQueries.join('$'),shardId:'root',pageNum:0,reportedTotal:0,returned:0}],searchErrors:[{keyword:'无关辅助查询',code:'premature_page_end'}]}))}));
 return{version:8,categoryMappingVersion:specialtyTree.version,origin,mode:'walking',thresholdSeconds:900,searchRadiusMeters:3000,searchWindow:{center:origin.location},observedAt:'2026-10-15T00:00:00Z',categories,poiMarkers:[]};
}
export const specialtySub=(a,id)=>a.categories.flatMap(g=>g.subtypeResults).find(s=>s.subtypeId===id);
export function addSpecialtyCandidate(a,id,distanceMeters,{duplicate=false,pending=false}={}){
 const definition=specialtyTree.categories.flatMap(g=>g.subtypes).find(s=>s.id===id),location={lng:120.004,lat:30},naviLocation={lng:120.0041,lat:30},p={uid:'poi-'+id,identityKey:'uid:poi-'+id,name:definition.label+'测试设施',rawCategory:definition.rawCategoryHints[0],location,naviLocation,subtypeIds:pending?[]:[id]},route={identityKey:p.identityKey,facilityUid:p.uid,destinationUid:p.uid,location,origin:a.origin.location,originUid:a.origin.uid,destination:naviLocation,routeStatus:'ok',mode:'walking',coordinateSystem:'BD-09LL',distanceMeters,durationSeconds:distanceMeters*.75,modelDurationSeconds:distanceMeters*.75,walkingModelId:'walking80-v1',entranceVerification:{knownTargets:1,attempted:1,complete:true}};
 p.circleRouteEvidence=route;a.poiMarkers.push(p);if(duplicate)a.poiMarkers.push({...p,identityKey:'duplicate-alias'});
 const sub=specialtySub(a,id);if(pending){sub.pendingClassificationCount=1;sub.candidateDiagnostics=[{...p,classification:{candidateStatus:'pending_review'}}];}else{sub.confirmedCandidateCount=1;sub.routes=[{...route,subtypeId:id,categoryId:specialtyTree.categories.find(g=>g.subtypes.some(s=>s.id===id)).id,classification:{candidateStatus:'confirmed_by_rule'}}];}return p;
}
