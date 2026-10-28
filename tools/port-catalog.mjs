import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const git = (...args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });

const theirPublic = git('show', 'origin/main:lib/views/public.js');
const theirCss = git('show', 'origin/main:public/assets/css/app.css');

// ---- function extraction ----
const start = theirPublic.indexOf('export function programsPrintPage(ctx) {');
if (start < 0) throw new Error('print function not found');
const endMarker = theirPublic.indexOf('\n}\n', start);
if (endMarker < 0) throw new Error('end not found');
const fn = theirPublic.slice(start, endMarker + 3);
console.log('function chars:', fn.length, '| first:', fn.split('\n')[0], '| last:', fn.trim().split('\n').pop());

// ---- css extraction ----
const cssStart = theirCss.indexOf('.catalog-tools {');
if (cssStart < 0) throw new Error('catalog css not found');
let css = theirCss.slice(cssStart).trimEnd();
console.log('css chars:', css.length, '| last line:', css.split('\n').pop());

const pubPath = 'lib/views/public.js';
const cssPath = 'public/assets/css/app.css';
const pub = fs.readFileSync(pubPath, 'utf8');
if (pub.includes('programsPrintPage')) {
  console.log('public.js already has the function — skipping append');
} else {
  fs.writeFileSync(pubPath, pub.trimEnd() + '\n\n/* ============================ PRINT CATALOG ============================ */\n\n' + fn + '\n', 'utf8');
  console.log('appended function to public.js');
}
const appCss = fs.readFileSync(cssPath, 'utf8');
if (appCss.includes('.catalog-tools')) {
  console.log('css already present — skipping');
} else {
  fs.writeFileSync(cssPath, appCss.trimEnd() + '\n\n/* ===================== PRINTABLE CATALOG ===================== */\n' + css + '\n', 'utf8');
  console.log('appended catalog css');
}
