import { rmSync } from 'node:fs';
import { createApp } from '../server.js';

const dbFile = 'data/smoke.db';
for (const suffix of ['', '-wal', '-shm']) {
  try { rmSync(dbFile + suffix); } catch { /* ignore */ }
}

const port = 3111;
const app = createApp({ dbFile, baseUrl: `http://127.0.0.1:${port}` });
await app.listen(port, '127.0.0.1');

const paths = ['/', '/programs', '/programs/umrah-p1', '/umrah', '/flights', '/hotels', '/visa', '/consult', '/destinations', '/destinations/mecca', '/guide', '/faq', '/track', '/about', '/privacy', '/news', '/admin', '/sitemap.xml', '/robots.txt', '/health', '/art/haram.svg?v=1'];
let failures = 0;
for (const path of paths) {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, { redirect: 'manual' });
  const body = await res.text();
  const ok = res.status === 200;
  if (!ok) failures += 1;
  console.log(`${ok ? 'OK ' : 'BAD'} ${res.status} ${path} (${body.length} bytes)`);
  if (!ok) console.log('   ', body.slice(0, 300).replace(/\s+/g, ' '));
}
for (const path of ['/guide/best-umrah-season', '/guide/nonexistent']) {
  const res = await fetch(`http://127.0.0.1:${port}${path}`);
  console.log(`${res.status} ${path}`);
}
const res = await fetch(`http://127.0.0.1:${port}/api/programs?category=umrah&limit=1`);
const data = await res.json();
console.log('api programs:', res.status, data.programs?.length, data.programs?.[0]?.title);

await app.close();
console.log(failures ? `FAILURES: ${failures}` : 'SMOKE OK');
