import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const HERE = import.meta.dirname;
const DICT_PATH = join(HERE, 'i18n-en.json');

let dict = {};
let dictMtime = 0;

function loadDict() {
  try {
    const mtime = statSync(DICT_PATH).mtimeMs;
    if (mtime !== dictMtime) {
      dict = JSON.parse(readFileSync(DICT_PATH, 'utf8'));
      dictMtime = mtime;
    }
  } catch {
    /* miss or invalid JSON: keep the previous dictionary */
  }
  return dict;
}

const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'CODE', 'PRE']);
const TEXT_ATTRS = new Set(['placeholder', 'aria-label', 'title', 'alt', 'data-wa-text', 'content']);
const NON_LOCAL_PREFIXES = ['/api/', '/assets/', '/media/', '/art/', '/admin', '/health', '/sitemap', '/robots', '/site.webmanifest'];

export function isLocalizableHref(href) {
  if (!href || typeof href !== 'string' || !href.startsWith('/') || href.startsWith('//')) return false;
  return !NON_LOCAL_PREFIXES.some((p) => href === p || href.startsWith(p));
}

function translateString(value) {
  const raw = String(value);
  const trimmed = raw.trim();
  if (!trimmed) return value;
  const dictHit = loadDict()[trimmed];
  if (dictHit) return raw.match(/^\s*/)[0] + dictHit + raw.match(/\s*$/)[0];

  // Strip leading symbols (emoji, bullets, arrows) so "🔴 title" still matches "title".
  let start = 0;
  while (start < trimmed.length && !hasArabicChars(trimmed[start])) start += 1;
  if (start > 0 && start < trimmed.length) {
    const head = trimmed.slice(0, start);
    const rest = trimmed.slice(start);
    const translatedRest = translateString(rest);
    if (translatedRest !== rest) {
      return raw.match(/^\s*/)[0] + head + translatedRest + raw.match(/\s*$/)[0];
    }
  }

  const patterned = patternTranslate(trimmed);
  if (patterned !== null) return raw.match(/^\s*/)[0] + patterned + raw.match(/\s*$/)[0];
  return value;
}

const ORDINALS = { 'الأول': '1', 'الثاني': '2', 'الثالث': '3', 'الرابع': '4', 'الخامس': '5' };

/**
 * Strings that views compose at runtime (counts, durations, branch labels) cannot live in the
 * phrase table. These patterns cover them; each returns null when it does not apply.
 */
function patternTranslate(s) {
  const title = s.match(/^(.*) \| لوريت$/);
  if (title) {
    const head = translateString(title[1]);
    if (head !== title[1]) return `${head} | Laurette`;
  }
  let m;
  if ((m = s.match(/^(\d+)\s*أيام?\s*\/\s*(\d+)\s*ليال[ٍى]?$/))) return `${m[1]} days / ${m[2]} nights`;
  if ((m = s.match(/^(\d+)\s*أيام?$/))) return `${m[1]} days`;
  if ((m = s.match(/^(\d+)\s*ليال[ٍى]?$/))) return `${m[1]} nights`;
  if ((m = s.match(/^من \(المسار (\d+)\)$/))) return `From (leg ${m[1]})`;
  if ((m = s.match(/^إلى \(المسار (\d+)\)$/))) return `To (leg ${m[1]})`;
  if ((m = s.match(/^التاريخ \(المسار (\d+)\)$/))) return `Date (leg ${m[1]})`;
  if ((m = s.match(/^الرقم (الأول|الثاني|الثالث|الرابع|الخامس)$/))) return `Phone ${ORDINALS[m[1]]}`;
  if ((m = s.match(/^فرع (.+?):?$/)) && /^(إربد|عمّان)$/.test(m[1])) return `${m[1] === 'إربد' ? 'Irbid' : 'Amman'} branch${s.endsWith(':') ? ':' : ''}`;
  if ((m = s.match(/^© (\d{4}) .+$/))) return `© ${m[1]} Laurette Travel, Tourism, Hajj & Umrah — All rights reserved.`;
  if ((m = s.match(/^آخر تحديث لهذه السياسة: ([\d-]+)\.$/))) return `Last updated: ${m[1]}.`;
  if ((m = s.match(/^(\d+) برنامجًا(?: \((\d+) عمرة\))?$/))) return m[2] ? `${m[1]} programmes (${m[2]} Umrah)` : `${m[1]} programmes`;
  if ((m = s.match(/^(\d+) برنامج(?:ًا)?(?: منشور(?:ًا)?)?$/))) return `${m[1]} programmes`;
  if ((m = s.match(/^يبدأ من ([\d,]+) د\.أ$/))) return `From ${m[1]} JOD`;
  if ((m = s.match(/^([\d,]+) د\.أ$/))) return `${m[1]} JOD`;
  if ((m = s.match(/^([\d,]+) دينار$/))) return `${m[1]} JOD`;
  if ((m = s.match(/^(\d+) نجوم$/))) return `${m[1]} stars`;
  if ((m = s.match(/^([\d,]+) مراجعة$/))) return `${m[1]} reviews`;
  if ((m = s.match(/^حتى (\d+) أيام$/))) return `Up to ${m[1]} days`;
  if ((m = s.match(/^اليوم (\d+)$/))) return `Day ${m[1]}`;
  if ((m = s.match(/^الشرط (\d+)$/))) return `Term ${m[1]}`;
  if ((m = s.match(/^تفاصيل (.+)$/))) { const x = translateString(m[1]); if (x !== m[1]) return `${x} details`; }
  if ((m = s.match(/^برامج (.+)$/))) { const x = translateString(m[1]); if (x !== m[1]) return `${x} programmes`; }
  if ((m = s.match(/^آخر تحديث: ([\d-]+)$/))) return `Last updated: ${m[1]}`;
  if ((m = s.match(/^(\d+) دقائق قراءة$/))) return `${m[1]} min read`;
  if ((m = s.match(/^(.+) · (\d+) دقائق قراءة$/))) { const x = translateString(m[1]); if (x !== m[1]) return `${x} · ${m[2]} min read`; }
  if ((m = s.match(/^غرفة (مفردة|ثنائية|ثلاثية|رباعية) — ([\d,]+) د\.أ$/))) {
    const room = translateString(`غرفة ${m[1]}`);
    return `${room} — ${m[2]} JOD`;
  }
  if ((m = s.match(/^كل يوم أربعاء من مطار ماركا – الأسعار ابتداءً من ([\d/]+)$/))) return `Every Wednesday from Marka Airport – prices from ${m[1]}`;
  if ((m = s.match(/^(.+) \((\d+)\)$/))) {
    const head = translateString(m[1]);
    if (head !== m[1]) return `${head} (${m[2]})`;
  }
  if (s.includes(' · ')) {
    const parts = s.split(' · ');
    if (parts.length <= 5 && parts.every((p) => p.length <= 70)) {
      const translated = parts.map((p) => translateString(p));
      if (translated.some((p, i) => p !== parts[i])) return translated.join(' · ');
    }
  }
  return null;
}

export function localizeHref(href) {
  if (!isLocalizableHref(href)) return href;
  if (href === '/') return '/en';
  if (href === '/en' || href.startsWith('/en/') || href.startsWith('/en?') || href.startsWith('/en#')) return href;
  return '/en' + href;
}

function localizeTag(tag) {
  let out = tag.replace(/(\shref\s*=\s*)("([^"]*)"|'([^']*)')/i, (m, pre, quoted, dq, sq) => {
    const value = dq !== undefined ? dq : sq;
    const next = localizeHref(value);
    if (next === value) return m;
    const quote = dq !== undefined ? '"' : "'";
    return `${pre}${quote}${next}${quote}`;
  });
  out = out.replace(/(\s)(placeholder|aria-label|title|alt|data-wa-text|content)(\s*=\s*)("([^"]*)"|'([^']*)')/gi, (m, sp, name, eq, quoted, dq, sq) => {
    if (!TEXT_ATTRS.has(String(name).toLowerCase())) return m;
    const value = dq !== undefined ? dq : sq;
    if (!hasArabicChars(value)) return m;
    const translated = translateString(value);
    if (translated === value) return m;
    const quote = dq !== undefined ? '"' : "'";
    return `${sp}${name}${eq}${quote}${translated}${quote}`;
  });
  return out;
}

function rewriteHead(html, { path, baseUrl }) {
  const cleanPath = path === '/' ? '' : path;
  const arUrl = `${baseUrl}${cleanPath || '/'}`;
  const enUrl = `${baseUrl}${cleanPath ? '/en' + cleanPath : '/en'}`;
  let out = html;
  out = out.replace(/<html lang="ar" dir="rtl">/i, '<html lang="en" dir="ltr">');
  out = out.replace(/<link rel="canonical" href="[^"]*">/i, `<link rel="canonical" href="${enUrl}">`);
  out = out.replace(/<meta property="og:url" content="[^"]*">/i, `<meta property="og:url" content="${enUrl}">`);
  out = out.replace(/<meta property="og:locale" content="[^"]*">/i, '<meta property="og:locale" content="en_US">');
  out = out.replace(/\n?<link rel="alternate" hreflang="[^"]*" href="[^"]*">/gi, '');
  out = out.replace(/<link rel="canonical" href="([^"]*)">/i,
    `<link rel="canonical" href="${enUrl}">\n<link rel="alternate" hreflang="en" href="${enUrl}">\n<link rel="alternate" hreflang="ar" href="${arUrl}">\n<link rel="alternate" hreflang="x-default" href="${arUrl}">`);
  return out;
}

function languageSwitcher(path) {
  const cleanPath = path === '/' ? '' : path;
  return `<a class="lang-switch" data-no-i18n href="${cleanPath || '/'}" hreflang="ar" aria-label="Switch to Arabic" title="Arabic">AR</a>`;
}

/** English pages keep DB-backed long-form copy in Arabic for now; say so explicitly. */
function arabicContentNotice(path) {
  if (!/^\/(programs\/[^/]+|offers|news|guide\/[^/]+|destinations\/[^/]+|visa|hotels|jordan|umrah)/.test(path)) return '';
  return `<div class="en-content-note" role="note"><b>Content note:</b> detailed programme information and long-form guides are currently published in Arabic. Our team will gladly answer in English and send a full quotation — <a href="/en/consult">request a quote</a>.</div>`;
}

export function localizeHtml(html, { path = '/', baseUrl = '', lang = 'en' } = {}) {
  if (lang !== 'en') return html;
  loadDict();
  let out = rewriteHead(html, { path, baseUrl });

  const notice = arabicContentNotice(path);
  if (notice) out = out.replace('<main id="main">', `<main id="main">${notice}`);

  let result = '';
  let i = 0;
  let skipDepth = 0;
  let skipTag = '';
  while (i < out.length) {
    const lt = out.indexOf('<', i);
    if (lt === -1) {
      const tail = out.slice(i);
      result += skipDepth ? tail : translateString(tail);
      break;
    }
    const text = out.slice(i, lt);
    if (text) result += skipDepth ? text : translateString(text);
    const gt = out.indexOf('>', lt);
    if (gt === -1) { result += out.slice(lt); break; }
    const tag = out.slice(lt, gt + 1);
    const nameMatch = tag.match(/^<\/?\s*([a-zA-Z0-9-]+)/);
    const tagName = nameMatch ? nameMatch[1].toUpperCase() : '';
    const isClosing = /^<\//.test(tag);
    if (SKIP_TAGS.has(tagName)) {
      if (isClosing) {
        if (skipDepth > 0 && skipTag === tagName) { skipDepth -= 1; if (skipDepth === 0) skipTag = ''; }
      } else if (!/\/>$/.test(tag)) {
        skipDepth += 1; skipTag = tagName;
      }
      result += tag;
    } else {
      result += skipDepth ? tag : localizeTag(tag);
    }
    i = gt + 1;
  }

  // Swap the header's language link for the Arabic version (the Arabic page already renders the English one).
  const btn = languageSwitcher(path);
  const existing = /<a class="lang-switch"[^>]*>[^<]*<\/a>/;
  result = existing.test(result) ? result.replace(existing, btn) : result.replace('</header>', `${btn}</header>`);

  // Client-side strings (assistant replies, toasts, validation) need the same phrase table in the browser.
  const nonceMatch = result.match(/<script src="\/assets\/js\/app\.js[^"]*"[^>]*nonce="([^"]+)"/);
  const nonceAttr = nonceMatch ? ` nonce="${nonceMatch[1]}"` : '';
  result = result.replace('</body>', `<script src="/assets/js/i18n-client.js"${nonceAttr} defer></script>\n</body>`);
  result = translateJsonLd(result);
  return result;
}

function translateJsonValue(value) {
  if (typeof value === 'string') return translateString(value);
  if (Array.isArray(value)) return value.map(translateJsonValue);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = translateJsonValue(v);
    return out;
  }
  return value;
}

/** Structured data is served in the page language too, so English pages do not declare an Arabic agency. */
function translateJsonLd(html) {
  return html.replace(/(<script type="application\/ld\+json"[^>]*>)([\s\S]*?)(<\/script>)/g, (whole, open, body, close) => {
    try {
      const obj = JSON.parse(body);
      return open + JSON.stringify(translateJsonValue(obj)).replaceAll('<', '\\u003c') + close;
    } catch {
      return whole;
    }
  });
}

function hasArabicChars(value) {
  for (const ch of String(value)) {
    const code = ch.codePointAt(0);
    if (code >= 0x0600 && code <= 0x06ff) return true;
  }
  return false;
}

export function t(value) {
  if (!value || !hasArabicChars(value)) return value;
  return translateString(value);
}

/** Full phrase table, served to the browser for strings built by client-side JS. */
export function dictionary() {
  return loadDict();
}

