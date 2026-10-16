import{hasConfirmedFacilityMembership,confirmedCategoryIds}from'./facility-membership.js';
import {reachableFacilityRows,boundWalkingEvidence} from './reachable-presentation.js';
import {decisionSeconds,withinWalkingLimit} from './walking-model.js';
import{facilityAccessState}from'./facility-access-state.js';
import {boundaryContainsPoint} from './sample-boundary.js';

// Display geometry only. Membership is never a walking proof or a scoring input.
const validPoint=p=>Array.isArray(p)&&p.length>=2&&Number.isFinite(p[0])&&Number.isFinite(p[1])&&Math.abs(p[0])<=180&&Math.abs(p[1])<=90;
const cross=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
function ringValid(r){
 if(!Array.isArray(r)||r.length<4||!r.every(validPoint)||r[0][0]!==r.at(-1)[0]||r[0][1]!==r.at(-1)[1])return false;
 let area=0;for(let i=1;i<r.length;i++)area+=r[i-1][0]*r[i][1]-r[i][0]*r[i-1][1];
 if(Math.abs(area)<=1e-12)return false;
 for(let i=0;i<r.length-1;i++)for(let j=i+2;j<r.length-1;j++){
  if(i===0&&j===r.length-2)continue;
  const a=r[i],b=r[i+1],c=r[j],d=r[j+1];
  if(cross(a,b,c)*cross(a,b,d)<0&&cross(c,d,a)*cross(c,d,b)<0)return false;
 }
 return true;
}
export function walkingRangePolygons(job){
 const official=['baidu_isochrone','baidu_isodistance'].includes(job?.geometrySource)&&job?.display?.rangeAvailable!==false;
 return(job?.geojson?.features??[]).flatMap(f=>{
  if(!official&&f.properties?.featureType!=='sampled_boundary')return[];
  if(f.properties?.coordinateSystem&&f.properties.coordinateSystem!=='BD-09LL')return[];
  const g=f.geometry,p=g?.type==='Polygon'?[g.coordinates]:g?.type==='MultiPolygon'?g.coordinates:[];
  const center=job?.analysis?.origin?.location??job?.center;
  return p.filter(rings=>rings.length&&rings.every(ringValid)&&(!center||
   boundaryContainsPoint(rings[0],center)&&!rings.slice(1).some(r=>boundaryContainsPoint(r,center))));
 });
}
// 0 outside, 1 inside, 2 boundary; include outer boundary and exclude hole interiors.
export function ringMembership(p,ring){
 let inside=false;
 for(let i=0,j=ring.length-1;i<ring.length;j=i++){
  const a=ring[j],b=ring[i];
  if(Math.abs(cross(a,b,p))<1e-12&&p[0]>=Math.min(a[0],b[0])-1e-10&&p[0]<=Math.max(a[0],b[0])+1e-10&&p[1]>=Math.min(a[1],b[1])-1e-10&&p[1]<=Math.max(a[1],b[1])+1e-10)return 2;
  if((a[1]>p[1])!==(b[1]>p[1])&&p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])inside=!inside;
 }
 return inside?1:0;
}
export function insideWalkingRange(location,polygons){
 const p=[location?.lng,location?.lat];if(!validPoint(p))return false;
 return polygons.some(rings=>ringMembership(p,rings[0])>0&&!rings.slice(1).some(r=>ringMembership(p,r)===1));
}
export function circleFacilityRows(rows,job){
 const polygons=walkingRangePolygons(job),seen=new Set();
 if(!polygons.length)return[];
 return(rows??[]).filter(row=>{
  const key=row.uid?'uid:'+row.uid:row.identityKey;
  if(!key||seen.has(key)||!(hasConfirmedFacilityMembership(row)||row.pendingSubtypeIds?.length)||!insideWalkingRange(row.location,polygons))return false;
  seen.add(key);return true;
 });
}
export function mapFacilityRows(rows,job){
 const visible=[...circleFacilityRows(rows,job),...reachableFacilityRows(rows,job?.analysis?.origin)];return [...new Map(visible.map(p=>[p.identityKey??('uid:'+p.uid),p])).values()];
}
export function mapPresentationRows(rows,job,categories,active='all'){
 const polygons=walkingRangePolygons(job);
 return mapFacilityRows(rows,job).map(row=>{
  const ids=confirmedCategoryIds(row,{categories}),groups=categories.filter(g=>ids.includes(g.id)),memberships=groups.map(g=>g.id);
  const inside=insideWalkingRange(row.location,polygons),validRoute=boundWalkingEvidence(row,job?.analysis?.origin),reachable=validRoute&&withinWalkingLimit(row.routeEvidence);
  return{...row,...facilityAccessState({hasRange:polygons.length>0,inside,classified:memberships.length>0,validRoute,reachable}),rangeMembership:polygons.length?inside?'inside':'outside':'unknown',onMap:true,memberships,classificationUncertain:!groups.length,group:categories.find(g=>g.id===active&&memberships.includes(g.id))??groups[0]??row.group};
 });
}
export const subtypeDisplayLabel=(sub)=>sub.id==='community_eldercare'?'社区养老':sub.label;

export function accessibilityTrend(rows,origin){
 const reachable=reachableFacilityRows(rows,origin),seen=new Map();
 for(const row of reachable){const r=row.routeEvidence,seconds=decisionSeconds(r),key=row.uid?'uid:'+row.uid:row.identityKey;
  if(Number.isFinite(seconds)&&seconds>=0&&seconds<=900&&(!seen.has(key)||seconds<seen.get(key)))seen.set(key,seconds);
 }
 return[0,3,6,9,12,15].map(minutes=>({minutes,count:[...seen.values()].filter(s=>s<=minutes*60).length}));
}
