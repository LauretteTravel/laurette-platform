import { createHash, timingSafeEqual } from 'node:crypto';
import { one } from './db.js';
import { cleanPhone } from './domain.js';
import { HttpError, json, readJson } from './http.js';

function digest(value) {
  return createHash('sha256').update(value).digest();
}

function optionalText(value, max) {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string' || value.length > max) {
    throw new HttpError(400, 'أحد حقول المحادثة غير صالح');
  }
  return value;
}

function normalizeMessage(message) {
  if (typeof message === 'string') message = { text: message };
  if (!message || typeof message !== 'object' || Array.isArray(message)) {
    throw new HttpError(400, 'صيغة رسالة واتساب غير صالحة');
  }
  const direction = message.direction ?? 'unknown';
  if (!['incoming', 'outgoing', 'unknown'].includes(direction)) {
    throw new HttpError(400, 'اتجاه رسالة واتساب غير صالح');
  }
  return {
    id: optionalText(message.id, 512),
    direction,
    text: optionalText(message.text, 65_536),
    label: optionalText(message.label, 512),
  };
}

export async function saveChat(ctx) {
  const secret = process.env.EXTENSION_SECRET;
  if (!secret) throw new HttpError(503, 'استيراد محادثات واتساب غير مفعّل');

  const authorization = ctx.req.headers.authorization;
  const token = typeof authorization === 'string' && /^Bearer ([!-~]{1,4096})$/i.exec(authorization)?.[1];
  if (!token || !timingSafeEqual(digest(token), digest(secret))) {
    throw new HttpError(403, 'رمز مصادقة الإضافة غير صالح');
  }

  // Allow the extension's ten bounded messages even when JSON escaping expands the body.
  const body = await readJson(ctx.req, 4 * 1024 * 1024);
  const contact = body.contact ?? body;
  const name = optionalText(contact.name, 512)?.trim() || null;
  const phone = cleanPhone(optionalText(contact.phone, 64)) || null;
  if ((!name && !phone) || (phone && !/^\+?\d{7,15}$/.test(phone))) {
    throw new HttpError(400, 'أدخل اسم جهة الاتصال أو رقم هاتف صالحًا');
  }

  const inputMessages = body.messages ?? body.lastMessages;
  if (!Array.isArray(inputMessages) || inputMessages.length < 1 || inputMessages.length > 10) {
    throw new HttpError(400, 'أرسل من رسالة واحدة إلى عشر رسائل');
  }
  const messages = inputMessages.map(normalizeMessage);
  const fingerprint = digest(JSON.stringify({ name, phone, messages })).toString('hex');
  const inserted = one(ctx.db, `
    INSERT INTO whatsapp_chat_imports (fingerprint, contact_name, contact_phone, messages_json, created_at)
    VALUES (?, ?, ?, ?, ?) ON CONFLICT(fingerprint) DO NOTHING RETURNING id
  `, [fingerprint, name, phone, JSON.stringify(messages), new Date().toISOString()]);
  if (inserted) return json(ctx.res, 201, { ok: true, id: inserted.id });

  const existing = one(ctx.db, 'SELECT id FROM whatsapp_chat_imports WHERE fingerprint = ?', [fingerprint]);
  return json(ctx.res, 200, { ok: true, id: existing.id, duplicate: true });
}
