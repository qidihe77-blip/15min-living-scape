import{routeLines}from'./walking-network.js';import{roadMeters}from'./road-time-graph.js';
const straightDistanceMeters=(a,b)=>roadMeters([a.lng,a.lat],[b.lng,b.lat]);
export function routePrefixAtDistance(route,target=1200){
 const lines=routeLines(route.geometry);if(lines.length!==1)return{point:null,reasonCode:lines.length?'disconnected_provider_steps':'missing_path'};
 const line=lines[0],p=a=>({lng:a[0],lat:a[1]}),lengths=line.slice(1).map((b,i)=>straightDistanceMeters(p(line[i]),p(b))),sum=lengths.reduce((n,x)=>n+x,0);
 if(!sum||!Number.isFinite(route.distanceMeters)||route.distanceMeters<=0||route.distanceMeters/sum<.5||route.distanceMeters/sum>2)return{point:null,reasonCode:'path_cost_length_mismatch'};
 const goal=sum*Math.min(1,target/route.distanceMeters);let done=0;
 for(let i=0;i<lengths.length;i++){if(done+lengths[i]>=goal){const t=lengths[i]?Math.max(0,Math.min(1,(goal-done)/lengths[i])):0,a=line[i],b=line[i+1],point=[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t];
  return{point,prefix:{type:'LineString',coordinates:[...line.slice(0,i+1),point]},reasonCode:null,costStatus:'estimated_provider_distance_share',sourceSegment:i,sourceFraction:t,
   targetDistanceMeters:Math.min(target,route.distanceMeters),geometricLengthMeters:sum,providerDistanceMeters:route.distanceMeters};}done+=lengths[i];}
 return{point:null,reasonCode:'invalid_path'};
}
