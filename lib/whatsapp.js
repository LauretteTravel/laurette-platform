import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { exec, one, q } from './db.js';
import { STATUSES } from './domain.js';
import { json, readBody, text } from './http.js';
import { isoNow } from './util.js';

const GRAPH_VERSION_DEFAULT = 'v26.0';
const MAX_ATTEMPTS = 8;
let workerRunning = false;

export function whatsappNotificationsReady() {
  return process.env.WHATSAPP_NOTIFICATIONS_ENABLED === '1'
    && Boolean(process.env.WHATSAPP_ACCESS_TOKEN)
    && Boolean(process.env.WHATSAPP_PHONE_NUMBER_ID)
    && Boolean(process.env.WHATSAPP_APP_SECRET)
    && Boolean(process.env.WHATSAPP_VERIFY_TOKEN)
    && Boolean(process.env.WHATSAPP_TEMPLATE_REQUEST_RECEIVED)
    && Boolean(process.env.WHATSAPP_TEMPLATE_REQUEST_STATUS);
}

function normalizeRecipient(raw) {
  let value = String(raw || '').trim();
  if (value.startsWith('00')) value = `+${value.slice(2)}`;
  const digits = value.replace(/\D/g, '');
  const countryCode = String(process.env.WHATSAPP_DEFAULT_COUNTRY_CODE || '962').replace(/\D/g, '');
  let normalized;
  if (value.startsWith('+')) normalized = digits;
  else if (digits.startsWith(countryCode)) normalized = digits;
  else if (digits.startsWith('0')) normalized = countryCode + digits.slice(1);
  else return null;
  return /^[1-9]\d{7,14}$/.test(normalized) ? normalized : null;
}

function templateDetails(kind) {
  return {
    name: kind === 'received'
      ? process.env.WHATSAPP_TEMPLATE_REQUEST_RECEIVED
      : process.env.WHATSAPP_TEMPLATE_REQUEST_STATUS,
    language: process.env.WHATSAPP_TEMPLATE_LANGUAGE || 'ar',
  };
}

function constantTimeEqual(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length === b.length && timingSafeEqual(a, b);
}

export function enqueueWhatsAppNotice(db, requestId, kind, baseUrl, newStatus = null) {
  if (!whatsappNotificationsReady()) return false;
  const request = one(db, 'SELECT id, reference, status, payload, customer_id FROM requests WHERE id = ?', [requestId]);
  if (!request) return false;
  let payload;
  try { payload = JSON.parse(request.payload || '{}'); } catch { return false; }
  if (!payload.whatsappUpdates) return false;

  const customer = request.customer_id
    ? one(db, 'SELECT whatsapp_opted_out FROM customers WHERE id = ?', [request.customer_id])
    : null;
  if (customer?.whatsapp_opted_out) return false;

  const recipient = normalizeRecipient(payload.phone);
  if (!recipient) return false;

  const status = newStatus || request.status;
  const trackUrl = new URL(`/track?reference=${encodeURIComponent(request.reference)}`, baseUrl).toString();
  const parameters = kind === 'received'
    ? [String(payload.name || 'عميلنا'), request.reference, 'تم استلام طلبك', trackUrl]
    : [request.reference, STATUSES[status]?.label || status, trackUrl];
  const now = isoNow();
  const eventKey = kind === 'received'
    ? `request:${request.id}:received`
    : `request:${request.id}:update:${randomUUID()}`;

  exec(db, `INSERT OR IGNORE INTO whatsapp_outbox
    (event_key, request_id, kind, status_value, recipient, template_payload, state, attempts, next_attempt_at, created_at)
    VALUES (?,?,?,?,?,?,'pending',0,?,?)`,
  [eventKey, request.id, kind, kind === 'status' ? status : null, recipient,
    JSON.stringify({ parameters }), now, now]);
  return true;
}

function retryDelay(attempt) {
  return Math.min(6 * 60 * 60_000, 15_000 * (2 ** Math.max(0, attempt - 1)));
}

function whatsappEndpoint() {
  const version = String(process.env.WHATSAPP_GRAPH_API_VERSION || GRAPH_VERSION_DEFAULT);
  if (!/^v\d+\.\d+$/.test(version)) throw new Error('INVALID_API_VERSION');
  const phoneNumberId = encodeURIComponent(process.env.WHATSAPP_PHONE_NUMBER_ID);
  return `https://graph.facebook.com/${version}/${phoneNumberId}/messages`;
}

export async function processWhatsAppOutbox(db) {
  if (!whatsappNotificationsReady() || workerRunning) return 0;
  workerRunning = true;
  let processed = 0;
  try {
    exec(db, "UPDATE whatsapp_outbox SET state = 'pending' WHERE state = 'processing'");
    const now = isoNow();
    const rows = q(db, `SELECT * FROM whatsapp_outbox
      WHERE state = 'pending' AND next_attempt_at <= ?
      ORDER BY id ASC LIMIT 10`, [now]);
    for (const row of rows) {
      const claimed = exec(db, "UPDATE whatsapp_outbox SET state = 'processing' WHERE id = ? AND state = 'pending'", [row.id]);
      if (!claimed.changes) continue;
      try {
        const details = templateDetails(row.kind);
        const stored = JSON.parse(row.template_payload || '{}');
        const response = await fetch(whatsappEndpoint(), {
          method: 'POST',
          headers: {
            authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to: row.recipient,
            type: 'template',
            template: {
              name: details.name,
              language: { code: details.language },
              components: [{
                type: 'body',
                parameters: (stored.parameters || []).map((value) => ({ type: 'text', text: String(value) })),
              }],
            },
          }),
          signal: AbortSignal.timeout(12_000),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) {
          const code = result?.error?.code || result?.error?.error_subcode || `HTTP_${response.status}`;
          const error = new Error(String(code));
          error.code = String(code);
          throw error;
        }
        const messageId = result?.messages?.[0]?.id || null;
        exec(db, `UPDATE whatsapp_outbox
          SET state = 'sent', attempts = attempts + 1, message_id = ?, last_error = NULL, sent_at = ?
          WHERE id = ?`, [messageId, isoNow(), row.id]);
        processed += 1;
      } catch (error) {
        const attempts = Number(row.attempts || 0) + 1;
        const failed = attempts >= MAX_ATTEMPTS;
        const next = new Date(Date.now() + retryDelay(attempts)).toISOString();
        const safeError = String(error.code || (error.name === 'TimeoutError' ? 'TIMEOUT' : 'DELIVERY_ERROR')).slice(0, 80);
        exec(db, `UPDATE whatsapp_outbox
          SET state = ?, attempts = ?, next_attempt_at = ?, last_error = ?
          WHERE id = ?`, [failed ? 'failed' : 'pending', attempts, next, safeError, row.id]);
        processed += 1;
      }
    }
  } finally {
    workerRunning = false;
  }
  return processed;
}

function stopWord(value) {
  return /^(?:stop|unsubscribe|إيقاف|ايقاف|الغاء الاشتراك|إلغاء الاشتراك|توقف|وقف)$/i
    .test(String(value || '').trim().replace(/[.!،؟?]+$/g, '').replace(/\s+/g, ' '));
}

function disableCustomerWhatsApp(db, rawPhone) {
  const phone = normalizeRecipient(rawPhone);
  if (!phone) return;
  const customer = q(db, 'SELECT id, phone FROM customers');
  const matches = customer.filter((row) => normalizeRecipient(row.phone) === phone);
  if (!matches.length) return;
  for (const match of matches) {
    exec(db, 'UPDATE customers SET whatsapp_opted_out = 1, whatsapp_opted_in_at = NULL, updated_at = ? WHERE id = ?',
      [isoNow(), match.id]);
    exec(db, `UPDATE whatsapp_outbox SET state = 'cancelled', last_error = 'CUSTOMER_OPTED_OUT'
      WHERE state IN ('pending','processing')
        AND request_id IN (SELECT id FROM requests WHERE customer_id = ?)`, [match.id]);
  }
}

function receiveStatus(db, status) {
  const id = status?.id;
  const value = String(status?.status || '').toLowerCase();
  if (!id || !['sent', 'delivered', 'read', 'failed'].includes(value)) return;
  const error = status?.errors?.[0]?.code;
  exec(db, 'UPDATE whatsapp_outbox SET state = ?, last_error = ? WHERE message_id = ?',
    [value, value === 'failed' ? String(error || 'DELIVERY_FAILED').slice(0, 80) : null, id]);
}

export function verifyWebhook(ctx) {
  const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN;
  const mode = ctx.query['hub.mode'];
  const token = ctx.query['hub.verify_token'];
  const challenge = ctx.query['hub.challenge'];
  if (mode === 'subscribe' && verifyToken && constantTimeEqual(token, verifyToken) && challenge) {
    return text(ctx.res, 200, String(challenge), 'text/plain; charset=utf-8');
  }
  return text(ctx.res, 403, 'Forbidden', 'text/plain; charset=utf-8');
}

export async function receiveWebhook(ctx) {
  const appSecret = process.env.WHATSAPP_APP_SECRET;
  if (!appSecret) return json(ctx.res, 503, { ok: false });
  const raw = await readBody(ctx.req, 512 * 1024);
  const signature = String(ctx.req.headers['x-hub-signature-256'] || '');
  const expected = `sha256=${createHmac('sha256', appSecret).update(raw).digest('hex')}`;
  if (!constantTimeEqual(signature, expected)) return json(ctx.res, 401, { ok: false });

  let body;
  try { body = JSON.parse(raw.toString('utf8')); } catch { return json(ctx.res, 400, { ok: false }); }
  for (const entry of body.entry || []) {
    for (const change of entry.changes || []) {
      const value = change.value || {};
      for (const status of value.statuses || []) receiveStatus(ctx.db, status);
      for (const message of value.messages || []) {
        if (stopWord(message.text?.body)) disableCustomerWhatsApp(ctx.db, message.from);
      }
    }
  }
  return json(ctx.res, 200, { ok: true });
}
