import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { exec, one } from './db.js';
import { isoNow } from './util.js';

const SESSION_HOURS = 8;
const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export function hashPassword(password, salt = randomBytes(16).toString('hex')) {
  const hash = scryptSync(String(password), salt, 64, SCRYPT).toString('hex');
  return { hash, salt };
}

export function verifyPassword(password, hash, salt) {
  try {
    const expected = Buffer.from(String(hash), 'hex');
    const actual = scryptSync(String(password), String(salt), expected.length, SCRYPT);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

export function tokenHash(token) {
  return createHash('sha256').update(String(token)).digest('hex');
}

export function createSession(db, userId, ip, ua) {
  const token = randomBytes(32).toString('hex');
  const now = new Date();
  const expires = new Date(now.getTime() + SESSION_HOURS * 3600 * 1000);
  exec(db, 'INSERT INTO sessions (token_hash, user_id, created_at, expires_at, ip, ua) VALUES (?,?,?,?,?,?)', [
    tokenHash(token), userId, now.toISOString(), expires.toISOString(), ip || null, String(ua || '').slice(0, 200),
  ]);
  return { token, expiresAt: expires.toISOString() };
}

export function sessionUser(db, token) {
  if (!token) return null;
  const row = one(db, `SELECT s.token_hash, s.expires_at, u.id, u.username, u.name, u.role, u.department, u.active,
      u.must_change, u.role_key, u.branch_id, u.department_id, r.name AS role_name, r.data_scope, r.permissions
      FROM sessions s JOIN users u ON u.id = s.user_id
      LEFT JOIN role_definitions r ON r.role_key = u.role_key AND r.active = 1
      WHERE s.token_hash = ?`, [tokenHash(token)]);
  if (!row) return null;
  if (new Date(row.expires_at).getTime() < Date.now() || !row.active) {
    exec(db, 'DELETE FROM sessions WHERE token_hash = ?', [tokenHash(token)]);
    return null;
  }
  let permissions = null;
  if (row.permissions) {
    try {
      const parsed = JSON.parse(row.permissions);
      if (Array.isArray(parsed) && parsed.every((permission) => typeof permission === 'string')) permissions = parsed;
    } catch { permissions = null; }
  }
  if (row.role_key && !permissions) return null;
  return {
    id: row.id,
    username: row.username,
    name: row.name,
    role: row.role,
    roleKey: row.role_key,
    roleName: row.role_name || null,
    department: row.department,
    departmentId: row.department_id,
    branchId: row.branch_id,
    dataScope: row.data_scope || 'organization',
    permissions,
    mustChange: !!row.must_change,
  };
}

export function destroySession(db, token) {
  if (token) exec(db, 'DELETE FROM sessions WHERE token_hash = ?', [tokenHash(token)]);
}

export function purgeExpiredSessions(db) {
  exec(db, 'DELETE FROM sessions WHERE expires_at < ?', [isoNow()]);
}

const PERMISSIONS = {
  admin: ['*'],
  manager: ['requests:read', 'requests:write', 'customers:read', 'customers:write', 'programs:read', 'programs:write',
    'content:write', 'visa:write', 'kb:write', 'audit:read', 'overview:read', 'reports:read'],
  agent: ['requests:read', 'requests:write', 'customers:read', 'customers:write', 'programs:read', 'overview:read', 'kb:write'],
};

export function can(user, action) {
  if (!user) return false;
  const perms = Array.isArray(user.permissions) ? user.permissions : (PERMISSIONS[user.role] || []);
  return perms.includes('*') || perms.includes(action);
}

/* Login throttling: per IP + username, 5 failures then a 10 minute lockout. */
const attempts = new Map();
const WINDOW_MS = 10 * 60 * 1000;
const MAX_FAILS = 5;

export function loginBlocked(key) {
  const rec = attempts.get(key);
  if (!rec) return 0;
  if (Date.now() - rec.first > WINDOW_MS) { attempts.delete(key); return 0; }
  if (rec.fails >= MAX_FAILS) return Math.ceil((WINDOW_MS - (Date.now() - rec.first)) / 1000);
  return 0;
}

export function loginFailed(key) {
  const rec = attempts.get(key);
  if (!rec || Date.now() - rec.first > WINDOW_MS) {
    attempts.set(key, { fails: 1, first: Date.now() });
    return;
  }
  rec.fails += 1;
}

export function loginSucceeded(key) {
  attempts.delete(key);
}

export function resetThrottle() {
  attempts.clear();
}
