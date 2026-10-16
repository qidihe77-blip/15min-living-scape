// Cache the exact SDK-generated response for the exact published stylesheet.
// This is not a substitute style, a general proxy, or a Place/Route endpoint.
import {createHash} from 'node:crypto';import {readFile,writeFile,mkdir} from 'node:fs/promises';import {join} from 'node:path';
import {gzipSync} from 'node:zlib';
export function styleCacheKey(params){return createHash('sha256').update(JSON.stringify([...params.entries()].filter(([k])=>!['ak','sign','timeStamp'].includes(k)).sort(([a],[b])=>a.localeCompare(b)))).digest('hex');}
export function validStyleResponse(body){try{const data=JSON.parse(body);return data.status===0&&Array.isArray(data.data?.style)&&data.data.style.length===3;}catch{return false;}}
export function createMapStyleCache({root,browserMapAk,fetcher=fetch,now=Date.now}){
 const directory=join(root,'data/map-style-cache'),entries=new Map(),pending=new Map();let hits=0,misses=0;
 const seed=readFile(join(directory,'light.json'),'utf8').then(async m=>{const meta=JSON.parse(m);if(!/^[a-f0-9]{64}$/.test(meta.key))return;const body=await readFile(join(directory,meta.key+'.json'),'utf8');
  if(createHash('sha256').update(body).digest('hex')===meta.sha256&&validStyleResponse(body))entries.set(meta.key,{body,gzip:gzipSync(body),at:meta.at});}).catch(()=>{});
 async function get(params,{refresh=false}={}){
  await seed;if(!browserMapAk||params.get('ak')!==browserMapAk||params.get('qt')!=='custom_v2'||!params.get('styles')||params.get('styles').length>20000)throw Object.assign(new Error('Invalid map style request'),{statusCode:400});
  const key=styleCacheKey(params),cached=entries.get(key);
  if(!refresh&&cached&&now()-cached.at<7*86400000){hits++;return{...cached,source:'exact_response_cache',key};}
  if(pending.has(key))return pending.get(key);misses++;
  const operation=(async()=>{const response=await fetcher('https://api.map.baidu.com/custom/v2/mapstyle',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded','referer':'http://localhost:4173/'},body:params.toString(),signal:AbortSignal.timeout(25000)});
   const body=await response.text();if(!response.ok||Buffer.byteLength(body)>8000000||!validStyleResponse(body))throw Object.assign(new Error('Custom style unavailable'),{statusCode:502});
   const value={body,gzip:gzipSync(body),at:now()};entries.set(key,value);while(entries.size>4)entries.delete(entries.keys().next().value);
   await mkdir(directory,{recursive:true});await writeFile(join(directory,key+'.json'),body);await writeFile(join(directory,'light.json'),JSON.stringify({key,at:value.at,sha256:createHash('sha256').update(body).digest('hex'),publishedStyleId:'214cf6a585f2b9166e4106873999ec9e'}));
   return{...value,source:'published_style_network',key};})();pending.set(key,operation);
  try{return await operation;}finally{pending.delete(key);}
 }
 return{get,stats:()=>({hits,misses,entries:entries.size,pending:pending.size})};
}
