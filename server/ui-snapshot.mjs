// Transfer projection only: full audit endpoints and archived originals remain intact.
// Keep every cost, UID, origin binding, state, score fingerprint and real polyline.
import {reachableFacilityRows} from '../web/reachable-presentation.js';
import {circleFacilityRows} from '../web/circle-presentation.js';
import{serviceGapEvidence}from'./service-gap-evidence.mjs';
const omitted=new Set(['diagnostics','candidateDiagnostics','excludedCandidates','pendingCandidates','duplicateUids','retrievalEvidence','classificationEvidence','destinationVariants','entranceCandidates','searchPages','searchErrors','rangeSamples','rawResponse','rawCandidate','candidate','routeCandidates']);
function copy(value){if(Array.isArray(value))return value.map(copy);if(!value||typeof value!=='object')return value;
 const result={};for(const[key,item]of Object.entries(value))if(!omitted.has(key))result[key]=copy(item);return result;}
export function uiSnapshot(job){if(!job)return null;
 const full=job.display?.facilities,inside=full?circleFacilityRows(full,job):[],reachable=full?reachableFacilityRows(full,job.analysis?.origin):[];
 const keys=new Set([...inside,...reachable].map(p=>p.identityKey));
 const fields=['identityKey','uid','name','address','location','naviLocation','coordinateSystem','subtypeIds','categoryOnlyIds','eldercareClassification','serviceDetails','pendingSubtypeIds','categoryIds','displayCategoryIds','rawCategory','rawCategoryTags','candidateStatus','displayStatus','statusText','rangeMembership','rangeRouteDisagreement','onMap','routeEvidence','walkingDataReasonCode','drawable','geometry','walkingModelId','modelDurationSeconds','durationSeconds','distanceMeters','stationName','stationIdentityStatus','stationMemberUids','walkingTargets','accessState','accessStateText','retrievalStatus'];
 const facilities=full?.filter(p=>keys.has(p.identityKey)).map(p=>Object.fromEntries(fields.filter(k=>Object.hasOwn(p,k)).map(k=>[k,p[k]])));
 const sampleFields=['mode','routeStatus','coordinateSystem','source','durationSeconds','distanceMeters','walkingModelId','modelDurationSeconds','requestedOrigin','requestedDestination','providerOrigin','providerDestination','origin','destination','originUid','destinationUid','evidenceId','sampleStage','round','sector','bearingDegrees','radiusMeters','lat','lng','geometry','geometryStatus'];
 const heatSamples=(job.rangeSamples??job.heatSamples??[]).map(s=>Object.fromEntries(sampleFields.filter(k=>Object.hasOwn(s,k)).map(k=>[k,s[k]])));
 const source={...job,heatSamples,display:full?{...job.display,facilities,circlePoiCount:inside.length,circleCountScope:'retrieved_pois_inside_displayed_walking_range',circleCountIsWalkingProof:false}:job.display,analysis:job.analysis?{...job.analysis,categories:job.analysis.categories.map(g=>({...g,poiMarkers:full?undefined:g.poiMarkers})),poiMarkers:full?undefined:job.analysis.poiMarkers}:null};
 if(source.analysis?.circleCosts)source.analysis.circleCosts={...source.analysis.circleCosts,facilities:undefined};
 return{...copy(source),serviceGapEvidence:serviceGapEvidence(job),presentationOnly:true,auditEndpoint:'/api/analyses/'+job.analysisId};
}
