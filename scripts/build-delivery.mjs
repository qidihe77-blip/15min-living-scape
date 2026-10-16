import {readFile,writeFile,readdir,lstat,mkdir} from 'node:fs/promises';
import {resolve,join,relative,sep} from 'node:path';
import {createHash} from 'node:crypto';
import {deflateRawSync} from 'node:zlib';
import {execFileSync} from 'node:child_process';
import{deliveryFiles}from'./delivery-files.mjs';
import{PRODUCTION_BOUNDARY_SHAPE_VERSION as BOUNDARY_SHAPE_VERSION}from'../server/centered-walking-range.mjs';
const started=performance.now(),root=process.cwd(),includeRecords=true,sha=b=>createHash('sha256').update(b).digest('hex');
execFileSync(process.execPath,['scripts/test.mjs'],{cwd:root,stdio:'inherit',windowsHide:true});
execFileSync(process.execPath,['scripts/verify-records.mjs'],{cwd:root,stdio:'inherit',windowsHide:true});
execFileSync(process.execPath,['scripts/verify-http.mjs'],{cwd:root,stdio:'inherit',windowsHide:true});
const paths=await deliveryFiles(root);
function within(path){if(!resolve(path).toLowerCase().startsWith((resolve(root)+sep).toLowerCase()))throw Error('Build path leaves workspace');}
execFileSync(process.execPath,['scripts/check-delivery.mjs'],{cwd:root,stdio:'inherit',windowsHide:true});
const entries=[];
for(const path of [...new Set(paths)].sort()){
 const full=resolve(root,path);within(full);const name=relative(root,full).replaceAll('\\','/');
 if(/(^|\/)(\.env\.local|node_modules|tmp|\.git|\.codex|\.agents)(\/|$)/.test(name)||name.startsWith('data/runtime/'))throw Error('Private build input: '+name);
 const body=await readFile(full);
 if(/\.(mjs|js|json|md|txt|html)$/.test(name)&&/\b(?:BAIDU_SERVER_AK|VITE_BAIDU_MAP_AK)\s*[:=]\s*["']?[A-Za-z0-9]{25,40}/.test(body.toString('utf8')))throw Error('Possible embedded AK in build input: '+name);
 entries.push({name,body,sha256:sha(body)});
}
const manifest={version:'competition-source-delivery-v3',builtAt:new Date().toISOString(),node:process.version,includeRecords,testsPassed:true,
 production:{entry:'npm run start:production',algorithm:'walking36',boundaryShapeVersion:BOUNDARY_SHAPE_VERSION,experimentalUiRemoved:true},
 licenseStatus:'MIT; third-party notices and provider data terms are separate.',
 durationMs:performance.now()-started,files:entries.map(({name,body,sha256})=>({path:name,bytes:body.length,sha256}))};
entries.push({name:'BUILD-MANIFEST.json',body:Buffer.from(JSON.stringify(manifest,null,2))});
// Standard ZIP32/deflate, UTF-8 filenames; no external archiver dependency.
const table=Array.from({length:256},(_,i)=>{let c=i;for(let n=0;n<8;n++)c=c&1?0xedb88320^(c>>>1):c>>>1;return c>>>0;}),crc=body=>{let c=0xffffffff;for(const b of body)c=table[(c^b)&255]^(c>>>8);return(c^0xffffffff)>>>0;},chunks=[],central=[];
let offset=0;const now=new Date(),time=(now.getHours()<<11)|(now.getMinutes()<<5)|Math.floor(now.getSeconds()/2),date=((now.getFullYear()-1980)<<9)|((now.getMonth()+1)<<5)|now.getDate();
for(const entry of entries){const name=Buffer.from(entry.name),body=entry.body,compressed=deflateRawSync(body),checksum=crc(body),header=Buffer.alloc(30),directory=Buffer.alloc(46);
 header.writeUInt32LE(0x04034b50,0);header.writeUInt16LE(20,4);header.writeUInt16LE(0x800,6);header.writeUInt16LE(8,8);header.writeUInt16LE(time,10);header.writeUInt16LE(date,12);header.writeUInt32LE(checksum,14);header.writeUInt32LE(compressed.length,18);header.writeUInt32LE(body.length,22);header.writeUInt16LE(name.length,26);
 directory.writeUInt32LE(0x02014b50,0);directory.writeUInt16LE(20,4);directory.writeUInt16LE(20,6);directory.writeUInt16LE(0x800,8);directory.writeUInt16LE(8,10);directory.writeUInt16LE(time,12);directory.writeUInt16LE(date,14);directory.writeUInt32LE(checksum,16);directory.writeUInt32LE(compressed.length,20);directory.writeUInt32LE(body.length,24);directory.writeUInt16LE(name.length,28);directory.writeUInt32LE(offset,42);
 chunks.push(header,name,compressed);central.push(directory,name);offset+=header.length+name.length+compressed.length;
}
if(entries.length>65535||offset>0xffffffff)throw Error('ZIP32 limits exceeded');
const centralSize=central.reduce((n,b)=>n+b.length,0),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(centralSize,12);end.writeUInt32LE(offset,16);
const zip=Buffer.concat([...chunks,...central,end]),directory=resolve(root,'dist');within(directory);await mkdir(directory,{recursive:true});
const stamp=new Date().toISOString().replace(/[-:.]/g,''),name='life-circle-production-'+(includeRecords?'with-records-':'source-')+stamp+'.zip',path=join(directory,name),checksum=sha(zip);
await writeFile(path,zip);await writeFile(path+'.sha256',checksum+'  '+name+'\n');await writeFile(join(directory,name+'.manifest.json'),JSON.stringify(manifest,null,2));
const result={artifact:path,sha256:checksum,files:entries.length,bytes:zip.length,includeRecords,testsPassed:true,durationMs:performance.now()-started};await writeFile(join(directory,'build-latest.json'),JSON.stringify(result,null,2));
console.log(JSON.stringify(result));
