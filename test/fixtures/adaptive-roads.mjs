// Analytic OFFLINE road fixture. This is not an upstream result and is never used by production.
export function analyticRoadProvider({ratios=Array(8).fill(1.2),failSector=null,nonMonotonicSector=null,latencyMs=0}={}){
 let calls=0,active=0,peak=0;const log=[];
 return{stats:()=>({calls,peak,log}),route:async(a,b,{originUid=null}={})=>{
  const x=(b.lng-a.lng)*111320*Math.cos(a.lat*Math.PI/180),y=(b.lat-a.lat)*111320,radial=Math.hypot(x,y),angle=(Math.atan2(y,x)+2*Math.PI)%(2*Math.PI),sector=Math.round(angle/(Math.PI/4))%8;
  calls++;peak=Math.max(peak,++active);log.push({sector,radial});if(latencyMs)await new Promise(r=>setTimeout(r,latencyMs));active--;
  if(sector===failSector)return{routeStatus:'no_route'};
  let distance=radial*ratios[sector];if(sector===nonMonotonicSector)distance=radial<500?1000:radial<1200?1600:1500;
  // A bent route with the declared length in the local metric for the monotonic cases.
  const h=Math.sqrt(Math.max(0,(distance/2)**2-(radial/2)**2)),mx=x/2-y/radial*h,my=y/2+x/radial*h;
  const middle=[a.lng+mx/(111320*Math.cos(a.lat*Math.PI/180)),a.lat+my/111320];
  return{routeStatus:'ok',source:'explicit_offline_analytic_road_fixture',mode:'walking',coordinateSystem:'BD-09LL',durationSeconds:distance/1.1,distanceMeters:distance,
   requestedOrigin:{location:a,uid:originUid},requestedDestination:{location:b,uid:null},geometryStatus:'provider_path',geometry:{type:'LineString',coordinates:[[a.lng,a.lat],middle,[b.lng,b.lat]]}};
 }};
}
