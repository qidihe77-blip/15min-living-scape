import {reachableFacilityRows} from './reachable-presentation.js';
// A presentation envelope only. Its interior has no route evidence.
export function knownReachableEnvelope(rows, origin) {
 const points=[...new Map(reachableFacilityRows(rows,origin).map(r=>[JSON.stringify(r.location),[r.location.lng,r.location.lat]])).values()]
  .filter(p=>p.every(Number.isFinite)).sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
 if(points.length<3)return null;
 const cross=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
 const half=input=>{const out=[];for(const p of input){while(out.length>=2&&cross(out.at(-2),out.at(-1),p)<=0)out.pop();out.push(p);}return out;};
 const hull=[...half(points).slice(0,-1),...half([...points].reverse()).slice(0,-1)];
 if(hull.length<3)return null;
 return {type:'Feature',geometry:{type:'Polygon',coordinates:[[...hull,hull[0]]]},properties:{
  featureType:'known_reachable_poi_envelope',source:'verified_reachable_poi_endpoints',
  label:'已知可达POI包络（示意）',coordinateSystem:'BD-09LL',interiorStatus:'unknown',
  continuousRangeAvailable:false,presentationOnly:true,pointCount:points.length}};
}
