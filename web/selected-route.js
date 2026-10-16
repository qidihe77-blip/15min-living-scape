import{withinWalkingLimit,decisionSeconds}from'./walking-model.js';
import {routeLines} from './walking-network.js';
import {createRouteFlowRenderer} from './route-flow-a42.js?v=a76';
export function drawableFacilityRoutes(routes,origin,category='all'){
 const p=origin?.location,seen=new Set();if(!p||![p.lng,p.lat].every(Number.isFinite))return[];
 return(routes??[]).filter(r=>{const a=r.origin?.location??r.origin;
  if(!a||!r.identityKey||seen.has(r.identityKey)||r.coordinateSystem!=='BD-09LL'||r.mode!=='walking'
   ||!(withinWalkingLimit(r)||r.reachabilityState==='over_threshold'&&decisionSeconds(r)>900)||!Number.isFinite(r.distanceMeters)||r.distanceMeters<0
   ||Math.abs(a.lng-p.lng)>.000001||Math.abs(a.lat-p.lat)>.000001||![a.lng,a.lat].every(Number.isFinite)
   ||(r.origin?.uid??r.originUid??null)!==(origin.uid??null)||(category!=='all'&&!r.categoryIds?.includes(category))
   ||(r.uid&&r.destinationUid&&r.uid!==r.destinationUid&&r.facilityUid!==r.uid)||!routeLines(r.geometry).length)return false;
  seen.add(r.identityKey);return true;});
}
export function selectDrawableRoute(routes,origin,category,identity=null){
 if(category==='all'&&!identity)return null;const p=origin?.location;
 return drawableFacilityRoutes(routes,origin,category)
  .sort((a,b)=>a.distanceMeters-b.distanceMeters||a.durationSeconds-b.durationSeconds||a.identityKey.localeCompare(b.identityKey))
  .find((r,_i,all)=>identity?r.identityKey===identity:r===all[0])??null;
}
export function createSelectedRouteViewer({map,B,canvas,getOrigin,getPulseOrigin=()=>getOrigin()?.location,getMaskPoints=()=>[],onClick=()=>{},onState=()=>{}}){
 let selected=null,visible=[],category=null,identity=null,cachedLineCount=0;
 const lineCount=()=>cachedLineCount;
 const renderer=createRouteFlowRenderer({map,B,canvas,getPulseOrigin,getMaskPoints,onClick:r=>onClick(r.identityKey),onState:s=>onState({...s,projectedSegments:s.lines,lines:lineCount(),visibleRouteCount:visible.length,selectedRouteCount:selected?1:0,identityKey:selected?.identityKey??null,activeCategory:category})});
 return {set(routes,groups,nextCategory,enabledCategories=null){if(category!==nextCategory)identity=null;category=nextCategory;
   const eligible=drawableFacilityRoutes(routes,getOrigin(),'all');visible=eligible.filter(r=>r.routeProfile==='specialty'||(Array.isArray(enabledCategories)?r.categoryIds?.some(id=>enabledCategories.includes(id)):category==='all'||r.categoryIds?.includes(category)));
   selected=category==='all'&&!identity?null:selectDrawableRoute(routes,getOrigin(),category,identity);
   const rendered=visible.map(r=>{const categoryId=r.categoryIds?.includes(category)?category:r.categoryIds?.find(id=>!enabledCategories||enabledCategories.includes(id))??r.categoryIds[0];return{...r,categoryId,overThreshold:!withinWalkingLimit(r),color:groups.find(g=>g.id===categoryId)?.color??'#2198cf',focused:r.forceFocused||category!=='all'&&r.categoryIds?.includes(category),highlighted:r.identityKey===selected?.identityKey,lines:routeLines(r.geometry),drawable:true,visible:true};});cachedLineCount=rendered.reduce((n,r)=>n+r.lines.length,0);renderer.set(rendered,'light');
  },select(id){identity=id;},count:lineCount,
  refreshOrigin:()=>renderer.refreshOrigin(),getSnapshot:()=>renderer.getSnapshot(),
  invalidate(){renderer.clear();},clear(){selected=null;visible=[];identity=null;cachedLineCount=0;renderer.clear();},dispose:()=>renderer.dispose()};
}
