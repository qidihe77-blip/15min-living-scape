// Presentation only: never remove a row, change evidence, or request Place/Route.
const finitePoint=point=>point&&Number.isFinite(point.x)&&Number.isFinite(point.y);
export function prominentMarkerKeys(rows,{zoom=16,nearestKeys=new Set(),selectedKeys=new Set(),project,origin}={}) {
  const result=new Set(),positions=[],groups=new Set();
  const pixel=location=>{try{const value=project?.(location);return finitePoint(value)?value:null;}catch{return null;}};
  // Origin is anchored at the drop's tip; its head is about20px above that point.
  const originPixel=pixel(origin);if(originPixel)positions.push({x:originPixel.x,y:originPixel.y-20,gap:30});
  for(const row of rows.filter(row=>selectedKeys.has(row.identityKey))){result.add(row.identityKey);groups.add(row.group.id);const p=pixel(row.location);if(p)positions.push({...p,gap:34});}
  // Input is the existing sorted visibleRows; this is not a new nearest algorithm.
  for(const row of rows){
    if(result.has(row.identityKey)||row.status!=='reachable'||!nearestKeys.has(row.identityKey))continue;
    if(zoom<15&&groups.has(row.group.id))continue;
    const p=pixel(row.location);
    if(p&&positions.some(other=>Math.hypot(p.x-other.x,p.y-other.y)<other.gap))continue;
    result.add(row.identityKey);groups.add(row.group.id);if(p)positions.push({...p,gap:34});
  }
  return result;
}
export function markerVisual(row,{zoom=16,prominentKeys=new Set(),selectedKeys=new Set(),hovered=false}={}) {
  const selected=selectedKeys.has(row.identityKey),important=selected||prominentKeys.has(row.identityKey);
  return {important,selected,hovered,width:important?32:18,dotDiameter:zoom<15?7:zoom>=18?10:9};
}
// UI14: each visible, confirmed reachable facility has a compact category icon.
export function compactMarkerVisual(row,{zoom=16,selectedKeys=new Set(),hovered=false}={}){
 const selected=selectedKeys.has(row.identityKey),size=zoom<15?20:24;
 return{important:true,selected,hovered,width:Math.round(size*(selected?1.12:hovered?1.08:1)),dotDiameter:0};
}
export function nearbyMarkerRows(rows,location,{project,radius=20}={}) {
  let point;try{point=project?.(location);}catch{}
  return rows.filter(row=>{
    if(finitePoint(point)){let other;try{other=project?.(row.location);}catch{}
      return finitePoint(other)&&Math.hypot(point.x-other.x,point.y-other.y)<=radius;}
    return Math.abs(row.location.lng-location.lng)<1e-8&&Math.abs(row.location.lat-location.lat)<1e-8;
  });
}
