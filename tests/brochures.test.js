import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { tokenHash } from '../lib/auth.js';
import { createApp } from '../server.js';

test('brochures require staff permission and support public search, ranges, download counts and removal', async () => {
  const seed = JSON.parse(readFileSync(new URL('../data/seed.json', import.meta.url)));
  seed.users = [{ username: 'brochure-admin', name: 'Admin', role: 'admin' },
    { username: 'brochure-agent', name: 'Agent', role: 'agent' }];
  const app = createApp({ dbFile: ':memory:', seed, adminPassword: 'Test-Brochures-42' });
  const { port } = await app.listen(0);
  const base = 'http://127.0.0.1:' + port;
  const call = (path, options) => fetch(base + path, { ...options, headers: { origin: base, ...options?.headers } });
  const login = async username => {
    const response = await call('/api/auth/login', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username, password: 'Test-Brochures-42' }),
    });
    assert.equal(response.status, 200);
    return response.headers.get('set-cookie').split(';')[0];
  };

  try {
    const page = await call('/brochures');
    assert.equal(page.status, 200);
    const markup = await page.text();
    assert.match(markup, /brochure-destinations/);
    assert.match(markup, /brochure-inquiry/);
    const admin = { cookie: await login('brochure-admin'), 'x-requested-with': 'fetch' };
    assert.equal((await call('/api/admin/brochures', { headers: admin })).status, 403);
    app.db.prepare('UPDATE sessions SET mfa_verified_at=? WHERE token_hash=?').run(new Date().toISOString(), tokenHash(admin.cookie.split('=')[1]));
    const agent = { cookie: await login('brochure-agent'), 'x-requested-with': 'fetch' };
    const form = (buffer, type = 'application/pdf') => {
      const data = new FormData();
      for (const [key, value] of Object.entries({ title: 'برنامج فيتنام', category: 'tourism',
        destination: 'فيتنام', duration: '10 أيام', starting_price: '1249 دينار' })) data.set(key, value);
      data.set('pdf', new Blob([buffer], { type }), 'program.pdf');
      return data;
    };
    const pdf = Buffer.from('%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n');
    assert.equal((await call('/api/brochures', { method: 'POST', body: form(pdf) })).status, 401);
    assert.equal((await call('/api/brochures', { method: 'POST', headers: agent, body: form(pdf) })).status, 403);
    assert.equal((await call('/api/brochures', { method: 'POST', headers: { ...admin, origin: 'https://unrelated.invalid' }, body: form(pdf) })).status, 403);
    assert.equal((await call('/api/brochures', { method: 'POST', headers: admin, body: form('not pdf') })).status, 415);
    assert.equal((await call('/api/brochures', { method: 'POST', headers: admin, body: form(Buffer.alloc(25 * 1024 * 1024 + 1)) })).status, 413);

    const valid = form(pdf);
    valid.set('cover', new Blob([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jR4sAAAAASUVORK5CYII=', 'base64')], { type: 'image/png' }), 'cover.png');
    const upload = await call('/api/brochures', { method: 'POST', headers: admin, body: valid });
    const data = await upload.json();
    assert.equal(upload.status, 201, JSON.stringify(data));
    const brochure = data.brochure;
    assert.equal((await call('/api/brochures?category=flights')).status, 200);
    const listed = await (await call('/api/brochures?' + new URLSearchParams({ category: 'tourism', q: 'فيتنام' }))).json();
    assert.equal(listed.brochures[0].title, 'برنامج فيتنام');
    assert.equal((await call(brochure.cover_image_url)).headers.get('content-type'), 'image/png');
    const map = async (query = '') => (await (await call('/api/brochures/map' + query)).json()).pins;
    assert.equal((await map())[0].lowest_price_jod, 1249);
    assert.deepEqual(await map('?category=flights'), []);
    const filtered = await (await call('/api/brochures?' + new URLSearchParams({ destination: 'فيتنام' }))).json();
    assert.deepEqual(filtered.brochures.map(row => row.id), [brochure.id]);
    const submitInquiry = (message, phone) => call('/api/inquiries', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ brochure_id: brochure.id, brochure_title: 'forged', message, phone }),
    });
    assert.equal((await submitInquiry('  ')).status, 422);
    assert.equal((await submitInquiry('هل الفندق مشمول؟', 'bad')).status, 422);
    const inquiry = await submitInquiry('هل الفندق مشمول؟');
    assert.equal(inquiry.status, 201);
    assert.equal((await submitInquiry('موعد الرحلة؟', '0791234567')).status, 201);
    const inquiryList = await (await call('/api/admin/inquiries', { headers: admin })).json();
    assert.equal(inquiryList.new_count, 2);
    assert.equal(inquiryList.inquiries[0].customer_phone, '+962791234567');
    assert.equal(inquiryList.inquiries[1].customer_phone, '');
    assert.equal(inquiryList.inquiries[1].brochure_title, brochure.title);
    assert.equal(inquiryList.inquiries[1].brochure_id, brochure.id);

    const preview = await call(brochure.preview_url, { headers: { range: 'bytes=0-7' } });
    assert.equal(preview.status, 206);
    assert.equal(preview.headers.get('x-frame-options'), 'SAMEORIGIN');
    assert.match(preview.headers.get('content-disposition'), /^inline/);
    assert.equal(await preview.text(), '%PDF-1.7');
    assert.equal((await call(brochure.preview_url, { headers: { range: 'bytes=1000-' } })).status, 416);
    const download = await call(brochure.download_url);
    assert.equal(download.status, 200);
    assert.match(download.headers.get('content-disposition'), /^attachment;.*filename\*=UTF-8''%/);
    assert.deepEqual(Buffer.from(await download.arrayBuffer()), pdf);
    assert.equal((await (await call('/api/admin/brochures', { headers: admin })).json()).brochures[0].download_count, 1);

    const path = '/api/brochures/' + brochure.id;
    const edit = await call(path, {
      method: 'PATCH',
      headers: { ...admin, 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'فيتنام الجديدة', category: 'seasonal', destination: 'فيتنام' }),
    });
    assert.equal(edit.status, 200);
    const seasonal = await (await call('/api/brochures?category=seasonal')).json();
    assert.equal(seasonal.brochures[0].title, 'فيتنام الجديدة');
    assert.equal((await call(path + '/toggle', { method: 'PATCH', headers: admin })).status, 200);
    assert.equal((await call(brochure.download_url)).status, 404);
    assert.deepEqual(await map(), []);
    assert.equal((await submitInquiry('هل السعر شامل؟')).status, 404);
    assert.equal((await call(brochure.cover_image_url)).status, 404);
    assert.equal((await (await call('/api/brochures')).json()).brochures.length, 0);
    assert.equal((await call(path, { method: 'DELETE', headers: admin })).status, 200);
    assert.equal(app.db.prepare('SELECT COUNT(*) AS count FROM tour_brochure_files').get().count, 0);
    const historical = app.db.prepare('SELECT brochure_id,brochure_title FROM program_inquiries ORDER BY id LIMIT 1').get();
    assert.equal(historical.brochure_id, null);
    assert.equal(historical.brochure_title, brochure.title);
  } finally {
    await app.close();
  }
});
