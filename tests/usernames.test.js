import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createApp } from '../server.js';
import { normalizeUsername, validUsername } from '../lib/usernames.js';

test('staff usernames accept Arabic and preserve ASCII rules with canonical normalization', () => {
  for (const value of ['أحمد_01', 'موظف.١٢', 'agent-01', 'ABC', 'a'.repeat(32), '---']) {
    assert.equal(validUsername(normalizeUsername(value)), true, value);
  }
  assert.equal(normalizeUsername('  AHMAD_01  '), 'ahmad_01');
  assert.equal(normalizeUsername('ا\u0654حمد'), 'أحمد');
  for (const value of ['ab', 'a'.repeat(33), 'أ حمد', 'أحمد\u200d', 'abc\u202e', 'abc😀', 'аbc', "a'b", '\u064e\u064e\u064e']) {
    assert.equal(validUsername(normalizeUsername(value)), false, value);
  }
});

test('Arabic employee creation, normalized duplicate detection, login and password-change gate', async () => {
  const seed = JSON.parse(readFileSync('data/seed.json', 'utf8'));
  const password = 'Synthetic-Username-Test42';
  const app = createApp({ dbFile: ':memory:', seed: { ...seed, users: seed.users.map(({ password, ...u }) => u) }, adminPassword: password, baseUrl: 'http://127.0.0.1:0' });
  try {
    const addr = await app.listen(0, '127.0.0.1');
    const base = `http://127.0.0.1:${addr.port}`;
    const call = async (path, body, cookie) => {
      const res = await fetch(base + path, { method: body ? 'POST' : 'GET', headers: { origin: base, 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
      return { status: res.status, data: await res.json(), cookie: (res.headers.get('set-cookie') || '').split(';')[0] };
    };
    let admin = await call('/api/auth/login', { username: seed.users[0].username, password });
    assert.equal(admin.status, 200);
    if (admin.data.user.mustChange) {
      assert.equal((await call('/api/auth/change-password', { currentPassword: password, newPassword: password + '-Changed42' }, admin.cookie)).status, 200);
      admin = await call('/api/auth/login', { username: seed.users[0].username.toUpperCase(), password: password + '-Changed42' });
    }
    assert.equal(admin.status, 200);
    const employee = { username: '  أحمد_01  ', name: 'موظف تجريبي', role: 'agent', password };
    assert.equal((await call('/api/admin/users', employee, admin.cookie)).status, 201);
    assert.equal((await call('/api/admin/users', { ...employee, username: 'ا\u0654حمد_01' }, admin.cookie)).status, 409);
    assert.equal((await call('/api/admin/users', { ...employee, username: 'أحمد\u202e' }, admin.cookie)).status, 422);
    const login = await call('/api/auth/login', { username: ' ا\u0654حمد_01 ', password });
    assert.equal(login.status, 200);
    assert.equal(login.data.user.mustChange, true);
    assert.equal((await call('/api/admin/overview', null, login.cookie)).status, 403);
    assert.equal((await call('/api/auth/change-password', { currentPassword: password, newPassword: password + '-Changed42' }, login.cookie)).status, 200);
    assert.equal((await call('/api/admin/overview', null, login.cookie)).status, 401);
    assert.equal((await call('/api/auth/login', { username: 'أحمد_01', password: password + '-Changed42' })).status, 200);
  } finally { await app.close(); }
});
