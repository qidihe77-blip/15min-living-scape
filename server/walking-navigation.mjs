import{createHash}from'node:crypto';
import{mkdir,readFile,writeFile,rename}from'node:fs/promises';
import{join}from'node:path';
import{WALKING_NAVIGATION_VERSION,navigationOnRoute}from'./walking-navigation-steps.mjs';
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const location=v=>v?.location??v;
const same=(a,b)=>a&&b&&[a.lng,a.lat,b.lng,b.lat].every(Number.isFinite)&&Math.abs(a.lng-b.lng)<=1e-6&&Math.abs(a.lat-b.lat)<=1e-6;
export function createNavigationStore(directory){return{
 async read(key){try{return JSON.parse(await readFile(join(directory,key+'.json'),'utf8'));}catch{return null;}},
 async write(key,value){await mkdir(directory,{recursive:true});const path=join(directory,key+'.json'),temp=path+'.tmp';await writeFile(temp,JSON.stringify(value));await rename(temp,path);}
};}
export function createWalkingNavigationManager({provider,reuseProvider=null,store=null,requestLimit=64,now=Date.now}={}){
 const cache=new Map(),pending=new Map();let requests=0,cacheHits=0,windowStart=now();
 async function get(job,{identityKey,evidenceId}={}){
  if(!job?.analysis?.origin||!['complete','partial'].includes(job.status))throw Object.assign(Error('分析尚未完成'),{statusCode:409});
  if(typeof identityKey!=='string'||identityKey.length>200)throw Object.assign(Error('无效设施标识'),{statusCode:400});
  const facility=job.display?.facilities?.find(p=>p.identityKey===identityKey),route=facility?.routeEvidence,origin=job.analysis.origin;
  if(!route||route.routeStatus!=='ok'||route.mode!=='walking'||route.coordinateSystem!=='BD-09LL'||!same(location(route.origin),origin.location)||(route.origin?.uid??route.originUid??null)!==(origin.uid??null)||!route.geometry||route.destinationConflict)throw Object.assign(Error('没有匹配的已保存Walking路线'),{statusCode:409});
  if(evidenceId&&evidenceId!==route.evidenceId)throw Object.assign(Error('路线证据已更新'),{statusCode:409});
  const destination={location:location(route.requestedDestination??route.facilityEndpoint??route.destination),uid:route.destinationUid??route.facilityUid??facility.uid??null};
  if(!destination.location||!same(location(route.requestedOrigin??origin),origin.location))throw Object.assign(Error('路线起终点不匹配'),{statusCode:409});
  const key=hash([WALKING_NAVIGATION_VERSION,job.analysisId,identityKey,route.evidenceId,origin,destination,route.destinationNavigation,route.geometry]);
  if(pending.has(key))return structuredClone(await pending.get(key));
  const run=(async()=>{
   const hit=cache.get(key)??await store?.read(key);if(hit?.expiresAt>now()){cacheHits++;cache.set(key,hit);return{...hit.value,cached:true,cacheSource:'navigation_cache'};}
   const options={mode:'walking',includeGeometry:true,originUid:origin.uid??null,destinationUid:destination.uid,destinationNavigation:route.destinationNavigation??'uid'};
   const saved=route.navigation?.instructionsPresent?route:reuseProvider?.peek?.(origin,destination,options);
   let navigation=saved?.navigation?.instructionsPresent?saved.navigation:null,source=navigation?'saved_walking_steps':'direction_lite',fresh=null;
   if(!navigation){
    if(now()-windowStart>=86400000){requests=0;windowStart=now();}
    if(!provider||requests>=requestLimit)return{status:'unavailable',reasonCode:provider?'navigation_request_limit':'navigation_provider_unavailable',identityKey,evidenceId:route.evidenceId,nodes:[],source};
    requests++;fresh=await provider.route(origin,destination,options);
    if(fresh.routeStatus!=='ok')navigation={version:WALKING_NAVIGATION_VERSION,status:'unavailable',reasonCode:fresh.routeStatus,nodes:[]};
    else if(!same(location(fresh.requestedOrigin),origin.location)||!same(location(fresh.requestedDestination),destination.location))navigation={version:WALKING_NAVIGATION_VERSION,status:'route_mismatch',nodes:[]};
    else navigation=fresh.navigation??{version:WALKING_NAVIGATION_VERSION,status:'missing_steps',nodes:[]};
   }
   const result=navigationOnRoute(navigation,route.geometry),value={...result,analysisId:job.analysisId,identityKey,evidenceId:route.evidenceId,source,retrievedAt:fresh?.retrievedAt??saved?.retrievedAt??null,cached:false,cacheSource:source,requestEndpoint:source==='direction_lite'?'/directionlite/v1/walking':null};
   const entry={expiresAt:now()+(['unavailable'].includes(value.status)?300000:86400000),value};cache.set(key,entry);while(cache.size>256)cache.delete(cache.keys().next().value);if(store&&value.status!=='unavailable')await store.write(key,entry).catch(()=>{});
   return value;
  })();pending.set(key,run);try{return structuredClone(await run);}finally{pending.delete(key);}
 }
 return{get,stats:()=>({requests,requestLimit,cacheHits,pending:pending.size,cacheEntries:cache.size})};
}
