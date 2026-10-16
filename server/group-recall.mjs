import {facilityCategoryTree} from './facility-categories.mjs';
import {orderedBatches} from './bounded-batches.mjs';
import {facilityIdentity} from './nearest-facility.mjs';
import {fairSubtypeOrder} from './facility-schedule.mjs';
import {validBd09ll} from './walking-provider.mjs';
export const GROUP_RECALL_VERSION='six-group-keyword-recall-v1';
export async function prepareGroupSearches({placeProvider,analysisLocation,categoryMappingVersion,searchRadiusMeters,signal,onProgress=()=>{},concurrency=2}){
 const start=performance.now(),tree=facilityCategoryTree(categoryMappingVersion),groups=tree.categories,searchesByGroup=new Map(),history=new Map(),rounds=[];
 async function search(group,continuation){const previous=searchesByGroup.get(group.id);let result;
  try{result=await placeProvider.searchAround({categoryId:group.id,categoryMappingVersion,groupScope:true,incremental:true,
  center:analysisLocation.location,radiusMeters:searchRadiusMeters,maxRequests:1,continuation,signal});}catch(error){result={...previous,searchComplete:false,truncated:true,continuation:null,errors:[...(previous?.errors??[]),{code:error?.code??'upstream_unavailable'}],candidates:previous?.candidates??[]};}
  if(previous&&result.requestStats?.logicalRequests===0&&!result.pages?.length&&!result.candidates?.length)result={...previous,status:'partial',searchComplete:false,truncated:true,continuation:null,errors:[...(previous.errors??[]),...(result.errors??[])],requestStats:result.requestStats};
  const keys=new Set(previous?.candidates?.map(facilityIdentity)??[]);
  const candidates=(result.candidates??[]).map(p=>({...p,queriedSubtypeIds:[...new Set([...(p.queriedSubtypeIds??[]),...group.subtypes.map(s=>s.id)])]}));
  const gain=new Set(candidates.filter(p=>!keys.has(facilityIdentity(p))).map(facilityIdentity)).size;
  searchesByGroup.set(group.id,{...result,candidates,invalidCandidateCount:(result.invalidCandidateCount??0)+candidates.filter(p=>!validBd09ll(p.location)).length});
  history.set(group.id,{served:(history.get(group.id)?.served??0)+1,gain});return{categoryId:group.id,newUidGain:gain};
 }
 await orderedBatches(groups,async(g,i)=>{onProgress({phase:'group_search',completed:i,total:6,categoryId:g.id});return search(g,null);},{concurrency,signal});
 for(let round=1;round<(categoryMappingVersion==='facility-categories-v8'?16:8);round++){const ordered=groups.filter(g=>searchesByGroup.get(g.id)?.continuation).sort((a,b)=>{
  const score=g=>{const h=history.get(g.id),s=searchesByGroup.get(g.id);return(s.candidates.length?0:1000)+(s.continuation?.queue?.some(q=>q.pageNum===0)?200:0)+20*Math.log1p(h.gain)-10*h.served;};return score(b)-score(a)||groups.indexOf(a)-groups.indexOf(b);});
  const decisions=[];await orderedBatches(ordered,async g=>{if(placeProvider.canSearch?.()===false)return;decisions.push(await search(g,searchesByGroup.get(g.id).continuation));},{concurrency,signal});
  if(!decisions.length)break;rounds.push({round,decisions});
 }
 const searches=new Map(),candidatePool=[];for(const g of groups){const s=searchesByGroup.get(g.id);candidatePool.push(...s.candidates);for(const sub of g.subtypes)searches.set(sub.id,{...s,recalledCategoryId:g.id,sharedGroupRecall:true});}
 const order=fairSubtypeOrder(categoryMappingVersion);
 return{searches,order,subtypeCount:order.length,candidatePool,searchMs:performance.now()-start,recallSchedule:{version:GROUP_RECALL_VERSION,scope:'group_recall_then_subtype_classification',firstPageOrder:groups.map(g=>g.id),rounds}};
}
