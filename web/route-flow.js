import {routeLines} from './walking-network.js';

export function projectedLine(points,project) {
 const pixels=points.map(project);
 if(pixels.some(p=>!p||!Number.isFinite(p.x)||!Number.isFinite(p.y)))return null;
 const lengths=[0];for(let i=1;i<pixels.length;i++)lengths.push(lengths.at(-1)+Math.hypot(pixels[i].x-pixels[i-1].x,pixels[i].y-pixels[i-1].y));
 return {pixels,lengths,total:lengths.at(-1)};
}
export function pointAlongLine(line,progress) {
 if(!line?.total)return null;const d=((progress%1)+1)%1*line.total;
 let low=1,high=line.lengths.length-1;while(low<high){const middle=(low+high)>>1;line.lengths[middle]<d?low=middle+1:high=middle;}
 const i=low,a=line.pixels[i-1],b=line.pixels[i],span=line.lengths[i]-line.lengths[i-1],t=span?(d-line.lengths[i-1])/span:0;
 return {x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t};
}
// One canvas, at most 18 particles. No route requests or geometry generation.
export function createRouteFlowRenderer({map,B,canvas,onClick=()=>{},onState=()=>{}}) {
 const ctx=canvas.getContext('2d'),motion=matchMedia('(prefers-reduced-motion: reduce)');
 let fadeTimer=0;let overlays=[],routes=[],projected=[],flowGroups=[],key='',theme='light',frame=0,last=0,paused=false,enabled=true,dirty=true,disposed=false,frames=0;
 const stop=()=>{cancelAnimationFrame(frame);frame=0;};
 function report(){onState({routes:routes.length,lines:projected.length,vertices:routes.reduce((n,r)=>n+r.lines.reduce((m,l)=>m+l.length,0),0),
  frames,particleLimit:18,animating:Boolean(frame),paused,reducedMotion:motion.matches,theme});}
 function size(){const rect=document.querySelector('#map'),w=rect.clientWidth,h=rect.clientHeight,dpr=Math.min(2,devicePixelRatio||1);
  if(canvas.width!==Math.round(w*dpr)||canvas.height!==Math.round(h*dpr)){canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);dirty=true;}
  ctx.setTransform(dpr,0,0,dpr,0,0);return {w,h};}
 function rebuild(){size();flowGroups=routes.map(r=>({...r,pieces:r.lines.map(l=>projectedLine(l,p=>map.pointToPixel(new B.Point(p[0],p[1])))).filter(l=>l?.total>0)})).filter(r=>r.pieces.length);projected=flowGroups.flatMap(r=>r.pieces);dirty=false;}
 function tick(time){frame=0;if(disposed||document.hidden||paused||!enabled||!routes.length||motion.matches){report();return;}
  if(time-last>=32){last=time;if(dirty)rebuild();const {w,h}=size();ctx.clearRect(0,0,w,h);
   const count=Math.min(18,flowGroups.length*3),offset=Math.floor(time/6500)*18;
   for(let i=0;i<count;i++){const route=flowGroups[(offset+i)%flowGroups.length],phase=time/6500+Math.floor(i/flowGroups.length)/3,piece=route.pieces[Math.floor(phase)%route.pieces.length];
    const p=pointAlongLine(piece,phase);if(!p)continue;ctx.fillStyle=route.color;ctx.globalAlpha=route.highlighted?.95:.8;ctx.beginPath();ctx.arc(p.x,p.y,route.highlighted?2.3:1.8,0,Math.PI*2);ctx.fill();}
   frames++;}
  frame=requestAnimationFrame(tick);report();
 }
 function resume(){dirty=true;if(!frame&&!disposed&&!document.hidden&&!paused&&enabled&&routes.length&&!motion.matches)frame=requestAnimationFrame(tick);report();}
 function clear(){clearTimeout(fadeTimer);stop();for(const overlay of overlays)map.removeOverlay(overlay);overlays=[];routes=[];projected=[];flowGroups=[];key='';ctx.clearRect(0,0,canvas.width,canvas.height);report();}
 function set(input,nextTheme){theme=nextTheme;const next=input.filter(r=>r.drawable&&r.visible&&routeLines(r.geometry).length);
  const nextKey=JSON.stringify([theme,next.map(r=>[r.identityKey,r.categoryId,r.geometry,r.color,r.highlighted])]);if(nextKey===key)return;
  clear();key=nextKey;routes=next;canvas.style.opacity='0';requestAnimationFrame(()=>{if(!disposed)canvas.style.opacity='1';});
  for(const r of routes)for(const line of r.lines){
   const layers=r.highlighted?[[12,.15,r.color],[6,.86,r.color],[1.8,.88,'#eaffff']]:[[10,.10,r.color],[5,.72,r.color],[1.5,.82,'#effcff']];
   for(const [weight,opacity,color] of layers){
    const overlay=new B.Polyline(line.map(p=>new B.Point(p[0],p[1])),{strokeColor:color,strokeWeight:weight,strokeOpacity:opacity,enableMassClear:false});
    overlay.lifeCircleCategoryRoute=r.categoryId;overlay.lifeCircleFacilityRoute=r.identityKey;
    overlay.addEventListener?.('click',()=>onClick(r));map.addOverlay(overlay);overlays.push(overlay);overlay.lifeCircleTargetOpacity=opacity;
   }
  }
  if(!motion.matches){const begun=performance.now();for(const overlay of overlays)overlay.setStrokeOpacity?.(overlay.lifeCircleTargetOpacity*.25);
   const fade=()=>{const progress=Math.min(1,(performance.now()-begun)/240);for(const overlay of overlays)overlay.setStrokeOpacity?.(overlay.lifeCircleTargetOpacity*(.25+.75*progress));if(progress<1)fadeTimer=setTimeout(fade,40);};fadeTimer=setTimeout(fade,40);}
   resume();
 }
 const moving=()=>{paused=true;stop();ctx.clearRect(0,0,canvas.width,canvas.height);report();};
 const settled=()=>{paused=false;resume();};
 const visibility=()=>{if(document.hidden||motion.matches){stop();ctx.clearRect(0,0,canvas.width,canvas.height);}else resume();report();};
 for(const event of ['moving','zoomstart','dragstart'])map.addEventListener(event,moving);
 for(const event of ['moveend','zoomend','resize','heading_changed'])map.addEventListener(event,settled);
 document.addEventListener('visibilitychange',visibility);motion.addEventListener('change',visibility);
 return {set,clear,setAnimation(value){enabled=Boolean(value);if(!enabled){stop();ctx.clearRect(0,0,canvas.width,canvas.height);}resume();},
  dispose(){disposed=true;clear();document.removeEventListener('visibilitychange',visibility);motion.removeEventListener('change',visibility);
   for(const event of ['moving','zoomstart','dragstart'])map.removeEventListener?.(event,moving);
   for(const event of ['moveend','zoomend','resize','heading_changed'])map.removeEventListener?.(event,settled);}};
}
