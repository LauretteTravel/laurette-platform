import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const git = (...args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
const cssPath = 'public/assets/css/app.css';
const marker = '/* ===================== PRINTABLE CATALOG ===================== */';

let app = fs.readFileSync(cssPath, 'utf8');
const at = app.indexOf(marker);
if (at < 0) throw new Error('catalog marker missing');
app = app.slice(0, at).trimEnd() + '\n';
fs.writeFileSync(cssPath, app, 'utf8');
console.log('removed previously appended block, css now', app.length, 'chars');

const theirCss = git('show', 'origin/main:public/assets/css/app.css');
const start = theirCss.indexOf('.catalog-tools {');
const printIdx = theirCss.indexOf('@media print {', start);
if (start < 0 || printIdx < 0) throw new Error('catalog section not found');

// walk braces from the @media print block to its matching close
let depth = 0;
let end = -1;
for (let i = theirCss.indexOf('{', printIdx); i < theirCss.length; i += 1) {
  const ch = theirCss[i];
  if (ch === '{') depth += 1;
  else if (ch === '}') {
    depth -= 1;
    if (depth === 0) { end = i + 1; break; }
  }
}
if (end < 0) throw new Error('unbalanced print block');
const block = theirCss.slice(start, end).trimEnd();
console.log('catalog css chars:', block.length, '| last:', block.split('\n').pop());

fs.writeFileSync(cssPath, fs.readFileSync(cssPath, 'utf8').trimEnd() + '\n\n' + marker + '\n' + block + '\n', 'utf8');
console.log('css now', fs.readFileSync(cssPath, 'utf8').length, 'chars');
