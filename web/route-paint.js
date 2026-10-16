const segmentKey=(a,b)=>{const p=a.map(v=>Math.round(v*1e6)).join(','),q=b.map(v=>Math.round(v*1e6)).join(',');return p<q?p+'|'+q:q+'|'+p;};
export function routeAppearance(r,emphasized=false){const alpha=r.overThreshold?(r.highlighted?.65:r.focused?.5:.3):r.highlighted?.96:r.focused?.88:emphasized?.22:.74;return{alpha,layers:[[12,alpha*(r.supplemental?.27:.22),r.color,'halo'],[6.5,alpha*.92,'#FFFFFF','white_outline'],[3.6,alpha,r.color,'core']]};}
// Paint shared same-category segments once. Every point is an original Walking
// vertex; raw geometries and independently moving particles remain unchanged.
export function routePaintPlan(routes){const emphasized=routes.some(r=>r.focused||r.highlighted),winners=new Map();let total=0;
 routes.forEach((r,ri)=>r.lines.forEach((line,li)=>line.slice(1).forEach((b,j)=>{const si=j+1,a=line[j],key=r.categoryId+':'+r.color+':'+segmentKey(a,b),alpha=routeAppearance(r,emphasized).alpha,old=winners.get(key);total++;if(!old||alpha>old.alpha)winners.set(key,{ri,li,si,alpha});})));
 const pieces=[];routes.forEach((r,ri)=>r.lines.forEach((line,li)=>{let path=[];const flush=()=>{if(path.length>1)pieces.push({route:r,line:path,appearance:routeAppearance(r,emphasized)});path=[];};for(let si=1;si<line.length;si++){const winner=winners.get(r.categoryId+':'+r.color+':'+segmentKey(line[si-1],line[si]));if(winner.ri!==ri||winner.li!==li||winner.si!==si){flush();continue;}if(!path.length)path.push(line[si-1]);path.push(line[si]);}flush();}));
 return{pieces,totalSegments:total,paintedSegments:winners.size,suppressedSegments:total-winners.size};
}
