import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const creds = readFileSync('data/admin-credentials.txt', 'utf8');
const password = creds.match(/كلمة المرور المؤقتة:\s*(\S+)/)[1];
const res = await fetch('http://127.0.0.1:3000/api/auth/login', {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-requested-with': 'fetch' },
  body: JSON.stringify({ username: 'laurette', password }),
});
const data = await res.json();
console.log('login', res.status, data.ok, data.user?.role);
const cookie = (res.headers.get('set-cookie') || '').split(';')[0];
const overview = await (await fetch('http://127.0.0.1:3000/api/admin/overview', { headers: { cookie } })).json();
console.log('requests total', overview.stats.total, '| programs', (await (await fetch('http://127.0.0.1:3000/api/admin/programs', { headers: { cookie } })).json()).items.length);
const db = new DatabaseSync('data/laurette.db');
console.log('db counts', {
  requests: db.prepare('SELECT COUNT(*) n FROM requests').get().n,
  customers: db.prepare('SELECT COUNT(*) n FROM customers').get().n,
  programs: db.prepare('SELECT COUNT(*) n FROM programs').get().n,
  levelNotNull: db.prepare("SELECT COUNT(*) n FROM programs WHERE level IS NOT NULL").get().n,
});
db.close();
