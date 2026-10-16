// Conservative ring validation. No convex hull, coordinate rounding, smoothing or hole filling.
const finite=p=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite)&&Math.abs(p[0])<=180&&Math.abs(p[1])<=90;
const orient=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
const on=(a,b,c)=>Math.abs(orient(a,b,c))<1e-10&&c[0]>=Math.min(a[0],b[0])-1e-8&&c[0]<=Math.max(a[0],b[0])+1e-8&&c[1]>=Math.min(a[1],b[1])-1e-8&&c[1]<=Math.max(a[1],b[1])+1e-8;
const crosses=(a,b,c,d)=>{const x=orient(a,b,c),y=orient(a,b,d),z=orient(c,d,a),w=orient(c,d,b);return(x*y<0&&z*w<0)||on(a,b,c)||on(a,b,d)||on(c,d,a)||on(c,d,b);};
export function boundaryContainsPoint(ring,point){
 const p=Array.isArray(point)?point:[point?.lng,point?.lat];
 if(!finite(p)||!Array.isArray(ring)||ring.length<4)return false;
 let inside=false;
 for(let i=0,j=ring.length-2;i<ring.length-1;j=i++){
  const a=ring[j],b=ring[i];if(on(a,b,p))return true;
  if((a[1]>p[1])!==(b[1]>p[1])&&p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])inside=!inside;
 }return inside;
}
// Official rings can have many vertices. Sweep bounding boxes; cap pathological work.
// Validation does not round, delete, smooth or reorder provider coordinates.
export function validateBoundaryRing(ring){
 if(!Array.isArray(ring)||ring.length<4||ring.length>20001||!ring.every(finite)||ring[0][0]!==ring.at(-1)[0]||ring[0][1]!==ring.at(-1)[1])return{valid:false,reasonCode:'invalid_boundary_coordinates'};
 const points=ring.slice(0,-1);if(new Set(points.map(p=>p.join(','))).size!==points.length)return{valid:false,reasonCode:'collapsed_boundary_vertices'};
 const origin=points[0],scale=Math.cos(origin[1]*Math.PI/180),metric=points.map(p=>[(p[0]-origin[0])*111320*scale,(p[1]-origin[1])*111320]);
 const segments=metric.map((a,i)=>{const b=metric[(i+1)%metric.length];return{a,b,i,minX:Math.min(a[0],b[0]),maxX:Math.max(a[0],b[0]),minY:Math.min(a[1],b[1]),maxY:Math.max(a[1],b[1])};}).sort((a,b)=>a.minX-b.minX||a.i-b.i);
 let active=[],comparisons=0;
 for(const s of segments){active=active.filter(t=>t.maxX>=s.minX-1e-8);for(const t of active){
  if(++comparisons>1000000)return{valid:false,reasonCode:'geometry_complexity_unverified'};
  const gap=Math.abs(s.i-t.i);if(gap===1||gap===metric.length-1||s.maxY<t.minY-1e-8||t.maxY<s.minY-1e-8)continue;
  if(crosses(s.a,s.b,t.a,t.b))return{valid:false,reasonCode:'self_intersecting_boundary'};}active.push(s);}
 const area=Math.abs(metric.reduce((n,p,i)=>{const q=metric[(i+1)%metric.length];return n+p[0]*q[1]-q[0]*p[1];},0)/2);
 return area>0.00001?{valid:true,reasonCode:null,areaSquareMeters:area}:{valid:false,reasonCode:'degenerate_boundary'};
}
export function cleanSampleBoundary(points,{center,minVertexSeparationMeters=1,requireContainsCenter=false}={}){
 if(!Array.isArray(points)||points.length<3||points.length>64||!points.every(finite)||!Number.isFinite(center?.lng)||!Number.isFinite(center?.lat))return{ring:null,reasonCode:'invalid_boundary_coordinates'};
 const scale=Math.cos(center.lat*Math.PI/180),metric=p=>[(p[0]-center.lng)*111320*scale,(p[1]-center.lat)*111320];
 const source=points[0][0]===points.at(-1)[0]&&points[0][1]===points.at(-1)[1]?points.slice(0,-1):points;
 const ring=[],metres=[];for(const p of source){const m=metric(p);if(metres.some(q=>Math.hypot(m[0]-q[0],m[1]-q[1])<minVertexSeparationMeters))return{ring:null,reasonCode:'collapsed_boundary_vertices'};ring.push([...p]);metres.push(m);}
 if(ring.length<3)return{ring:null,reasonCode:'insufficient_boundary_vertices'};
 const area=metres.reduce((n,p,i)=>{const q=metres[(i+1)%metres.length];return n+p[0]*q[1]-q[0]*p[1];},0)/2;
 for(let i=0;i<metres.length;i++)for(let j=i+1;j<metres.length;j++){if(j===i+1||i===0&&j===metres.length-1)continue;if(crosses(metres[i],metres[(i+1)%metres.length],metres[j],metres[(j+1)%metres.length]))return{ring:null,reasonCode:'self_intersecting_boundary'};}
 if(Math.abs(area)<1)return{ring:null,reasonCode:'degenerate_boundary'};
 ring.push([...ring[0]]);
 if(requireContainsCenter&&!boundaryContainsPoint(ring,center))return{ring:null,reasonCode:'origin_outside_sampled_boundary'};
 return{ring,reasonCode:null,areaSquareMeters:Math.abs(area),coordinateChange:'closure_only'};
}
