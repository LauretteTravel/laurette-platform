import { DatabaseSync } from 'node:sqlite';

const db = new DatabaseSync('data/laurette.db');
const rows = db.prepare("SELECT title, COUNT(*) n FROM programs WHERE category = 'umrah' GROUP BY title ORDER BY n DESC LIMIT 10").all();
console.log(rows.map((r) => `${r.n} × ${r.title}`).join('\n'));
console.log('umrah total', db.prepare("SELECT COUNT(*) n FROM programs WHERE category = 'umrah'").get().n);
const codes = db.prepare("SELECT id, title, price_from, days FROM programs WHERE category = 'umrah' ORDER BY id LIMIT 6").all();
console.log(codes.map((r) => `${r.id} | ${r.title} | ${r.price_from} | ${r.days}`).join('\n'));
