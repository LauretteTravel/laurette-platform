import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { createApp } from '../server.js';
import { openDb } from '../lib/db.js';
import { createSession, hashPassword } from '../lib/auth.js';

let app,db,base,branches,departments,owner,manager,other,next=0,closed=false;
const file=`data/phase1b-testing/followups-${randomBytes(5).toString('hex')}.db`;
const hashed=hashPassword('Synthetic-FollowUp-Password42');
function actor(scope='assigned',{branch=branches[0],department=departments[0],assign=false}={}) {
  const key=`follow_${++next}`;
  db.prepare('INSERT INTO role_definitions(role_key,name,base_role,data_scope,permissions,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run(key,key,'agent',scope,JSON.stringify(['requests:read','requests:write',...(assign?['requests:assign']:[])]),new Date().toISOString(),new Date().toISOString());
  const id=Number(db.prepare('INSERT INTO users(username,name,role,role_key,branch_id,department_id,password_hash,password_salt,created_at) VALUES(?,?,?,?,?,?,?,?,?)').run(key,key,'agent',key,branch,department,hashed.hash,hashed.salt,new Date().toISOString()).lastInsertRowid);
  return {id,cookie:'lt_session='+createSession(db,id,'127.0.0.1','test',{mfaVerified:true}).token,branch,department};
}
function request(user=owner,{assigned=user.id,branch=user.branch,department=user.department}={}) {
  return Number(db.prepare('INSERT INTO requests(reference,type,branch_id,department_id,assigned_to,payload,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').run(`FOLLOW-TEST-${++next}`,'flight',branch,department,assigned,'{}',new Date().toISOString(),new Date().toISOString()).lastInsertRowid);
}
async function call(path,{user=owner,body,method=body?'POST':'GET',origin}={}) {
  const res=await fetch(base+path,{method,headers:{origin:origin||base,'content-type':'application/json',cookie:user.cookie},body:body?JSON.stringify(body):undefined});
  return {status:res.status,data:await res.json()};
}
const create=(id,body={},user=owner)=>call(`/api/admin/requests/${id}/follow-ups`,{user,body:{note:'متابعة عميل تجريبية',dueAt:new Date(Date.now()+3600000).toISOString(),...body}});
const snapshot=()=>JSON.stringify(['request_follow_ups','request_events','audit_log'].map(t=>db.prepare(`SELECT * FROM ${t}`).all()));
before(async()=>{
  const seed=JSON.parse(readFileSync('data/seed.json','utf8'));
  app=createApp({dbFile:file,seed:{...seed,users:[]},adminPassword:'Synthetic-FollowUp-Password42',baseUrl:'http://127.0.0.1:0'});db=app.db;
  branches=db.prepare('SELECT id FROM branches ORDER BY id').all().map(r=>r.id);
  departments=db.prepare('SELECT id FROM departments WHERE branch_id IS NULL ORDER BY id LIMIT 2').all().map(r=>r.id);
  const addr=await app.listen(0,'127.0.0.1');base=`http://127.0.0.1:${addr.port}`;
  owner=actor();manager=actor('branch',{assign:true});other=actor('assigned',{branch:branches[1]});
});
after(async()=>{if(!closed)await app?.close();});
beforeEach(()=>app.limiter.reset());

test('2A follow-ups persist normalized deadlines and internal audit without customer exposure',async()=>{
  const id=request(); const result=await create(id,{dueAt:'2026-11-02T10:30:00+03:00',note:'<script>internal only</script>'});assert.equal(result.status,201);
  const row=db.prepare('SELECT * FROM request_follow_ups WHERE id=?').get(result.data.id);
  assert.equal(row.due_at,'2026-11-02T07:30:00.000Z');assert.equal(row.assigned_to,owner.id);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM request_events WHERE request_id=? AND kind='follow_up'").get(id).n,1);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM audit_log WHERE entity_id=? AND action='follow-up.create'").get(String(row.id)).n,1);
  assert.equal((await call(`/api/admin/requests/${id}/follow-ups?status=all`)).data.followUps[0].note,'<script>internal only</script>');
  assert.equal((await call('/api/admin/follow-ups')).data.followUps.some(r=>r.id===row.id),true);
});

test('2A all follow-up routes enforce current request ownership, branch and department',async()=>{
  const foreign=request(other);const f=(await create(foreign,{},other)).data.id;
  const before=snapshot();
  assert.equal((await create(foreign)).status,404);
  assert.equal((await call(`/api/admin/requests/${foreign}/follow-ups`)).status,404);
  assert.equal((await call(`/api/admin/follow-ups/${f}/finish`,{body:{status:'done',reason:'not allowed'}})).status,404);
  assert.equal((await call('/api/admin/follow-ups?assigned=team')).data.followUps.some(r=>r.id===f),false);
  assert.equal(snapshot(),before);
  const own=request();const follow=(await create(own)).data.id;
  db.prepare('UPDATE requests SET assigned_to=? WHERE id=?').run(other.id,own);
  assert.equal((await call('/api/admin/follow-ups?status=all')).data.followUps.some(r=>r.id===follow),false);
  assert.equal((await call(`/api/admin/follow-ups/${follow}/finish`,{body:{status:'done',reason:'lost ownership'}})).status,404);
  const deptActor=actor('department');const otherDept=actor('assigned',{department:departments[1]});
  assert.equal((await call(`/api/admin/requests/${request(otherDept)}/follow-ups`,{user:deptActor})).status,404);
  assert.equal((await call(`/api/admin/requests/${foreign}/follow-ups`,{user:manager})).status,404);
});

test('2A assignment requires capability and existing recipient access; never grants request access',async()=>{
  const id=request(); const sameBranch=actor('branch');const assignedOnly=actor();
  let before=snapshot();assert.equal((await create(id,{assignedTo:sameBranch.id})).status,422);assert.equal(snapshot(),before);
  assert.equal((await create(id,{assignedTo:other.id},manager)).status,422);
  assert.equal((await create(id,{assignedTo:assignedOnly.id},manager)).status,422);
  assert.equal((await create(id,{assignedTo:sameBranch.id},manager)).status,201);
  db.prepare('UPDATE users SET active=0 WHERE id=?').run(sameBranch.id);
  before=snapshot();assert.equal((await create(id,{assignedTo:sameBranch.id},manager)).status,422);assert.equal(snapshot(),before);
});

test('2A finishing needs assignee or assignment power, mandatory outcome, and cannot replay writes',async()=>{
  const id=request();const f=(await create(id)).data.id;
  const branchReader=actor('branch');let before=snapshot();
  assert.equal((await call(`/api/admin/follow-ups/${f}/finish`,{user:branchReader,body:{status:'done',reason:'No authority'}})).status,403);
  assert.equal((await call(`/api/admin/follow-ups/${f}/finish`,{body:{status:'done',reason:''}})).status,422);
  assert.equal(snapshot(),before);
  assert.equal((await call(`/api/admin/follow-ups/${f}/finish`,{body:{status:'done',reason:'تم التواصل والاتفاق على الموعد'}})).status,200);
  assert.equal(db.prepare('SELECT completed_by FROM request_follow_ups WHERE id=?').get(f).completed_by,owner.id);
  before=snapshot();assert.equal((await call(`/api/admin/follow-ups/${f}/finish`,{body:{status:'cancelled',reason:'Replay attempt'}})).status,409);assert.equal(snapshot(),before);
  const second=(await create(id)).data.id;
  assert.equal((await call(`/api/admin/follow-ups/${second}/finish`,{user:manager,body:{status:'cancelled',reason:'طلب العميل إلغاء المتابعة'}})).status,200);
});

test('2A invalid dates and CSRF leave follow-ups, events and audit unchanged',async()=>{
  const id=request();const before=snapshot();
  for(const dueAt of ['2026-02-30T10:00:00Z','2026-13-01T10:00:00Z','2026-11-02T10:00','not-a-date'])assert.equal((await create(id,{dueAt})).status,422,dueAt);
  for(const note of ['', 'ab','x'.repeat(2001)])assert.equal((await create(id,{note})).status,422);
  assert.equal((await call(`/api/admin/requests/${id}/follow-ups`,{origin:'https://outside.invalid',body:{note:'CSRF attempt',dueAt:new Date().toISOString()}})).status,403);
  assert.equal(snapshot(),before);
});

test('2A personal/team due filters and pagination use actual deadlines and request scope',async()=>{
  const user=actor();const id=request(user);
  for(let i=0;i<27;i++)db.prepare('INSERT INTO request_follow_ups(request_id,assigned_to,due_at,note,created_at) VALUES(?,?,?,?,?)').run(id,user.id,new Date(Date.now()-3600000+i).toISOString(),`Overdue ${i}`,new Date().toISOString());
  const first=await call('/api/admin/follow-ups?due=overdue',{user});assert.equal(first.data.total,27);assert.equal(first.data.followUps.length,25);assert.equal(first.data.followUps.every(f=>f.overdue===1),true);
  const second=await call('/api/admin/follow-ups?due=overdue&page=2',{user});assert.equal(second.data.followUps.length,2);assert.equal(second.data.followUps.some(f=>first.data.followUps.some(a=>a.id===f.id)),false);
  assert.equal((await call('/api/admin/follow-ups?due=next24h',{user})).data.total,0);
  assert.equal((await create(id,{},user)).status,201);assert.equal((await call('/api/admin/follow-ups?due=next24h',{user})).data.total,1);
  assert.equal((await call('/api/admin/follow-ups?assigned=team',{user})).data.total,28);
  assert.equal((await call('/api/admin/follow-ups?status=invalid',{user})).status,422);
});

test('2A unassigned inbox keeps branch and owner restrictions',async()=>{
  const visible=request(manager,{assigned:null});const foreign=request(other,{assigned:null});const assigned=request(manager);
  const data=(await call('/api/admin/requests?assigned=unassigned',{user:manager})).data;
  assert.equal(data.requests.some(r=>r.id===visible),true);assert.equal(data.requests.some(r=>r.id===foreign||r.id===assigned),false);
  assert.equal((await call('/api/admin/requests?assigned=unassigned',{user:owner})).data.requests.length,0);
});

test('2A follow-ups survive restart without migrations or rewriting identity ledger',async()=>{
  const rows=db.prepare('SELECT * FROM request_follow_ups ORDER BY id').all();const ledger=db.prepare('SELECT * FROM schema_migrations ORDER BY version').all();
  await app.close();closed=true;
  const reopened=openDb(file);
  try {assert.deepEqual(reopened.prepare('SELECT * FROM request_follow_ups ORDER BY id').all(),rows);assert.deepEqual(reopened.prepare('SELECT * FROM schema_migrations ORDER BY version').all(),ledger);assert.equal(reopened.prepare('PRAGMA integrity_check').get().integrity_check,'ok');assert.equal(reopened.migrationBackups.length,0);}
  finally {reopened.close();}
});
