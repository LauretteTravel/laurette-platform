import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
  createHash,
} from "node:crypto";
import { transaction } from "./db.js";
import { HttpError, readJson, json, cookie } from "./http.js";
import {
  createSession,
  destroySession,
  tokenHash,
  verifyPassword,
  loginBlocked,
  loginFailed,
  loginSucceeded,
} from "./auth.js";

const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export function base32(bytes) {
  let bits = 0,
    value = 0,
    out = "";
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits) out += alphabet[(value << (5 - bits)) & 31];
  return out;
}
function decode32(text) {
  let bits = 0,
    value = 0,
    out = [];
  for (const c of text) {
    const n = alphabet.indexOf(c);
    if (n < 0) throw new Error("Invalid TOTP secret");
    value = (value << 5) | n;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}
export function totp(secret, step = Math.floor(Date.now() / 30000)) {
  const b = Buffer.alloc(8);
  b.writeBigUInt64BE(BigInt(step));
  const h = createHmac("sha1", decode32(secret)).update(b).digest();
  const offset = h[19] & 15;
  return String((h.readUInt32BE(offset) & 0x7fffffff) % 1e6).padStart(6, "0");
}
function equal(a, b) {
  const x = Buffer.from(String(a)),
    y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}
function encryptionKey() {
  const key = Buffer.from(process.env.STAFF_MFA_ENCRYPTION_KEY || "", "base64");
  if (key.length !== 32)
    throw new HttpError(503, "يلزم إعداد مفتاح تشفير MFA على الخادم");
  return key;
}
function encrypt(text) {
  const iv = randomBytes(12),
    c = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  return Buffer.concat([
    iv,
    c.update(text, "utf8"),
    c.final(),
    c.getAuthTag(),
  ]).toString("base64");
}
function decrypt(text) {
  const b = Buffer.from(text, "base64"),
    d = createDecipheriv("aes-256-gcm", encryptionKey(), b.subarray(0, 12));
  d.setAuthTag(b.subarray(-16));
  try {
    return Buffer.concat([d.update(b.subarray(12, -16)), d.final()]).toString(
      "utf8",
    );
  } catch {
    throw new HttpError(503, "تعذر فك إعداد MFA؛ راجع مفتاح الخادم");
  }
}
const recoveryHash = (userId, code) =>
  createHash("sha256")
    .update(`${userId}:${String(code).trim().toLowerCase()}`)
    .digest("hex");
export function mfaRequired(user) {
  const p = user?.permissions;
  return Boolean(
    user &&
      ((!user.roleKey && user.role === "admin") ||
        (Array.isArray(p) &&
          p.some((x) =>
            [
              "*",
              "users:write",
              "users:admin",
              "organization:write",
              "settings:write",
            ].includes(x),
          ))),
  );
}
export function challengeLogin(db, userId) {
  const token = randomBytes(32).toString("hex");
  db.prepare(
    "DELETE FROM staff_mfa_challenges WHERE expires_at < ? OR user_id=?",
  ).run(Date.now(), userId);
  db.prepare("INSERT INTO staff_mfa_challenges VALUES (?,?,?,0)").run(
    tokenHash(token),
    userId,
    Date.now() + 5 * 60000,
  );
  return token;
}
function consume(db, userId, code, { allowRecovery = true } = {}) {
  const row = db.prepare("SELECT * FROM staff_mfa WHERE user_id=?").get(userId);
  if (!row) return false;
  const step = Math.floor(Date.now() / 30000),
    secret = decrypt(row.secret_ciphertext);
  for (const s of [step, step - 1, step + 1])
    if (s > row.last_step && equal(totp(secret, s), code))
      return Boolean(
        db
          .prepare(
            "UPDATE staff_mfa SET last_step=? WHERE user_id=? AND last_step<?",
          )
          .run(s, userId, s).changes,
      );
  if (allowRecovery && row.enabled) {
    const hashes = JSON.parse(row.recovery_hashes),
      hashed = recoveryHash(userId, code);
    const i = hashes.findIndex((x) => equal(x, hashed));
    if (i >= 0) {
      hashes.splice(i, 1);
      return Boolean(
        db
          .prepare(
            "UPDATE staff_mfa SET recovery_hashes=? WHERE user_id=? AND recovery_hashes=?",
          )
          .run(JSON.stringify(hashes), userId, row.recovery_hashes).changes,
      );
    }
  }
  return false;
}
function securityEvent(db, id, action) {
  const user = db.prepare("SELECT name FROM users WHERE id=?").get(id);
  db.prepare(
    "INSERT INTO audit_log(user_id,user_name,action,entity,entity_id,reason,created_at) VALUES(?,?,?,?,?,?,?)",
  ).run(
    id,
    user?.name || "staff",
    action,
    "staff-security",
    String(id),
    "تحقق أمني خادمي",
    new Date().toISOString(),
  );
}
function current(ctx) {
  if (!ctx.user) throw new HttpError(401, "يلزم تسجيل الدخول");
  if (ctx.user.mustChange)
    throw new HttpError(403, "غيّر كلمة المرور المؤقتة أولًا");
  return ctx.user;
}
export async function setupMfa(ctx) {
  const user = current(ctx),
    body = await readJson(ctx.req, 4096),
    row = ctx.db.prepare("SELECT * FROM users WHERE id=?").get(user.id);
  const lock = `reauth:${user.id}`;
  if (loginBlocked(lock, ctx.db))
    throw new HttpError(429, "محاولات كثيرة؛ أعد المحاولة لاحقًا");
  if (!verifyPassword(body.password, row.password_hash, row.password_salt)) {
    loginFailed(lock, ctx.db);
    throw new HttpError(400, "كلمة المرور الحالية غير صحيحة");
  }
  loginSucceeded(lock, ctx.db);
  if (
    ctx.db.prepare("SELECT enabled FROM staff_mfa WHERE user_id=?").get(user.id)
      ?.enabled
  )
    throw new HttpError(
      409,
      "المصادقة الثنائية مفعلة؛ لا يمكن استبدالها دون إجراء استعادة",
    );
  const secret = base32(randomBytes(20));
  ctx.db
    .prepare(
      "INSERT INTO staff_mfa(user_id,secret_ciphertext) VALUES (?,?) ON CONFLICT(user_id) DO UPDATE SET secret_ciphertext=excluded.secret_ciphertext,last_step=-1",
    )
    .run(user.id, encrypt(secret));
  securityEvent(ctx.db, user.id, "mfa-enrollment-started");
  return json(
    ctx.res,
    200,
    {
      ok: true,
      secret,
      uri: `otpauth://totp/${encodeURIComponent("Laurette:" + user.username)}?secret=${secret}&issuer=Laurette&digits=6&period=30`,
    },
    { "cache-control": "no-store" },
  );
}
export async function confirmMfa(ctx) {
  const user = current(ctx),
    body = await readJson(ctx.req, 4096),
    row = ctx.db
      .prepare("SELECT enabled FROM staff_mfa WHERE user_id=?")
      .get(user.id);
  if (row?.enabled) throw new HttpError(409, "المصادقة الثنائية مفعلة");
  if (
    !consume(ctx.db, user.id, String(body.code || ""), { allowRecovery: false })
  )
    throw new HttpError(400, "رمز التحقق غير صحيح أو مستخدم");
  const codes = Array.from({ length: 10 }, () =>
    randomBytes(12).toString("hex"),
  );
  ctx.db.exec("BEGIN IMMEDIATE");
  try {
    ctx.db
      .prepare(
        "UPDATE staff_mfa SET enabled=1,recovery_hashes=? WHERE user_id=?",
      )
      .run(JSON.stringify(codes.map((x) => recoveryHash(user.id, x))), user.id);
    ctx.db
      .prepare("DELETE FROM sessions WHERE user_id=? AND token_hash<>?")
      .run(user.id, tokenHash(ctx.token));
    ctx.db
      .prepare("UPDATE sessions SET mfa_verified_at=? WHERE token_hash=?")
      .run(new Date().toISOString(), tokenHash(ctx.token));
    securityEvent(ctx.db, user.id, "mfa-enrolled");
    ctx.db.exec("COMMIT");
  } catch (e) {
    ctx.db.exec("ROLLBACK");
    throw e;
  }
  return json(
    ctx.res,
    200,
    { ok: true, recoveryCodes: codes },
    { "cache-control": "no-store" },
  );
}
export async function verifyMfa(ctx) {
  const body = await readJson(ctx.req, 4096),
    key = tokenHash(body.challenge || "");
  const result = transaction(
    ctx.db,
    () => {
      const challenge = ctx.db
        .prepare("SELECT * FROM staff_mfa_challenges WHERE token_hash=?")
        .get(key);
      if (
        !challenge ||
        challenge.expires_at < Date.now() ||
        challenge.attempts >= 5
      )
        throw new HttpError(401, "انتهت محاولة التحقق؛ سجّل الدخول مجددًا");
      const lockKey = `mfa:${challenge.user_id}`;
      if (loginBlocked(lockKey, ctx.db))
        throw new HttpError(429, "محاولات كثيرة؛ أعد المحاولة لاحقًا");
      const user = ctx.db
        .prepare("SELECT active FROM users WHERE id=?")
        .get(challenge.user_id);
      if (!user?.active) throw new HttpError(401, "الحساب غير متاح");
      ctx.db
        .prepare(
          "UPDATE staff_mfa_challenges SET attempts=attempts+1 WHERE token_hash=?",
        )
        .run(key);
      if (!consume(ctx.db, challenge.user_id, String(body.code || ""))) {
        loginFailed(lockKey, ctx.db);
        return null;
      }
      loginSucceeded(lockKey, ctx.db);
      ctx.db
        .prepare("DELETE FROM staff_mfa_challenges WHERE token_hash=?")
        .run(key);
      const session = createSession(
        ctx.db,
        challenge.user_id,
        ctx.ip,
        ctx.req.headers["user-agent"],
        { mfaVerified: true },
      );
      ctx.db
        .prepare("UPDATE users SET last_login_at=? WHERE id=?")
        .run(new Date().toISOString(), challenge.user_id);
      securityEvent(ctx.db, challenge.user_id, "login-mfa");
      return session;
    },
    { immediate: true },
  );
  if (!result) throw new HttpError(401, "رمز التحقق غير صحيح أو مستخدم");
  return json(
    ctx.res,
    200,
    { ok: true },
    {
      "set-cookie": cookie("lt_session", result.token, {
        maxAge: 8 * 3600,
        sameSite: "Strict",
        secure: ctx.secure,
      }),
      "cache-control": "no-store",
    },
  );
}
