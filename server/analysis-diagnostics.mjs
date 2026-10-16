import {withinWalkingLimit,decisionSeconds} from '../web/walking-model.js';
// Read-only diagnostics for the verified sample; never a new score or a population estimate.
export function knownSampleDiagnostics(categories){
 const memberships=new Map();
 const groups=categories.map(group=>{
  const routes=group.subtypeResults.flatMap(s=>s.routes??[]).filter(r=>r.routeStatus==='ok'&&r.mode==='walking'&&r.coordinateSystem==='BD-09LL'&&typeof r.identityKey==='string'
   &&r.classification?.candidateStatus==='confirmed_by_rule'&&withinWalkingLimit(r));
  for(const r of routes){if(!memberships.has(r.identityKey))memberships.set(r.identityKey,new Set());memberships.get(r.identityKey).add(group.categoryId);}
  const nearest=[...routes].sort((a,b)=>a.distanceMeters-b.distanceMeters)[0];
  return{categoryId:group.categoryId,totalSubtypes:group.totalSubtypeCount,reachableSubtypes:group.reachableSubtypeCount,
   unresolvedSubtypes:group.unknownSubtypeCount,knownReachableSubtypeFraction:group.reachableSubtypeCount/group.totalSubtypeCount,
   nearestVerifiedDistanceMeters:nearest?.distanceMeters??null,nearestVerifiedTimeSeconds:nearest?decisionSeconds(nearest):null};
 });
 const counts=new Map(groups.map(g=>[g.categoryId,0]));
 for(const ids of memberships.values())for(const id of ids)counts.set(id,counts.get(id)+1/ids.size);
 const total=memberships.size,entropy=total?-groups.reduce((h,g)=>{const p=counts.get(g.categoryId)/total;return h+(p?p*Math.log(p):0);},0):null;
 return{version:'known-route-sample-diagnostics-v1',scope:'verified_sample_only',affectsScore:false,
  uniqueReachableIdentityCountLowerBound:total,groups,
  diversity:{method:'fractional_uid_membership_shannon',entropy,normalized:entropy===null?null:groups.length>1?entropy/Math.log(groups.length):0,groupCount:groups.length},
  limitations:['已核验样本不等于区域设施总体；多类同一地点按类别分摊，避免重复UID放大。','不推断未测区域的覆盖率、服务容量或政策达标情况。']};
}
