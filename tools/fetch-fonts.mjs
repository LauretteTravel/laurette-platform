import fs from 'node:fs';
import path from 'node:path';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const url = 'https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800&display=swap';
const res = await fetch(url, { headers: { 'user-agent': UA } });
const css = await res.text();
console.log('css status', res.status, 'len', css.length);

const outDir = path.join('public', 'assets', 'fonts');
fs.mkdirSync(outDir, { recursive: true });

const blocks = css.split('@font-face').slice(1);
const faces = [];
for (const raw of blocks) {
  const block = raw.split('}')[0] + '}';
  const family = /font-family:\s*'([^']+)'/.exec(block)?.[1];
  const weight = /font-weight:\s*(\d+)/.exec(block)?.[1];
  const src = /url\((https:[^)]+\.woff2)\)/.exec(block)?.[1];
  const range = /unicode-range:\s*([^;]+);/.exec(block)?.[1]?.trim();
  if (!src) continue;
  faces.push({ family, weight, src, range });
}
console.log('faces', faces.length, 'families', [...new Set(faces.map((f) => f.family))].join(','));

const seen = new Map();
let total = 0;
for (const f of faces) {
  let name = seen.get(f.src);
  if (!name) {
    name = `cairo-${f.weight}-${seen.size}.woff2`;
    const buf = Buffer.from(await (await fetch(f.src, { headers: { 'user-agent': UA } })).arrayBuffer());
    fs.writeFileSync(path.join(outDir, name), buf);
    total += buf.length;
    seen.set(f.src, name);
  }
  f.file = name;
}
console.log('files', seen.size, 'bytes', total);

const local = faces.map((f) => `@font-face{font-family:'Cairo';font-style:normal;font-weight:${f.weight};font-display:swap;src:url(/assets/fonts/${f.file}) format('woff2');${f.range ? `unicode-range:${f.range};` : ''}}`).join('\n');
fs.writeFileSync(path.join(outDir, 'cairo.css'), local, 'utf8');
console.log('wrote cairo.css', local.length);
