import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { rmSync, readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { createApp } from '../server.js';
import { openDb } from '../lib/db.js';
import { notifyBooking, signPayload, verifySignature, webhookConfig } from '../lib/webhooks.js';

const RECEIVED = [];
let receiver;
let receiverUrl;

function startReceiver(handler = null) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        RECEIVED.push({ headers: req.headers, raw, body: safeParse(raw) });
        if (handler) return handler(req, res, raw);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end('{"ok":true}');
      });
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${server.address().port}/webhook/laurette-booking` }));
  });
}

const safeParse = (s) => { try { return JSON.parse(s); } catch { return null; } };

const sampleRequest = {
  id: 1,
  reference: 'LT-CS-TEST01',
  type: 'consult',
  department: 'الحج والعمرة',
  title: 'استشارة',
  summary: 'استشارة عمرة لعائلة',
  status: 'new',
  source: 'website',
  created_at: '2026-10-29T10:00:00.000Z',
  payload: { name: 'أحمد', phone: '0790000000', email: 'a@example.com', consent: true, notes: 'اختبار' },
};

before(async () => {
  const { server, url } = await startReceiver();
  receiver = server;
  receiverUrl = url;
});

after(async () => {
  await new Promise((resolve) => receiver.close(resolve));
});

test('توقيع HMAC متوافق مع خوارزمية التحقق', () => {
  const secret = 'top-secret';
  const ts = '1760000000';
  const body = '{"event":"booking.created","reference":"LT-CS-1"}';
  const sig = signPayload(secret, ts, body);
  assert.match(sig, /^sha256=[0-9a-f]{64}$/);
  assert.equal(sig, signPayload(secret, ts, body), 'التوقيع يجب أن يكون ثابتًا لنفس المدخلات');
  assert.notEqual(sig, signPayload('other-secret', ts, body));
  assert.ok(verifySignature({ secret, timestamp: ts, rawBody: body, signature: sig, toleranceSeconds: 0 }));
  assert.ok(!verifySignature({ secret, timestamp: ts, rawBody: body, signature: sig.replace(/.$/, '0') }));
  assert.ok(!verifySignature({ secret: 'wrong', timestamp: ts, rawBody: body, signature: sig, toleranceSeconds: 0 }));
  // طابع زمني قديم يُرفض
  assert.ok(!verifySignature({ secret, timestamp: ts, rawBody: body, signature: sig, toleranceSeconds: 60 }));
});

test('webhookConfig يتطلب الرابط والسر معًا', () => {
  assert.equal(webhookConfig({}).enabled, false);
  assert.equal(webhookConfig({ N8N_BOOKING_WEBHOOK_URL: 'https://example.com/hook' }).enabled, false);
  assert.equal(webhookConfig({ N8N_BOOKING_WEBHOOK_SECRET: 's' }).enabled, false);
  assert.equal(webhookConfig({ N8N_BOOKING_WEBHOOK_URL: 'https://example.com/hook', N8N_BOOKING_WEBHOOK_SECRET: 's' }).enabled, true);
});

test('بدون إعداد: لا إرسال ولا خطأ', async () => {
  const db = openDb(`data/test-${randomBytes(4).toString('hex')}.db`);
  const res = await notifyBooking(db, sampleRequest, {}, { env: {} });
  assert.equal(res.status, 'skipped');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM webhook_deliveries').get().n, 0);
});

test('إرسال ناجح: توقيع صحيح وهيدرات كاملة وتسجيل delivered', async () => {
  RECEIVED.length = 0;
  const dbFile = `data/test-${randomBytes(4).toString('hex')}.db`;
  const db = openDb(dbFile);
  const env = { N8N_BOOKING_WEBHOOK_URL: receiverUrl, N8N_BOOKING_WEBHOOK_SECRET: 'unit-secret' };
  const res = await notifyBooking(db, sampleRequest, { brandShort: 'لوريت', baseUrl: 'https://laurette.jo' }, { env });
  assert.equal(res.status, 'delivered');
  assert.equal(RECEIVED.length, 1);

  const rec = RECEIVED[0];
  assert.match(rec.headers['x-loret-signature'], /^sha256=[0-9a-f]{64}$/);
  assert.equal(rec.headers['x-loret-event'], 'booking.created');
  assert.equal(rec.headers['content-type'], 'application/json; charset=utf-8');

  // التوقيع يعتمد على الجسم الخام كما أُرسل
  assert.ok(verifySignature({
    secret: 'unit-secret',
    timestamp: rec.headers['x-loret-timestamp'],
    rawBody: rec.raw,
    signature: rec.headers['x-loret-signature'],
  }), 'التوقيع المرسل لا يطابق HMAC على الجسم الخام');

  assert.equal(rec.body.reference, 'LT-CS-TEST01');
  assert.equal(rec.body.customer.phone, '0790000000');
  assert.equal(rec.body.meta.trackUrl, 'https://laurette.jo/track?reference=LT-CS-TEST01');
  assert.equal(rec.body.details.notes, 'اختبار');

  const row = db.prepare('SELECT * FROM webhook_deliveries ORDER BY id DESC LIMIT 1').get();
  assert.equal(row.status, 'delivered');
  assert.equal(row.response_code, 200);
  assert.equal(row.reference, 'LT-CS-TEST01');

  for (const s of ['', '-wal', '-shm']) { try { rmSync(dbFile + s); } catch { /* ignore */ } }
});

test('فشل n8n لا يرمي استثناء ويُسجَّل failed', async () => {
  const failing = http.createServer((req, res) => { res.writeHead(503); res.end('down'); });
  await new Promise((r) => failing.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${failing.address().port}/webhook/laurette-booking`;
  const dbFile = `data/test-${randomBytes(4).toString('hex')}.db`;
  const db = openDb(dbFile);

  const res = await notifyBooking(db, sampleRequest, {}, {
    env: { N8N_BOOKING_WEBHOOK_URL: url, N8N_BOOKING_WEBHOOK_SECRET: 'x' },
  });
  assert.equal(res.status, 'failed');
  assert.equal(res.code, 503);

  const row = db.prepare('SELECT * FROM webhook_deliveries ORDER BY id DESC LIMIT 1').get();
  assert.equal(row.status, 'failed');
  assert.equal(row.response_code, 503);

  await new Promise((r) => failing.close(r));
  for (const s of ['', '-wal', '-shm']) { try { rmSync(dbFile + s); } catch { /* ignore */ } }
});

test('الموقع يُطلق الإرسال فعليًا عند إنشاء طلب (ولا يتأثر الطلب بالفشل)', async () => {
  RECEIVED.length = 0;
  process.env.N8N_BOOKING_WEBHOOK_URL = receiverUrl;
  process.env.N8N_BOOKING_WEBHOOK_SECRET = 'api-secret';

  const dbFile = `data/test-${randomBytes(4).toString('hex')}.db`;
  const seedFile = JSON.parse(await (await import('node:fs/promises')).readFile('data/seed.json', 'utf8'));
  const app = createApp({
    dbFile,
    baseUrl: 'http://127.0.0.1:0',
    seed: { ...seedFile, users: seedFile.users.map(({ password, ...u }) => u) },
    adminPassword: 'Test-Only-Admin-Password-42',
    sendVerificationEmail: async () => {},
  });
  const addr = await app.listen(0, '127.0.0.1');
  const base = `http://127.0.0.1:${addr.port}`;

  const res = await fetch(`${base}/api/requests`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-requested-with': 'fetch', origin: base },
    body: JSON.stringify({
      type: 'consult', topic: 'general', name: 'طلب ويبهوك', phone: '0791111111', consent: true,
      message: 'اختبار التكامل مع n8n عند إنشاء الطلب',
    }),
  });
  const payload = await res.json();
  assert.equal(res.status, 201, JSON.stringify(payload));
  assert.ok(payload.reference);

  // الإرسال غير متزامن: ننتظر حتى ثانيتين
  // الإرسال غير متزامن (fire-and-forget): ننتظر حتى ينتهي التسجيل
  let row = null;
  for (let i = 0; i < 25; i += 1) {
    row = app.db.prepare('SELECT status FROM webhook_deliveries WHERE reference = ?').get(payload.reference);
    if (row && row.status !== 'pending') break;
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.ok(row, 'لم يُسجَّل أي إرسال للويبهوك');
  assert.equal(row.status, 'delivered');

  const hit = RECEIVED.find((r) => r.body?.reference === payload.reference);
  assert.ok(hit, 'لم يصل أي حدث إلى مستقبل الويبهوك');
  assert.equal(hit.body.event, 'booking.created');
  assert.equal(hit.body.customer.name, 'طلب ويبهوك');
  assert.ok(verifySignature({
    secret: 'api-secret',
    timestamp: hit.headers['x-loret-timestamp'],
    rawBody: hit.raw,
    signature: hit.headers['x-loret-signature'],
  }), 'توقيع الطلب الحقيقي غير صحيح');

  await app.close();
  delete process.env.N8N_BOOKING_WEBHOOK_URL;
  delete process.env.N8N_BOOKING_WEBHOOK_SECRET;
  for (const s of ['', '-wal', '-shm']) { try { rmSync(dbFile + s); } catch { /* ignore */ } }
});

test('تغيير الحالة يُرسل booking.status_changed مع from/to و closed', async () => {
  RECEIVED.length = 0;
  process.env.N8N_BOOKING_WEBHOOK_URL = receiverUrl;
  process.env.N8N_BOOKING_WEBHOOK_SECRET = 'status-secret';
  process.env.N8N_API_KEY = 'proxy-key-123';

  const dbFile = `data/test-${randomBytes(4).toString('hex')}.db`;
  const seedFile = JSON.parse(readFileSync('data/seed.json', 'utf8'));
  const app = createApp({
    dbFile,
    baseUrl: 'http://127.0.0.1:0',
    seed: { ...seedFile, users: seedFile.users.map(({ password, ...u }) => u) },
    adminPassword: 'Test-Only-Admin-Password-42',
    sendVerificationEmail: async () => {},
  });
  const addr = await app.listen(0, '127.0.0.1');
  const base = `http://127.0.0.1:${addr.port}`;

  const login = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-requested-with': 'fetch', origin: base },
    body: JSON.stringify({ username: 'laurette', password: 'Test-Only-Admin-Password-42' }),
  });
  let cookie = (login.headers.get('set-cookie') || '').split(';')[0];
  assert.equal(login.status, 200);
  if ((await login.json()).user.mustChange) {
    const changed = await fetch(`${base}/api/auth/change-password`, { method: 'POST',
      headers: { 'content-type': 'application/json', origin: base, cookie },
      body: JSON.stringify({ currentPassword: 'Test-Only-Admin-Password-42', newPassword: 'Changed-Admin-Password-43' }) });
    assert.equal(changed.status, 200);
    const again = await fetch(`${base}/api/auth/login`, { method: 'POST',
      headers: { 'content-type': 'application/json', origin: base },
      body: JSON.stringify({ username: 'laurette', password: 'Changed-Admin-Password-43' }) });
    assert.equal(again.status, 200);
    cookie = (again.headers.get('set-cookie') || '').split(';')[0];
  }

  const created = await fetch(`${base}/api/requests`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-requested-with': 'fetch', origin: base },
    body: JSON.stringify({ type: 'consult', topic: 'general', name: 'حالة ويبهوك', phone: '0792222222', consent: true, message: 'اختبار مزامنة الحالة مع الشيت' }),
  });
  const createdPayload = await created.json();
  assert.equal(created.status, 201);
  const reference = createdPayload.reference;

  const row = app.db.prepare('SELECT id FROM requests WHERE reference = ?').get(reference);
  const patched = await fetch(`${base}/api/admin/requests/${row.id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', 'x-requested-with': 'fetch', origin: base, cookie },
    body: JSON.stringify({ status: 'quoted' }),
  });
  assert.equal(patched.status, 200, await patched.text());

  let statusEvent = null;
  for (let i = 0; i < 25 && !statusEvent; i += 1) {
    await new Promise((r) => setTimeout(r, 100));
    statusEvent = RECEIVED.find((r) => r.body?.reference === reference && r.body?.event === 'booking.status_changed') || null;
  }
  assert.ok(statusEvent, 'لم يُرسل حدث تغيير الحالة');
  assert.equal(statusEvent.body.from, 'new');
  assert.equal(statusEvent.body.to, 'quoted');
  assert.equal(statusEvent.body.closed, false);
  assert.equal(statusEvent.headers['x-api-key'], 'proxy-key-123', 'ترويسة الوسيط X-API-Key مفقودة');
  assert.ok(verifySignature({
    secret: 'status-secret',
    timestamp: statusEvent.headers['x-loret-timestamp'],
    rawBody: statusEvent.raw,
    signature: statusEvent.headers['x-loret-signature'],
  }));

  // الإغلاق: confirmed ⇒ closed = true (يوقف تصعيد 24 ساعة في الشيت)
  const closing = await fetch(`${base}/api/admin/requests/${row.id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', 'x-requested-with': 'fetch', origin: base, cookie },
    body: JSON.stringify({ status: 'confirmed' }),
  });
  assert.equal(closing.status, 200, await closing.text());

  let closedEvent = null;
  for (let i = 0; i < 25 && !closedEvent; i += 1) {
    await new Promise((r) => setTimeout(r, 100));
    closedEvent = RECEIVED.find((r) => r.body?.reference === reference && r.body?.to === 'confirmed') || null;
  }
  assert.ok(closedEvent, 'لم يُرسل حدث الإغلاق');
  assert.equal(closedEvent.body.closed, true);

  const logged = app.db.prepare("SELECT COUNT(*) n FROM webhook_deliveries WHERE reference = ? AND event = 'booking.status_changed'").get(reference);
  assert.ok(logged.n >= 2, 'يجب تسجيل حدثي الحالة على الأقل');

  await app.close();
  delete process.env.N8N_BOOKING_WEBHOOK_URL;
  delete process.env.N8N_BOOKING_WEBHOOK_SECRET;
  delete process.env.N8N_API_KEY;
  for (const s of ['', '-wal', '-shm']) { try { rmSync(dbFile + s); } catch { /* ignore */ } }
});

test('وضع مفتاح فقط: N8N_WEBHOOK_KEY يعمل بلا HMAC', async () => {
  RECEIVED.length = 0;
  const dbFile = `data/test-${randomBytes(4).toString('hex')}.db`;
  const db = openDb(dbFile);
  const env = { N8N_WEBHOOK_URL: receiverUrl, N8N_WEBHOOK_KEY: 'header-auth-key' };
  const res = await notifyBooking(db, sampleRequest, {}, { env });
  assert.equal(res.status, 'delivered');
  const rec = RECEIVED[0];
  assert.equal(rec.headers['x-api-key'], 'header-auth-key');
  assert.equal(rec.headers['x-loret-signature'], undefined, 'لا يجب إرسال توقيع بلا سر');
  assert.equal(rec.body.event, 'booking.created');
  for (const s of ['', '-wal', '-shm']) { try { rmSync(dbFile + s); } catch { /* ignore */ } }
});

test('سياسة الخصوصية تذكر n8n وGoogle Sheets والبريد', async () => {
  const dbFile = `data/test-${randomBytes(4).toString('hex')}.db`;
  const seedFile = JSON.parse(readFileSync('data/seed.json', 'utf8'));
  const app = createApp({
    dbFile,
    baseUrl: 'http://127.0.0.1:0',
    seed: { ...seedFile, users: seedFile.users.map(({ password, ...u }) => u) },
    adminPassword: 'Test-Only-Admin-Password-42',
    sendVerificationEmail: async () => {},
  });
  const addr = await app.listen(0, '127.0.0.1');
  const res = await fetch(`http://127.0.0.1:${addr.port}/privacy`);
  const html = await res.text();
  assert.equal(res.status, 200);
  assert.match(html, /n8n/);
  assert.match(html, /Google Sheets/);
  assert.match(html, /Gmail/);
  assert.match(html, /قاعدة بيانات الموقع هي المصدر الرسمي/);
  await app.close();
  for (const s of ['', '-wal', '-shm']) { try { rmSync(dbFile + s); } catch { /* ignore */ } }
});
