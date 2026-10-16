// Authoritative contribution arithmetic, shared by the server and presentation adapters.
export function accessContributions(rows,{p123=true}={}){
 const total=rows.reduce((n,r)=>n+r.priority,0);
 if(rows.length!==6||!total||rows.some(r=>!Number.isInteger(r.priority)||r.priority<(p123?1:0)||r.priority>(p123?3:6)||!Number.isInteger(r.totalSubtypeCount)||r.totalSubtypeCount<1||!Number.isInteger(r.reachableSubtypeCount)||!Number.isInteger(r.unknownSubtypeCount)||r.reachableSubtypeCount<0||r.unknownSubtypeCount<0||r.reachableSubtypeCount+r.unknownSubtypeCount>r.totalSubtypeCount))throw TypeError('Invalid access counts or priority');
 const values=rows.map(r=>{const normalizedWeight=r.priority/total,G_low=100*r.reachableSubtypeCount/r.totalSubtypeCount,G_high=100*(r.reachableSubtypeCount+r.unknownSubtypeCount)/r.totalSubtypeCount;
  return{...r,priorityLabel:p123?'P'+(4-r.priority):'权重'+r.priority,normalizedWeight,G_low,G_high,contributionLow:G_low*normalizedWeight,contributionHigh:G_high*normalizedWeight};});
 // Display rounding is apportioned only; calculation and equal-priority weights stay exact.
 const units=values.map(r=>r.normalizedWeight*10000),floor=units.map(Math.floor),order=units.map((n,i)=>({i,remainder:n-floor[i]})).sort((a,b)=>b.remainder-a.remainder||a.i-b.i);
 for(let n=0,left=10000-floor.reduce((a,b)=>a+b,0);n<left;n++)floor[order[n%order.length].i]++;
 values.forEach((r,i)=>r.displayWeightPercent=floor[i]/100);
 const S_low=values.reduce((n,r)=>n+r.contributionLow,0),S_high=values.reduce((n,r)=>n+r.contributionHigh,0);
 return{categories:values,S_low,S_high,score5Low:S_low/20,score5High:S_high/20,totalPriority:total,normalizedWeights:Object.fromEntries(values.map(r=>[r.categoryId,r.normalizedWeight]))};
}
