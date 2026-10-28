import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync, readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { createApp } from '../server.js';

const DB = `data/test-i18n-${randomBytes(4).toString('hex')}.db`;
const seed = JSON.parse(readFileSync('data/seed.json', 'utf8'));
const testSeed = { ...seed, users: seed.users.map(({ password, ...user }) => user) };
let app;
let base;

const get = async (path) => {
  const res = await fetch(`${base}${path}`, { redirect: 'manual' });
  return { res, html: await res.text() };
};

before(async () => {
  for (const suffix of ['', '-wal', '-shm']) {
    try { rmSync(DB + suffix); } catch { /* ignore */ }
  }
  app = createApp({ dbFile: DB, baseUrl: 'http://127.0.0.1:0', seed: testSeed, adminPassword: 'Test-Only-Admin-Password-42' });
  const addr = await app.listen(0, '127.0.0.1');
  base = `http://127.0.0.1:${addr.port}`;
});

after(async () => {
  await app.close();
  for (const suffix of ['', '-wal', '-shm']) {
    try { rmSync(DB + suffix); } catch { /* ignore */ }
  }
});

test('الصفحة العربية تبقى كما هي على الجذر', async () => {
  const { res, html } = await get('/');
  assert.equal(res.status, 200);
  assert.match(html, /<html lang="ar" dir="rtl">/);
  assert.match(html, /الرئيسية/);
  assert.match(html, /hreflang="en"/);
});

test('النسخة الإنجليزية تخدم نفس الصفحة بالاتجاه الصحيح', async () => {
  const { res, html } = await get('/en');
  assert.equal(res.status, 200);
  assert.match(html, /<html lang="en" dir="ltr">/);
  assert.match(html, /Request a quote/);
  assert.doesNotMatch(html, /class="main-nav"[\s\S]{0,400}الرئيسية/);
  assert.match(html, /hreflang="ar"/);
  assert.match(html, /rel="canonical" href="http:\/\/127\.0\.0\.1:\d+\/en"/);
});

test('مبدّل اللغة يعيد إلى نفس المسار في اللغة الأخرى', async () => {
  const { html } = await get('/en/programs');
  assert.match(html, /class="lang-switch"[^>]*href="\/programs"/);
  const arabic = await get('/programs');
  assert.match(arabic.html, /class="lang-switch"[^>]*href="\/en\/programs"/);
});

test('صفحة برنامج إنجليزية تحمل تنبيه المحتوى وبيانات إنجليزية', async () => {
  const { res, html } = await get('/en/programs/umrah-p1');
  assert.equal(res.status, 200);
  assert.match(html, /Content note:/);
  assert.match(html, /JOD/);
  assert.match(html, /hreflang="en"/);
});

test('المسار العربي المسبوق بـ/ar يعيد التوجيه إلى الجذر', async () => {
  const { res } = await get('/ar/programs');
  assert.equal(res.status, 301);
  assert.equal(res.headers.get('location'), '/programs');
});

test('صفحة 404 الإنجليزية تظهر بالإنجليزية', async () => {
  const { res, html } = await get('/en/does-not-exist');
  assert.equal(res.status, 404);
  assert.match(html, /Page not found/);
});

test('قاموس الترجمة متاح للمتصفح', async () => {
  const { res, html } = await get('/i18n/en.json');
  assert.equal(res.status, 200);
  const dict = JSON.parse(html);
  assert.ok(Object.keys(dict).length > 500);
  assert.equal(dict['الحج والعمرة'], 'Hajj & Umrah');
});

test('خريطة الموقع تحمل نسختي اللغة وروابط بديلة', async () => {
  const { html } = await get('/sitemap.xml');
  assert.match(html, /xmlns:xhtml/);
  assert.match(html, /\/en<\/loc>/);
  assert.ok((html.match(/hreflang="en"/g) || []).length > 20);
  assert.ok((html.match(/hreflang="ar"/g) || []).length > 20);
});
