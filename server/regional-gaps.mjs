import {straightDistanceMeters} from './facility-coverage.mjs';
import {validBd09ll} from './walking-provider.mjs';
import {validateBoundaryRing} from './boundary-geometry.mjs';
import {pointInRing,validRangeCost} from './batch-walking-range.mjs';
import {classifySubtypeCandidate} from './facility-categories.mjs';
export const REGIONAL_GAP_VERSION='regional-grid-coverage-estimate-v1';
// Separate from the origin's true walking1km specialties. This field is a model,
// not a new proof of absence or a change to the six-group scoring formula.
export async function assessRegionalGaps({analysis,geometry,weights={},matrixProvider,gridSize=5,maxMatrixOutputs=25,signal}={}){
 if(!Number.isInteger(gridSize)||gridSize<3||gridSize>9||!Number.isInteger(maxMatrixOutputs)||maxMatrixOutputs<0||maxMatrixOutputs>81)throw new RangeError('Bounded regional grid required.');
 const ring=geometry?.geojson?.features?.find(f=>f.properties?.featureType==='sampled_boundary')?.geometry?.coordinates?.[0];
 const empty={version:REGIONAL_GAP_VERSION,scope:'sampled_range_grid_model',affectsOverallScore:false,specialty1kmUnchanged:true,gridSize,minutes:15,speedMetersPerMinute:80,detourFactor:1.3,blindThreshold:40,distanceDefinition:'straight_distance_times_1.3_estimate',cells:[],blindZones:[],coverage:[],requestStats:{httpRequests:0,matrixOutputRoutes:0},summary:{blindRatio:null,verifiedCells:0}};
 if(!analysis?.origin||!ring||!validateBoundaryRing(ring).valid)return{...empty,status:'unknown',reasonCode:'walking_range_unavailable'};
 const groups=analysis.categories.map(g=>{
  const complete=g.subtypeResults.every(s=>s.searchComplete&&!s.searchTruncated&&!s.pendingClassificationCount&&!s.invalidCandidateCount);
  const failed=g.subtypeResults.every(s=>s.searchStatus==='failed');
  const points=[],seen=new Set();for(const p of g.poiMarkers??[]){const key=p.uid??p.identityKey;if(!key||seen.has(key)||!validBd09ll(p.location)||!g.subtypeResults.some(s=>classifySubtypeCandidate({...p,categoryMappingVersion:analysis.categoryMappingVersion,subtypeId:s.subtypeId}).candidateStatus==='confirmed_by_rule'))continue;seen.add(key);points.push(p);}
  return{id:g.categoryId,label:g.label,weight:Number.isFinite(weights[g.categoryId])&&weights[g.categoryId]>=0?weights[g.categoryId]:1,complete,failed,points};
 });
 const active=groups.filter(g=>!g.failed&&g.weight>0),total=active.reduce((n,g)=>n+g.weight,0);
 const xs=ring.map(p=>p[0]),ys=ring.map(p=>p[1]),minX=Math.min(...xs),minY=Math.min(...ys),dx=(Math.max(...xs)-minX)/gridSize,dy=(Math.max(...ys)-minY)/gridSize,cells=[];
 for(let y=0;y<gridSize;y++)for(let x=0;x<gridSize;x++){
  const center={lng:minX+(x+.5)*dx,lat:minY+(y+.5)*dy};if(!pointInRing([center.lng,center.lat],ring))continue;
  const cov={},walk={},unknown=[];let low=0,high=0;
  for(const g of groups.filter(g=>!g.failed)){const distance=Math.min(...g.points.map(p=>straightDistanceMeters(center,p.location))),minutes=Number.isFinite(distance)?distance*1.3/80:null;
   walk[g.id]=minutes;const lower=minutes===null?0:Math.max(0,1-minutes/15),upper=g.complete?lower:1;cov[g.id]={low:lower,high:upper,estimated:true};
   if(!g.complete&&g.weight>0)unknown.push(g.id);low+=lower*g.weight;high+=upper*g.weight;}
  const score=total?low/total*100:null,scoreHigh=total?high/total*100:null;
  cells.push({id:y*gridSize+x,x,y,center,insideCircle:true,outsideVerified:false,originReachability:'unknown',score,scoreInterval:{low:score,high:scoreHigh},walkMinByCategory:walk,coverageByCategory:cov,unknownCategoryIds:unknown,candidateBlind:score!==null&&score<40,blind:false,status:total?'estimated_coverage':'unknown',reasonCodes:[...(!total?['no_usable_category_evidence']:[]),...(unknown.length?['partial_poi_search']:[])]});
 }
 const candidates=cells.filter(c=>c.candidateBlind);let httpRequests=0,outputs=0,verificationFailure=null;
 if(candidates.length&&matrixProvider?.routeMany&&candidates.length<=maxMatrixOutputs&&!signal?.aborted){
  let rows;try{httpRequests=1;outputs=candidates.length;rows=await matrixProvider.routeMany({origin:analysis.origin,destinations:candidates.map(c=>c.center),mode:'walking',signal});}catch(e){verificationFailure=e.code??'matrix_verification_failed';}
  candidates.forEach((c,i)=>{const r=rows?.[i];if(!validRangeCost(r,analysis.origin,c.center)){c.reasonCodes.push(r?.routeStatus??verificationFailure??'invalid_matrix_binding');return;}
   c.originEvidence={evidenceId:r.evidenceId,source:r.source,distanceMeters:r.distanceMeters,providerDurationSeconds:r.durationSeconds,modelDurationSeconds:r.distanceMeters*60/80};
   c.originReachability=r.distanceMeters<=1200?'reachable':'outside';c.outsideVerified=r.distanceMeters>1200;
   if(c.outsideVerified){c.insideCircle=false;c.status='outside_verified';}
  });
 }else if(candidates.length)verificationFailure=!matrixProvider?'matrix_unavailable':candidates.length>maxMatrixOutputs?'regional_matrix_budget_insufficient':'cancelled';
 for(const c of candidates){if(c.outsideVerified)continue;c.blind=c.originReachability==='reachable'&&c.scoreInterval.high!==null&&c.scoreInterval.high<40;
  c.status=c.blind?'estimated_blind':c.originReachability==='unknown'?'pending_reachability':'candidate_blind';if(c.originReachability==='unknown'&&verificationFailure)c.reasonCodes.push(verificationFailure);}
 const included=cells.filter(c=>!c.outsideVerified),blind=included.filter(c=>c.blind),complete=groups.every(g=>g.complete&&!g.failed),coverage=groups.map(g=>({categoryId:g.id,label:g.label,failed:g.failed,searchComplete:g.complete,ratio:g.failed||!included.length?null:included.reduce((n,c)=>n+(c.coverageByCategory[g.id]?.low??0),0)/included.length,estimated:true}));
 return{...empty,status:complete&&candidates.every(c=>c.originReachability!=='unknown')?'estimated':'partial',searchEvidenceComplete:complete,reasonCode:verificationFailure,categoryMappingVersion:analysis.categoryMappingVersion,origin:structuredClone(analysis.origin),cells,blindZones:blind,coverage,
  coverageScore:total&&included.length?included.reduce((n,c)=>n+c.score,0)/included.length:null,
  requestStats:{httpRequests,matrixOutputRoutes:outputs},summary:{insideCells:included.length,candidateBlindCells:candidates.length,estimatedBlindCells:blind.length,outsideVerifiedCells:cells.filter(c=>c.outsideVerified).length,verifiedCells:cells.filter(c=>c.originEvidence).length,blindRatio:total>0&&complete&&candidates.every(c=>c.originReachability!=='unknown')&&included.length?100*blind.length/included.length:null},
  limitations:['圈和格到设施的时间为估算，不是逐格逐设施真实路线。','起点到格中心的复核只验证格中心可达性，不能证明格到设施的成本。','检索不完整保留覆盖区间；未知不能解释为没有设施；1km专项和总体评分不变。']};
}
export function reweightRegionalGaps(previous,weights={}){
 if(!previous?.cells?.length)return previous;const result=structuredClone(previous),active=result.coverage.filter(g=>!g.failed&&(weights[g.categoryId]??1)>0),total=active.reduce((n,g)=>n+(weights[g.categoryId]??1),0);
 for(const c of result.cells){let low=0,high=0;c.unknownCategoryIds=[];for(const g of active){const cov=c.coverageByCategory[g.categoryId];low+=(cov?.low??0)*(weights[g.categoryId]??1);high+=(cov?.high??1)*(weights[g.categoryId]??1);if(!g.searchComplete)c.unknownCategoryIds.push(g.categoryId);}
  c.score=total?low/total*100:null;c.scoreInterval={low:c.score,high:total?high/total*100:null};c.candidateBlind=c.score!==null&&c.score<40;c.blind=!c.outsideVerified&&c.originReachability==='reachable'&&c.scoreInterval.high!==null&&c.scoreInterval.high<40;
  c.status=c.outsideVerified?'outside_verified':c.blind?'estimated_blind':c.candidateBlind&&c.originReachability==='unknown'?'pending_reachability':c.candidateBlind?'candidate_blind':'estimated_coverage';}
 const inside=result.cells.filter(c=>!c.outsideVerified),candidates=inside.filter(c=>c.candidateBlind);result.blindZones=inside.filter(c=>c.blind);result.coverageScore=total&&inside.length?inside.reduce((n,c)=>n+c.score,0)/inside.length:null;
 result.summary={...result.summary,candidateBlindCells:candidates.length,estimatedBlindCells:result.blindZones.length,blindRatio:total>0&&result.searchEvidenceComplete&&candidates.every(c=>c.originReachability!=='unknown')&&inside.length?result.blindZones.length/inside.length*100:null};
 result.status=result.searchEvidenceComplete&&candidates.every(c=>c.originReachability!=='unknown')?'estimated':'partial';result.weights={...weights};result.newRequestsOnReweight=0;return result;
}
