import { cleanPhone } from './domain.js';

const PHONE_SEQUENCE = /(?<![\p{L}\d+])\+?(?:\(\d{1,4}\)|\d+)(?:[ \t.\u2010-\u2015-]+(?:\(\d{1,4}\)|\d+))*(?![\p{L}\d])/gu;

export function extractPhones(text) {
  if (typeof text !== 'string') return [];

  const normalized = text.replace(/[٠-٩۰-۹]/g, digit =>
    String(digit.charCodeAt(0) - (digit <= '٩' ? 0x660 : 0x6f0)));
  const phones = new Set();
  for (const [candidate] of normalized.matchAll(PHONE_SEQUENCE)) {
    const phone = cleanPhone(candidate.replace(/[.\u2010-\u2015]/g, ''));
    if (/^\+[1-9]\d{6,14}$/.test(phone) || /^(?:962|0)?7[789]\d{7}$/.test(phone)) {
      phones.add(phone);
    }
  }
  return [...phones];
}

export function detectIntent(text) {
  if (/حجز|تذكرة|تذاكر|\bflights?\b/i.test(text)) return 'BOOKING_INQUIRY';
  if (/تأشيرة|تاشيرة|فيزا|\bvisas?\b/i.test(text)) return 'VISA_INQUIRY';
  if (/سعر|تكلفة|(?<!\p{L})كم(?!\p{L})|\bprices?\b/iu.test(text)) return 'PRICING_INQUIRY';
  return 'GENERAL_SUPPORT';
}

export function processIncomingChat({ name, phone, messages }, processedAt) {
  // Legacy messages have no direction. Exclude replies known to be from staff.
  const customerText = messages
    .filter(message => message.direction !== 'outgoing' && message.text)
    .map(message => message.text)
    .join('\n');

  return {
    clientName: name || 'Unknown',
    primaryPhone: phone || extractPhones(customerText)[0] || 'N/A',
    detectedIntent: detectIntent(customerText),
    messageCount: messages.length,
    processedAt,
    status: 'PENDING_REVIEW',
  };
}
