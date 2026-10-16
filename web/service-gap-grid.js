import{hasCategoryOnlyMembership}from'./facility-membership.js';
import{walkingRangePolygons,insideWalkingRange,ringMembership}from'./circle-presentation.js';
import{boundWalkingEvidence,reachableFacilityRows}from'./reachable-presentation.js';
import{localServiceProjection,marchingSquares}from'./grid-contours.js';
export const GAP_GRID_VERSION='service-gap-grid200-v2',GAP_CELL_METERS=200,GAP_RADIUS_METERS=1000;
const valid=p=>p&&[p.lng,p.lat].every(Number.isFinite)&&Math.abs(p.lng)<=180&&Math.abs(p.lat)<=90;
export function segmentMeters(p,a,b){const dx=b[0]-a[0],dy=b[1]-a[1],t=Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/(dx*dx+dy*dy||1)));return Math.hypot(p[0]-a[0]-t*dx,p[1]-a[1]-t*dy);}
const insideRings=(p,rings)=>rings.reduce((n,r)=>n+(ringMembership(p,r)>0?1:0),0)%2===1;
export function fourNeighborComponents(mask,width,height){
 const seen=new Uint8Array(mask.length),components=[];for(let i=0;i<mask.length;i++){if(!mask[i]||seen[i])continue;const cells=[i];seen[i]=1;for(let k=0;k<cells.length;k++){const j=cells[k],x=j%width,y=Math.floor(j/width);for(const n of[x>0?j-1:-1,x<width-1?j+1:-1,y>0?j-width:-1,y<height-1?j+width:-1])if(n>=0&&mask[n]&&!seen[n]){seen[n]=1;cells.push(n);}}components.push(cells);}return components;
}
export function cellUnionGeometry(indices,width,{x0=0,y0=0,cellMeters=200}={}){
 const set=new Set(indices),edges=[];for(const i of indices){const x=i%width,y=Math.floor(i/width),a=x0+x*cellMeters,b=y0+y*cellMeters;if(!set.has(i-width))edges.push([[a,b],[a+cellMeters,b]]);if(x===width-1||!set.has(i+1))edges.push([[a+cellMeters,b],[a+cellMeters,b+cellMeters]]);if(!set.has(i+width))edges.push([[a+cellMeters,b+cellMeters],[a,b+cellMeters]]);if(x===0||!set.has(i-1))edges.push([[a,b+cellMeters],[a,b]]);}
 const contains=p=>{const x=Math.floor((p[0]-x0)/cellMeters),y=Math.floor((p[1]-y0)/cellMeters);return x>=0&&x<width&&y>=0&&set.has(y*width+x);};
 const distance=p=>edges.reduce((n,[a,b])=>Math.min(n,segmentMeters(p,a,b)),Infinity);return{edges,contains,distance};
}
// Round corners by at most10m, keeping the complete arc inside the original
// Marching Squares footprint and the confirmed200m cell union. Concave corners
// which would expand the region retain their original position.
export function smoothGapRings(rings,support,{maxTrim=10}={}){
 return rings.map(ring=>{const raw=ring.slice(0,-1),out=[];for(let i=0;i<raw.length;i++){const v=raw[i],a=raw[(i+raw.length-1)%raw.length],b=raw[(i+1)%raw.length],la=Math.hypot(a[0]-v[0],a[1]-v[1]),lb=Math.hypot(b[0]-v[0],b[1]-v[1]),d=Math.min(maxTrim,la*.2,lb*.2);if(d<.01){out.push(v);continue;}const p=[v[0]+(a[0]-v[0])*d/la,v[1]+(a[1]-v[1])*d/la],q=[v[0]+(b[0]-v[0])*d/lb,v[1]+(b[1]-v[1])*d/lb],arc=Array.from({length:5},(_,j)=>{const t=j/4,u=1-t;return[u*u*p[0]+2*u*t*v[0]+t*t*q[0],u*u*p[1]+2*u*t*v[1]+t*t*q[1]];});
  const safe=arc.every(point=>support.contains(point)&&(insideRings(point,rings)||rings.some(r=>r.slice(1).some((b,j)=>segmentMeters(point,r[j],b)<1e-6))));out.push(...(safe?arc:[v]));}if(out.length)out.push(out[0]);return out;});
}
export function fairGapDistances(values,width,height,{step=25,sigmaMeters=60,maxInwardMeters=50}={}){
 const radius=Math.ceil(sigmaMeters/step*3),weights=Array.from({length:radius*2+1},(_,i)=>Math.exp(-.5*((i-radius)*step/sigmaMeters)**2)),sum=weights.reduce((a,b)=>a+b,0);for(let i=0;i<weights.length;i++)weights[i]/=sum;
 const horizontal=new Float32Array(values.length),out=new Float32Array(values.length);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){let v=0;for(let k=-radius;k<=radius;k++)v+=values[y*width+Math.max(0,Math.min(width-1,x+k))]*weights[k+radius];horizontal[y*width+x]=v;}
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){let v=0;for(let k=-radius;k<=radius;k++)v+=horizontal[Math.max(0,Math.min(height-1,y+k))*width+x]*weights[k+radius];const i=y*width+x;out[i]=Math.max(values[i]-maxInwardMeters,Math.min(values[i],v));}
 return out;
}
export function componentContours(indices,width,layout,{sites=null,fairingMaxInwardMeters=50}={}){
 const support=cellUnionGeometry(indices,width,layout),points=support.edges.flat(),xs=points.map(p=>p[0]),ys=points.map(p=>p[1]),step=25,erosion=20,pad=200,x0=Math.min(...xs)-pad,y0=Math.min(...ys)-pad,w=Math.ceil((Math.max(...xs)-x0+pad)/step)+1,h=Math.ceil((Math.max(...ys)-y0+pad)/step)+1;
 if(w*h>120000)return{rings:[],reason:'contour_extent_limit'};
 const values=new Float32Array(w*h);for(let y=0;y<h;y++)for(let x=0;x<w;x++){const p=[x0+x*step,y0+y*step],raw=(support.contains(p)?1:-1)*support.distance(p)-erosion;values[y*w+x]=sites?.length?Math.min(raw,...sites.map(q=>Math.hypot(p[0]-q[0],p[1]-q[1])-GAP_RADIUS_METERS-erosion)):raw;}
 // Signed distance is1-Lipschitz:25m contour sampling has interpolation error
 // at most17.68m. A20m inward level keeps this representation inside its
 // confirmed cell union, including concavities, holes and thin corridors.
 // Bounded Gaussian fairing removes the200m staircase. The min with the
 // unblurred field forbids outward growth; the50m inward cap preserves every
 // cell center and the medial line of one-cell-wide four-neighbor corridors.
 const fair=fairGapDistances(values,w,h,{maxInwardMeters:fairingMaxInwardMeters}),raw=marchingSquares(fair,w,h,{step,x0,y0}).filter(r=>r.length>=4&&Math.hypot(r[0][0]-r.at(-1)[0],r[0][1]-r.at(-1)[1])<1e-5),rings=smoothGapRings(raw,support);
 const safe=rings.every(r=>r.every((p,i)=>{const b=r[(i+1)%r.length],n=Math.max(1,Math.ceil(Math.hypot(p[0]-b[0],p[1]-b[1])/5));return Array.from({length:n+1},(_,j)=>[p[0]+(b[0]-p[0])*j/n,p[1]+(b[1]-p[1])*j/n]).every(support.contains);}));
 return{rings:safe?rings:[],rawRings:raw,reason:safe?null:'contour_outside_confirmed_cells',contourStepMeters:step,inwardMeters:erosion,fairingSigmaMeters:60,fairingMaxInwardMeters:50,smoothingTrimMeters:10};
}
export function buildServiceGapGrid(job,rows,tree,categoryId,{subtypeId=null,scope='category'}={}){
 const start=performance.now(),origin=job?.analysis?.origin,group=tree?.categories?.find(g=>g.id===categoryId),subtype=group?.subtypes.find(s=>s.id===subtypeId),definition=subtypeId?(subtype?{...group,label:subtype.label,subtypes:[subtype]}:null):group,polygons=walkingRangePolygons(job),base={version:GAP_GRID_VERSION,categoryId,subtypeId,status:'unavailable',cellMeters:GAP_CELL_METERS,radiusMeters:GAP_RADIUS_METERS,polygons,components:[],newApiRequests:0,affectsScore:false,basis:'confirmed_poi_straight_distance_screening',walkingScope:'existing_origin_routes_only'};
 if(!definition||!valid(origin?.location)||!polygons.length)return{...base,reasonCodes:['analysis_or_category_unavailable']};
 if(subtypeId||scope!=='category')return{...base,reasonCodes:['subtype_blindspot_disabled']};
 const projected=job.serviceGapEvidence,parentContext=projected?.version==='service-gap-evidence-v1'&&projected.analysisId===job.analysisId&&(projected.origin?.uid??null)===(origin.uid??null)&&Math.abs(projected.origin?.location?.lng-origin.location.lng)<1e-6&&Math.abs(projected.origin?.location?.lat-origin.location.lat)<1e-6&&projected.sourceEvidenceFingerprint===job.score?.evidenceFingerprint?projected.groups?.find(g=>g.categoryId===categoryId):null;
 const scopedRows=rows;
 // A major-category gap concerns the origin's15-minute service set. Keep
 // exterior POIs in the audit, but a measured>1200m facility cannot cancel
 // this gap merely because its straight-line1000m disk overlaps the map.
 // Unmeasured support stays uncertain; it is never treated as absent.
 const majorContext=!subtypeId&&parentContext?{...parentContext,confirmed:parentContext.confirmed.filter(p=>p.walkingReachability!=='outside_15min'),potential:parentContext.potential.filter(p=>p.walkingReachability!=='outside_15min'),excludedOutsideWalkingScope:[...parentContext.confirmed,...parentContext.potential].filter(p=>p.walkingReachability==='outside_15min')}:parentContext;
 const context=majorContext;
 const projection=localServiceProjection(origin.location),subtypes=new Set(definition.subtypes.map(s=>s.id)),evidence=job.analysis.categories?.find(g=>g.categoryId===categoryId),reasons=[];
 for(const id of subtypes){const s=evidence?.subtypeResults?.find(s=>s.subtypeId===id);if(!s||!s.searchComplete||s.searchTruncated||s.searchStatus==='failed'||s.searchErrors?.length)reasons.push('search_incomplete');if(s?.invalidCandidateCount||s?.pendingClassificationCount&&!context?.pendingEvidenceComplete)reasons.push('classification_incomplete');}
 const seen=new Set(),candidates=(scopedRows??[]).filter(p=>{const id=p.uid?'uid:'+p.uid:p.identityKey;if(!id||seen.has(id)||!valid(p.location)||!(p.subtypeIds?.some(id=>subtypes.has(id))||!subtypeId&&categoryId==='eldercare'&&hasCategoryOnlyMembership(p)))return false;seen.add(id);return true;});
 if(context?context.confirmed.some(p=>!p.walkingVerified):candidates.some(p=>!boundWalkingEvidence(p,origin)))reasons.push('walking_evidence_incomplete');
 const searchCenter=job.analysis.searchWindow?.center??job.analysis.analysisLocation?.location??origin.location,searchRadius=job.analysis.searchRadiusMeters;if(!valid(searchCenter)||!Number.isFinite(searchRadius)||searchRadius<=0)reasons.push('search_window_unknown');
 const result={...base,label:definition.label,color:definition.color,labelText:definition.label+'服务薄弱区',candidateCount:context?.confirmed.length??candidates.length,potentialCount:context?.potential.length??0,ignoredUnrelatedPendingCount:context?.ignoredUnrelatedPendingCount??0,projection,reasonCodes:[...new Set(reasons)],confidence:'confirmed',...(context?{serviceSetScope:'origin_walking_15min',sourceCandidateCount:parentContext.confirmed.length,excludedOutsideWalkingScope:context.excludedOutsideWalkingScope}:{})};
 // Product rule: this diagnostic concerns missing major categories. A category
 // already present in the15-minute evaluated facility set has no missing layer.
 const categoryPresent=reachableFacilityRows([...(job.display?.facilities??[]),...(scopedRows??[])],origin).some(p=>(p.subtypeIds?.some(id=>subtypes.has(id))||!subtypeId&&categoryId==='eldercare'&&hasCategoryOnlyMembership(p))&&(scope!=='specialty'||p.routeEvidence.distanceMeters<=1000));
 if(categoryPresent)return{...result,status:'empty',categoryPresent:true,assessmentScope:'full',reasonCodes:[],summary:{eligibleCells:0,missingCells:0,screeningCells:0,components:0},computeMs:performance.now()-start};
 if(reasons.length)return{...result,status:'insufficient',computeMs:performance.now()-start};
 const rings=polygons.flatMap(p=>p.map(r=>r.map(([lng,lat])=>projection.project({lng,lat})))),points=rings.flat(),xs=points.map(p=>p[0]),ys=points.map(p=>p[1]),cellMeters=GAP_CELL_METERS,x0=Math.floor(Math.min(...xs)/cellMeters)*cellMeters,y0=Math.floor(Math.min(...ys)/cellMeters)*cellMeters,width=Math.ceil((Math.max(...xs)-x0)/cellMeters),height=Math.ceil((Math.max(...ys)-y0)/cellMeters),mask=new Uint8Array(width*height);
 if(width*height>10000)return{...result,status:'unavailable',reasonCodes:['grid_extent_limit']};
 const halfDiagonal=cellMeters/Math.sqrt(2),searchXY=projection.project(searchCenter),sites=(context?[...context.confirmed,...context.potential]:candidates).map(p=>projection.project(p.location)),screening=new Uint8Array(mask.length),assessedMask=new Uint8Array(mask.length);let eligibleCells=0,missingCells=0,screeningCells=0;
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){const p=[x0+(x+.5)*cellMeters,y0+(y+.5)*cellMeters],loc=projection.unproject(p);if(!insideWalkingRange(loc,polygons))continue;const boundary=rings.reduce((n,r)=>Math.min(n,...r.slice(1).map((q,i)=>segmentMeters(p,r[i],q))),Infinity);if(boundary<halfDiagonal)continue;const d=sites.reduce((n,q)=>Math.min(n,Math.hypot(p[0]-q[0],p[1]-q[1])),Infinity),support=searchRadius-Math.hypot(p[0]-searchXY[0],p[1]-searchXY[1]),i=y*width+x;if(support>=halfDiagonal)assessedMask[i]=1;if(context&&d>GAP_RADIUS_METERS&&support>=halfDiagonal){screening[i]=1;screeningCells++;}if(support<GAP_RADIUS_METERS+halfDiagonal)continue;eligibleCells++;if(d>GAP_RADIUS_METERS+halfDiagonal){mask[i]=1;missingCells++;}}
 const confidence=missingCells?'confirmed':screeningCells?'screening':'confirmed',chosen=confidence==='screening'?screening:mask,layout={x0,y0,cellMeters},components=fourNeighborComponents(chosen,width,height).map((indices,i)=>{const c=componentContours(indices,width,layout,confidence==='screening'?{sites,fairingMaxInwardMeters:10}:{});return{id:categoryId+':'+i,cellCount:indices.length,cellIds:indices,rings:c.rings,rawRings:c.rawRings,contourReason:c.reason};}).filter(c=>c.rings.length);
 return{...result,confidence,labelText:definition.label+'服务盲区',status:components.length?'available':'empty',x0,y0,width,height,mask:chosen,assessedMask,assessmentScope:'grid',components,summary:{eligibleCells,missingCells,screeningCells,components:components.length},contourStepMeters:25,inwardMeters:20,fairingSigmaMeters:60,fairingMaxInwardMeters:confidence==='screening'?10:50,smoothingTrimMeters:10,computeMs:performance.now()-start};
}
