import { exec, one, q } from "./db.js";
import { daysBetween, isoNow, normalizeArabic, reference, today } from './util.js';

export const REQUEST_TYPES = {
  flight: { label: 'طلب تذكرة طيران', prefix: 'FL', department: 'قسم التذاكر' },
  hotel: { label: 'طلب حجز فندق', prefix: 'HT', department: 'الفنادق' },
  program: { label: 'طلب برنامج سياحي', prefix: 'PG', department: 'البرامج السياحية' },
  umrah: { label: 'طلب عمرة', prefix: 'UM', department: 'الحج والعمرة' },
  visa: { label: 'طلب مراجعة تأشيرة', prefix: 'VS', department: 'قسم التأشيرات' },
  consult: { label: 'استشارة خبير', prefix: 'CS', department: 'قسم التسويق والمبيعات' },
  cruise: { label: 'طلب رحلة كروز', prefix: 'CR', department: 'قسم رحلات الكروز' },
};

export const STATUSES = {
  new: { label: 'جديد', tone: 'blue', next: ['reviewing', 'quoted', 'awaiting', 'in_progress', 'confirmed', 'cancelled'] },
  reviewing: { label: 'قيد المراجعة', tone: 'amber', next: ['quoted', 'awaiting', 'in_progress', 'confirmed', 'cancelled'] },
  quoted: { label: 'تم إرسال العرض', tone: 'violet', next: ['reviewing', 'awaiting', 'in_progress', 'confirmed', 'cancelled'] },
  awaiting: { label: 'في انتظار إعادة الاتصال', tone: 'amber', next: ['reviewing', 'quoted', 'in_progress', 'confirmed', 'cancelled'] },
  in_progress: { label: 'قيد المتابعة', tone: 'blue', next: ['reviewing', 'quoted', 'awaiting', 'confirmed', 'cancelled'] },
  confirmed: { label: 'تم التأكيد', tone: 'green', next: ['reviewing', 'quoted', 'awaiting', 'in_progress', 'cancelled'] },
  cancelled: { label: 'ملغي', tone: 'red', next: [] },
};

export const DEAL_STAGES = {
  new: { label: 'جديد', tone: 'blue' },
  in_progress: { label: 'قيد المتابعة', tone: 'amber' },
  won: { label: 'مكتملة / ناجحة', tone: 'green' },
  lost: { label: 'ملغية', tone: 'red' },
};

export function dealStageFor(status) {
  if (status === 'confirmed') return 'won';
  if (status === 'cancelled') return 'lost';
  if (status === 'new') return 'new';
  return 'in_progress';
}

export function markFirstResponse(db, requestId) {
  exec(db, 'UPDATE requests SET first_response_at = COALESCE(first_response_at, ?) WHERE id = ?', [isoNow(), requestId]);
}

export function syncDealStage(db, requestId, status) {
  const stage = dealStageFor(status);
  const now = isoNow();
  const completedAt = stage === 'won' || stage === 'lost' ? now : null;
  exec(db, `UPDATE requests
      SET deal_status = ?, completed_at = ?, updated_at = ?, first_response_at = COALESCE(first_response_at, ?)
      WHERE id = ?`, [stage, completedAt, now, now, requestId]);
  return stage;
}

export function durationLabel(minutes) {
  if (minutes === null || minutes === undefined || !Number.isFinite(Number(minutes))) return '—';
  const m = Math.max(0, Math.round(Number(minutes)));
  if (m < 60) return `${m} دقيقة`;
  const hours = m / 60;
  if (hours < 24) return `${hours.toFixed(hours < 10 ? 1 : 0)} ساعة`;
  const days = hours / 24;
  return `${days.toFixed(days < 10 ? 1 : 0)} يوم`;
}

export const CHANNELS = { whatsapp: 'واتساب', phone: 'هاتف', email: 'بريد إلكتروني' };

const PHONE_RE = /^\+?[0-9]{8,15}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function cleanPhone(raw) {
  return String(raw || '').replace(/[\s\-()]/g, '').replace(/^00/, '+');
}

function str(value, min, max) {
  const s = String(value ?? '').trim().replace(/\s+/g, ' ');
  if (s.length < min) return { error: `الحقل مطلوب (${min} حرفًا على الأقل)` };
  if (s.length > max) return { error: `الحد الأقصى ${max} حرفًا` };
  return { value: s };
}

function int(value, min, max, label) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) return { error: `${label} يجب أن يكون بين ${min} و${max}` };
  return { value: n };
}

function date(value, { minToday = true, label = 'التاريخ' } = {}) {
  const s = String(value || '').trim();
  if (!DATE_RE.test(s) || Number.isNaN(new Date(`${s}T00:00:00Z`).getTime())) return { error: `${label} غير صالح` };
  if (minToday && daysBetween(today(), s) < 0) return { error: `${label} يجب أن يكون اليوم أو لاحقًا` };
  return { value: s };
}

export function validateRequest(type, body) {
  const errors = {};
  const out = {};
  const set = (key, result) => {
    if (result.error) errors[key] = result.error;
    else if (result.value !== undefined) out[key] = result.value;
  };

  set('name', str(body.name, 2, 80));
  const phone = cleanPhone(body.phone);
  if (!PHONE_RE.test(phone)) errors.phone = 'رقم هاتف غير صالح (مثال: 0791234567 أو +962791234567)';
  else out.phone = phone;

  if (body.email) {
    const email = String(body.email).trim();
    if (!EMAIL_RE.test(email)) errors.email = 'بريد إلكتروني غير صالح';
    else out.email = email;
  }
  if (body.notes !== undefined && body.notes !== '') {
    const notes = String(body.notes).trim();
    if (notes.length > 1000) errors.notes = 'الملاحظات طويلة جدًا (1000 حرف كحد أقصى)';
    else out.notes = notes;
  }
  out.consent = body.consent === true || body.consent === 'on' || body.consent === 1;
  out.whatsappUpdates = body.whatsappUpdates === true || body.whatsappUpdates === 'on' || body.whatsappUpdates === 1;

  if (type === 'flight') {
    const trip = String(body.tripType || '');
    if (!['oneway', 'return', 'multi'].includes(trip)) errors.tripType = 'اختر نوع الرحلة';
    else out.tripType = trip;

    if (trip === 'multi') {
      const segs = Array.isArray(body.segments) ? body.segments.slice(0, 4) : [];
      if (segs.length < 2) errors.segments = 'أضف مسارين على الأقل لرحلة متعددة الوجهات';
      else {
        const cleaned = [];
        segs.forEach((seg, i) => {
          const from = str(seg?.from, 2, 80);
          const to = str(seg?.to, 2, 80);
          const d = date(seg?.date, { label: `تاريخ المسار ${i + 1}` });
          if (from.error) errors[`segments.${i}.from`] = from.error;
          if (to.error) errors[`segments.${i}.to`] = to.error;
          if (d.error) errors[`segments.${i}.date`] = d.error;
          if (!from.error && !to.error && !d.error) cleaned.push({ from: from.value, to: to.value, date: d.value });
        });
        if (cleaned.length >= 2) out.segments = cleaned;
      }
    } else {
      set('origin', str(body.origin, 2, 80));
      set('destination', str(body.destination, 2, 80));
      const dep = date(body.departDate, { label: 'تاريخ السفر' });
      set('departDate', dep);
      if (trip === 'return') {
        const ret = date(body.returnDate, { label: 'تاريخ العودة' });
        if (ret.error) errors.returnDate = ret.error;
        else if (!dep.error && daysBetween(dep.value, ret.value) < 0) errors.returnDate = 'تاريخ العودة يجب أن يكون بعد تاريخ السفر';
        else out.returnDate = ret.value;
      }
    }

    const cabin = String(body.cabin || 'economy');
    if (!['economy', 'business', 'first'].includes(cabin)) errors.cabin = 'درجة السفر غير صحيحة';
    else out.cabin = cabin;

    set('adults', int(body.adults, 1, 9, 'عدد البالغين'));
    set('children', int(body.children ?? 0, 0, 8, 'عدد الأطفال'));
    set('infants', int(body.infants ?? 0, 0, 4, 'عدد الرضع'));
    const total = (out.adults || 0) + (out.children || 0) + (out.infants || 0);
    if (total > 9) errors.adults = 'الحد الأقصى 9 مسافرين في الطلب الواحد، تواصل معنا للمجموعات';

    if (body.airline) set('airline', str(body.airline, 2, 60));
    const baggage = String(body.baggage || 'standard');
    if (!['standard', 'extra', 'none'].includes(baggage)) errors.baggage = 'خيار الأمتعة غير صحيح';
    else out.baggage = baggage;
  }

  if (type === 'hotel') {
    set('country', str(body.country, 2, 60));
    set('city', str(body.city, 2, 60));
    if (body.hotelName) set('hotelName', str(body.hotelName, 2, 120));
    const checkIn = date(body.checkIn, { label: 'تاريخ الدخول' });
    set('checkIn', checkIn);
    const checkOut = date(body.checkOut, { label: 'تاريخ الخروج' });
    if (checkOut.error) errors.checkOut = checkOut.error;
    else if (!checkIn.error && daysBetween(checkIn.value, checkOut.value) < 1) errors.checkOut = 'تاريخ الخروج يجب أن يكون بعد تاريخ الدخول بيوم على الأقل';
    else out.checkOut = checkOut.value;

    set('rooms', int(body.rooms, 1, 10, 'عدد الغرف'));
    set('adults', int(body.adults, 1, 20, 'عدد البالغين'));
    set('children', int(body.children ?? 0, 0, 10, 'عدد الأطفال'));
    const ages = Array.isArray(body.childAges) ? body.childAges.slice(0, 10).map((a) => Number(a)) : [];
    if (ages.some((a) => !Number.isInteger(a) || a < 0 || a > 17)) errors.childAges = 'أعمار الأطفال يجب أن تكون بين 0 و17';
    else if ((out.children || 0) > 0 && ages.length !== out.children) errors.childAges = 'أدخل عمر كل طفل';
    else out.childAges = ages;

    const stars = String(body.stars || 'any');
    if (!['3', '4', '5', 'any'].includes(stars)) errors.stars = 'تصنيف الفندق غير صحيح';
    else out.stars = stars;

    const meal = String(body.mealPlan || 'any');
    if (!['any', 'breakfast', 'half', 'full', 'none'].includes(meal)) errors.mealPlan = 'نوع الوجبات غير صحيح';
    else out.mealPlan = meal;

    if (body.budget) set('budget', str(body.budget, 1, 40));
    if (body.specialRequests) set('specialRequests', str(body.specialRequests, 1, 600));
  }

  if (type === 'program' || type === 'umrah') {
    set('programSlug', str(body.programSlug, 2, 120));
    if (body.optionLabel) set('optionLabel', str(body.optionLabel, 1, 160));
    set('adults', int(body.adults, 1, 30, 'عدد البالغين'));
    set('children', int(body.children ?? 0, 0, 20, 'عدد الأطفال'));
    set('infants', int(body.infants ?? 0, 0, 10, 'عدد الرضع'));
    if (body.preferredDate) {
      const d = date(body.preferredDate, { minToday: false, label: 'تاريخ السفر المفضل' });
      if (d.error) errors.preferredDate = d.error; else out.preferredDate = d.value;
    }
    if (body.roomType) {
      const room = String(body.roomType);
      if (!['single', 'double', 'triple', 'quad', 'custom'].includes(room)) errors.roomType = 'نوع الغرفة غير صحيح';
      else out.roomType = room;
    }
  }

  if (type === 'visa') {
    set('nationality', str(body.nationality, 2, 60));
    set('residence', str(body.residence, 2, 60));
    set('destination', str(body.destination, 2, 60));
    const visaType = String(body.visaType || '');
    if (!['tourist', 'umrah', 'business', 'transit', 'study', 'family', 'other'].includes(visaType)) errors.visaType = 'نوع التأشيرة غير صحيح';
    else out.visaType = visaType;
    const purpose = String(body.purpose || '');
    if (!['tourism', 'umrah', 'business', 'visit', 'study', 'other'].includes(purpose)) errors.purpose = 'الغرض من السفر غير صحيح';
    else out.purpose = purpose;
    if (body.travelDate) {
      const d = date(body.travelDate, { minToday: false, label: 'تاريخ السفر المتوقع' });
      if (d.error) errors.travelDate = d.error; else out.travelDate = d.value;
    }
    set('applicants', int(body.applicants, 1, 30, 'عدد المتقدمين'));
    if (body.previousVisas) set('previousVisas', str(body.previousVisas, 1, 400));
  }

  if (type === 'consult') {
    const topic = String(body.topic || '');
    if (!['trip', 'visa', 'flight', 'hotel', 'honeymoon', 'family', 'umrah', 'general'].includes(topic)) errors.topic = 'اختر نوع الاستشارة';
    else out.topic = topic;
    set('message', str(body.message, 10, 2000));
    const channel = String(body.channel || 'whatsapp');
    if (!CHANNELS[channel]) errors.channel = 'قناة التواصل غير صحيحة';
    else out.channel = channel;
  }

  if (type === 'cruise') {
    set('destination', str(body.destination, 2, 80));
    if (body.departDate) {
      const d = date(body.departDate, { minToday: false, label: 'موعد الرحلة' });
      if (d.error) errors.departDate = d.error;
      else out.departDate = d.value;
    }
    set('adults', int(body.adults ?? 1, 1, 30, 'عدد البالغين'));
    set('children', int(body.children ?? 0, 0, 20, 'عدد الأطفال'));
  }

  return { ok: Object.keys(errors).length === 0, errors, value: out };
}

export function summarize(type, v, programTitle = '') {
  const pax = (n) => `${n} مسافر`;
  if (type === 'flight') {
    const route = v.tripType === 'multi'
      ? v.segments.map((s) => `${s.from} → ${s.to}`).join(' / ')
      : `${v.origin} → ${v.destination}${v.returnDate ? ` → ${v.origin}` : ''}`;
    return `${route} · ${v.tripType === 'multi' ? v.segments[0].date : v.departDate} · ${pax((v.adults || 0) + (v.children || 0) + (v.infants || 0))}`;
  }
  if (type === 'hotel') return `${v.city}${v.hotelName ? ` – ${v.hotelName}` : ''} · ${v.checkIn} → ${v.checkOut} · ${v.rooms} غرفة · ${pax(v.adults)}`;
  if (type === 'program' || type === 'umrah') return `${programTitle || v.programSlug}${v.optionLabel ? ` – ${v.optionLabel}` : ''} · ${pax(v.adults)}${v.children ? ` + ${v.children} طفل` : ''}`;
  if (type === 'visa') return `${v.nationality} → ${v.destination} · ${v.applicants} متقدم`;
  if (type === 'consult') return `استشارة: ${v.topic} · ${CHANNELS[v.channel]}`;
  if (type === 'cruise') return `رحلة كروز إلى ${v.destination}${v.departDate ? ` · ${v.departDate}` : ''} · ${pax((v.adults || 0) + (v.children || 0))}`;
  return '';
}

export function payloadHash(type, value) {
  const keys = Object.keys(value).sort();
  const canonical = JSON.stringify([type, keys.map((k) => [k, value[k]])]);
  let h = 2166136261;
  for (let i = 0; i < canonical.length; i++) {
    h ^= canonical.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16);
}

export function findRecentDuplicate(db, phone, type, hash, minutes = 15) {
  const since = new Date(Date.now() - minutes * 60000).toISOString();
  const rows = q(db, 'SELECT id, reference, payload, created_at FROM requests WHERE type = ? AND created_at >= ? ORDER BY id DESC LIMIT 20', [type, since]);
  for (const row of rows) {
    let payload;
    try { payload = JSON.parse(row.payload); } catch { continue; }
    if (payload.phone === phone && payload.hash === hash) return row;
  }
  return null;
}

export function upsertCustomer(db, { name, phone, email, country, consent }) {
  const now = isoNow();
  const existing = one(db, 'SELECT * FROM customers WHERE phone = ?', [phone]);
  if (existing) {
    exec(db, 'UPDATE customers SET name = ?, email = COALESCE(?, email), country = COALESCE(?, country), consent = MAX(consent, ?), updated_at = ? WHERE id = ?',
      [name, email || null, country || null, consent ? 1 : 0, now, existing.id]);
    return existing.id;
  }
  const res = exec(db, 'INSERT INTO customers (name, phone, email, country, consent, created_at, updated_at) VALUES (?,?,?,?,?,?,?)',
    [name, phone, email || null, country || null, consent ? 1 : 0, now, now]);
  return Number(res.lastInsertRowid);
}

export function createRequest(db, type, rawBody, meta = {}) {
  const validation = validateRequest(type, rawBody);
  if (!validation.ok) return { ok: false, errors: validation.errors };
  const value = validation.value;
  if (!value.consent) return { ok: false, errors: { consent: 'يلزم الموافقة على حفظ البيانات للتواصل معك' } };

  const { whatsappUpdates, ...hashableValue } = value;
  const hash = payloadHash(type, { ...hashableValue, notes: value.notes || '' });
  const duplicate = findRecentDuplicate(db, value.phone, type, hash);
  if (duplicate) {
    if (meta.clientId) exec(db, 'UPDATE requests SET client_id = ? WHERE id = ? AND client_id IS NULL', [meta.clientId, duplicate.id]);
    let notifyWhatsApp = false;
    if (value.whatsappUpdates) {
      const existing = one(db, 'SELECT payload, customer_id FROM requests WHERE id = ?', [duplicate.id]);
      let existingPayload = {};
      try { existingPayload = JSON.parse(existing?.payload || '{}'); } catch { existingPayload = {}; }
      const customer = existing?.customer_id
        ? one(db, 'SELECT whatsapp_opted_out FROM customers WHERE id = ?', [existing.customer_id])
        : null;
      notifyWhatsApp = existingPayload.whatsappUpdates !== true || !!customer?.whatsapp_opted_out;
      if (notifyWhatsApp) {
        existingPayload.whatsappUpdates = true;
        exec(db, 'UPDATE requests SET payload = ? WHERE id = ?', [JSON.stringify(existingPayload), duplicate.id]);
        exec(db, 'UPDATE customers SET whatsapp_opted_out = 0, whatsapp_opted_in_at = ?, updated_at = ? WHERE id = ?',
          [isoNow(), isoNow(), existing.customer_id]);
      }
    }
    return { ok: true, duplicate: true, reference: duplicate.reference, id: duplicate.id, notifyWhatsApp };
  }

  let programTitle = '';
  if (type === 'program' || type === 'umrah') {
    const program = one(db, 'SELECT title, price_from, currency FROM programs WHERE slug = ?', [value.programSlug]);
    if (!program) return { ok: false, errors: { programSlug: 'البرنامج غير موجود أو لم يعد متاحًا' } };
    programTitle = program.title;
    value.programTitle = program.title;
    value.priceFromAtRequest = program.price_from;
    value.currencyAtRequest = program.currency;
  }

  const customerId = upsertCustomer(db, {
    name: value.name, phone: value.phone, email: value.email, country: value.residence || value.country, consent: value.consent,
  });
  const now = isoNow();
  if (value.whatsappUpdates) {
    exec(db, 'UPDATE customers SET whatsapp_opted_out = 0, whatsapp_opted_in_at = ?, updated_at = ? WHERE id = ?',
      [now, now, customerId]);
  }
  const summary = summarize(type, value, programTitle);
  const title = programTitle || REQUEST_TYPES[type].label;
  const payload = { ...value, hash, userAgent: String(meta.userAgent || '').slice(0, 180), ip: meta.ip || null };
  const departmentName = REQUEST_TYPES[type].department === 'الفنادق' || REQUEST_TYPES[type].department === 'البرامج السياحية'
    || REQUEST_TYPES[type].department === 'الحج والعمرة'
    ? ({ hotel: 'قسم الهوليداي والبرامج السياحية', program: 'قسم الهوليداي والبرامج السياحية', umrah: 'قسم الحج والعمرة' }[type])
    : REQUEST_TYPES[type].department;
  const departmentId = one(db, 'SELECT id FROM departments WHERE name = ? AND branch_id IS NULL ORDER BY id LIMIT 1', [departmentName])?.id || null;

  let lastError;
  for (let attempt = 0; attempt < 4; attempt++) {
    const ref = reference(type);
    try {
      const res = exec(db, `INSERT INTO requests
        (reference, type, status, customer_id, client_id, branch_id, received_branch_id, assigned_to, service_owner_id,
         department, department_id, title, summary, payload, source, lead_origin, consent, created_at, updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [ref, type, 'new', customerId, meta.clientId || null, meta.branchId || null, meta.branchId || null,
        meta.assignedTo || null, meta.assignedTo || null, departmentName, departmentId, title, summary, JSON.stringify(payload),
        meta.source || 'website', meta.source || 'website', value.consent ? 1 : 0, now, now]);
      const id = Number(res.lastInsertRowid);
      if (meta.assignedTo) {
        exec(db, `INSERT INTO request_owner_history
          (request_id, owner_type, previous_value, next_value, changed_by, note, created_at)
          VALUES (?, 'assigned', NULL, ?, ?, 'إسناد عند الإنشاء', ?)`, [id, String(meta.assignedTo), meta.actorId, now]);
      }
      addEvent(db, id, {
        kind: 'created', actorId: meta.actorId || null,
        message: meta.internal ? 'سجّل الموظف الطلب' : 'تم إنشاء الطلب من الموقع',
        actorName: meta.actorName || (meta.internal ? 'موظف' : 'الموقع'),
        meta: { type, branchId: meta.branchId || null },
      });
      return { ok: true, id, reference: ref, summary, duplicate: false, value: Number(value.priceFromAtRequest) || 0 };
    } catch (err) {
      lastError = err;
      if (!String(err.message).includes('UNIQUE')) throw err;
    }
  }
  throw lastError;
}

export function addEvent(db, requestId, { kind, message, actorId = null, actorName = null, meta = null }) {
  exec(db, 'INSERT INTO request_events (request_id, actor_id, actor_name, kind, message, meta, created_at) VALUES (?,?,?,?,?,?,?)',
    [requestId, actorId, actorName, kind, message || null, meta ? JSON.stringify(meta) : null, isoNow()]);
}

export function transitionError(from, to) {
  if (!STATUSES[to]) return 'حالة غير معروفة';
  if (from === to) return null;
  const allowed = STATUSES[from]?.next || [];
  if (!allowed.includes(to)) return `الانتقال من «${STATUSES[from]?.label || from}» إلى «${STATUSES[to].label}» غير مسموح`;
  return null;
}

export function publicStatus(db, reference_) {
  const row = one(db, `SELECT r.*, c.name AS customer_name FROM requests r LEFT JOIN customers c ON c.id = r.customer_id WHERE r.reference = ?`, [reference_]);
  if (!row) return null;
  const events = q(db, `SELECT kind, message, created_at FROM request_events WHERE request_id = ? AND kind IN ('created','status','quote') ORDER BY id`, [row.id]);
  let payload = {};
  try { payload = JSON.parse(row.payload); } catch { /* ignore */ }
  return {
    reference: row.reference,
    type: row.type,
    typeLabel: REQUEST_TYPES[row.type]?.label || row.type,
    status: row.status,
    statusLabel: STATUSES[row.status]?.label || row.status,
    title: row.title || '',
    summary: row.summary,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    quote: row.quote_amount ? { amount: row.quote_amount, currency: row.quote_currency, note: row.quote_note } : null,
    timeline: events.map((e) => ({ kind: e.kind, message: e.message, at: e.created_at })),
    phoneLast4: String(payload.phone || '').slice(-4),
    /* Voucher fields: this response is only returned to someone who knows both reference and phone. */
    customerName: payload.name || row.customer_name || '',
    details: {
      name: payload.name || row.customer_name || '',
      phone: payload.phone || '',
      email: payload.email || '',
      travelDate: payload.departDate || payload.preferredDate || payload.checkIn || payload.travelDate || '',
      returnDate: payload.returnDate || payload.checkOut || '',
      adults: Number(payload.adults || 0), children: Number(payload.children || 0), infants: Number(payload.infants || 0),
      rooms: Number(payload.rooms || 0), nights: Number(payload.nights || 0), days: Number(payload.days || 0),
      optionLabel: payload.optionLabel || '', currency: payload.currency || 'JOD',
      priceFromAtRequest: payload.priceFromAtRequest != null ? payload.priceFromAtRequest : null,
    },
  };
}

export function stats(db) {
  const byType = Object.fromEntries(q(db, "SELECT type, COUNT(*) AS n FROM requests GROUP BY type").map((r) => [r.type, r.n]));
  const byStatus = Object.fromEntries(q(db, "SELECT status, COUNT(*) AS n FROM requests GROUP BY status").map((r) => [r.status, r.n]));
  const total = one(db, 'SELECT COUNT(*) AS n FROM requests')?.n || 0;
  const todayCount = one(db, 'SELECT COUNT(*) AS n FROM requests WHERE substr(created_at,1,10) = ?', [today()])?.n || 0;
  const followUps = one(db, `SELECT COUNT(*) AS n FROM requests WHERE status IN ('new','reviewing','quoted','awaiting','in_progress')
      AND julianday('now') - julianday(updated_at) >= 1`)?.n || 0;
  const overdue = one(db, `SELECT COUNT(*) AS n FROM requests WHERE status IN ('new','reviewing') AND julianday('now') - julianday(created_at) >= 2`)?.n || 0;
  const customers = one(db, 'SELECT COUNT(*) AS n FROM customers')?.n || 0;
  const quotes = one(db, 'SELECT COUNT(*) AS n FROM requests WHERE quote_amount IS NOT NULL')?.n || 0;
  const confirmed = byStatus.confirmed || 0;
  const sources = q(db, 'SELECT source, COUNT(*) AS n FROM requests GROUP BY source ORDER BY n DESC').map((r) => ({ source: r.source, n: r.n }));
  const last7 = q(db, `SELECT substr(created_at,1,10) AS day, COUNT(*) AS n FROM requests
      WHERE julianday('now') - julianday(created_at) <= 7 GROUP BY day ORDER BY day`).map((r) => ({ day: r.day, n: r.n }));
  return { total, today: todayCount, byType, byStatus, followUps, overdue, customers, quotes, confirmed, sources, last7 };
}

export function searchPrograms(db, { category, q: query, destination, route, mode, minPrice, maxPrice, minDays, maxDays, sort, limit = 60 } = {}) {
  const where = ["status IN ('published','sold_out')"];
  const params = [];
  if (category && category !== 'all') { where.push('category = ?'); params.push(category); }
  if (category === 'umrah' && ['makkah', 'both'].includes(route)) { where.push('route = ?'); params.push(route); }
  if (category === 'umrah' && ['air', 'bus'].includes(mode)) { where.push('mode = ?'); params.push(mode); }
  if (destination) { where.push('destination = ?'); params.push(destination); }
  if (Number(minPrice) > 0) { where.push('price_from >= ?'); params.push(Number(minPrice)); }
  if (Number(maxPrice) > 0) { where.push('price_from <= ?'); params.push(Number(maxPrice)); }
  if (Number(minDays) > 0) { where.push('days >= ?'); params.push(Number(minDays)); }
  if (Number(maxDays) > 0) { where.push('days <= ?'); params.push(Number(maxDays)); }
  if (query) {
    const norm = `%${normalizeArabic(query)}%`;
    where.push('(lower(title) LIKE ? OR lower(COALESCE(destination,\'\')) LIKE ? OR lower(COALESCE(summary,\'\')) LIKE ?)');
    params.push(norm, norm, norm);
  }
  const order = {
    price: 'price_from ASC, sort ASC',
    priceDesc: 'price_from DESC, sort ASC',
    duration: 'days DESC, sort ASC',
    newest: 'id DESC',
    recommended: 'featured DESC, sort ASC, price_from ASC',
  }[sort] || 'featured DESC, sort ASC, price_from ASC';
  const rows = q(db, `SELECT * FROM programs WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT ?`, [...params, limit]);
  return rows.map(hydrateProgram);
}

export function hydrateProgram(row) {
  if (!row) return null;
  const parse = (k) => { try { return JSON.parse(row[k]); } catch { return []; } };
  return {
    ...row,
    hotels: parse('hotels'),
    itinerary: parse('itinerary'),
    includes: parse('includes'),
    excludes: parse('excludes'),
    terms: parse('terms'),
    flights: parse('flights'),
    options: parse('options'),
    badges: parse('badges'),
  };
}

export function programBySlug(db, slug) {
  return hydrateProgram(one(db, 'SELECT * FROM programs WHERE slug = ?', [slug]));
}

export function programsForRecommendation(db) {
  return searchPrograms(db, { limit: 200 });
}

export function recommend(answers, programs) {
  const budget = Number(answers.budget) || 0;
  const pax = Number(answers.pax) || 2;
  const style = String(answers.style || ''); // sea | nature | city | shopping | culture
  const trip = String(answers.trip || ''); // family | honeymoon | solo | friends | umrah
  const month = String(answers.month || '');

  const scored = programs.map((p) => {
    let score = 0;
    if (trip === 'umrah' && p.category === 'umrah') score += 60;
    if (trip === 'honeymoon' && ['cruise', 'istanbul', 'sharm', 'europe'].includes(p.category)) score += 26;
    if (trip === 'family' && ['sharm', 'istanbul', 'cruise'].includes(p.category)) score += 22;
    if (style === 'sea' && ['sharm', 'cruise'].includes(p.category)) score += 18;
    if (style === 'nature' && ['istanbul', 'europe', 'asia'].includes(p.category)) score += 14;
    if (style === 'city' && ['istanbul', 'europe'].includes(p.category)) score += 16;
    if (style === 'culture' && ['istanbul', 'europe', 'egypt'].includes(p.category)) score += 16;
    if (style === 'shopping' && ['istanbul', 'gulf'].includes(p.category)) score += 14;
    if (budget > 0 && p.price_from) {
      const total = p.price_from * Math.max(1, pax);
      if (total <= budget) score += 24;
      else if (total <= budget * 1.15) score += 8;
      else score -= 18;
    }
    if (p.status === 'sold_out') score -= 20;
    if (p.featured) score += 4;
    if (month) {
      const dates = `${p.departure_dates || ''}`;
      if (dates && !dates.includes(month)) score -= 4;
    }
    return { program: p, score };
  });

  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || (a.program.price_from || 1e9) - (b.program.price_from || 1e9))
    .slice(0, 6);
}

export function audit(db, { user, action, entity, entityId, meta, ip }) {
  exec(
    db,
    'INSERT INTO audit_log (user_id, user_name, action, entity, entity_id, meta, ip, created_at) VALUES (?,?,?,?,?,?,?,?)',
    [
      user?.id || null,
      user?.name || null,
      action,
      entity || null,
      entityId ? String(entityId) : null,
      meta ? JSON.stringify(redactAudit(meta)).slice(0, 4000) : null,
      ip || null,
      isoNow(),
    ],
  );
}

export function redactAudit(value) {
  if (Array.isArray(value)) return value.map(redactAudit);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        /password|salt|token|secret|otp|recovery|cookie|authorization|payload|phone|email|passport/i.test(
          key,
        ) && typeof item !== "boolean"
          ? "[REDACTED]"
          : redactAudit(item),
      ]),
    );
  return value;
}
