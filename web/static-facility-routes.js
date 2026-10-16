import{routeLines}from'./walking-network.js';
// Existing bound, <=900s provider geometries only; no animation or upstream requests.
export function createStaticFacilityRoutes({map,B,onClick=()=>{},getOrigin=()=>null}){
 let overlays=[],key='';
 function clear(){for(const line of overlays)map.removeOverlay(line);overlays=[];key='';}
 function set(routes,groups,category='all'){
  const origin=getOrigin(),nextKey=JSON.stringify([origin,category,routes,groups.map(g=>[g.id,g.color])]);if(key===nextKey)return;clear();key=nextKey;
  for(const row of routes??[]){if(row.coordinateSystem!=='BD-09LL'||row.mode!=='walking'||!Number.isFinite(row.durationSeconds)||row.durationSeconds>900||row.durationSeconds<0)continue;
   const actual=row.origin?.location??row.origin,expected=origin?.location;
   if(!expected||!actual||Math.abs(actual.lng-expected.lng)>.000001||Math.abs(actual.lat-expected.lat)>.000001||(row.origin?.uid??row.originUid??null)!==(origin.uid??null))continue;
   if(category!=='all'&&!row.categoryIds.includes(category))continue;
   const group=groups.find(g=>g.id===(category==='all'?row.categoryIds[0]:category));if(!group)continue;
   for(const path of routeLines(row.geometry)){const line=new B.Polyline(path.map(([lng,lat])=>new B.Point(lng,lat)),{strokeColor:group.color,strokeWeight:2.4,strokeOpacity:.78,enableMassClear:false});
    line.lifeCircleFacilityRoute=row.identityKey;line.lifeCircleCategoryRoute=group.id;line.addEventListener?.('click',()=>onClick(row.identityKey));map.addOverlay(line);overlays.push(line);}
  }
 }
 return{set,clear,count:()=>overlays.length};
}
