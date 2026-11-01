import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { createApp } from '../server.js';
import { hashPassword, createSession, sessionUser } from '../lib/auth.js';
import { backupInventory, createSystemHealth, workerAttempt, workerFinished } from '../lib/system-health.js';

let app, db, base, branch, owner;
const stamp='2026-11-01T12:00:00.000Z', secret='SYNTHETIC_PRIVATE_SENTINEL', path='/api/admin/system-health';
function actor({scope='organization',permissions=['system:health'],mfa=true,mustChange=0,legacy=false}={}) {
  const key='s6-'+randomBytes(5).toString('hex'), p=hashPassword('Synthetic-Phase6-Password42');
  if(!legacy)db.prepare('INSERT INTO role_definitions(role_key,name,base_role,data_scope,permissions,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run(key,key,'agent',scope,JSON.stringify(permissions),stamp,stamp);
  const id=Number(db.prepare('INSERT INTO users(username,name,role,role_key,branch_id,password_hash,password_salt,must_change,created_at) VALUES(?,?,?,?,?,?,?,?,?)').run(key,key,legacy?'admin':'agent',legacy?null:key,branch,p.hash,p.salt,mustChange,stamp).lastInsertRowid);
  const token=createSession(db,id,'127.0.0.1','synthetic',{mfaVerified:mfa}).token;
  return {id,key,token,cookie:'lt_session='+token};
}
async function call(who,{method='GET'}={}) {
  const res=await fetch(base+path,{method,headers:{origin:base,'x-requested-with':'fetch',...(who?{cookie:who.cookie}:{})}});
  return {status:res.status,headers:res.headers,data:await res.json()};
}
function monitor(){return createSystemHealth({dbFile:':memory:',startedAt:Date.now(),workers:{deadlines:{scheduled:true,intervalSeconds:60,running:false},whatsapp:{scheduled:false,intervalSeconds:5,running:false}},whatsappEnabled:false});}
function ctx(who){return {db,token:who.token,user:sessionUser(db,who.token),res:{writeHead(){},end(){}}};}
before(async()=>{
  for(const key of ['N8N_BOOKING_WEBHOOK_URL','N8N_WEBHOOK_URL','N8N_BOOKING_WEBHOOK_SECRET','N8N_API_KEY','N8N_WEBHOOK_KEY'])delete process.env[key];
  process.env.WHATSAPP_NOTIFICATIONS_ENABLED='0';
  const seed=JSON.parse(readFileSync('data/seed.json','utf8'));
  app=createApp({dbFile:':memory:',seed:{...seed,users:[]},adminPassword:'Synthetic-Phase6-Password42',baseUrl:'http://127.0.0.1:0'});
  db=app.db;branch=db.prepare('SELECT id FROM branches LIMIT 1').get().id;
  owner=actor();const a=await app.listen(0,'127.0.0.1');base=`http://127.0.0.1:${a.port}`;
  for(const status of ['failed','delivered'])db.prepare('INSERT INTO webhook_deliveries(event,url,status,error,created_at) VALUES(?,?,?,?,?)').run('synthetic',`https://invalid.example/${secret}`,status,secret,stamp);
  const workspace=db.prepare('SELECT id FROM program_workspaces LIMIT 1').get().id;
  db.prepare('INSERT INTO program_sources(id,workspace_id,filename,kind,sha256,bytes,content,extraction_json,uploaded_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run('synthetic-phase6',workspace,secret+'.pdf','pdf','a'.repeat(64),12,Buffer.from(secret),JSON.stringify({status:'failed',text:secret,error:secret}),owner.id,stamp);
});
after(async()=>{await app?.close();});

test('phase6 health requires independent capability, organization scope, complete password and MFA gates',async()=>{
  assert.equal((await call()).status,401);
  for(const options of [{permissions:['overview:read','audit:read']},{scope:'branch'},{scope:'assigned'},{mfa:false},{mustChange:1},{legacy:true,mfa:false}])assert.equal((await call(actor(options))).status,403,JSON.stringify(options));
  assert.equal((await call(actor({legacy:true}))).status,200);
  assert.equal((await call(owner,{method:'POST'})).status,404);
});
test('phase6 health returns bounded operational facts without private paths, endpoints, contents or errors',async()=>{
  const r=await call(owner);assert.equal(r.status,200);assert.equal(r.headers.get('cache-control'),'no-store');
  assert.equal(r.data.database.schemaVersion,8);assert.equal(r.data.database.recordedMigrations,8);assert.equal(r.data.database.fullIntegrityChecked,false);
  assert.deepEqual(r.data.n8n.queue.states,{delivered:1,failed:1});
  assert.equal(r.data.files.imports.states.failed,1);assert.equal(r.data.n8n.liveConnectionVerified,false);assert.equal(r.data.n8n.configured,false);
  assert.equal(r.data.backups.restoreVerified,false);assert.equal(r.data.backups.scheduledBackupVerified,false);
  assert.equal(r.data.files.rejectedTaskUploadHistoryAvailable,false);assert.equal(r.data.files.scannerLiveVerified,false);
  const text=JSON.stringify(r.data);for(const forbidden of [secret,'invalid.example','password','token_hash','filename','sha256','content','C:\\','/opt/'])assert.ok(!text.includes(forbidden),forbidden);
});
test('phase6 cached health never bypasses live permission, membership or session revocation',async()=>{
  const u=actor();assert.equal((await call(u)).status,200);
  db.prepare('UPDATE role_definitions SET permissions=? WHERE role_key=?').run('[]',u.key);assert.equal((await call(u)).status,403);
  db.prepare('DELETE FROM sessions WHERE user_id=?').run(u.id);assert.equal((await call(u)).status,401);
});
test('phase6 revocation during asynchronous inventory prevents the response',async()=>{
  const u=actor(), handler=monitor(), c=ctx(u);let writes=0;c.res.writeHead=()=>writes++;
  const pending=handler(c);db.prepare('UPDATE users SET active=0 WHERE id=?').run(u.id);
  await assert.rejects(pending,e=>e.status===401);assert.equal(writes,0);
});
test('phase6 health reads do not mutate business rows, flags or migration history',async()=>{
  const snap=()=>JSON.stringify(Object.fromEntries(['requests','customers','bookings','booking_payments','programs','program_sources','tasks','webhook_deliveries','whatsapp_outbox','schema_migrations','audit_log'].map(t=>[t,db.prepare(`SELECT * FROM ${t}`).all()])));
  const before=snap(), flags=[process.env.TASK_ATTACHMENT_UPLOADS_ENABLED,process.env.PROGRAM_SOURCE_UPLOADS_ENABLED];
  assert.equal((await call(owner)).status,200);assert.equal(snap(),before);assert.deepEqual([process.env.TASK_ATTACHMENT_UPLOADS_ENABLED,process.env.PROGRAM_SOURCE_UPLOADS_ENABLED],flags);
});
test('phase6 worker observations distinguish attempts, successes and failures without exception text',()=>{
  const w={scheduled:true};workerAttempt(w,1000);assert.equal(w.running,true);
  workerFinished(w,{ok:false,at:1200,durationMs:200.2});assert.equal(w.running,false);assert.equal(w.lastSuccessAt,undefined);assert.equal(w.lastFailureAt,new Date(1200).toISOString());
  workerAttempt(w,2000);workerFinished(w,{ok:true,at:2100,durationMs:100});assert.equal(w.lastSuccessAt,new Date(2100).toISOString());assert.equal(w.lastFailureAt,new Date(1200).toISOString());assert.equal(w.lastDurationMs,100);
});
test('phase6 backup inventory matches migration filenames only and never claims a fake file is restorable',async()=>{
  const folder=mkdtempSync(join(tmpdir(),'laurette-phase6-inventory-')),file=join(folder,secret+'.db');mkdirSync(join(folder,'backups'));
  writeFileSync(join(folder,'backups',secret+'.db.before-v8.12345678.abcdef12.sqlite'),'synthetic NOT a database');
  writeFileSync(join(folder,'backups','unrelated.before-v8.12345678.abcdef12.sqlite'),'unrelated');
  mkdirSync(join(folder,'backups',secret+'.db.before-v7.12345678.abcdef13.sqlite'));
  const r=await backupInventory(file);assert.equal(r.state,'present');assert.equal(r.matchedFiles,1);assert.equal(r.scannedEntries,3);assert.equal(r.restoreVerified,false);assert.ok(r.latestBytes>0);assert.ok(!JSON.stringify(r).includes(secret));
  assert.equal((await backupInventory(':memory:')).state,'unavailable');
  const missing=mkdtempSync(join(tmpdir(),'laurette-phase6-empty-'));mkdirSync(join(missing,'backups'));assert.equal((await backupInventory(join(missing,'test.db'))).state,'missing');
});
test('phase6 directory inventory is bounded and reports truncation rather than a complete backup count',async()=>{
  const folder=mkdtempSync(join(tmpdir(),'laurette-phase6-bounded-'));mkdirSync(join(folder,'backups'));
  for(let i=0;i<255;i++)writeFileSync(join(folder,'backups',`irrelevant-${i}`),'synthetic');
  const r=await backupInventory(join(folder,'test.db'));assert.equal(r.scannedEntries,250);assert.equal(r.truncated,true);assert.equal(r.matchedFiles,0);
});
test('phase6 malformed scheduler metadata fails visibly without echoing private stored text',async()=>{
  db.prepare("INSERT OR REPLACE INTO meta(key,value) VALUES('operations.deadline-policy.v1',?)").run(secret);
  db.prepare("INSERT OR REPLACE INTO meta(key,value) VALUES('operations.deadline-health.v1',?)").run(JSON.stringify({at:secret,examined:secret,unroutable:-2,error:secret}));
  let payload;const c=ctx(owner);c.res.end=s=>payload=JSON.parse(s);await monitor()(c);
  assert.equal(payload.deadlines.policy.valid,false);assert.equal(payload.deadlines.lastRecordedCycle.at,null);assert.equal(payload.deadlines.lastRecordedCycle.examined,null);assert.equal(payload.deadlines.lastRecordedCycle.unroutable,null);assert.ok(!JSON.stringify(payload).includes(secret));
});
