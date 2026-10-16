import{mkdir,readFile,writeFile,rename}from'node:fs/promises';import{resolve,join}from'node:path';import{createHash}from'node:crypto';
const digest=s=>createHash('sha256').update(s).digest('hex');
export function timeFieldBinding(job){return digest(JSON.stringify([job.analysis.origin,job.score.evidenceFingerprint,job.geojson]));}
export function createTimeFieldStore(root){const base=resolve(root,'data/time-fields');
 return{async read(job){if(!/^fa-[0-9a-f-]+$/.test(job.analysisId))return null;const bind=timeFieldBinding(job);try{const saved=JSON.parse(await readFile(join(base,job.analysisId,bind+'.json'),'utf8'));return saved.binding===bind&&digest(JSON.stringify(saved.field))===saved.sha256?saved.field:null;}catch{return null;}},
 async write(job,field){if(!/^fa-[0-9a-f-]+$/.test(job.analysisId))throw Error('Invalid analysis ID');const binding=timeFieldBinding(job),directory=join(base,job.analysisId);await mkdir(directory,{recursive:true});const target=join(directory,binding+'.json'),text=JSON.stringify({analysisId:job.analysisId,binding,sourceEvidenceSnapshotId:job.score.evidenceFingerprint,origin:job.analysis.origin,savedAt:new Date().toISOString(),sha256:digest(JSON.stringify(field)),field},null,2);await writeFile(target+'.tmp',text);await rename(target+'.tmp',target);return target;}};
}
