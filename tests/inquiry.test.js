/* اختبارات صندوق «طلب فندق بديل / الاستفسار عن العرض»:
   POST /api/inquiries + GET /api/admin/inquiries + GET /api/admin/inquiries/count + PATCH /api/admin/inquiries/:id
   + حقن الزر والنافذة في صفحات الموقع العامة.
   النمط منقوح من tests/offer-feature.test.js: createApp بقاعدة مؤقتة، مساعد call،
   دخول المدير بعد تغيير كلمة المرور المؤقتة، وقراءة القاعدة مباشرة عبر اتصال ثانٍ.
   التشغيل: node --test tests/inquiry.test.js */

import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync, readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { createApp } from '../server.js';

const DB = `data/test-inquiry-${randomBytes(4).toString('hex')}.db`;
let app;
let base;

const seed = JSON.parse(readFileSync('data/seed.json', 'utf8'));
const adminUser = seed.users[0].username;
const adminPass = 'Test-Only-Admin-Password-42';
const adminPass2 = `${adminPass}-X1`;
const testSeed = { ...seed, users: seed.users.map(({ password, ...user }) => user) };

let adminCookie = '';
let program = null;

async function call(path, { method = 'GET', body, cookie, headers = {}, csrf = true } = {}) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(method !== 'GET' && csrf ? { 'x-requested-with': 'fetch' } : {}),
      ...(cookie ? { cookie } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
    redirect: 'manual',
  });
  const type = res.headers.get('content-type') || '';
  const payload = type.includes('json') ? await res.json() : await res.text();
  return { res, payload };
}

const login = async (username, password) => {
  const { res, payload } = await call('/api/auth/login', { method: 'POST', body: { username, password } });
  return { res, payload, cookie: (res.headers.get('set-cookie') || '').split(';')[0] };
};

function dbRead(sql, params = []) {
  const db2 = new DatabaseSync(DB);
  try {
    return db2.prepare(sql).all(...params);
  } finally {
    db2.close();
  }
}

const validBody = (overrides = {}) => ({
  slug: program.slug,
  inquiryType: 'alternative_hotel',
  notes: 'نريد فندق دار التوحيد أو ما يعادله',
  name: 'أحمد محمد',
  phone: '0791234567',
  branch: 'amman',
  consent: true,
  ...overrides,
});

before(async () => {
  for (const suffix of ['', '-wal', '-shm']) {
    try { rmSync(DB + suffix); } catch { /* ignore */ }
  }
  app = createApp({ dbFile: DB, baseUrl: 'http://127.0.0.1:0', seed: testSeed, adminPassword: adminPass });
  const addr = await app.listen(0, '127.0.0.1');
  base = `http://127.0.0.1:${addr.port}`;

  const first = await login(adminUser, adminPass);
  assert.equal(first.res.status, 200, 'فشل دخول المدير المزروع');
  const changed = await call('/api/auth/change-password', {
    method: 'POST', cookie: first.cookie, body: { currentPassword: adminPass, newPassword: adminPass2 },
  });
  assert.equal(changed.res.status, 200, 'فشل تغيير كلمة المرور المؤقتة');
  const again = await login(adminUser, adminPass2);
  adminCookie = again.cookie;
  assert.ok(adminCookie.startsWith('lt_session='), 'كوكي الجلسة الإدارية مفقود');

  const list = await call('/api/programs?limit=5');
  program = (list.payload.programs || []).find((p) => p.slug) || null;
  assert.ok(program, 'لا يوجد برنامج منشور لاستخدامه في الاختبار');
});

after(async () => {
  await app.close();
  for (const suffix of ['', '-wal', '-shm']) {
    try { rmSync(DB + suffix); } catch { /* ignore */ }
  }
});

/* ---------------- أ) الإرسال العام ---------------- */

test('أ) POST /api/inquiries يحفظ الاستفسار بسياق البرنامج ويعيد مرجعاً ورابط واتساب', async () => {
  const { res, payload } = await call('/api/inquiries', { method: 'POST', body: validBody() });
  assert.equal(res.status, 201);
  assert.equal(payload.ok, true);
  assert.match(payload.reference, /^LT-HI-[A-Z0-9]{6}$/);

  const rows = dbRead('SELECT * FROM program_inquiries WHERE reference = ?', [payload.reference]);
  assert.equal(rows.length, 1);
  const row = rows[0];
  assert.equal(row.program_slug, program.slug);
  assert.equal(row.inquiry_type, 'alternative_hotel');
  assert.equal(row.status, 'new');
  assert.equal(row.preferred_branch, 'amman');
  assert.equal(row.customer_phone, '+962791234567', 'الهاتف يجب أن يُخزَّن بصيغة دولية');
  assert.ok(row.program_title.length > 0, 'عنوان البرنامج مطلوب');
  assert.equal(row.requested_hotel_notes, 'نريد فندق دار التوحيد أو ما يعادله');

  assert.ok(payload.whatsappUrl.startsWith('https://wa.me/962'), 'رابط واتساب للفرع المختار مطلوب');
  const decoded = decodeURIComponent(payload.whatsappUrl.split('?text=')[1]);
  assert.ok(decoded.includes(program.title), 'الرسالة يجب أن تحمل اسم البرنامج');
  assert.ok(decoded.includes('أحمد محمد'), 'الرسالة يجب أن تحمل اسم العميل');
  assert.ok(decoded.includes(payload.reference), 'الرسالة يجب أن تحمل المرجع');
});

test('ب) التكرار خلال 10 دقائق يعيد نفس السجل بلا صف جديد', async () => {
  const body = validBody({ name: 'سامي العلي', phone: '0795554444' });
  const first = await call('/api/inquiries', { method: 'POST', body });
  assert.equal(first.res.status, 201);
  const second = await call('/api/inquiries', { method: 'POST', body });
  assert.equal(second.res.status, 200);
  assert.equal(second.payload.duplicate, true);
  assert.equal(second.payload.reference, first.payload.reference);
  const rows = dbRead('SELECT id FROM program_inquiries WHERE customer_phone = ?', ['+962795554444']);
  assert.equal(rows.length, 1);
});

test('ج) التحقق: الاسم والهاتف والموافقة والنوع', async () => {
  const noName = await call('/api/inquiries', { method: 'POST', body: validBody({ name: ' ' }) });
  assert.equal(noName.res.status, 422);
  assert.ok(noName.payload.errors.name);

  const badPhone = await call('/api/inquiries', { method: 'POST', body: validBody({ phone: '07912345' }) });
  assert.equal(badPhone.res.status, 422);
  assert.ok(badPhone.payload.errors.phone);

  const noConsent = await call('/api/inquiries', { method: 'POST', body: validBody({ consent: false }) });
  assert.equal(noConsent.res.status, 422);
  assert.ok(noConsent.payload.errors.consent);

  const badType = await call('/api/inquiries', { method: 'POST', body: validBody({ inquiryType: 'other' }) });
  assert.equal(badType.res.status, 422);
  assert.ok(badType.payload.errors.inquiryType);
});

test('د) طلب من أصل خارجي يُرفض (حماية CSRF القائمة)', async () => {
  const { res } = await call('/api/inquiries', {
    method: 'POST', body: validBody(), csrf: false, headers: { origin: 'https://evil.example' },
  });
  assert.equal(res.status, 403);
});

test('هـ) عرض بلا صف برنامج (بوستر /offers) يُقبل بعنوانه كما أرسله العميل', async () => {
  const { res, payload } = await call('/api/inquiries', {
    method: 'POST',
    body: { slug: 'poster-offer-test', title: 'عرض جورجيا 5 أيام', category: 'georgia', name: 'ليلى حسن', phone: '+962788887777', consent: true, inquiryType: 'availability' },
  });
  assert.equal(res.status, 201);
  const row = dbRead('SELECT * FROM program_inquiries WHERE reference = ?', [payload.reference])[0];
  assert.equal(row.program_id, null);
  assert.equal(row.program_title, 'عرض جورجيا 5 أيام');
  assert.equal(row.preferred_branch, null);
});

/* ---------------- و) لوحة الإدارة ---------------- */

test('و) GET /api/admin/inquiries يتطلب تسجيل الدخول ويُرجع العدادات', async () => {
  const anon = await call('/api/admin/inquiries');
  assert.equal(anon.res.status, 401);

  const authed = await call('/api/admin/inquiries', { cookie: adminCookie });
  assert.equal(authed.res.status, 200);
  assert.ok(Array.isArray(authed.payload.inquiries));
  assert.ok(authed.payload.total >= 2);
  assert.ok(authed.payload.counts.total >= 2);
  assert.ok(authed.payload.statuses.new.label === 'جديد');

  const filtered = await call('/api/admin/inquiries?status=new', { cookie: adminCookie });
  assert.equal(filtered.res.status, 200);
  assert.ok(filtered.payload.inquiries.every((row) => row.status === 'new'));

  const searched = await call('/api/admin/inquiries?q=أحمد', { cookie: adminCookie });
  assert.equal(searched.res.status, 200);
  assert.ok(searched.payload.inquiries.some((row) => row.customerName === 'أحمد محمد'));

  const counts = await call('/api/admin/inquiries/count', { cookie: adminCookie });
  assert.equal(counts.res.status, 200);
  assert.ok(counts.payload.counts.new >= 1);
});

test('ز) PATCH /api/admin/inquiries/:id يحدّث الحالة ويرفض القيم غير المعروفة', async () => {
  const list = await call('/api/admin/inquiries?status=new', { cookie: adminCookie });
  const target = list.payload.inquiries[0];
  assert.ok(target, 'لا يوجد استفسار جديد لتحديثه');

  const bad = await call(`/api/admin/inquiries/${target.id}`, { method: 'PATCH', cookie: adminCookie, body: { status: 'unknown' } });
  assert.equal(bad.res.status, 422);

  const okRes = await call(`/api/admin/inquiries/${target.id}`, { method: 'PATCH', cookie: adminCookie, body: { status: 'contacted' } });
  assert.equal(okRes.res.status, 200);
  assert.equal(okRes.payload.inquiry.status, 'contacted');
  assert.equal(dbRead('SELECT status FROM program_inquiries WHERE id = ?', [target.id])[0].status, 'contacted');

  const missing = await call('/api/admin/inquiries/999999', { method: 'PATCH', cookie: adminCookie, body: { status: 'booked' } });
  assert.equal(missing.res.status, 422);

  const anon = await call(`/api/admin/inquiries/${target.id}`, { method: 'PATCH', body: { status: 'booked' } });
  assert.equal(anon.res.status, 401);
});

/* ---------------- ح) الحقن في الصفحات ---------------- */

test('ح) الزر والنافذة محقونان في صفحات الموقع وفي صفحة البرنامج والعرض المصغّر', async () => {
  const home = await call('/');
  assert.equal(home.res.status, 200);
  assert.ok(home.payload.includes('id="inquiryModal"'), 'نافذة الاستفسار غير محقونة في التخطيط');
  assert.ok(home.payload.includes('data-inquiry-open'), 'لا يوجد زر فتح في الصفحة الرئيسية');
  assert.ok(home.payload.includes('/assets/js/inquiry-box.js'), 'سكربت الصندوق غير محمّل');

  const programPage = await call(`/programs/${program.slug}`);
  assert.equal(programPage.res.status, 200);
  assert.ok(programPage.payload.includes('inquiry-panel'), 'لوحة الاستفسار غير محقونة في صفحة البرنامج');
  assert.ok(programPage.payload.includes('تخصيص العرض أو السؤال عن فندق آخر'), 'عنوان الصندوق مفقود');

  const micro = await call(`/p/${program.slug}`);
  assert.equal(micro.res.status, 200);
  assert.ok(micro.payload.includes('id="inquiryModal"'), 'النافذة غير محقونة في صفحة /p/:slug');
  assert.ok(micro.payload.includes('/assets/js/inquiry-box.js'), 'سكربت الصندوق غير محمّل في /p/:slug');
});
