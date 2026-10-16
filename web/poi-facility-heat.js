import{hasConfirmedFacilityMembership}from'./facility-membership.js';
import{walkingRangePolygons}from'./circle-presentation.js';
import{boundWalkingCost}from'./reachable-presentation.js';
import{modelRoute,WALKING80_MODEL}from'./walking-model.js';
import{roadMeters}from'./road-time-graph.js';
export const POI_HEAT_GRADIENT={0:'#B2EEFF',.35:'#75D8FA',.65:'#339FEC',1:'#2459D9'};
export const POI_HEAT_CSS='linear-gradient(90deg,#2459D9 0%,#339FEC 35%,#75D8FA 65%,#B2EEFF 100%)';
export const poiTimeWeight=seconds=>Number.isFinite(seconds)&&seconds>=0&&seconds<=900 ? .1+.9*(1-seconds/900) : null;
export function poiFacilityHeatData(job,rows,category='all'){
 const origin=job?.analysis?.origin,unique=new Map();
 for(const row of rows??[]){if(!hasConfirmedFacilityMembership(row)||row.classificationUncertain||row.candidateStatus&&row.candidateStatus!=='confirmed_by_rule')continue;
  const cost=row.routeEvidence,route=modelRoute({...cost,origin:cost?.origin??cost?.requestedOrigin},WALKING80_MODEL),checked={...row,routeEvidence:route};
  if(!boundWalkingCost(checked,origin)||!row.location||![row.location.lng,row.location.lat].every(Number.isFinite)||Math.abs(row.location.lng)>180||Math.abs(row.location.lat)>90)continue;
  const weight=poiTimeWeight(route.distanceMeters*60/80);if(weight===null)continue;
  const id=row.uid?'uid:'+row.uid:row.identityKey;if(!id)continue;const old=unique.get(id);if(old&&old.properties.walkTime<=route.modelDurationSeconds)continue;
  unique.set(id,{geometry:{type:'Point',coordinates:[row.location.lng,row.location.lat]},properties:{count:weight*100,walkTime:route.modelDurationSeconds,rawDurationSeconds:cost.durationSeconds,distanceMeters:cost.distanceMeters,uid:row.uid??null,identityKey:id,evidenceId:cost.evidenceId,categoryIds:row.memberships??row.categoryIds??[]}});
 }
 const all=[...unique.values()],size=200,peaks=all.map(p=>all.reduce((sum,q)=>{const distance=roadMeters(p.geometry.coordinates,q.geometry.coordinates),k=Math.max(0,1-distance/size);return sum+q.properties.count*k*k;},0)).sort((a,b)=>a-b);
 const max=Math.max(100,(peaks[Math.min(peaks.length-1,Math.floor(peaks.length*.9))]??100)*1.1),data=category==='all'?all:all.filter(p=>p.properties.categoryIds.includes(category));
 return{status:data.length?'available':'unavailable',reasonCode:data.length?null:'confirmed_poi_walking_costs_unavailable',category,data,renderData:data,polygons:walkingRangePolygons(job),pointCount:data.length,totalPoi:all.length,max,size,source:'confirmed_poi_walking_distance_80m',aggregation:'additive_weighted_poi',timeBasis:WALKING80_MODEL,isContinuousTimeField:false,walkTimeEstimated:true,normalization:'shared_all_categories_p90_local_weighted_peak',gradient:POI_HEAT_GRADIENT,note:'可达设施热度：确认可达设施按真实Walking距离÷80m/min计算耗时，权重=0.1+0.9×(1−秒数/900)。短耗时权重高，官方热力核加和表示加权设施聚集程度；不是连续路网时间场或区域可达证明。'};
}
