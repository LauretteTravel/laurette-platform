import { readFileSync, writeFileSync } from 'node:fs';
const path = 'server.js';
const s = readFileSync(path, 'utf8');
const isCrlf = s.includes('\r\n');
const lines = isCrlf ? s.split('\r\n') : s.split('\n');
const eol = isCrlf ? '\r\n' : '\n';
let fixed = 0;
const out = lines.map((l) => {
  if (l.includes('عارض الكتالوج') && !l.trimStart().startsWith('//')) {
    fixed += 1;
    return l.replace(/^(\s*)/, '$1// ');
  }
  return l;
}).join(eol);
if (fixed === 0) { console.log('NOTHING TO FIX (maybe already fixed)'); process.exit(0); }
writeFileSync(path, out, 'utf8');
console.log('FIXED LINES:', fixed);
