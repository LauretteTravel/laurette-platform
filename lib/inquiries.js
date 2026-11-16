/* صندوق «طلب فندق بديل أو الاستفسار عن العرض» — منطق المجال كاملاً في مكان واحد:
   الأنواع والحالات، تطبيع الهاتف، توليد المرجع، نص واتساب الجاهز، نداء n8n الاختياري،
   وقراءة/كتابة جدول program_inquiries. الواجهة (lib/views/inquiry-box.js) لا تعرف أي
   من هذه القواعد، والـAPI في lib/api.js يبقى طبقة رقيقة فوق هذه الدوال. */

import { exec, one, q } from './db.js';
import { isoNow, stripTags } from './util.js';

/* مفاتيح إنجليزية ثابتة في القاعدة + تسميات عربية للواجهة — نفس عُرف requests/statuses
   في lib/domain.js كي تبقى الفهارس والترجمة والتقارير موحّدة. */
export const INQUIRY_TYPES = {
  alternative_hotel: { label: 'أريد نفس البرنامج بفندق آخر', icon: '🏨' },
  availability: { label: 'الاستفسار عن تواريخ أو توافر غرف', icon: '📅' },
  group_quote: { label: 'طلب عرض سعر خاص لعائلة / مجموعة', icon: '👨‍👩‍👧‍👦' },
};

export const INQUIRY_STATUSES = {
  new: { label: 'جديد', tone: 'blue' },
  contacted: { label: 'تم التواصل', tone: 'amber' },
  booked: { label: 'تم الحجز', tone: 'green' },
  cancelled: { label: 'ملغي', tone: 'red' },
};

/* الفرع قيمة اختيارية: من لا يحدد فرعاً يصل للرقم العام. */
export const INQUIRY_BRANCHES = { amman: 'فرع عمّان', irbid: 'فرع إربد' };

const PHONE_RE = /^\+?[0-9]{8,15}$/;

/* مرجع مقروء للعميل وللموظف: LT-HI-XXXXXX (HI = hotel inquiry).
   منفصل عن reference() في util.js كي لا يتغير نمط مراجع الطلبات المعتمد في /track. */
export function inquiryReference() {
  const buf = new Uint8Array(4);
  crypto.getRandomValues(buf);
  const body = [...buf].map((b) => b.toString(36).toUpperCase().padStart(2, '0')).join('').slice(0, 6);
  return `LT-HI-${body}`;
}

/* تطبيع الهاتف: يقبل 0791234567 أو +962791234567 أو 00962… ويخرجه بصيغة دولية موحّدة.
   الرقم المحلي يبدأ بصفر ويُسبق بـ962 (أردني) فقط إذا كان طوله 9 أو 10 أرقام — وهو ما
   يمنع قبول أرقام مبتورة مثل 07912345. */
export function normalizeInquiryPhone(raw) {
  let value = String(raw ?? '').trim().replace(/[\s\-().]/g, '');
  if (value.startsWith('00')) value = `+${value.slice(2)}`;
  if (!PHONE_RE.test(value)) {
    return { error: 'رقم هاتف غير صالح (مثال: 0791234567 أو +962791234567)' };
  }
  let digits = value.replace(/\D/g, '');
  if (!value.startsWith('+') && digits.startsWith('0')) {
    if (digits.length !== 9 && digits.length !== 10) {
      return { error: 'رقم أردني غير مكتمل: أدخله مثل 0791234567 أو 0771234567' };
    }
    digits = `962${digits.slice(1)}`;
  }
  if (digits.length < 10 || digits.length > 15) {
    return { error: 'رقم هاتف غير صالح: تحقق من رمز الدولة وعدد الأرقام' };
  }
  return { value: `+${digits}`, digits };
}

/* رقم واتساب الفرع: أول رقم في مجموعة الفرع من إعدادات الموقع، ثم الرقم العام. */
export function branchWhatsAppNumber(settings, branch) {
  const groups = Array.isArray(settings?.contactGroups) ? settings.contactGroups : [];
  const needle = branch === 'amman' ? 'عمّان' : branch === 'irbid' ? 'إربد' : '';
  const group = needle ? groups.find((g) => String(g?.g || '').includes(needle)) : null;
  const first = (group?.items || []).find((item) => String(item?.p || '').replace(/\D/g, '').length >= 8);
  const raw = first?.p || settings?.whatsapp || '';
  return String(raw).replace(/\D/g, '');
}

/* نص الرسالة: مصدر واحد للحقيقة، يستخدمه زر «إرسال التفاصيل عبر واتساب» بعد الإرسال. */
export function buildInquiryWhatsAppText(inquiry) {
  const lines = [
    '🏨 استفسار جديد من موقع لوريت',
    `البرنامج: ${inquiry.programTitle}`,
    inquiry.currentHotel ? `الفندق الحالي: ${inquiry.currentHotel}` : '',
    inquiry.duration ? `المدة: ${inquiry.duration}` : '',
    inquiry.priceLabel ? `السعر المنشور: ${inquiry.priceLabel}` : '',
    `نوع الاستفسار: ${INQUIRY_TYPES[inquiry.inquiryType]?.label || inquiry.inquiryType}`,
    inquiry.notes ? `الفندق المطلوب / الملاحظات: ${inquiry.notes}` : '',
    `الاسم: ${inquiry.customerName}`,
    `الهاتف: ${inquiry.customerPhone}`,
    inquiry.branchLabel ? `الفرع الأقرب: ${inquiry.branchLabel}` : '',
    `المرجع: ${inquiry.reference}`,
  ];
  return lines.filter(Boolean).join('\n');
}

export function buildInquiryWhatsAppUrl(settings, branch, text) {
  const digits = branchWhatsAppNumber(settings, branch);
  if (!digits || !text) return null;
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}

/* نداء n8n اختياري: لا يعطّل الاستجابة أبداً، ولا يرفع خطأً على الواجهة.
   المهلة 5 ثوانٍ والمؤقت unref كي لا يمنع إغلاق العملية في الاختبارات. */
export function dispatchInquiryWebhook(payload) {
  const url = String(process.env.N8N_INQUIRY_WEBHOOK_URL || '').trim();
  if (!url || !/^https?:\/\//i.test(url)) return false;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  timer.unref?.();
  fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'user-agent': 'laurette-inquiry/1.0' },
    body: JSON.stringify(payload),
    signal: controller.signal,
    redirect: 'error',
  })
    .then((res) => {
      if (!res.ok) console.warn(`[inquiry] n8n webhook answered ${res.status}`);
    })
    .catch((err) => console.warn(`[inquiry] n8n webhook failed: ${err.message}`))
    .finally(() => clearTimeout(timer));
  return true;
}

/* ---------- قراءة سياق البرنامج ---------- */

function parseHotels(raw) {
  try {
    const parsed = JSON.parse(raw || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function durationLabel(days, nights) {
  if (!days) return '';
  return nights ? `${days} أيام / ${nights} ليالٍ` : `${days} أيام`;
}

function priceLabel(price, currency) {
  const amount = Number(price);
  if (!Number.isFinite(amount) || amount <= 0) return '';
  return `${amount.toLocaleString('en-US')} ${currency || 'د.أ'}`;
}

/* سياق البرنامج من القاعدة إن وُجد، وإلا من عنوان العرض (بوسترات /offers لا صف برنامج لها).
   القيم القادمة من المتصفح تُقصّ وتُنقّى ولا تُستخدم إلا للعرض في لوحة الإدارة. */
function resolveProgramContext(db, body) {
  const slug = String(body.slug || '').trim().slice(0, 120);
  const id = Number(body.programId);
  let row = null;
  if (slug) {
    row = one(db, "SELECT * FROM programs WHERE slug = ? AND status IN ('published','sold_out')", [slug]);
  }
  if (!row && Number.isInteger(id) && id > 0) {
    row = one(db, "SELECT * FROM programs WHERE id = ? AND status IN ('published','sold_out')", [id]);
  }
  if (row) {
    const hotels = parseHotels(row.hotels);
    return {
      programId: row.id,
      programSlug: row.slug,
      programTitle: row.title,
      currentHotel: String(hotels[0]?.name || '').trim() || null,
      category: row.category || null,
      duration: durationLabel(row.days, row.nights),
      priceLabel: priceLabel(row.price_from, row.currency),
    };
  }
  const fallbackTitle = stripTags(body.title || '').slice(0, 120);
  if (!fallbackTitle) return null;
  const category = /^[a-z_]{2,24}$/.test(String(body.category || '')) ? String(body.category) : null;
  return {
    programId: null,
    programSlug: slug || null,
    programTitle: fallbackTitle,
    currentHotel: stripTags(body.currentHotel || '').slice(0, 120) || null,
    category,
    duration: stripTags(body.duration || '').slice(0, 60),
    priceLabel: stripTags(body.priceLabel || '').slice(0, 40),
  };
}

/* ---------- التحقق ---------- */

function text(value, min, max) {
  const clean = String(value ?? '').trim().replace(/\s+/g, ' ');
  if (clean.length < min) return { error: `الحقل مطلوب (${min} حرف على الأقل)` };
  if (clean.length > max) return { error: `الحد الأقصى ${max} حرفاً` };
  return { value: clean };
}

export function validateInquiry(body) {
  const errors = {};
  const out = {};

  const name = text(body.name, 2, 80);
  if (name.error) errors.name = name.error;
  else out.customerName = name.value;

  const phone = normalizeInquiryPhone(body.phone);
  if (phone.error) errors.phone = phone.error;
  else out.customerPhone = phone.value;

  const type = String(body.inquiryType || 'alternative_hotel');
  if (!INQUIRY_TYPES[type]) errors.inquiryType = 'نوع الاستفسار غير معروف';
  else out.inquiryType = type;

  const notes = String(body.notes ?? '').trim();
  if (notes.length > 600) errors.notes = 'الحد الأقصى 600 حرف';
  else out.notes = notes;

  const branch = String(body.branch || '').trim();
  if (branch && !INQUIRY_BRANCHES[branch]) errors.branch = 'الفرع المحدد غير معروف';
  else out.branch = branch || null;

  if (body.consent !== true) errors.consent = 'يلزم الموافقة على حفظ البيانات للتواصل معك';
  else out.consent = true;

  return { ok: Object.keys(errors).length === 0, errors, value: out };
}

/* ---------- الكتابة ---------- */

/* منع الإرسال المزدوج: نفس الهاتف + نفس البرنامج + نفس النوع خلال 10 دقائق يعيد السجل القائم. */
function findRecent(db, phone, slug, type, minutes = 10) {
  const since = new Date(Date.now() - minutes * 60000).toISOString();
  return one(db, `SELECT * FROM program_inquiries
      WHERE customer_phone = ? AND COALESCE(program_slug, '') = ? AND inquiry_type = ? AND created_at >= ?
      ORDER BY id DESC LIMIT 1`, [phone, slug || '', type, since]);
}

export function createInquiry(db, body) {
  const validation = validateInquiry(body);
  if (!validation.ok) return { ok: false, errors: validation.errors };
  const value = validation.value;

  const context = resolveProgramContext(db, body);
  if (!context) return { ok: false, errors: { programId: 'العرض المحدد غير متاح، اختر عرضاً آخر من الموقع' } };

  const existing = findRecent(db, value.customerPhone, context.programSlug, value.inquiryType);
  if (existing) return { ok: true, duplicate: true, inquiry: toInquiry(existing, context) };

  const now = isoNow();
  const reference = inquiryReference();
  const res = exec(db, `INSERT INTO program_inquiries
    (reference, program_id, program_slug, program_title, current_hotel, category, inquiry_type,
     requested_hotel_notes, customer_name, customer_phone, preferred_branch, status, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,'new',?,?)`,
  [reference, context.programId, context.programSlug, context.programTitle, context.currentHotel,
    context.category, value.inquiryType, value.notes || null, value.customerName, value.customerPhone,
    value.branch, now, now]);

  const row = one(db, 'SELECT * FROM program_inquiries WHERE id = ?', [Number(res.lastInsertRowid)]);
  return { ok: true, duplicate: false, inquiry: toInquiry(row, context) };
}

/* يحوّل صف القاعدة إلى كائن الواجهة: نفس الأسماء في الرد وفي نص واتساب. */
export function toInquiry(row, context = {}) {
  if (!row) return null;
  return {
    id: row.id,
    reference: row.reference,
    programId: row.program_id,
    programSlug: row.program_slug,
    programTitle: row.program_title,
    currentHotel: row.current_hotel || '',
    category: row.category || '',
    inquiryType: row.inquiry_type,
    inquiryTypeLabel: INQUIRY_TYPES[row.inquiry_type]?.label || row.inquiry_type,
    notes: row.requested_hotel_notes || '',
    customerName: row.customer_name,
    customerPhone: row.customer_phone,
    branch: row.preferred_branch || '',
    branchLabel: INQUIRY_BRANCHES[row.preferred_branch] || '',
    status: row.status,
    statusLabel: INQUIRY_STATUSES[row.status]?.label || row.status,
    duration: context.duration || '',
    priceLabel: context.priceLabel || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/* ---------- القراءة للإدارة ---------- */

export function inquiryCounts(db) {
  const rows = q(db, 'SELECT status, COUNT(*) AS total FROM program_inquiries GROUP BY status');
  const counts = { new: 0, contacted: 0, booked: 0, cancelled: 0, total: 0 };
  for (const row of rows) {
    if (row.status in counts) counts[row.status] = Number(row.total) || 0;
    counts.total += Number(row.total) || 0;
  }
  return counts;
}

export function listInquiries(db, { status = '', q: search = '', page = 1, limit = 25 } = {}) {
  const where = [];
  const params = [];
  if (status && INQUIRY_STATUSES[status]) {
    where.push('status = ?');
    params.push(status);
  }
  const needle = String(search || '').trim().slice(0, 60);
  if (needle) {
    where.push(`(customer_name LIKE ? OR customer_phone LIKE ? OR program_title LIKE ?
      OR requested_hotel_notes LIKE ? OR reference LIKE ?)`);
    const like = `%${needle}%`;
    params.push(like, like, like, like, like);
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = Number(one(db, `SELECT COUNT(*) AS c FROM program_inquiries ${clause}`, params)?.c) || 0;
  const size = Math.max(1, Math.min(Number(limit) || 25, 100));
  const pages = Math.max(1, Math.ceil(total / size));
  const current = Math.min(Math.max(1, Number(page) || 1), pages);
  const rows = q(db, `SELECT * FROM program_inquiries ${clause}
      ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`, [...params, size, (current - 1) * size]);
  return {
    inquiries: rows.map((row) => toInquiry(row)),
    total,
    page: current,
    pages,
    counts: inquiryCounts(db),
    statuses: INQUIRY_STATUSES,
    types: INQUIRY_TYPES,
  };
}

/* الانتقال بين الحالات حر: الموظف يعرف حالته، ولا داعي لآلة حالات صارمة هنا. */
export function updateInquiryStatus(db, id, status) {
  if (!INQUIRY_STATUSES[status]) return { error: 'حالة غير معروفة' };
  const row = one(db, 'SELECT id FROM program_inquiries WHERE id = ?', [id]);
  if (!row) return { error: 'الاستفسار غير موجود' };
  exec(db, 'UPDATE program_inquiries SET status = ?, updated_at = ? WHERE id = ?', [status, isoNow(), id]);
  return { inquiry: toInquiry(one(db, 'SELECT * FROM program_inquiries WHERE id = ?', [id])) };
}
