import {mergeFacilityCandidatesV3} from './nearest-facility.mjs';
import {classifyV3FacilityCandidate} from './facility-categories.mjs';
import {facilityRouteCacheKey} from './baidu-route.mjs';
import {validBd09ll} from './walking-provider.mjs';
import {straightDistanceMeters} from './facility-coverage.mjs';
import {orderedBatches} from './bounded-batches.mjs';
import {consolidateMetroStations,facilityWalkingTargets} from './facility-endpoints.mjs';

// Speculation only fills the existing Walking cache. Final polygon selection,
// binding, accessibility and scores continue through the normal analysis path.
export function createFacilityPrefetch({preparedSearches, origin, mappingVersion,
 provider, walkingAllowance, walkingModelId, signal, limit=40, concurrency=6,maxCandidates=1000,optimized=false}) {
 let stopped=false;
 const pending=new Map(), stats={enabled:true,started:0,completed:0,successful:0,
  walkingRequests:0,claimed:0,finishedBeforeRange:0,elapsedMs:0};
 const started=performance.now();
 const promise=(async()=>{
  const prepared=await preparedSearches;
  if(stopped||signal.aborted||!walkingAllowance)return;
  const pool=prepared.candidatePool??[...prepared.searches.values()].flatMap(s=>s.candidates);
  const merged=mergeFacilityCandidatesV3(pool).candidates,canonical=mappingVersion==='facility-categories-v8'?consolidateMetroStations(merged,origin,p=>classifyV3FacilityCandidate(p,mappingVersion).subtypeIds.includes('metro_station')):merged;
  const candidates=canonical
   .filter(p=>(optimized?classifyV3FacilityCandidate(p,mappingVersion).categoryIds.length:classifyV3FacilityCandidate(p,mappingVersion).subtypeIds.length)&&(!optimized||straightDistanceMeters(origin.location,p.location)<=1502))
   .sort((a,b)=>straightDistanceMeters(origin.location,a.location)-straightDistanceMeters(origin.location,b.location));
  // Leave room for all direction probes/repairs and the canonical facility pass.
  if(candidates.length>maxCandidates||(!optimized&&candidates.length+80>walkingAllowance.limit))return;
  await orderedBatches(candidates.slice(0,limit),async p=>{
   if(stopped||signal.aborted||walkingAllowance.limit-walkingAllowance.used<80)return;
   const target=facilityWalkingTargets(p,origin)[0],destination=target.location;
   const options={mode:'walking',captureGeometry:true,originUid:origin.uid,
    destinationUid:target.uid,walkingModelId,walkingAllowance,signal};
   const key=facilityRouteCacheKey(origin.location,destination,options);
   if(provider.peek?.(origin.location,destination,options))return;
   stats.started++;
   const work=Promise.resolve().then(()=>provider.route(origin.location,destination,options)).then(r=>{
    stats.completed++;stats.walkingRequests+=r.walkingRequestAttempts??0;
    if(r.routeStatus==='ok')stats.successful++;
    return r;
   }).catch(()=>null);
   pending.set(key,work);await work;
  },{concurrency,signal});
 })().catch(()=>{stats.reasonCode=signal.aborted?'cancelled':'prefetch_unavailable';})
  .finally(()=>{stats.elapsedMs=performance.now()-started;});
 promise.catch(()=>{});
 return {promise,stop(){stopped=true;stats.finishedBeforeRange=stats.completed;},
  async claim(a,b,o){const work=pending.get(facilityRouteCacheKey(a,b,o));if(!work)return null;
   const r=await work;
   // A speculative failure never suppresses the canonical route attempt.
   if(r?.routeStatus!=='ok')return null;
   stats.claimed++;return{...r,cached:true,walkingRequestAttempts:0};
  },stats:()=>({...stats})};
}
