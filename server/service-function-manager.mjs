import{assessServiceFunctions}from'./service-functions.mjs';
import{serviceFunctionBinding}from'./service-function-store.mjs';
import{runServiceFunctions}from'./service-function-runner.mjs';
import{walkingTaskAllowance}from'./authorized-walking.mjs';
// Independent sidecar: never writes back to the analysis, category results or score.
export function createServiceFunctionManager({store,placeProvider,routeProvider,budgets={},remainingWalking=()=>36,timeoutMs=90000}){
 const operations=new Map();
 return{async get(job,{start=false}={}){
  const key=job.analysisId+':'+serviceFunctionBinding(job),active=operations.get(key);if(active)return active;
  const saved=await store.read(job);if(saved){const{grid,...field}=saved;return{status:'complete',field:{...field,scope:'analysis_origin_only'},cacheHit:true};}
  // Recheck after await: simultaneous auto-starts must share the same bounded run.
  if(operations.has(key))return operations.get(key);
  const initial={status:'not_started',field:assessServiceFunctions({job})};if(!start)return initial;
  const op={...initial,status:'running',progress:{phase:'starting'}},allowance=walkingTaskAllowance(Math.max(0,Math.min(budgets.originRouteLimit??12,await remainingWalking(job))));
  if(operations.has(key))return operations.get(key);operations.set(key,op);
  const began=performance.now(),controller=new AbortController(),timer=setTimeout(()=>controller.abort(Error('service_function_timeout')),timeoutMs);
  op.done=runServiceFunctions({job,placeProvider,routeProvider,...budgets,walkingAllowance:allowance,signal:controller.signal,onProgress:p=>op.progress=p}).catch(e=>{
   const field=assessServiceFunctions({job,enrichmentState:'complete',requestStats:{walkingRequests:allowance.used,elapsedMs:Math.round(performance.now()-began)}});field.errors=[{code:e.message==='service_function_timeout'?'service_function_timeout':'automated_service_enrichment_failed'}];return field;
  }).then(async field=>{op.field=field;op.status='complete';try{await store.write(job,field);}catch{op.storageError='service_function_snapshot_write_failed';}return field;}).finally(()=>{clearTimeout(timer);delete op.done;if(operations.size>32)for(const[k,v]of operations)if(v.status==='complete'){operations.delete(k);break;}});
  return op;
 }};
}
