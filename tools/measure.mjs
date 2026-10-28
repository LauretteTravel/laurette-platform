const base = process.env.BASE || 'http://127.0.0.1:3000';
const pages = ['/', '/programs', '/programs/umrah-p1', '/jordan', '/offers'];

for (const p of pages) {
  const t0 = performance.now();
  const res = await fetch(base + p);
  const html = await res.text();
  const ttfb = performance.now() - t0;
  const external = [...html.matchAll(/(?:src|href)="(https?:\/\/[^"]+)"/g)].map((m) => m[1]);
  const localAssets = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((m) => m[1]);
  let assetBytes = 0;
  for (const a of new Set(localAssets)) {
    const r = await fetch(base + a);
    assetBytes += (await r.arrayBuffer()).byteLength;
  }
  console.log(`${p}\thtml=${(html.length / 1024).toFixed(1)}KB\tttfb=${ttfb.toFixed(0)}ms\tassets=${localAssets.length} (${(assetBytes / 1024).toFixed(0)}KB)\texternal=${external.length}${external.length ? ' -> ' + external.slice(0, 3).join(' ') : ''}`);
}
