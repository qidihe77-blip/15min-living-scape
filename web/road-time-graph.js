import{routeLines}from'./walking-network.js';import{boundWalkingCost}from'./reachable-presentation.js';import{decisionSeconds}from'./walking-model.js';
export const roadMeters=(a,b)=>{const r=Math.PI/180,x=(b[0]-a[0])*r,y=(b[1]-a[1])*r,h=Math.sin(y/2)**2+Math.cos(a[1]*r)*Math.cos(b[1]*r)*Math.sin(x/2)**2;return 6371000*2*Math.asin(Math.min(1,Math.sqrt(h)));};
export function makeRoadTimeGraph(rows,origin){const nodes=[],keys=new Map(),anchors=[];const add=p=>{const key=p.map(n=>n.toFixed(7)).join(',');if(keys.has(key))return keys.get(key);const id=nodes.length;keys.set(key,id);nodes.push({id,p,edges:new Map()});return id;};
 const link=(a,b)=>{const d=roadMeters(nodes[a].p,nodes[b].p);if(d>0){nodes[a].edges.set(b,Math.min(d,nodes[a].edges.get(b)??Infinity));nodes[b].edges.set(a,Math.min(d,nodes[b].edges.get(a)??Infinity));}};
 for(const row of rows??[]){const cost=row.routeEvidence;if(!boundWalkingCost(row,origin))continue;const lines=routeLines(cost.geometry);if(!lines.length||roadMeters(lines[0][0],[origin.location.lng,origin.location.lat])>150)continue;let last=null;const path=[];
  for(const line of lines){let previous=null;for(let i=0;i<line.length;i++){if(i){const a=line[i-1],b=line[i],n=Math.ceil(roadMeters(a,b)/20);for(let j=1;j<n;j++){const id=add([a[0]+(b[0]-a[0])*j/n,a[1]+(b[1]-a[1])*j/n]);if(previous!==null)link(previous,id);previous=id;}}
    const id=add(line[i]);if(previous!==null)link(previous,id);previous=id;last=id;path.push(id);}}
  const dst=cost.actualNavigationEndpoint??cost.requestedDestination?.location??cost.destination?.location??row.location;if(last!==null&&dst&&roadMeters(nodes[last].p,[dst.lng,dst.lat])<=15)anchors.push({node:last,seconds:decisionSeconds(cost),evidenceId:cost.evidenceId,location:dst,source:'actual_facility_cost'});
  // Prefix times are derived on an intact provider polyline using the same 80 m/min
  // model and its measured total cost. They are not new API observations. Gapped
  // geometries or displaced starts cannot supply intermediate time anchors.
  const lengths=path.map((id,i)=>i?roadMeters(nodes[path[i-1]].p,nodes[id].p):0),total=lengths.reduce((n,d)=>n+d,0);
  if(cost.walkingModelId==='walking80-v1'&&lines.length===1&&total>0&&cost.distanceMeters/total>=.75&&cost.distanceMeters/total<=1.35&&roadMeters(lines[0][0],[origin.location.lng,origin.location.lat])<=15&&dst&&roadMeters(nodes[last].p,[dst.lng,dst.lat])<=15){let cumulative=0,previous=-80;for(let i=0;i<path.length;i++){cumulative+=lengths[i];if(cumulative-previous>=70){anchors.push({node:path[i],seconds:decisionSeconds(cost)*cumulative/total,evidenceId:cost.evidenceId,source:'verified_path_model_time',derived:true});previous=cumulative;}}}
 }
 if(origin?.location){const node=closestNode(nodes,[origin.location.lng,origin.location.lat],15);if(node!==null)anchors.push({node,seconds:0,source:'walking_origin',location:origin.location});}
 return{nodes,anchors};
}
export function closestNode(nodes,p,max=Infinity){let id=null,d=max;for(const n of nodes){const k=roadMeters(n.p,p);if(k<d){d=k;id=n.id;}}return id;}
export function boundedGraphDistances(graph,start,limit=250){const distances=new Map([[start,0]]),queue=[[0,start]];while(queue.length){queue.sort((a,b)=>b[0]-a[0]);const[d,id]=queue.pop();if(d!==distances.get(id))continue;for(const[next,length]of graph.nodes[id].edges){const nd=d+length;if(nd<=limit&&nd<(distances.get(next)??Infinity)){distances.set(next,nd);queue.push([nd,next]);}}}return distances;}
