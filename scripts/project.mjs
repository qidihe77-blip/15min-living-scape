import {copyFile,access} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url));process.chdir(root);
if(Number(process.versions.node.split('.')[0])<20)throw Error('Node.js 20+ is required.');
const action=process.argv[2]??'start';
const commands={build:['scripts/build-delivery.mjs'],test:['scripts/test.mjs'],start:['server/index.mjs'],check:['scripts/check-delivery.mjs'],demo:['scripts/prepare-demo.mjs']};
if(!commands[action])throw Error('Use start, build, test, check or demo.');
if(action==='start'){try{await access(resolve(root,'.env.local'));}catch{await copyFile(resolve(root,'.env.example'),resolve(root,'.env.local'));console.log('Created .env.local with empty AK values; edit it to enable online services.');}}
const result=spawnSync(process.execPath,commands[action],{cwd:root,stdio:'inherit',windowsHide:true});process.exit(result.status??1);
