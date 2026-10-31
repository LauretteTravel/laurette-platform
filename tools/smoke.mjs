import { rmSync, readFileSync } from 'node:fs';
import { createApp } from '../server.js';

const dbFile = 'data/smoke.db';
for (const suffix of ['', '-wal', '-shm']) {
  try { rmSync(dbFile + suffix); } catch { /* ignore */ }
}

const port = 3111;
const seed = JSON.parse(readFileSync('data/seed.json','utf8'));
const app = createApp({ dbFile, adminPassword: 'Synthetic-Smoke-Password42', seed: { ...seed, users: seed.users.map(({password, ...u}) => u) }, baseUrl: `http://127.0.0.1:${port}` });
await app.listen(port, '127.0.0.1');

const paths = ['/', '/programs', '/programs/print', '/account', '/account/profile', '/programs/umrah-p1', '/umrah', '/flights', '/hotels', '/visa', '/consult', '/destinations', '/destinations/mecca', '/guide', '/faq', '/track', '/about', '/privacy', '/news', '/admin', '/sitemap.xml', '/robots.txt', '/health', '/art/haram.svg?v=1'];
let failures = 0;
for (const path of paths) {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, { redirect: 'manual' });
  const body = await res.text();
  const ok = res.status === 200;
  if (!ok) failures += 1;
  console.log(`${ok ? 'OK ' : 'BAD'} ${res.status} ${path} (${body.length} bytes)`);
  if (!ok) console.log('   ', body.slice(0, 300).replace(/\s+/g, ' '));
}
const article = app.db.prepare("SELECT slug FROM articles WHERE status='published' ORDER BY id LIMIT 1").get();
for (const path of [`/guide/${article.slug}`, '/guide/nonexistent']) {
  const res = await fetch(`http://127.0.0.1:${port}${path}`);
  const expected = path.endsWith('nonexistent') ? 404 : 200;
  if (res.status !== expected) failures += 1;
  console.log(`${res.status === expected ? 'OK' : 'BAD'} ${res.status} ${path}`);
}
const res = await fetch(`http://127.0.0.1:${port}/api/programs?category=umrah&limit=1`);
const data = await res.json();
if (res.status !== 200 || data.programs?.length !== 1) failures += 1;
console.log('api programs:', res.status, data.programs?.length, data.programs?.[0]?.title);

await app.close();
console.log(failures ? `FAILURES: ${failures}` : 'SMOKE OK');

process.exitCode = failures ? 1 : 0;
