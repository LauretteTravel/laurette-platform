import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
const base='https://laurette-platform.onrender.com';
const paths=['/health','/','/admin','/account','/account/profile','/track','/programs','/programs/print','/offers','/api/admin/organization','/api/admin/users','/api/admin/transfers'];
let failures=0;
for(const path of paths){const r=await fetch(base+path,{signal:AbortSignal.timeout(30000)});await r.arrayBuffer();if(r.status!==(path.startsWith('/api/admin/')?401:200)) failures++;console.log(JSON.stringify({path,status:r.status,expected:path.startsWith('/api/admin/')?401:200}));}
for(const path of ['/assets/js/admin.js','/assets/js/app.js']){const r=await fetch(base+path,{signal:AbortSignal.timeout(30000)});const bytes=Buffer.from(await r.arrayBuffer());const hash=b=>createHash('sha256').update(b).digest('hex');const matches=hash(bytes)===hash(readFileSync('public'+path));if(r.status!==200||!matches) failures++;console.log(JSON.stringify({path,status:r.status,matchesAuditedSource:matches}));}

process.exitCode=failures?1:0;
