import {readFile,mkdir,writeFile,rename} from 'node:fs/promises';
import {dirname} from 'node:path';

// API family and navigation policy are part of an OD: Matrix costs cannot
// satisfy a request for a real path, nor can two different entrance UIDs merge.
export function walkingOdCacheKey(origin,destination,{mode='walking',originUid,destinationUid,
 originNavigation='uid',destinationNavigation='uid',endpoint='direction_v2'}={}){
 const row=(v,uid,policy)=>{const p=v.location??v;if(![p.lat,p.lng].every(Number.isFinite))throw new TypeError('Invalid OD.');
  return [Number(p.lat.toFixed(6)),Number(p.lng.toFixed(6)),policy==='coordinates'?null:uid??v.uid??null];};
 return JSON.stringify(['walking-od-v1','BD-09LL',endpoint,mode,originNavigation,destinationNavigation,
  row(origin,originUid,originNavigation),row(destination,destinationUid,destinationNavigation)]);
}
export function createWalkingCache({path=null,ttlMs=86400000,maxEntries=20000,now=Date.now}={}){
 if(!Number.isFinite(ttlMs)||ttlMs<=0||ttlMs>604800000||!Number.isInteger(maxEntries)||maxEntries<1)throw new RangeError('Invalid Walking cache limits.');
 const entries=new Map();let timer=null,writing=Promise.resolve(),dirty=false,error=null;
 const ready=path?readFile(path,'utf8').then(text=>{const saved=JSON.parse(text);if(saved.version!==1||!Array.isArray(saved.entries))throw new Error('cache_schema');
  for(const[k,e]of saved.entries)if(typeof k==='string'&&e?.route?.routeStatus==='ok'&&Number.isFinite(e.createdAt)&&Number.isFinite(e.expiresAt)&&e.createdAt<=now()&&Math.min(e.expiresAt,e.createdAt+ttlMs)>now())entries.set(k,{...e,expiresAt:Math.min(e.expiresAt,e.createdAt+ttlMs)});
  trim();}).catch(e=>{if(e.code!=='ENOENT')error='walking_cache_read_failed';}):Promise.resolve();
 function trim(){for(const[k,e]of entries)if(e.expiresAt<=now())entries.delete(k);while(entries.size>maxEntries)entries.delete(entries.keys().next().value);}
 function matches(key,route){if(!key.startsWith('["walking-od-v1"'))return true;try{const a=JSON.parse(key);return key===walkingOdCacheKey(route.requestedOrigin,route.requestedDestination,{endpoint:a[2],mode:a[3],originNavigation:a[4],destinationNavigation:a[5]});}catch{return false;}}
 function get(key,geometry=false){const e=entries.get(key);if(!e||e.expiresAt<=now()||!matches(key,e.route)){entries.delete(key);return null;}
  if(geometry&&!e.detailsRequested)return null;entries.delete(key);entries.set(key,e);return {...structuredClone(e.route),cached:true,cacheTier:path?'persistent':'memory',walkingRequestAttempts:0};}
 function set(key,route,detailsRequested=false,{createdAt=now()}={}){
  if(route?.routeStatus!=='ok'||detailsRequested&&!route.geometry||!Number.isFinite(route.distanceMeters)||route.distanceMeters<0||!Number.isFinite(route.durationSeconds)||route.durationSeconds<0||!Number.isFinite(createdAt)||createdAt>now()||createdAt+ttlMs<=now())return;
  const old=entries.get(key);if(old?.detailsRequested&&!detailsRequested&&old.expiresAt>now())return;
  entries.set(key,{route:structuredClone(route),detailsRequested,createdAt,expiresAt:createdAt+ttlMs});trim();dirty=true;
  if(path&&!timer){timer=setTimeout(()=>{timer=null;flush().catch(()=>{});},1000);timer.unref?.();}
 }
 async function flush(){await ready;if(timer){clearTimeout(timer);timer=null;}if(!path||!dirty)return writing;
  dirty=false;trim();const body=JSON.stringify({version:1,entries:[...entries]});
  writing=writing.catch(()=>{}).then(async()=>{try{await mkdir(dirname(path),{recursive:true});await writeFile(path+'.tmp',body);await rename(path+'.tmp',path);error=null;}catch{error='walking_cache_write_failed';}});return writing;}
 return {ready,get,set,flush,stats:()=>({entries:entries.size,ttlMs,maxEntries,error})};
}
