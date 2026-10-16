import{boundaryContainsPoint,validateBoundaryRing,cleanSampleBoundary}from'./sample-boundary.js';
export function centeredLinear(points,center){
 const shape=cleanSampleBoundary(points,{center,requireContainsCenter:true,minVertexSeparationMeters:.01});
 return{ring:shape.ring,reasonCode:shape.reasonCode,method:shape.ring?'radial_linear':'none',tension:null};
}
// Shared shape operation only. Cost sampling, thresholds and scoring live elsewhere.
export function centeredSpline(points,center){
 const source=cleanSampleBoundary(points,{center,requireContainsCenter:true,minVertexSeparationMeters:.01});
 if(!source.ring)return{ring:null,reasonCode:source.reasonCode,method:'none'};
 const p=source.ring.slice(0,-1);
 for(const tension of[1,.75,.5,.25,0]){
  const out=[];
  for(let i=0;i<p.length;i++){
   const a=p[(i+p.length-1)%p.length],b=p[i],c=p[(i+1)%p.length],d=p[(i+2)%p.length];
   for(let j=0;j<8;j++){
    const t=j/8,t2=t*t,t3=t2*t;
    out.push([0,1].map(k=>(2*t3-3*t2+1)*b[k]+(-2*t3+3*t2)*c[k]
     +(t3-2*t2+t)*.5*tension*(c[k]-a[k])+(t3-t2)*.5*tension*(d[k]-b[k])));
   }
  }
  out.push([...out[0]]);
  if(validateBoundaryRing(out).valid&&boundaryContainsPoint(out,center))
   return{ring:out,method:tension?'closed_catmull_rom':'validated_linear',tension,reasonCode:null};
 }
 return{ring:source.ring,method:'validated_linear',reasonCode:'spline_validation_failed'};
}
