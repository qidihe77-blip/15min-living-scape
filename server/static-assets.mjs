import{readFile,stat}from'node:fs/promises';import{createHash}from'node:crypto';import{gzipSync}from'node:zlib';import{extname,basename}from'node:path';
export const acceptsGzip=headers=>(headers?.['accept-encoding']??'').split(',').some(part=>/^\s*gzip\s*(?:;|$)/i.test(part)&&Number(/;\s*q\s*=\s*([\d.]+)/i.exec(part)?.[1]??1)>0);
export function createStaticAssets({maxEntries=128}={}){
 const entries=new Map();
 return{async send(request,response,filePath,contentType){
  const info=await stat(filePath);if(!info.isFile())throw Error('Not a file');let asset=entries.get(filePath);
  if(!asset||asset.mtime!==info.mtimeMs||asset.size!==info.size){const body=await readFile(filePath),text=/\.(?:js|css|html|svg|json)$/i.test(filePath);asset={body,gzip:text&&body.length>1024?gzipSync(body):null,mtime:info.mtimeMs,size:info.size,etag:'"'+createHash('sha256').update(body).digest('hex')+'"'};entries.set(filePath,asset);if(entries.size>maxEntries)entries.delete(entries.keys().next().value);}
  const pinned=/^(?:echarts-\d+\.\d+\.\d+|mapvgl-beta\d+)\.min\.js$/.test(basename(filePath)),headers={'content-type':contentType,'x-content-type-options':'nosniff','cache-control':pinned?'public, max-age=31536000, immutable':'no-cache',etag:asset.etag,vary:'Accept-Encoding'};
  headers.etag='W/'+asset.etag;
  if(request.headers['if-none-match']?.split(',').map(s=>s.trim().replace(/^W\//,'')).includes(asset.etag)){response.writeHead(304,headers);response.end();return;}
  const encoded=asset.gzip&&acceptsGzip(request.headers),body=encoded?asset.gzip:asset.body;if(encoded)headers['content-encoding']='gzip';headers['content-length']=body.length;response.writeHead(200,headers);response.end(body);
 }};
}
