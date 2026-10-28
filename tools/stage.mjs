import fs from 'node:fs';
import { join, dirname, relative } from 'node:path';

const src = process.cwd();
const outRoot = join(src, '..', 'work', 'dist');
const dest = join(outRoot, 'laurette-platform');

const skipDirs = new Set(['shots', 'node_modules', '.git', 'dist']);
const skipFiles = new Set(['server.log', 'server.err.log']);

function copy(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const s = join(from, entry.name);
    const d = join(to, entry.name);
    if (entry.isDirectory()) {
      if (skipDirs.has(entry.name)) continue;
      copy(s, d);
      continue;
    }
    if (skipFiles.has(entry.name)) continue;
    if (/\.db(-wal|-shm)?$/.test(entry.name)) continue;
    if (/\.zip$/.test(entry.name)) continue;
    fs.copyFileSync(s, d);
  }
}

fs.rmSync(outRoot, { recursive: true, force: true });
copy(src, dest);

let files = 0;
let bytes = 0;
function count(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) count(p);
    else { files += 1; bytes += fs.statSync(p).size; }
  }
}
count(dest);
console.log('staged', files, 'files', (bytes / 1024 / 1024).toFixed(2), 'MB');
