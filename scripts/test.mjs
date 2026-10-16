import {readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
// Only maintained source tests; never rediscover archived ZIP extractions,
// temporary debugging copies or dependency test suites under the workspace.
const files=[];async function walk(dir){for(const p of await readdir(dir,{withFileTypes:true})){const path=join(dir,p.name);if(p.isDirectory()&&p.name!=='fixtures')await walk(path);else if(p.isFile()&&p.name.endsWith('.test.mjs'))files.push(path);}}
await walk('server');await walk('test');files.sort();const result=spawnSync(process.execPath,['--test',...files],{stdio:'inherit',windowsHide:true});process.exit(result.status??1);
