import{createMapRuntime,startMapServices}from'./map-runtime.js?v=20261004';
import{installBaiduStyleTimeout}from'./map-style-transport.js?v=a82';
import{installSdkResourceHints}from'./map-resource-hints.js?v=a82';
// Start the SDK independently of the console/report module graph. All data stays in memory.
export function startMapBootstrap({windowRef=window,documentRef=document,fetcher=fetch}={}){
 if(windowRef.lifeCircleMapBootstrap)return windowRef.lifeCircleMapBootstrap;
 const stages=new Map(),listeners=new Set(),stage=name=>{if(stages.has(name))return;const at=performance.now();stages.set(name,at);windowRef.lifeCircleMapBootstrapTimings=Object.fromEntries(stages);for(const f of listeners)f(name,at);};
 stage('bootstrap-start');installSdkResourceHints({windowRef,documentRef,enabled:windowRef.lifeCircleMapResourceHintsEnabled!==false});const styleTransport=installBaiduStyleTimeout(windowRef,{localStyleEndpoint:'/api/map-style'}),runtime=createMapRuntime({windowRef,documentRef,onStage:stage}),services=startMapServices({fetcher,runtime,onStage:stage});
 const read=async path=>{const r=await fetcher(path,{signal:AbortSignal.timeout(5000)});if(!r.ok)throw Error('Startup request unavailable');return r.json();};
 const id=new URL(windowRef.location.href).searchParams.get('analysis'),report=id&&/^fa-[0-9a-f-]+$/.test(id)?read('/api/analyses/'+encodeURIComponent(id)+'?view=ui').then(job=>{stage('report-prefetched');return job;}).catch(()=>null):Promise.resolve(null),category=read('/api/facility-categories');
 // The console attaches error handlers later; keep early failures handled without hiding them.
 services.map.catch(()=>{});services.health.catch(()=>{});category.catch(()=>{});
 const bootstrap={runtime,services,styleTransport,report,category,subscribe(f){listeners.add(f);for(const[name,at]of stages)f(name,at);return()=>listeners.delete(f);}};
 windowRef.lifeCircleMapBootstrap=bootstrap;return bootstrap;
}
if(typeof window!=='undefined'&&typeof document!=='undefined')startMapBootstrap();
