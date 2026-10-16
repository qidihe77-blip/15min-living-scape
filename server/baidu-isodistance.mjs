import{BaiduApiError}from'./baidu-client.mjs';import{parseIsochronePath}from'./baidu-isochrone.mjs';import{validBd09ll}from'./walking-provider.mjs';
import{WALKING80_MODEL}from'../web/walking-model.js';
export function createBaiduIsodistanceProvider({client,enabled=false,entitlementVerified=false,allowEntitlementProbe=false,expiresAt=null,now=Date.now}){
 return{async getIsodistance({center,signal,probe=false}){
  if(!enabled||(!entitlementVerified&&!(probe&&allowEntitlementProbe)))throw new BaiduApiError('permission_unverified',{service:'isochrone'});
  if(expiresAt&&now()>Date.parse(expiresAt))throw new BaiduApiError('permission_expired',{service:'isochrone'});
  if(!validBd09ll(center))throw new TypeError('Invalid origin.');
  const{data,meta}=await client.requestJson({service:'isochrone',path:'/logistics_truck/v1/isodistance',params:{profile:'foot_shortest',point:center.lng+','+center.lat,distanceLimit:1200,inputCrs:'bd09ll',outputCrs:'bd09ll'},cacheTtlMs:300000,signal});
  const geometry=parseIsochronePath(data?.result?.path);
  return{geometrySource:'baidu_isodistance',geometryStatus:'available',algorithmVersion:'baidu-walking-distance1200-v2',walkingModelId:WALKING80_MODEL,distanceLimitMeters:1200,speedMetersPerMinute:80,thresholdSeconds:900,mode:'walking',coordinateSystem:'BD-09LL',center:{...center},retrievedAt:meta.retrievedAt,
   geojson:{type:'FeatureCollection',features:[{type:'Feature',geometry,properties:{geometrySource:'baidu_isodistance',walkingModelId:WALKING80_MODEL,distanceLimitMeters:1200,thresholdSeconds:900,mode:'walking',coordinateSystem:'BD-09LL'}}]}};
 }};
}
