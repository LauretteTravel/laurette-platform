/** Read-only source audit; all mutation probes run against :memory: synthetic data. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createApp } from '../server.js';
import { hashPassword, createSession } from '../lib/auth.js';
import * as API from '../lib/api.js';
const seed = JSON.parse(readFileSync('data/seed.json','utf8'));
const app=createApp({dbFile:':memory:',baseUrl:'http://127.0.0.1:0',adminPassword:'Synthetic-Audit-Password42',
  seed:{...seed,users:seed.users.map(({password,...u})=>({...u,mustChange:true}))},sendVerificationEmail:async()=>{}});
const addr=await app.listen(0,'127.0.0.1'),base=`http://127.0.0.1:${addr.port}`,db=app.db;
async function call(path,method='GET',cookie,body){const r=await fetch(base+path,{method,headers:{origin:base,'content-type':'application/json',...(cookie?{cookie}:{})},body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json()};}
try {
 const tables=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(x=>x.name);
 const source=readFileSync('server.js','utf8'), names=[...new Set([...source.matchAll(/\bAPI\.([A-Za-z0-9_]+)/g)].map(m=>m[1]))];
 assert.ok(names.every(n=>typeof API[n]==='function'));
 console.log(JSON.stringify({tables:tables.length,tableNames:tables,roleDefinitions:db.prepare('SELECT count(*) n FROM role_definitions').get().n,permissionCodes:16,staticRouterRegistrations:(source.match(/router\.(get|post|patch|delete)\(/g)||[]).length,referencedApiHandlers:names.length,userVersion:db.prepare('PRAGMA user_version').get().user_version,integrity:db.prepare('PRAGMA integrity_check').get().integrity_check,fkErrors:db.prepare('PRAGMA foreign_key_check').all().length}));
 const now='2026-10-31T00:00:00.000Z', branches=db.prepare('SELECT id FROM branches ORDER BY id').all();
 const dept=db.prepare('SELECT id FROM departments WHERE branch_id IS NULL LIMIT 1').get().id;
 db.prepare('INSERT INTO role_definitions (role_key,name,base_role,data_scope,permissions,created_at,updated_at) VALUES (?,?,?,?,?,?,?)').run('audit_branch','Synthetic branch role','agent','branch',JSON.stringify(['requests:read','requests:write','customers:read','overview:read']),now,now);
 db.prepare('INSERT INTO role_definitions (role_key,name,base_role,data_scope,permissions,created_at,updated_at) VALUES (?,?,?,?,?,?,?)').run('audit_department','Synthetic department role','agent','department',JSON.stringify(['requests:read','requests:write','overview:read']),now,now);
 const pw=hashPassword('Synthetic-Audit-Password42');
 function user(username,roleKey,branch){const id=Number(db.prepare('INSERT INTO users (username,name,role,role_key,branch_id,department_id,password_hash,password_salt,created_at) VALUES (?,?,?,?,?,?,?,?,?)').run(username,username,'agent',roleKey,branch,dept,pw.hash,pw.salt,now).lastInsertRowid);return {id,cookie:'lt_session='+createSession(db,id,'127.0.0.1','audit').token};}
 const branchUser=user('audit_branch_user','audit_branch',branches[0].id),deptA=user('audit_department_a','audit_department',branches[0].id),deptB=user('audit_department_b','audit_department',branches[1].id);
 const cid=Number(db.prepare('INSERT INTO customers (name,phone,created_at,updated_at) VALUES (?,?,?,?)').run('Synthetic customer','+962790000000',now,now).lastInsertRowid);
 const rid=Number(db.prepare("INSERT INTO requests (reference,type,customer_id,branch_id,department_id,assigned_to,payload,created_at,updated_at) VALUES ('AUDIT-SYNTHETIC','flight',?,?,?,?, '{}',?,?)").run(cid,branches[0].id,dept,branchUser.id,now,now).lastInsertRowid);
 const checks=[];
 checks.push({id:'P1-SQL-UPDATE',status:(await call(`/api/admin/requests/${rid}`,'PATCH',branchUser.cookie,{note:'synthetic'})).status});
 checks.push({id:'P1-SQL-TRANSFER',status:(await call(`/api/admin/requests/${rid}/transfers`,'POST',branchUser.cookie,{branchId:branches[1].id,departmentId:dept,userId:deptB.id})).status});
 checks.push({id:'P1-SQL-CUSTOMER',status:(await call(`/api/admin/customers/${cid}`,'GET',branchUser.cookie)).status});
 db.prepare("INSERT INTO webhook_deliveries (reference,event,status,created_at) VALUES ('AUDIT-OTHER-BRANCH','booking.created','delivered',?)").run(now);
 const hooks=await call('/api/admin/webhooks','GET',branchUser.cookie);
 checks.push({id:'P1-WEBHOOK-SCOPE',status:hooks.status,otherBranchReferenceVisible:hooks.data.deliveries?.some(r=>r.reference==='AUDIT-OTHER-BRANCH')});
 const tid=Number(db.prepare("INSERT INTO request_transfers (request_id,to_branch_id,to_department_id,to_user_id,created_at) VALUES (?,?,?,?,?)").run(rid,branches[1].id,dept,deptB.id,now).lastInsertRowid);
 checks.push({id:'P1-CROSS-BRANCH-TRANSFER',status:(await call(`/api/admin/transfers/${tid}/respond`,'POST',deptA.cookie,{decision:'accept'})).status,actorBranch:branches[0].id,intendedBranch:branches[1].id});
 console.log(JSON.stringify({syntheticProbes:checks}));
 assert.deepEqual(checks.slice(0,3).map(x=>x.status),[500,500,500]);
 assert.equal(checks[3].otherBranchReferenceVisible,true);assert.equal(checks[4].status,200);
 console.log('AUDIT REPRODUCED: 5 known gaps; production untouched.');
} finally {await app.close();}
