import {validBd09ll} from './walking-provider.mjs';
import {straightDistanceMeters} from './facility-coverage.mjs';
import {modelRoute,decisionSeconds,WALKING80_MODEL} from '../web/walking-model.js';
import {facilityRouteCacheKey} from './baidu-route.mjs';
const tagsOf=p=>[p.rawCategory,...(p.rawCategoryTags??[])].filter(Boolean).join(';');
export function metroIdentity(p){
 const name=String(p.name??''),tags=tagsOf(p),incidental=/酒店|宾馆|旅馆|停车场|临时停车|自行车|租赁|餐饮|便利店|超市|公司|施工|售楼|派出所|回收/.test(name+';'+tags),entrance=!p.stationName&&/出入口|通道|[A-Z]\d*口|[A-Z]\d*出口|[A-Z]\d*入口/i.test(name+';'+tags);
 if(incidental)return null;
 const match=name.match(/^(.+?)(?:[（(]?地铁(?:站|出入口|口)[）)]?)/)??name.match(/^(?:地铁|轨道交通)(.+?)站/),strong=/地铁站|地铁出入口/.test(tags),key=match?.[1]?.replace(/[（(\s-]+$/g,'')??(strong?name.replace(/(?:[-（(].*)$/,'').trim():null);
 return key?{name:key,entrance,strongTag:strong}:null;
}
export function consolidateMetroStations(candidates,origin,isMetro){
 const all=new Map(candidates.filter(p=>p.uid).map(p=>[p.uid,p])),groups=[],rest=[],metros=candidates.filter(p=>metroIdentity(p)&&isMetro(p)),roots=metros.filter(p=>!metroIdentity(p).entrance);
 for(const p of [...roots,...candidates.filter(p=>!roots.includes(p))]){const info=metroIdentity(p);if(!info||!isMetro(p)){rest.push(p);continue;}
  const parent=all.get(p.parentUid),parentInfo=parent&&metroIdentity(parent),name=parentInfo?.name??info.name;
  // Distinct station UIDs never merge merely because names/positions are close.
  // Unparented entrances attach only to one uniquely matching returned station.
  const named=info.entrance&&!p.parentUid?roots.filter(q=>metroIdentity(q).name===name&&straightDistanceMeters(p.location,q.location)<=900):[],parentUid=!info.entrance?p.uid:p.parentUid??(named.length===1?named[0].uid:null),key=parentUid?'station:'+parentUid:'unresolved:'+(p.uid??JSON.stringify([p.name,p.address,p.location]));
  let group=groups.find(g=>g.key===key);
  if(!group){group={key,name,parentUid,identityPending:!parentUid,members:[]};groups.push(group);}group.members.push(p);
 }
 for(const g of groups){const roots=g.members.filter(p=>!metroIdentity(p).entrance),root=roots.sort((a,b)=>String(a.uid).localeCompare(String(b.uid)))[0],entrances=g.members.filter(p=>metroIdentity(p).entrance).map(p=>({uid:p.uid,location:p.location,name:p.name,parentUid:p.parentUid??root?.uid??null,source:p.parentUid?'place_parent_id':'station_name_and_proximity',linkVerified:!!p.parentUid,accessStatus:'unverified'}));
  for(const p of g.members)for(const e of p.entranceCandidates??[])if(validBd09ll(e.location))entrances.push({...e,parentUid:p.uid});
  const unique=[...new Map(entrances.map(e=>[(e.uid??'')+':'+JSON.stringify(e.location),e])).values()].sort((a,b)=>straightDistanceMeters(origin.location,a.location)-straightDistanceMeters(origin.location,b.location)||String(a.uid).localeCompare(String(b.uid))),representative=root??[...g.members].sort((a,b)=>String(a.uid).localeCompare(String(b.uid)))[0],uid=root?.uid??g.parentUid??representative.uid,
   walkingTargets=unique.length?unique.map(e=>({location:e.location,uid:e.uid??null,source:e.source,entrance:true,name:e.name})):null;
  rest.push({...representative,uid,identityStatus:'station_entity',stationName:g.name,stationMemberUids:[...new Set(g.members.map(p=>p.uid).filter(Boolean))],stationLocation:root?.location??representative.location,
   name:root?.name??g.name+'地铁站',location:walkingTargets?.[0].location??representative.location,naviLocation:walkingTargets?.[0].location??representative.naviLocation,walkingTargets,
   stationIdentityStatus:g.identityPending?'pending':'resolved',stationGroupingEvidence:{method:g.identityPending?'unresolved_station_parent':g.members.some(p=>p.parentUid)?'explicit_parent_uid':root?'station_uid_and_unique_named_entrances':'explicit_parent_uid',memberCount:g.members.length,stationUid:g.parentUid??null},
   rawCategoryTags:[...new Set(g.members.flatMap(p=>p.rawCategoryTags??[]))],queriedSubtypeIds:[...new Set(g.members.flatMap(p=>p.queriedSubtypeIds??[]))],matchedQueries:[...new Set(g.members.flatMap(p=>p.matchedQueries??[]))],
   classificationEvidence:g.members.flatMap(p=>p.classificationEvidence??[]),retrievalEvidence:g.members.flatMap(p=>p.retrievalEvidence??[]),entranceCandidates:unique,entranceStatus:unique.length?'retrieved_station_entrance':'station_navigation_hint'});
 }return rest;
}
export function facilityWalkingTargets(facility,origin){
 const targets=(facility.walkingTargets??[]).filter(t=>validBd09ll(t.location));if(targets.length)return [...targets].sort((a,b)=>straightDistanceMeters(origin.location,a.location)-straightDistanceMeters(origin.location,b.location)||String(a.uid).localeCompare(String(b.uid)));
 return[{location:validBd09ll(facility.naviLocation)?facility.naviLocation:facility.location,uid:facility.uid??null,source:'existing_navigation_hint'}];
}
const same=(a,b)=>a&&b&&Math.abs(a.lat-b.lat)<=.000001&&Math.abs(a.lng-b.lng)<=.000001;
export function matchingFacilityTarget(facility,origin,route){const targets=facilityWalkingTargets(facility,origin),actual=route?.facilityEndpoint;
 if(!facility.stationName&&actual?.source==='poi_geometry_repair'&&actual.uid===facility.uid&&same(actual.location,facility.location)&&same(actual.location,route?.requestedDestination?.location)&&(route.requestedDestination.uid??null)===(actual.uid??null))return actual;
 return targets.find(t=>same(t.location,route?.requestedDestination?.location)&&(t.uid??null)===(route.requestedDestination.uid??null))??targets[0];}
export async function routeFacilityCandidate({facility,origin,provider,routeMemo,options={}}){
 const targets=facilityWalkingTargets(facility,origin),rows=[];
 for(const target of targets){if(options.signal?.aborted)throw options.signal.reason;const o={...options,destinationUid:target.uid};
  // Identity of the station is separate from the actual entrance route binding.
  const key=facilityRouteCacheKey(origin.location,target.location,o);let work=routeMemo.get(key);if(!work){work=Promise.resolve().then(()=>provider.route(origin.location,target.location,o)).catch(e=>({routeStatus:e?.code??'upstream_unavailable'}));routeMemo.set(key,work);if(o.captureGeometry||o.includeGeometry)routeMemo.set(key+':geometry',work);}
  let route=await work;
  // A cost-only memo must not suppress a later real path request. The separate
  // detail key coalesces concurrent upgrades; missing/invalid provider paths do
  // not trigger an unbounded retry in each subtype pass.
  if((o.captureGeometry||o.includeGeometry)&&route.routeStatus==='ok'&&!route.geometry&&['not_requested','not_provided'].includes(route.geometryStatus??'not_requested')){
   const detailKey=key+':geometry';let detail=routeMemo.get(detailKey);if(!detail){detail=Promise.resolve().then(()=>provider.route(origin.location,target.location,o)).catch(e=>({routeStatus:e?.code??'upstream_unavailable'}));routeMemo.set(detailKey,detail);}route=await detail;routeMemo.set(key,detail);
  }
  const modeled=modelRoute(route,options.walkingModelId??WALKING80_MODEL),bound=targets.length===1&&!facility.walkingTargets||same(route.requestedOrigin?.location,origin.location)&&(route.requestedOrigin.uid??null)===(origin.uid??null)&&same(route.requestedDestination?.location,target.location)&&(route.requestedDestination.uid??null)===(target.uid??null),valid=bound&&modeled.routeStatus==='ok'&&Number.isFinite(modeled.distanceMeters)&&Number.isFinite(modeled.durationSeconds)&&modeled.distanceMeters>=0&&modeled.durationSeconds>=0;
  const resolved=matchingFacilityTarget(facility,origin,route);rows.push({target:resolved,route,valid});if(valid&&decisionSeconds(modeled,options.walkingModelId)<=900)return{...route,facilityEndpoint:resolved,entranceVerification:{knownTargets:targets.length,attempted:rows.length,reachableWitness:true,complete:rows.length===targets.length}};
 }
 const valid=rows.filter(r=>r.valid).sort((a,b)=>a.route.distanceMeters-b.route.distanceMeters),best=valid[0];
 if(best&&valid.length===targets.length)return{...best.route,facilityEndpoint:best.target,entranceVerification:{knownTargets:targets.length,attempted:rows.length,reachableWitness:false,complete:true}};
 if(targets.length===1&&!facility.walkingTargets)return rows[0].route;
 return{routeStatus:'entrances_unverified',distanceMeters:null,durationSeconds:null,entranceVerification:{knownTargets:targets.length,attempted:rows.length,complete:false,failures:rows.filter(r=>!r.valid).map(r=>({uid:r.target.uid,status:r.route.routeStatus})),verifiedOverThreshold:valid.length}};
}
