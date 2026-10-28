import fs from 'node:fs';
import path from 'node:path';

const html = fs.readFileSync('legacy/legacy-site-original.html', 'utf8');
const m = /--logo:url\(data:image\/(png|jpeg|svg\+xml);base64,([A-Za-z0-9+/=]+)\)/.exec(html);
if (!m) { console.log('LOGO NOT FOUND'); process.exit(1); }
const ext = m[1] === 'jpeg' ? 'jpg' : m[1].startsWith('svg') ? 'svg' : 'png';
const buf = Buffer.from(m[2], 'base64');
const outDir = path.join('public', 'media', 'brand');
fs.mkdirSync(outDir, { recursive: true });
const file = path.join(outDir, `logo.${ext}`);
fs.writeFileSync(file, buf);
console.log('saved', file, buf.length, 'bytes', 'type', ext);
