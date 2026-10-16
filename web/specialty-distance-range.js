import{centeredLinear}from'./centered-range-shape.js';
import{radialCostRadius}from'./radial-cost-model.js';
import{boundaryContainsPoint}from'./sample-boundary.js';
import{roadMeters}from'./road-time-graph.js';
const same=(a,b)=>a&&b&&[a.lng,a.lat,b.lng,b.lat].every(Number.isFinite)&&Math.abs(a.lng-b.lng)<=1e-6&&Math.abs(a.lat-b.lat)<=1e-6;
const destination=(c,bearing,radius)=>{const d=radius/6371000,a=bearing*Math.PI/180,lat=c.lat*Math.PI/180,lng=c.lng*Math.PI/180,p=Math.asin(Math.sin(lat)*Math.cos(d)+Math.cos(lat)*Math.sin(d)*Math.cos(a));return[((lng+Math.atan2(Math.sin(a)*Math.sin(d)*Math.cos(lat),Math.cos(d)-Math.sin(lat)*Math.sin(p)))*180/Math.PI+540)%360-180,p*180/Math.PI];};
// Same origin, observations, bearing order, fitted cost model and shape method
// as the 1200m production contour. Do not mix road-prefix endpoints or select a
// different cost merely because its distance is closer to 1000m.
export function specialtyDistanceRange(job,distanceMeters=1000){
 const origin=job?.analysis?.origin,center=origin?.location,count=job?.sampleMetrics?.requestedDirections??job?.sampleMetrics?.requestedSectors??36;
 const failure=(reasonCode,n=0)=>({status:'unavailable',reasonCode,distanceMeters,ring:null,validDirections:n,requestedDirections:count,source:'production_radial_cost_model',newApiCalls:0});
 if(!center||![center.lng,center.lat].every(Number.isFinite))return failure('origin_missing');
 if(![36,48].includes(count)||!Number.isFinite(distanceMeters)||distanceMeters<=0||distanceMeters>1200)return failure('unsupported_distance_model');
 const estimates=job.boundaryEstimates;
 if(estimates?.length!==count||new Set(estimates.map(e=>e.sector)).size!==count)return failure('production_radial_model_missing');
 const samples=job.rangeSamples?.length?job.rangeSamples:job.heatSamples??[],evidence=new Map(samples.map(s=>[s.evidenceId,s])),points=[],ids=[];
 for(let sector=0;sector<count;sector++){
  const e=estimates.find(e=>e.sector===sector),s=evidence.get(e?.evidenceId),a=s?.requestedOrigin??s?.origin,p=a?.location??a,d=s?.requestedDestination?.location??s?.destination?.location??s?.destination,model=e?.radialCostModel;
  if(!e||e.estimated||!s||s.mode!=='walking'||s.routeStatus!=='ok'||s.coordinateSystem!=='BD-09LL'||!same(p,center)||(a?.uid??s.originUid??null)!==(origin.uid??null)||!Number.isFinite(s.distanceMeters)||s.distanceMeters<=0||!Number.isFinite(s.durationSeconds)||s.durationSeconds<=0||!model||model.version!=='bounded-proportional-walking-v1'||model.referenceDistanceMeters!==1200||Math.abs(model.sampleDistanceMeters-s.distanceMeters)>1e-6)return failure('unbound_production_radial_cost',points.length);
  const target=destination(center,sector*360/count,model.sampleRadiusMeters);
  if(!same(d,{lng:target[0],lat:target[1]})||(s.providerOrigin&&roadMeters([s.providerOrigin.lng,s.providerOrigin.lat],[center.lng,center.lat])>150))return failure('wrong_origin_or_radial_target',points.length);
  const reference=radialCostRadius(model,1200),radius=radialCostRadius(model,distanceMeters);
  if(reference===null||radius===null||Math.abs(reference-e.radiusMeters)>.05||!e.point||roadMeters(e.point,destination(center,sector*360/count,reference))>.05)return failure('contradictory_production_radial_model',points.length);
  points.push(destination(center,sector*360/count,radius));ids.push(e.evidenceId);
 }
 const shape=centeredLinear(points,center);
 if(!shape.ring)return failure(shape.reasonCode,count);
 const parent=job.geojson?.features?.find(f=>f.properties?.featureType==='sampled_boundary'&&f.geometry?.type==='Polygon')?.geometry.coordinates[0];
 // Report an unsupported estimate instead of clipping or changing either ring.
 if(parent&&distanceMeters<1200&&shape.ring.some(p=>!boundaryContainsPoint(parent,p)))return failure('non_nested_sampled_model',count);
 return{status:'sampled_approximation',reasonCode:null,distanceMeters,ring:shape.ring,controlPoints:points,validDirections:count,requestedDirections:count,source:'production_radial_cost_model',originContained:true,coordinateSystem:'BD-09LL',origin:center,originUid:origin.uid??null,boundaryMethod:shape.method,splineTension:shape.tension,interiorStatus:'unknown_between_samples',costStatus:'estimated_not_separate_route_witness',evidenceIds:ids,newApiCalls:0};
}
