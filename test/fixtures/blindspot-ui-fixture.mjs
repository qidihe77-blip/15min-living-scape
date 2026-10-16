// Explicit synthetic completeness assumptions for interaction tests only.
// No stored analysis or provider evidence is changed by this browser fixture.
import{assessServiceGaps}from'../../server/service-gaps.mjs';
import{uiSnapshot}from'../../server/ui-snapshot.mjs';
export function threeSpecialtyAbsenceFixture(full,tree){
 const j=structuredClone(full),ids=new Set(['market','pharmacy','primary_school']);
 for(const g of j.analysis.categories)for(const s of g.subtypeResults){if(!ids.has(s.subtypeId))continue;const d=tree.categories.flatMap(g=>g.subtypes).find(d=>d.id===s.subtypeId);Object.assign(s,{searchComplete:false,searchTruncated:true,searchStatus:'partial',searchErrors:[{keyword:'无关辅助查询',code:'premature_page_end'}],searchPages:[{keyword:d.searchQueries.join('$'),shardId:'root',pageNum:0,reportedTotal:0,returned:0}],pendingClassificationCount:0,invalidCandidateCount:0,confirmedCandidateCount:0,candidatesRouted:0,candidateDiagnostics:[],nearestReachable:null,reachableCountLowerBound:0,reachableIdentityKeys:[],routes:[]});}
 j.analysis.poiMarkers=j.analysis.poiMarkers.filter(p=>!p.subtypeIds?.some(id=>ids.has(id)));j.display.facilities=j.display.facilities.filter(p=>!p.subtypeIds?.some(id=>ids.has(id)));const required=new Set(tree.categories.flatMap(g=>g.subtypes).filter(s=>ids.has(s.id)).flatMap(s=>s.searchQueries)),isRequired=q=>String(q??'').split('$').some(t=>required.has(t));for(const p of[...j.analysis.poiMarkers,...j.display.facilities]){p.matchedQueries=p.matchedQueries?.filter(q=>!isRequired(q));p.retrievalEvidence=p.retrievalEvidence?.filter(e=>!isRequired(e.query));}j.analysis.diagnostics={...j.analysis.diagnostics,searches:j.analysis.diagnostics.searches.map(s=>ids.has(s.subtypeId)?{...s,discardedCandidates:[]}:s)};
 j.serviceGaps=assessServiceGaps(j.analysis);j.analysis.origin.name+='（三类交互测试）';j.testFixture='synthetic_three_specialty_absence_not_a_real_finding';return uiSnapshot(j);
}
export function confirmedSchoolFixture(cached){
 const j=structuredClone(cached),s=j.analysis.categories.find(g=>g.categoryId==='education').subtypeResults.find(s=>s.subtypeId==='primary_school'),raw=j.serviceGaps.specialties.find(s=>s.subtypeId==='primary_school');
 Object.assign(s,{searchComplete:true,searchTruncated:false,searchStatus:'complete',searchErrors:[],pendingClassificationCount:0,invalidCandidateCount:0,confirmedCandidateCount:0,candidatesRouted:0,nearestReachable:null,routes:[]});
 Object.assign(raw,{searchComplete:true,walking_1km_gap:{status:'absent_in_declared_search',thresholdMeters:1000,evidenceComplete:true,noFacilityWithinOneKilometer:true,nearbyCountLowerBound:0,nearestVerified:null,nearestWithinOneKilometer:null,evidenceIds:[],unknownReasons:[]}});
 const context=j.serviceGapEvidence.groups.find(g=>g.categoryId==='education');Object.assign(context,{potential:[],pendingEvidenceComplete:true});
 j.analysis.searchRadiusMeters=5000;j.analysis.searchWindow={...j.analysis.searchWindow,center:j.analysis.origin.location};j.display.facilities=j.display.facilities.filter(p=>!p.subtypeIds?.includes('primary_school'));
 j.analysis.origin.name+='（交互测试）';j.testFixture='synthetic_confirmed_school_absence_not_a_real_finding';return j;
}
