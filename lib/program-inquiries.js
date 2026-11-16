import { exec, one, q, transaction } from './db.js';
import { audit, hydrateProgram } from './domain.js';
import { HttpError, json, readJson } from './http.js';
import { isoNow } from './util.js';

const TYPES = {
  alternative_hotel: 'طلب فندق بديل', availability: 'التواريخ وتوافر الغرف', group_quote: 'عرض سعر لعائلة أو مجموعة',
};
const STATUS = ['جديد', 'تم التواصل', 'تم الحجز', 'ملغي'];
const BRANCHES = { amman: 'عمّان', irbid: 'إربد' };

function validateText(value, limit, min = 0) {
  if (typeof value !== 'string' || value.length > limit || value.trim().length < min) {
    throw new HttpError(422, 'تحقق من الاسم وطول الملاحظات.');
  }
  return value.trim();
}

function normalizePhone(raw) {
  const digits = validateText(raw, 40, 1)
    .replace(/[٠-٩۰-۹]/g, ch => String(ch.charCodeAt(0) & 15))
    .replace(/[\s().-]/g, '');
  let international = digits.replace(/^00/, '+');
  if (/^07\d{8}$|^0[2356]\d{7}$/.test(international)) international = '+962' + international.slice(1);
  else if (/^962\d+$/.test(international)) international = '+' + international;
  const jordan = /^\+962(?:7\d{8}|[2356]\d{7})$/;
  if (!/^\+[1-9]\d{6,14}$/.test(international) || (international.startsWith('+962') && !jordan.test(international))) {
    throw new HttpError(422, 'أدخل رقمًا أردنيًا صالحًا أو رقمًا دوليًا يبدأ برمز الدولة، مثل +962.');
  }
  return international;
}

function publishedProgram(db, key, bySlug = false) {
  const row = one(db, `SELECT * FROM programs WHERE ${bySlug ? 'slug' : 'id'}=? AND status IN ('published','sold_out')`, [key]);
  if (!row) throw new HttpError(404, 'هذا البرنامج غير متاح للاستفسار.');
  return hydrateProgram(row);
}

function context(program) {
  return {
    id: program.id, slug: program.slug, category: program.category, title: program.title,
    current_hotel: (program.hotels || []).map(hotel => hotel?.name).filter(Boolean).join('، '),
    days: program.days, nights: program.nights, price: program.price_from, currency: program.currency,
    tiers: (program.options || []).filter(option => Number(option?.price) > 0).map(({label, price, currency}) => ({ label, price, currency: currency || program.currency })),
    itinerary: program.itinerary || [],
  };
}

function branchContact(settings, branch) {
  const fallback = branch === 'amman' ? '962791192888' : '962791193888';
  const pattern = branch === 'amman' ? /عمّ?ان/ : /[اإ]ربد/;
  const configured = settings?.contactGroups?.find(group => pattern.test(group.g))?.items?.[0]?.p;
  const number = String(configured ?? '').replace(/\D/g, '');
  return /^9627\d{8}$/.test(number) ? number : fallback;
}

function whatsappUrl(settings, inquiry) {
  const branch = inquiry.preferred_branch || 'irbid';
  const text = [
    'مرحبًا لوريت، أود الاستفسار عن البرنامج التالي.',
    'رقم الاستفسار: ' + inquiry.id,
    'البرنامج: ' + inquiry.program_title,
    'الفندق الحالي: ' + (inquiry.current_hotel || 'غير محدد'),
    'نوع الاستفسار: ' + TYPES[inquiry.inquiry_type],
    'الفندق المطلوب / التفاصيل: ' + (inquiry.requested_hotel_notes || 'أحددها مع الموظف'),
    'الاسم: ' + inquiry.customer_name,
  ].join('\n');
  return 'https://wa.me/' + branchContact(settings, branch) + '?text=' + encodeURIComponent(text);
}

async function notifyInquiry(configured, inquiry) {
  const endpoint = new URL(configured);
  if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password) throw new Error('Invalid inquiry webhook URL');
  const response = await fetch(endpoint, {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(5000),
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ event: 'program_inquiry.created', inquiry }),
  });
  await response.body?.cancel();
  if (!response.ok) throw new Error('Inquiry webhook failed');
}

function staffScope(ctx) {
  if (ctx.user.dataScope === 'organization') return { sql: '1=1', params: [] };
  if (ctx.user.dataScope === 'branch' && ctx.user.branchId) {
    const branch = one(ctx.db, 'SELECT code FROM branches WHERE id=?', [ctx.user.branchId]);
    if (branch && Object.hasOwn(BRANCHES, branch.code)) return { sql: 'preferred_branch=?', params: [branch.code] };
  }
  // Public inquiries have no department or assignee yet.
  return { sql: '1=0', params: [] };
}

function saveBrochureInquiry(ctx, body) {
  if (!Number.isSafeInteger(body.brochure_id) || body.brochure_id < 1) throw new HttpError(422, 'اختر كتيبًا صالحًا.');
  const brochure = one(ctx.db, 'SELECT id,title FROM tour_brochures WHERE id=? AND is_active=1', [body.brochure_id]);
  if (!brochure) throw new HttpError(404, 'الكتيب غير متاح.');
  if (typeof body.message !== 'string' || body.message.length > 1000 || body.message.trim().length < 2) {
    throw new HttpError(422, 'اكتب سؤالًا من حرفين إلى 1000 حرف.');
  }
  const message = body.message.trim();
  const hasPhone = body.phone != null && (typeof body.phone !== 'string' || body.phone.trim());
  const phone = hasPhone ? normalizePhone(body.phone) : '';
  const saved = exec(ctx.db, `INSERT INTO program_inquiries
    (brochure_id,brochure_title,program_title,current_hotel,inquiry_type,requested_hotel_notes,customer_name,customer_phone,created_at)
    VALUES(?,?,?,'','availability',?, '',?,?)`, [brochure.id, brochure.title, brochure.title, message, phone, isoNow()]);
  return json(ctx.res, 201, { ok: true, id: Number(saved.lastInsertRowid) });
}

export function mountProgramInquiries(router, api) {
  router.get('/api/inquiries/program', ctx => {
    const slug = validateText(ctx.query.slug, 200, 1);
    return json(ctx.res, 200, { ok: true, program: context(publishedProgram(ctx.db, slug, true)) });
  });

  router.post('/api/inquiries', api(async ctx => {
    const body = await readJson(ctx.req, 8 * 1024);
    if (body && Object.hasOwn(body, 'brochure_id')) return saveBrochureInquiry(ctx, body);
    if (!body || typeof body !== 'object' || Array.isArray(body)
        || !Number.isSafeInteger(body.program_id) || body.program_id < 1
        || typeof body.inquiry_type !== 'string' || !Object.hasOwn(TYPES, body.inquiry_type)) {
      throw new HttpError(422, 'اختر برنامجًا ونوع استفسار صالحَين.');
    }
    const branch = body.preferred_branch === '' || body.preferred_branch == null ? null : body.preferred_branch;
    if (branch !== null && (typeof branch !== 'string' || !Object.hasOwn(BRANCHES, branch))) throw new HttpError(422, 'اختر فرعًا صالحًا.');
    const program = context(publishedProgram(ctx.db, body.program_id));
    const inquiry = {
      program_id: program.id, program_title: program.title, current_hotel: program.current_hotel,
      inquiry_type: body.inquiry_type, requested_hotel_notes: validateText(body.requested_hotel_notes ?? '', 1000),
      customer_name: validateText(body.customer_name, 100, 2), customer_phone: normalizePhone(body.customer_phone),
      preferred_branch: branch, status: STATUS[0], created_at: isoNow(),
    };
    const result = exec(ctx.db, `INSERT INTO program_inquiries(program_id,program_title,current_hotel,inquiry_type,
      requested_hotel_notes,customer_name,customer_phone,preferred_branch,status,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)`, Object.values(inquiry));
    inquiry.id = Number(result.lastInsertRowid);
    const webhook = process.env.N8N_INQUIRY_WEBHOOK_URL?.trim();
    if (webhook) void notifyInquiry(webhook, inquiry).catch(() => console.warn('Program inquiry webhook delivery failed'));
    return json(ctx.res, 201, { ok: true, id: inquiry.id, whatsapp_url: whatsappUrl(ctx.settings, inquiry) });
  }, { limit: '/api/inquiries' }));

  router.get('/api/admin/inquiries', api(ctx => {
    const scope = staffScope(ctx);
    const count = one(ctx.db, "SELECT COUNT(*) AS n FROM program_inquiries WHERE status='جديد' AND " + scope.sql, scope.params).n;
    if (ctx.query.count === '1') return json(ctx.res, 200, { ok: true, new_count: count });
    const page = Number(ctx.query.page || 1);
    if (!Number.isSafeInteger(page) || page < 1 || page > 100000) throw new HttpError(422, 'رقم الصفحة غير صالح.');
    const rows = q(ctx.db, `SELECT * FROM program_inquiries WHERE ${scope.sql} ORDER BY id DESC LIMIT 26 OFFSET ?`, [...scope.params, (page - 1) * 25]);
    return json(ctx.res, 200, { ok: true, inquiries: rows.slice(0, 25), page, has_more: rows.length > 25,
      new_count: count, types: TYPES, statuses: STATUS, branches: BRANCHES });
  }, { action: 'requests:read' }));

  router.patch('/api/admin/inquiries/:id', api(async ctx => {
    const { status } = (await readJson(ctx.req, 2048)) || {};
    const id = Number(ctx.params.id);
    if (!STATUS.includes(status) || !Number.isSafeInteger(id) || id < 1) throw new HttpError(422, 'الاستفسار أو الحالة غير صالح.');
    const scope = staffScope(ctx);
    transaction(ctx.db, () => {
      const result = exec(ctx.db, `UPDATE program_inquiries SET status=? WHERE id=? AND ${scope.sql}`, [status, id, ...scope.params]);
      if (!result.changes) throw new HttpError(404, 'الاستفسار غير موجود.');
      audit(ctx.db, { user: ctx.user, action: 'update-program-inquiry-status', entity: 'program_inquiries', entityId: id, meta: { status }, ip: ctx.ip });
    });
    return json(ctx.res, 200, { ok: true, status });
  }, { action: 'requests:write' }));
}
