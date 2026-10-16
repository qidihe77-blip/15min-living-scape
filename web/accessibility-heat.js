import {walkingRangePolygons,insideWalkingRange} from './circle-presentation.js';

// Read stored regional scores. No density kernel, new routes, scoring or provider calls.
const cross=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
function triangles(ring){
 const p=ring.slice(0,-1).map(x=>[...x]);let area=0;
 for(let i=0;i<p.length;i++){const q=p[(i+1)%p.length];area+=p[i][0]*q[1]-q[0]*p[i][1];}
 if(area<0)p.reverse();const output=[];
 while(p.length>3){let ear=false;
  for(let i=0;i<p.length;i++){const a=p[(i+p.length-1)%p.length],b=p[i],c=p[(i+1)%p.length];if(cross(a,b,c)<=1e-14)continue;
   if(p.some(q=>q!==a&&q!==b&&q!==c&&cross(a,b,q)>=-1e-14&&cross(b,c,q)>=-1e-14&&cross(c,a,q)>=-1e-14))continue;
   output.push([a,b,c]);p.splice(i,1);ear=true;break;
  }
  if(!ear)return[];
 }
 if(p.length===3)output.push(p);return output;
}
function clipRect(p,[left,bottom,right,top]){
 for(const [axis,value,sign]of[[0,left,1],[0,right,-1],[1,bottom,1],[1,top,-1]]){
  const next=[];for(let i=0;i<p.length;i++){const a=p[i],b=p[(i+1)%p.length],inA=sign*(a[axis]-value)>=-1e-12,inB=sign*(b[axis]-value)>=-1e-12;
   if(inA)next.push(a);if(inA!==inB){const t=(value-a[axis])/(b[axis]-a[axis]);next.push([a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t]);}}
  p=next;if(p.length<3)return[];
 }
 const area=p.reduce((n,a,i)=>{const b=p[(i+1)%p.length];return n+a[0]*b[1]-b[0]*a[1];},0);return Math.abs(area)>1e-12?[...p,p[0]]:[];
}
export function heatColor(score){
 const stops=[[166,219,255],[102,202,232],[66,201,163]],t=Math.max(0,Math.min(1,score/100))*2,i=Math.min(1,Math.floor(t)),f=t-i;
 return '#'+stops[i].map((v,k)=>Math.round(v+(stops[i+1][k]-v)*f).toString(16).padStart(2,'0')).join('');
}
export function accessibilityHeatModel(job,category='all'){
 const polygons=walkingRangePolygons(job),regional=job?.regionalGaps,empty={status:'unavailable',category,polygons:[],cellCount:0,source:'regional_grid_score',estimated:true};
 if(!polygons.length)return{...empty,reasonCode:'walking_range_unavailable'};
 if(!regional?.cells?.length)return{...empty,reasonCode:'coverage_grid_unavailable'};
 const expected=job.analysis?.origin,actual=regional.origin;
 if(!actual||!expected||![actual.location?.lng,actual.location?.lat,expected.location?.lng,expected.location?.lat].every(Number.isFinite)||Math.abs(actual.location.lng-expected.location.lng)>1e-6||Math.abs(actual.location.lat-expected.location.lat)>1e-6||(actual.uid??null)!==(expected.uid??null))return{...empty,reasonCode:'coverage_origin_mismatch'};
 // Regional v1 was generated against one simple sampled ring. Never guess a grid for other geometry.
 if(polygons.length!==1||polygons[0].length!==1)return{...empty,reasonCode:'coverage_geometry_unsupported'};
 const ring=polygons[0][0],parts=triangles(ring),n=regional.gridSize;
 if(!parts.length||!Number.isInteger(n)||n<3||n>9)return{...empty,reasonCode:'coverage_geometry_invalid'};
 const xs=ring.map(p=>p[0]),ys=ring.map(p=>p[1]),left=Math.min(...xs),bottom=Math.min(...ys),dx=(Math.max(...xs)-left)/n,dy=(Math.max(...ys)-bottom)/n,result=[];let cellCount=0;
 for(const cell of regional.cells){
  if(cell.outsideVerified||cell.insideCircle===false||!insideWalkingRange(cell.center,polygons)||!Number.isInteger(cell.x)||!Number.isInteger(cell.y)||cell.x<0||cell.y<0||cell.x>=n||cell.y>=n)continue;
  const cov=cell.coverageByCategory?.[category],score=category==='all'?cell.score:typeof cov?.low==='number'?cov.low*100:null;
  if(!Number.isFinite(score)||score<0||score>100)continue;
  const bounds=[left+cell.x*dx,bottom+cell.y*dy,left+(cell.x+1)*dx,bottom+(cell.y+1)*dy];
  const paths=parts.map(p=>clipRect(p,bounds)).filter(p=>p.length);if(!paths.length)continue;
  cellCount++;for(const path of paths)result.push({path,cellId:cell.id,score,color:heatColor(score),opacity:.24+score/100*.13});
 }
 return{...empty,status:result.length?'available':'unavailable',reasonCode:result.length?null:'category_coverage_unavailable',polygons:result,cellCount,partial:regional.status==='partial',note:'基于已有网格覆盖评分；格到设施耗时为距离模型估算，未完成检索的类别保留不确定性。'};
}
export function createAccessibilityHeatLayer(B,map,model){
 const overlays=[];
 for(const cell of model.polygons){const shape=new B.Polygon(cell.path.map(p=>new B.Point(...p)),{fillColor:cell.color,fillOpacity:cell.opacity,strokeOpacity:0,strokeWeight:1,enableMassClear:false,enableClicking:false});
  shape.lifeCircleLayer='accessibility-heat';shape.lifeCircleHeat={cellId:cell.cellId,score:cell.score,category:model.category};map.addOverlay(shape);overlays.push(shape);
 }
 return{count:overlays.length,dispose(){for(const shape of overlays)map.removeOverlay(shape);},setTheme(){}};
}
