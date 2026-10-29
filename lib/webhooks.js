import { createHmac, timingSafeEqual } from 'node:crypto';
import { exec, q } from './db.js';
import { isoNow } from './util.js';

/**
 * n8n booking webhook (outbound).
 *
 * Env:
 *   N8N_BOOKING_WEBHOOK_URL     — full URL of the n8n Webhook node (production URL)
 *   N8N_BOOKING_WEBHOOK_SECRET  — shared secret used for HMAC-SHA256 signing
 *
 * Signature:  sha256=HMAC(secret, `${timestamp}.${rawBody}`)
 * Headers:    x-loret-event, x-loret-timestamp, x-loret-signature, x-loret-delivery
 */

export function webhookConfig(env = process.env) {
  const url = String(env.N8N_BOOKING_WEBHOOK_URL || env.N8N_WEBHOOK_URL || '').trim();
  const secret = String(env.N8N_BOOKING_WEBHOOK_SECRET || '').trim();
  const apiKey = String(env.N8N_API_KEY || env.N8N_WEBHOOK_KEY || '').trim();
  // يكفي الرابط مع أحد المفتاحين: سر HMAC أو مفتاح Header Auth.
  return { url, secret, apiKey, enabled: Boolean(url && (secret || apiKey)) };
}

export function signPayload(secret, timestamp, rawBody) {
  return `sha256=${createHmac('sha256', String(secret)).update(`${timestamp}.${rawBody}`).digest('hex')}`;
}

export function verifySignature({ secret, timestamp, rawBody, signature, toleranceSeconds = 300 }) {
  if (!secret || !timestamp || !signature) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return false;
  if (toleranceSeconds > 0 && Math.abs(Math.floor(Date.now() / 1000) - ts) > toleranceSeconds) return false;
  const expected = Buffer.from(signPayload(secret, timestamp, rawBody));
  const provided = Buffer.from(String(signature));
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

const TYPE_LABEL = {
  flight: 'طلب تذكرة طيران',
  hotel: 'طلب حجز فندق',
  program: 'طلب برنامج سياحي',
  umrah: 'طلب عمرة',
  visa: 'طلب تأشيرة',
  consult: 'استشارة',
};

/** A small, explicit payload — enough for n8n to notify the right team, no passwords/tokens. */
export function buildBookingEvent({ request, settings }) {
  const payload = request.payload || {};
  return {
    event: 'booking.created',
    id: request.id,
    reference: request.reference,
    type: request.type,
    typeLabel: TYPE_LABEL[request.type] || request.type,
    department: request.department,
    title: request.title,
    summary: request.summary,
    status: request.status,
    source: request.source,
    createdAt: request.created_at,
    customer: {
      name: payload.name || null,
      phone: payload.phone || null,
      email: payload.email || null,
      country: payload.country || payload.residence || null,
    },
    details: pickDetails(request.type, payload),
    meta: {
      site: settings?.brandShort || 'لوريت',
      dashboardUrl: settings?.baseUrl ? `${settings.baseUrl}/admin` : null,
      trackUrl: settings?.baseUrl ? `${settings.baseUrl}/track?reference=${encodeURIComponent(request.reference)}` : null,
    },
  };
}

function pickDetails(type, p) {
  const base = {};
  const put = (key, value) => { if (value !== undefined && value !== null && value !== '') base[key] = value; };
  put('programSlug', p.programSlug);
  put('programTitle', p.programTitle);
  put('destination', p.destination);
  put('origin', p.origin);
  put('city', p.city);
  put('hotelName', p.hotelName);
  put('departDate', p.departDate);
  put('returnDate', p.returnDate);
  put('checkIn', p.checkIn);
  put('checkOut', p.checkOut);
  put('nights', p.nights);
  put('adults', p.adults);
  put('children', p.children);
  put('infants', p.infants);
  put('rooms', p.rooms);
  put('cabin', p.cabin);
  put('purpose', p.purpose);
  put('notes', p.notes);
  if (type === 'visa') put('nationality', p.nationality);
  return base;
}

function insertPending(db, { reference, event, url }) {
  try {
    const res = exec(db, 'INSERT INTO webhook_deliveries (reference, event, url, status, created_at) VALUES (?,?,?,?,?)',
      [reference, event, url, 'pending', isoNow()]);
    return Number(res.lastInsertRowid);
  } catch {
    return null;
  }
}

function finishDelivery(db, id, { status, responseCode = null, error = null, attempts = 1, durationMs = null }) {
  if (!id) return;
  try {
    exec(db, 'UPDATE webhook_deliveries SET status = ?, response_code = ?, error = ?, attempts = ?, duration_ms = ?, finished_at = ? WHERE id = ?',
      [status, responseCode, error ? String(error).slice(0, 400) : null, attempts, durationMs, isoNow(), id]);
  } catch {
    /* logging must never break a booking */
  }
}

/**
 * Fire the booking event to n8n. Never throws; records the outcome in webhook_deliveries.
 * Returns { status: 'skipped'|'delivered'|'failed', code?, error? }.
 */
export async function notifyBooking(db, request, settings, options = {}) {
  const { url, secret, enabled } = webhookConfig(options.env || process.env);
  if (!enabled) return { status: 'skipped', reason: 'not-configured' };
  return sendEvent(db, {
    reference: request.reference,
    event: 'booking.created',
    payload: buildBookingEvent({ request, settings }),
    options,
  });
}

/** حالة الطلب بعد تغييرها من لوحة الإدارة — تُبقي شيت n8n مطابقًا لقاعدة الموقع. */
export function buildStatusEvent({ request, settings, from, to, fromLabel, toLabel, stageLabel = null, actorName = null, closed = false }) {
  const payload = request.payload || {};
  return {
    event: 'booking.status_changed',
    id: request.id,
    reference: request.reference,
    type: request.type,
    typeLabel: TYPE_LABEL[request.type] || request.type,
    department: request.department,
    title: request.title,
    summary: request.summary,
    from,
    fromLabel: fromLabel || from,
    to,
    toLabel: toLabel || to,
    status: to,
    dealStatus: stageLabel,
    closed: Boolean(closed),
    quoteAmount: request.quote_amount ?? null,
    currency: request.quote_currency || 'د.أ',
    changedAt: new Date().toISOString(),
    actor: actorName ? { name: actorName } : null,
    customer: {
      name: payload.name || null,
      phone: payload.phone || null,
      email: payload.email || null,
    },
    meta: {
      site: settings?.brandShort || 'لوريت',
      dashboardUrl: settings?.baseUrl ? `${settings.baseUrl}/admin` : null,
      trackUrl: settings?.baseUrl ? `${settings.baseUrl}/track?reference=${encodeURIComponent(request.reference)}` : null,
    },
  };
}

/** عرض السعر يُرسل منفصلاً كي يسجّله الشيت في عموده المالي. */
export function buildQuoteEvent({ request, settings, amount, currency = 'د.أ', actorName = null }) {
  const payload = request.payload || {};
  return {
    event: 'booking.quoted',
    id: request.id,
    reference: request.reference,
    type: request.type,
    typeLabel: TYPE_LABEL[request.type] || request.type,
    amount,
    currency,
    status: request.status,
    quotedAt: new Date().toISOString(),
    actor: actorName ? { name: actorName } : null,
    customer: { name: payload.name || null, phone: payload.phone || null, email: payload.email || null },
    meta: {
      site: settings?.brandShort || 'لوريت',
      dashboardUrl: settings?.baseUrl ? `${settings.baseUrl}/admin` : null,
      trackUrl: settings?.baseUrl ? `${settings.baseUrl}/track?reference=${encodeURIComponent(request.reference)}` : null,
    },
  };
}

export async function notifyStatusChange(db, request, settings, details = {}, options = {}) {
  const { enabled } = webhookConfig(options.env || process.env);
  if (!enabled) return { status: 'skipped', reason: 'not-configured' };
  return sendEvent(db, {
    reference: request.reference,
    event: 'booking.status_changed',
    payload: buildStatusEvent({ request, settings, ...details }),
    options,
  });
}

export async function notifyQuoteUpdate(db, request, settings, details = {}, options = {}) {
  const { enabled } = webhookConfig(options.env || process.env);
  if (!enabled) return { status: 'skipped', reason: 'not-configured' };
  return sendEvent(db, {
    reference: request.reference,
    event: 'booking.quoted',
    payload: buildQuoteEvent({ request, settings, ...details }),
    options,
  });
}

/** Shared sender: signs the body, adds optional X-API-Key, logs one row per attempt. */
async function sendEvent(db, { reference, event, payload, options = {} }) {
  const env = options.env || process.env;
  const { url, secret, apiKey } = webhookConfig(env);
  const rawBody = JSON.stringify(payload);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = secret ? signPayload(secret, timestamp, rawBody) : null;
  const deliveryId = `${reference}-${event}-${timestamp}`;
  const fetchImpl = options.fetchImpl || fetch;
  const timeoutMs = Number(options.timeoutMs || env.N8N_BOOKING_TIMEOUT_MS || 6000);
  const started = Date.now();
  const rowId = insertPending(db, { reference, event, url });

  const headers = {
    'content-type': 'application/json; charset=utf-8',
    'x-loret-event': event,
    'x-loret-timestamp': timestamp,
    'x-loret-delivery': deliveryId,
  };
  if (signature) headers['x-loret-signature'] = signature;
  // Header Auth في n8n (أو وسيط يتحقق من مفتاح ثابت).
  if (apiKey) headers['x-api-key'] = apiKey;

  try {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers,
      body: rawBody,
      signal: AbortSignal.timeout(timeoutMs),
    });
    const durationMs = Date.now() - started;
    if (!res.ok) {
      finishDelivery(db, rowId, { status: 'failed', responseCode: res.status, error: `HTTP ${res.status}`, durationMs });
      return { status: 'failed', code: res.status };
    }
    finishDelivery(db, rowId, { status: 'delivered', responseCode: res.status, durationMs });
    return { status: 'delivered', code: res.status };
  } catch (err) {
    finishDelivery(db, rowId, {
      status: 'failed',
      error: err?.name === 'TimeoutError' ? `timeout after ${timeoutMs}ms` : err?.message || 'network error',
      durationMs: Date.now() - started,
    });
    return { status: 'failed', error: err?.message || 'network error' };
  }
}

/** الاسم المطلوب في دليل الربط الخارجي */
export const notifyN8n = notifyBooking;

export function recentDeliveries(db, limit = 20) {
  return q(db, 'SELECT id, reference, event, status, response_code, error, duration_ms, created_at FROM webhook_deliveries ORDER BY id DESC LIMIT ?', [limit]);
}
