import{boundaryContainsPoint,validateBoundaryRing}from'../web/sample-boundary.js';
import{rayDestination}from'./reference-walking-range.mjs';
import{validRangeCost}from'./batch-walking-range.mjs';
import{radialCostRadius}from'../web/radial-cost-model.js';
import{boundWalkingEvidence}from'../web/reachable-presentation.js';
import{modelRoute,WALKING80_MODEL}from'../web/walking-model.js';
export const ADAPTIVE_DIRECTIONS_VERSION='poi-guided-radial-linear-v1';
export function adaptiveBoundarySetting(job,enabled=true){if(enabled||!job?.baseGeojson)return job;const diagnostic={...job.adaptiveDirections,status:'disabled_by_configuration',after:job.adaptiveDirections?.before};return{...job,geojson:structuredClone(job.baseGeojson),adaptiveBoundaryEstimates:[],adaptiveDirections:diagnostic,rangeDiagnostics:{...job.rangeDiagnostics,adaptiveDirections:diagnostic}};}
const featureOf=g=>g?.geojson?.features?.find(f=>f.properties?.featureType==='sampled_boundary'&&f.geometry?.type==='Polygon');
const bearing=(c,p)=>{const r=Math.PI/180,d=(p.lng-c.lng)*r,a=c.lat*r,b=p.lat*r;return(Math.atan2(Math.sin(d)*Math.cos(b),Math.cos(a)*Math.sin(b)-Math.sin(a)*Math.cos(b)*Math.cos(d))/r+360)%360;};
export function boundaryPoiMetrics(ring,facilities){const valid=facilities.filter(p=>p.routeEvidence?.routeStatus==='ok'&&Number.isFinite(p.routeEvidence.distanceMeters)),positive=valid.filter(p=>p.routeEvidence.distanceMeters<=1200),negative=valid.filter(p=>p.routeEvidence.distanceMeters>1200),miss=positive.filter(p=>!boundaryContainsPoint(ring,p.location)),falseIncluded=negative.filter(p=>boundaryContainsPoint(ring,p.location));
 const tp=positive.length-miss.length,fp=falseIncluded.length;return{verified:valid.length,reachable:positive.length,overThreshold:negative.length,omitted:miss.length,omissionRate:positive.length?miss.length/positive.length:null,falseIncluded:fp,falseInclusionRate:negative.length?fp/negative.length:null,accuracy:valid.length?(valid.length-miss.length-fp)/valid.length:null,precision:tp+fp?tp/(tp+fp):null,recall:positive.length?tp/positive.length:null,omittedNames:miss.map(p=>p.name),falseIncludedNames:falseIncluded.map(p=>p.name)};}
// Only measured, bound costs may steer the refinement. Validation points are
// never supplied to this planner. Base knots and all cost/score rules stay intact.
export function planAdaptiveDirections({geometry,origin,facilities,maxOD=18}){
 if(!Number.isInteger(maxOD)||maxOD<0||maxOD>36)throw new RangeError('Invalid adaptive OD budget.');
 const ring=featureOf(geometry)?.geometry.coordinates[0],estimates=geometry?.boundaryEstimates??[];
 if(!ring||estimates.length!==36||estimates.some(e=>e.estimated)||!validateBoundaryRing(ring).valid)return[];
 const valid=facilities.filter(p=>boundWalkingEvidence(p,origin)&&p.routeEvidence.distanceMeters<=1200&&!boundaryContainsPoint(ring,p.location)),groups=new Map();
 for(const p of valid){const angle=bearing(origin.location,p.location),sector=Math.floor(angle/10)%36;if(!groups.has(sector))groups.set(sector,[]);groups.get(sector).push({angle,poi:p});}
 // One insertion per original interval prevents a single cluster consuming all
 // budget. Density selects intervals; median bearing represents the cluster.
 const distance=(a,b)=>Math.hypot((a.lng-b.lng)*111195*Math.cos(origin.location.lat*Math.PI/180),(a.lat-b.lat)*111195);
 return [...groups].map(([sector,rows])=>{const cluster=rows.map(p=>rows.filter(q=>distance(p.poi.location,q.poi.location)<=180)).sort((a,b)=>b.length-a.length||a[0].angle-b[0].angle)[0],angles=cluster.map(p=>p.angle).sort((a,b)=>a-b);return{sector,count:rows.length,spatialClusterSize:cluster.length,clusterRadiusMeters:180,bearingDegrees:Math.max(sector*10+1,Math.min(sector*10+9,angles[Math.floor(angles.length/2)])),poiKeys:rows.map(p=>p.poi.identityKey)};})
  .sort((a,b)=>b.spatialClusterSize-a.spatialClusterSize||b.count-a.count||a.sector-b.sector).slice(0,Math.floor(maxOD/3));
}
export async function refineAdaptiveDirections({geometry,origin,facilities,provider,maxOD=18,signal,maxAreaGrowth=.12,maxRadialExpansion=250}){
 const start=performance.now(),original=structuredClone(geometry),feature=featureOf(geometry),ring=feature?.geometry.coordinates[0],bound=facilities.filter(p=>boundWalkingEvidence(p,origin)),before=ring?boundaryPoiMetrics(ring,bound):null,plan=planAdaptiveDirections({geometry,origin,facilities:bound,maxOD});
 const diagnostic={version:ADAPTIVE_DIRECTIONS_VERSION,maxOD,requestedOD:0,plan:structuredClone(plan),plannedDirections:plan.length,acceptedDirections:0,rejected:[],before,after:before,measurements:[],status:'unchanged',elapsedMs:0};
 const finish=g=>{diagnostic.elapsedMs=performance.now()-start;g.adaptiveDirections=diagnostic;return g;};
 if(!plan.length||!provider?.routeMany)return finish(original);
 const states=plan.map(p=>({...p,lo:0,hi:2340,probe:null})),samples=[];diagnostic.measurements=samples;diagnostic.requests={};
 try{for(let round=1;round<=3;round++){
  if(signal?.aborted)throw signal.reason;
  const destinations=states.map(s=>rayDestination(origin.location,s.bearingDegrees,(s.lo+s.hi)/2));
  diagnostic.requestedOD+=destinations.length;
  const rows=await provider.routeMany({origin,destinations,mode:'walking',signal,telemetry:diagnostic.requests});
  states.forEach((s,i)=>{const r=rows[i],radius=(s.lo+s.hi)/2;if(!validRangeCost(r,origin,destinations[i])){s.failed=true;return;}
   const sample={...modelRoute(r,WALKING80_MODEL),sector:36+i,bearingDegrees:s.bearingDegrees,radiusMeters:radius,lng:destinations[i].lng,lat:destinations[i].lat,sampleStage:'adaptive_matrix_bisection',round,coverageStatus:r.distanceMeters<=1200?'covered':'over_threshold'};samples.push(sample);s.probe={sample,radius};if(r.distanceMeters<=1200)s.lo=radius;else s.hi=radius;
  });
  if(states.every(s=>s.failed))break;
 }}catch(e){if(signal?.aborted)throw e;diagnostic.status='fallback';diagnostic.reasonCode=e.code??'adaptive_request_failed';return finish(original);}
 const base=geometry.boundaryEstimates,insertions=[];
 for(const s of states){if(s.failed||!s.probe){diagnostic.rejected.push({bearingDegrees:s.bearingDegrees,reasonCode:'incomplete_measurements'});continue;}
  const radialCostModel={version:'bounded-proportional-walking-v1',sampleRadiusMeters:s.probe.radius,sampleDistanceMeters:s.probe.sample.distanceMeters,referenceDistanceMeters:1200,lowRadiusMeters:s.lo,highRadiusMeters:Math.max(s.hi,s.probe.radius)*1.05},radius=radialCostRadius(radialCostModel,1200),p=rayDestination(origin.location,s.bearingDegrees,radius),left=base[s.sector],right=base[(s.sector+1)%36];
  if(!Number.isFinite(radius)||radius>Math.max(left.radiusMeters,right.radiusMeters)+maxRadialExpansion||radius>1260){diagnostic.rejected.push({bearingDegrees:s.bearingDegrees,reasonCode:'radial_expansion_guard'});continue;}
  insertions.push({sector:36+insertions.length,bearingDegrees:s.bearingDegrees,radiusMeters:radius,point:[p.lng,p.lat],evidenceId:s.probe.sample.evidenceId,estimated:false,costStatus:'radial_cost_extrapolation',radialCostModel});
 }
 const ordered=[...base,...insertions].sort((a,b)=>a.bearingDegrees-b.bearingDegrees),candidate=[...ordered.map(e=>e.point),ordered[0].point],validation=validateBoundaryRing(candidate),after=boundaryPoiMetrics(candidate,bound),areaBefore=validateBoundaryRing(ring).areaSquareMeters,areaGrowth=validation.areaSquareMeters/areaBefore-1;
 const newFalse=bound.some(p=>p.routeEvidence.distanceMeters>1200&&!boundaryContainsPoint(ring,p.location)&&boundaryContainsPoint(candidate,p.location)),lost=bound.some(p=>p.routeEvidence.distanceMeters<=1200&&boundaryContainsPoint(ring,p.location)&&!boundaryContainsPoint(candidate,p.location));
 const childOutside=base.some(e=>{const radius=radialCostRadius(e.radialCostModel,1000);return radius!==null&&!boundaryContainsPoint(candidate,rayDestination(origin.location,e.bearingDegrees,radius));});
 diagnostic.measurements=samples;diagnostic.areaGrowth=areaGrowth;
 if(!insertions.length||!validation.valid||!boundaryContainsPoint(candidate,origin.location)||childOutside||areaGrowth>maxAreaGrowth||areaGrowth<-.02||newFalse||lost||after.omitted>=before.omitted){diagnostic.status='fallback';diagnostic.reasonCode=!validation.valid?validation.reasonCode:newFalse?'known_over_threshold_inclusion':lost?'lost_reachable_poi':childOutside?'one_km_nesting_guard':areaGrowth>maxAreaGrowth?'area_expansion_guard':'no_safe_omission_improvement';return finish(original);}
 const result=structuredClone(geometry);featureOf(result).geometry.coordinates[0]=candidate;Object.assign(featureOf(result).properties,{sourceKnotCount:ordered.length,adaptiveDirectionsVersion:ADAPTIVE_DIRECTIONS_VERSION});
 // Keep the immutable base 36 models for the existing 1km contour. Rendering,
 // spatial statistics and gaps consume this one refined GeoJSON geometry.
 result.baseGeojson=original.geojson;result.adaptiveBoundaryEstimates=insertions;result.samples.push(...samples);result.sampleMetrics={...result.sampleMetrics,requestedDirections:36,adaptiveDirections:insertions.length,totalBoundaryDirections:36+insertions.length,adaptiveValidRoutePoints:samples.length,validRoutePoints:result.samples.filter(s=>s.coverageStatus!=='unknown').length};diagnostic.status='applied';diagnostic.acceptedDirections=insertions.length;diagnostic.after=after;return finish(result);
}
