import fs from 'node:fs';

const file = 'data/seed.json';
const seed = JSON.parse(fs.readFileSync(file, 'utf8'));
let removed = 0;
for (const u of seed.users || []) {
  for (const key of ['password', 'passwordHash', 'password_hash', 'password_salt']) {
    if (key in u) { delete u[key]; removed += 1; }
  }
}
fs.writeFileSync(file, JSON.stringify(seed, null, 2) + '\n', 'utf8');
console.log('removed fields:', removed, '| users:', (seed.users || []).map((u) => u.username).join(','));
