import { exec, one, q, transaction } from './db.js';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { can, createSession, destroySession, hashPassword, loginBlocked, loginFailed, loginSucceeded, verifyPassword } from './auth.js';
import { HttpError, json, readJson, clientIp, cookie } from './http.js';
import { createRequest, transitionError, addEvent, audit, publicStatus, stats, STATUSES, REQUEST_TYPES, programBySlug, recommend, hydrateProgram, cleanPhone, searchPrograms, DEAL_STAGES, syncDealStage, markFirstResponse, dealStageFor, durationLabel } from './domain.js';
import { answer, ensureSession, logMessage } from './assistant.js';
import { isoNow, slugify, randomToken } from './util.js';
import { notifyBooking, notifyStatusChange, notifyQuoteUpdate } from './webhooks.js';
import { enqueueWhatsAppNotice } from './whatsapp.js';

const ok = (res, data = {}, status = 200) => json(res, status, { ok: true, ...data });
const fail = (res, status, message, errors = null) => json(res, status, { ok: false, message, errors });
const HERE_PUBLIC = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'public');

/** عمود payload نصّي في قاعدة البيانات — نمرّره ككائن للويبهوك. */
const safePayload = (row) => {
  try { return JSON.parse(row?.payload || '{}'); } catch { return {}; }
};

export const COOKIE = 'lt_session';

/* ---------------- auth ---------------- */

export async function login(ctx) {
  const { req, res, db, ip } = ctx;
  const body = await readJson(req, 8 * 1024);
  const username = String(body.username || '').trim().toLowerCase();
  const password = String(body.password || '');
  const key = `${ip}|${username}`;
  const blocked = loginBlocked(key);
  if (blocked) {
    res.setHeader('retry-after', String(blocked));
    return fail(res, 429, `محاولات كثيرة. أعد المحاولة بعد ${blocked} ثانية.`);
  }
  if (!username || !password) return fail(res, 400, 'أدخل اسم المستخدم وكلمة المرور');
  const user = one(db, `SELECT u.*, r.name AS role_name, r.permissions, r.data_scope FROM users u
      LEFT JOIN role_definitions r ON r.role_key = u.role_key AND r.active = 1
      WHERE u.username = ? AND u.active = 1`, [username]);
  if (!user || !verifyPassword(password, user.password_hash, user.password_salt)) {
    loginFailed(key);
    return fail(res, 401, 'اسم المستخدم أو كلمة المرور غير صحيحة');
  }
  loginSucceeded(key);
  if (user.role_key && !user.permissions) return fail(res, 403, 'الدور المرتبط بالحساب غير فعال');
  const session = createSession(db, user.id, ip, req.headers['user-agent']);
  exec(db, 'UPDATE users SET last_login_at = ? WHERE id = ?', [isoNow(), user.id]);
  audit(db, { user: { id: user.id, name: user.name }, action: 'login', entity: 'user', entityId: user.id, ip });
  json(res, 200, {
    ok: true,
    user: {
      id: user.id, username: user.username, name: user.name, role: user.role, roleKey: user.role_key || null,
      roleName: user.role_name || null,
      department: user.department, departmentId: user.department_id, branchId: user.branch_id,
      dataScope: user.data_scope || 'organization',
      permissions: user.role_key ? JSON.parse(user.permissions) : null,
      mustChange: !!user.must_change,
    },
  }, {
    'set-cookie': cookie(COOKIE, session.token, { maxAge: 8 * 3600, sameSite: 'Strict', secure: ctx.secure }),
  });
}

export async function logout(ctx) {
  const { req, res, db } = ctx;
  if (ctx.user) audit(db, { user: ctx.user, action: 'logout', entity: 'user', entityId: ctx.user.id, ip: clientIp(req) });
  destroySession(db, ctx.token);
  res.writeHead(200, {
    'content-type': 'application/json; charset=utf-8',
    'set-cookie': cookie(COOKIE, '', { maxAge: 0, sameSite: 'Strict', secure: ctx.secure }),
  });
  res.end(JSON.stringify({ ok: true }));
}

export function me(ctx) {
  if (!ctx.user) return json(ctx.res, 200, { ok: true, user: null });
  const u = one(ctx.db, `SELECT u.id, u.username, u.name, u.role, u.role_key, u.department, u.department_id, u.branch_id,
      u.must_change, r.name AS role_name, r.permissions, r.data_scope
      FROM users u LEFT JOIN role_definitions r ON r.role_key = u.role_key AND r.active = 1 WHERE u.id = ?`, [ctx.user.id]);
  return ok(ctx.res, { user: {
    id: u.id, username: u.username, name: u.name, role: u.role, roleKey: u.role_key,
    roleName: u.role_name || null,
    department: u.department, departmentId: u.department_id, branchId: u.branch_id,
    dataScope: u.data_scope || 'organization',
    permissions: u.role_key && u.permissions ? JSON.parse(u.permissions) : null,
    mustChange: !!u.must_change,
  } });
}

export async function changePassword(ctx) {
  const user = requireUser(ctx, null);
  if (!user) return fail(ctx.res, 401, 'يلزم تسجيل الدخول');
  const body = await readJson(ctx.req);
  const current = String(body.currentPassword || '');
  const next = String(body.newPassword || '');
  const row = one(ctx.db, 'SELECT * FROM users WHERE id = ?', [user.id]);
  if (!verifyPassword(current, row.password_hash, row.password_salt)) return fail(ctx.res, 400, 'كلمة المرور الحالية غير صحيحة');
  if (next.length < 10 || !/[A-Za-z]/.test(next) || !/\d/.test(next)) {
    return fail(ctx.res, 400, 'كلمة المرور الجديدة يجب أن تكون 10 أحرف على الأقل وتحتوي حرفًا ورقمًا');
  }
  const { hash, salt } = hashPassword(next);
  exec(ctx.db, 'UPDATE users SET password_hash = ?, password_salt = ?, must_change = 0 WHERE id = ?', [hash, salt, user.id]);
  exec(ctx.db, 'DELETE FROM sessions WHERE user_id = ?', [user.id]);
  audit(ctx.db, { user, action: 'change-password', entity: 'user', entityId: user.id, ip: clientIp(ctx.req) });
  ctx.res.setHeader('set-cookie', cookie(COOKIE, '', { maxAge: 0, sameSite: 'Strict', secure: ctx.secure }));
  return ok(ctx.res, { message: 'تم تغيير كلمة المرور. سجّل الدخول من جديد.' });
}

function requireUser(ctx, action) {
  if (!ctx.user) {
    fail(ctx.res, 401, 'يلزم تسجيل الدخول');
    return null;
  }
  if (action && ctx.user.mustChange) {
    fail(ctx.res, 403, 'غيّر كلمة المرور المؤقتة للمتابعة');
    return null;
  }
  if (action && !can(ctx.user, action)) {
    fail(ctx.res, 403, 'لا تملك صلاحية لهذا الإجراء');
    return null;
  }
  return ctx.user;
}

function requestScope(user, alias = 'r') {
  if (!user?.roleKey || user.dataScope === 'organization') return { sql: '', params: [] };
  if (user.dataScope === 'branch') {
    return user.branchId ? { sql: `${alias}.branch_id = ?`, params: [user.branchId] } : { sql: '1 = 0', params: [] };
  }
  if (user.dataScope === 'department') {
    return user.departmentId ? { sql: `${alias}.department_id = ?`, params: [user.departmentId] } : { sql: '1 = 0', params: [] };
  }
  if (user.dataScope === 'assigned') {
    return { sql: `(${alias}.assigned_to = ? OR ${alias}.sales_owner_id = ? OR ${alias}.service_owner_id = ? OR ${alias}.execution_owner_id = ?)`,
      params: [user.id, user.id, user.id, user.id] };
  }
  return { sql: '1 = 0', params: [] };
}

function userScope(user, alias = 'u') {
  if (!user?.roleKey || user.dataScope === 'organization') return { sql: '', params: [] };
  if (user.dataScope === 'branch') {
    return user.branchId ? { sql: `${alias}.branch_id = ?`, params: [user.branchId] } : { sql: '1 = 0', params: [] };
  }
  if (user.dataScope === 'department') {
    return user.departmentId ? { sql: `${alias}.department_id = ?`, params: [user.departmentId] } : { sql: '1 = 0', params: [] };
  }
  return { sql: `${alias}.id = ?`, params: [user.id] };
}

function canDelegateProfile(actor, profile) {
  if (!actor.roleKey) return actor.role === 'admin';
  const rank = { organization: 0, branch: 1, department: 2, assigned: 3 };
  if (actor.dataScope !== 'organization' && (rank[profile.data_scope] ?? -1) < (rank[actor.dataScope] ?? 4)) return false;
  const actorPermissions = Array.isArray(actor.permissions) ? actor.permissions : [];
  let permissions = [];
  try { permissions = JSON.parse(profile.permissions || '[]'); } catch { return false; }
  return actorPermissions.includes('*') || permissions.every((permission) => actorPermissions.includes(permission));
}

function scopeClause(scope, prefix = ' AND ') {
  return scope.sql ? `${prefix}${scope.sql}` : '';
}

/* ---------------- public ---------------- */

export async function createRequestApi(ctx) {
  const { req, res, db } = ctx;
  const body = await readJson(req, 32 * 1024);
  const type = String(body.type || '');
  if (!REQUEST_TYPES[type]) return fail(res, 400, 'نوع الطلب غير معروف');
  const result = createRequest(db, type, body, { ip: clientIp(req), userAgent: req.headers['user-agent'], source: body.source || 'website', clientId: ctx.clientUser?.id });
  if (!result.ok) return fail(res, 422, 'تحقق من الحقول المطلوبة', result.errors);

  if (!result.duplicate || result.notifyWhatsApp) {
    enqueueWhatsAppNotice(db, result.id, 'received', ctx.baseUrl);
  }

  // Fire-and-forget: n8n outage must never delay or break the booking response.
  if (!result.duplicate) {
    try {
      const row = one(db, 'SELECT * FROM requests WHERE id = ?', [result.id]);
      if (row) {
        const request = { ...row, payload: JSON.parse(row.payload || '{}') };
        void notifyBooking(db, request, { ...ctx.settings, baseUrl: ctx.baseUrl });
      }
    } catch {
      /* ignore webhook wiring errors */
    }
  }
  return ok(res, {
    reference: result.reference,
    summary: result.summary || '',
    duplicate: !!result.duplicate,
    value: result.value || 0,
    type,
    typeLabel: REQUEST_TYPES[type].label,
    trackUrl: `/track?reference=${encodeURIComponent(result.reference)}`,
    whatsapp: ctx.settings.whatsapp
      ? `https://wa.me/${String(ctx.settings.whatsapp).replace(/\D/g, '')}?text=${encodeURIComponent(`السلام عليكم، لدي طلب رقم ${result.reference} وأرغب بمتابعته.`)}`
      : null,
  }, result.duplicate ? 200 : 201);
}

export async function createInternalRequest(ctx) {
  const user = requireUser(ctx, 'requests:write');
  if (!user) return;
  const body = await readJson(ctx.req, 32 * 1024);
  const type = String(body.type || '');
  if (!REQUEST_TYPES[type]) return fail(ctx.res, 422, 'نوع الخدمة غير صالح');
  const requestedBranchId = body.branchId === undefined || body.branchId === '' ? user.branchId : Number(body.branchId);
  const branchId = user.roleKey && user.dataScope !== 'organization' ? user.branchId : requestedBranchId;
  const branch = branchId ? one(ctx.db, 'SELECT id FROM branches WHERE id = ? AND active = 1', [branchId]) : null;
  if (!branch || !Number.isInteger(branchId)) return fail(ctx.res, 422, 'اختر فرع استقبال نشطًا');
  const typeDepartmentName = REQUEST_TYPES[type].department;
  const canonicalDepartmentName = ({
    'الفنادق': 'قسم الهوليداي والبرامج السياحية',
    'البرامج السياحية': 'قسم الهوليداي والبرامج السياحية',
    'الحج والعمرة': 'قسم الحج والعمرة',
  })[typeDepartmentName] || typeDepartmentName;
  const department = body.departmentId
    ? one(ctx.db, 'SELECT id, name FROM departments WHERE id = ? AND active = 1', [Number(body.departmentId)])
    : one(ctx.db, 'SELECT id, name FROM departments WHERE name = ? AND active = 1 AND branch_id IS NULL', [canonicalDepartmentName]);
  if (!department) return fail(ctx.res, 422, 'القسم المحدد غير موجود');
  if (user.roleKey && user.dataScope === 'department' && user.departmentId !== department.id) {
    return fail(ctx.res, 403, 'لا يمكنك تسجيل الطلب خارج نطاق قسمك');
  }
  const assignedTo = body.assignedTo === undefined || body.assignedTo === '' ? null : Number(body.assignedTo);
  const assignee = assignedTo === null ? null : one(ctx.db,
    'SELECT id, name, branch_id, department_id FROM users WHERE id = ? AND active = 1', [assignedTo]);
  if (assignedTo !== null && (!Number.isInteger(assignedTo) || !assignee
      || assignee.branch_id !== branchId || assignee.department_id !== department.id)) {
    return fail(ctx.res, 422, 'الموظف يجب أن يكون نشطًا ومن الفرع والقسم المحددين');
  }
  const result = createRequest(ctx.db, type, { ...body, consent: body.consent === true }, {
    ip: clientIp(ctx.req), userAgent: ctx.req.headers['user-agent'], source: 'branch', internal: true,
    branchId, departmentId: department.id, departmentName: department.name,
    assignedTo, actorId: user.id, actorName: user.name,
  });
  if (!result.ok) return fail(ctx.res, 422, 'تحقق من الحقول المطلوبة', result.errors);
  if (result.duplicate) return fail(ctx.res, 409, 'طلب مطابق موجود مسبقًا؛ افتح الطلب السابق بدل إنشاء سجل مكرر');
  exec(ctx.db, `UPDATE requests SET branch_id = ?, received_branch_id = ?, department_id = ?, department = ?,
    assigned_to = ?, service_owner_id = ? WHERE id = ?`,
  [branchId, branchId, department.id, department.name, assignedTo, assignedTo, result.id]);
  if (assignedTo) exec(ctx.db, `INSERT INTO request_owner_history
    (request_id, owner_type, previous_value, next_value, changed_by, note, created_at)
    VALUES (?, 'assigned', NULL, ?, ?, 'إسناد عند الإنشاء', ?)`, [result.id, String(assignedTo), user.id, isoNow()]);
  addEvent(ctx.db, result.id, {
    kind: 'intake', actorId: user.id, actorName: user.name,
    message: `استقبل الطلب في ${one(ctx.db, 'SELECT name FROM branches WHERE id = ?', [branchId]).name} — ${department.name}`,
    meta: { branchId, departmentId: department.id, assignedTo },
  });
  audit(ctx.db, { user, action: 'create-request', entity: 'request', entityId: result.id,
    meta: { type, branchId, departmentId: department.id, assignedTo }, ip: clientIp(ctx.req) });
  return ok(ctx.res, { reference: result.reference, requestId: result.id, message: 'تم تسجيل الطلب' }, 201);
}

export async function trackRequest(ctx) {
  const { req, res, db } = ctx;
  const body = await readJson(req, 8 * 1024);
  const reference_ = String(body.reference || '').trim().toUpperCase();
  const phone = cleanPhone(body.phone);
  if (!reference_ || !phone) return fail(res, 400, 'أدخل الرقم المرجعي ورقم الهاتف');
  const row = one(db, 'SELECT id, payload FROM requests WHERE reference = ?', [reference_]);
  let payload = {};
  try { payload = JSON.parse(row?.payload || '{}'); } catch { payload = {}; }
  if (!row || cleanPhone(payload.phone) !== phone) {
    return fail(res, 404, 'لم نجد طلبًا مطابقًا. تحقق من الرقم المرجعي ورقم الهاتف.');
  }
  const status = publicStatus(db, reference_);
  return ok(res, { request: status });
}

export function listProgramsApi(ctx) {
  const { db, query, res } = ctx;
  const list = searchPrograms(db, {
    category: query.category, q: query.q, maxPrice: query.maxPrice, minDays: query.minDays, maxDays: query.maxDays,
    sort: query.sort, limit: Math.min(Number(query.limit) || 40, 100),
  });
  return ok(res, { programs: list.map(publicProgram) });
}

export function getProgramApi(ctx) {
  const { db, res } = ctx;
  const p = programBySlug(db, ctx.params.slug);
  if (!p || p.status === 'archived') return fail(res, 404, 'البرنامج غير موجود');
  return ok(res, { program: publicProgram(p) });
}

function publicProgram(p) {
  return {
    slug: p.slug, category: p.category, title: p.title, summary: p.summary, days: p.days, nights: p.nights,
    priceFrom: p.price_from, currency: p.currency, status: p.status, artKey: p.art_key, destination: p.destination,
    imageUrl: p.image_url || null,
    hotels: p.hotels, itinerary: p.itinerary, includes: p.includes, excludes: p.excludes, terms: p.terms,
    options: p.options, badges: p.badges, meals: p.meals, airline: p.airline, departureDates: p.departure_dates,
    url: `/programs/${p.slug}`,
  };
}

export async function recommendApi(ctx) {
  const { req, res, db } = ctx;
  const body = await readJson(req);
  const all = q(db, "SELECT * FROM programs WHERE status IN ('published','sold_out')").map(hydrateProgram);
  const matches = recommend({
    budget: body.budget, pax: body.pax, style: body.style, trip: body.trip, month: body.month,
  }, all).map((m) => publicProgram(m.program));
  return ok(res, { matches, note: 'الترشيحات من البرامج المنشورة فقط، والأسعار «تبدأ من» وتحتاج تأكيدًا من الفريق.' });
}

export async function assistantApi(ctx) {
  const { req, res, db } = ctx;
  const body = await readJson(req, 16 * 1024);
  const message = String(body.message || '').trim();
  if (!message) return fail(res, 400, 'اكتب استفسارك أولًا');
  const consent = body.consent === true;
  let sid = String(body.sessionId || '').slice(0, 60) || null;
  if (consent && !sid) sid = randomToken(12);
  const session = ensureSession(db, sid, consent);
  if (session) logMessage(db, session.id, 'user', message, null, null);
  const result = answer(db, message, { sessionId: session?.id, consent });
  if (session) logMessage(db, session.id, 'assistant', result.reply, result.intent, result.sources);
  return ok(res, {
    reply: result.reply,
    intent: result.intent,
    sources: result.sources || [],
    suggestions: result.suggestions || [],
    escalate: !!result.escalate,
    sessionId: session?.sid || null,
    consent: !!session?.consent,
  });
}

/* ---------------- admin: overview & requests ---------------- */

export function overview(ctx) {
  const user = requireUser(ctx, 'overview:read');
  if (!user) return;
  const scope = requestScope(user);
  let s = stats(ctx.db);
  if (scope.sql) {
    const where = `WHERE ${scope.sql}`;
    const byType = Object.fromEntries(q(ctx.db, `SELECT r.type, COUNT(*) AS n FROM requests r ${where} GROUP BY r.type`, scope.params).map((r) => [r.type, r.n]));
    const byStatus = Object.fromEntries(q(ctx.db, `SELECT r.status, COUNT(*) AS n FROM requests r ${where} GROUP BY r.status`, scope.params).map((r) => [r.status, r.n]));
    s = {
      total: one(ctx.db, `SELECT COUNT(*) AS n FROM requests r ${where}`, scope.params).n,
      today: one(ctx.db, `SELECT COUNT(*) AS n FROM requests r ${where} AND substr(r.created_at,1,10) = ?`, [...scope.params, new Date().toISOString().slice(0, 10)]).n,
      byType,
      byStatus,
      followUps: one(ctx.db, `SELECT COUNT(*) AS n FROM requests r ${where} AND r.status IN ('new','reviewing','quoted','awaiting') AND julianday('now') - julianday(r.updated_at) >= 1`, scope.params).n,
      overdue: one(ctx.db, `SELECT COUNT(*) AS n FROM requests r ${where} AND r.status IN ('new','reviewing') AND julianday('now') - julianday(r.created_at) >= 2`, scope.params).n,
      customers: one(ctx.db, `SELECT COUNT(DISTINCT r.customer_id) AS n FROM requests r ${where}`, scope.params).n,
      quotes: one(ctx.db, `SELECT COUNT(*) AS n FROM requests r ${where} AND r.quote_amount IS NOT NULL`, scope.params).n,
      confirmed: byStatus.confirmed || 0,
      sources: q(ctx.db, `SELECT r.source, COUNT(*) AS n FROM requests r ${where} GROUP BY r.source ORDER BY n DESC`, scope.params),
      last7: q(ctx.db, `SELECT substr(r.created_at,1,10) AS day, COUNT(*) AS n FROM requests r ${where} AND julianday('now') - julianday(r.created_at) <= 7 GROUP BY day ORDER BY day`, scope.params),
    };
  }
  const recent = q(ctx.db, `SELECT r.id, r.reference, r.type, r.status, r.title, r.summary, r.created_at, c.name AS customer
      FROM requests r LEFT JOIN customers c ON c.id = r.customer_id WHERE 1=1${scopeClause(scope)} ORDER BY r.id DESC LIMIT 8`, scope.params);
  const needsAction = q(ctx.db, `SELECT r.id, r.reference, r.type, r.status, r.summary, r.updated_at
      FROM requests r WHERE r.status IN ('new','reviewing','awaiting','in_progress')${scopeClause(scope)} ORDER BY r.updated_at ASC LIMIT 8`, scope.params);

  return ok(ctx.res, { stats: s, recent, needsAction, statuses: STATUSES, types: REQUEST_TYPES, user });
}

/* ---------------- admin: deal reports ---------------- */

const REPORT_PERIODS = new Set(['daily', 'weekly', 'monthly']);

function reportRange(query = {}) {
  const period = REPORT_PERIODS.has(String(query.period)) ? String(query.period) : 'weekly';
  let { from, to } = query;
  if (!from || !to) {
    const now = new Date();
    to = now.toISOString().slice(0, 10);
    if (period === 'daily') from = to;
    else if (period === 'weekly') {
      const d = new Date(now);
      d.setUTCDate(d.getUTCDate() - 6);
      from = d.toISOString().slice(0, 10);
    } else {
      from = `${to.slice(0, 7)}-01`;
    }
  }
  const valid = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v));
  if (!valid(from) || !valid(to)) throw new HttpError(400, 'نطاق التاريخ غير صحيح');
  if (String(from) > String(to)) throw new HttpError(400, 'تاريخ البداية يجب أن يسبق النهاية');
  if ((new Date(`${to}T00:00:00Z`) - new Date(`${from}T00:00:00Z`)) / 86400000 > 366) {
    throw new HttpError(400, 'الحد الأقصى للنطاق سنة واحدة');
  }
  return { period, from: String(from), to: String(to) };
}

export function reports(ctx) {
  const user = requireUser(ctx, 'reports:read');
  if (!user) return;
  const { period, from, to } = reportRange(ctx.query);
  const employee = String(ctx.query.employee || '');
  const scope = requestScope(user);
  const filters = ['substr(r.created_at,1,10) BETWEEN ? AND ?'];
  const params = [from, to];
  for (const [queryKey, column, label] of [
    ['branch', 'r.branch_id', 'الفرع المنفذ'],
    ['receivedBranch', 'r.received_branch_id', 'فرع الاستقبال'],
    ['department', 'r.department_id', 'القسم'],
  ]) {
    const value = String(ctx.query[queryKey] || '');
    if (!value) continue;
    const id = Number(value);
    if (!Number.isInteger(id) || id < 1) return fail(ctx.res, 400, `قيمة ${label} غير صالحة`);
    filters.push(`${column} = ?`);
    params.push(id);
  }
  if (employee === 'unassigned') filters.push('r.assigned_to IS NULL');
  else if (employee) {
    const employeeId = Number(employee);
    if (!Number.isInteger(employeeId) || employeeId < 1) return fail(ctx.res, 400, 'قيمة الموظف غير صالحة');
    filters.push('r.assigned_to = ?');
    params.push(employeeId);
  }
  if (scope.sql) filters.push(scope.sql);
  params.push(...scope.params);
  const reportWhere = filters.join(' AND ');
  const base = `FROM requests r WHERE ${reportWhere}`;

  const summaryRow = one(ctx.db, `SELECT COUNT(*) AS total,
      COALESCE(SUM(r.deal_status = 'won'), 0) AS won,
      COALESCE(SUM(r.deal_status = 'lost'), 0) AS lost,
      COALESCE(SUM(r.deal_status IN ('new','in_progress')), 0) AS open,
      COALESCE(SUM(CASE WHEN r.deal_status = 'won' THEN COALESCE(r.quote_amount, 0) ELSE 0 END), 0) AS revenue,
      COALESCE(SUM(r.status IN ('new','reviewing') AND julianday('now') - julianday(r.created_at) >= 2), 0) AS overdue,
      AVG(CASE WHEN r.completed_at IS NOT NULL THEN (julianday(r.completed_at) - julianday(r.created_at)) * 1440 END) AS avg_completion,
      AVG(CASE WHEN r.first_response_at IS NOT NULL THEN (julianday(r.first_response_at) - julianday(r.created_at)) * 1440 END) AS avg_response
      ${base}`, params);

  const total = Number(summaryRow.total) || 0;
  const won = Number(summaryRow.won) || 0;
  const lost = Number(summaryRow.lost) || 0;
  const open = Number(summaryRow.open) || 0;
  const decided = won + lost;
  const summary = {
    total, won, lost, open,
    overdue: Number(summaryRow.overdue) || 0,
    revenue: Number(summaryRow.revenue) || 0,
    conversion: total ? Math.round((won / total) * 1000) / 10 : 0,
    winRate: decided ? Math.round((won / decided) * 1000) / 10 : 0,
    avgCompletionMinutes: summaryRow.avg_completion === null ? null : Math.round(summaryRow.avg_completion),
    avgResponseMinutes: summaryRow.avg_response === null ? null : Math.round(summaryRow.avg_response),
    avgCompletionLabel: durationLabel(summaryRow.avg_completion),
    avgResponseLabel: durationLabel(summaryRow.avg_response),
  };

  const employees = q(ctx.db, `SELECT COALESCE(u.name, 'غير مسند') AS name, r.assigned_to AS employeeId,
      COUNT(*) AS total,
      COALESCE(SUM(r.deal_status = 'won'), 0) AS won,
      COALESCE(SUM(r.deal_status = 'lost'), 0) AS lost,
      COALESCE(SUM(r.deal_status IN ('new','in_progress')), 0) AS open,
      COALESCE(SUM(CASE WHEN r.deal_status = 'won' THEN COALESCE(r.quote_amount, 0) ELSE 0 END), 0) AS revenue,
      AVG(CASE WHEN r.completed_at IS NOT NULL THEN (julianday(r.completed_at) - julianday(r.created_at)) * 1440 END) AS avg_completion,
      AVG(CASE WHEN r.first_response_at IS NOT NULL THEN (julianday(r.first_response_at) - julianday(r.created_at)) * 1440 END) AS avg_response
      ${base.replace('FROM requests r', 'FROM requests r LEFT JOIN users u ON u.id = r.assigned_to')}
      GROUP BY r.assigned_to ORDER BY won DESC, total DESC`, params).map((row) => ({
    ...row,
    conversion: row.total ? Math.round((row.won / row.total) * 1000) / 10 : 0,
    winRate: (row.won + row.lost) ? Math.round((row.won / (row.won + row.lost)) * 1000) / 10 : 0,
    avgCompletionMinutes: row.avg_completion === null ? null : Math.round(row.avg_completion),
    avgResponseMinutes: row.avg_response === null ? null : Math.round(row.avg_response),
    avgCompletionLabel: durationLabel(row.avg_completion),
    avgResponseLabel: durationLabel(row.avg_response),
  }));

  const byType = q(ctx.db, `SELECT r.type,
      COUNT(*) AS total,
      COALESCE(SUM(r.deal_status = 'won'), 0) AS won,
      COALESCE(SUM(r.deal_status = 'lost'), 0) AS lost
      ${base} GROUP BY r.type ORDER BY total DESC`, params).map((row) => ({
    ...row,
    label: REQUEST_TYPES[row.type]?.label || row.type,
    conversion: row.total ? Math.round((row.won / row.total) * 1000) / 10 : 0,
  }));

  const statusRows = q(ctx.db, `SELECT r.status, COUNT(*) AS total ${base} GROUP BY r.status`, params);
  const funnel = Object.entries(STATUSES).map(([key, meta]) => ({
    status: key, label: meta.label, total: statusRows.find((r) => r.status === key)?.total || 0,
  }));
  const byDepartment = q(ctx.db, `SELECT r.department_id AS departmentId, COALESCE(d.name, 'غير محدد') AS name, COUNT(*) AS total
      FROM requests r LEFT JOIN departments d ON d.id = r.department_id WHERE ${reportWhere}
      GROUP BY r.department_id ORDER BY total DESC`, params);
  const receivedBranches = q(ctx.db, `SELECT r.received_branch_id AS branchId, COALESCE(b.name, 'غير محدد') AS name, COUNT(*) AS total
      FROM requests r LEFT JOIN branches b ON b.id = r.received_branch_id WHERE ${reportWhere}
      GROUP BY r.received_branch_id ORDER BY total DESC`, params);
  const executionBranches = q(ctx.db, `SELECT r.branch_id AS branchId, COALESCE(b.name, 'غير محدد') AS name, COUNT(*) AS total
      FROM requests r LEFT JOIN branches b ON b.id = r.branch_id WHERE ${reportWhere}
      GROUP BY r.branch_id ORDER BY total DESC`, params);
  const transferWhere = `WHERE substr(t.created_at,1,10) BETWEEN ? AND ?${scope.sql ? ` AND ${scope.sql}` : ''}`;
  const transferParams = [from, to, ...scope.params];
  const transferMetrics = one(ctx.db, `SELECT COUNT(DISTINCT CASE WHEN t.from_branch_id IS NOT t.to_branch_id THEN t.request_id END) AS betweenBranches,
      COUNT(DISTINCT CASE WHEN t.from_department_id IS NOT t.to_department_id THEN t.request_id END) AS betweenDepartments
      FROM request_transfers t JOIN requests r ON r.id = t.request_id ${transferWhere}`, transferParams);

  let daily = q(ctx.db, `SELECT substr(r.created_at,1,10) AS day,
      COUNT(*) AS total,
      COALESCE(SUM(r.deal_status = 'won'), 0) AS won,
      COALESCE(SUM(r.deal_status = 'lost'), 0) AS lost
      ${base} GROUP BY day ORDER BY day`, params);
  const byDay = new Map(daily.map((r) => [r.day, r]));
  const series = [];
  for (let d = new Date(`${from}T00:00:00Z`); d <= new Date(`${to}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)) {
    const key = d.toISOString().slice(0, 10);
    const row = byDay.get(key) || { total: 0, won: 0, lost: 0 };
    series.push({ bucket: key, total: row.total, won: row.won, lost: row.lost });
  }
  let points = series;
  if (series.length > 62) {
    const months = new Map();
    for (const row of series) {
      const key = row.bucket.slice(0, 7);
      const acc = months.get(key) || { bucket: key, total: 0, won: 0, lost: 0 };
      acc.total += row.total; acc.won += row.won; acc.lost += row.lost;
      months.set(key, acc);
    }
    points = [...months.values()];
  }

  return ok(ctx.res, {
    range: { period, from, to },
    summary,
    employees,
    byType,
    byDepartment,
    receivedBranches,
    executionBranches,
    transfers: { betweenBranches: transferMetrics.betweenBranches || 0, betweenDepartments: transferMetrics.betweenDepartments || 0 },
    funnel,
    series: points,
    branches: q(ctx.db, `SELECT id, name, is_primary FROM branches WHERE active = 1
      ${user.dataScope === 'branch' && user.branchId ? 'AND id = ?' : ''}
      ORDER BY is_primary DESC, name`, user.dataScope === 'branch' && user.branchId ? [user.branchId] : []),
    departments: q(ctx.db, `SELECT id, name, branch_id FROM departments WHERE active = 1
      ${user.dataScope === 'branch' && user.branchId ? 'AND (branch_id IS NULL OR branch_id = ?)' : user.dataScope === 'department' && user.departmentId ? 'AND id = ?' : ''}
      ORDER BY name`, user.dataScope === 'branch' && user.branchId ? [user.branchId] : user.dataScope === 'department' && user.departmentId ? [user.departmentId] : []),
    agents: q(ctx.db, `SELECT id, name FROM users WHERE active = 1
      ${user.dataScope === 'branch' && user.branchId ? 'AND branch_id = ?' : user.dataScope === 'department' && user.departmentId ? 'AND department_id = ?' : user.dataScope === 'assigned' ? 'AND id = ?' : ''}
      ORDER BY name`, user.dataScope === 'branch' && user.branchId ? [user.branchId] : user.dataScope === 'department' && user.departmentId ? [user.departmentId] : user.dataScope === 'assigned' ? [user.id] : []),
    dealStages: DEAL_STAGES,
    generatedAt: isoNow(),
  });
}

export function reportsCsv(ctx) {
  const user = requireUser(ctx, 'reports:read');
  if (!user) return;
  const { period, from, to } = reportRange(ctx.query);
  const scope = requestScope(user);
  const rows = q(ctx.db, `SELECT COALESCE(u.name, 'غير مسند') AS name,
      COUNT(*) AS total,
      COALESCE(SUM(r.deal_status = 'won'), 0) AS won,
      COALESCE(SUM(r.deal_status = 'lost'), 0) AS lost,
      COALESCE(SUM(CASE WHEN r.deal_status = 'won' THEN COALESCE(r.quote_amount,0) ELSE 0 END), 0) AS revenue,
      AVG(CASE WHEN r.completed_at IS NOT NULL THEN (julianday(r.completed_at) - julianday(r.created_at)) * 1440 END) AS avg_completion
      FROM requests r LEFT JOIN users u ON u.id = r.assigned_to
      WHERE substr(r.created_at,1,10) BETWEEN ? AND ?${scopeClause(scope)}
      GROUP BY r.assigned_to ORDER BY won DESC`, [from, to, ...scope.params]);
  const header = ['الموظف', 'إجمالي الطلبات', 'مكتملة', 'ملغية', 'نسبة التحويل %', 'متوسط الإنجاز (دقيقة)', 'قيمة الصفقات (د.أ)'];
  const lines = rows.map((r) => [r.name, r.total, r.won, r.lost,
    r.total ? ((r.won / r.total) * 100).toFixed(1) : '0.0',
    r.avg_completion === null ? '' : Math.round(r.avg_completion), r.revenue].join(','));
  const csv = `\uFEFF${header.join(',')}\n${lines.join('\n')}\n`;
  ctx.res.writeHead(200, {
    'content-type': 'text/csv; charset=utf-8',
    'content-disposition': `attachment; filename="laurette-report-${period}-${from}_${to}.csv"`,
    'cache-control': 'no-store',
  });
  ctx.res.end(csv);
}

/* ---------------- public: tracking events ---------------- */

export async function trackEvent(ctx) {
  const body = await readJson(ctx.req, 4096);
  const allowed = new Set(['lead', 'whatsapp_click', 'page_view', 'cta_click']);
  const event = String(body.event || '');
  if (!allowed.has(event)) return fail(ctx.res, 400, 'حدث غير معروف');
  exec(ctx.db, 'INSERT INTO tracking_events (event, type, path, meta, created_at) VALUES (?,?,?,?,?)', [
    event,
    body.type ? String(body.type).slice(0, 30) : null,
    body.path ? String(body.path).slice(0, 200) : null,
    body.meta ? JSON.stringify(body.meta).slice(0, 1000) : null,
    isoNow(),
  ]);
  ctx.res.writeHead(204, { 'cache-control': 'no-store' });
  ctx.res.end();
}

export function trackingEvents(ctx) {
  const user = requireUser(ctx, 'overview:read');
  if (!user) return;
  if (user.roleKey && user.dataScope !== 'organization') return fail(ctx.res, 403, 'هذا التقرير متاح على مستوى الإدارة فقط');
  const rows = q(ctx.db, 'SELECT id, event, type, path, created_at FROM tracking_events ORDER BY id DESC LIMIT 100');
  const counts = q(ctx.db, "SELECT event, COUNT(*) AS n FROM tracking_events WHERE created_at >= datetime('now','-7 day') GROUP BY event");
  return ok(ctx.res, { events: rows, counts });
}

export function webhookDeliveries(ctx) {
  const user = requireUser(ctx, 'overview:read');
  if (!user) return;
  const url = process.env.N8N_BOOKING_WEBHOOK_URL ? new URL(process.env.N8N_BOOKING_WEBHOOK_URL).host + new URL(process.env.N8N_BOOKING_WEBHOOK_URL).pathname : null;
  const rows = q(ctx.db, 'SELECT id, reference, event, status, response_code, error, duration_ms, created_at FROM webhook_deliveries ORDER BY id DESC LIMIT 100');
  const summary = one(ctx.db, `SELECT
      SUM(CASE WHEN status = 'delivered' THEN 1 ELSE 0 END) delivered,
      SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) failed,
      COUNT(*) total
    FROM webhook_deliveries WHERE created_at >= datetime('now','-7 day')`) || {};
  return ok(ctx.res, {
    configured: Boolean(process.env.N8N_BOOKING_WEBHOOK_URL && process.env.N8N_BOOKING_WEBHOOK_SECRET),
    target: url,
    summary: { total: summary.total || 0, delivered: summary.delivered || 0, failed: summary.failed || 0 },
    deliveries: rows,
  });
}

export function listRequests(ctx) {
  const user = requireUser(ctx, 'requests:read');
  if (!user) return;
  const { status, type, q: search, page = '1', assigned } = ctx.query;
  const scope = requestScope(user);
  const where = scope.sql ? [scope.sql] : [];
  const params = [...scope.params];
  if (status && STATUSES[status]) { where.push('r.status = ?'); params.push(status); }
  if (type && REQUEST_TYPES[type]) { where.push('r.type = ?'); params.push(type); }
  if (assigned === 'me') { where.push('r.assigned_to = ?'); params.push(user.id); }
  if (search) {
    where.push('(r.reference LIKE ? OR r.summary LIKE ? OR r.title LIKE ? OR c.name LIKE ? OR c.phone LIKE ?)');
    const like = `%${String(search).trim()}%`;
    params.push(like, like, like, like, like);
  }
  const limit = 25;
  const offset = (Math.max(1, Number(page) || 1) - 1) * limit;
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const rows = q(ctx.db, `SELECT r.id, r.reference, r.type, r.status, r.deal_status, r.title, r.summary, r.quote_amount, r.quote_currency,
      r.assigned_to, r.created_at, r.updated_at, r.completed_at, r.first_response_at,
      r.branch_id, r.department_id, r.lead_origin, r.sales_owner_id, r.service_owner_id, r.execution_owner_id,
      CASE WHEN r.completed_at IS NOT NULL THEN ROUND((julianday(r.completed_at) - julianday(r.created_at)) * 1440) END AS completion_minutes,
      CASE WHEN r.first_response_at IS NOT NULL THEN ROUND((julianday(r.first_response_at) - julianday(r.created_at)) * 1440) END AS response_minutes,
      r.quote_amount AS value_amount,
      c.name AS customer, c.phone, u.name AS agent, b.name AS branch_name, d.name AS department_name
      FROM requests r LEFT JOIN customers c ON c.id = r.customer_id LEFT JOIN users u ON u.id = r.assigned_to
      LEFT JOIN branches b ON b.id = r.branch_id LEFT JOIN departments d ON d.id = r.department_id
      ${clause} ORDER BY r.id DESC LIMIT ? OFFSET ?`, [...params, limit, offset]);
  const total = one(ctx.db, `SELECT COUNT(*) n FROM requests r LEFT JOIN customers c ON c.id = r.customer_id ${clause}`, params).n;
  return ok(ctx.res, { requests: rows, total, page: Number(page) || 1, pages: Math.max(1, Math.ceil(total / limit)), statuses: STATUSES, types: REQUEST_TYPES, dealStages: DEAL_STAGES });
}

export function getRequest(ctx) {
  const user = requireUser(ctx, 'requests:read');
  if (!user) return;
  const scope = requestScope(user);
  const row = one(ctx.db, `SELECT r.*, c.name AS customer_name, c.phone, c.email, u.name AS agent_name,
      b.name AS branch_name, d.name AS department_name
      FROM requests r LEFT JOIN customers c ON c.id = r.customer_id LEFT JOIN users u ON u.id = r.assigned_to
      LEFT JOIN branches b ON b.id = r.branch_id LEFT JOIN departments d ON d.id = r.department_id
      WHERE r.id = ?${scopeClause(scope)}`, [Number(ctx.params.id), ...scope.params]);
  if (!row) return fail(ctx.res, 404, 'الطلب غير موجود');
  let payload = {};
  try { payload = JSON.parse(row.payload); } catch { payload = {}; }
  const events = q(ctx.db, 'SELECT * FROM request_events WHERE request_id = ? ORDER BY id', [row.id]);
  const agents = row.branch_id !== null
    ? q(ctx.db, "SELECT id, name, department, branch_id, department_id FROM users WHERE active = 1 AND branch_id = ? ORDER BY name", [row.branch_id])
    : (user.roleKey && user.dataScope !== 'organization'
      ? q(ctx.db, "SELECT id, name, department, branch_id, department_id FROM users WHERE active = 1 AND id = ? ORDER BY name", [user.id])
      : q(ctx.db, "SELECT id, name, department, branch_id, department_id FROM users WHERE active = 1 ORDER BY name"));
  const branches = q(ctx.db, 'SELECT id, name FROM branches WHERE active = 1 ORDER BY name');
  const departments = q(ctx.db, 'SELECT id, name, branch_id FROM departments WHERE active = 1 ORDER BY name');
  const transfers = q(ctx.db, `SELECT t.*, fd.name AS from_department, td.name AS to_department,
      fu.name AS from_user, tu.name AS to_user, actor.name AS requested_by_name, responder.name AS responded_by_name
      FROM request_transfers t
      LEFT JOIN departments fd ON fd.id = t.from_department_id
      LEFT JOIN departments td ON td.id = t.to_department_id
      LEFT JOIN users fu ON fu.id = t.from_user_id
      LEFT JOIN users tu ON tu.id = t.to_user_id
      LEFT JOIN users actor ON actor.id = t.requested_by
      LEFT JOIN users responder ON responder.id = t.responded_by
      WHERE t.request_id = ? ORDER BY t.id DESC`, [row.id]);
  const minutes = (from, to) => (from && to ? Math.max(0, Math.round((new Date(to).getTime() - new Date(from).getTime()) / 60000)) : null);
  return ok(ctx.res, {
    request: {
      ...row,
      payload,
      completionMinutes: minutes(row.created_at, row.completed_at),
      responseMinutes: minutes(row.created_at, row.first_response_at),
      completionLabel: durationLabel(minutes(row.created_at, row.completed_at)),
      responseLabel: durationLabel(minutes(row.created_at, row.first_response_at)),
    },
    events,
    agents,
    branches,
    departments,
    transfers,
    statuses: STATUSES,
    types: REQUEST_TYPES,
    dealStages: DEAL_STAGES,
    nextStatuses: STATUSES[row.status]?.next || [],
  });
}

export async function updateRequest(ctx) {
  const user = requireUser(ctx, 'requests:write');
  if (!user) return;
  const id = Number(ctx.params.id);
  const scope = requestScope(user);
  const row = one(ctx.db, `SELECT * FROM requests WHERE id = ?${scopeClause(scope)}`, [id, ...scope.params]);
  if (!row) return fail(ctx.res, 404, 'الطلب غير موجود');
  const body = await readJson(ctx.req);
  if (body.status !== undefined && body.status !== row.status) {
    const error = transitionError(row.status, String(body.status));
    if (error) return fail(ctx.res, 422, error);
  }
  const nextBranchId = body.branchId === undefined
    ? row.branch_id
    : (body.branchId === null || body.branchId === '' ? null : Number(body.branchId));
  const nextDepartmentId = body.departmentId === undefined
    ? row.department_id
    : (body.departmentId === null || body.departmentId === '' ? null : Number(body.departmentId));
  if (nextBranchId !== null && (!Number.isInteger(nextBranchId) || !one(ctx.db, 'SELECT id FROM branches WHERE id = ? AND active = 1', [nextBranchId]))) {
    return fail(ctx.res, 422, 'الفرع المحدد غير موجود');
  }
  const nextDepartment = nextDepartmentId === null
    ? null
    : one(ctx.db, 'SELECT id, name, branch_id FROM departments WHERE id = ? AND active = 1', [nextDepartmentId]);
  if (nextDepartmentId !== null && !nextDepartment) return fail(ctx.res, 422, 'القسم المحدد غير موجود');
  if (nextDepartment?.branch_id && nextDepartment.branch_id !== nextBranchId) return fail(ctx.res, 422, 'القسم لا يتبع الفرع المحدد');
  if (user.roleKey && user.dataScope === 'branch' && nextBranchId !== user.branchId) return fail(ctx.res, 403, 'لا يمكنك نقل الطلب خارج نطاق فرعك');
  if (user.roleKey && user.dataScope === 'department' && nextDepartmentId !== user.departmentId) return fail(ctx.res, 403, 'تحويل الطلب بين الأقسام يجب أن يتم عبر مسار التحويل');
  if (user.roleKey && user.dataScope === 'assigned'
      && (nextBranchId !== row.branch_id || nextDepartmentId !== row.department_id)) return fail(ctx.res, 403, 'لا تملك صلاحية تغيير فرع الطلب أو قسمه');
  if (row.department_id && nextDepartmentId !== row.department_id && user.roleKey && user.dataScope !== 'organization') {
    return fail(ctx.res, 422, 'استخدم طلب التحويل لتغيير قسم الطلب');
  }
  const nextAssigned = body.assignedTo === undefined
    ? row.assigned_to
    : (body.assignedTo === null || body.assignedTo === '' ? null : Number(body.assignedTo));
  const nextAgent = nextAssigned === null ? null : one(ctx.db,
    `SELECT id, name, branch_id, department_id FROM users WHERE id = ?${body.assignedTo === undefined ? '' : ' AND active = 1'}`, [nextAssigned]);
  if (body.assignedTo !== undefined && nextAssigned !== null && (!Number.isInteger(nextAssigned) || !nextAgent)) return fail(ctx.res, 422, 'الموظف غير موجود');
  if ((nextBranchId !== row.branch_id || nextDepartmentId !== row.department_id) && nextAssigned !== null && !nextAgent) {
    return fail(ctx.res, 422, 'أزل إسناد الموظف غير المتاح قبل تغيير الفرع أو القسم');
  }
  if (nextAgent && nextBranchId && nextAgent.branch_id !== nextBranchId) return fail(ctx.res, 422, 'يجب إسناد الطلب إلى موظف من الفرع نفسه');
  if (nextAgent && nextDepartmentId && nextAgent.department_id !== nextDepartmentId) return fail(ctx.res, 422, 'يجب إسناد الطلب إلى موظف من القسم نفسه');
  const nextQuoteAmount = body.quoteAmount === undefined
    ? row.quote_amount
    : (body.quoteAmount === null || body.quoteAmount === '' ? null : Number(body.quoteAmount));
  if (body.quoteAmount !== undefined && nextQuoteAmount !== null
      && (!Number.isFinite(nextQuoteAmount) || nextQuoteAmount < 0 || nextQuoteAmount > 1e7)) return fail(ctx.res, 422, 'قيمة العرض غير صحيحة');
  const allowedOrigins = new Set(['website', 'whatsapp', 'phone', 'email', 'branch', 'referral', 'other']);
  const nextLeadOrigin = body.leadOrigin === undefined ? row.lead_origin : String(body.leadOrigin);
  if (body.leadOrigin !== undefined && !allowedOrigins.has(nextLeadOrigin)) return fail(ctx.res, 422, 'مصدر العميل غير صالح');
  const ownerUpdates = [];
  for (const [field, column, label, ownerType] of [
    ['salesOwnerId', 'sales_owner_id', 'مسؤول المبيعات', 'sales'],
    ['serviceOwnerId', 'service_owner_id', 'مسؤول الخدمة', 'service'],
    ['executionOwnerId', 'execution_owner_id', 'مسؤول التنفيذ', 'execution'],
  ]) {
    if (body[field] === undefined) continue;
    const ownerId = body[field] === null || body[field] === '' ? null : Number(body[field]);
    const owner = ownerId === null ? null : one(ctx.db,
      'SELECT id, name, branch_id, department_id FROM users WHERE id = ? AND active = 1', [ownerId]);
    if (ownerId !== null && (!Number.isInteger(ownerId) || !owner)) return fail(ctx.res, 422, `${label}: الموظف غير موجود`);
    if (owner && nextBranchId && owner.branch_id !== nextBranchId) return fail(ctx.res, 422, `${label}: يجب اختيار موظف من الفرع نفسه`);
    if (owner && ownerType !== 'sales' && nextDepartmentId && owner.department_id !== nextDepartmentId) {
      return fail(ctx.res, 422, `${label}: يجب اختيار موظف من القسم نفسه`);
    }
    ownerUpdates.push({ field, column, label, ownerType, ownerId, owner });
  }
  if (nextBranchId !== row.branch_id || nextDepartmentId !== row.department_id) {
    const updatedOwnerFields = new Set(ownerUpdates.map((entry) => entry.column));
    for (const [column, label, ownerType] of [
      ['sales_owner_id', 'مسؤول المبيعات', 'sales'],
      ['service_owner_id', 'مسؤول الخدمة', 'service'],
      ['execution_owner_id', 'مسؤول التنفيذ', 'execution'],
    ]) {
      if (updatedOwnerFields.has(column) || row[column] === null) continue;
      const owner = one(ctx.db, 'SELECT branch_id, department_id FROM users WHERE id = ?', [row[column]]);
      if (owner && ((nextBranchId && owner.branch_id !== nextBranchId)
          || (ownerType !== 'sales' && nextDepartmentId && owner.department_id !== nextDepartmentId))) {
        return fail(ctx.res, 422, `حدّث ${label} أو أزل إسناده قبل تغيير الفرع أو القسم`);
      }
    }
  }
  const changes = [];
  const now = isoNow();

  if (nextBranchId !== row.branch_id || nextDepartmentId !== row.department_id) {
    exec(ctx.db, 'UPDATE requests SET branch_id = ?, department_id = ?, department = ?, updated_at = ? WHERE id = ?',
      [nextBranchId, nextDepartmentId, nextDepartment?.name || (nextDepartmentId === null ? null : row.department), now, id]);
    for (const [ownerType, previous, next] of [
      ['branch', row.branch_id, nextBranchId],
      ['department', row.department_id, nextDepartmentId],
    ]) {
      if (previous === next) continue;
      exec(ctx.db, `INSERT INTO request_owner_history
        (request_id, owner_type, previous_value, next_value, changed_by, created_at) VALUES (?,?,?,?,?,?)`,
      [id, ownerType, previous === null ? null : String(previous), next === null ? null : String(next), user.id, now]);
    }
    addEvent(ctx.db, id, {
      kind: 'organization', actorId: user.id, actorName: user.name,
      message: `تحديث التوزيع التنظيمي${nextDepartment ? `: ${nextDepartment.name}` : ''}`,
      meta: { branchId: nextBranchId, departmentId: nextDepartmentId },
    });
    changes.push('organization');
  }
  if (nextLeadOrigin !== row.lead_origin) {
    exec(ctx.db, 'UPDATE requests SET lead_origin = ?, updated_at = ? WHERE id = ?', [nextLeadOrigin, now, id]);
    addEvent(ctx.db, id, { kind: 'lead-origin', actorId: user.id, actorName: user.name, message: `تحديث مصدر العميل: ${nextLeadOrigin}` });
    changes.push('leadOrigin');
  }

  if (body.status !== undefined && body.status !== row.status) {
    exec(ctx.db, 'UPDATE requests SET status = ?, updated_at = ? WHERE id = ?', [String(body.status), now, id]);
    const stage = syncDealStage(ctx.db, id, String(body.status));
    addEvent(ctx.db, id, {
      kind: 'status', actorId: user.id, actorName: user.name,
      message: `تغيير الحالة: ${STATUSES[row.status]?.label} ← ${STATUSES[String(body.status)]?.label}`,
      meta: { from: row.status, to: body.status, dealStatus: stage },
    });
    enqueueWhatsAppNotice(ctx.db, id, 'status', ctx.baseUrl, String(body.status));
    // مزامنة حالة الطلب مع n8n/الشيت: قاعدة الموقع هي المرجع، والشيت نسخة للتنبيه والتصعيد.
    {
      const closed = ['confirmed', 'cancelled'].includes(String(body.status));
      const fresh = one(ctx.db, 'SELECT * FROM requests WHERE id = ?', [id]);
      if (fresh) {
        void notifyStatusChange(ctx.db, { ...fresh, payload: safePayload(fresh) }, { ...ctx.settings, baseUrl: ctx.baseUrl }, {
          from: row.status,
          to: String(body.status),
          fromLabel: STATUSES[row.status]?.label,
          toLabel: STATUSES[String(body.status)]?.label,
          stageLabel: stage,
          actorName: user.name,
          closed,
        });
      }
    }
    changes.push('status');
  }

  if (body.assignedTo !== undefined && nextAssigned !== row.assigned_to) {
    const assigned = nextAssigned;
    if (assigned !== null) {
      const agent = nextAgent;
      exec(ctx.db, `INSERT INTO request_owner_history (request_id, owner_type, previous_value, next_value, changed_by, created_at)
        VALUES (?, 'assigned', ?, ?, ?, ?)`, [id, row.assigned_to === null ? null : String(row.assigned_to), String(assigned), user.id, now]);
      exec(ctx.db, 'UPDATE requests SET assigned_to = ?, updated_at = ? WHERE id = ?', [assigned, now, id]);
      addEvent(ctx.db, id, { kind: 'assigned', actorId: user.id, actorName: user.name, message: `أُسند الطلب إلى ${agent.name}` });
    } else {
      exec(ctx.db, `INSERT INTO request_owner_history (request_id, owner_type, previous_value, next_value, changed_by, created_at)
        VALUES (?, 'assigned', ?, NULL, ?, ?)`, [id, row.assigned_to === null ? null : String(row.assigned_to), user.id, now]);
      exec(ctx.db, 'UPDATE requests SET assigned_to = NULL, updated_at = ? WHERE id = ?', [now, id]);
      addEvent(ctx.db, id, { kind: 'assigned', actorId: user.id, actorName: user.name, message: 'أُلغي الإسناد' });
    }
    changes.push('assigned');
  }

  for (const { field, column, label, ownerType, ownerId, owner } of ownerUpdates) {
    const previous = row[column] === null ? null : String(row[column]);
    const next = ownerId === null ? null : String(ownerId);
    if (previous === next) continue;
    exec(ctx.db, `INSERT INTO request_owner_history (request_id, owner_type, previous_value, next_value, changed_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?)`, [id, ownerType, previous, next, user.id, now]);
    exec(ctx.db, `UPDATE requests SET ${column} = ?, updated_at = ? WHERE id = ?`, [ownerId, now, id]);
    const ownerName = owner?.name || 'غير مسند';
    addEvent(ctx.db, id, { kind: 'owner', actorId: user.id, actorName: user.name, message: `تحديث ${label}: ${ownerName}` });
    changes.push(field);
  }

  if (body.quoteAmount !== undefined) {
    const amount = nextQuoteAmount;
    const note = body.quoteNote !== undefined ? String(body.quoteNote).slice(0, 500) : row.quote_note;
    exec(ctx.db, 'UPDATE requests SET quote_amount = ?, quote_note = ?, quote_currency = ?, updated_at = ? WHERE id = ?',
      [amount, note || null, 'د.أ', now, id]);
    addEvent(ctx.db, id, {
      kind: 'quote', actorId: user.id, actorName: user.name,
      message: amount === null ? 'حُذف عرض السعر' : `تم تسجيل عرض سعر: ${amount} د.أ`,
      meta: { amount },
    });
    if (amount !== null) {
      enqueueWhatsAppNotice(ctx.db, id, 'status', ctx.baseUrl, `تم تسجيل عرض سعر ${amount} د.أ`);
      const fresh = one(ctx.db, 'SELECT * FROM requests WHERE id = ?', [id]);
      if (fresh) {
        void notifyQuoteUpdate(ctx.db, { ...fresh, payload: safePayload(fresh) }, { ...ctx.settings, baseUrl: ctx.baseUrl }, {
          amount, currency: 'د.أ', actorName: user.name,
        });
      }
    }
    changes.push('quote');
  }

  if (body.note) {
    const note = String(body.note).trim().slice(0, 1000);
    if (note) {
      addEvent(ctx.db, id, { kind: 'note', actorId: user.id, actorName: user.name, message: note });
      exec(ctx.db, 'UPDATE requests SET updated_at = ? WHERE id = ?', [now, id]);
      changes.push('note');
    }
  }

  if (!changes.length) return fail(ctx.res, 400, 'لا يوجد تغيير لحفظه');
  markFirstResponse(ctx.db, id);
  audit(ctx.db, { user, action: 'update-request', entity: 'request', entityId: id, meta: { changes }, ip: clientIp(ctx.req) });
  return ok(ctx.res, { message: 'تم تحديث الطلب', changes });
}

export async function createRequestTransfer(ctx) {
  const user = requireUser(ctx, 'requests:write');
  if (!user) return;
  const requestId = Number(ctx.params.id);
  const scope = requestScope(user);
  const request = one(ctx.db, `SELECT * FROM requests WHERE id = ?${scopeClause(scope)}`, [requestId, ...scope.params]);
  if (!request) return fail(ctx.res, 404, 'الطلب غير موجود');
  const body = await readJson(ctx.req);
  const departmentId = Number(body.departmentId);
  const toUserId = body.userId === null || body.userId === '' || body.userId === undefined ? null : Number(body.userId);
  const toBranchId = body.branchId === null || body.branchId === '' || body.branchId === undefined
    ? request.branch_id : Number(body.branchId);
  const department = one(ctx.db, 'SELECT id, name, branch_id FROM departments WHERE id = ? AND active = 1', [departmentId]);
  if (!department) return fail(ctx.res, 422, 'القسم المستلم غير موجود أو غير فعال');
  const targetBranch = toBranchId === null
    ? null
    : one(ctx.db, 'SELECT id, name FROM branches WHERE id = ? AND active = 1', [toBranchId]);
  if (!targetBranch || !Number.isInteger(toBranchId)) return fail(ctx.res, 422, 'فرع الاستلام غير موجود أو غير فعال');
  if (department.branch_id && department.branch_id !== toBranchId) return fail(ctx.res, 422, 'القسم المحدد لا يتبع فرع الاستلام');
  const targetUser = toUserId === null ? null : one(ctx.db,
    'SELECT id, name, branch_id, department_id FROM users WHERE id = ? AND active = 1', [toUserId]);
  if (toUserId !== null && (!Number.isInteger(toUserId) || !targetUser)) return fail(ctx.res, 422, 'الموظف المستلم غير موجود أو غير فعال');
  if (targetUser && (targetUser.department_id !== department.id || targetUser.branch_id !== toBranchId)) return fail(ctx.res, 422, 'الموظف المحدد لا يتبع فرع وقسم الاستلام');
  if (request.branch_id === toBranchId && request.department_id === department.id
      && (!targetUser || request.assigned_to === targetUser.id)) return fail(ctx.res, 422, 'الطلب موجود مسبقًا في القسم أو لدى الموظف المحدد');
  if (one(ctx.db, "SELECT id FROM request_transfers WHERE request_id = ? AND status = 'pending'", [requestId])) {
    return fail(ctx.res, 409, 'يوجد تحويل قيد الانتظار لهذا الطلب');
  }
  const now = isoNow();
  const note = String(body.note || '').trim().slice(0, 1000);
  let created;
  try {
    created = transaction(ctx.db, () => {
    const result = exec(ctx.db, `INSERT INTO request_transfers
      (request_id, from_branch_id, to_branch_id, from_department_id, to_department_id, from_user_id, to_user_id, requested_by, status, note, created_at)
      VALUES (?,?,?,?,?,?,?,?,'pending',?,?)`,
    [requestId, request.branch_id, toBranchId, request.department_id, department.id,
      request.assigned_to, targetUser?.id || null, user.id, note || null, now]);
    addEvent(ctx.db, requestId, {
      kind: 'transfer-requested', actorId: user.id, actorName: user.name,
      message: `طلب تحويل إلى ${targetBranch.name} — ${department.name}${targetUser ? ` — ${targetUser.name}` : ''}`,
      meta: { transferId: Number(result.lastInsertRowid), toBranchId, toDepartmentId: department.id, toUserId: targetUser?.id || null },
    });
    audit(ctx.db, { user, action: 'request-transfer', entity: 'request', entityId: requestId,
      meta: { transferId: Number(result.lastInsertRowid), toBranchId, toDepartmentId: department.id, toUserId: targetUser?.id || null }, ip: clientIp(ctx.req) });
    return Number(result.lastInsertRowid);
    });
  } catch (error) {
    if (String(error.message).includes('idx_request_one_pending_transfer')) return fail(ctx.res, 409, 'يوجد تحويل قيد الانتظار لهذا الطلب');
    throw error;
  }
  return ok(ctx.res, { transferId: created, message: 'أُرسل طلب التحويل، وتبقى الملكية الحالية حتى القبول' }, 201);
}

export function listRequestTransfers(ctx) {
  const user = requireUser(ctx, 'requests:read');
  if (!user) return;
  const conditions = ["t.status = 'pending'"];
  const params = [];
  if (user.roleKey && user.dataScope === 'assigned') {
    conditions.push('t.to_user_id = ?');
    params.push(user.id);
  } else if (user.roleKey && user.dataScope === 'department') {
    if (!user.departmentId) conditions.push('1 = 0');
    else { conditions.push('t.to_department_id = ?'); params.push(user.departmentId); }
  } else if (user.roleKey && user.dataScope === 'branch') {
    if (!user.branchId) conditions.push('1 = 0');
    else { conditions.push('t.to_branch_id = ?'); params.push(user.branchId); }
  }
  const transfers = q(ctx.db, `SELECT t.id, t.request_id, r.reference, r.title, r.summary, r.status AS request_status,
      t.to_branch_id, tb.name AS to_branch, t.to_department_id, td.name AS to_department, t.to_user_id, tu.name AS to_user,
      t.requested_by, actor.name AS requested_by_name, t.note, t.created_at
      FROM request_transfers t JOIN requests r ON r.id = t.request_id
      LEFT JOIN departments td ON td.id = t.to_department_id
      LEFT JOIN branches tb ON tb.id = t.to_branch_id
      LEFT JOIN users tu ON tu.id = t.to_user_id
      LEFT JOIN users actor ON actor.id = t.requested_by
      WHERE ${conditions.join(' AND ')} ORDER BY t.id DESC LIMIT 100`, params);
  return ok(ctx.res, { transfers });
}

export async function respondRequestTransfer(ctx) {
  const user = requireUser(ctx, 'requests:write');
  if (!user) return;
  const transferId = Number(ctx.params.id);
  const transfer = one(ctx.db, `SELECT t.*, r.branch_id AS request_branch_id, r.department_id AS request_department_id,
      r.assigned_to AS request_assigned_to, r.service_owner_id AS request_service_owner_id,
      r.reference, d.name AS target_department, d.branch_id AS target_branch_id
      , b.name AS target_branch_name, t.to_branch_id AS transfer_branch_id,
      r.received_branch_id AS request_received_branch_id
      FROM request_transfers t JOIN requests r ON r.id = t.request_id
      JOIN departments d ON d.id = t.to_department_id
      JOIN branches b ON b.id = t.to_branch_id
      WHERE t.id = ?`, [transferId]);
  if (!transfer) return fail(ctx.res, 404, 'طلب التحويل غير موجود');
  if (transfer.status !== 'pending') return fail(ctx.res, 409, 'تم الرد على طلب التحويل مسبقًا');
  const body = await readJson(ctx.req);
  const decision = String(body.decision || '');
  if (!['accept', 'reject'].includes(decision)) return fail(ctx.res, 422, 'القرار غير صالح');
  const administrator = !user.roleKey && user.role === 'admin'
    || Array.isArray(user.permissions) && user.permissions.includes('*');
  const canRespond = administrator
    || (!user.roleKey && user.role === 'manager')
    || (user.roleKey && user.dataScope === 'organization')
    || (transfer.to_user_id && transfer.to_user_id === user.id)
    || (user.roleKey && user.dataScope === 'department' && user.departmentId === transfer.to_department_id)
    || (user.roleKey && user.dataScope === 'branch'
      && user.branchId === transfer.transfer_branch_id);
  if (!canRespond) return fail(ctx.res, 403, 'هذا التحويل موجّه إلى قسم أو موظف آخر');
  const note = String(body.note || '').trim().slice(0, 1000);
  const now = isoNow();
  const changed = transaction(ctx.db, () => {
    const result = exec(ctx.db, `UPDATE request_transfers SET status = ?, response_note = ?, responded_by = ?, responded_at = ?
      WHERE id = ? AND status = 'pending'`, [decision === 'accept' ? 'accepted' : 'rejected', note || null, user.id, now, transferId]);
    if (!result.changes) return false;
    if (decision === 'accept') {
      exec(ctx.db, `UPDATE requests SET department_id = ?, department = ?, assigned_to = COALESCE(?, assigned_to),
        service_owner_id = COALESCE(?, service_owner_id), branch_id = ?, updated_at = ?
        WHERE id = ?`, [transfer.to_department_id, transfer.target_department, transfer.to_user_id,
        transfer.to_user_id, transfer.transfer_branch_id, now, transfer.request_id]);
      if (transfer.request_branch_id !== transfer.transfer_branch_id) {
        exec(ctx.db, `INSERT INTO request_owner_history
          (request_id, owner_type, previous_value, next_value, changed_by, note, created_at)
          VALUES (?, 'branch', ?, ?, ?, ?, ?)`, [transfer.request_id,
          transfer.request_branch_id === null ? null : String(transfer.request_branch_id),
          String(transfer.transfer_branch_id), user.id, note || null, now]);
      }
      exec(ctx.db, `INSERT INTO request_owner_history
        (request_id, owner_type, previous_value, next_value, changed_by, note, created_at)
        VALUES (?, 'department', ?, ?, ?, ?, ?)`, [transfer.request_id,
        transfer.request_department_id === null ? null : String(transfer.request_department_id),
        String(transfer.to_department_id), user.id, note || null, now]);
      if (transfer.to_user_id) {
        exec(ctx.db, `INSERT INTO request_owner_history
          (request_id, owner_type, previous_value, next_value, changed_by, note, created_at)
          VALUES (?, 'assigned', ?, ?, ?, ?, ?)`, [transfer.request_id,
          transfer.request_assigned_to === null ? null : String(transfer.request_assigned_to),
          String(transfer.to_user_id), user.id, note || null, now]);
        exec(ctx.db, `INSERT INTO request_owner_history
          (request_id, owner_type, previous_value, next_value, changed_by, note, created_at)
          VALUES (?, 'service', ?, ?, ?, ?, ?)`, [transfer.request_id,
          transfer.request_service_owner_id === null ? null : String(transfer.request_service_owner_id),
          String(transfer.to_user_id), user.id, note || null, now]);
      }
    }
    addEvent(ctx.db, transfer.request_id, {
      kind: `transfer-${decision === 'accept' ? 'accepted' : 'rejected'}`,
      actorId: user.id, actorName: user.name,
      message: decision === 'accept'
        ? `قُبل التحويل إلى ${transfer.target_branch_name} — ${transfer.target_department}${note ? `: ${note}` : ''}`
        : `رُفض التحويل إلى ${transfer.target_branch_name} — ${transfer.target_department}${note ? `: ${note}` : ''}`,
      meta: { transferId, decision, toBranchId: transfer.transfer_branch_id, note: note || null },
    });
    audit(ctx.db, { user, action: `transfer-${decision}`, entity: 'request', entityId: transfer.request_id,
      meta: { transferId }, ip: clientIp(ctx.req) });
    return true;
  });
  if (!changed) return fail(ctx.res, 409, 'تم الرد على طلب التحويل مسبقًا');
  return ok(ctx.res, { message: decision === 'accept' ? 'تم قبول التحويل وتحديث مالكية الطلب' : 'تم رفض التحويل' });
}

/* ---------------- admin: customers ---------------- */

export function listCustomers(ctx) {
  const user = requireUser(ctx, 'customers:read');
  if (!user) return;
  const search = String(ctx.query.q || '').trim();
  const scope = requestScope(user);
  const requestWhere = scope.sql ? ` WHERE ${scope.sql}` : '';
  const cte = `WITH visible_requests AS (SELECT r.* FROM requests r${requestWhere})`;
  const visibility = scope.sql
    ? 'JOIN (SELECT DISTINCT customer_id FROM visible_requests) visible ON visible.customer_id = c.id'
    : '';
  const whereSearch = search ? 'WHERE c.name LIKE ? OR c.phone LIKE ? OR c.email LIKE ?' : '';
  const searchParams = search ? [`%${search}%`, `%${search}%`, `%${search}%`] : [];
  const rows = q(ctx.db, `${cte}
      SELECT c.*, (SELECT COUNT(*) FROM visible_requests vr WHERE vr.customer_id = c.id) n,
        (SELECT MAX(vr.created_at) FROM visible_requests vr WHERE vr.customer_id = c.id) last_request
        FROM customers c ${visibility} ${whereSearch} ORDER BY c.updated_at DESC LIMIT 100`,
      [...scope.params, ...searchParams]);
  return ok(ctx.res, { customers: rows });
}

export function getCustomer(ctx) {
  const user = requireUser(ctx, 'customers:read');
  if (!user) return;
  const id = Number(ctx.params.id);
  const scope = requestScope(user);
  const customer = one(ctx.db, `SELECT c.* FROM customers c WHERE c.id = ?${scope.sql
    ? ` AND EXISTS (SELECT 1 FROM requests r WHERE r.customer_id = c.id AND ${scope.sql})` : ''}`, [id, ...scope.params]);
  if (!customer) return fail(ctx.res, 404, 'العميل غير موجود');
  const requests = q(ctx.db, `SELECT id, reference, type, status, summary, created_at FROM requests WHERE customer_id = ?${scopeClause(scope)} ORDER BY id DESC`, [id, ...scope.params]);
  return ok(ctx.res, { customer, requests });
}

export async function updateCustomer(ctx) {
  const user = requireUser(ctx, 'customers:write');
  if (!user) return;
  const id = Number(ctx.params.id);
  const scope = requestScope(user);
  const customer = one(ctx.db, `SELECT c.* FROM customers c WHERE c.id = ?${scope.sql
    ? ` AND EXISTS (SELECT 1 FROM requests r WHERE r.customer_id = c.id AND ${scope.sql})` : ''}`, [id, ...scope.params]);
  if (!customer) return fail(ctx.res, 404, 'العميل غير موجود');
  const body = await readJson(ctx.req);
  const allowed = ['notes', 'preference', 'email', 'name', 'country'];
  const updates = [];
  const params = [];
  for (const key of allowed) {
    if (body[key] !== undefined) {
      updates.push(`${key} = ?`);
      params.push(String(body[key]).slice(0, 1000));
    }
  }
  if (!updates.length) return fail(ctx.res, 400, 'لا يوجد تغيير');
  updates.push('updated_at = ?');
  params.push(isoNow(), id);
  exec(ctx.db, `UPDATE customers SET ${updates.join(', ')} WHERE id = ?`, params);
  audit(ctx.db, { user, action: 'update-customer', entity: 'customer', entityId: id, meta: body, ip: clientIp(ctx.req) });
  return ok(ctx.res, { message: 'تم حفظ بيانات العميل' });
}

/* ---------------- admin: generic content CRUD ---------------- */

const RESOURCES = {
  programs: {
    table: 'programs', permission: 'programs:write', readPermission: 'programs:read',
    fields: {
      slug: 'slug', legacyId: 'legacy_id', category: 'category', level: 'level', title: 'title', summary: 'summary', description: 'description',
      destination: 'destination', country: 'country', days: 'days', nights: 'nights', priceFrom: 'price_from', currency: 'currency',
      status: 'status', featured: 'featured', artKey: 'art_key', hotels: 'hotels', itinerary: 'itinerary', includes: 'includes',
      excludes: 'excludes', terms: 'terms', flights: 'flights', options: 'options', badges: 'badges', meals: 'meals', airline: 'airline',
      departureDates: 'departure_dates', mode: 'mode', route: 'route', sort: 'sort',
    },
    json: ['hotels', 'itinerary', 'includes', 'excludes', 'terms', 'flights', 'options', 'badges'],
    required: ['title', 'category'],
    types: { days: 'int', nights: 'int', priceFrom: 'float', featured: 'bool', sort: 'int' },
  },
  offers: {
    table: 'offers', permission: 'content:write',
    fields: {
      slug: 'slug', title: 'title', body: 'body', artKey: 'art_key', imageUrl: 'image_url', imageAlt: 'image_alt',
      category: 'category', priceFrom: 'price_from', currency: 'currency', days: 'days', nights: 'nights',
      includes: 'includes', validUntil: 'valid_until', active: 'active', featured: 'featured', sort: 'sort',
    },
    json: ['includes'],
    required: ['title'],
    types: { priceFrom: 'float', days: 'int', nights: 'int', active: 'bool', featured: 'bool', sort: 'int' },
  },
  news: {
    table: 'news', permission: 'content:write',
    fields: { title: 'title', body: 'body', airline: 'airline', urgent: 'urgent', publishedAt: 'published_at' },
    required: ['title'], types: { urgent: 'bool' },
  },
  articles: {
    table: 'articles', permission: 'content:write',
    fields: { slug: 'slug', title: 'title', excerpt: 'excerpt', body: 'body', category: 'category', tags: 'tags', readingMinutes: 'reading_minutes', status: 'status', publishedAt: 'published_at', updatedAt: 'updated_at' },
    json: ['tags'], required: ['title', 'body'], types: { readingMinutes: 'int' },
  },
  faq: {
    table: 'faq', permission: 'content:write',
    fields: { question: 'question', answer: 'answer', category: 'category', sort: 'sort', published: 'published' },
    required: ['question', 'answer'], types: { sort: 'int', published: 'bool' },
  },
  visa: {
    table: 'visa_rules', permission: 'visa:write',
    fields: { destination: 'destination', purpose: 'purpose', summary: 'summary', docs: 'docs', notes: 'notes', sourceName: 'source_name', sourceUrl: 'source_url', lastVerified: 'last_verified', requiresVerification: 'requires_verification', published: 'published' },
    json: ['docs', 'notes'], required: ['destination', 'summary'], types: { requiresVerification: 'bool', published: 'bool' },
  },
  kb: {
    table: 'kb_docs', permission: 'kb:write',
    fields: { title: 'title', body: 'body', category: 'category', tags: 'tags', active: 'active' },
    json: ['tags'], required: ['title', 'body'], types: { active: 'bool' },
  },
  destinations: {
    table: 'destinations', permission: 'content:write',
    fields: { slug: 'slug', name: 'name', nameEn: 'name_en', kind: 'kind', parentSlug: 'parent_slug', summary: 'summary', highlights: 'highlights', bestTime: 'best_time', mapUrl: 'map_url', artKey: 'art_key', sort: 'sort', published: 'published' },
    json: ['highlights'], required: ['name'], types: { sort: 'int', published: 'bool' },
  },
  reviews: {
    table: 'reviews', permission: 'content:write',
    fields: { name: 'name', branch: 'branch', rating: 'rating', text: 'text', source: 'source', publishedAt: 'published_at', visible: 'visible' },
    required: ['name', 'text'], types: { rating: 'int', visible: 'bool' },
  },
};

function coerce(spec, body) {
  const values = {};
  const errors = {};
  for (const [key, column] of Object.entries(spec.fields)) {
    if (body[key] === undefined) continue;
    let value = body[key];
    const type = spec.types?.[key];
    if (type === 'int') {
      value = value === null || value === '' ? null : Number(value);
      if (value !== null && !Number.isInteger(value)) errors[key] = 'قيمة رقمية غير صحيحة';
    } else if (type === 'float') {
      value = value === null || value === '' ? null : Number(value);
      if (value !== null && !Number.isFinite(value)) errors[key] = 'قيمة رقمية غير صحيحة';
    } else if (type === 'bool') {
      value = value === true || value === 1 || value === '1' || value === 'true' ? 1 : 0;
    } else if (spec.json?.includes(key)) {
      if (typeof value === 'string') {
        value = value.split('\n').map((s) => s.trim()).filter(Boolean);
      }
      if (!Array.isArray(value)) errors[key] = 'يجب أن تكون قائمة';
      else if (key === 'options') {
        value = value.map((o) => (typeof o === 'string'
          ? (() => { const [label, price] = o.split('|'); return { label: (label || '').trim(), price: Number(String(price || '').replace(/[^\d.]/g, '')) }; })()
          : { label: String(o.label || ''), price: Number(o.price) })).filter((o) => o.label);
      } else if (key === 'hotels') {
        value = value.map((o) => (typeof o === 'string'
          ? (() => { const [city, name, stars, distance] = o.split('|').map((s) => s.trim()); return { city, name, stars: Number(stars) || 0, distance: distance || '' }; })()
          : { city: String(o.city || ''), name: String(o.name || ''), stars: Number(o.stars) || 0, distance: String(o.distance || '') })).filter((o) => o.name);
      } else {
        value = value.map(String).slice(0, 60);
      }
    } else {
      value = String(value ?? '').slice(0, 8000);
    }
    values[column] = spec.json?.includes(key) ? JSON.stringify(value) : value;
  }
  return { values, errors };
}

export function listResource(ctx, resource) {
  const spec = RESOURCES[resource];
  if (!spec) return fail(ctx.res, 404, 'مورد غير معروف');
  if (!requireUser(ctx, spec.readPermission || spec.permission)) return;
  const rows = q(ctx.db, `SELECT * FROM ${spec.table} ORDER BY id DESC LIMIT 500`);
  return ok(ctx.res, { items: rows });
}

export async function createResource(ctx, resource) {
  const spec = RESOURCES[resource];
  if (!spec) return fail(ctx.res, 404, 'مورد غير معروف');
  const user = requireUser(ctx, spec.permission);
  if (!user) return;
  const body = await readJson(ctx.req, 200 * 1024);
  for (const key of spec.required) if (!body[key]) return fail(ctx.res, 422, 'حقول مطلوبة ناقصة', { [key]: 'مطلوب' });
  if (!body.slug && spec.fields.slug) body.slug = slugify(body.title || body.name || body.question || `item-${Date.now()}`);
  const { values, errors } = coerce(spec, body);
  if (Object.keys(errors).length) return fail(ctx.res, 422, 'تحقق من الحقول', errors);
  const cols = Object.keys(values);
  const now = isoNow();
  if (spec.table === 'programs') {
    values.created_at = now; values.updated_at = now; cols.push('created_at', 'updated_at');
  }
  if (spec.table === 'articles') {
    values.updated_at = now; cols.push('updated_at');
  }
  if (spec.table === 'kb_docs') { values.updated_at = now; cols.push('updated_at'); }
  if (spec.table === 'destinations') { values.slug = String(values.slug || slugify(body.name)); }
  if (spec.table === 'reviews') { values.source = values.source || 'Google'; }
  const placeholders = cols.map(() => '?').join(',');
  try {
    const res = exec(ctx.db, `INSERT INTO ${spec.table} (${cols.join(',')}) VALUES (${placeholders})`, Object.values(values));
    audit(ctx.db, { user, action: `create-${resource}`, entity: resource, entityId: res.lastInsertRowid, ip: clientIp(ctx.req) });
    return ok(ctx.res, { id: Number(res.lastInsertRowid) }, 201);
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) return fail(ctx.res, 409, 'المعرّف (slug) مستخدم مسبقًا');
    throw err;
  }
}

export async function updateResource(ctx, resource) {
  const spec = RESOURCES[resource];
  if (!spec) return fail(ctx.res, 404, 'مورد غير معروف');
  const user = requireUser(ctx, spec.permission);
  if (!user) return;
  const id = Number(ctx.params.id);
  const existing = one(ctx.db, `SELECT * FROM ${spec.table} WHERE id = ?`, [id]);
  if (!existing) return fail(ctx.res, 404, 'العنصر غير موجود');
  const body = await readJson(ctx.req, 200 * 1024);
  const { values, errors } = coerce(spec, body);
  if (Object.keys(errors).length) return fail(ctx.res, 422, 'تحقق من الحقول', errors);
  const cols = Object.keys(values);
  if (!cols.length) return fail(ctx.res, 400, 'لا يوجد تغيير');
  const set = cols.map((c) => `${c} = ?`).join(', ');
  const now = isoNow();
  const extra = { programs: 'updated_at', articles: 'updated_at', kb_docs: 'updated_at' }[spec.table];
  const sql = extra ? `UPDATE ${spec.table} SET ${set}, ${extra} = ? WHERE id = ?` : `UPDATE ${spec.table} SET ${set} WHERE id = ?`;
  const params = extra ? [...Object.values(values), now, id] : [...Object.values(values), id];
  try {
    exec(ctx.db, sql, params);
    audit(ctx.db, { user, action: `update-${resource}`, entity: resource, entityId: id, meta: body, ip: clientIp(ctx.req) });
    return ok(ctx.res, { message: 'تم الحفظ' });
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) return fail(ctx.res, 409, 'المعرّف (slug) مستخدم مسبقًا');
    throw err;
  }
}

export async function deleteResource(ctx, resource) {
  const spec = RESOURCES[resource];
  if (!spec) return fail(ctx.res, 404, 'مورد غير معروف');
  const user = requireUser(ctx, spec.permission);
  if (!user) return;
  const id = Number(ctx.params.id);
  if (spec.table === 'programs') {
    const program = one(ctx.db, 'SELECT slug FROM programs WHERE id = ?', [id]);
    const hasRequests = program
      ? one(ctx.db, 'SELECT COUNT(*) n FROM requests WHERE payload LIKE ?', [`%"programSlug":"${program.slug}"%`])
      : { n: 0 };
    if (hasRequests.n > 0) {
      exec(ctx.db, "UPDATE programs SET status = 'archived', updated_at = ? WHERE id = ?", [isoNow(), id]);
      audit(ctx.db, { user, action: 'archive-program', entity: resource, entityId: id, ip: clientIp(ctx.req) });
      return ok(ctx.res, { message: 'البرنامج مرتبط بطلبات، فأُرشف بدل الحذف' });
    }
  }
  exec(ctx.db, `DELETE FROM ${spec.table} WHERE id = ?`, [id]);
  audit(ctx.db, { user, action: `delete-${resource}`, entity: resource, entityId: id, ip: clientIp(ctx.req) });
  return ok(ctx.res, { message: 'تم الحذف' });
}

/* ---------------- admin: users, audit, settings ---------------- */

const ROLE_PERMISSIONS = [
  'overview:read', 'requests:read', 'requests:write', 'customers:read', 'customers:write',
  'programs:read', 'programs:write', 'content:write', 'visa:write', 'kb:write',
  'audit:read', 'reports:read', 'users:write', 'settings:write', 'organization:read', 'organization:write',
];

export function organization(ctx) {
  const user = requireUser(ctx, 'organization:read');
  if (!user) return;
  return ok(ctx.res, {
    branches: q(ctx.db, 'SELECT id, code, name, active, created_at, updated_at FROM branches ORDER BY name'),
    departments: q(ctx.db, `SELECT d.id, d.name, d.branch_id, d.active, b.name AS branch_name
      FROM departments d LEFT JOIN branches b ON b.id = d.branch_id ORDER BY d.name`),
    roles: q(ctx.db, `SELECT role_key, name, base_role, data_scope, permissions, active
      FROM role_definitions ORDER BY name`).map((role) => ({ ...role, permissions: JSON.parse(role.permissions || '[]') })),
    permissions: ROLE_PERMISSIONS,
    scopes: ['organization', 'branch', 'department', 'assigned'],
  });
}

export async function createBranch(ctx) {
  const user = requireUser(ctx, 'organization:write');
  if (!user) return;
  const body = await readJson(ctx.req);
  const code = String(body.code || '').trim().toLowerCase();
  const name = String(body.name || '').trim();
  if (!/^[a-z0-9-]{2,32}$/.test(code) || name.length < 2 || name.length > 80) return fail(ctx.res, 422, 'رمز الفرع واسمه غير صالحين');
  const now = isoNow();
  try {
    const result = exec(ctx.db, 'INSERT INTO branches (code, name, created_at, updated_at) VALUES (?,?,?,?)', [code, name, now, now]);
    audit(ctx.db, { user, action: 'create-branch', entity: 'branch', entityId: result.lastInsertRowid, ip: clientIp(ctx.req) });
    return ok(ctx.res, { id: Number(result.lastInsertRowid) }, 201);
  } catch (error) {
    if (String(error.message).includes('UNIQUE')) return fail(ctx.res, 409, 'رمز الفرع أو اسمه مستخدم مسبقًا');
    throw error;
  }
}

export async function createDepartment(ctx) {
  const user = requireUser(ctx, 'organization:write');
  if (!user) return;
  const body = await readJson(ctx.req);
  const name = String(body.name || '').trim();
  const branchId = body.branchId === undefined || body.branchId === '' || body.branchId === null ? null : Number(body.branchId);
  if (name.length < 2 || name.length > 80) return fail(ctx.res, 422, 'اسم القسم غير صالح');
  if (branchId !== null && (!Number.isInteger(branchId) || !one(ctx.db, 'SELECT id FROM branches WHERE id = ? AND active = 1', [branchId]))) {
    return fail(ctx.res, 422, 'الفرع غير موجود');
  }
  const now = isoNow();
  try {
    const result = exec(ctx.db, 'INSERT INTO departments (name, branch_id, created_at, updated_at) VALUES (?,?,?,?)', [name, branchId, now, now]);
    audit(ctx.db, { user, action: 'create-department', entity: 'department', entityId: result.lastInsertRowid, meta: { branchId }, ip: clientIp(ctx.req) });
    return ok(ctx.res, { id: Number(result.lastInsertRowid) }, 201);
  } catch (error) {
    if (String(error.message).includes('UNIQUE')) return fail(ctx.res, 409, 'يوجد قسم بهذا الاسم في هذا النطاق');
    throw error;
  }
}

export async function createRole(ctx) {
  const user = requireUser(ctx, 'organization:write');
  if (!user) return;
  const body = await readJson(ctx.req);
  const key = String(body.roleKey || '').trim().toLowerCase();
  const name = String(body.name || '').trim();
  const baseRole = String(body.baseRole || 'agent');
  const dataScope = String(body.dataScope || 'assigned');
  const permissions = body.permissions;
  if (!/^[a-z][a-z0-9_-]{1,39}$/.test(key) || name.length < 2 || name.length > 80) return fail(ctx.res, 422, 'معرّف الدور واسمه غير صالحين');
  if (!['admin', 'manager', 'agent'].includes(baseRole)) return fail(ctx.res, 422, 'نوع الدور الأساسي غير صالح');
  if (!['organization', 'branch', 'department', 'assigned'].includes(dataScope)) return fail(ctx.res, 422, 'نطاق البيانات غير صالح');
  if (!Array.isArray(permissions) || permissions.length > ROLE_PERMISSIONS.length
      || permissions.some((permission) => !ROLE_PERMISSIONS.includes(permission))) return fail(ctx.res, 422, 'قائمة الصلاحيات غير صالحة');
  if (permissions.includes('*')) return fail(ctx.res, 422, 'الصلاحية الشاملة محجوزة للدور الافتراضي لمدير النظام');
  if (!canDelegateProfile(user, { data_scope: dataScope, permissions: JSON.stringify(permissions) })) return fail(ctx.res, 403, 'لا يمكنك منح صلاحيات أوسع من صلاحياتك');
  const now = isoNow();
  try {
    exec(ctx.db, `INSERT INTO role_definitions (role_key, name, base_role, data_scope, permissions, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?)`, [key, name, baseRole, dataScope, JSON.stringify([...new Set(permissions)]), now, now]);
    audit(ctx.db, { user, action: 'create-role', entity: 'role', entityId: key, meta: { baseRole, dataScope, permissions }, ip: clientIp(ctx.req) });
    return ok(ctx.res, { roleKey: key }, 201);
  } catch (error) {
    if (String(error.message).includes('UNIQUE')) return fail(ctx.res, 409, 'معرّف الدور أو اسمه مستخدم');
    throw error;
  }
}

export async function updateRole(ctx) {
  const user = requireUser(ctx, 'organization:write');
  if (!user) return;
  const key = String(ctx.params.roleKey || '');
  const role = one(ctx.db, 'SELECT * FROM role_definitions WHERE role_key = ?', [key]);
  if (!role) return fail(ctx.res, 404, 'الدور غير موجود');
  if (key === 'admin') return fail(ctx.res, 422, 'لا يمكن تعديل دور مدير النظام الافتراضي');
  const body = await readJson(ctx.req);
  const name = body.name === undefined ? role.name : String(body.name).trim();
  const baseRole = body.baseRole === undefined ? role.base_role : String(body.baseRole);
  const dataScope = body.dataScope === undefined ? role.data_scope : String(body.dataScope);
  const permissions = body.permissions === undefined ? JSON.parse(role.permissions) : body.permissions;
  if (body.active !== undefined && typeof body.active !== 'boolean') return fail(ctx.res, 422, 'حالة الدور غير صالحة');
  const active = body.active === undefined ? role.active : (body.active ? 1 : 0);
  if (name.length < 2 || name.length > 80 || !['admin', 'manager', 'agent'].includes(baseRole)
      || !['organization', 'branch', 'department', 'assigned'].includes(dataScope)
      || !Array.isArray(permissions) || permissions.length > ROLE_PERMISSIONS.length
      || permissions.some((permission) => !ROLE_PERMISSIONS.includes(permission))) {
    return fail(ctx.res, 422, 'بيانات الدور غير صالحة');
  }
  if (permissions.includes('*')) return fail(ctx.res, 422, 'الصلاحية الشاملة محجوزة لمدير النظام الافتراضي');
  if ((user.roleKey && user.dataScope !== 'organization') || !canDelegateProfile(user, role)
      || !canDelegateProfile(user, { data_scope: dataScope, permissions: JSON.stringify(permissions) })) return fail(ctx.res, 403, 'لا يمكنك تعديل دور خارج صلاحياتك');
  try {
    exec(ctx.db, `UPDATE role_definitions SET name = ?, base_role = ?, data_scope = ?, permissions = ?, active = ?, updated_at = ?
      WHERE role_key = ?`, [name, baseRole, dataScope, JSON.stringify([...new Set(permissions)]), active, isoNow(), key]);
  } catch (error) {
    if (String(error.message).includes('UNIQUE')) return fail(ctx.res, 409, 'اسم الدور مستخدم مسبقًا');
    throw error;
  }
  if (!active) exec(ctx.db, 'DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE role_key = ?)', [key]);
  audit(ctx.db, { user, action: 'update-role', entity: 'role', entityId: key, meta: { baseRole, dataScope, permissions, active }, ip: clientIp(ctx.req) });
  return ok(ctx.res, { message: 'تم تحديث الدور' });
}

export function listUsers(ctx) {
  const user = requireUser(ctx, 'users:write');
  if (!user) return;
  const scope = userScope(user);
  return ok(ctx.res, {
    users: q(ctx.db, `SELECT u.id, u.username, u.name, u.role, u.role_key, u.department, u.department_id, u.branch_id,
      u.phone, u.active, u.must_change, u.last_login_at, u.created_at,
      b.name AS branch_name, d.name AS department_name, rd.name AS role_name
      FROM users u LEFT JOIN branches b ON b.id = u.branch_id
      LEFT JOIN departments d ON d.id = u.department_id
      LEFT JOIN role_definitions rd ON rd.role_key = u.role_key
      WHERE 1=1${scopeClause(scope)} ORDER BY u.id`, scope.params),
    branches: q(ctx.db, 'SELECT id, name FROM branches WHERE active = 1 ORDER BY name'),
    departments: q(ctx.db, 'SELECT id, name, branch_id FROM departments WHERE active = 1 ORDER BY name'),
    roles: q(ctx.db, 'SELECT role_key, name, base_role FROM role_definitions WHERE active = 1 ORDER BY name'),
  });
}

export async function createUser(ctx) {
  const user = requireUser(ctx, 'users:write');
  if (!user) return;
  const body = await readJson(ctx.req);
  const username = String(body.username || '').trim().toLowerCase();
  const name = String(body.name || '').trim();
  const role = String(body.role || 'agent');
  const roleKey = String(body.roleKey || '');
  const password = String(body.password || '');
  if (!/^[a-z0-9._-]{3,32}$/.test(username)) return fail(ctx.res, 422, 'اسم المستخدم يجب أن يكون 3-32 حرفًا لاتينيًا');
  if (name.length < 2) return fail(ctx.res, 422, 'الاسم مطلوب');
  if (!['admin', 'manager', 'agent'].includes(role)) return fail(ctx.res, 422, 'الدور غير صحيح');
  if (password.length < 10 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) return fail(ctx.res, 422, 'كلمة المرور 10 أحرف على الأقل وتحتوي حرفًا ورقمًا');
  if (one(ctx.db, 'SELECT id FROM users WHERE username = ?', [username])) return fail(ctx.res, 409, 'اسم المستخدم مستخدم');
  const profile = roleKey ? one(ctx.db, 'SELECT role_key, base_role, data_scope, permissions FROM role_definitions WHERE role_key = ? AND active = 1', [roleKey]) : null;
  if (roleKey && !profile) return fail(ctx.res, 422, 'الدور المحدد غير موجود أو غير فعال');
  if (profile && !canDelegateProfile(user, profile)) return fail(ctx.res, 403, 'لا يمكنك منح نطاق بيانات أو صلاحيات أوسع من صلاحياتك');
  if (!profile && !canDelegateProfile(user, { data_scope: 'organization', permissions: '["*"]' })) return fail(ctx.res, 403, 'لا يمكنك منح دور غير مقيد');
  const resolvedRole = profile ? profile.base_role : role;
  let branchId = body.branchId === undefined || body.branchId === '' || body.branchId === null ? null : Number(body.branchId);
  let departmentId = body.departmentId === undefined || body.departmentId === '' || body.departmentId === null ? null : Number(body.departmentId);
  if (branchId !== null && (!Number.isInteger(branchId) || !one(ctx.db, 'SELECT id FROM branches WHERE id = ? AND active = 1', [branchId]))) return fail(ctx.res, 422, 'الفرع المحدد غير موجود');
  if (departmentId === null && body.department) {
    departmentId = one(ctx.db, 'SELECT id FROM departments WHERE name = ? ORDER BY id LIMIT 1', [String(body.department).trim()])?.id || null;
  }
  const department = departmentId === null ? null : one(ctx.db, 'SELECT id, branch_id, name FROM departments WHERE id = ? AND active = 1', [departmentId]);
  if (departmentId !== null && !department) return fail(ctx.res, 422, 'القسم المحدد غير موجود');
  if (department?.branch_id && branchId === null) branchId = department.branch_id;
  if (department?.branch_id && department.branch_id !== branchId) return fail(ctx.res, 422, 'القسم لا يتبع الفرع المحدد');
  if (user.roleKey && user.dataScope === 'branch' && branchId !== user.branchId) return fail(ctx.res, 403, 'لا يمكنك إنشاء موظف خارج نطاق فرعك');
  if (user.roleKey && user.dataScope === 'department' && departmentId !== user.departmentId) return fail(ctx.res, 403, 'لا يمكنك إنشاء موظف خارج نطاق قسمك');
  if (user.roleKey && user.dataScope === 'assigned') return fail(ctx.res, 403, 'نطاقك لا يسمح بإنشاء موظفين');
  if (profile?.data_scope === 'branch' && !branchId) return fail(ctx.res, 422, 'الدور المحدد يتطلب ربط الموظف بفرع');
  if (profile?.data_scope === 'department' && !departmentId) return fail(ctx.res, 422, 'الدور المحدد يتطلب ربط الموظف بقسم');
  const { hash, salt } = hashPassword(password);
  const departmentName = department?.name || String(body.department || '').slice(0, 60);
  const res = exec(ctx.db, `INSERT INTO users
      (username, name, role, role_key, branch_id, department_id, department, phone, password_hash, password_salt, must_change, active, created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [username, name, resolvedRole, roleKey || null, branchId, departmentId, departmentName, String(body.phone || '').slice(0, 20), hash, salt, 1, 1, isoNow()]);
  audit(ctx.db, { user, action: 'create-user', entity: 'user', entityId: res.lastInsertRowid, meta: { username, role: resolvedRole, roleKey, branchId, departmentId }, ip: clientIp(ctx.req) });
  return ok(ctx.res, { id: Number(res.lastInsertRowid) }, 201);
}

export async function updateUser(ctx) {
  const user = requireUser(ctx, 'users:write');
  if (!user) return;
  const id = Number(ctx.params.id);
  const scope = userScope(user);
  const target = one(ctx.db, `SELECT u.* FROM users u WHERE u.id = ?${scopeClause(scope)}`, [id, ...scope.params]);
  if (!target) return fail(ctx.res, 404, 'المستخدم غير موجود');
  const targetProfile = target.role_key ? one(ctx.db, 'SELECT data_scope, permissions FROM role_definitions WHERE role_key = ?', [target.role_key]) : { data_scope: 'organization', permissions: '["*"]' };
  if (!targetProfile || !canDelegateProfile(user, targetProfile)) return fail(ctx.res, 403, 'لا يمكنك تعديل حساب أعلى صلاحية');
  const body = await readJson(ctx.req);
  if ((body.role !== undefined || body.roleKey === '' || body.roleKey === null) && !body.roleKey
      && !canDelegateProfile(user, { data_scope: 'organization', permissions: '["*"]' })) return fail(ctx.res, 403, 'لا يمكنك منح دور غير مقيد');
  if (body.role && !['admin', 'manager', 'agent'].includes(body.role)) return fail(ctx.res, 422, 'الدور غير صحيح');
  if (body.active !== undefined && typeof body.active !== 'boolean') return fail(ctx.res, 422, 'حالة المستخدم غير صالحة');
  if (target.id === user.id && body.active === false) return fail(ctx.res, 422, 'لا يمكنك تعطيل حسابك الحالي');
  const updates = [];
  const params = [];
  if (body.roleKey !== undefined) {
    const key = String(body.roleKey || '');
    const profile = key ? one(ctx.db, 'SELECT role_key, base_role, data_scope, permissions, active FROM role_definitions WHERE role_key = ?', [key]) : null;
    if (key && (!profile || !profile.active)) return fail(ctx.res, 422, 'الدور المحدد غير موجود أو غير فعال');
    if (profile && !canDelegateProfile(user, profile)) return fail(ctx.res, 403, 'لا يمكنك منح نطاق بيانات أو صلاحيات أوسع من صلاحياتك');
    const nextRole = profile ? profile.base_role : (body.role || target.role);
    if (target.id === user.id) {
      const permissions = profile ? JSON.parse(profile.permissions) : [];
      if (profile && !permissions.includes('*') && !permissions.includes('users:write')) return fail(ctx.res, 422, 'لا يمكنك إزالة صلاحية إدارة المستخدمين من حسابك الحالي');
      if (!profile && nextRole !== 'admin') return fail(ctx.res, 422, 'لا يمكنك خفض صلاحية حسابك الحالي');
    }
    updates.push('role_key = ?', 'role = ?');
    params.push(key || null, nextRole);
  } else if (body.role) {
    if (target.id === user.id && body.role !== 'admin') return fail(ctx.res, 422, 'لا يمكنك خفض صلاحية حسابك الحالي');
    updates.push('role = ?', 'role_key = NULL');
    params.push(body.role);
  }
  let departmentName = target.department;
  if (body.branchId !== undefined) {
    const branchId = body.branchId === null || body.branchId === '' ? null : Number(body.branchId);
    if (branchId !== null && (!Number.isInteger(branchId) || !one(ctx.db, 'SELECT id FROM branches WHERE id = ? AND active = 1', [branchId]))) return fail(ctx.res, 422, 'الفرع المحدد غير موجود');
    updates.push('branch_id = ?'); params.push(branchId);
  }
  if (body.departmentId !== undefined) {
    const departmentId = body.departmentId === null || body.departmentId === '' ? null : Number(body.departmentId);
    const department = departmentId === null ? null : one(ctx.db, 'SELECT id, name, branch_id FROM departments WHERE id = ? AND active = 1', [departmentId]);
    if (departmentId !== null && !department) return fail(ctx.res, 422, 'القسم المحدد غير موجود');
    const selectedBranch = body.branchId === undefined ? target.branch_id : (body.branchId === null || body.branchId === '' ? null : Number(body.branchId));
    if (department?.branch_id && department.branch_id !== selectedBranch) return fail(ctx.res, 422, 'القسم لا يتبع الفرع المحدد');
    departmentName = department?.name || '';
    updates.push('department_id = ?', 'department = ?');
    params.push(departmentId, departmentName);
  } else if (body.department !== undefined) {
    departmentName = String(body.department).slice(0, 60);
    const department = departmentName ? one(ctx.db, 'SELECT id FROM departments WHERE name = ? ORDER BY id LIMIT 1', [departmentName]) : null;
    updates.push('department = ?', 'department_id = ?');
    params.push(departmentName, department?.id || null);
  }
  const resultingBranchId = body.branchId === undefined ? target.branch_id : (body.branchId === null || body.branchId === '' ? null : Number(body.branchId));
  const resultingDepartmentId = body.departmentId !== undefined
    ? (body.departmentId === null || body.departmentId === '' ? null : Number(body.departmentId))
    : body.department !== undefined
      ? (one(ctx.db, 'SELECT id FROM departments WHERE name = ? ORDER BY id LIMIT 1', [String(body.department).trim()])?.id || null)
      : target.department_id;
  const resultingDepartment = resultingDepartmentId === null ? null : one(ctx.db,
    'SELECT id, branch_id FROM departments WHERE id = ? AND active = 1', [resultingDepartmentId]);
  const resultingRoleKey = body.roleKey === undefined ? (body.role ? null : target.role_key) : String(body.roleKey || '');
  const resultingProfile = resultingRoleKey ? one(ctx.db,
    'SELECT data_scope FROM role_definitions WHERE role_key = ? AND active = 1', [resultingRoleKey]) : null;
  if (resultingDepartmentId !== null && !resultingDepartment) return fail(ctx.res, 422, 'القسم المحدد غير موجود');
  if (resultingDepartment?.branch_id && resultingDepartment.branch_id !== resultingBranchId) return fail(ctx.res, 422, 'القسم لا يتبع الفرع المحدد');
  if (resultingProfile?.data_scope === 'branch' && !resultingBranchId) return fail(ctx.res, 422, 'الدور المحدد يتطلب ربط الموظف بفرع');
  if (resultingProfile?.data_scope === 'department' && !resultingDepartmentId) return fail(ctx.res, 422, 'الدور المحدد يتطلب ربط الموظف بقسم');
  if (user.roleKey && user.dataScope === 'branch' && resultingBranchId !== user.branchId) return fail(ctx.res, 403, 'لا يمكنك نقل الموظف خارج نطاق فرعك');
  if (user.roleKey && user.dataScope === 'department' && resultingDepartmentId !== user.departmentId) return fail(ctx.res, 403, 'لا يمكنك نقل الموظف خارج نطاق قسمك');
  if (body.active !== undefined) { updates.push('active = ?'); params.push(body.active ? 1 : 0); }
  if (body.name) { updates.push('name = ?'); params.push(String(body.name).slice(0, 80)); }
  if (body.password) {
    const pw = String(body.password);
    if (pw.length < 10 || !/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return fail(ctx.res, 422, 'كلمة المرور 10 أحرف على الأقل وتحتوي حرفًا ورقمًا');
    const { hash, salt } = hashPassword(pw);
    updates.push('password_hash = ?', 'password_salt = ?', 'must_change = 1');
    params.push(hash, salt);
  }
  if (!updates.length) return fail(ctx.res, 400, 'لا يوجد تغيير');
  params.push(id);
  exec(ctx.db, `UPDATE users SET ${updates.join(', ')} WHERE id = ?`, params);
  if (body.active === false || body.password) exec(ctx.db, 'DELETE FROM sessions WHERE user_id = ?', [id]);
  audit(ctx.db, { user, action: 'update-user', entity: 'user', entityId: id, meta: {
    role: body.role, roleKey: body.roleKey, branchId: body.branchId, departmentId: body.departmentId,
    active: body.active, passwordChanged: !!body.password,
  }, ip: clientIp(ctx.req) });
  return ok(ctx.res, { message: 'تم تحديث المستخدم' });
}

export function listMedia(ctx) {
  const user = requireUser(ctx, 'content:write');
  if (!user) return;
  const dir = join(HERE_PUBLIC, 'media', 'offers');
  let files = [];
  try {
    files = readdirSync(dir).filter((f) => /\.(jpe?g|png|webp)$/i.test(f) && !/-thumb\./.test(f)).sort();
  } catch { files = []; }
  return ok(ctx.res, { files: files.map((f) => `/media/offers/${f}`) });
}

export function auditLog(ctx) {
  const user = requireUser(ctx, 'audit:read');
  if (!user) return;
  if (user.roleKey && user.dataScope !== 'organization') return fail(ctx.res, 403, 'سجل العمليات متاح على مستوى الإدارة فقط');
  const rows = q(ctx.db, 'SELECT * FROM audit_log ORDER BY id DESC LIMIT 200');
  return ok(ctx.res, { entries: rows });
}

export function getSettings(ctx) {
  const user = requireUser(ctx, 'settings:write');
  if (!user) return;
  const rows = q(ctx.db, 'SELECT key, value FROM settings ORDER BY key');
  const settings = {};
  for (const r of rows) { try { settings[r.key] = JSON.parse(r.value); } catch { settings[r.key] = r.value; } }
  return ok(ctx.res, { settings });
}

export async function updateSettings(ctx) {
  const user = requireUser(ctx, 'settings:write');
  if (!user) return;
  const body = await readJson(ctx.req, 64 * 1024);
  const allowed = ['brand', 'brandShort', 'whatsapp', 'currency', 'heroHeadline', 'heroSub', 'heroVideoUrl', 'heroPosterUrl', 'contactGroups', 'branches', 'social', 'visaDisclaimer', 'ratingNote', 'reviewsCheckedAt', 'lastContentUpdate', 'metaPixelId', 'gtmId', 'googleAdsId', 'googleAdsLabel', 'trackingEnabled'];
  const changes = {};
  for (const key of allowed) {
    if (body[key] === undefined) continue;
    changes[key] = body[key];
    exec(ctx.db, 'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [key, JSON.stringify(body[key])]);
  }
  if (!Object.keys(changes).length) return fail(ctx.res, 400, 'لا يوجد تغيير');
  audit(ctx.db, { user, action: 'update-settings', entity: 'settings', entityId: 'global', meta: { keys: Object.keys(changes) }, ip: clientIp(ctx.req) });
  return ok(ctx.res, { message: 'تم حفظ الإعدادات' });
}

export function assistantLog(ctx) {
  const user = requireUser(ctx, 'overview:read');
  if (!user) return;
  if (user.roleKey && user.dataScope !== 'organization') return fail(ctx.res, 403, 'محادثات المساعد متاحة على مستوى الإدارة فقط');
  const sessions = q(ctx.db, `SELECT s.id, s.sid, s.consent, s.created_at, s.last_at,
      (SELECT COUNT(*) FROM assistant_messages m WHERE m.session_id = s.id) messages
      FROM assistant_sessions s ORDER BY s.last_at DESC LIMIT 50`);
  return ok(ctx.res, { sessions });
}
