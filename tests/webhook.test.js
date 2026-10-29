import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { rmSync } from 'node:fs';
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
    headers: { 'content-type': 'application/json', 'x-requested-with': 'fetch' },
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
