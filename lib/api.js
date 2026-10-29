import { exec, one, q } from './db.js';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { can, createSession, destroySession, hashPassword, loginBlocked, loginFailed, loginSucceeded, verifyPassword } from './auth.js';
import { HttpError, json, readJson, clientIp, cookie } from './http.js';
import { createRequest, transitionError, addEvent, audit, publicStatus, stats, STATUSES, REQUEST_TYPES, programBySlug, recommend, hydrateProgram, cleanPhone, searchPrograms, DEAL_STAGES, syncDealStage, markFirstResponse, dealStageFor, durationLabel } from './domain.js';
import { answer, ensureSession, logMessage } from './assistant.js';
import { isoNow, slugify, randomToken } from './util.js';
import { notifyBooking } from './webhooks.js';
import { enqueueWhatsAppNotice } from './whatsapp.js';

const ok = (res, data = {}, status = 200) => json(res, status, { ok: true, ...data });
const fail = (res, status, message, errors = null) => json(res, status, { ok: false, message, errors });
const HERE_PUBLIC = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'public');

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
  const user = one(db, 'SELECT * FROM users WHERE username = ? AND active = 1', [username]);
  if (!user || !verifyPassword(password, user.password_hash, user.password_salt)) {
    loginFailed(key);
    return fail(res, 401, 'اسم المستخدم أو كلمة المرور غير صحيحة');
  }
  loginSucceeded(key);
  const session = createSession(db, user.id, ip, req.headers['user-agent']);
  exec(db, 'UPDATE users SET last_login_at = ? WHERE id = ?', [isoNow(), user.id]);
  audit(db, { user: { id: user.id, name: user.name }, action: 'login', entity: 'user', entityId: user.id, ip });
  json(res, 200, {
    ok: true,
    user: { id: user.id, username: user.username, name: user.name, role: user.role, department: user.department, mustChange: !!user.must_change },
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
  const u = one(ctx.db, 'SELECT id, username, name, role, department, must_change FROM users WHERE id = ?', [ctx.user.id]);
  return ok(ctx.res, { user: { ...u, mustChange: !!u.must_change } });
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
  if (action && !can(ctx.user, action)) {
    fail(ctx.res, 403, 'لا تملك صلاحية لهذا الإجراء');
    return null;
  }
  return ctx.user;
}

/* ---------------- public ---------------- */

export async function createRequestApi(ctx) {
  const { req, res, db } = ctx;
  const body = await readJson(req, 32 * 1024);
  const type = String(body.type || '');
  if (!REQUEST_TYPES[type]) return fail(res, 400, 'نوع الطلب غير معروف');
  const result = createRequest(db, type, body, { ip: clientIp(req), userAgent: req.headers['user-agent'], source: body.source || 'website', clientId: ctx.clientUser?.id });
  if (!result.ok) return fail(res, 422, 'تحقق من الحقول المطلوبة', result.errors);

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
  const s = stats(ctx.db);
  const recent = q(ctx.db, `SELECT r.id, r.reference, r.type, r.status, r.title, r.summary, r.created_at, c.name AS customer
      FROM requests r LEFT JOIN customers c ON c.id = r.customer_id ORDER BY r.id DESC LIMIT 8`);
  const needsAction = q(ctx.db, `SELECT r.id, r.reference, r.type, r.status, r.summary, r.updated_at
      FROM requests r WHERE r.status IN ('new','reviewing','awaiting','in_progress') ORDER BY r.updated_at ASC LIMIT 8`);
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
  const params = [from, to];
  let empClause = '';
  if (employee === 'unassigned') empClause = ' AND r.assigned_to IS NULL';
  else if (employee) { empClause = ' AND r.assigned_to = ?'; params.push(Number(employee)); }
  const base = `FROM requests r WHERE substr(r.created_at,1,10) BETWEEN ? AND ?${empClause}`;

  const summaryRow = one(ctx.db, `SELECT COUNT(*) AS total,
      COALESCE(SUM(r.deal_status = 'won'), 0) AS won,
      COALESCE(SUM(r.deal_status = 'lost'), 0) AS lost,
      COALESCE(SUM(r.deal_status IN ('new','in_progress')), 0) AS open,
      COALESCE(SUM(CASE WHEN r.deal_status = 'won' THEN COALESCE(r.quote_amount, 0) ELSE 0 END), 0) AS revenue,
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
      FROM requests r LEFT JOIN users u ON u.id = r.assigned_to
      WHERE substr(r.created_at,1,10) BETWEEN ? AND ?${empClause}
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
    funnel,
    series: points,
    agents: q(ctx.db, 'SELECT id, name FROM users WHERE active = 1 ORDER BY name'),
    dealStages: DEAL_STAGES,
    generatedAt: isoNow(),
  });
}

export function reportsCsv(ctx) {
  const user = requireUser(ctx, 'reports:read');
  if (!user) return;
  const { period, from, to } = reportRange(ctx.query);
  const rows = q(ctx.db, `SELECT COALESCE(u.name, 'غير مسند') AS name,
      COUNT(*) AS total,
      COALESCE(SUM(r.deal_status = 'won'), 0) AS won,
      COALESCE(SUM(r.deal_status = 'lost'), 0) AS lost,
      COALESCE(SUM(CASE WHEN r.deal_status = 'won' THEN COALESCE(r.quote_amount,0) ELSE 0 END), 0) AS revenue,
      AVG(CASE WHEN r.completed_at IS NOT NULL THEN (julianday(r.completed_at) - julianday(r.created_at)) * 1440 END) AS avg_completion
      FROM requests r LEFT JOIN users u ON u.id = r.assigned_to
      WHERE substr(r.created_at,1,10) BETWEEN ? AND ?
      GROUP BY r.assigned_to ORDER BY won DESC`, [from, to]);
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
  const where = [];
  const params = [];
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
      CASE WHEN r.completed_at IS NOT NULL THEN ROUND((julianday(r.completed_at) - julianday(r.created_at)) * 1440) END AS completion_minutes,
      CASE WHEN r.first_response_at IS NOT NULL THEN ROUND((julianday(r.first_response_at) - julianday(r.created_at)) * 1440) END AS response_minutes,
      r.quote_amount AS value_amount,
      c.name AS customer, c.phone, u.name AS agent
      FROM requests r LEFT JOIN customers c ON c.id = r.customer_id LEFT JOIN users u ON u.id = r.assigned_to
      ${clause} ORDER BY r.id DESC LIMIT ? OFFSET ?`, [...params, limit, offset]);
  const total = one(ctx.db, `SELECT COUNT(*) n FROM requests r LEFT JOIN customers c ON c.id = r.customer_id ${clause}`, params).n;
  return ok(ctx.res, { requests: rows, total, page: Number(page) || 1, pages: Math.max(1, Math.ceil(total / limit)), statuses: STATUSES, types: REQUEST_TYPES, dealStages: DEAL_STAGES });
}

export function getRequest(ctx) {
  const user = requireUser(ctx, 'requests:read');
  if (!user) return;
  const row = one(ctx.db, `SELECT r.*, c.name AS customer_name, c.phone, c.email, u.name AS agent_name
      FROM requests r LEFT JOIN customers c ON c.id = r.customer_id LEFT JOIN users u ON u.id = r.assigned_to WHERE r.id = ?`, [Number(ctx.params.id)]);
  if (!row) return fail(ctx.res, 404, 'الطلب غير موجود');
  let payload = {};
  try { payload = JSON.parse(row.payload); } catch { payload = {}; }
  const events = q(ctx.db, 'SELECT * FROM request_events WHERE request_id = ? ORDER BY id', [row.id]);
  const agents = q(ctx.db, "SELECT id, name, department FROM users WHERE active = 1 ORDER BY name");
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
  const row = one(ctx.db, 'SELECT * FROM requests WHERE id = ?', [id]);
  if (!row) return fail(ctx.res, 404, 'الطلب غير موجود');
  const body = await readJson(ctx.req);
  const changes = [];
  const now = isoNow();

  if (body.status !== undefined && body.status !== row.status) {
    const error = transitionError(row.status, String(body.status));
    if (error) return fail(ctx.res, 422, error);
    exec(ctx.db, 'UPDATE requests SET status = ?, updated_at = ? WHERE id = ?', [String(body.status), now, id]);
    const stage = syncDealStage(ctx.db, id, String(body.status));
    addEvent(ctx.db, id, {
      kind: 'status', actorId: user.id, actorName: user.name,
      message: `تغيير الحالة: ${STATUSES[row.status]?.label} ← ${STATUSES[String(body.status)]?.label}`,
      meta: { from: row.status, to: body.status, dealStatus: stage },
    });
    enqueueWhatsAppNotice(ctx.db, id, 'status', ctx.baseUrl, String(body.status));
    changes.push('status');
  }

  if (body.assignedTo !== undefined) {
    const assigned = body.assignedTo === null || body.assignedTo === '' ? null : Number(body.assignedTo);
    if (assigned !== null) {
      const agent = one(ctx.db, 'SELECT id, name FROM users WHERE id = ? AND active = 1', [assigned]);
      if (!agent) return fail(ctx.res, 422, 'الموظف غير موجود');
      exec(ctx.db, 'UPDATE requests SET assigned_to = ?, updated_at = ? WHERE id = ?', [assigned, now, id]);
      addEvent(ctx.db, id, { kind: 'assigned', actorId: user.id, actorName: user.name, message: `أُسند الطلب إلى ${agent.name}` });
    } else {
      exec(ctx.db, 'UPDATE requests SET assigned_to = NULL, updated_at = ? WHERE id = ?', [now, id]);
      addEvent(ctx.db, id, { kind: 'assigned', actorId: user.id, actorName: user.name, message: 'أُلغي الإسناد' });
    }
    changes.push('assigned');
  }

  if (body.quoteAmount !== undefined) {
    const amount = body.quoteAmount === null || body.quoteAmount === '' ? null : Number(body.quoteAmount);
    if (amount !== null && (!Number.isFinite(amount) || amount < 0 || amount > 1e7)) return fail(ctx.res, 422, 'قيمة العرض غير صحيحة');
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

/* ---------------- admin: customers ---------------- */

export function listCustomers(ctx) {
  const user = requireUser(ctx, 'customers:read');
  if (!user) return;
  const search = String(ctx.query.q || '').trim();
  const rows = search
    ? q(ctx.db, `SELECT c.*, (SELECT COUNT(*) FROM requests r WHERE r.customer_id = c.id) n,
        (SELECT MAX(created_at) FROM requests r WHERE r.customer_id = c.id) last_request
        FROM customers c WHERE c.name LIKE ? OR c.phone LIKE ? OR c.email LIKE ? ORDER BY c.updated_at DESC LIMIT 100`,
      [`%${search}%`, `%${search}%`, `%${search}%`])
    : q(ctx.db, `SELECT c.*, (SELECT COUNT(*) FROM requests r WHERE r.customer_id = c.id) n,
        (SELECT MAX(created_at) FROM requests r WHERE r.customer_id = c.id) last_request
        FROM customers c ORDER BY c.updated_at DESC LIMIT 100`);
  return ok(ctx.res, { customers: rows });
}

export function getCustomer(ctx) {
  const user = requireUser(ctx, 'customers:read');
  if (!user) return;
  const id = Number(ctx.params.id);
  const customer = one(ctx.db, 'SELECT * FROM customers WHERE id = ?', [id]);
  if (!customer) return fail(ctx.res, 404, 'العميل غير موجود');
  const requests = q(ctx.db, 'SELECT id, reference, type, status, summary, created_at FROM requests WHERE customer_id = ? ORDER BY id DESC', [id]);
  return ok(ctx.res, { customer, requests });
}

export async function updateCustomer(ctx) {
  const user = requireUser(ctx, 'customers:write');
  if (!user) return;
  const id = Number(ctx.params.id);
  const customer = one(ctx.db, 'SELECT * FROM customers WHERE id = ?', [id]);
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

export function listUsers(ctx) {
  const user = requireUser(ctx, 'users:write');
  if (!user) return;
  return ok(ctx.res, { users: q(ctx.db, 'SELECT id, username, name, role, department, phone, active, must_change, last_login_at, created_at FROM users ORDER BY id') });
}

export async function createUser(ctx) {
  const user = requireUser(ctx, 'users:write');
  if (!user) return;
  const body = await readJson(ctx.req);
  const username = String(body.username || '').trim().toLowerCase();
  const name = String(body.name || '').trim();
  const role = String(body.role || 'agent');
  const password = String(body.password || '');
  if (!/^[a-z0-9._-]{3,32}$/.test(username)) return fail(ctx.res, 422, 'اسم المستخدم يجب أن يكون 3-32 حرفًا لاتينيًا');
  if (name.length < 2) return fail(ctx.res, 422, 'الاسم مطلوب');
  if (!['admin', 'manager', 'agent'].includes(role)) return fail(ctx.res, 422, 'الدور غير صحيح');
  if (password.length < 10 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) return fail(ctx.res, 422, 'كلمة المرور 10 أحرف على الأقل وتحتوي حرفًا ورقمًا');
  if (one(ctx.db, 'SELECT id FROM users WHERE username = ?', [username])) return fail(ctx.res, 409, 'اسم المستخدم مستخدم');
  const { hash, salt } = hashPassword(password);
  const res = exec(ctx.db, 'INSERT INTO users (username, name, role, department, phone, password_hash, password_salt, must_change, active, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
    [username, name, role, String(body.department || '').slice(0, 60), String(body.phone || '').slice(0, 20), hash, salt, 1, 1, isoNow()]);
  audit(ctx.db, { user, action: 'create-user', entity: 'user', entityId: res.lastInsertRowid, meta: { username, role }, ip: clientIp(ctx.req) });
  return ok(ctx.res, { id: Number(res.lastInsertRowid) }, 201);
}

export async function updateUser(ctx) {
  const user = requireUser(ctx, 'users:write');
  if (!user) return;
  const id = Number(ctx.params.id);
  const target = one(ctx.db, 'SELECT * FROM users WHERE id = ?', [id]);
  if (!target) return fail(ctx.res, 404, 'المستخدم غير موجود');
  const body = await readJson(ctx.req);
  if (body.role && !['admin', 'manager', 'agent'].includes(body.role)) return fail(ctx.res, 422, 'الدور غير صحيح');
  if (target.id === user.id && body.active === false) return fail(ctx.res, 422, 'لا يمكنك تعطيل حسابك الحالي');
  const updates = [];
  const params = [];
  if (body.role) { updates.push('role = ?'); params.push(body.role); }
  if (body.department !== undefined) { updates.push('department = ?'); params.push(String(body.department).slice(0, 60)); }
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
  audit(ctx.db, { user, action: 'update-user', entity: 'user', entityId: id, meta: { role: body.role, active: body.active, passwordChanged: !!body.password }, ip: clientIp(ctx.req) });
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
  const sessions = q(ctx.db, `SELECT s.id, s.sid, s.consent, s.created_at, s.last_at,
      (SELECT COUNT(*) FROM assistant_messages m WHERE m.session_id = s.id) messages
      FROM assistant_sessions s ORDER BY s.last_at DESC LIMIT 50`);
  return ok(ctx.res, { sessions });
}
