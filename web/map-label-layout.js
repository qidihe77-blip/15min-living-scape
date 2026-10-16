const overlap=(a,b,gap)=>a.left<b.left+b.width+gap&&a.left+a.width>b.left-gap&&a.top<b.top+b.height+gap&&a.top+a.height>b.top-gap;
// Screen placement only: never moves the label's geographic anchor or route.
export function placeMapLabel({anchor,width,height,viewport,obstacles=[],gap=8}){
 if(!anchor||![anchor.x,anchor.y,width,height,viewport.width,viewport.height].every(Number.isFinite)||width>viewport.width-gap*2||height>viewport.height-gap*2)return null;
 if(anchor.x<0||anchor.y<0||anchor.x>viewport.width||anchor.y>viewport.height)return null;
 const bound=(x,y)=>({left:Math.max(gap,Math.min(viewport.width-width-gap,x)),top:Math.max(gap,Math.min(viewport.height-height-gap,y)),width,height});
 let candidates=[bound(anchor.x+8,anchor.y-height-8),bound(anchor.x-width-8,anchor.y-height-8),bound(anchor.x+8,anchor.y+8),bound(anchor.x-width-8,anchor.y+8)];
 for(const o of obstacles){const additions=[];for(const c of candidates)additions.push(bound(o.left+o.width+gap,c.top),bound(o.left-width-gap,c.top),bound(c.left,o.top+o.height+gap),bound(c.left,o.top-height-gap));candidates=[...new Map([...candidates,...additions].map(c=>[c.left+':'+c.top,c])).values()].slice(0,240);}
 const distance=c=>Math.hypot(c.left+width/2-anchor.x,c.top+height/2-anchor.y);
 return candidates.filter(c=>!obstacles.some(o=>overlap(c,o,gap))).sort((a,b)=>distance(a)-distance(b))[0]??null;
}
export function mapUiObstacles(container){if(!container)return[];const b=container.getBoundingClientRect(),sx=b.width?container.clientWidth/b.width:1,sy=b.height?container.clientHeight/b.height:1;return[...container.parentElement.querySelectorAll('.map-legend-panel,#map-analysis-legend,.map-toolbar,.map-controls')].filter(n=>!n.hidden&&n.getClientRects().length).map(n=>{const r=n.getBoundingClientRect();return{left:(r.left-b.left)*sx,top:(r.top-b.top)*sy,width:r.width*sx,height:r.height*sy};});}
