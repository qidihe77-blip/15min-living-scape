import{hasConfirmedFacilityMembership}from'./facility-membership.js';
import{withinWalkingLimit,decisionSeconds}from'./walking-model.js';
// Read existing bound walking costs only; no classification, scoring, geometry or provider calls.
export function reachableFacilityRows(rows,origin){
 return(rows??[]).filter(row=>hasConfirmedFacilityMembership(row)&&boundWalkingCost(row,origin));
}
export function boundWalkingCost(row,origin){
 return boundWalkingEvidence(row,origin)&&withinWalkingLimit(row.routeEvidence);
}
const same=(a,b)=>a&&b&&[a.lng,a.lat,b.lng,b.lat].every(Number.isFinite)&&Math.abs(a.lng-b.lng)<=1e-6&&Math.abs(a.lat-b.lat)<=1e-6;
export function boundWalkingEvidence(row,origin){
  const route=row.routeEvidence;if(row.stationIdentityStatus==='pending'||route?.routeStatus!=='ok'||route.mode!=='walking'||route.coordinateSystem!=='BD-09LL'||!Number.isFinite(route.durationSeconds)||route.durationSeconds<0||decisionSeconds(route)===null||!Number.isFinite(route.distanceMeters)||route.distanceMeters<0)return false;
  if(origin){const actual=route.origin?.location??route.origin,expected=origin.location??origin;
   if(!actual||Math.abs(actual.lng-expected.lng)>1e-6||Math.abs(actual.lat-expected.lat)>1e-6||!Number.isFinite(actual.lng)||!Number.isFinite(actual.lat)||(route.originUid??route.origin?.uid??null)!==(origin.uid??null))return false;
  }
  if(row.uid&&route.facilityUid&&row.uid!==route.facilityUid)return false;
  if(route.requestedDestination&&route.destination&&(!same(route.requestedDestination.location,route.destination)||(route.requestedDestination.uid??null)!==(route.destinationUid??null)))return false;
  if(!(row.uid&&route.destinationUid&&row.uid!==route.destinationUid)){
   const targets=[row.naviLocation,row.location,...(row.destinationVariants??[]).map(t=>t.naviLocation??t.location)].filter(Boolean);
   return !route.destination||!targets.length||targets.some(t=>same(t,route.destination));
  }
  // A station entity is counted once, while the verified route ends at an
  // observed entrance UID. Never accept an unrelated destination UID.
  const entranceEvidence=route.entranceVerification,verifiedEntrance=entranceEvidence?.reachableWitness===true||entranceEvidence?.complete===true&&entranceEvidence.reachableWitness===false&&decisionSeconds(route)>900;
  return !!(row.stationName&&route.facilityUid===row.uid&&verifiedEntrance&&route.requestedDestination?.uid===route.destinationUid&&(row.walkingTargets??[]).some(t=>t.uid===route.destinationUid&&same(t.location,route.destination)));
}
export function reachablePoiCount(rows,subtypeIds){
 const types=new Set(subtypeIds);return new Set((rows??[]).filter(row=>row.subtypeIds?.some(id=>types.has(id))).map(row=>row.uid?'uid:'+row.uid:row.identityKey).filter(Boolean)).size;
}
export function walkingRangeNotice(job){
 if(job.rangeDiagnostics?.strategy==='walking_batch'){const n=job.rangeDiagnostics.samplingDiagnostics;
  return job.geojson?.features?.some(f=>f.properties?.featureType==='sampled_boundary')?'36方向真实路网成本采样近似范围；外推与折线连接为估算，未测内部未知。':'步行范围暂不可用：'+(n?.boundaryReasonCode??job.rangeDiagnostics.reasonCode??'采样证据不足')+'；不绘制模拟边界。';}
 if(job.rangeDiagnostics?.strategy==='reference_walking'){
  const sampled=job.geojson?.features?.some(f=>f.properties?.featureType==='sampled_boundary'),n=job.rangeDiagnostics?.samplingDiagnostics;
  return sampled?'32方向真实步行路径采样近似范围；边界距离为沿真实路径估计，未测内部未知。':'步行采样范围暂不可用：'+(n?.boundaryReasonCode??job.rangeDiagnostics?.reasonCode??'真实路径不足')+'；不绘制模拟边界。';
 }
 if(job.display?.rangeAvailable)return job.display.rangeRouteDisagreements?job.display.note:'';
 const failure=job.rangeDiagnostics?.failures?.find(f=>['isochrone','isodistance'].includes(f.service));
 if(job.analysis?.walkingModelId==='walking80-v1'||job.walkingModelId==='walking80-v1'){
  const sampled=job.geojson?.features?.some(f=>f.properties?.featureType==='sampled_boundary');
  const reason=failure?.apiStatus===240?'240（APP服务被禁用）':failure?.apiStatus===210?'210（IP校验失败）':failure?.reasonCode==='permission_expired'?'授权已到期':'尚未核实等距圈权限';
  return '官方1200米等距圈不可用：'+reason+'。'+(sampled?'当前为80m/min路网采样近似范围，未测内部区域未知。':'尚无可靠范围边界；仅显示按真实路线距离计算的80m/min可达设施。');
 }
 if(failure?.apiStatus===210)return '官方步行圈暂不可用：百度返回210（APP IP校验失败）。当前仅显示真实可达设施与路线。';
 if(failure?.reasonCode==='permission_expired')return '官方等时圈授权已到期；当前仅显示真实可达设施与路线。';
 return '尚未取得连续15分钟步行范围；当前仅显示真实可达设施与路线。';
}
