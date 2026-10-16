import{hasBlindspotDisplay,blindspotKey}from'./blindspot-model.js?v=a86';
import{exclusiveContourAreas}from'./service-gap-summary.js?v=a86';
import{ringMembership}from'./circle-presentation.js';
import{unionBoundaryLines}from'./blindspot-boundaries.js?v=a73';

// Independent identities survive coincident geometry. Integrate their union
// once; a shared pixel/area is never counted or darkened once per missing type.
export function buildBlindspotCollection(models){
 const active=models.filter(m=>m.target?.type==='category'&&hasBlindspotDisplay(m)),first=active[0];
 if(!first)return{status:'empty',models:[],components:[],targets:[],area:0,combinations:[]};
 const projection=first.projection,polygons=first.polygons,scope=polygons.flatMap(p=>p.map(r=>r.map(([lng,lat])=>projection.project({lng,lat})))),groups=active.map(m=>({id:blindspotKey(m.target),rings:m.components.flatMap(c=>c.rings)})),integral=exclusiveContourAreas(scope,groups);
 const items=active.map(m=>({...m,key:blindspotKey(m.target),area:integral.combinations.filter(c=>c.categoryIds.includes(blindspotKey(m.target))).reduce((n,c)=>n+c.area,0)}));
 return{status:'available',version:'independent-blindspots-v1',projection,polygons,models:items,targets:items.map(m=>m.target),components:items.flatMap(m=>m.components),outerBoundaryLines:unionBoundaryLines(groups.map(g=>g.rings)),combinations:integral.combinations,area:integral.combinations.reduce((n,c)=>n+c.area,0)};
}
export function blindspotHits(collection,point){return(collection?.models??[]).filter(m=>m.components.some(c=>c.rings.reduce((n,r)=>n+(ringMembership(point,r)>0?1:0),0)%2===1)).map(m=>({key:m.key,target:m.target,label:m.label,area:m.area}));}
