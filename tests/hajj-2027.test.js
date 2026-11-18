import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createApp } from '../server.js';
import { one } from '../lib/db.js';

test('Hajj landing serves standalone assets and saves interest in the existing request inbox', async () => {
  const seed = JSON.parse(readFileSync(new URL('../data/seed.json', import.meta.url)));
  const app = createApp({ dbFile: ':memory:', seed, adminPassword: 'Hajj-Test-2027-Only' });
  const { port } = await app.listen(0);
  const base = `http://127.0.0.1:${port}`;
  try {
    const page = await fetch(base + '/hajj-2027.html');
    assert.equal(page.status, 200);
    const markup = await page.text();
    assert.match(markup, /الحج المميّز<br><em>مع لوريت/);
    assert.match(markup, /شعار الحج المميز 1448هـ — 2027م/);
    assert.doesNotMatch(markup, /نقطة انطلاق رحلة الصعود/);
    for (const asset of ['/assets/css/hajj-2027.css', '/assets/js/hajj-2027.js', '/assets/img/hajj-2027/season-cover.jpg', '/assets/img/hajj-2027/makkah.jpg', '/assets/img/hajj-2027/madinah.jpg']) {
      assert.equal((await fetch(base + asset)).status, 200, asset);
    }
    const response = await fetch(base + '/api/requests', { method: 'POST',
      headers: { origin: base, 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'consult', topic: 'umrah', channel: 'whatsapp', name: 'حاج تجريبي', phone: '0791234567', consent: true, source: 'hajj-2027', message: 'اهتمام بالحج المميز 1448هـ - 2027م، برنامج الحج 3، عدد الأفراد: 4.' }),
    });
    const result = await response.json();
    assert.equal(response.status, 201, JSON.stringify(result));
    assert.ok(result.reference);
    const stored = one(app.db, 'SELECT * FROM requests WHERE reference=?', [result.reference]);
    assert.equal(stored.type, 'consult');
    assert.match(JSON.parse(stored.payload).message, /برنامج الحج 3/);
  } finally { await app.close(); }
});
