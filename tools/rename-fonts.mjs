import fs from 'node:fs';
import path from 'node:path';

const dir = path.join('public', 'assets', 'fonts');
let css = fs.readFileSync(path.join(dir, 'cairo.css'), 'utf8');

const faces = [...css.matchAll(/@font-face\{[^}]*\}/g)].map((m) => m[0]);
const classify = (range = '') => {
  if (range.includes('U+0600')) return 'arabic';
  if (range.includes('U+0000-00FF') || range.includes('U+0000-00FF')) return 'latin';
  if (range.startsWith('U+0000')) return 'latin';
  return 'latin-ext';
};

const mapping = new Map();
for (const face of faces) {
  const file = /url\(\/assets\/fonts\/([^)]+)\)/.exec(face)?.[1];
  const range = /unicode-range:([^;]+);/.exec(face)?.[1] || '';
  if (!file || mapping.has(file)) continue;
  mapping.set(file, `cairo-${classify(range)}.woff2`);
}

for (const [oldName, newName] of mapping) {
  fs.renameSync(path.join(dir, oldName), path.join(dir, newName));
  css = css.split(`/assets/fonts/${oldName}`).join(`/assets/fonts/${newName}`);
}
fs.writeFileSync(path.join(dir, 'cairo.css'), css, 'utf8');

console.log('renamed', [...mapping.entries()].map(([a, b]) => `${a} -> ${b}`).join(', '));
console.log('arabic file bytes', fs.statSync(path.join(dir, 'cairo-arabic.woff2')).size);
console.log(css.slice(0, 200));
