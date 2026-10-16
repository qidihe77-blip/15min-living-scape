const EARTH=6371008.8,DEG=Math.PI/180;
export function localServiceProjection(origin){
 const sx=EARTH*DEG*Math.cos(origin.lat*DEG),sy=EARTH*DEG;
 return{project:p=>[(p.lng-origin.lng)*sx,(p.lat-origin.lat)*sy],unproject:p=>({lng:origin.lng+p[0]/sx,lat:origin.lat+p[1]/sy})};
}
// Marching Squares with linear edge crossings and an asymptotic saddle
// decider. No spline, invented samples, or displacement of the distance level.
export function marchingSquares(values,width,height,{step=1,x0=0,y0=0}={}){
 const segments=[],key=p=>p.map(v=>Math.round(v*1e7)).join(',');
 const standard={1:[[3,0]],2:[[0,1]],3:[[3,1]],4:[[1,2]],6:[[0,2]],7:[[3,2]],8:[[2,3]],9:[[0,2]],11:[[1,2]],12:[[1,3]],13:[[0,1]],14:[[3,0]]};
 for(let y=0;y<height-1;y++)for(let x=0;x<width-1;x++){
  const v=[values[y*width+x],values[y*width+x+1],values[(y+1)*width+x+1],values[(y+1)*width+x]];if(!v.every(Number.isFinite))continue;
  const mask=v.reduce((n,q,i)=>n|(q>0?1<<i:0),0);if(!mask||mask===15)continue;
  const p=[[x,y],[x+1,y],[x+1,y+1],[x,y+1]],edge=i=>{const j=(i+1)%4,t=v[i]/(v[i]-v[j]);return[x0+(p[i][0]+(p[j][0]-p[i][0])*t)*step,y0+(p[i][1]+(p[j][1]-p[i][1])*t)*step];};
  let pairs=standard[mask];if(mask===5||mask===10){const q=v[0]*v[2]-v[1]*v[3];pairs=q>0?[[0,1],[2,3]]:q<0?[[3,0],[1,2]]:mask===5?[[3,0],[1,2]]:[[0,1],[2,3]];}
  for(const[a,b]of pairs){const s=[edge(a),edge(b)];if(key(s[0])!==key(s[1]))segments.push(s);}
 }
 const graph=new Map();segments.forEach((s,i)=>s.forEach(p=>{const k=key(p);if(!graph.has(k))graph.set(k,[]);graph.get(k).push(i);}));const used=new Set(),lines=[];
 const trace=(i,start)=>{const line=[start];let at=start;while(i!==undefined&&!used.has(i)){used.add(i);const s=segments[i];at=key(s[0])===key(at)?s[1]:s[0];line.push(at);i=graph.get(key(at))?.find(j=>!used.has(j));}return line;};
 for(let i=0;i<segments.length;i++){if(used.has(i))continue;const s=segments[i],open=s.find(p=>graph.get(key(p)).length===1);if(open)lines.push(trace(i,open));}
 for(let i=0;i<segments.length;i++)if(!used.has(i))lines.push(trace(i,segments[i][0]));return lines;
}
