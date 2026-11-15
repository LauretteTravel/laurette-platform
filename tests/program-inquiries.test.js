import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createApp } from '../server.js';
import { createSession } from '../lib/auth.js';

test('program inquiry uses published data, validates contacts and restricts staff by branch', async () => {
  const seed = JSON.parse(readFileSync(new URL('../data/seed.json', import.meta.url)));
  seed.users = [{ username: 'test-inquiry-admin', name: 'Admin', role: 'admin' }];
  const app = createApp({ dbFile: ':memory:', seed, adminPassword: 'Test-Inquiries-42' });
  const { port } = await app.listen(0);
  const base = 'http://127.0.0.1:' + port;
  const call = (path, method = 'GET', body, cookie) => fetch(base + path, {
    method, headers: { origin: base, ...(body && { 'content-type': 'application/json' }), ...(cookie && { cookie }) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const webhook = process.env.N8N_INQUIRY_WEBHOOK_URL;
  delete process.env.N8N_INQUIRY_WEBHOOK_URL;
  try {
    const program = app.db.prepare("SELECT id,slug,title FROM programs WHERE category='umrah' AND status='published' LIMIT 1").get();
    const details = await (await call('/api/inquiries/program?' + new URLSearchParams({ slug: program.slug }))).json();
    assert.equal(details.program.title, program.title);
    const catalogue = await (await call('/umrah')).text();
    assert.ok(catalogue.includes('data-program-inquiry="' + program.slug + '"'));
    assert.ok(catalogue.includes('data-program-details="' + program.slug + '"'));
    assert.match(await (await call('/programs/' + program.slug)).text(), /id="program-inquiry"/);

    const data = { program_id: program.id, program_title: 'forged', current_hotel: 'forged',
      inquiry_type: 'alternative_hotel', requested_hotel_notes: 'دار التوحيد', customer_name: 'عميل اختبار',
      customer_phone: '٠٧٩١٢٣٤٥٦٧', preferred_branch: 'amman' };
    assert.equal((await call('/api/inquiries', 'POST', { ...data, customer_phone: '000' })).status, 422);
    assert.equal((await call('/api/inquiries', 'POST', { ...data, program_id: 999999 })).status, 404);
    const created = await call('/api/inquiries', 'POST', data);
    assert.equal(created.status, 201);
    const result = await created.json();
    const wa = new URL(result.whatsapp_url);
    assert.equal(wa.pathname, '/962791192888');
    assert.ok(wa.searchParams.get('text').includes(program.title));
    assert.ok(wa.searchParams.get('text').includes('دار التوحيد'));
    assert.ok(wa.searchParams.get('text').includes('عميل اختبار'));

    assert.equal((await call('/api/admin/inquiries')).status, 401);
    const admin = app.db.prepare("SELECT id FROM users WHERE username='test-inquiry-admin'").get();
    const session = id => 'lt_session=' + createSession(app.db, id, '127.0.0.1', 'test', { mfaVerified: true }).token;
    const cookie = session(admin.id);
    const listing = await call('/api/admin/inquiries', 'GET', undefined, cookie);
    const list = await listing.json();
    assert.equal(listing.status, 200, JSON.stringify(list));
    assert.equal(list.new_count, 1);
    const stored = list.inquiries[0];
    assert.equal(stored.program_title, program.title);
    assert.equal(stored.current_hotel, details.program.current_hotel);
    assert.equal(stored.customer_phone, '+962791234567');

    const irbid = app.db.prepare("SELECT id FROM branches WHERE code='irbid'").get();
    const other = app.db.prepare("INSERT INTO users(username,name,role,role_key,branch_id,password_hash,password_salt,created_at) VALUES('inquiry-branch','Branch','manager','branch_manager',?,'test','test',?)")
      .run(irbid.id, new Date().toISOString());
    const otherCookie = session(Number(other.lastInsertRowid));
    const outside = await call('/api/admin/inquiries', 'GET', undefined, otherCookie);
    assert.equal(outside.status, 200);
    assert.deepEqual((await outside.json()).inquiries, []);
    const path = '/api/admin/inquiries/' + result.id;
    assert.equal((await call(path, 'PATCH', { status: 'تم التواصل' }, otherCookie)).status, 404);
    assert.equal((await call(path, 'PATCH', { status: 'تم التواصل' }, cookie)).status, 200);
    assert.equal((await (await call('/api/admin/inquiries?count=1', 'GET', undefined, cookie)).json()).new_count, 0);
  } finally {
    if (webhook !== undefined) process.env.N8N_INQUIRY_WEBHOOK_URL = webhook;
    await app.close();
  }
});
