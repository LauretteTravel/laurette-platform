import { exec, one, q } from './db.js';
import { hashPassword, verifyPassword, loginBlocked, loginFailed, loginSucceeded } from './auth.js';
import { json, readJson, cookie } from './http.js';
import { publicStatus } from './domain.js';
import { CLIENT_COOKIE, createClientSession, destroyClientSession, emailOtpMatches, issueEmailOtp, publicClient } from './client-auth.js';
import { normalizeInternationalPhone } from './phone-codes.js';
import { isoNow } from './util.js';

const ok = (res, data = {}, status = 200, headers = {}) => json(res, status, { ok: true, ...data }, headers);
const fail = (res, status, message, errors = null) => json(res, status, { ok: false, message, errors });
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/;

function clientCookie(ctx, token, maxAge = 30 * 86400) {
  return cookie(CLIENT_COOKIE, token, { maxAge, sameSite: 'Strict', secure: ctx.secure });
}

function requireClient(ctx) {
  if (!ctx.clientUser) {
    fail(ctx.res, 401, 'سجّل الدخول إلى حسابك أولًا');
    return null;
  }
  return ctx.clientUser;
}

async function sendOtp(ctx, client, otp, sendVerificationEmail) {
  try {
    await sendVerificationEmail({
      email: client.email,
      name: `${client.first_name} ${client.last_name}`,
      code: otp.code,
    });
    return true;
  } catch (error) {
    console.error('[client-email]', error.message);
    fail(ctx.res, 503, 'تم حفظ التسجيل لكن تعذر إرسال رمز التأكيد. تأكد من إعداد البريد ثم اطلب إعادة إرسال الرمز.');
    return false;
  }
}

export async function registerClient(ctx, sendVerificationEmail, emailEnabled = true) {
  const body = await readJson(ctx.req, 8 * 1024);
  const firstName = String(body.firstName || '').trim().replace(/\s+/g, ' ');
  const lastName = String(body.lastName || '').trim().replace(/\s+/g, ' ');
  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');
  const phone = normalizeInternationalPhone(body.phoneCountryCode, body.phone);
  const errors = {};

  if (firstName.length < 1 || firstName.length > 50) errors.firstName = 'أدخل الاسم الأول (50 حرفًا كحد أقصى)';
  if (lastName.length < 1 || lastName.length > 50) errors.lastName = 'أدخل اسم العائلة (50 حرفًا كحد أقصى)';
  if (email.length > 254 || !EMAIL_RE.test(email)) errors.email = 'أدخل بريدًا إلكترونيًا صالحًا';
  if (password.length < 10 || password.length > 128 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) {
    errors.password = 'كلمة المرور يجب أن تكون 10 أحرف على الأقل وتحتوي حرفًا ورقمًا';
  }
  if (!phone) errors.phone = 'اختر رمز الدولة وأدخل رقم هاتف صالحًا';
  if (Object.keys(errors).length) return fail(ctx.res, 422, 'تحقق من البيانات المدخلة', errors);
  if (!emailEnabled) return fail(ctx.res, 503, 'التسجيل بالبريد غير متاح حاليًا. حاول لاحقًا.');

  const existing = one(ctx.db, 'SELECT id, is_verified FROM clients WHERE email = ?', [email]);
  if (existing) {
    if (!existing.is_verified) return fail(ctx.res, 409, 'هذا البريد مسجل ولم يؤكد بعد. اطلب إعادة إرسال رمز التأكيد.');
    return fail(ctx.res, 409, 'يوجد حساب بهذا البريد. سجّل الدخول بدلًا من إنشاء حساب جديد.');
  }

  const otp = issueEmailOtp();
  const { hash, salt } = hashPassword(password);
  const now = isoNow();
  let clientId;
  try {
    clientId = Number(exec(ctx.db, `INSERT INTO clients
      (email, password_hash, password_salt, first_name, last_name, phone_e164, is_verified,
       otp_hash, otp_salt, otp_expires_at, otp_sent_at, otp_attempts, created_at, updated_at)
      VALUES (?,?,?,?,?,?,0,?,?,?,?,0,?,?)`,
    [email, hash, salt, firstName, lastName, phone, otp.hash, otp.salt, otp.expiresAt, now, now, now]).lastInsertRowid);
  } catch (error) {
    if (String(error.message).includes('UNIQUE constraint failed: clients.email')) {
      return fail(ctx.res, 409, 'يوجد حساب بهذا البريد. سجّل الدخول بدلًا من إنشاء حساب جديد.');
    }
    throw error;
  }
  const client = one(ctx.db, 'SELECT id, email, first_name, last_name FROM clients WHERE id = ?', [clientId]);
  if (!await sendOtp(ctx, client, otp, sendVerificationEmail)) return;
  return ok(ctx.res, { message: 'أرسلنا رمز التأكيد إلى بريدك الإلكتروني.' }, 201);
}

export async function verifyClientEmail(ctx) {
  const body = await readJson(ctx.req, 4 * 1024);
  const email = String(body.email || '').trim().toLowerCase();
  const code = String(body.code || '').trim();
  if (!EMAIL_RE.test(email) || !/^\d{6}$/.test(code)) return fail(ctx.res, 400, 'أدخل البريد ورمز التأكيد المكوّن من 6 أرقام');

  const client = one(ctx.db, 'SELECT * FROM clients WHERE email = ?', [email]);
  if (!client || client.is_verified) return fail(ctx.res, 400, 'رمز التأكيد غير صالح أو انتهت صلاحيته');
  if (client.otp_attempts >= 5) return fail(ctx.res, 429, 'تجاوزت عدد المحاولات. اطلب رمزًا جديدًا.');
  if (!client.otp_expires_at || new Date(client.otp_expires_at).getTime() < Date.now()) {
    return fail(ctx.res, 400, 'انتهت صلاحية الرمز. اطلب رمزًا جديدًا.');
  }
  if (!emailOtpMatches(code, client.otp_salt, client.otp_hash)) {
    exec(ctx.db, 'UPDATE clients SET otp_attempts = otp_attempts + 1 WHERE id = ?', [client.id]);
    return fail(ctx.res, 400, 'رمز التأكيد غير صحيح');
  }

  const now = isoNow();
  exec(ctx.db, `UPDATE clients SET is_verified = 1, otp_hash = NULL, otp_salt = NULL,
    otp_expires_at = NULL, otp_sent_at = NULL, otp_attempts = 0, updated_at = ? WHERE id = ?`, [now, client.id]);
  exec(ctx.db, `UPDATE requests SET client_id = ?
    WHERE client_id IS NULL AND lower(COALESCE(json_extract(payload, '$.email'), '')) = ?`, [client.id, client.email]);
  const session = createClientSession(ctx.db, client.id, ctx.ip, ctx.req.headers['user-agent']);
  const verified = one(ctx.db, 'SELECT * FROM clients WHERE id = ?', [client.id]);
  return ok(ctx.res, { user: publicClient(verified) }, 200, { 'set-cookie': clientCookie(ctx, session.token) });
}

export async function resendClientOtp(ctx, sendVerificationEmail, emailEnabled = true) {
  const body = await readJson(ctx.req, 4 * 1024);
  const email = String(body.email || '').trim().toLowerCase();
  if (!EMAIL_RE.test(email)) return fail(ctx.res, 400, 'أدخل بريدًا إلكترونيًا صالحًا');
  if (!emailEnabled) return fail(ctx.res, 503, 'إرسال بريد التأكيد غير متاح حاليًا. حاول لاحقًا.');
  const client = one(ctx.db, 'SELECT id, email, first_name, last_name, is_verified, otp_sent_at FROM clients WHERE email = ?', [email]);

  if (client && !client.is_verified) {
    const lastSent = client.otp_sent_at ? new Date(client.otp_sent_at).getTime() : 0;
    if (Date.now() - lastSent < 60_000) {
      return ok(ctx.res, { message: 'إذا كان الحساب بحاجة إلى تأكيد، سيصلك رمز جديد بعد انتهاء مهلة الإرسال.' });
    }
    const otp = issueEmailOtp();
    exec(ctx.db, `UPDATE clients SET otp_hash = ?, otp_salt = ?, otp_expires_at = ?, otp_sent_at = ?, otp_attempts = 0,
      updated_at = ? WHERE id = ? AND is_verified = 0`,
    [otp.hash, otp.salt, otp.expiresAt, isoNow(), isoNow(), client.id]);
    if (!await sendOtp(ctx, client, otp, sendVerificationEmail)) return;
  }
  return ok(ctx.res, { message: 'إذا كان الحساب بحاجة إلى تأكيد، فستصلك رسالة على البريد المسجل.' });
}

export async function loginClient(ctx) {
  const body = await readJson(ctx.req, 8 * 1024);
  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');
  const key = `${ctx.ip}|client:${email}`;
  const blocked = loginBlocked(key);
  if (blocked) {
    ctx.res.setHeader('retry-after', String(blocked));
    return fail(ctx.res, 429, `محاولات كثيرة. أعد المحاولة بعد ${blocked} ثانية.`);
  }
  if (!EMAIL_RE.test(email) || !password) return fail(ctx.res, 400, 'أدخل البريد الإلكتروني وكلمة المرور');
  const client = one(ctx.db, 'SELECT * FROM clients WHERE email = ?', [email]);
  if (!client || !verifyPassword(password, client.password_hash, client.password_salt)) {
    loginFailed(key);
    return fail(ctx.res, 401, 'البريد الإلكتروني أو كلمة المرور غير صحيحة');
  }
  if (!client.is_verified) return fail(ctx.res, 403, 'أكد بريدك الإلكتروني قبل تسجيل الدخول', { emailVerificationRequired: true });

  loginSucceeded(key);
  const now = isoNow();
  exec(ctx.db, 'UPDATE clients SET last_login_at = ?, updated_at = ? WHERE id = ?', [now, now, client.id]);
  const session = createClientSession(ctx.db, client.id, ctx.ip, ctx.req.headers['user-agent']);
  return ok(ctx.res, { user: publicClient(client) }, 200, { 'set-cookie': clientCookie(ctx, session.token) });
}

export function logoutClient(ctx) {
  destroyClientSession(ctx.db, ctx.clientToken);
  return ok(ctx.res, {}, 200, { 'set-cookie': clientCookie(ctx, '', 0) });
}

export function currentClient(ctx) {
  if (!ctx.clientUser) return ok(ctx.res, { user: null });
  const client = one(ctx.db, 'SELECT * FROM clients WHERE id = ? AND is_verified = 1', [ctx.clientUser.id]);
  return ok(ctx.res, { user: client ? publicClient(client) : null });
}

export function clientBookings(ctx) {
  const client = requireClient(ctx);
  if (!client) return;
  const total = one(ctx.db, 'SELECT COUNT(*) AS count FROM requests WHERE client_id = ?', [client.id]).count;
  const pageSize = 25;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(pages, Math.max(1, Number(ctx.query.page) || 1));
  const rows = q(ctx.db, `SELECT reference FROM requests WHERE client_id = ?
    ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`, [client.id, pageSize, (page - 1) * pageSize]);
  const bookings = rows.map(({ reference }) => publicStatus(ctx.db, reference));
  return ok(ctx.res, { bookings, total, page, pages });
}

export async function updateClientProfile(ctx) {
  const client = requireClient(ctx);
  if (!client) return;
  const body = await readJson(ctx.req, 8 * 1024);
  const firstName = String(body.firstName || '').trim().replace(/\s+/g, ' ');
  const lastName = String(body.lastName || '').trim().replace(/\s+/g, ' ');
  const phone = normalizeInternationalPhone(body.phoneCountryCode, body.phone);
  const errors = {};
  if (firstName.length < 1 || firstName.length > 50) errors.firstName = 'أدخل الاسم الأول (50 حرفًا كحد أقصى)';
  if (lastName.length < 1 || lastName.length > 50) errors.lastName = 'أدخل اسم العائلة (50 حرفًا كحد أقصى)';
  if (!phone) errors.phone = 'اختر رمز الدولة وأدخل رقم هاتف صالحًا';
  if (Object.keys(errors).length) return fail(ctx.res, 422, 'تحقق من البيانات المدخلة', errors);

  const now = isoNow();
  try {
    exec(ctx.db, 'UPDATE clients SET first_name = ?, last_name = ?, phone_e164 = ?, updated_at = ? WHERE id = ?',
      [firstName, lastName, phone, now, client.id]);
  } catch (error) {
    if (String(error.message).includes('UNIQUE constraint failed')) return fail(ctx.res, 409, 'تعذر حفظ رقم الهاتف. تحقق منه ثم أعد المحاولة.');
    throw error;
  }
  const updated = one(ctx.db, 'SELECT * FROM clients WHERE id = ?', [client.id]);
  return ok(ctx.res, { user: publicClient(updated) });
}
