/* Resets the admin password to a fresh random value and rewrites data/admin-credentials.txt.
   Run: node tools/reset-admin.mjs [username] */
import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { openDb, one, exec } from '../lib/db.js';
import { hashPassword } from '../lib/auth.js';

const db = openDb(process.argv[3] || 'data/laurette.db');
const username = process.argv[2] || 'laurette';
const user = one(db, 'SELECT id, username FROM users WHERE username = ?', [username]);
if (!user) {
  console.error(`لا يوجد مستخدم بالاسم ${username}`);
  process.exit(1);
}
const password = randomBytes(9).toString('base64url');
const { hash, salt } = hashPassword(password);
exec(db, 'UPDATE users SET password_hash = ?, password_salt = ?, must_change = 1 WHERE id = ?', [hash, salt, user.id]);
exec(db, 'DELETE FROM sessions WHERE user_id = ?', [user.id]);
writeFileSync('data/admin-credentials.txt', `اسم المستخدم: ${username}\nكلمة المرور المؤقتة: ${password}\n\nغيّر كلمة المرور بعد أول دخول من لوحة الإدارة.\n`, { encoding: 'utf8', mode: 0o600 });
console.log(readFileSync('data/admin-credentials.txt', 'utf8'));
db.close();
