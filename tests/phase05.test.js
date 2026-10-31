import { staffLogin } from "./helpers/staff-auth.mjs";
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, rmSync } from "node:fs";
import { randomBytes, createHmac } from "node:crypto";
import { createApp } from "../server.js";
import * as API from "../lib/api.js";
import { enqueueWhatsAppNotice, processWhatsAppOutbox } from '../lib/whatsapp.js';

const file = `data/test-phase05-${randomBytes(6).toString('hex')}.db`;
let app, base, admin, branch, department, staff, actor;
const password = "Phase05-Temporary-Password42";
async function api(path, { method = 'GET', cookie, body, origin = base, headers = {} } = {}) {
  const res = await fetch(base + path, { method, headers: {
    ...(cookie ? { cookie } : {}), ...(body ? { 'content-type': 'application/json' } : {}),
    ...(origin ? { origin } : {}), ...headers,
  }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, data: await res.json(), cookie: res.headers.get('set-cookie')?.split(';')[0] };
}
const changedPasswords = new Map();
async function login(username) {
  const result = await staffLogin(
    base,
    username,
    changedPasswords.get(username) || password,
  );
  changedPasswords.set(username, result.password);
  return result.cookie;
}
async function role(key, permissions, dataScope = 'branch', cookie = admin) {
  return api('/api/admin/roles', { method: 'POST', cookie,
    body: { roleKey: key, name: key, baseRole: 'agent', dataScope, permissions } });
}
before(async () => {
  const seed = JSON.parse(readFileSync('data/seed.json', 'utf8'));
  app = createApp({ dbFile: file, baseUrl: 'http://127.0.0.1:0', adminPassword: password,
    seed: { ...seed, users: seed.users.map(({ password: ignored, ...u }) => ({ ...u, mustChange: true })) } });
  const addr = await app.listen(0, '127.0.0.1'); base = `http://127.0.0.1:${addr.port}`;
  admin = await login(seed.users[0].username);
  branch = Number(app.db.prepare('SELECT id FROM branches ORDER BY id LIMIT 1').get().id);
  department = Number(app.db.prepare('SELECT id FROM departments WHERE branch_id IS NULL LIMIT 1').get().id);
  assert.equal((await role('phase05_staff', ['overview:read'])).status, 201);
  assert.equal((await role('phase05_manager', ['overview:read', 'users:write', 'organization:write'])).status, 201);
  for (const [username, roleKey] of [['phase05_actor', 'phase05_manager'], ['phase05_target', 'phase05_staff']]) {
    const created = await api('/api/admin/users', { method: 'POST', cookie: admin,
      body: { username, name: username, roleKey, branchId: branch, departmentId: department, password } });
    assert.equal(created.status, 201);
    if (username === 'phase05_target') staff = created.data.id;
  }
  actor = await login('phase05_actor');
});
after(async () => { await app?.close(); for (const suffix of ['', '-wal', '-shm']) rmSync(file + suffix, { force: true }); });

test('phase05: branch update succeeds and legacy/admin role escalation is denied atomically', async () => {
  assert.equal((await api(`/api/admin/users/${staff}`, { method: 'PATCH', cookie: actor, body: { name: 'Updated staff' } })).status, 200);
  const before = app.db.prepare('SELECT * FROM users WHERE id = ?').get(staff);
  for (const body of [{ role: 'admin' }, { roleKey: '' }, { roleKey: null }, { roleKey: 'admin' }, { role: 'manager' }]) {
    assert.equal((await api(`/api/admin/users/${staff}`, { method: 'PATCH', cookie: actor, body })).status, 403);
    assert.deepEqual(app.db.prepare('SELECT * FROM users WHERE id = ?').get(staff), before);
  }
  assert.equal((await api('/api/admin/users', { method: 'POST', cookie: actor,
    body: { username: 'phase05_backdoor', name: 'Backdoor', role: 'admin', branchId: branch, password } })).status, 403);
  assert.equal(app.db.prepare("SELECT count(*) n FROM users WHERE username='phase05_backdoor'").get().n, 0);
});

test('phase05: department update uses the correct alias and cannot escape its scope', async () => {
  assert.equal((await role('phase05_dept', ['overview:read', 'users:write'], 'department')).status, 201);
  const created = await api('/api/admin/users', { method: 'POST', cookie: admin,
    body: { username: 'phase05_dept_actor', name: 'Department actor', roleKey: 'phase05_dept', departmentId: department, branchId: branch, password } });
  assert.equal(created.status, 201);
  const deptActor = await login('phase05_dept_actor');
  assert.equal((await api(`/api/admin/users/${staff}`, { method: 'PATCH', cookie: deptActor, body: { name: 'Department updated' } })).status, 403);
  // A peer with an equally narrow role is editable.
  assert.equal((await api(`/api/admin/users/${staff}`, { method: 'PATCH', cookie: admin, body: { roleKey: 'phase05_dept' } })).status, 200);
  assert.equal((await api(`/api/admin/users/${staff}`, { method: 'PATCH', cookie: deptActor, body: { name: 'Department updated' } })).status, 200);
  assert.equal((await api(`/api/admin/users/${staff}`, { method: 'PATCH', cookie: deptActor, body: { departmentId: Number(app.db.prepare('SELECT id FROM departments WHERE id <> ? LIMIT 1').get(department).id) } })).status, 403);
});

test('phase05: users writer cannot reset or edit a more privileged account', async () => {
  const id = app.db.prepare("SELECT id FROM users WHERE role='admin' LIMIT 1").get().id;
  app.db.prepare('UPDATE users SET branch_id=? WHERE id=?').run(branch, id);
  admin = await login("laurette");
  for (const body of [{ password: 'Takeover-Password42' }, { active: false }, { name: 'Takeover' }]) {
    assert.equal((await api(`/api/admin/users/${id}`, { method: 'PATCH', cookie: actor, body })).status, 403);
  }
});

test('phase05: role grants remain a subset of the grantor permissions and scope', async () => {
  assert.equal((await role('phase05_allowed', ['overview:read'], 'assigned', actor)).status, 201);
  assert.equal((await role('phase05_excess', ['settings:write'], 'assigned', actor)).status, 403);
  assert.equal((await role('phase05_wide', ['overview:read'], 'organization', actor)).status, 403);
  assert.equal((await api('/api/admin/roles/phase05_allowed', { method: 'PATCH', cookie: actor,
    body: { permissions: ['settings:write'] } })).status, 403);
  assert.equal((await role('phase05_org_actor', ['organization:write'], 'organization')).status, 201);
  const created = await api('/api/admin/users', { method: 'POST', cookie: admin,
    body: { username: 'phase05_org', name: 'Organization actor', roleKey: 'phase05_org_actor', password } });
  assert.equal(created.status, 201);
  const orgActor = await login('phase05_org');
  assert.equal((await api('/api/admin/roles/phase05_allowed', { method: 'PATCH', cookie: orgActor,
    body: { permissions: ['settings:write'] } })).status, 403);
});

test('phase05: exact CSRF origin required even with fetch header', async () => {
  for (const origin of [null, 'null', 'https://evil.example', base.replace('://', '://evil'), `${base}/path`, `${base}@evil.example`]) {
    assert.equal((await api('/api/recommend', { method: 'POST', body: {}, origin,
      headers: { 'x-requested-with': 'fetch' } })).status, 403, String(origin));
  }
  assert.equal((await api('/api/recommend', { method: 'POST', body: {} })).status, 200);
});

test('phase05: signed WhatsApp callback works without Origin and rejects invalid HMAC', async () => {
  const previous = process.env.WHATSAPP_APP_SECRET; process.env.WHATSAPP_APP_SECRET = 'phase05-test-secret';
  try {
    const raw = '{}';
    const signature = 'sha256=' + createHmac('sha256', process.env.WHATSAPP_APP_SECRET).update(raw).digest('hex');
    assert.equal((await api('/api/whatsapp/webhook', { method: 'POST', body: {}, origin: null,
      headers: { 'x-hub-signature-256': signature } })).status, 200);
    assert.equal((await api('/api/whatsapp/webhook', { method: 'POST', body: {}, origin: null,
      headers: { 'x-hub-signature-256': 'sha256=invalid' } })).status, 401);
  } finally { if (previous === undefined) delete process.env.WHATSAPP_APP_SECRET; else process.env.WHATSAPP_APP_SECRET = previous; }
});

test('phase05: outbox coexists with n8n, deduplicates, retries and delivers via mocked transport', async (t) => {
  const env = { WHATSAPP_NOTIFICATIONS_ENABLED: '1', WHATSAPP_ACCESS_TOKEN: 'test', WHATSAPP_PHONE_NUMBER_ID: '123',
    WHATSAPP_APP_SECRET: 'test', WHATSAPP_VERIFY_TOKEN: 'test', WHATSAPP_TEMPLATE_REQUEST_RECEIVED: 'received', WHATSAPP_TEMPLATE_REQUEST_STATUS: 'status' };
  const previous = Object.fromEntries(Object.keys(env).map(k => [k, process.env[k]])); Object.assign(process.env, env);
  try {
    const made = await api('/api/requests', { method: 'POST', body: { type: 'consult', topic: 'general', name: 'Synthetic client', phone: '0790009999', message: 'Synthetic migration verification', consent: true, whatsappUpdates: true } });
    assert.equal(made.status, 201);
    const row = app.db.prepare('SELECT id FROM requests WHERE reference=?').get(made.data.reference);
    enqueueWhatsAppNotice(app.db, row.id, 'received', base);
    enqueueWhatsAppNotice(app.db, row.id, 'received', base);
    assert.equal(app.db.prepare('SELECT count(*) n FROM whatsapp_outbox WHERE request_id=?').get(row.id).n, 1);
    const mocked = t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ error: { code: 503 } }), { status: 503 }));
    assert.equal(await processWhatsAppOutbox(app.db), 1);
    let notice = app.db.prepare('SELECT * FROM whatsapp_outbox WHERE request_id=?').get(row.id);
    assert.equal(notice.state, 'pending'); assert.equal(notice.attempts, 1);
    app.db.prepare("UPDATE whatsapp_outbox SET next_attempt_at='2000-01-01' WHERE id=?").run(notice.id);
    mocked.mock.mockImplementation(async () => new Response(JSON.stringify({ messages: [{ id: 'synthetic-message' }] }), { status: 200 }));
    assert.equal(await processWhatsAppOutbox(app.db), 1);
    notice = app.db.prepare('SELECT * FROM whatsapp_outbox WHERE request_id=?').get(row.id);
    assert.equal(notice.state, 'sent'); assert.equal(notice.attempts, 2);
    assert.ok(app.db.prepare("SELECT name FROM sqlite_master WHERE name='webhook_deliveries'").get());
  } finally { for (const [k,v] of Object.entries(previous)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
});

test('phase05: all statically registered API handlers exist; organization and transfer routes respond', async () => {
  const source = readFileSync('server.js','utf8');
  const handlers = [...source.matchAll(/\bAPI\.([A-Za-z0-9_]+)/g)].map(match => match[1]);
  for (const name of new Set(handlers)) assert.equal(typeof API[name], 'function', name);
  for (const path of ['/api/admin/organization','/api/admin/transfers']) assert.equal((await api(path,{cookie:admin})).status,200,path);
 });
