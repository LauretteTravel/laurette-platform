import { readFileSync } from 'node:fs';

const creds = readFileSync('data/admin-credentials.txt', 'utf8');
const password = creds.match(/كلمة المرور المؤقتة:\s*(\S+)/)[1];
const base = 'http://127.0.0.1:3000';

const login = await fetch(`${base}/api/auth/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-requested-with': 'fetch' },
  body: JSON.stringify({ username: 'laurette', password }),
});
const cookie = (login.headers.get('set-cookie') || '').split(';')[0];
console.log('login', login.status);

const h = { cookie, 'x-requested-with': 'fetch' };
const media = await (await fetch(`${base}/api/admin/media`, { headers: h })).json();
console.log('media files', media.files.length, media.files.slice(0, 2));

const offers = await (await fetch(`${base}/api/admin/offers`, { headers: h })).json();
console.log('offers', offers.items.length, offers.items[0].title, offers.items[0].price_from, offers.items[0].image_url);

const target = offers.items.find((o) => o.slug === 'offer-istanbul');
const patch = await fetch(`${base}/api/admin/offers/${target.id}`, {
  method: 'PATCH', headers: { ...h, 'content-type': 'application/json' },
  body: JSON.stringify({ priceFrom: 265, includes: ['تذاكر الطيران', 'استقبال وتوديع'] }),
});
console.log('patch', patch.status, (await patch.json()).ok);
const after = await (await fetch(`${base}/api/admin/offers`, { headers: h })).json();
const updated = after.items.find((o) => o.slug === 'offer-istanbul');
console.log('updated', updated.price_from, JSON.parse(updated.includes).length);
await fetch(`${base}/api/admin/offers/${target.id}`, {
  method: 'PATCH', headers: { ...h, 'content-type': 'application/json' },
  body: JSON.stringify({ priceFrom: 259, includes: ['تذاكر الطيران على الملكية الأردنية', 'استقبال وتوديع', 'إفطار يومي', 'رحلة مجانية', 'جميع الضرائب'] }),
});
console.log('reverted');
