import{hasCategoryOnlyMembership}from'./facility-membership.js';
import{reportPresentation}from'./report-view.js';
import{facilityViewRows}from'./facility-view.js';
import{reachableFacilityRows,boundWalkingCost}from'./reachable-presentation.js';
import{decisionSeconds}from'./walking-model.js';
const same=(a,b)=>a&&b&&[a.lng,a.lat,b.lng,b.lat].every(Number.isFinite)&&Math.abs(a.lng-b.lng)<=1e-6&&Math.abs(a.lat-b.lat)<=1e-6;
const meters=(a,b)=>{const r=Math.PI/180,dlat=(b.lat-a.lat)*r,dlng=(b.lng-a.lng)*r,h=Math.sin(dlat/2)**2+Math.cos(a.lat*r)*Math.cos(b.lat*r)*Math.sin(dlng/2)**2;return 6371000*2*Math.asin(Math.min(1,Math.sqrt(h)));};
export function directionSamples(job){
 const origin=job?.analysis?.origin,rows=job?.heatSamples??job?.rangeSamples??[];
 return Array.from({length:36},(_,sector)=>{const attempts=rows.filter(s=>s.sector===sector||s.bearingDegrees===sector*10),valid=[];
  for(const s of attempts){const a=s.requestedOrigin??s.origin,p=s.requestedDestination?.location??s.destination?.location??(Number.isFinite(s.lng)&&Number.isFinite(s.lat)?{lng:s.lng,lat:s.lat}:null),seconds=decisionSeconds(s);
   if(s.routeStatus!=='ok'||s.mode!=='walking'||s.coordinateSystem!=='BD-09LL'||!same(a?.location??a,origin?.location)||(a?.uid??s.originUid??null)!==(origin?.uid??null)||!same(p,p)||Math.abs(p.lng)>180||Math.abs(p.lat)>90||seconds===null||seconds<0||seconds>900||!Number.isFinite(s.distanceMeters)||s.distanceMeters<0||!Number.isFinite(s.durationSeconds)||s.durationSeconds<0)continue;
   valid.push({...s,location:p,seconds,straightMeters:meters(origin.location,p)});}
  valid.sort((a,b)=>b.straightMeters-a.straightMeters||a.seconds-b.seconds);
  return{sector,bearing:sector*10,status:valid.length?'verified_sample':'unverified',value:valid[0]?.straightMeters??null,sample:valid[0]??null,verifiedSamples:valid.length,attempts:attempts.length,reason:valid.length?null:attempts.length?'no_valid_within_15min_sample':'not_sampled'};
 });
}
export function buildReportChartModel(job,tree){
 const view=reportPresentation(job,tree,{scale:100}),rows=reachableFacilityRows(facilityViewRows(job.analysis,tree,'all',job.display),job.analysis.origin),unique=new Map();
 for(const r of rows){const key=r.uid?'uid:'+r.uid:r.identityKey;if(key&&!unique.has(key))unique.set(key,r);}
 const allocations=[],groups=view.groups.map(g=>({...g,value:0,children:g.subtypes.map(s=>({id:s.id,name:s.label,value:0,categoryId:g.id,uidKeys:[]}))}));
 for(const row of unique.values()){
  const matches=groups.flatMap(g=>g.children.filter(s=>row.subtypeIds.includes(s.id)).map(s=>({g,s})));if(!matches.length){if(hasCategoryOnlyMembership(row)){const g=groups.find(g=>g.id==='eldercare');g.value++;allocations.push({uid:row.uid,identityKey:row.identityKey,categoryId:'eldercare',subtypeId:null,functionalSubtypeIds:[],rule:'confirmed_category_only_no_subtype_credit'});}continue;}
  // Allocation affects this composition chart only; all confirmed functional memberships remain in scoring.
  const raw=String(row.rawCategory??'');const primary=matches.find(({g,s})=>tree.categories.find(d=>d.id===g.id).subtypes.find(d=>d.id===s.id).rawCategoryHints.some(t=>raw.endsWith(t)||raw.split(';').at(-1)===t))??matches[0];
  primary.g.value++;primary.s.value++;primary.s.uidKeys.push(row.identityKey);allocations.push({uid:row.uid,identityKey:row.identityKey,categoryId:primary.g.id,subtypeId:primary.s.id,functionalSubtypeIds:row.subtypeIds,rule:matches.length===1?'single_confirmed_membership':'raw_primary_tag_then_stable_mapping_order'});
 }
 const contributions=view.groups.map((g,index)=>{const s=g.score??{};return{...g,index,priority:s.priority??0,priorityLabel:s.priorityLabel??('历史权重'+(s.priority??0)),weight:s.normalizedWeight??0,displayWeightPercent:s.displayWeightPercent??(s.normalizedWeight??0)*100,contributionLow:s.contributionLow??null,contributionHigh:s.contributionHigh??null};}).sort((a,b)=>b.priority-a.priority||a.index-b.index);
 return{jobId:job.analysisId,view,groups,contributions,allocations,reachableRows:rows,totalPoi:allocations.length,anonymousOmitted:0,anonymousIncluded:allocations.filter(r=>!r.uid).length,directions:directionSamples(job),score:job.score,origin:job.analysis.origin,version:tree.version};
}
