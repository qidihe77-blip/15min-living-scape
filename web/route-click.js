// Multi-layer/overlapping BMap polylines can all emit the same pointer click.
// Resolve one route after collecting a frame of hits, before making requests.
export function routeClickCandidates(routes,x,y,tolerance=8){
 return routes.filter(r=>(r.pieces??[]).some(p=>(p.pixels??[]).some((b,i,points)=>{if(!i)return false;const a=points[i-1],dx=b.x-a.x,dy=b.y-a.y,t=Math.max(0,Math.min(1,((x-a.x)*dx+(y-a.y)*dy)/(dx*dx+dy*dy||1)));return Math.hypot(a.x+t*dx-x,a.y+t*dy-y)<=tolerance;})));
}
export function createRouteClickGate({onClick,schedule=requestAnimationFrame,cancel=cancelAnimationFrame,now=()=>performance.now()}={}){
 let frame=0,last=-Infinity,hits=new Map(),gesture=0,handledGesture=-1,dispatches=0;
 function flush(){frame=0;const routes=[...hits.values()];hits.clear();if(!routes.length)return;last=now();handledGesture=gesture;dispatches++;routes.sort((a,b)=>Number(Boolean(b.highlighted))-Number(Boolean(a.highlighted))||Number(Boolean(b.focused))-Number(Boolean(a.focused))||String(a.identityKey).localeCompare(String(b.identityKey)));onClick(routes[0]);}
 function clear(){if(frame)cancel(frame);frame=0;hits.clear();}
 return{beginGesture(){clear();gesture++;},hit(route,event){event?.domEvent?.stopPropagation?.();event?.stopPropagation?.();if(event)event.cancelBubble=true;if(gesture>0?handledGesture===gesture:now()-last<80)return;hits.set(route.identityKey,route);if(!frame)frame=schedule(flush);},clear,stats:()=>({gesture,handledGesture,dispatches})};
}
