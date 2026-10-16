// Each bearing keeps the same dependent bisection probes. Only independent
// cohorts overlap; the provider still owns OD quotas, cache and HTTP pacing.
export async function runRadialRounds({states,roundCount=3,batchSize,request,accept,onRound=()=>{},signal}){
 const count=states.length,width=Math.ceil(count/Math.ceil(count/batchSize)),cohorts=[];
 for(let start=0;start<count;start+=width)cohorts.push(states.slice(start,start+width));
 const finished=Array.from({length:roundCount},()=>0),valid=finished.map(()=>0),started=new Set(),waiters=finished.map(()=>[]),latencies=[];
 let outputs=0,failure=null,rounds=0;
 const unblock=r=>{if(valid[r]>0||finished[r]===count){for(const resolve of waiters[r])resolve(valid[r]>0);waiters[r]=[];}};
 await Promise.all(cohorts.map(async cohort=>{
  for(let r=0;r<roundCount;r++){
   if(signal?.aborted)throw signal.reason;if(failure)break;
   const radii=cohort.map(s=>(s.lo+s.hi)/2),at=performance.now();let rows;
   started.add(r);outputs+=cohort.length;
   try{rows=await request(cohort,radii,r+1);}
   catch(e){if(signal?.aborted)throw signal.reason;failure=e.code??'matrix_request_failed';}
   latencies.push({round:r+1,sectors:cohort.map(s=>s.sector),elapsedMs:performance.now()-at});
   if(!failure&&(!Array.isArray(rows)||rows.length!==cohort.length))failure='matrix_result_count_mismatch';
   if(failure){for(const list of waiters)for(const resolve of list)resolve(false);break;}
   rows.forEach((row,i)=>{if(accept(row,cohort[i],radii[i],r+1))valid[r]++;});finished[r]+=cohort.length;unblock(r);
   while(rounds<roundCount&&finished[rounds]===count){rounds++;onRound(rounds,valid[rounds-1]);}
   if(valid[r]===0&&finished[r]===count){failure=rows[0]?.routeStatus==='ok'?'invalid_matrix_binding':rows[0]?.routeStatus??'matrix_round_failed';break;}
   // Do not start another round if this entire round has no valid evidence.
   if(r+1<roundCount&&valid[r]===0&&!await new Promise(resolve=>waiters[r].push(resolve)))break;
  }
 }));
 if(signal?.aborted)throw signal.reason;
 return{failure,rounds,outputs,logicalRounds:started.size,cohortCount:cohorts.length,latencies};
}
