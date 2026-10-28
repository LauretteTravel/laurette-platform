import { createHash, randomBytes, randomInt } from 'node:crypto';
import { exec, one } from './db.js';
import { hashPassword, verifyPassword } from './auth.js';
import { isoNow } from './util.js';

export const CLIENT_COOKIE = 'lt_customer_session';
const SESSION_DAYS = 30;

function tokenHash(token) {
  return createHash('sha256').update(String(token)).digest('hex');
}

export function createClientSession(db, clientId, ip, ua) {
  const token = randomBytes(32).toString('hex');
  const now = new Date();
  const expires = new Date(now.getTime() + SESSION_DAYS * 86400000);
  exec(db, 'INSERT INTO client_sessions (token_hash, client_id, created_at, expires_at, ip, ua) VALUES (?,?,?,?,?,?)', [
    tokenHash(token), clientId, now.toISOString(), expires.toISOString(), ip || null, String(ua || '').slice(0, 200),
  ]);
  return { token, expiresAt: expires.toISOString() };
}

export function clientSessionUser(db, token) {
  if (!token) return null;
  const hash = tokenHash(token);
  const row = one(db, `SELECT s.expires_at, c.id, c.email, c.first_name, c.last_name, c.phone_e164, c.is_verified
    FROM client_sessions s JOIN clients c ON c.id = s.client_id WHERE s.token_hash = ?`, [hash]);
  if (!row) return null;
  if (new Date(row.expires_at).getTime() < Date.now() || !row.is_verified) {
    exec(db, 'DELETE FROM client_sessions WHERE token_hash = ?', [hash]);
    return null;
  }
  return {
    id: row.id,
    email: row.email,
    firstName: row.first_name,
    lastName: row.last_name,
    name: `${row.first_name} ${row.last_name}`,
    phone: row.phone_e164,
  };
}

export function destroyClientSession(db, token) {
  if (token) exec(db, 'DELETE FROM client_sessions WHERE token_hash = ?', [tokenHash(token)]);
}

export function publicClient(row) {
  return {
    id: row.id,
    email: row.email,
    firstName: row.first_name,
    lastName: row.last_name,
    phone: row.phone_e164,
    isVerified: !!row.is_verified,
  };
}

export function issueEmailOtp() {
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  const { hash, salt } = hashPassword(code);
  return { code, salt, hash, expiresAt: new Date(Date.now() + 10 * 60_000).toISOString() };
}

export function emailOtpMatches(code, salt, hash) {
  return verifyPassword(code, hash, salt);
}
