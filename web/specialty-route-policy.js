import{boundSpecialtyRoute}from'./specialty-diagnostics.js';
import{verifiedSpecialtyLines}from'./specialty-map-a38.js';
import{SPECIALTY_COLORS}from'./subtype-icons.js';
export const SPECIALTY_IDS=Object.freeze(['market','pharmacy','primary_school']);
export function specialtyRouteState(row,origin){
 if(!row?.nearest||!boundSpecialtyRoute(row.nearest,origin))return'unknown';
 const d=row.nearest.distanceMeters;return d<=1000?'within_1km':d<=1200?'supplement_15min':'outside_15min';
}
export const specialtyRouteStateText=state=>({within_1km:'1公里内可达',supplement_15min:'1公里外 · 15分钟内可达',outside_15min:'15分钟外',unknown:'待核验'}[state]??'待核验');
// Distances select real endpoint evidence only; neither the polygons nor the
// rendered path length can change the existing accessibility decisions.
export function specialtyRoutePlans(rows,pois,origin){return SPECIALTY_IDS.map(id=>{
 const candidates=pois.filter(p=>p.subtypeId===id&&boundSpecialtyRoute(p.nearest,origin)).sort((a,b)=>a.nearest.distanceMeters-b.nearest.distanceMeters||String(a.identityKey).localeCompare(String(b.identityKey)));
 const row=candidates[0]??rows.find(r=>r.subtypeId===id),state=specialtyRouteState(row,origin),lines=row?verifiedSpecialtyLines(row,origin):[];
 return{subtypeId:id,state,row:row??null,lines,candidateCount:new Set(candidates.map(p=>p.identityKey)).size,auto:state==='supplement_15min',color:SPECIALTY_COLORS[id]};
});}
export function specialtyAllRoutePlans(pois,origin){
 const seen=new Set();return pois.flatMap(p=>{const key=p.subtypeId+':'+p.identityKey;if(!SPECIALTY_IDS.includes(p.subtypeId)||seen.has(key)||!boundSpecialtyRoute(p.nearest,origin)||p.nearest.distanceMeters>1200)return[];seen.add(key);const state=specialtyRouteState(p,origin),lines=verifiedSpecialtyLines(p,origin);return lines.length?[{subtypeId:p.subtypeId,state,row:p,lines,candidateCount:1,auto:false,color:SPECIALTY_COLORS[p.subtypeId]}]:[];});
}
export function priorityRoute(plan,origin,{focused=false}={}){
 if(!plan?.row||!plan.lines.length||!['within_1km','supplement_15min'].includes(plan.state))return null;
 const p=plan.row,r=p.nearest;return{...r,identityKey:p.identityKey,uid:r.facilityUid??r.destinationUid,facilityUid:r.facilityUid,categoryIds:[p.categoryId],subtypeIds:[p.subtypeId],origin,geometry:p.geometry,reachabilityState:r.distanceMeters<=1200?'reachable':'over_threshold',routeProfile:'specialty',renderColor:plan.color,supplemental:plan.state==='supplement_15min',forceFocused:focused||plan.auto,specialtyId:p.subtypeId};
}
export function composeSpecialtyRoutes(routes,facilities,priority){
 const keys=new Set(facilities.filter(p=>p.subtypeIds?.some(id=>SPECIALTY_IDS.includes(id))).map(p=>p.identityKey));
 const result=new Map((routes??[]).filter(r=>!keys.has(r.identityKey)&&!r.subtypeIds?.some(id=>SPECIALTY_IDS.includes(id))).map(r=>[r.identityKey,r]));
 for(const r of[...(priority??[])].filter(Boolean).sort((a,b)=>Number(a.supplemental)-Number(b.supplemental)))result.set(r.identityKey,r);return[...result.values()];
}
