// Learn exact public SDK versions from completed native script loads. Preload
// those same URLs on later visits; never rewrite SDK URLs or cache its code.
const KEY='life-circle-sdk-resource-hints-v1';
export function publicSdkResource(value){try{const u=new URL(value);if(u.protocol!=='https:'||u.hostname!=='maponline0.bdimg.com'||u.port||!['/sty/fs.js','/sty/icons_2x.js','/sty/indoor_fs.js'].includes(u.pathname)||[...u.searchParams.keys()].some(k=>!['udt','v'].includes(k)))return null;return{file:u.pathname.split('/').at(-1),url:u.href};}catch{return null;}}
export function validSdkHints(value,now=Date.now()){return(Array.isArray(value)?value:[]).filter(e=>publicSdkResource(e?.url)&&Number.isFinite(e.at)&&e.at<=now&&now-e.at<86400000).slice(0,3);}
export function installSdkResourceHints({windowRef=window,documentRef=document,enabled=true,now=Date.now}={}){
 let hints=[];try{hints=validSdkHints(JSON.parse(windowRef.localStorage?.getItem(KEY)??'[]'),now());}catch{}
 const preloaded=[];if(enabled)for(const e of hints){const link=documentRef.createElement('link');link.rel='preload';link.as='script';link.href=e.url;documentRef.head.append(link);preloaded.push(e.url);}
 let observer;try{observer=new windowRef.PerformanceObserver(list=>{let changed=false;for(const e of list.getEntries()){const resource=e.initiatorType==='script'&&publicSdkResource(e.name);if(!resource)continue;hints=hints.filter(h=>publicSdkResource(h.url)?.file!==resource.file);hints.push({url:resource.url,at:now()});changed=true;}if(changed)try{windowRef.localStorage?.setItem(KEY,JSON.stringify(hints.slice(-3)));}catch{}});observer.observe({type:'resource',buffered:true});}catch{}
 const result={preloaded,dispose:()=>observer?.disconnect()};windowRef.addEventListener?.('pagehide',result.dispose,{once:true});return result;
}
