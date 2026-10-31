import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createApp } from "../server.js";
import { createSession, hashPassword } from '../lib/auth.js';
import { withApiAuthorization } from '../lib/api-authorization.js';

let app, db, base, branches, departments, admin, none, temporary, receiver, branchActor;
const now = "2026-10-31T00:00:00.000Z";
const permissions = [
  "requests:transfer",
  "requests:assign",
  "requests:approve",
  "requests:read",
  "requests:write",
  "customers:read",
  "overview:read",
];
const hash = hashPassword("Synthetic-Phase1a-Password42");
let counter = 0;
function actor(
  scope,
  { branch=branches[0], department=departments[0], perms=permissions, legacy, mustChange=false }={},
) {
  const username = `phase1a_${++counter}`;
  const key = legacy ? null : username;
  if(key) db.prepare('INSERT INTO role_definitions (role_key,name,base_role,data_scope,permissions,created_at,updated_at) VALUES (?,?,?,?,?,?,?)').run(key,key,'agent',scope,JSON.stringify(perms),now,now);
  const id=Number(db.prepare('INSERT INTO users (username,name,role,role_key,branch_id,department_id,password_hash,password_salt,must_change,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)').run(username,username,legacy||'agent',key,branch,department,hash.hash,hash.salt,Number(mustChange),now).lastInsertRowid);
  return {
    id,
    cookie:
      "lt_session=" +
      createSession(db, id, "127.0.0.1", "test", { mfaVerified: true }).token,
    branch,
    department,
    key,
  };
}
function customer() { return Number(db.prepare('INSERT INTO customers (name,phone,created_at,updated_at) VALUES (?,?,?,?)').run('Synthetic customer',`+96279${String(++counter).padStart(7,'0')}`,now,now).lastInsertRowid); }
function request(owner, { branch=owner.branch, department=owner.department, customerId=customer(), ownerField='assigned_to' }={}) {
  const id=Number(db.prepare('INSERT INTO requests (reference,type,customer_id,branch_id,department_id,payload,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)').run(`SYNTHETIC-${++counter}`,'flight',customerId,branch,department,'{}',now,now).lastInsertRowid);
  db.prepare(`UPDATE requests SET ${ownerField}=? WHERE id=?`).run(owner.id,id);
  return {id,customerId};
}
function transfer(row) { return Number(db.prepare('INSERT INTO request_transfers (request_id,from_branch_id,to_branch_id,to_department_id,to_user_id,created_at) VALUES (?,?,?,?,?,?)').run(row.id,branches[0],receiver.branch,receiver.department,receiver.id,now).lastInsertRowid); }
function snapshot() {return JSON.stringify(Object.fromEntries(['requests','request_events','request_transfers','request_owner_history','audit_log','customers','webhook_deliveries'].map(t=>[t,db.prepare(`SELECT * FROM ${t} ORDER BY id`).all()])));}
async function call(path,{method='GET',cookie,body}={}) {
  const res=await fetch(base+path,{method,headers:{origin:base,'content-type':'application/json',...(cookie?{cookie}:{})},body:body?JSON.stringify(body):undefined});
  return {status:res.status,data:await res.json()};
}
before(async()=>{
  const seed=JSON.parse(readFileSync('data/seed.json','utf8'));
  app=createApp({dbFile:':memory:',baseUrl:'http://127.0.0.1:0',adminPassword:'Synthetic-Phase1a-Password42',seed:{...seed,users:[]},sendVerificationEmail:async()=>{}});
  db=app.db;const addr=await app.listen(0,'127.0.0.1');base=`http://127.0.0.1:${addr.port}`;
  branches=db.prepare('SELECT id FROM branches ORDER BY id').all().map(x=>x.id);
  departments=db.prepare('SELECT id FROM departments WHERE branch_id IS NULL ORDER BY id LIMIT 2').all().map(x=>x.id);
  admin=actor('organization',{legacy:'admin'});
  none=actor('branch',{perms:[]});temporary=actor('organization',{legacy:'admin',mustChange:true});
  receiver=actor('assigned',{branch:branches[1],department:departments[0]});
  branchActor=actor('branch');
});
after(async () => {
  await app?.close();
});

for(const scope of ['branch','department','assigned']) test(`phase1a SQL: ${scope} can update, transfer and read its customer; outside records remain unchanged`,async()=>{
  const user=actor(scope), own=request(user);
  const outsider=actor('assigned',{branch:branches[1],department:departments[1]}), outside=request(outsider);
  // A shared customer must not expose their other branch/department/owner's requests.
  const shared=request(outsider,{customerId:own.customerId});
  assert.equal((await call(`/api/admin/requests/${own.id}`,{method:'PATCH',cookie:user.cookie,body:{note:'Synthetic operational note'}})).status,200);
  const customerResult=await call(`/api/admin/customers/${own.customerId}`,{cookie:user.cookie});
  assert.equal(customerResult.status,200);
  assert.deepEqual(customerResult.data.requests.map(r=>r.id),[own.id]);
  assert.ok(!customerResult.data.requests.some(r=>r.id===shared.id));
  const before=snapshot();
  for(const [method,path,body] of [
    ['PATCH',`/api/admin/requests/${outside.id}`,{note:'must not persist'}],
    ['POST',`/api/admin/requests/${outside.id}/transfers`,{branchId:receiver.branch,departmentId:receiver.department,userId:receiver.id}],
    ['GET',`/api/admin/customers/${outside.customerId}`,undefined],
  ]) assert.equal((await call(path,{method,cookie:user.cookie,body})).status,404,`${scope}: ${path}`);
  assert.equal(snapshot(),before);
  const created=await call(`/api/admin/requests/${own.id}/transfers`,{method:'POST',cookie:user.cookie,body:{branchId:receiver.branch,departmentId:receiver.department,userId:receiver.id}});
  assert.equal(created.status,201);
  assert.equal(db.prepare('SELECT assigned_to FROM requests WHERE id=?').get(own.id).assigned_to,user.id);
});

test('phase1a assigned scope supports all four existing owner fields without broadening customer visibility',async()=>{
  const user=actor('assigned');
  for(const ownerField of ['assigned_to','sales_owner_id','service_owner_id','execution_owner_id']) {
    const own=request(user,{ownerField});
    assert.equal((await call(`/api/admin/requests/${own.id}`,{method:'PATCH',cookie:user.cookie,body:{note:'Owner access'}})).status,200,ownerField);
    assert.equal((await call(`/api/admin/customers/${own.customerId}`,{cookie:user.cookie})).status,200,ownerField);
  }
});

test('phase1a legacy administrator still updates requests, reads customers and creates transfers',async()=>{
  const own=request(branchActor);
  assert.equal((await call(`/api/admin/requests/${own.id}`,{method:'PATCH',cookie:admin.cookie,body:{note:'Administrator'}})).status,200);
  assert.equal((await call(`/api/admin/customers/${own.customerId}`,{cookie:admin.cookie})).status,200);
  assert.equal((await call(`/api/admin/requests/${own.id}/transfers`,{method:'POST',cookie:admin.cookie,body:{branchId:receiver.branch,departmentId:receiver.department,userId:receiver.id}})).status,201);
});

test('phase1a missing scope never defaults to global record access', async () => {
  const own = request(branchActor);
  for (const [scope, opts] of [['branch',{branch:null}],['department',{department:null}],['assigned',{}]]) {
    const user = actor(scope, opts);
    for (const [method, path, body] of [['PATCH',`/api/admin/requests/${own.id}`,{note:'denied'}],['POST',`/api/admin/requests/${own.id}/transfers`,{}],['GET',`/api/admin/customers/${own.customerId}`]])
      assert.equal(
        (await call(path, { method, cookie: user.cookie, body })).status,
        scope === "assigned" ? 404 : 401,
      );
  }
});

for(const scope of ['department','assigned','branch']) test(`phase1a transfer: ${scope} cannot accept or reject from the wrong branch`,async()=>{
  const wrong=actor(scope,{branch:branches[0],department:receiver.department});
  const own=request(branchActor), id=transfer(own);
  // Even a named recipient must still belong to the destination branch at decision time.
  if(scope==='assigned') db.prepare('UPDATE request_transfers SET to_user_id=? WHERE id=?').run(wrong.id,id);
  for(const decision of ['accept','reject']) {
    const before=snapshot();
    const res=await call(`/api/admin/transfers/${id}/respond`,{method:'POST',cookie:wrong.cookie,body:{decision}});
    assert.equal(res.status,403);assert.equal(snapshot(),before);
  }
});

test('phase1a transfer: intended recipient can accept once; duplicate response does not write',async()=>{
  const own=request(branchActor), id=transfer(own);
  const result=await call(`/api/admin/transfers/${id}/respond`,{method:'POST',cookie:receiver.cookie,body:{decision:'accept'}});
  assert.equal(result.status,200);
  const row=db.prepare('SELECT branch_id,department_id,assigned_to FROM requests WHERE id=?').get(own.id);
  assert.deepEqual({...row},{branch_id:receiver.branch,department_id:receiver.department,assigned_to:receiver.id});
  const before=snapshot();
  assert.equal((await call(`/api/admin/transfers/${id}/respond`,{method:'POST',cookie:receiver.cookie,body:{decision:'accept'}})).status,409);
  assert.equal(snapshot(),before);
});

test('phase1a transfer: recipient moved to another department cannot accept its stale invitation',async()=>{
  const moved=actor('assigned',{branch:receiver.branch,department:departments[1]});
  const own=request(branchActor),id=transfer(own);db.prepare('UPDATE request_transfers SET to_user_id=? WHERE id=?').run(moved.id,id);
  const before=snapshot();
  assert.equal((await call(`/api/admin/transfers/${id}/respond`,{method:'POST',cookie:moved.cookie,body:{decision:'accept'}})).status,403);
  assert.equal(snapshot(),before);
});

test('phase1a transfer: destination managers and global legacy administrators retain accept/reject authority',async()=>{
  for(const user of [actor('department',{branch:receiver.branch,department:receiver.department}),actor('branch',{branch:receiver.branch,department:departments[1]}),admin,actor('organization',{legacy:'manager'})]) {
    const own=request(branchActor), id=transfer(own);
    assert.equal((await call(`/api/admin/transfers/${id}/respond`,{method:'POST',cookie:user.cookie,body:{decision:'reject'}})).status,200);
    assert.equal(db.prepare('SELECT assigned_to FROM requests WHERE id=?').get(own.id).assigned_to,branchActor.id);
  }
});

test('phase1a n8n: overview and scoped settings writers cannot read global delivery data',async()=>{
  db.prepare("INSERT INTO webhook_deliveries (reference,event,status,created_at) VALUES ('SYNTHETIC-OTHER-BRANCH','booking.created','delivered',?)").run(now);
  const scopedSettings=actor('branch',{perms:['settings:write']});
  const orgOverview=actor('organization',{perms:['overview:read']});
  for(const user of [branchActor,scopedSettings,orgOverview,actor('organization',{legacy:'manager'})]) {
    const res=await call('/api/admin/webhooks',{cookie:user.cookie});assert.equal(res.status,403);
    for(const field of ['deliveries','target','summary','configured']) assert.equal(field in res.data,false);
  }
  for(const user of [admin,actor('organization',{perms:['settings:write']})]) {
    const res=await call('/api/admin/webhooks',{cookie:user.cookie});assert.equal(res.status,200);
    assert.ok(res.data.deliveries.some(r=>r.reference==='SYNTHETIC-OTHER-BRANCH'));
  }
});

test('phase1a n8n: configuration matches outbound HMAC and header-key modes without exposing secrets',async()=>{
  const keys=['N8N_BOOKING_WEBHOOK_URL','N8N_WEBHOOK_URL','N8N_BOOKING_WEBHOOK_SECRET','N8N_API_KEY','N8N_WEBHOOK_KEY'];
  const previous=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
  try {
    for(const key of keys) delete process.env[key];
    for(const [urlKey,authKey] of [['N8N_BOOKING_WEBHOOK_URL','N8N_BOOKING_WEBHOOK_SECRET'],['N8N_WEBHOOK_URL','N8N_WEBHOOK_KEY'],['N8N_BOOKING_WEBHOOK_URL','N8N_API_KEY']]) {
      for(const key of keys) delete process.env[key];
      process.env[urlKey]='https://example.invalid/hook?secret=hidden-query';process.env[authKey]='synthetic-secret-do-not-expose';
      const res=await call('/api/admin/webhooks',{cookie:admin.cookie});assert.equal(res.status,200);assert.equal(res.data.configured,true);
      assert.equal(res.data.target,'example.invalid/hook');
      assert.ok(!JSON.stringify(res.data).includes('synthetic-secret-do-not-expose'));assert.ok(!JSON.stringify(res.data).includes('hidden-query'));
    }
    process.env.N8N_BOOKING_WEBHOOK_URL='not a URL';
    assert.equal((await call('/api/admin/webhooks',{cookie:admin.cookie})).status,200);
  } finally {for(const [k,v] of Object.entries(previous)){if(v===undefined) delete process.env[k];else process.env[k]=v;}}
});

test('phase1a route matrix: every employee route, including generated resources, enforces auth, permission and must_change',async()=>{
  const routes=app.routeManifest.filter(r=>r.pattern.startsWith('/api/admin/'));
  assert.ok(routes.length>=60);
  const before=snapshot();
  let cases=0;
  for(const route of routes) {
    assert.ok(route.action,`Unprotected employee route ${route.method} ${route.pattern}`);
    const path=route.pattern.replace(/:[A-Za-z]+/g,'999999');
    for(const [user,expected] of [[null,401],[none,403],[temporary,403]]) {
      const result=await call(path,{method:route.method,cookie:user?.cookie,body:route.method==='GET'?undefined:{}});
      assert.equal(result.status,expected,`${route.method} ${path}`);cases++;
    }
  }
  assert.equal(snapshot(),before);
  console.log(`PHASE1A ROUTE MATRIX: ${routes.length} routes x 3 callers = ${cases} denials; no business writes`);
});

test('phase1a central authorization denies before a handler even if that handler omits its own check',()=>{
  let hits=0;
  const res=()=>({status:null,writeHead(code){this.status=code;},end(){}});
  const action='requests:write', guarded=withApiAuthorization(()=>{hits++;},{action});
  for(const [user,expected] of [[null,401],[{role:'agent',permissions:[]},403],[{role:'admin',mustChange:true},403]]) {
    const response=res();guarded({user,res:response});assert.equal(response.status,expected);
  }
  assert.equal(hits,0);
  guarded({user:{role:'agent',permissions:[action]},res:res()});assert.equal(hits,1);
  // Changing a temporary password and public APIs remain reachable by their intended callers.
  withApiAuthorization(()=>hits++,{auth:true})({user:{mustChange:true},res:res()});
  withApiAuthorization(()=>hits++)({user:null,res:res()});assert.equal(hits,3);
});

test('phase1a capability matrix: every route action is enforced for all built-in and legacy roles', () => {
  const routes=app.routeManifest.filter(r=>r.pattern.startsWith('/api/admin/'));
  const roles=db.prepare("SELECT role_key,permissions FROM role_definitions WHERE role_key IN ('admin','branch_manager','department_manager','sales_agent','service_agent') ORDER BY role_key").all().map(r=>({name:r.role_key,user:{role:'agent',permissions:JSON.parse(r.permissions)}}));
  const legacy={admin:['*'],manager:['requests:read','requests:write','customers:read','customers:write','programs:read','programs:write','content:write','visa:write','kb:write','audit:read','overview:read','reports:read'],agent:['requests:read','requests:write','customers:read','customers:write','programs:read','overview:read','kb:write']};
  for(const [role,grants] of Object.entries(legacy)) roles.push({name:'legacy '+role,user:{role},grants});
  let cases = 0;
  for (const role of roles)
    for (const route of routes) {
      let called = false,
        status = null;
      withApiAuthorization(()=>{called=true;},{action:route.action})({user:role.user,res:{writeHead(code){status=code;},end(){}}});
      const grants = role.grants || role.user.permissions;
      const compatibility = {
        "tasks:read":"requests:read", "tasks:write":"requests:write", "tasks:assign":"requests:write",
        "requests:assign": "requests:write",
        "requests:transfer": "requests:write",
        "requests:approve": "requests:write",
        "reports:export": "reports:read",
        "programs:delete": "programs:write",
        "content:delete": "content:write",
        "visa:delete": "visa:write",
        "kb:delete": "kb:write",
      };
      const allowed =
        grants.includes("*") ||
        grants.includes(route.action) ||
        Boolean(role.grants && grants.includes(compatibility[route.action]));
      assert.equal(called,allowed,role.name+' '+route.method+' '+route.pattern);
      if (!allowed) assert.equal(status, 403);
      cases++;
    }
  assert.equal(roles.length, 8);
  console.log('PHASE1A CAPABILITY MATRIX: '+roles.length+' roles x '+routes.length+' routes = '+cases+' decisions');
});
