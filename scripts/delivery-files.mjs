import{readdir,readFile,lstat}from'node:fs/promises';import{join,resolve,relative,dirname}from'node:path';
export async function deliveryFiles(root=process.cwd()){
 const files=new Set(),add=async p=>{if(!files.has(p)){const s=await lstat(join(root,p));if(s.isSymbolicLink())throw Error('Symlinks are not release inputs: '+p);if(s.isFile())files.add(p);else for(const e of await readdir(join(root,p)))await add(p+'/'+e);}};
 for(const d of['server','web','test','data/fixtures','data/demo','docs/validation','docs/assets'])await add(d);
 for(const p of['README.md','package.json','.env.example','.gitignore','.gitattributes','LICENSE','LICENSE-STATUS.md','THIRD_PARTY_NOTICES.md','CONTRIBUTING.md','SECURITY.md','start.cmd','build.cmd','test.cmd','start.sh','build.sh','test.sh','build.ps1','ISOCHRONE_EXPERIMENT_CONCLUSION.md','docs/TECHNICAL_DESIGN.md','docs/API.md','docs/POI_RETRIEVAL_AND_CLASSIFICATION.md','docs/SCORING_AND_BLINDSPOT_SCOPE.md','docs/PROJECT_AUDIT.md'])await add(p);
 for(const p of await readdir(join(root,'data')))if(/^(facility-categories-v[2-8]|p0-category-mapping|wenjin-community-points)\.json$/.test(p))await add('data/'+p);
 for(const p of['scripts/test.mjs','scripts/project.mjs','scripts/start-production.mjs','scripts/build-delivery.mjs','scripts/delivery-files.mjs','scripts/check-delivery.mjs','scripts/prepare-demo.mjs','scripts/verify-records.mjs','scripts/verify-http.mjs','scripts/verify-browser.mjs'])await add(p);
 // Retain only scripts actually imported or read by maintained tests and their
 // local dependencies; omit historical browser automation and live experiments.
 const scanned=new Set();let more=true;while(more){more=false;for(const p of [...files]){if(scanned.has(p)||!/[.](?:mjs|js)$/.test(p))continue;scanned.add(p);const text=await readFile(join(root,p),'utf8');for(const match of text.matchAll(/(?:\.\.\/)?scripts\/[\w.-]+\.mjs/g)){const q=match[0].replace(/^\.\.\//,'');if(!files.has(q)){await add(q);more=true;}}for(const m of text.matchAll(/(?:from\s*|import\s*\()\s*['"](\.[^'"]+)['"]/g)){const q=relative(root,resolve(root,dirname(p),m[1].split('?')[0])).replaceAll('\\','/');if(q.startsWith('scripts/')&&!files.has(q)){await add(q);more=true;}}}}
 return[...files].sort();
}
