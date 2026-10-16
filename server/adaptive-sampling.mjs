// Proposals only. No estimated point becomes reachability evidence without a real route request.
export const ADAPTIVE_SAMPLING_VERSION='walking80-adaptive-brackets-v2';
export function farthestDirectionOrder(count=8){
 if(!Number.isInteger(count)||count<1||count>32)throw new RangeError('Direction count must be 1–32.');
 const pool=Array.from({length:count},(_,i)=>i),selected=[pool.shift()],distance=(a,b)=>Math.min(Math.abs(a-b),count-Math.abs(a-b));
 while(pool.length){pool.sort((a,b)=>Math.min(...selected.map(s=>distance(b,s)))-Math.min(...selected.map(s=>distance(a,s)))||a-b);selected.push(pool.shift());}return selected;
}
export function robustDetour(samples){
 const ratios=samples.filter(s=>s.coverageStatus!=='unknown'&&Number.isFinite(s.distanceMeters)&&s.radiusMeters>=100)
  .map(s=>s.distanceMeters/s.radiusMeters).filter(r=>r>=1&&r<=10).sort((a,b)=>a-b);
 const n=ratios.length,median=n<2?null:n%2?ratios[(n-1)/2]:(ratios[n/2-1]+ratios[n/2])/2;
 const deviations=median===null?[]:ratios.map(r=>Math.abs(r-median)).sort((a,b)=>a-b);
 return{sampleCount:n,median,mad:n<2?null:deviations[Math.floor(n/2)],scope:'sampling_proposal_only',defaultUsed:false,hasEstimate:median!==null};
}
export function observeSector(sector,sample){
 if(sample.coverageStatus==='unknown'){sector.failed=true;return;}
 sector.observations.push(sample);const sorted=[...sector.observations].sort((a,b)=>a.radiusMeters-b.radiusMeters);
 sector.nonMonotonic=sorted.some((p,i)=>i&&((sorted[i-1].coverageStatus==='over_threshold'&&p.coverageStatus==='covered')
  ||p.distanceMeters+Math.max(20,sorted[i-1].distanceMeters*.03)<sorted[i-1].distanceMeters));
 const lower=sorted.filter(s=>s.coverageStatus==='covered').at(-1),upper=sorted.find(s=>s.coverageStatus==='over_threshold');
 sector.lower=lower?{location:{lat:lower.lat,lng:lower.lng},radiusMeters:lower.radiusMeters,distanceMeters:lower.distanceMeters}:null;
 sector.upper=upper?{location:{lat:upper.lat,lng:upper.lng},radiusMeters:upper.radiusMeters,distanceMeters:upper.distanceMeters}:null;
}
export function proposeSectorRadius(sector,detour){
 const{lower,upper}=sector;if(!lower)return upper?Math.max(25,Math.min(upper.radiusMeters*.8,detour?.median?1188/detour.median:upper.radiusMeters/2)):420;
 if(!upper)return Math.min(2400,Math.max(1440,lower.radiusMeters*1.4,detour?.median?1440/detour.median:0));
 const width=upper.radiusMeters-lower.radiusMeters,span=upper.distanceMeters-lower.distanceMeters;
 let r=span>0?lower.radiusMeters+(1188-lower.distanceMeters)*width/span:(lower.radiusMeters+upper.radiusMeters)/2;
 if(!Number.isFinite(r)&&detour.median)r=1188/detour.median;
 return Math.max(lower.radiusMeters+width*.08,Math.min(upper.radiusMeters-width*.08,r));
}
export function rankSamplingSectors(sectors){
 const candidates=sectors.filter(s=>!s.failed&&!s.nonMonotonic),estimate=s=>s.lower?.radiusMeters??0;
 const score=s=>!s.lower||!s.upper?1e6:(s.upper.radiusMeters-s.lower.radiusMeters)+.2*Math.max(...candidates.map(n=>{
  const gap=Math.abs(n.angle-s.angle),adjacent=Math.min(gap,2*Math.PI-gap)<=Math.PI/4+.001;return adjacent?Math.abs(estimate(n)-estimate(s)):0;}));
 return candidates.sort((a,b)=>score(b)-score(a)||a.visits-b.visits||a.id-b.id);
}
