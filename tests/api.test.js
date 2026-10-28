import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync, readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { createApp } from '../server.js';

const DB = `data/test-${randomBytes(4).toString('hex')}.db`;
let app;
let base;
let adminUser;
let adminPass;
const otpInbox = new Map();

const seed = JSON.parse(readFileSync('data/seed.json', 'utf8'));
adminUser = seed.users[0].username;
adminPass = 'Test-Only-Admin-Password-42';
const testSeed = { ...seed, users: seed.users.map(({ password, ...user }) => user) };

let adminCookie = '';
let agentCookie = '';

async function call(path, { method = 'GET', body, cookie, headers = {}, origin } = {}) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(method !== 'GET' ? { 'x-requested-with': 'fetch' } : {}),
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

const clientLogin = async (email, password) => {
  const { res, payload } = await call('/api/client/auth/login', { method: 'POST', body: { email, password } });
  return { res, payload, cookie: (res.headers.get('set-cookie') || '').split(';')[0] };
};

before(async () => {
  for (const suffix of ['', '-wal', '-shm']) {
    try { rmSync(DB + suffix); } catch { /* ignore */ }
  }
  app = createApp({
    dbFile: DB,
    baseUrl: 'http://127.0.0.1:0',
    seed: testSeed,
    adminPassword: adminPass,
    sendVerificationEmail: async ({ email, code }) => otpInbox.set(email, code),
  });
  const addr = await app.listen(0, '127.0.0.1');
  base = `http://127.0.0.1:${addr.port}`;
});

after(async () => {
  await app.close();
  for (const suffix of ['', '-wal', '-shm']) {
    try { rmSync(DB + suffix); } catch { /* ignore */ }
  }
});

/* ---------------- pages & SEO ---------------- */

test('الصفحة الرئيسية تُعرض مع بيانات SEO منظّمة', async () => {
  const { res, payload } = await call('/');
  assert.equal(res.status, 200);
  assert.match(payload, /العالم بين يديك/);
  assert.match(payload, /<link rel="canonical"/);
  assert.match(payload, /application\/ld\+json/);
  assert.match(payload, /TravelAgency/);
  assert.match(payload, /name="description"/);
  assert.match(payload, /class="language-switch"[^>]*aria-label="لغة الموقع — العربية مفعّلة"/);
  assert.match(payload, /class="language-option is-active" type="button" lang="ar" aria-current="true" data-language-reset="ar" aria-label="العودة إلى العربية"/);
  assert.match(payload, /class="language-option" lang="en" aria-disabled="true"/);
  assert.match(payload, /class="google-review-card"/);
  assert.match(payload, /href="https:\/\/g\.page\/r\/CTLUTUT5sitKEAE\/review" target="_blank" rel="noopener noreferrer"/);
  assert.match(payload, /class="btn btn-gold btn-sm header-review" href="https:\/\/g\.page\/r\/CTLUTUT5sitKEAE\/review" target="_blank" rel="noopener noreferrer" aria-label="قيّم تجربتك مع لوريت على Google — يفتح في تبويب جديد"/);
  assert.match(payload, /class="mobile-review-link" href="https:\/\/g\.page\/r\/CTLUTUT5sitKEAE\/review" target="_blank" rel="noopener noreferrer"/);
  assert.match(payload, /aria-label="قيّم تجربتك مع لوريت على Google — يفتح في تبويب جديد"/);
  assert.match(payload, /قيم تجربتك مع لوريت على Google/);
  const csp = res.headers.get('content-security-policy');
  assert.ok(csp, 'CSP header missing');
  assert.match(csp, /script-src 'self' 'nonce-/);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
});

test('صفحات عامة أساسية تعمل وترجع 200', async () => {
  for (const path of ['/programs', '/offers', '/programs/umrah-p1', '/umrah', '/flights', '/hotels', '/visa', '/consult', '/destinations', '/destinations/mecca', '/guide', '/faq', '/track', '/account', '/account/profile', '/about', '/privacy', '/news', '/admin']) {
    const { res } = await call(path);
    assert.equal(res.status, 200, `فشل ${path}`);
  }
  const missing = await call('/programs/does-not-exist');
  assert.equal(missing.res.status, 404);
});

test('فلاتر البرامج تعرض الوجهات وتطبّق نطاق السعر والمدة', async () => {
  const page = await call('/programs');
  assert.match(page.payload, /name="destination"/);
  assert.match(page.payload, /name="minPrice"/);
  assert.match(page.payload, /name="maxPrice"/);
  assert.match(page.payload, /name="minDays"/);
  assert.match(page.payload, /name="maxDays"/);
  assert.match(page.payload, /مسح التصفية/);

  const filtered = await call('/programs?category=umrah&destination=%D9%85%D9%83%D8%A9%20%D9%88%D8%A7%D9%84%D9%85%D8%AF%D9%8A%D9%86%D8%A9&minPrice=400&maxPrice=450&minDays=8&maxDays=8');
  assert.match(filtered.payload, /عمرة اقتصادية – أبراج الوحدة الحافير/);
  assert.doesNotMatch(filtered.payload, /name="minPrice" value=""/);
});

test('فلاتر العمرة تختار مكة أو مكة والمدينة ووسيلة السفر', async () => {
  const page = await call('/programs?category=umrah');
  assert.match(page.payload, /name="route"/);
  assert.match(page.payload, /value="makkah"[^>]*>مكة المكرمة فقط/);
  assert.match(page.payload, /value="both"[^>]*>مكة المكرمة والمدينة/);
  assert.match(page.payload, /name="mode"/);
  assert.match(page.payload, /value="air"[^>]*>جوًا بالطائرة/);
  assert.match(page.payload, /value="bus"[^>]*>برًا بالحافلة/);

  const busProgram = testSeed.programs.find((program) => program.category === 'umrah' && program.route === 'both' && program.mode === 'bus');
  assert.ok(busProgram, 'Expected a land-travel Umrah program in the test catalog');
  const filtered = await call('/programs?category=umrah&route=both&mode=bus');
  assert.match(filtered.payload, new RegExp(`href="/programs/${busProgram.slug}"`));
  assert.doesNotMatch(filtered.payload, /href="\/programs\/umrah-p1"/);
});

test('كل صفحة لها عنوان ووصف وكانونيكال مستقل', async () => {
  const titles = new Map();
  for (const path of ['/', '/programs', '/umrah', '/faq', '/guide', '/visa']) {
    const { payload } = await call(path);
    const title = (payload.match(/<title>([^<]+)<\/title>/) || [])[1];
    const desc = (payload.match(/<meta name="description" content="([^"]*)"/) || [])[1];
    const canonical = (payload.match(/<link rel="canonical" href="([^"]+)"/) || [])[1];
    assert.ok(title && desc && canonical, `${path} ينقصه meta`);
    assert.ok(!titles.has(title), `عنوان مكرر: ${title}`);
    titles.set(title, path);
  }
});

test('sitemap و robots و خريطة الموقع تعرض الروابط الصحيحة', async () => {
  const sitemap = await call('/sitemap.xml');
  assert.equal(sitemap.res.status, 200);
  assert.match(sitemap.payload, /\/programs\/umrah-p1/);
  assert.match(sitemap.payload, /urlset/);
  const robots = await call('/robots.txt');
  assert.match(robots.payload, /Disallow: \/admin/);
  assert.match(robots.payload, /Sitemap:/);
});

test('صفحة العروض تعرض البوسترات السبعة عشر مع بيانات المعاينة', async () => {
  const { res, payload } = await call('/offers');
  assert.equal(res.status, 200);
  assert.equal((payload.match(/class="poster-card/g) || []).length, 17);
  assert.ok((payload.match(/data-offer-open="/g) || []).length >= 17);
  assert.match(payload, /id="offersData"/);
  assert.match(payload, /id="offerDialog"/);
  assert.match(payload, /\/media\/offers\/poster-trabzon-thumb\.jpg/);
  assert.match(payload, /369 د\.أ/);
  assert.doesNotMatch(payload, /class="poster-price"/);
  assert.match(payload, /class="offer-dialog-price"><small>يبدأ من<\/small><b id="offerDialogPrice"><\/b><small>للشخص<\/small><\/div>/);
  assert.match(payload, /id="loretTransition"/);

  const data = JSON.parse(payload.match(/<script type="application\/json" id="offersData"[^>]*>([\s\S]*?)<\/script>/)[1]);
  assert.equal(data.length, 17);
  const trabzon = data.find((o) => o.slug === 'offer-trabzon');
  assert.equal(trabzon.price, 369);
  assert.equal(trabzon.days, 8);
  assert.ok(trabzon.includes.length >= 3);
  assert.ok(trabzon.image.endsWith('.jpg'));
});

test('نافذة التواصل تعرض الاتصال المباشر وواتساب دون قائمة أرقام الفروع', async () => {
  const { payload } = await call('/offers');
  assert.match(payload, /id="waModal"/);
  assert.match(payload, /المستشار في انتظارك/);
  assert.match(payload, /href="tel:\+962791193888"[^>]*data-contact-call/);
  assert.match(payload, /href="https:\/\/wa\.me\/962791193888\?text=/);
  assert.match(payload, /الاتصال المباشر/);
  assert.match(payload, /مراسلة واتساب مباشرة/);
  assert.doesNotMatch(payload, /class="wa-number"/);
  assert.doesNotMatch(payload, /class="wa-groups"/);
});

test('بوسترات العروض تُخدم كصور محسّنة وخفيفة', async () => {
  const thumb = await call('/media/offers/poster-trabzon-thumb.jpg');
  assert.equal(thumb.res.status, 200);
  assert.equal(thumb.res.headers.get('content-type'), 'image/jpeg');
  const full = await call('/media/offers/poster-trabzon.jpg');
  assert.equal(full.res.status, 200);
  assert.match(full.res.headers.get('cache-control'), /max-age=604800/);
  const unknown = await call('/media/offers/nope.jpg');
  assert.equal(unknown.res.status, 404);
});

test('الصفحة الرئيسية تعرض العروض بالبوسترات ونافذة الواتساب', async () => {
  const { payload } = await call('/');
  assert.ok((payload.match(/class="poster-card/g) || []).length >= 4);
  assert.match(payload, /id="waModal"/);
  assert.match(payload, /class="fab fab-wa"[^>]*data-wa[^>]*><svg/);
  assert.match(payload, /<span>المستشار في انتظارك<\/span>/);
  assert.match(payload, /data-contact-call/);
  assert.match(payload, /data-wa-direct/);
  assert.match(payload, /<a class="btn btn-ghost btn-sm header-track" href="\/track">تتبع الطلب<\/a>/);
  assert.doesNotMatch(payload, /class="header-phone" href="tel:\+962791193888"/);
});

test('الواجهة تحمّل فيديو خلفيًا كسولاً مع صورة غلاف وأشكال متحركة', async () => {
  const { payload } = await call('/');
  assert.match(payload, /id="loretTransition"/);
  assert.match(payload, /id="heroVideo"/);
  assert.match(payload, /preload="none"/);
  assert.match(payload, /data-src="\/media\/hero\/hero-loop\.mp4"/);
  assert.match(payload, /data-poster="\/media\/hero\/hero-poster\.jpg"/);
  assert.match(payload, /class="hero-poster"/);
  assert.ok((payload.match(/class="blob blob-/g) || []).length >= 3);
  assert.match(payload, /class="hero-ring"/);
  assert.match(payload, /id="soundToggle"/);
  assert.match(payload, /id="soundToggle"[^>]*aria-pressed="true"/);
  // لا يُطلب الفيديو من الخادم قبل تفعيله بالجافاسكربت
  const videoTag = payload.match(/<video[^>]*>/)[0];
  assert.ok(!/\ssrc="/.test(videoTag), 'video should not have a direct src');
  assert.match(videoTag, /muted/);
  assert.match(videoTag, /playsinline/);
});

test('ملف الفيديو يُخدم بترويسة فيديو ويدعم طلبات النطاق', async () => {
  const head = await call('/media/hero/hero-loop.mp4');
  assert.equal(head.res.status, 200);
  assert.equal(head.res.headers.get('content-type'), 'video/mp4');
  assert.equal(head.res.headers.get('accept-ranges'), 'bytes');
  const range = await fetch(`${base}/media/hero/hero-loop.mp4`, { headers: { range: 'bytes=0-1023' } });
  assert.equal(range.status, 206);
  assert.equal(range.headers.get('content-range'), 'bytes 0-1023/1795953');
  assert.equal((await range.arrayBuffer()).byteLength, 1024);
});

test('بطاقات البرامج تستخدم الصور الفوتوغرافية المصغرة عند توفرها', async () => {
  const api = await call('/api/programs?category=istanbul&limit=1');
  assert.match(api.payload.programs[0].imageUrl, /^\/media\/hero\/dest-istanbul\.jpg$/);
  const page = await call('/programs?category=istanbul');
  assert.match(page.payload, /dest-istanbul-thumb\.jpg/);
  assert.match(page.payload, /<span class="price"><small>يبدأ من<\/small><b>[\s\S]*?د\.أ<\/b><small>للشخص<\/small><\/span>/);
  const dest = await call('/destinations/istanbul');
  assert.match(dest.payload, /dest-istanbul\.jpg/);
});

test('كتالوج الطباعة منفصل حسب القسم ويستخدم الشعار والسعر ومواعيد السفر الحالية', async () => {
  const { res, payload } = await call('/programs/print?category=umrah');
  assert.equal(res.status, 200);
  assert.match(payload, /\/media\/laurette-wordmark\.jpg/);
  assert.match(payload, /كتالوج لوريت السياحي/);
  assert.match(payload, /أبراج الوحدة الحافير/);
  assert.match(payload, /419 د\.أ/);
  assert.match(payload, /للشخص/);
  assert.match(payload, /2026\/10\/20/);
  assert.match(payload, /data-print-catalog/);
  assert.doesNotMatch(payload, /برنامج شرم الشيخ/);

  const invalid = await call('/programs/print?category=unknown');
  assert.equal(invalid.res.status, 404);

  const logo = await call('/media/laurette-wordmark.jpg');
  assert.equal(logo.res.status, 200);
  assert.equal(logo.res.headers.get('content-type'), 'image/jpeg');
});

test('مراحل الصفقة ووقت الإنجاز تُحسب عند الإغلاق', async () => {
  if (!adminCookie) adminCookie = (await login(adminUser, adminPass)).cookie;
  const created = await call('/api/requests', {
    method: 'POST',
    body: { ...flightBody(), phone: '0797770001', destination: 'فيينا (VIE)', notes: 'اختبار الصفقة' },
  });
  assert.equal(created.res.status, 201);
  const row = app.db.prepare('SELECT id, deal_status, completed_at, first_response_at FROM requests WHERE reference = ?').get(created.payload.reference);
  assert.equal(row.deal_status, 'new');
  assert.equal(row.completed_at, null);

  for (const status of ['reviewing', 'quoted', 'awaiting', 'confirmed']) {
    const step = await call(`/api/admin/requests/${row.id}`, { method: 'PATCH', cookie: adminCookie, body: { status, quoteAmount: 640 } });
    assert.equal(step.res.status, 200, `فشل الانتقال إلى ${status}`);
  }
  const detail = await call(`/api/admin/requests/${row.id}`, { cookie: adminCookie });
  assert.equal(detail.payload.request.deal_status, 'won');
  assert.ok(detail.payload.request.completed_at);
  assert.ok(detail.payload.request.first_response_at);
  assert.ok(detail.payload.request.completionMinutes >= 0);
  assert.match(detail.payload.request.completionLabel, /دقيقة|ساعة|يوم/);
  assert.ok(detail.payload.dealStages.won);
});

test('تقارير الأداء اليومية والأسبوعية والشهرية تعمل مع فلترة الموظف', async () => {
  if (!adminCookie) adminCookie = (await login(adminUser, adminPass)).cookie;
  const confirmed = app.db.prepare("SELECT id FROM requests WHERE status='confirmed' ORDER BY id DESC LIMIT 1").get();
  await call(`/api/admin/requests/${confirmed.id}`, { method: 'PATCH', cookie: adminCookie, body: { assignedTo: 1 } });

  for (const period of ['daily', 'weekly', 'monthly']) {
    const { res, payload } = await call(`/api/admin/reports?period=${period}`, { cookie: adminCookie });
    assert.equal(res.status, 200);
    assert.equal(payload.range.period, period);
    assert.ok(payload.summary.total >= 1);
    assert.ok(payload.summary.won >= 1);
    assert.ok(payload.employees.length >= 1);
    assert.ok(payload.series.length >= 1);
    assert.ok(payload.byType.length >= 1);
    assert.ok(payload.funnel.length >= 5);
  }

  const filtered = await call('/api/admin/reports?period=weekly&employee=1', { cookie: adminCookie });
  assert.ok(filtered.payload.employees.every((e) => String(e.employeeId) === '1'));

  const bad = await call('/api/admin/reports?from=2026-10-10&to=2026-10-01', { cookie: adminCookie });
  assert.equal(bad.res.status, 400);

  const csv = await call('/api/admin/reports.csv?period=weekly', { cookie: adminCookie });
  assert.equal(csv.res.status, 200);
  assert.match(csv.res.headers.get('content-type'), /text\/csv/);
  assert.match(String(csv.payload), /الموظف/);
});

test('الموظف لا يصل إلى تقارير الأداء', async () => {
  if (!adminCookie) adminCookie = (await login(adminUser, adminPass)).cookie;
  const agentPass = ['Agent', 'Pass', '123'].join('');
  const uname = `agent_rep_${Date.now().toString(36)}`;
  const created = await call('/api/admin/users', {
    method: 'POST', cookie: adminCookie,
    body: { username: uname, name: 'موظف تقارير', role: 'agent', password: 'AgentPass123' },
  });
  assert.equal(created.res.status, 201);
  const session = await login(uname, agentPass);
  const { res } = await call('/api/admin/reports', { cookie: session.cookie });
  assert.equal(res.status, 403);
});

test('أكواد ميتا وجوجل تُزرع في الرأس وتُقيّد بسياسة CSP عند التفعيل', async () => {
  if (!adminCookie) adminCookie = (await login(adminUser, adminPass)).cookie;
  const set = await call('/api/admin/settings', {
    method: 'PATCH', cookie: adminCookie,
    body: { metaPixelId: '123456789012345', gtmId: 'GTM-TEST123', googleAdsId: 'AW-123456789', googleAdsLabel: 'AbCdEf', trackingEnabled: true },
  });
  assert.equal(set.res.status, 200);

  const home = await call('/');
  assert.match(home.payload, /connect\.facebook\.net\/en_US\/fbevents\.js/);
  assert.match(home.payload, /googletagmanager\.com\/gtm\.js/);
  assert.match(home.payload, /googletagmanager\.com\/gtag\/js/);
  assert.match(home.payload, /googletagmanager\.com\/ns\.html/);
  assert.match(home.payload, /facebook\.com\/tr\?id=/);
  assert.match(home.res.headers.get('content-security-policy'), /connect\.facebook\.net/);
  assert.match(home.res.headers.get('content-security-policy'), /googletagmanager\.com/);
  assert.match(home.payload, /loret:lead/);
  assert.match(home.payload, /sendBeacon\(/);

  const off = await call('/api/admin/settings', { method: 'PATCH', cookie: adminCookie, body: { trackingEnabled: false } });
  assert.equal(off.res.status, 200);
  const without = await call('/');
  assert.ok(!without.payload.includes('fbevents.js'));

  await call('/api/admin/settings', {
    method: 'PATCH', cookie: adminCookie,
    body: { metaPixelId: '', gtmId: '', googleAdsId: '', googleAdsLabel: '', trackingEnabled: true },
  });
  const cleaned = await call('/');
  assert.ok(!cleaned.payload.includes('fbevents.js'));
});

test('أحداث التحويل تُسجَّل على الخادم وتظهر في اللوحة', async () => {
  if (!adminCookie) adminCookie = (await login(adminUser, adminPass)).cookie;
  const res = await call('/api/track-event', { method: 'POST', body: { event: 'whatsapp_click', type: 'branch', path: '/' } });
  assert.equal(res.res.status, 204);
  const list = await call('/api/admin/tracking-events', { cookie: adminCookie });
  assert.equal(list.res.status, 200);
  assert.ok(list.payload.events.some((e) => e.event === 'whatsapp_click'));
  const bad = await call('/api/track-event', { method: 'POST', body: { event: 'hack' } });
  assert.equal(bad.res.status, 400);
});

test('رسوم SVG تُخدم كصور ولا تحتاج أصولاً خارجية', async () => {
  const { res, payload } = await call('/art/haram.svg?v=2');
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type').split(';')[0], 'image/svg+xml');
  assert.match(payload, /<svg/);
});

/* ---------------- public API & requests ---------------- */

test('واجهة البرامج تعيد البرامج المنشورة فقط', async () => {
  const { res, payload } = await call('/api/programs?category=umrah&limit=5');
  assert.equal(res.status, 200);
  assert.equal(payload.ok, true);
  assert.ok(payload.programs.length > 0);
  assert.ok(payload.programs.every((p) => p.category === 'umrah'));
  assert.ok(payload.programs.every((p) => !('terms' in p) || Array.isArray(p.terms)));
});

const flightBody = () => ({
  type: 'flight',
  tripType: 'return',
  origin: 'عمّان (AMM)',
  destination: 'إسطنبول (IST)',
  departDate: new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10),
  returnDate: new Date(Date.now() + 21 * 86400000).toISOString().slice(0, 10),
  adults: 2,
  children: 0,
  infants: 0,
  cabin: 'economy',
  baggage: 'standard',
  name: 'أحمد الاختبار',
  phone: '0790000001',
  email: 'ahmad@example.com',
  consent: true,
  notes: 'اختبار آلي',
});

test('إنشاء طلب طيران يعيد رقماً مرجعياً ويُحفظ في قاعدة البيانات', async () => {
  const body = flightBody();
  const { res, payload } = await call('/api/requests', { method: 'POST', body });
  assert.equal(res.status, 201);
  assert.equal(payload.ok, true);
  assert.match(payload.reference, /^LT-FL-[A-Z0-9]{6}$/);
  assert.match(payload.summary, /عمّان/);
  const row = app.db.prepare('SELECT * FROM requests WHERE reference = ?').get(payload.reference);
  assert.ok(row);
  assert.equal(row.type, 'flight');
  assert.equal(row.status, 'new');
  assert.equal(row.department, 'تذاكر الطيران');
  const customer = app.db.prepare('SELECT * FROM customers WHERE phone = ?').get('0790000001');
  assert.ok(customer);
});

test('التحقق يمنع الطلبات الناقصة ويعيد أخطاء الحقول', async () => {
  const before = app.db.prepare('SELECT COUNT(*) n FROM requests').get().n;
  const { res, payload } = await call('/api/requests', { method: 'POST', body: { type: 'flight', name: 'أ', phone: '123', consent: true } });
  assert.equal(res.status, 422);
  assert.equal(payload.ok, false);
  assert.ok(payload.errors.phone);
  assert.ok(payload.errors.origin || payload.errors.destination || payload.errors.departDate);
  const after = app.db.prepare('SELECT COUNT(*) n FROM requests').get().n;
  assert.equal(after, before, 'لا يجب حفظ طلب غير صالح');
});

test('الموافقة على الخصوصية إلزامية', async () => {
  const body = { ...flightBody(), consent: false, phone: '0790000002' };
  const { res, payload } = await call('/api/requests', { method: 'POST', body });
  assert.equal(res.status, 422);
  assert.ok(payload.errors.consent);
});

test('منع تكرار الإرسال غير المقصود بنفس البيانات', async () => {
  const body = { ...flightBody(), phone: '0790000051', destination: 'أنطاليا (AYT)', notes: 'اختبار التكرار' };
  const first = await call('/api/requests', { method: 'POST', body });
  const second = await call('/api/requests', { method: 'POST', body });
  assert.equal(first.res.status, 201);
  assert.equal(second.res.status, 200);
  assert.equal(second.payload.duplicate, true);
  assert.equal(second.payload.reference, first.payload.reference);
  const n = app.db.prepare("SELECT COUNT(*) n FROM requests WHERE type='flight' AND json_extract(payload,'$.phone')='0790000051'").get().n;
  assert.equal(n, 1);
});

test('تتبع الطلب يتطلب الرقم المرجعي والهاتف معاً', async () => {
  const created = await call('/api/requests', { method: 'POST', body: { ...flightBody(), phone: '0790000010', destination: 'دبي (DXB)' } });
  const ref = created.payload.reference;
  const good = await call('/api/track', { method: 'POST', body: { reference: ref, phone: '0790000010' } });
  assert.equal(good.res.status, 200);
  assert.equal(good.payload.request.status, 'new');
  assert.equal(good.payload.request.phoneLast4, '0010');
  const badPhone = await call('/api/track', { method: 'POST', body: { reference: ref, phone: '0799999999' } });
  assert.equal(badPhone.res.status, 404);
  const unknown = await call('/api/track', { method: 'POST', body: { reference: 'LT-FL-ZZZZZZ', phone: '0790000010' } });
  assert.equal(unknown.res.status, 404);
});

test('نماذج الفنادق والتأشيرات والاستشارات والعمرة تُحفظ بأنواعها', async () => {
  const today = new Date();
  const iso = (d) => new Date(today.getTime() + d * 86400000).toISOString().slice(0, 10);
  const cases = [
    { type: 'hotel', country: 'تركيا', city: 'إسطنبول', checkIn: iso(10), checkOut: iso(14), rooms: 2, adults: 2, children: 1, childAges: [6], stars: '4', mealPlan: 'breakfast', name: 'سارة الاختبار', phone: '0790000020', consent: true },
    { type: 'visa', nationality: 'أردني', residence: 'الأردن', destination: 'تركيا', visaType: 'tourist', purpose: 'tourism', travelDate: iso(30), applicants: 2, name: 'خالد الاختبار', phone: '0790000021', consent: true },
    { type: 'consult', topic: 'honeymoon', message: 'نرغب بشهر عسل في إسطنبول لمدة أسبوع بميزانية محدودة.', channel: 'whatsapp', name: 'لينا الاختبار', phone: '0790000022', consent: true },
    { type: 'umrah', programSlug: 'umrah-p1', adults: 2, children: 0, infants: 0, preferredDate: iso(40), roomType: 'double', name: 'عمر الاختبار', phone: '0790000023', consent: true },
  ];
  for (const body of cases) {
    const { res, payload } = await call('/api/requests', { method: 'POST', body });
    assert.equal(res.status, 201, `${body.type}: ${JSON.stringify(payload)}`);
    assert.match(payload.reference, new RegExp(`^LT-${{ hotel: 'HT', visa: 'VS', consult: 'CS', umrah: 'UM' }[body.type]}-`));
    const row = app.db.prepare('SELECT * FROM requests WHERE reference = ?').get(payload.reference);
    assert.equal(row.type, body.type);
  }
});

test('طلب برنامج غير موجود يُرفض', async () => {
  const { res } = await call('/api/requests', { method: 'POST', body: { type: 'program', programSlug: 'no-such-program', adults: 1, name: 'اختبار', phone: '0790000030', consent: true } });
  assert.equal(res.status, 422);
});

/* ---------------- auth ---------------- */

test('لوحة الإدارة محمية: بلا جلسة تُرفض', async () => {
  for (const [path, method] of [['/api/admin/overview', 'GET'], ['/api/admin/requests', 'GET'], ['/api/admin/programs', 'GET']]) {
    const { res } = await call(path, { method });
    assert.equal(res.status, 401, path);
  }
});

test('بيانات الدخول الخاطئة تُرفض ولا تكشف وجود المستخدم', async () => {
  const { res, payload } = await call('/api/auth/login', { method: 'POST', body: { username: adminUser, password: 'wrong-password' } });
  assert.equal(res.status, 401);
  assert.equal(payload.message, 'اسم المستخدم أو كلمة المرور غير صحيحة');
});

test('تسجيل دخول المدير يعيد جلسة httpOnly', async () => {
  const { res, payload, cookie } = await login(adminUser, adminPass);
  assert.equal(res.status, 200);
  assert.equal(payload.user.role, 'admin');
  assert.match(cookie, /^lt_session=/);
  const setCookie = res.headers.get('set-cookie');
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /SameSite=Strict/);
  adminCookie = cookie;
  const me = await call('/api/auth/me', { cookie: adminCookie });
  assert.equal(me.payload.user.username, adminUser);
});

test('هيكل CRM والصلاحيات المقيّدة وتحويل الطلب تحافظ على الملكية حتى القبول', async () => {
  const requiredRequestColumns = new Set(app.db.prepare('PRAGMA table_info(requests)').all().map((column) => column.name));
  for (const column of ['branch_id', 'department_id', 'lead_origin', 'sales_owner_id', 'service_owner_id', 'execution_owner_id']) {
    assert.ok(requiredRequestColumns.has(column), `عمود CRM مفقود: ${column}`);
  }
  assert.ok(app.db.prepare("SELECT COUNT(*) n FROM role_definitions WHERE role_key = 'admin'").get().n === 1);
  const branchId = app.db.prepare("SELECT id FROM branches WHERE code = 'amman'").get().id;

  const deptA = await call('/api/admin/departments', {
    method: 'POST', cookie: adminCookie, body: { name: 'قسم اختبار A', branchId },
  });
  const deptB = await call('/api/admin/departments', {
    method: 'POST', cookie: adminCookie, body: { name: 'قسم اختبار B', branchId },
  });
  assert.equal(deptA.res.status, 201);
  assert.equal(deptB.res.status, 201);

  const role = await call('/api/admin/roles', {
    method: 'POST', cookie: adminCookie,
    body: {
      roleKey: 'crm_test_department', name: 'دور قسم للاختبار', baseRole: 'agent', dataScope: 'department',
      permissions: ['overview:read', 'requests:read', 'requests:write', 'customers:read'],
    },
  });
  assert.equal(role.res.status, 201);

  for (const [username, departmentId] of [['crmtesta', deptA.payload.id], ['crmtestb', deptB.payload.id]]) {
    const user = await call('/api/admin/users', {
      method: 'POST', cookie: adminCookie,
      body: { username, name: username, roleKey: 'crm_test_department', branchId, departmentId, password: 'ScopedUserPass123' },
    });
    assert.equal(user.res.status, 201, JSON.stringify(user.payload));
  }

  const requestA = await call('/api/requests', {
    method: 'POST', body: { ...flightBody(), phone: '0790000881', destination: 'عمان-داخلي A' },
  });
  const requestB = await call('/api/requests', {
    method: 'POST', body: { ...flightBody(), phone: '0790000882', destination: 'عمان-داخلي B' },
  });
  assert.equal(requestA.res.status, 201);
  assert.equal(requestB.res.status, 201);
  const rowA = app.db.prepare('SELECT id FROM requests WHERE reference = ?').get(requestA.payload.reference);
  const rowB = app.db.prepare('SELECT id FROM requests WHERE reference = ?').get(requestB.payload.reference);
  app.db.prepare('UPDATE requests SET branch_id = ?, department_id = ? WHERE id = ?').run(branchId, deptA.payload.id, rowA.id);
  app.db.prepare('UPDATE requests SET branch_id = ?, department_id = ? WHERE id = ?').run(branchId, deptB.payload.id, rowB.id);

  const loginA = await login('crmtesta', 'ScopedUserPass123');
  const loginB = await login('crmtestb', 'ScopedUserPass123');
  assert.equal(loginA.res.status, 200);
  assert.equal(loginB.res.status, 200);
  const scopedList = await call('/api/admin/requests', { cookie: loginA.cookie });
  assert.deepEqual(scopedList.payload.requests.map((request) => request.reference), [requestA.payload.reference]);
  const hiddenRequest = await call(`/api/admin/requests/${rowB.id}`, { cookie: loginA.cookie });
  assert.equal(hiddenRequest.res.status, 404);
  assert.equal((await call('/api/admin/organization', { cookie: loginA.cookie })).res.status, 403);

  const transfer = await call(`/api/admin/requests/${rowA.id}/transfers`, {
    method: 'POST', cookie: adminCookie,
    body: { departmentId: deptB.payload.id, userId: Number(app.db.prepare("SELECT id FROM users WHERE username = 'crmtestb'").get().id), note: 'تحويل للتنفيذ' },
  });
  assert.equal(transfer.res.status, 201);
  let owned = app.db.prepare('SELECT department_id, assigned_to FROM requests WHERE id = ?').get(rowA.id);
  assert.equal(owned.department_id, deptA.payload.id);
  assert.equal(owned.assigned_to, null);

  const incoming = await call('/api/admin/transfers', { cookie: loginB.cookie });
  assert.equal(incoming.res.status, 200);
  assert.ok(incoming.payload.transfers.some((item) => item.id === transfer.payload.transferId));
  const denied = await call(`/api/admin/transfers/${transfer.payload.transferId}/respond`, {
    method: 'POST', cookie: loginA.cookie, body: { decision: 'accept' },
  });
  assert.equal(denied.res.status, 403);
  const accepted = await call(`/api/admin/transfers/${transfer.payload.transferId}/respond`, {
    method: 'POST', cookie: loginB.cookie, body: { decision: 'accept' },
  });
  assert.equal(accepted.res.status, 200);
  owned = app.db.prepare('SELECT department_id, assigned_to, service_owner_id FROM requests WHERE id = ?').get(rowA.id);
  assert.equal(owned.department_id, deptB.payload.id);
  assert.equal(owned.assigned_to, Number(app.db.prepare("SELECT id FROM users WHERE username = 'crmtestb'").get().id));
  assert.equal(owned.service_owner_id, owned.assigned_to);
  assert.equal(app.db.prepare('SELECT status FROM request_transfers WHERE id = ?').get(transfer.payload.transferId).status, 'accepted');
});

test('تغيير حالة الطلب يحترم مسار الحالات', async () => {
  const row = app.db.prepare("SELECT id FROM requests WHERE type='flight' AND status='new' ORDER BY id DESC LIMIT 1").get();
  assert.ok(row, 'يلزم وجود طلب جديد للاختبار');
  const invalid = await call(`/api/admin/requests/${row.id}`, { method: 'PATCH', cookie: adminCookie, body: { status: 'confirmed' } });
  assert.equal(invalid.res.status, 422);
  const valid = await call(`/api/admin/requests/${row.id}`, { method: 'PATCH', cookie: adminCookie, body: { status: 'reviewing' } });
  assert.equal(valid.res.status, 200);
  const check = app.db.prepare('SELECT status FROM requests WHERE id = ?').get(row.id);
  assert.equal(check.status, 'reviewing');
  const back = await call(`/api/admin/requests/${row.id}`, { method: 'PATCH', cookie: adminCookie, body: { status: 'new' } });
  assert.equal(back.res.status, 422);
});

test('عرض السعر والملاحظات تُسجَّل وتظهر للعميل في التتبع', async () => {
  const row = app.db.prepare("SELECT id, reference FROM requests WHERE type='flight' ORDER BY id LIMIT 1").get();
  const payload = JSON.parse(app.db.prepare('SELECT payload FROM requests WHERE id = ?').get(row.id).payload);
  const update = await call(`/api/admin/requests/${row.id}`, { method: 'PATCH', cookie: adminCookie, body: { quoteAmount: 850, quoteNote: 'شامل الأمتعة', note: 'تم التواصل مع العميل' } });
  assert.equal(update.res.status, 200);
  const track = await call('/api/track', { method: 'POST', body: { reference: row.reference, phone: payload.phone } });
  assert.equal(track.payload.request.quote.amount, 850);
  const events = app.db.prepare('SELECT kind, message FROM request_events WHERE request_id = ?').all(row.id);
  assert.ok(events.some((e) => e.kind === 'quote'));
  assert.ok(events.some((e) => e.kind === 'note'));
});

test('قيمة عرض سالبة تُرفض', async () => {
  const row = app.db.prepare('SELECT id FROM requests ORDER BY id LIMIT 1').get();
  const { res } = await call(`/api/admin/requests/${row.id}`, { method: 'PATCH', cookie: adminCookie, body: { quoteAmount: -5 } });
  assert.equal(res.status, 422);
});

test('الموظف يرى الطلبات ولا يستطيع إدارة البرامج أو المستخدمين', async () => {
  const agentPass = ['Agent', 'Pass', '123'].join('');
  const created = await call('/api/admin/users', {
    method: 'POST', cookie: adminCookie,
    body: { username: 'agent1', name: 'موظف اختبار', role: 'agent', department: 'تذاكر الطيران', password: 'AgentPass123' },
  });
  assert.equal(created.res.status, 201);
  const session = await login('agent1', agentPass);
  assert.equal(session.res.status, 200);
  agentCookie = session.cookie;

  const list = await call('/api/admin/requests', { cookie: agentCookie });
  assert.equal(list.res.status, 200);
  assert.ok(list.payload.total >= 1);

  const program = await call('/api/admin/programs', { method: 'POST', cookie: agentCookie, body: { title: 'محاولة موظف', category: 'umrah' } });
  assert.equal(program.res.status, 403);

  const users = await call('/api/admin/users', { cookie: agentCookie });
  assert.equal(users.res.status, 403);
});

test('المدير ينشئ ويعدّل ويحذف برنامجاً', async () => {
  const created = await call('/api/admin/programs', {
    method: 'POST', cookie: adminCookie,
    body: {
      title: 'برنامج اختبار مؤقت', slug: 'test-temp-program', category: 'umrah', days: 5, nights: 4, priceFrom: 500,
      hotels: ['مكة المكرمة | فندق اختبار | 5 | 300 م'], itinerary: ['وصول', 'عمرة'], includes: ['طيران'], options: ['غرفة ثنائية | 520'],
    },
  });
  assert.equal(created.res.status, 201);
  const id = created.payload.id;
  const row = app.db.prepare('SELECT * FROM programs WHERE id = ?').get(id);
  assert.equal(row.status, 'published');
  assert.equal(JSON.parse(row.hotels)[0].name, 'فندق اختبار');

  const patched = await call(`/api/admin/programs/${id}`, { method: 'PATCH', cookie: adminCookie, body: { priceFrom: 480, status: 'draft' } });
  assert.equal(patched.res.status, 200);
  assert.equal(app.db.prepare('SELECT price_from FROM programs WHERE id = ?').get(id).price_from, 480);

  const del = await call(`/api/admin/programs/${id}`, { method: 'DELETE', cookie: adminCookie });
  assert.equal(del.res.status, 200);
  assert.equal(app.db.prepare('SELECT COUNT(*) n FROM programs WHERE id = ?').get(id).n, 0);
});

test('المحتوى المحقون يُهرَّب في HTML', async () => {
  const created = await call('/api/admin/programs', {
    method: 'POST', cookie: adminCookie,
    body: { title: '<script>alert(1)</script>', slug: 'xss-check', category: 'istanbul' },
  });
  assert.equal(created.res.status, 201);
  const page = await call('/programs/xss-check');
  assert.equal(page.res.status, 200);
  assert.ok(!page.payload.includes('<script>alert(1)</script>'), 'الحقن لم يُهرَّب');
  assert.match(page.payload, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
});

test('حماية CSRF: طلب من أصل مختلف أو بلا ترويسة يُرفض', async () => {
  const blocked = await call('/api/requests', { method: 'POST', body: flightBody(), headers: { 'x-requested-with': '' }, origin: 'https://evil.example' });
  assert.equal(blocked.res.status, 403);
  const allowed = await call('/api/requests', { method: 'POST', body: { ...flightBody(), phone: '0790000040' }, origin: base });
  assert.equal(allowed.res.status, 201);
});

test('تحديث الإعدادات ينعكس على الموقع', async () => {
  const update = await call('/api/admin/settings', { method: 'PATCH', cookie: adminCookie, body: { heroHeadline: 'عنوان تجريبي للاختبار' } });
  assert.equal(update.res.status, 200);
  const home = await call('/');
  assert.match(home.payload, /لوريت/);
  const setting = app.db.prepare("SELECT value FROM settings WHERE key='heroHeadline'").get();
  assert.equal(JSON.parse(setting.value), 'عنوان تجريبي للاختبار');
});

test('إعدادات الفيديو قابلة للتغيير من اللوحة وتنعكس على الواجهة', async () => {
  const off = await call('/api/admin/settings', { method: 'PATCH', cookie: adminCookie, body: { heroVideoUrl: '' } });
  assert.equal(off.res.status, 200);
  const without = await call('/');
  assert.ok(!without.payload.includes('id="heroVideo"'));
  const on = await call('/api/admin/settings', { method: 'PATCH', cookie: adminCookie, body: { heroVideoUrl: '/media/hero/hero-loop.mp4', heroPosterUrl: '/media/hero/hero-poster.jpg' } });
  assert.equal(on.res.status, 200);
  const again = await call('/');
  assert.match(again.payload, /id="heroVideo"/);
});

/* ---------------- assistant ---------------- */

test('المساعد يجيب عن العمرة من البيانات المنشورة فقط', async () => {
  const { res, payload } = await call('/api/assistant', { method: 'POST', body: { message: 'بدي برنامج عمرة اقتصادي' } });
  assert.equal(res.status, 200);
  assert.equal(payload.intent, 'umrah');
  assert.match(payload.reply, /برامج العمرة/);
  const prices = [...payload.reply.matchAll(/([\d,]{3,})\s*د\.أ/g)].map((m) => Number(m[1].replace(/,/g, '')));
  assert.ok(prices.length > 0, 'يجب أن يعرض سعراً من البيانات');
  for (const price of prices) {
    const found = app.db.prepare("SELECT COUNT(*) n FROM programs WHERE price_from = ?").get(price).n;
    assert.ok(found > 0, `السعر ${price} ليس من بيانات البرامج`);
  }
});

test('المساعد يرفض ضمان التأشيرة ويذكر المصدر', async () => {
  const guarantee = await call('/api/assistant', { method: 'POST', body: { message: 'هل تضمنون الموافقة على تأشيرة تركيا؟' } });
  assert.match(guarantee.payload.reply, /لا يمكن لأي جهة ضمان/);

  const visa = await call('/api/assistant', { method: 'POST', body: { message: 'ما متطلبات تأشيرة السعودية للعمرة؟' } });
  assert.match(visa.payload.reply, /لا نضمن الموافقة/);
  assert.ok(visa.payload.sources.some((s) => /visa\.mofa\.gov\.sa|السعودية|مركز التأشيرات/.test(`${s.label} ${s.url}`)));
});

test('المساعد يحوّل الأسئلة غير الموثقة إلى موظف ولا يخترع أرقاماً', async () => {
  const flight = await call('/api/assistant', { method: 'POST', body: { message: 'كم سعر تذكرة طيران عمّان طوكيو الأسبوع القادم؟' } });
  assert.equal(flight.payload.intent, 'flight');
  assert.ok(!/\d{3,}\s*د\.أ/.test(flight.payload.reply), 'يجب ألا يذكر سعراً مخترعاً للتذاكر');

  const { payload } = await call('/api/assistant', { method: 'POST', body: { message: 'هل تستخرجون تصديق شهادة ميلاد للسفر؟' } });
  assert.equal(payload.escalate, true);
  assert.match(payload.reply, /لم أجد معلومة موثوقة/);
  assert.ok(!/\d{3,}\s*د\.أ/.test(payload.reply), 'يجب ألا يذكر سعراً مخترعاً');
});

test('المحادثة لا تُحفظ بلا موافقة، وتُحفظ مع الموافقة', async () => {
  const before = app.db.prepare('SELECT COUNT(*) n FROM assistant_sessions').get().n;
  const anonymous = await call('/api/assistant', { method: 'POST', body: { message: 'مرحبا', consent: false } });
  assert.equal(anonymous.payload.sessionId, null);
  assert.equal(app.db.prepare('SELECT COUNT(*) n FROM assistant_sessions').get().n, before);

  const consented = await call('/api/assistant', { method: 'POST', body: { message: 'مرحبا، أريد برامج تركيا', consent: true } });
  assert.ok(consented.payload.sessionId);
  const after = app.db.prepare('SELECT COUNT(*) n FROM assistant_sessions').get().n;
  assert.equal(after, before + 1);
  const messages = app.db.prepare('SELECT role FROM assistant_messages WHERE session_id = (SELECT id FROM assistant_sessions WHERE sid = ?)').all(consented.payload.sessionId);
  assert.equal(messages.length, 2);
});

/* ---------------- hardening ---------------- */

test('حدود المعدل تمنع الإغراق', async () => {
  app.limiter.reset();
  let limited = 0;
  for (let i = 0; i < 24; i++) {
    const { res } = await call('/api/requests', { method: 'POST', body: { ...flightBody(), phone: `07900001${String(i).padStart(2, '0')}`, destination: `مدينة-${i}` } });
    if (res.status === 429) limited += 1;
  }
  assert.ok(limited > 0, 'لم يتم تطبيق حد المعدل');
  app.limiter.reset();
});

test('قفل المحاولات بعد 5 كلمات مرور خاطئة', async () => {
  for (let i = 0; i < 5; i++) await login('ghost-user', 'bad-password');
  const sixth = await login('ghost-user', 'bad-password');
  assert.equal(sixth.res.status, 429);
});

test('رأس CSP ونوع المحتوى يمنعان التنفيذ العرضي', async () => {
  const { res } = await call('/api/programs');
  assert.match(res.headers.get('content-type'), /application\/json/);
  assert.equal(res.headers.get('x-frame-options'), 'DENY');
  const page = await call('/');
  assert.match(page.res.headers.get('permissions-policy') || '', /geolocation=\(\)/);
});

test('سجل العمليات يوثّق تغييرات الموظفين', async () => {
  const { payload } = await call('/api/admin/audit', { cookie: adminCookie });
  assert.equal(payload.ok, true);
  const actions = payload.entries.map((e) => e.action);
  assert.ok(actions.includes('login'));
  assert.ok(actions.some((a) => a.startsWith('update-request')));
});

test('إحصاءات لوحة القيادة متوافقة مع قاعدة البيانات', async () => {
  const { payload } = await call('/api/admin/overview', { cookie: adminCookie });
  const dbTotal = app.db.prepare('SELECT COUNT(*) n FROM requests').get().n;
  assert.equal(payload.stats.total, dbTotal);
  assert.ok(payload.stats.byType.flight >= 1);
  assert.ok(Array.isArray(payload.recent));
});

test('رمز الدولة العالمي يعرض البلدان ورموز الهاتف المتوقعة', async () => {
  const { res, payload } = await call('/assets/data/phone-codes.json');
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'application/json; charset=utf-8');
  const countries = payload;
  assert.ok(countries.length >= 240);
  assert.equal(countries.find((country) => country.iso === 'JO').callingCode, '+962');
  assert.equal(countries.find((country) => country.iso === 'SA').callingCode, '+966');
  assert.equal(countries.find((country) => country.iso === 'AE').callingCode, '+971');
  assert.ok(countries.every((country) => country.flag && country.name));
  assert.ok(countries.every((country, index) => index === 0 || countries[index - 1].name.localeCompare(country.name, 'en') <= 0));
});

test('صفحة الحساب والملف الشخصي لا تظهر لمحركات البحث وتحمل واجهة العميل', async () => {
  const account = await call('/account');
  assert.equal(account.res.status, 200);
  assert.match(account.payload, /id="clientPortal"/);
  assert.match(account.payload, /data-initial-view="bookings"/);
  assert.match(account.payload, /name="robots" content="noindex,nofollow"/);
  assert.match(account.payload, /\/assets\/js\/account\.js\?v=/);

  const profile = await call('/account/profile');
  assert.equal(profile.res.status, 200);
  assert.match(profile.payload, /data-initial-view="profile"/);
  const script = await call('/assets/js/account.js');
  assert.equal(script.res.status, 200);
  assert.match(script.payload, /تحديث الحالات/);
});

test('حساب العميل يتطلب OTP قبل الدخول ويربط الطلبات القديمة والجديدة بأمان', async () => {
  const email = 'portal-client@example.test';
  const historical = await call('/api/requests', {
    method: 'POST',
    body: { ...flightBody(), phone: '0791234567', email, destination: 'برشلونة (BCN)' },
  });
  assert.equal(historical.res.status, 201);

  const registration = await call('/api/client/auth/register', {
    method: 'POST',
    body: {
      firstName: 'ليلى',
      lastName: 'السالم',
      email,
      password: 'PortalPass1234',
      phoneCountryCode: '+962',
      phone: '0791234567',
    },
  });
  assert.equal(registration.res.status, 201);
  assert.ok(!JSON.stringify(registration.payload).includes(otpInbox.get(email)), 'الـAPI لا يكشف رمز التحقق');
  assert.equal(registration.payload.user, undefined, 'التسجيل لا يمنح جلسة قبل تأكيد البريد');
  const stored = app.db.prepare('SELECT is_verified, otp_hash, otp_salt FROM clients WHERE email = ?').get(email);
  assert.equal(stored.is_verified, 0);
  assert.notEqual(stored.otp_hash, otpInbox.get(email));
  assert.equal((await clientLogin(email, 'PortalPass1234')).res.status, 403);
  const resend = await call('/api/client/auth/resend', { method: 'POST', body: { email } });
  assert.equal(resend.res.status, 200);
  assert.ok(!JSON.stringify(resend.payload).includes(otpInbox.get(email)));

  const wrongCode = otpInbox.get(email) === '000000' ? '000001' : '000000';
  const rejectedCode = await call('/api/client/auth/verify', {
    method: 'POST', body: { email, code: wrongCode },
  });
  assert.equal(rejectedCode.res.status, 400);

  const verified = await call('/api/client/auth/verify', {
    method: 'POST', body: { email, code: otpInbox.get(email) },
  });
  assert.equal(verified.res.status, 200);
  assert.equal(verified.payload.user.isVerified, true);
  const cookie = (verified.res.headers.get('set-cookie') || '').split(';')[0];
  assert.match(verified.res.headers.get('set-cookie'), /HttpOnly/);
  assert.match(verified.res.headers.get('set-cookie'), /SameSite=Strict/);

  const oldBookings = await call('/api/client/bookings', { cookie });
  assert.equal(oldBookings.res.status, 200);
  assert.deepEqual(oldBookings.payload.bookings.map((booking) => booking.reference), [historical.payload.reference]);
  assert.equal(oldBookings.payload.total, 1);
  assert.equal(oldBookings.payload.pages, 1);
  const cloneRequest = app.db.prepare(`INSERT INTO requests
    (reference, type, status, customer_id, client_id, department, title, summary, payload, source, consent, created_at, updated_at)
    SELECT ?, type, status, customer_id, client_id, department, title, summary, payload, source, consent, created_at, updated_at
    FROM requests WHERE reference = ?`);
  for (let index = 1; index <= 25; index++) {
    cloneRequest.run(`LT-FL-PG${String(index).padStart(4, '0')}`, historical.payload.reference);
  }
  const firstPage = await call('/api/client/bookings?page=1', { cookie });
  const lastPage = await call('/api/client/bookings?page=2', { cookie });
  assert.equal(firstPage.payload.bookings.length, 25);
  assert.equal(firstPage.payload.total, 26);
  assert.equal(firstPage.payload.pages, 2);
  assert.equal(lastPage.payload.bookings.length, 1);
  assert.equal(lastPage.payload.bookings[0].reference, historical.payload.reference);

  const created = await call('/api/requests', {
    method: 'POST',
    cookie,
    body: { ...flightBody(), phone: '0791234567', email, destination: 'مدريد (MAD)' },
  });
  assert.equal(created.res.status, 201);
  const request = app.db.prepare('SELECT id, client_id FROM requests WHERE reference = ?').get(created.payload.reference);
  assert.equal(request.client_id, verified.payload.user.id);
  const quote = await call(`/api/admin/requests/${request.id}`, {
    method: 'PATCH', cookie: adminCookie, body: { status: 'reviewing', quoteAmount: 525, quoteNote: 'عرض مبدئي للعميل' },
  });
  assert.equal(quote.res.status, 200);
  const dashboard = await call('/api/client/bookings', { cookie });
  const booking = dashboard.payload.bookings.find((item) => item.reference === created.payload.reference);
  assert.equal(booking.quote.amount, 525);
  assert.equal(booking.quote.note, 'عرض مبدئي للعميل');
  assert.ok(booking.timeline.some((event) => event.kind === 'status'));
  assert.equal('payload' in booking, false, 'ملف العميل لا يكشف الحمولة الداخلية للطلب');

  const profile = await call('/api/client/profile', {
    method: 'PATCH', cookie,
    body: { firstName: 'ليلى', lastName: 'النجار', phoneCountryCode: '+962', phone: '0797654321' },
  });
  assert.equal(profile.res.status, 200);
  assert.equal(profile.payload.user.lastName, 'النجار');
  assert.equal(profile.payload.user.phone, '+962797654321');
});

test('محاولات رمز التأكيد محدودة ولا تسمح بالدخول بعد تجاوز الحد', async () => {
  const email = 'otp-lock@example.test';
  const registration = await call('/api/client/auth/register', {
    method: 'POST',
    body: {
      firstName: 'سمر',
      lastName: 'اختبار',
      email,
      password: 'OtpLockPass123',
      phoneCountryCode: '+971',
      phone: '501234567',
    },
  });
  assert.equal(registration.res.status, 201);
  const otp = otpInbox.get(email);
  const wrongCode = otp === '000000' ? '000001' : '000000';
  for (let attempt = 0; attempt < 5; attempt++) {
    const rejected = await call('/api/client/auth/verify', { method: 'POST', body: { email, code: wrongCode } });
    assert.equal(rejected.res.status, 400);
  }
  const locked = await call('/api/client/auth/verify', { method: 'POST', body: { email, code: otp } });
  assert.equal(locked.res.status, 429);
  assert.equal((await clientLogin(email, 'OtpLockPass123')).res.status, 403);
});

test('طلبات العميل وسجل الحجز لا تظهر دون الجلسة أو لحساب آخر', async () => {
  const firstEmail = 'portal-client@example.test';
  const secondEmail = 'second-portal-client@example.test';
  const first = await clientLogin(firstEmail, 'PortalPass1234');
  assert.equal(first.res.status, 200);

  const unauthorized = await call('/api/client/bookings');
  assert.equal(unauthorized.res.status, 401);

  const registration = await call('/api/client/auth/register', {
    method: 'POST',
    body: {
      firstName: 'عمر',
      lastName: 'مستخدم',
      email: secondEmail,
      password: 'SecondPass1234',
      phoneCountryCode: '+966',
      phone: '501234567',
    },
  });
  assert.equal(registration.res.status, 201);
  const verified = await call('/api/client/auth/verify', {
    method: 'POST', body: { email: secondEmail, code: otpInbox.get(secondEmail) },
  });
  const secondCookie = (verified.res.headers.get('set-cookie') || '').split(';')[0];
  const secondBookings = await call('/api/client/bookings', { cookie: secondCookie });
  assert.equal(secondBookings.res.status, 200);
  assert.deepEqual(secondBookings.payload.bookings, []);

  const logout = await call('/api/client/auth/logout', { method: 'POST', cookie: first.cookie, body: {} });
  assert.equal(logout.res.status, 200);
  assert.equal((await call('/api/client/bookings', { cookie: first.cookie })).res.status, 401);
});
