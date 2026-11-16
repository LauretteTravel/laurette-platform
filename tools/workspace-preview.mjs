import {createApp} from '../server.js';
import {readFileSync} from 'node:fs';
const seed=JSON.parse(readFileSync(new URL('../data/seed.json',import.meta.url),'utf8'));
seed.users=seed.users.map(({password,...u})=>({...u,mustChange:false}));
const app=createApp({dbFile:':memory:',seed,adminPassword:'Local-Workspace-QA-42',baseUrl:'http://127.0.0.1:3187'});
await app.listen(3187,'127.0.0.1');
console.log('Isolated in-memory Workspace QA: http://127.0.0.1:3187/workspace');
