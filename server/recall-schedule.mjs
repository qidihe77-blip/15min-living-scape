import {classifySubtypeCandidate} from './facility-categories.mjs';
import {facilityIdentity} from './nearest-facility.mjs';

export const RECALL_SCHEDULE_VERSION='fair-first-page-adaptive-continuation-v2';
// A scheduling hint, never proof of classification, reachability or search completeness.
export function continuationPriority(subtype,search,history,version){
 const candidates=search?.candidates??[],confirmed=new Set(candidates.filter(p=>classifySubtypeCandidate({...p,categoryMappingVersion:version,subtypeId:subtype.id}).candidateStatus==='confirmed_by_rule').map(facilityIdentity)).size;
 const queue=search?.continuation?.queue??[],newKeywordGroups=queue.filter(p=>p.pageNum===0&&p.shard?.depth===0).length;
 const denseShards=queue.filter(p=>p.shard?.depth>0).length,gain=history?.lastGain??candidates.length;
 return{confirmedCandidates:confirmed,newKeywordGroups,denseShards,lastUniqueGain:gain,servedRequests:history?.served??1,
  score:(confirmed===0?1000:0)+(newKeywordGroups?200:0)+(denseShards?40:0)+20*Math.log1p(gain)-10*(history?.served??1)};
}
export function adaptiveContinuationOrder(order,searches,history,version){
 return order.map((subtype,index)=>({subtype,index,priority:continuationPriority(subtype,searches.get(subtype.id),history.get(subtype.id),version)}))
  .sort((a,b)=>b.priority.score-a.priority.score||a.index-b.index);
}
