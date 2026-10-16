import{routePaintPlan}from'./route-paint.js?v=a74';
import{routeLines}from'./walking-network.js';
import{projectedLine}from'./route-flow.js';
import{createRouteClickGate,routeClickCandidates}from'./route-click.js';

export const FLOW_LIMIT=64,PULSE_MS=2200,PULSE_RADIUS=78;
const location=p=>p?.location??p,valid=p=>p&&Number.isFinite(p.lng)&&Number.isFinite(p.lat);
const squared=(p,q)=>{const c=Math.cos(q.lat*Math.PI/180);return((p[0]-q.lng)*c)**2+(p[1]-q.lat)**2;};
// Reverse only a render copy. Disconnected pieces remain disconnected; no new coordinates are added.
export function outwardRouteLines(lines,origin,destination){
 const copy=lines.map(l=>l.slice()),p=location(origin),q=location(destination);if(!copy.length||!valid(p))return copy;
 const first=copy[0][0],last=copy.at(-1).at(-1),forward=squared(first,p)+(valid(q)?squared(last,q):0),backward=squared(last,p)+(valid(q)?squared(first,q):0);
 return backward<forward?copy.reverse().map(l=>l.reverse()):copy;
}
export function pointAtDistance(line,distance){
 if(!line?.total)return null;const d=Math.max(0,Math.min(line.total,distance));let low=1,high=line.lengths.length-1;
 while(low<high){const mid=(low+high)>>1;line.lengths[mid]<d?low=mid+1:high=mid;}
 const a=line.pixels[low-1],b=line.pixels[low],span=line.lengths[low]-line.lengths[low-1],t=span?(d-line.lengths[low-1])/span:0;
 return{x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t,index:low};
}
export function trailOnPiece(line,distance,length){
 const head=pointAtDistance(line,distance),tail=pointAtDistance(line,Math.max(0,distance-length));if(!head||!tail)return[];
 const points=[tail];for(let i=tail.index;i<head.index;i++)points.push(line.pixels[i]);points.push(head);return points;
}
export function sampleRoutePieces(pieces,distance){
 let d=Math.max(0,distance);for(let i=0;i<pieces.length;i++){const p=pieces[i];if(d<=p.total||i===pieces.length-1)return{piece:p,distance:Math.min(d,p.total),index:i,point:pointAtDistance(p,d)};d-=p.total;}return null;
}
const hash=s=>{let n=0;for(const c of String(s))n=(Math.imul(n,31)+c.charCodeAt(0))>>>0;return n/4294967296;};
const segmentKey=(a,b)=>{const p=a.map(v=>Math.round(v*1e6)).join(','),q=b.map(v=>Math.round(v*1e6)).join(',');return p<q?p+'|'+q:q+'|'+p;};
// Identify shared original segments without moving or joining any route vertices.
export function sharedRouteSegments(routes){
 const shared=new Map();for(const r of routes)for(const line of r.lines)for(let i=1;i<line.length;i++){
  const k=segmentKey(line[i-1],line[i]);if(!shared.has(k))shared.set(k,new Set());shared.get(k).add(r.categoryId);
 }return new Map([...shared].filter(([,ids])=>ids.size>1).map(([k,ids])=>[k,[...ids].sort()]));
}
export function sharedCategoryAt(categories,elapsed,focused=[]){
 const priority=categories.filter(id=>focused.includes(id)),ids=priority.length?priority:categories;
 return ids[Math.floor(Math.max(0,elapsed)/660)%ids.length];
}
function colorRgb(color){const m=/^#([\da-f]{6})$/i.exec(color);if(!m)return[33,152,207];const n=parseInt(m[1],16);return[n>>16,(n>>8)&255,n&255];}
const tint=(color,amount)=>'rgb('+colorRgb(color).map(v=>Math.round(v+(255-v)*amount)).join(',')+')';
const rgba=(color,alpha)=>'rgba('+colorRgb(color).join(',')+','+alpha+')';

export function createRouteFlowRenderer({map,B,canvas,getPulseOrigin=()=>null,getMaskPoints=()=>[],onClick=()=>{},onState=()=>{}}){
 const clickGate=createRouteClickGate({onClick});
 const ctx=canvas.getContext('2d'),motion=matchMedia('(prefers-reduced-motion:reduce)'),host=canvas.parentElement.querySelector('#map')??canvas.parentElement;
 const pointerStart=()=>clickGate.beginGesture();host.addEventListener('pointerdown',pointerStart,true);
 function pointerClick(event){if(event.target.closest?.('.poi-info,.BMap_bubble_pop'))return;if(dirty)rebuild();const b=host.getBoundingClientRect(),x=(event.clientX-b.left)*host.clientWidth/b.width,y=(event.clientY-b.top)*host.clientHeight/b.height;
  if(maskPoints.some(p=>Math.hypot(x-p.x,y-p.y)<=p.radius+3)||originPixel&&Math.hypot(x-originPixel.x,y-originPixel.y)<26)return;
  const hit=routeClickCandidates(groups,x,y);for(const r of hit)clickGate.hit(r,event);
 }
 host.addEventListener('click',pointerClick,true);
 let routes=[],overlays=[],groups=[],maskPoints=[],shared=new Map(),particleSamples=[],key='',frame=0,paused=false,enabled=true,dirty=true,disposed=false,frames=0,last=0,lastReport=0,revision=0,originPixel=null,particleCount=0,drawMs=0,paintPlan={totalSegments:0,paintedSegments:0,suppressedSegments:0};
 const begun=performance.now(),stop=()=>{cancelAnimationFrame(frame);frame=0;},pulsePoint=()=>location(getPulseOrigin());
 function size(){const w=host.clientWidth,h=host.clientHeight,dpr=Math.min(2,devicePixelRatio||1);if(canvas.width!==Math.round(w*dpr)||canvas.height!==Math.round(h*dpr)){canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);dirty=true;}ctx.setTransform(dpr,0,0,dpr,0,0);return{w,h,dpr};}
 function wipe(){const{w,h}=size();ctx.clearRect(0,0,w,h);particleCount=0;}
 function report(force=false){const now=performance.now();if(!force&&now-lastReport<250)return;lastReport=now;onState({routes:routes.length,lines:groups.reduce((s,g)=>s+g.pieces.length,0),vertices:routes.reduce((s,r)=>s+r.lines.reduce((n,l)=>n+l.length,0),0),frames,particleLimit:FLOW_LIMIT,particleCount,pulseIntervalMs:PULSE_MS,pulseRadius:PULSE_RADIUS,pulseRings:2,pulseShown:Boolean(originPixel),sharedSegments:shared.size,projectionRevision:revision,drawMs:Number(drawMs.toFixed(2)),animating:Boolean(frame),paused,reducedMotion:motion.matches,theme:'light'});}
 function rebuild(){
  shared=sharedRouteSegments(routes);
  groups=routes.map(r=>{const lines=outwardRouteLines(r.lines,r.origin,r.destination??r.location),pieces=lines.map(l=>{const p=projectedLine(l,q=>map.pointToPixel(new B.Point(q[0],q[1])));if(p)p.shared=l.map((q,i)=>i?shared.get(segmentKey(l[i-1],q))??null:null);return p;}).filter(p=>p?.total>0);return{...r,pieces,total:pieces.reduce((s,p)=>s+p.total,0),phase:hash(r.identityKey)};}).filter(r=>r.total>0);
  const p=pulsePoint();originPixel=valid(p)?map.pointToPixel(new B.Point(p.lng,p.lat)):null;
  maskPoints=getMaskPoints().filter(valid).map(p=>({...map.pointToPixel(new B.Point(p.lng,p.lat)),radius:p.radius??16}));dirty=false;revision++;
 }
 function protectOverlays(){
  ctx.save();ctx.globalAlpha=1;ctx.shadowBlur=0;ctx.globalCompositeOperation='destination-out';ctx.fillStyle='#000';
  for(const p of maskPoints){ctx.beginPath();ctx.arc(p.x,p.y,p.radius,0,Math.PI*2);ctx.fill();}
  // Match the existing 42×52.5 pin and its (21,47.25) anchor.
  if(originPixel)ctx.clearRect(originPixel.x-21,originPixel.y-47.25,42,52.5);
  const popup=host.querySelector('.BMap_bubble_pop:has(.poi-info)');if(popup&&getComputedStyle(popup).display!=='none'){const p=popup.getBoundingClientRect(),c=canvas.getBoundingClientRect();ctx.clearRect(p.x-c.x-8,p.y-c.y-8,p.width+16,p.height+16);}
  ctx.restore();
 }
 function pulse(time){if(!originPixel)return;const elapsed=Math.max(0,time-begun),p=originPixel;ctx.save();
  const glow=ctx.createRadialGradient(p.x,p.y,9,p.x,p.y,35);glow.addColorStop(0,'#27CFF044');glow.addColorStop(.48,'#27CFF026');glow.addColorStop(1,'#27CFF000');ctx.fillStyle=glow;ctx.beginPath();ctx.arc(p.x,p.y,35,0,Math.PI*2);ctx.fill();
  ctx.strokeStyle='#25CDE9';ctx.lineWidth=2.3;ctx.shadowColor='#34D6F0';ctx.shadowBlur=6;
  for(let ring=0;ring<2;ring++){const phase=((elapsed/PULSE_MS+ring*.5)%1);ctx.globalAlpha=.43*(1-phase)**1.35;ctx.beginPath();ctx.arc(p.x,p.y,16+(PULSE_RADIUS-16)*phase,0,Math.PI*2);ctx.stroke();}ctx.restore();
 }
 function particles(time,w,h){
  particleCount=0;particleSamples=[];if(!groups.length)return;
  const emphasized=groups.some(g=>g.focused||g.highlighted),focused=[...new Set(groups.filter(g=>g.focused).map(g=>g.categoryId))],queue=groups.flatMap((g,i)=>g.focused?[i,i]:[i]),count=Math.min(FLOW_LIMIT,groups.length*3),elapsed=Math.max(0,time-begun),offset=Math.floor(elapsed/6600)*Math.max(1,count%queue.length),seconds=elapsed/1000,lanes=new Map();
  for(let slot=0;slot<count;slot++){
   const route=groups[queue[(offset+slot)%queue.length]];if(!route||route.overThreshold)continue;const lane=lanes.get(route.identityKey)??0;lanes.set(route.identityKey,lane+1);
   const bright=route.focused||route.highlighted,phase=(seconds/6.6+route.phase+lane/3)%1,sample=sampleRoutePieces(route.pieces,phase*route.total);
   if(!sample?.point||sample.distance<8||(sample.index===route.pieces.length-1&&sample.piece.total-sample.distance<8))continue;
   const common=sample.piece.shared[sample.point.index];if(common&&sharedCategoryAt(common,elapsed,focused)!==route.categoryId)continue;
   const p=sample.point;if(p.x< -30||p.x>w+30||p.y< -30||p.y>h+30)continue;
   const trailLength=bright?16:12,trail=trailOnPiece(sample.piece,sample.distance,trailLength),tail=trail[0],alpha=bright?1:emphasized?.27:.88;
   ctx.save();ctx.globalAlpha=alpha;ctx.lineWidth=bright?2:1.5;ctx.lineCap='round';ctx.lineJoin='round';ctx.shadowColor=route.color;ctx.shadowBlur=bright?6:4;
   const gradient=ctx.createLinearGradient(tail.x,tail.y,p.x,p.y);gradient.addColorStop(0,rgba(route.color,0));gradient.addColorStop(1,rgba(route.color,.94));ctx.strokeStyle=gradient;ctx.beginPath();ctx.moveTo(tail.x,tail.y);for(const q of trail.slice(1))ctx.lineTo(q.x,q.y);ctx.stroke();
   ctx.fillStyle=tint(route.color,.18);ctx.beginPath();ctx.arc(p.x,p.y,bright?2:1.7,0,Math.PI*2);ctx.fill();ctx.shadowBlur=0;ctx.fillStyle=tint(route.color,.82);ctx.beginPath();ctx.arc(p.x,p.y,bright?.85:.65,0,Math.PI*2);ctx.fill();ctx.restore();particleCount++;
   particleSamples.push({id:route.identityKey,categoryId:route.categoryId,color:route.color,alpha,diameter:bright?4:3.4,trailLength,x:p.x,y:p.y,shared:Boolean(common)});
  }
 }
 function tick(){const time=performance.now();frame=0;if(disposed||document.hidden||paused||!enabled||motion.matches||(!routes.length&&!valid(pulsePoint()))){report(true);return;}
  if(time-last>=33){last=time;const start=performance.now(),{w,h}=size();if(dirty)rebuild();ctx.clearRect(0,0,w,h);pulse(time);particles(time,w,h);protectOverlays();drawMs=drawMs*.8+(performance.now()-start)*.2;frames++;}
  frame=requestAnimationFrame(tick);report();
 }
 function resume(){dirty=true;if(!frame&&!disposed&&!document.hidden&&!paused&&enabled&&!motion.matches&&(routes.length||valid(pulsePoint())))frame=requestAnimationFrame(tick);report(true);}
 function clear(){clickGate.clear();stop();for(const line of overlays)map.removeOverlay(line);overlays=[];routes=[];groups=[];shared=new Map();particleSamples=[];originPixel=null;key='';wipe();report(true);}
 function set(input,nextTheme='light'){
  const next=input.filter(r=>r.drawable&&r.visible&&routeLines(r.geometry).length),nextKey=JSON.stringify([nextTheme,next.map(r=>[r.identityKey,r.categoryId,r.geometry,r.color,r.highlighted,r.focused,r.overThreshold,r.routeProfile,r.supplemental])]);if(nextKey===key){if(!frame)resume();return;}
  clear();key=nextKey;routes=next;const emphasized=routes.some(r=>r.focused||r.highlighted);
  paintPlan=routePaintPlan(routes);for(const{route:r,line,appearance}of paintPlan.pieces){const layers=appearance.layers;
   for(const[width,opacity,color,layer]of layers){const overlay=new B.Polyline(line.map(p=>new B.Point(p[0],p[1])),{strokeColor:color,strokeWeight:width,strokeOpacity:opacity,strokeLineCap:'round',strokeLineJoin:'round',enableMassClear:false});overlay.lifeCircleCategoryRoute=r.categoryId;overlay.lifeCircleFacilityRoute=r.identityKey;overlay.lifeCircleRouteLayer=layer;overlay.lifeCircleTargetOpacity=opacity;overlay.addEventListener?.('click',event=>clickGate.hit(r,event));map.addOverlay(overlay);overlays.push(overlay);}
  }resume();
 }
 const moving=()=>{paused=true;stop();wipe();report(true);},settled=()=>{paused=false;resume();},visibility=()=>{if(document.hidden||motion.matches){stop();wipe();}else resume();report(true);};
 const movingEvents=['moving','zoomstart','dragstart'],settledEvents=['moveend','zoomend','resize','heading_changed'];movingEvents.forEach(e=>map.addEventListener(e,moving));settledEvents.forEach(e=>map.addEventListener(e,settled));
 document.addEventListener('visibilitychange',visibility);motion.addEventListener('change',visibility);const observer=new ResizeObserver(()=>{dirty=true;resume();});observer.observe(host);
 return{set,clear,refreshOrigin:resume,setAnimation(value){enabled=Boolean(value);if(!enabled){stop();wipe();}resume();},
  getSnapshot:()=>({clickGate:clickGate.stats(),paintPlan:{totalSegments:paintPlan.totalSegments,paintedSegments:paintPlan.paintedSegments,suppressedSegments:paintPlan.suppressedSegments},origin:originPixel&&{x:originPixel.x,y:originPixel.y},projectionRevision:revision,particleCount,particleLimit:FLOW_LIMIT,pulseIntervalMs:PULSE_MS,pulseRadius:PULSE_RADIUS,pulseRings:2,sharedSegments:shared.size,particleSamples,frames,paused,drawMs,maskedFacilities:maskPoints.length,overlays:overlays.length,routeLayers:overlays.map(o=>({id:o.lifeCircleFacilityRoute,categoryId:o.lifeCircleCategoryRoute,layer:o.lifeCircleRouteLayer,width:o.getStrokeWeight(),color:o.getStrokeColor(),opacity:o.getStrokeOpacity()})),routes:groups.map(g=>({id:g.identityKey,categoryId:g.categoryId,color:g.color,focused:g.focused,selected:g.highlighted,total:g.total,pieces:g.pieces.map(p=>({first:p.pixels[0],last:p.pixels.at(-1),vertices:p.pixels.length,total:p.total}))}))}),
  dispose(){disposed=true;host.removeEventListener('pointerdown',pointerStart,true);host.removeEventListener('click',pointerClick,true);observer.disconnect();clear();document.removeEventListener('visibilitychange',visibility);motion.removeEventListener('change',visibility);movingEvents.forEach(e=>map.removeEventListener?.(e,moving));settledEvents.forEach(e=>map.removeEventListener?.(e,settled));}
 };
}
