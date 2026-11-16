/* اختبارات ميزة صفحات العروض: /p/:slug + /api/public/offer-lead + /api/admin/programs/:id/upload-brochure
   + أعمدة programs الجديدة (department/poster_image/pdf_brochure_url/pricing_tiers_json/views_count) + العداد والإسناد.
   النمط منقوح من tests/api.test.js (§8 في audit-laurette/offer-feature/admin-map.md):
   createApp بقاعدة مؤقتة data/test-*.db، مساعد call مع x-requested-with، login/adminCookie، تنظيف after.
   قراءة القاعدة مباشرة عبر اتصال ثانٍ (node:sqlite) على ملف القاعدة المؤقتة.
   التشغيل: node --test tests/offer-feature.test.js */

import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { createApp } from '../server.js';

const DB = `data/test-offer-${randomBytes(4).toString('hex')}.db`;
let app;
let base;

const seed = JSON.parse(readFileSync('data/seed.json', 'utf8'));
const adminUser = seed.users[0].username;
const adminName = seed.users[0].name;
const adminPass = 'Test-Only-Admin-Password-42';
const adminPass2 = `${adminPass}-X1`;
const testSeed = { ...seed, users: seed.users.map(({ password, ...user }) => user) };

let adminCookie = '';
let programId = null;
/* ملفات الوسائط التي رفعها الاختبار إلى public/media/offers — تُمسح في after. */
const createdMedia = [];

async function call(path, { method = 'GET', body, cookie, headers = {}, origin, csrf = true } = {}) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(method !== 'GET' && csrf ? { 'x-requested-with': 'fetch' } : {}),
      ...(cookie ? { cookie } : {}),
      ...(origin ? { origin } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
    redirect: 'manual',
  });
  const type = res.headers.get('content-type') || '';
  const payload = type.includes('json') ? await res.json() : await res.text();
  return { res, payload, type };
}

const login = async (username, password) => {
  const { res, payload } = await call('/api/auth/login', { method: 'POST', body: { username, password } });
  return { res, payload, cookie: (res.headers.get('set-cookie') || '').split(';')[0] };
};

/* اتصال ثانٍ مستقل على ملف قاعدة الاختبار للقراءة المباشرة (SELECT فقط). */
function dbRead(sql, params = []) {
  const db2 = new DatabaseSync(DB);
  try {
    return db2.prepare(sql).all(...params);
  } finally {
    db2.close();
  }
}

before(async () => {
  for (const suffix of ['', '-wal', '-shm']) {
    try { rmSync(DB + suffix); } catch { /* ignore */ }
  }
  app = createApp({ dbFile: DB, baseUrl: 'http://127.0.0.1:0', seed: testSeed, adminPassword: adminPass });
  const addr = await app.listen(0, '127.0.0.1');
  base = `http://127.0.0.1:${addr.port}`;
  /* المدير المزروع لديه mustChange=true (docs/audit/identity-roles.md:99) — نغيّر كلمة المرور
     لمسح الراية ثم نعيد الدخول (change-password يحذف كل الجلسات). */
  const first = await login(adminUser, adminPass);
  assert.equal(first.res.status, 200, 'فشل دخول المدير المزروع');
  const changed = await call('/api/auth/change-password', {
    method: 'POST',
    cookie: first.cookie,
    body: { currentPassword: adminPass, newPassword: adminPass2 },
  });
  assert.equal(changed.res.status, 200, 'فشل تغيير كلمة المرور المؤقتة');
  const again = await login(adminUser, adminPass2);
  assert.equal(again.res.status, 200, 'فشل الدخول بعد تغيير كلمة المرور');
  adminCookie = again.cookie;
  assert.ok(adminCookie.startsWith('lt_session='), 'كوكي الجلسة الإدارية مفقود');
});

after(async () => {
  await app.close();
  for (const suffix of ['', '-wal', '-shm']) {
    try { rmSync(DB + suffix); } catch { /* ignore */ }
  }
  for (const url of createdMedia) {
    try { rmSync(join('public', url)); } catch { /* ignore */ }
  }
});

/* ---------------- أ) صفحة غير موجودة ---------------- */

test('أ) GET /p/nonexistent → 404', async () => {
  const { res, payload } = await call('/p/does-not-exist-xyz');
  assert.equal(res.status, 404, `الحالة ${res.status}`);
  assert.ok(typeof payload === 'string' && payload.includes('<!DOCTYPE html'), '404 الصفحات يجب أن يكون HTML');
});

/* ---------------- ب) إنشاء برنامج وعرض صفحة العرض ---------------- */

test('ب) POST /api/admin/programs ينشئ برنامجاً → 201 وGET /p/istanbul-8days → 200 بكل عناصر الصفحة', async () => {
  const created = await call('/api/admin/programs', {
    method: 'POST',
    cookie: adminCookie,
    body: {
      slug: 'istanbul-8days',
      category: 'istanbul',
      title: 'إسطنبول 8 أيام',
      days: 8,
      nights: 7,
      priceFrom: 689,
      status: 'published',
      pricingTiers: ['أنجم مكة|5|غرفة مزدوجة|665|إفطار', 'شيراتون مكة|4|ثلاثية|750|شامل'],
      department: 'قسم السياحة الخارجية',
    },
  });
  assert.equal(created.res.status, 201, `الحالة ${created.res.status}: ${JSON.stringify(created.payload)}`);
  programId = created.payload.id;
  assert.ok(Number.isInteger(programId), 'لم يُعَد معرّف البرنامج المنشأ');

  const { res, payload: html } = await call('/p/istanbul-8days');
  assert.equal(res.status, 200, `الحالة ${res.status}`);
  assert.ok(html.includes('أنجم مكة'), 'بطاقة خيار الفندق الأول مفقودة');
  assert.ok(html.includes('شيراتون مكة'), 'بطاقة خيار الفندق الثاني مفقودة');
  assert.ok(html.includes('يبدأ من'), 'عبارة «يبدأ من» مفقودة');
  assert.ok(html.includes('wa.me'), 'رابط wa.me مفقود');
  assert.ok(html.includes('dir="rtl"'), 'خاصية dir="rtl" مفقودة');
  /* زر واتساب لكل خيار تسعير — data-tier يحمل «الفندق — الغرفة». */
  assert.ok(html.includes('data-tier="أنجم مكة — غرفة مزدوجة"'), 'زر واتساب للخيار الأول مفقود');
  assert.ok(html.includes('data-tier="شيراتون مكة — ثلاثية"'), 'زر واتساب للخيار الثاني مفقود');
  assert.equal((html.match(/data-tier=/g) || []).length, 2, 'يجب وجود زر واتساب واحد لكل خيار تسعير');
});

/* ---------------- ج) برنامج مسودة ---------------- */

test('ج) برنامج بحالة draft → GET /p/slug → 404', async () => {
  const draft = await call('/api/admin/programs', {
    method: 'POST',
    cookie: adminCookie,
    body: { slug: 'draft-offer-xyz', category: 'istanbul', title: 'عرض مسودة', status: 'draft' },
  });
  assert.equal(draft.res.status, 201, `الحالة ${draft.res.status}: ${JSON.stringify(draft.payload)}`);
  const { res } = await call('/p/draft-offer-xyz');
  assert.equal(res.status, 404, 'البرنامج المسودة يجب أن يرجع 404');
});

/* ---------------- د) عداد الزيارات وتتبع offer_view ---------------- */

test('د) GET /p/:slug يزيد views_count ويسجل tracking_events بـevent=offer_view', async () => {
  const beforeRows = dbRead('SELECT views_count FROM programs WHERE id = ?', [programId]);
  const before = beforeRows[0]?.views_count;
  assert.ok(Number.isInteger(before), 'عمود views_count غير مقروء من القاعدة');

  const { res } = await call('/p/istanbul-8days');
  assert.equal(res.status, 200);

  const afterRows = dbRead('SELECT views_count FROM programs WHERE id = ?', [programId]);
  assert.equal(afterRows[0]?.views_count, before + 1, 'views_count لم يزد بمقدار 1 بعد الزيارة');

  const events = dbRead(
    "SELECT event, path, meta FROM tracking_events WHERE event = 'offer_view' AND path = '/p/istanbul-8days' ORDER BY id DESC LIMIT 1",
  );
  assert.ok(events.length >= 1, 'لا يوجد صف offer_view في tracking_events');
  const meta = JSON.parse(events[0].meta);
  assert.equal(meta.programId, programId, 'meta.programId غير صحيح');
});

/* ---------------- هـ) نقطة الطلب العامة: إنشاء + إسناد + تكرار ---------------- */

test('هـ) POST /api/public/offer-lead → 201 مع إسناد صحيح في القاعدة، والتكرار → 200 duplicate:true', async () => {
  const leadBody = {
    slug: 'istanbul-8days',
    name: 'أحمد تجربة',
    phone: '0791234567',
    adults: 1,
    tier: 'أنجم مكة',
    consent: true,
    ref: 1,
  };
  const lead = await call('/api/public/offer-lead', { method: 'POST', body: leadBody });
  assert.equal(lead.res.status, 201, `الحالة ${lead.res.status}: ${JSON.stringify(lead.payload)}`);
  assert.equal(lead.payload.ok, true);
  assert.match(lead.payload.reference, /^LT-(PG|UM)-[A-Z0-9]{6}$/, 'صيغة المرجع غير مطابقة');
  assert.ok(lead.payload.advisorName && lead.payload.advisorName.length > 0, 'advisorName فارغ');
  assert.equal(lead.payload.advisorName, adminName, 'advisorName لا يطابق اسم الموظف المُسند');

  const rows = dbRead(
    'SELECT id, assigned_to, sales_owner_id, service_owner_id, source, payload FROM requests WHERE reference = ?',
    [lead.payload.reference],
  );
  assert.equal(rows.length, 1, 'صف الطلب غير موجود في القاعدة');
  const row = rows[0];
  assert.equal(row.assigned_to, 1, 'assigned_to يجب أن يكون 1');
  assert.equal(row.sales_owner_id, 1, 'sales_owner_id يجب أن يكون 1');
  assert.equal(row.service_owner_id, 1, 'service_owner_id يجب أن يكون 1');
  assert.equal(row.source, 'offer-page', "عمود source يجب أن يكون 'offer-page'");
  const payloadJson = JSON.parse(row.payload);
  assert.equal(payloadJson.source, 'offer-page', "payload يجب أن يحوي source='offer-page'");

  const events = dbRead(
    "SELECT actor_name, kind FROM request_events WHERE request_id = ? AND kind = 'created'",
    [row.id],
  );
  assert.ok(events.length >= 1, 'لا يوجد حدث created في request_events');
  assert.equal(events[0].actor_name, adminName, 'اسم الموظف غير مسجل في request_events');

  const duplicate = await call('/api/public/offer-lead', { method: 'POST', body: leadBody });
  assert.equal(duplicate.res.status, 200, 'التكرار المباشر خلال ثوانٍ يجب أن يعيد 200');
  assert.equal(duplicate.payload.duplicate, true, 'علامة duplicate:true مفقودة');
  assert.equal(duplicate.payload.reference, lead.payload.reference, 'المرجع في التكرار غير مطابق للأصل');
});

/* ---------------- و) الأخطاء ---------------- */

test('و1) consent ناقص → 422 مع errors.consent', async () => {
  const { res, payload } = await call('/api/public/offer-lead', {
    method: 'POST',
    body: { slug: 'istanbul-8days', name: 'سارة تجربة', phone: '0791234568', adults: 1, consent: false },
  });
  assert.equal(res.status, 422, `الحالة ${res.status}: ${JSON.stringify(payload)}`);
  assert.ok(payload.errors && payload.errors.consent, 'errors.consent مفقود');
});

test('و2) slug غير موجود → 404 «العرض غير متاح»', async () => {
  const { res, payload } = await call('/api/public/offer-lead', {
    method: 'POST',
    body: { slug: 'no-such-offer', name: 'تجربة', phone: '0791234569', adults: 1, consent: true },
  });
  assert.equal(res.status, 404, `الحالة ${res.status}: ${JSON.stringify(payload)}`);
  assert.equal(payload.message, 'العرض غير متاح');
});

test('و3) هاتف غير صالح → 422 مع errors.phone', async () => {
  const { res, payload } = await call('/api/public/offer-lead', {
    method: 'POST',
    body: { slug: 'istanbul-8days', name: 'تجربة هاتف', phone: 'abc-not-phone', adults: 1, consent: true },
  });
  assert.equal(res.status, 422, `الحالة ${res.status}: ${JSON.stringify(payload)}`);
  assert.ok(payload.errors && payload.errors.phone, 'errors.phone مفقود');
});

test('و4) POST بلا ترويسة x-requested-with ومنشأ خارجي → 403', async () => {
  /* حارس same-origin (server.js:418-427): طلب POST بلا x-requested-with ومن origin مختلف → 403.
     ملاحظة: طلب بلا origin نهائياً يمر بالتصميم (sameOrigin = !origin || ...) — يُوثَّق ذلك في test-notes. */
  const { res, payload } = await call('/api/public/offer-lead', {
    method: 'POST',
    csrf: false,
    origin: 'https://attacker.example',
    body: { slug: 'istanbul-8days', name: 'بدون ترويسة', phone: '0791234560', adults: 1, consent: true },
  });
  assert.equal(res.status, 403, `الحالة ${res.status}: ${JSON.stringify(payload)}`);
});

/* ---------------- ز) API العام يكشف الحقول الجديدة ---------------- */

test('ز) GET /api/programs/istanbul-8days يعيد pricingTiers مصفوفة كائنات + posterImage + pdfBrochureUrl + department', async () => {
  const { res, payload } = await call('/api/programs/istanbul-8days');
  assert.equal(res.status, 200, `الحالة ${res.status}`);
  const p = payload.program;
  assert.ok(Array.isArray(p.pricingTiers), 'pricingTiers ليست مصفوفة');
  assert.deepEqual(p.pricingTiers, [
    { hotel: 'أنجم مكة', stars: 5, room: 'غرفة مزدوجة', price: 665, notes: 'إفطار' },
    { hotel: 'شيراتون مكة', stars: 4, room: 'ثلاثية', price: 750, notes: 'شامل' },
  ], 'محتوى pricingTiers غير مطابق');
  assert.ok('posterImage' in p, 'مفتاح posterImage مفقود من الرد');
  assert.ok('pdfBrochureUrl' in p, 'مفتاح pdfBrochureUrl مفقود من الرد');
  assert.equal(p.department, 'قسم السياحة الخارجية', 'department غير مطابق');
});

/* ---------------- ح) PATCH الحقول الجديدة ---------------- */

test('ح) PATCH /api/admin/programs/:id يحدّث pricingTiers وposterImage → 200 ويظهر في GET', async () => {
  const patched = await call(`/api/admin/programs/${programId}`, {
    method: 'PATCH',
    cookie: adminCookie,
    body: { pricingTiers: ['فندق آخر|3|سويت|520|نصف إقامة'], posterImage: '/media/offers/x.jpg' },
  });
  assert.equal(patched.res.status, 200, `الحالة ${patched.res.status}: ${JSON.stringify(patched.payload)}`);

  const { res, payload } = await call('/api/programs/istanbul-8days');
  assert.equal(res.status, 200);
  assert.deepEqual(payload.program.pricingTiers, [
    { hotel: 'فندق آخر', stars: 3, room: 'سويت', price: 520, notes: 'نصف إقامة' },
  ], 'تحديث pricingTiers لم يظهر عبر API العام');
  assert.equal(payload.program.posterImage, '/media/offers/x.jpg', 'تحديث posterImage لم يظهر');
});

/* ---------------- ط) الرفع الإداري للبروشور ---------------- */

const MIN_PDF = Buffer.from('%PDF-1.4\n% minimal test-only catalog bytes\n%%EOF\n', 'utf8');

test('ط) upload-brochure: PDF صالح → 200 + ملف فعلي على القرص + تحديث القاعدة؛ نص عادي → 415؛ base64 تالف → 400؛ بلا جلسة → 401', async () => {
  const b64 = MIN_PDF.toString('base64');
  const uploaded = await call(`/api/admin/programs/${programId}/upload-brochure`, {
    method: 'POST',
    cookie: adminCookie,
    body: { kind: 'brochure', filename: 'cat.pdf', base64: b64 },
  });
  assert.equal(uploaded.res.status, 200, `الحالة ${uploaded.res.status}: ${JSON.stringify(uploaded.payload)}`);
  assert.equal(uploaded.payload.ok, true);
  assert.equal(uploaded.payload.kind, 'brochure');
  assert.ok(uploaded.payload.url.startsWith('/media/offers/'), 'url لا يبدأ بـ/media/offers/');
  assert.ok(uploaded.payload.url.endsWith('.pdf'), 'url لا ينتهي بـ.pdf');
  assert.equal(uploaded.payload.size, MIN_PDF.length, 'الحجم المُعاد لا يطابق');

  const diskPath = join('public', uploaded.payload.url);
  assert.ok(existsSync(diskPath), 'الملف غير موجود فعلياً على القرص');
  assert.equal(statSync(diskPath).size, MIN_PDF.length, 'حجم الملف على القرص لا يطابق');
  createdMedia.push(uploaded.payload.url);

  const dbRows = dbRead('SELECT pdf_brochure_url FROM programs WHERE id = ?', [programId]);
  assert.equal(dbRows[0]?.pdf_brochure_url, uploaded.payload.url, 'pdf_brochure_url لم تُحدّث في القاعدة');

  /* نص عادي يدّعي أنه pdf → 415 بالفحص بالبايتات السحرية. */
  const fake = await call(`/api/admin/programs/${programId}/upload-brochure`, {
    method: 'POST',
    cookie: adminCookie,
    body: { kind: 'brochure', filename: 'fake.pdf', base64: Buffer.from('plain text pretending to be a pdf', 'utf8').toString('base64') },
  });
  assert.equal(fake.res.status, 415, `الحالة ${fake.res.status}: ${JSON.stringify(fake.payload)}`);

  /* base64 غير صالح → 400. */
  const bad = await call(`/api/admin/programs/${programId}/upload-brochure`, {
    method: 'POST',
    cookie: adminCookie,
    body: { kind: 'brochure', filename: 'bad.pdf', base64: '!!!not-base64@@@' },
  });
  assert.equal(bad.res.status, 400, `الحالة ${bad.res.status}: ${JSON.stringify(bad.payload)}`);

  /* بلا جلسة → 401. */
  const anon = await call(`/api/admin/programs/${programId}/upload-brochure`, {
    method: 'POST',
    body: { kind: 'brochure', filename: 'anon.pdf', base64: b64 },
  });
  assert.equal(anon.res.status, 401, `الرفع بلا جلسة يجب أن يعيد 401 وليس ${anon.res.status}`);
});

/* ---------------- ي) شريط المستشار والفرع ---------------- */

test('ي) /p/?ref=1 يعرض شريط المستشار باسم الموظف ورقم واتساب، و/p/?branch=amman يعرض فرع عمّان ورقمه', async () => {
  const withRef = await call('/p/istanbul-8days?ref=1');
  assert.equal(withRef.res.status, 200);
  assert.ok(withRef.payload.includes('مستشارك'), 'شريط المستشار مفقود عند ref=1');
  assert.ok(withRef.payload.includes(adminName), `اسم الموظف (${adminName}) غير ظاهر في الشريط`);
  /* الموظف المزروع بلا هاتف → الارتداد إلى settings.whatsapp = 962791193888. */
  assert.ok(withRef.payload.includes('wa.me/962791193888'), 'رابط واتساب بالرقم العام مفقود في شريط المستشار');

  const withBranch = await call('/p/istanbul-8days?branch=amman');
  assert.equal(withBranch.res.status, 200);
  assert.ok(withBranch.payload.includes('عمّان'), 'إشارة فرع عمّان مفقودة');
  /* هاتف الفرع الأرضي 06-4600777 → 96264600777 دولياً في رابط واتساب. */
  assert.ok(withBranch.payload.includes('wa.me/96264600777'), 'رابط واتساب برقم فرع عمّان (96264600777) مفقود');
});
