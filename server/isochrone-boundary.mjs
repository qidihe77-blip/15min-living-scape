import {cleanSampleBoundary,validateBoundaryRing,boundaryContainsPoint} from '../web/sample-boundary.js';
export const BOUNDARY_SHAPE_VERSION='walking36-constrained-polar-pchip-v1';
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
export function boundaryPlane(center){const mx=111320*Math.cos(center.lat*Math.PI/180);return{xy:p=>({x:(p[0]-center.lng)*mx,y:(p[1]-center.lat)*111320}),ll:p=>[center.lng+p.x/mx,center.lat+p.y/111320]};}
const cross=(a,b)=>a.x*b.y-a.y*b.x;
export function pointSegmentDistance(p,a,b){const x=b.x-a.x,y=b.y-a.y,t=clamp(((p.x-a.x)*x+(p.y-a.y)*y)/(x*x+y*y||1),0,1);return Math.hypot(p.x-a.x-t*x,p.y-a.y-t*y);}
export function boundaryArea(ring,center){const {xy}=boundaryPlane(center),p=ring.map(xy);return Math.abs(p.slice(1).reduce((n,q,i)=>n+cross(p[i],q),0))/2;}
export function boundaryOffset(a,b,center){const {xy}=boundaryPlane(center),p=a.map(xy),q=b.map(xy);let max=0;for(let i=0;i<p.length-1;i++)for(let j=0;j<=4;j++){const t=j/4,s={x:p[i].x+(p[i+1].x-p[i].x)*t,y:p[i].y+(p[i+1].y-p[i].y)*t};max=Math.max(max,Math.min(...q.slice(1).map((v,k)=>pointSegmentDistance(s,q[k],v))));}return max;}
// Interpolates only the original radial knots; creates no new observations.
// Positive, angularly ordered radii cannot self-intersect. PCHIP slopes forbid
// radial overshoot, and the blend is bounded relative to the unsmoothed chord.
export function shapePreservingBoundary(points,center,{maxOffsetMeters=20,steps=8}={}){
 if(!Number.isFinite(maxOffsetMeters)||maxOffsetMeters<0||maxOffsetMeters>25)throw RangeError('Boundary offset must be 0–25 metres');
 const source=cleanSampleBoundary(points,{center,requireContainsCenter:true,minVertexSeparationMeters:.01});if(!source.ring)return{ring:null,method:'none',reasonCode:source.reasonCode};
 const plane=boundaryPlane(center),knots=source.ring.slice(0,-1).map(ll=>{const p=plane.xy(ll);return{...p,ll,r:Math.hypot(p.x,p.y),angle:Math.atan2(p.y,p.x)};}).sort((a,b)=>a.angle-b.angle),n=knots.length;
 const h=knots.map((p,i)=>(knots[(i+1)%n].angle-p.angle+Math.PI*2)%(Math.PI*2)),d=knots.map((p,i)=>(knots[(i+1)%n].r-p.r)/h[i]),m=knots.map((p,i)=>{const j=(i+n-1)%n;if(d[j]*d[i]<=0)return 0;const w1=2*h[i]+h[j],w2=h[i]+2*h[j];return(w1+w2)/(w1/d[j]+w2/d[i]);}),weights=knots.map((p,i)=>{const a=knots[(i+n-1)%n],b=knots[(i+1)%n],u={x:p.x-a.x,y:p.y-a.y},v={x:b.x-p.x,y:b.y-p.y},turn=Math.acos(clamp((u.x*v.x+u.y*v.y)/(Math.hypot(u.x,u.y)*Math.hypot(v.x,v.y)||1),-1,1))*180/Math.PI;return .45*Math.max(0,1-turn/110);});
 let ring;
 for(const scale of[1,.75,.5,0]){const out=[];
  for(let i=0;i<n;i++){const a=knots[i],b=knots[(i+1)%n];for(let j=0;j<steps;j++){
   if(j===0){out.push([...a.ll]);continue;}const t=j/steps,t2=t*t,t3=t2*t,angle=a.angle+h[i]*t,u={x:Math.cos(angle),y:Math.sin(angle)},v={x:b.x-a.x,y:b.y-a.y},s=clamp(-cross(a,u)/(cross(v,u)||1e-15),0,1),chord={x:a.x+s*v.x,y:a.y+s*v.y},raw=chord.x*u.x+chord.y*u.y,
    cubic=clamp((2*t3-3*t2+1)*a.r+(t3-2*t2+t)*h[i]*m[i]+(-2*t3+3*t2)*b.r+(t3-t2)*h[i]*m[(i+1)%n],Math.min(a.r,b.r),Math.max(a.r,b.r)),move=clamp((cubic-raw)*Math.min(weights[i],weights[(i+1)%n])*scale,-maxOffsetMeters,maxOffsetMeters),radius=raw+move;
   out.push(plane.ll({x:u.x*radius,y:u.y*radius}));
  }}out.push([...out[0]]);
  if(!validateBoundaryRing(out).valid||!boundaryContainsPoint(out,center))continue;
  const deviation=Math.max(boundaryOffset(out,source.ring,center),boundaryOffset(source.ring,out,center));if(deviation>maxOffsetMeters+.001)continue;
  ring=out;return{ring,method:'curvature_adaptive_constrained_pchip',version:BOUNDARY_SHAPE_VERSION,maxOffsetMeters,measuredMaxOffsetMeters:deviation,sourceKnotCount:n,scale,reasonCode:null};
 }return{ring:source.ring,method:'validated_linear',version:BOUNDARY_SHAPE_VERSION,reasonCode:'shape_constraint_fallback',maxOffsetMeters,measuredMaxOffsetMeters:0};
}
