/* Small shared helpers: escaping, ids, dates, money, arabic normalisation. */

export const AR_MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];

export function esc(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function attr(value) {
  return esc(value).replaceAll('`', '&#96;');
}

export function money(n, currency = 'د.أ') {
  const num = Number(n);
  if (!Number.isFinite(num) || num <= 0) return 'حسب الطلب';
  return `${num.toLocaleString('en-US')} ${currency}`;
}

export function num(n) {
  const v = Number(n);
  return Number.isFinite(v) ? v : 0;
}

export function stripTags(s) {
  return String(s || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

export function clampText(s, max = 300) {
  const t = stripTags(s);
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

export function today() {
  return new Date().toISOString().slice(0, 10);
}

export function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(`${String(iso).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return String(iso);
  return `${d.getUTCDate()} ${AR_MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

export function slugify(input, fallback = 'item') {
  const base = String(input || '')
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 70);
  return base || fallback;
}

export function normalizeArabic(input) {
  return String(input || '')
    .replace(/[\u064B-\u065F\u0670\u0640]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function tokens(input) {
  const stop = new Set(['من', 'في', 'على', 'عن', 'الى', 'إلى', 'و', 'او', 'أو', 'هل', 'ما', 'هي', 'هو', 'انا', 'أنا', 'بدي', 'بدها', 'اريد', 'أريد', 'ابغى', 'كم', 'كيف', 'وين', 'مع', 'the', 'a', 'an', 'to', 'in', 'for', 'of', 'and', 'is', 'are']);
  return normalizeArabic(input)
    .split(' ')
    .filter((w) => w.length > 1 && !stop.has(w));
}

export function overlapScore(queryTokens, text) {
  const hay = new Set(tokens(text));
  let hits = 0;
  for (const t of queryTokens) if (hay.has(t)) hits += 1;
  return hits;
}

export function randomToken(bytes = 24) {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return [...buf].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function reference(type) {
  const prefix = { flight: 'FL', hotel: 'HT', program: 'PG', umrah: 'UM', visa: 'VS', consult: 'CS' }[type] || 'RQ';
  const buf = new Uint8Array(4);
  crypto.getRandomValues(buf);
  const body = [...buf].map((b) => b.toString(36).toUpperCase().padStart(2, '0')).join('').slice(0, 6);
  return `LT-${prefix}-${body}`;
}

export function referenceValid(value) {
  return /^LT-(FL|HT|PG|UM|VS|CS)-[A-Z0-9]{6}$/.test(String(value || ''));
}

export function isoNow() {
  return new Date().toISOString();
}

export function daysBetween(a, b) {
  const d1 = new Date(`${a}T00:00:00Z`);
  const d2 = new Date(`${b}T00:00:00Z`);
  return Math.round((d2 - d1) / 86400000);
}

export function pick(obj, keys) {
  const out = {};
  for (const k of keys) if (obj[k] !== undefined) out[k] = obj[k];
  return out;
}
