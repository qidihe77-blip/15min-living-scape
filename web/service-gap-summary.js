import{buildBlindspotModels}from'./blindspot-model.js?v=a86';
import{localServiceProjection}from'./grid-contours.js';

// Integrate the actual rendered linear contours. Vertex and segment-intersection
// x coordinates partition the plane into slabs in which every boundary is linear.
// Even/odd crossings identify mutually exclusive missing-category combinations;
// midpoint height × slab width is then exact, including holes and shared edges.
export function exclusiveContourAreas(scopeRings,groups){
 const edges=[],xs=[];function add(rings,bit){for(const ring of rings)for(let i=1;i<ring.length;i++){const a=ring[i-1],b=ring[i];if(![...a,...b].every(Number.isFinite))throw Error('Invalid contour coordinate');xs.push(a[0],b[0]);if(Math.abs(a[0]-b[0])<1e-9)continue;const lo=Math.min(a[0],b[0]),hi=Math.max(a[0],b[0]),slope=(b[1]-a[1])/(b[0]-a[0]);edges.push({lo,hi,slope,intercept:a[1]-slope*a[0],bit});}}
 const scopeBit=2**groups.length;add(scopeRings,scopeBit);groups.forEach((g,i)=>add(g.rings,2**i));
 for(let i=0;i<edges.length;i++)for(let j=i+1;j<edges.length;j++){const a=edges[i],b=edges[j];if(a.bit===b.bit||Math.abs(a.slope-b.slope)<1e-12)continue;const lo=Math.max(a.lo,b.lo),hi=Math.min(a.hi,b.hi);if(lo>=hi)continue;const x=(b.intercept-a.intercept)/(a.slope-b.slope);if(x>lo+1e-8&&x<hi-1e-8)xs.push(x);}
 const cuts=xs.sort((a,b)=>a-b).filter((x,i,a)=>!i||x-a[i-1]>1e-8),areas=new Map();let scopeArea=0;
 for(let i=1;i<cuts.length;i++){const width=cuts[i]-cuts[i-1];if(width<1e-8)continue;const x=(cuts[i]+cuts[i-1])/2,crossings=edges.filter(e=>x>e.lo&&x<e.hi).map(e=>({y:e.slope*x+e.intercept,bit:e.bit})).sort((a,b)=>a.y-b.y);let mask=0;
  for(let j=0;j<crossings.length;j++){mask^=crossings[j].bit;const next=crossings[j+1];if(!next||!(mask&scopeBit))continue;const area=Math.max(0,next.y-crossings[j].y)*width;if(!area)continue;scopeArea+=area;const missing=mask&(scopeBit-1);if(missing)areas.set(missing,(areas.get(missing)??0)+area);}
 }
 return{scopeArea,combinations:[...areas].filter(([,area])=>area>1e-5).map(([mask,area])=>({mask,area,categoryIds:groups.filter((g,i)=>mask&2**i).map(g=>g.id)}))};
}

export function buildServiceGapSummary(job,rows,tree,models=null){
 const start=performance.now(),origin=job?.analysis?.origin?.location;if(!origin)return{status:'unavailable',combinations:[],newApiRequests:0,affectsScore:false};
 const list=(models??buildBlindspotModels(job,rows,tree)).filter(m=>(!m.target||m.target.type==='category')&&tree.categories.some(g=>g.id===m.categoryId)),projection=localServiceProjection(origin),polygons=list.find(m=>m.polygons?.length)?.polygons??[],scope=polygons.flatMap(p=>p.map(r=>r.map(([lng,lat])=>projection.project({lng,lat}))));
 if(!scope.length)return{status:'unavailable',combinations:[],newApiRequests:0,affectsScore:false};
 const groups=list.map(m=>({id:m.categoryId,label:m.label??tree.categories.find(g=>g.id===m.categoryId)?.label,rings:m.components.flatMap(c=>c.rings)})),unknown=list.filter(m=>!['available','empty'].includes(m.status)).map(m=>m.categoryId),labels=c=>({...c,labels:c.categoryIds.map(id=>groups.find(g=>g.id===id).label),compound:c.categoryIds.length>1}),integral=exclusiveContourAreas(scope,groups),combinations=integral.combinations.map(labels).sort((a,b)=>b.area-a.area||a.mask-b.mask),gapArea=combinations.reduce((n,c)=>n+c.area,0),totalArea=integral.scopeArea;
 const allCategoriesPresent=list.length>=6&&list.every(m=>m.categoryPresent===true);
 const assessed=determinateContourAreas(scope,groups,list),determinateArea=assessed.scopeArea,determinateGapArea=assessed.combinations.reduce((n,c)=>n+c.area,0),determinateCombinations=assessed.combinations.map(labels).sort((a,b)=>b.area-a.area||a.mask-b.mask);
 return{version:'service-gap-summary-v1',status:allCategoriesPresent?'covered':gapArea>1e-5?(unknown.length?'partial':'available'):unknown.length?'insufficient':'empty',allCategoriesPresent,totalArea,gapArea:unknown.length&&gapArea<=1e-5?null:gapArea,ratio:unknown.length&&gapArea<=1e-5?null:totalArea>0?gapArea/totalArea:null,combinations,determinateArea,determinateGapArea,determinateRatio:determinateArea>0?determinateGapArea/determinateArea:null,determinateCombinations,unknownCategoryIds:unknown,lowerBound:unknown.length>0,source:'existing_grid200_rendered_contours',newApiRequests:0,affectsScore:false,computeMs:performance.now()-start};
}

export function determinateContourAreas(scope,groups,models){
 const constrained=models.filter(m=>m.assessmentScope!=='full'&&!m.categoryPresent);
 if(!constrained.length)return exclusiveContourAreas(scope,groups);
 if(constrained.some(m=>!['available','empty'].includes(m.status)||!m.assessedMask))return{scopeArea:0,combinations:[]};
 const base=constrained[0];if(constrained.some(m=>m.width!==base.width||m.height!==base.height||m.x0!==base.x0||m.y0!==base.y0||m.cellMeters!==base.cellMeters))return{scopeArea:0,combinations:[]};
 const rings=[];for(let i=0;i<base.assessedMask.length;i++)if(constrained.every(m=>m.assessedMask[i])){const x=base.x0+i%base.width*base.cellMeters,y=base.y0+Math.floor(i/base.width)*base.cellMeters,s=base.cellMeters;rings.push([[x,y],[x+s,y],[x+s,y+s],[x,y+s],[x,y]]);}
 return rings.length?exclusiveContourAreas(rings,groups):{scopeArea:0,combinations:[]};
}

// Deterministic tangent placement. A single common scale preserves all bubble
// area ratios; the outer region is a context frame, never a second data bubble.
export function packGapBubbles(items,{radius=102,gap=4,totalArea=null,referenceRadius=118}={}){
 if(!items.length)return[];const max=Math.max(...items.map(i=>i.area));if(!(max>0))return[];const placed=[];
 for(const item of items){const r=totalArea>0?referenceRadius*Math.sqrt(item.area/totalArea):radius*Math.sqrt(item.area/max);let best=null;if(!placed.length)best={x:0,y:0};else{const candidates=[];for(const p of placed)for(let k=0;k<180;k++){const a=k*Math.PI/90;candidates.push({x:p.x+(p.r+r+gap)*Math.cos(a),y:p.y+(p.r+r+gap)*Math.sin(a)});}for(const c of candidates){if(placed.some(p=>Math.hypot(p.x-c.x,p.y-c.y)<p.r+r+gap-1e-7))continue;const bound=Math.max(Math.hypot(c.x,c.y)+r,...placed.map(p=>Math.hypot(p.x,p.y)+p.r));if(!best||bound<best.bound)best={...c,bound};}if(!best){const right=Math.max(...placed.map(p=>p.x+p.r));best={x:right+r+gap,y:0};}}
  placed.push({...item,...best,r});
 }
 const minX=Math.min(...placed.map(p=>p.x-p.r)),maxX=Math.max(...placed.map(p=>p.x+p.r)),minY=Math.min(...placed.map(p=>p.y-p.r)),maxY=Math.max(...placed.map(p=>p.y+p.r)),cx=(minX+maxX)/2,cy=(minY+maxY)/2,bound=Math.max(...placed.map(p=>Math.hypot(p.x-cx,p.y-cy)+p.r)),scale=Math.min(1,radius/bound);
 return placed.map(({bound,...p})=>({...p,x:(p.x-cx)*scale,y:(p.y-cy)*scale,r:p.r*scale}));
}
