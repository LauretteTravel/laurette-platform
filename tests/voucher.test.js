import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync, readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { createApp } from '../server.js';

const DB = `data/test-voucher-${randomBytes(4).toString('hex')}.db`;
const seed = JSON.parse(readFileSync('data/seed.json', 'utf8'));
const testSeed = { ...seed, users: seed.users.map(({ password, ...user }) => user) };
let app;
let base;

before(async () => {
  for (const suffix of ['', '-wal', '-shm']) { try { rmSync(DB + suffix); } catch { /* ignore */ } }
  app = createApp({ dbFile: DB, baseUrl: 'http://127.0.0.1:0', seed: testSeed, adminPassword: 'Test-Only-Admin-Password-42' });
  const addr = await app.listen(0, '127.0.0.1');
  base = `http://127.0.0.1:${addr.port}`;
});

after(async () => {
  await app.close();
  for (const suffix of ['', '-wal', '-shm']) { try { rmSync(DB + suffix); } catch { /* ignore */ } }
});

const get = async (path) => {
  const res = await fetch(`${base}${path}`, { redirect: 'manual' });
  return { res, body: await res.text() };
};

test('إعدادات العلامة العامة متاحة للقسيمة دون تسجيل دخول', async () => {
  const { res, body } = await get('/api/settings');
  assert.equal(res.status, 200);
  const data = JSON.parse(body);
  assert.equal(data.ok, true);
  assert.ok(data.settings.brand);
  assert.ok(data.settings.brandShort);
  assert.ok(Array.isArray(data.settings.branches));
  assert.ok(!('adminPassword' in data.settings));
});

test('ملفات القسيمة والمكتبات تُخدَم محليًا', async () => {
  for (const path of ['/assets/js/voucher-generator.js', '/assets/css/voucher.css', '/assets/vendor/jspdf.umd.min.js', '/assets/vendor/html2canvas.min.js']) {
    const { res } = await get(path);
    assert.equal(res.status, 200, path);
  }
});

test('لوحة الإدارة تحمّل القسيمة، وصفحة التتبع العامة كذلك', async () => {
  const admin = await get('/admin');
  assert.match(admin.body, /voucher\.css/);
  assert.match(admin.body, /voucher-generator\.js/);
  const track = await get('/track');
  assert.match(track.body, /voucher-generator\.js/);
});

test('استوديو القسيمة اليدوية مستقل ومتاح في لوحة الموظفين', async () => {
  const admin = await get('/admin/voucher');
  assert.equal(admin.res.status, 200);
  assert.match(admin.body, /voucher-studio\.css/);
  assert.match(admin.body, /voucher-studio\.js/);
  const studio = await get('/assets/js/voucher-studio.js');
  assert.equal(studio.res.status, 200);
  assert.match(studio.body, /VoucherStudio/);
  assert.doesNotMatch(studio.body, /\/api\/admin\/requests/);
});

test('بيانات التتبع تكفي لبناء قسيمة مع آخر 4 أرقام للتحقق', async () => {
  const create = await fetch(`${base}/api/requests`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-requested-with': 'fetch' },
    body: JSON.stringify({ type: 'umrah', name: 'عميل اختبار', phone: '0791234567', programSlug: 'umrah-p1', adults: 2, children: 1, consent: true }),
  });
  const made = await create.json();
  assert.equal(create.status, 201);
  const track = await fetch(`${base}/api/track`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-requested-with': 'fetch' },
    body: JSON.stringify({ reference: made.reference, phone: '0791234567' }),
  });
  const data = await track.json();
  assert.equal(track.status, 200);
  assert.equal(data.request.reference, made.reference);
  assert.equal(data.request.phoneLast4, '4567');
  assert.equal(data.request.details.name, 'عميل اختبار');
  assert.equal(data.request.details.adults, 2);
  assert.equal(data.request.details.children, 1);
});
