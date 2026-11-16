/* صفحة العرض المستقلة /p/:slug — قشرة HTML مستقلة بلا layout().
   تُسجَّل من زميل المسار: router.get('/p/:slug', page(offerMicroPage)) — الغلاف page(fn)
   في server.js:98-105 يمرر (ctx, ctx.params?.slug) ويحوّل null إلى 404.
   كل الأنماط في قسم «OFFER MICRO PAGE (/p/:slug)» بنهاية public/assets/css/app.css.
   ملاحظة مبدئية: programBySlug يعيد البرنامج مهيأً بالفعل (domain.js:506-508 يستدعي
   hydrateProgram داخلياً) — لا يُعاد تفكيكه ثانية وإلا فُقدت المصفوفات المفكوكة. */

import { esc, attr, money, clampText, isoNow } from '../util.js';
import { programBySlug } from '../domain.js';
import { one, exec } from '../db.js';
import { ASSET_V, icon } from './layout.js';
import { inquiryButton, inquiryDialog } from './inquiry-box.js';
import { artUrl } from '../art.js';

const BRAND_TITLE_SUFFIX = 'لوريت';
const BRAND_FULL = 'لوريت للسياحة والسفر والحج والعمرة';

/* التنويه السعر المعتمد حرفياً (نفس عبارة layout.js:127 وfooter-bottom). */
const PRICE_NOTE = 'الأسعار المنشورة «تبدأ من» وتتغير حسب الموسم والتوافر، والسعر المعتمد هو الصادر في عرض رسمي.';

/* نص الموافقة المعتمد — مطابق لـconsentField في lib/views/forms.js:59. */
const CONSENT_HTML = 'أوافق على حفظ بياناتي للتواصل معي بخصوص هذا الطلب، وعلى <a href="/privacy" target="_blank">سياسة الخصوصية</a>. لا تُشارك بياناتي مع أي جهة خارجية إلا لإتمام الخدمة.';

const BRANCH_CODES = ['irbid', 'amman'];
const BRANCH_LABELS = { irbid: 'فرع إربد', amman: 'فرع عمّان' };
const BRANCH_NEEDLES = { irbid: 'إربد', amman: 'عمّان' };

/* ---------- تطبيع الأرقام ---------- */

function digitsOnly(value) {
  return String(value ?? '').replace(/\D/g, '');
}

/* قاعدة التطبيع المعتمدة في هذا الملف: أزل غير الأرقام؛ إن بدأ 0 وطوله 9-10 فأسبق بـ962؛
   إن بدأ 962 اتركه. مثال الفرع الأرضي: 02-7244112 → 027244112 → 96227244112. */
function toIntlJordan(phone) {
  const d = digitsOnly(phone);
  if (!d) return '';
  if (d.startsWith('962')) return d;
  if (d.startsWith('0') && d.length >= 9 && d.length <= 10) return `962${d.slice(1)}`;
  return d;
}

/* العرض المحلي للموبايل: 962791193888 → 0791193888. */
function localDisplay(intl) {
  return intl.startsWith('962') ? `0${intl.slice(3)}` : intl;
}

function waLink(intl, text) {
  if (!intl) return '';
  return `https://wa.me/${intl}?text=${encodeURIComponent(text)}`;
}

/* ---------- حل المستشار/الفرع والرقم المستهدف ---------- */

function branchFromSettings(settings, code) {
  const list = Array.isArray(settings?.branches) ? settings.branches : [];
  const needle = BRANCH_NEEDLES[code];
  if (!needle) return null;
  return list.find((b) => String(b?.name || '').includes(needle)) || null;
}

/*
  ترتيب حل رقم واتساب المستهدف:
  1) هاتف الموظف users.phone (مستخدم active عبر ctx.query.ref)
  2) هاتف الفرع الأرضي من settings.branches (طابق الاسم الذي يحوي إربد أو عمّان)
  3) settings.whatsapp (الرقم العام)
  يعرض الرقم محلياً 0X مع رابط wa.me دولي.
*/
export function resolveAdvisor(ctx) {
  const query = ctx.query || {};
  const queryBranch = BRANCH_CODES.includes(String(query.branch || '')) ? String(query.branch) : '';

  let advisor = null;
  const refRaw = String(query.ref ?? '').trim();
  const refId = Number(refRaw);
  if (refRaw && Number.isInteger(refId) && refId > 0) {
    try {
      advisor = one(ctx.db, 'SELECT id, name, phone, branch_id FROM users WHERE id = ? AND active = 1', [refId]) || null;
    } catch { advisor = null; }
  }

  /* الفرع المرسل بالرابط أولاً، وإلا اشتقاقه من فرع المستشار. */
  let branch = queryBranch;
  if (!branch && advisor?.branch_id) {
    try {
      const row = one(ctx.db, 'SELECT code FROM branches WHERE id = ? AND active = 1', [advisor.branch_id]);
      if (row && BRANCH_CODES.includes(String(row.code))) branch = String(row.code);
    } catch { /* جدول branches موجود دائماً؛ أي فشل لا يكسر الصفحة */ }
  }

  const branchRow = branch ? branchFromSettings(ctx.settings, branch) : null;

  let intl = '';
  if (advisor?.phone) intl = toIntlJordan(advisor.phone);
  if (!intl && branchRow?.phone) intl = toIntlJordan(branchRow.phone);
  if (!intl) intl = digitsOnly(ctx.settings?.whatsapp);

  return {
    ref: advisor ? String(advisor.id) : null,
    advisor,
    branch: branch || null,
    branchLabel: advisor ? '' : (branch ? (branchRow?.name || BRANCH_LABELS[branch] || '') : ''),
    intl,
    local: localDisplay(intl),
  };
}

/* ---------- بطاقات الأسعار (pricing_tiers_json) ---------- */

/* الصيغة القديمة: سطر نصي 'hotel|stars|room|price|notes'. */
function parseLine(line) {
  const parts = String(line).split('|').map((s) => s.trim());
  if (!parts[0]) return null;
  const stars = Math.max(0, Math.min(5, Number(parts[1]) || 0));
  return {
    hotel: parts[0],
    stars,
    room: parts[2] || '',
    price: Number(parts[3]) || 0,
    notes: parts[4] || '',
  };
}

/* فك JSON آمن من pricing_tiers_json؛ ويدعم p.pricingTiers إن أضافها hydrateProgram لاحقاً
   بقيمة مصفوفة جاهزة، وأسطر النص القديم 'hotel|stars|room|price|notes'. */
export function pricingTiers(p) {
  let raw = p?.pricingTiers;
  if (!Array.isArray(raw) || !raw.length) {
    try { raw = JSON.parse(p?.pricing_tiers_json ?? '[]'); } catch { raw = []; }
  }
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const item of raw) {
    if (typeof item === 'string') {
      const t = parseLine(item);
      if (t) out.push(t);
    } else if (item && typeof item === 'object' && String(item.hotel || '').trim()) {
      out.push({
        hotel: String(item.hotel).trim(),
        stars: Math.max(0, Math.min(5, Number(item.stars) || 0)),
        room: String(item.room || '').trim(),
        price: Number(item.price) || 0,
        notes: String(item.notes || '').trim(),
      });
    }
  }
  return out;
}

/* ---------- مصادر الوسائط ---------- */

function posterSrc(p) {
  const poster = String(p?.poster_image ?? p?.posterImage ?? '').trim();
  if (poster) return { kind: 'img', src: poster };
  const image = String(p?.image_url ?? '').trim();
  if (image) return { kind: 'img', src: image };
  if (p?.art_key) return { kind: 'img', src: artUrl(p.art_key, (p.id || 0) % 4) };
  return { kind: 'fallback' };
}

function brochureUrl(p) {
  return String(p?.pdf_brochure_url ?? p?.pdfBrochureUrl ?? '').trim();
}

/* نفس الأصل فقط يُسمح بعرضه داخل iframe (frame-src 'self') — المسار النسبي آمن. */
function isSameOriginPath(url) {
  return url.startsWith('/') && !url.startsWith('//');
}

function absUrl(ctx, url) {
  if (!url) return '';
  return /^https?:\/\//i.test(url) ? url : `${ctx.baseUrl}${url}`;
}

function jsonConst(value) {
  return JSON.stringify(value ?? null).replaceAll('<', '\\u003c');
}

/* ---------- الصفحة ---------- */

export function offerMicroPage(ctx, slug) {
  const { db, settings } = ctx;
  const p = programBySlug(db, slug); // مهيأ بالفعل — انظر الملاحظة أعلاه
  if (!p || p.status === 'draft' || p.status === 'archived') return null;

  const advisor = resolveAdvisor(ctx);
  const currency = p.currency || 'د.أ';
  const tiers = pricingTiers(p);
  const itinerary = Array.isArray(p.itinerary) ? p.itinerary.filter((s) => String(s ?? '').trim()) : [];
  const pdf = brochureUrl(p);
  const pdfInline = pdf ? isSameOriginPath(pdf) : false;
  const duration = p.days ? `${p.days} أيام / ${p.nights || 0} ليالٍ` : '';
  const soldOut = p.status === 'sold_out';
  const brand = String(settings?.brand || BRAND_FULL);

  /* تتبع غير فتاك: أي فشل هنا لا يكسر عرض الصفحة إطلاقاً. */
  try {
    exec(db, 'UPDATE programs SET views_count = views_count + 1 WHERE id = ?', [p.id]);
    exec(db, 'INSERT INTO tracking_events (event, type, path, meta, created_at) VALUES (?, NULL, ?, ?, ?)', [
      'offer_view',
      `/p/${slug}`,
      JSON.stringify({ programId: p.id, ref: advisor.ref, branch: advisor.branch }),
      isoNow(),
    ]);
  } catch { /* أعمدة العرض الجديدة أو الجدول قد لا تكون جاهزة بعد */ }

  /* نصوص واتساب */
  const genericWaText = `مرحباً لوريت، أرغب بالاستفسار عن عرض ${p.title}`;
  const genericWaHref = waLink(advisor.intl, genericWaText);
  const waHrefForTier = (t) => waLink(
    advisor.intl,
    `مرحباً لوريت، أرغب بحجز عرض ${p.title} - خيار فندق ${t.hotel} بسعر ${t.price} ${currency}`,
  );
  const tierLabel = (t) => `${t.hotel}${t.room ? ` — ${t.room}` : ''}`;

  /* زر واتساب مع تتبع data-lead */
  const waButton = (href, label, tier = '') => (href
    ? `<a class="btn btn-wa" target="_blank" rel="noopener" href="${attr(href)}" data-lead${tier ? ` data-tier="${attr(tier)}"` : ''}>${icon('whatsapp', 16)} ${esc(label)}</a>`
    : '');

  /* 1) الشريط العلوي البسيط */
  const topBar = `
  <div class="omp-top">
    <a class="omp-top-brand" href="/">${esc(brand)}</a>
    <span class="omp-official">عرض رسمي</span>
    <a class="omp-top-home" href="/">الرئيسية</a>
  </div>`;

  /* 2) شريط الاستشاري/الفرع — يظهر فقط عند توفر ref صحيح أو branch صحيح */
  const advisorBar = (advisor.advisor || advisor.branchLabel) ? `
  <div class="omp-advisor">
    <div class="omp-advisor-info">
      <div class="omp-advisor-label">${advisor.advisor ? `مستشارك: ${esc(advisor.advisor.name)}` : esc(advisor.branchLabel)}</div>
      ${advisor.local ? `<div class="omp-advisor-sub">للتواصل الفوري: <span class="omp-num" dir="ltr">${esc(advisor.local)}</span></div>` : ''}
    </div>
    <div class="omp-advisor-actions">
      ${advisor.local ? `<a class="btn btn-ghost btn-sm" href="tel:${attr(advisor.local)}" dir="ltr">${icon('phone', 15)} ${esc(advisor.local)}</a>` : ''}
      ${waButton(genericWaHref, 'واتساب')}
    </div>
  </div>` : '';

  /* 3) الـHero بالبوستر */
  const poster = posterSrc(p);
  const posterMarkup = poster.kind === 'img'
    ? `<img src="${attr(poster.src)}" alt="بوستر عرض ${attr(p.title)}" fetchpriority="high" decoding="async">`
    : `<div class="omp-poster-fallback"><span>${esc(brand)}</span><b>${esc(p.title)}</b><span>عرض رسمي من لوريت</span></div>`;

  const barPrice = p.price_from
    ? `<span class="omp-bar-price"><small>يبدأ من</small><b>${esc(money(p.price_from, currency))}</b></span>`
    : `<span class="omp-bar-price"><b>السعر عند الطلب</b></span>`;

  /* 5) الشريط السفلي — ثابت ≤860px، وصف inline داخل الـhero على الشاشات الكبيرة */
  const ompBar = `
  <div class="omp-bar" role="region" aria-label="إجراءات سريعة للعرض">
    ${barPrice}
    ${waButton(genericWaHref, 'تواصل مع مستشار العرض عبر واتساب')}
    ${pdf ? `<a class="btn btn-ghost" href="${attr(pdf)}"${pdfInline ? '' : ' target="_blank" rel="noopener"'} download>تحميل الـPDF</a>` : ''}
  </div>`;

  const hero = `
  <section class="omp-hero">
    <figure class="omp-poster">${posterMarkup}</figure>
    <h1 class="omp-title">${esc(p.title)}</h1>
    ${duration ? `<div class="omp-duration">${icon('calendar', 15)} <span>${esc(duration)}</span></div>` : ''}
    <div class="omp-badges">
      <span class="omp-badge-price">${p.price_from ? `يبدأ من ${esc(money(p.price_from, currency))}` : 'السعر عند الطلب'}</span>
      ${soldOut ? '<span class="badge badge-danger">نفدت المقاعد</span>' : ''}
    </div>
    <p class="omp-note">${esc(PRICE_NOTE)}</p>
    ${ompBar}
  </section>`;

  /* 4أ) جدول/بطاقات الفنادق والأسعار */
  const tierCards = tiers.length ? tiers.map((t) => `
    <article class="omp-tier">
      <div class="omp-tier-top">
        <span class="omp-tier-hotel">${esc(t.hotel)}</span>
        ${t.stars ? `<span class="omp-tier-stars" role="img" aria-label="${t.stars} نجوم" title="${t.stars} نجوم">${'★'.repeat(t.stars)}</span>` : ''}
      </div>
      ${t.room ? `<span class="omp-tier-room">${esc(t.room)}</span>` : ''}
      <div class="omp-tier-price"><small>يبدأ من</small> <b>${esc(money(t.price, currency))}</b></div>
      ${t.notes ? `<p class="omp-tier-notes">${esc(t.notes)}</p>` : ''}
      ${waButton(waHrefForTier(t), 'احجز هذا الخيار عبر واتساب', tierLabel(t))}
    </article>`).join('')
    : `
    <article class="omp-tier">
      <span class="omp-tier-hotel">سعر العرض</span>
      <div class="omp-tier-price"><small>يبدأ من</small> <b>${esc(money(p.price_from, currency))}</b></div>
      ${waButton(genericWaHref, 'احجز عبر واتساب')}
    </article>`;

  const pricingSection = `
  <section class="omp-section" id="omp-pricing">
    <h2>الفنادق والأسعار</h2>
    <p class="omp-muted">اختر الخيار المناسب لك وابدأ الحجز مباشرة عبر واتساب مع مستشار العرض.</p>
    <div class="omp-tiers">${tierCards}</div>
  </section>`;

  /* 4أ-2) صندوق طلب فندق بديل — يفتح نفس نافذة الموقع الرئيسي */
  const inquirySection = `
  <section class="omp-section" id="omp-inquiry">
    <h2>تريد فندقاً آخر؟</h2>
    <p class="omp-muted">نفس العرض بفندق مختلف، أو تواريخ أخرى، أو عرض سعر لعائلة/مجموعة — اكتب طلبك ويصلك رد الفريق على واتساب.</p>
    <div class="omp-inquiry-actions">${inquiryButton(p, { variant: 'page', label: 'اطلب فندق آخر / استفسر' })}</div>
  </section>`;

  /* 4ب) خط السير الموجز — قابل للطي */
  const itinerarySection = itinerary.length ? `
  <details class="omp-section omp-itin">
    <summary>خط سير الرحلة (موجز)</summary>
    <ul class="timeline">${itinerary.map((step, i) => `<li><b>اليوم ${i + 1}</b><span>${esc(step)}</span></li>`).join('')}</ul>
  </details>` : '';

  /* 4ج) الكتالوج PDF — القسم فقط عند توفر رابط */
  const catalogSection = pdf ? `
  <section class="omp-section" id="omp-catalog">
    <h2>كتالوج البرنامج الكامل (PDF)</h2>
    <div class="omp-catalog-actions">
      ${pdfInline ? '<button type="button" class="btn btn-primary" id="ompPdfToggle" aria-expanded="false" aria-controls="ompPdfFrame">تصفح الكتالوج الآن داخل الصفحة</button>' : ''}
      <a class="btn btn-ghost" href="${attr(pdf)}"${pdfInline ? '' : ' target="_blank" rel="noopener"'} download>تحميل ملف البرنامج (PDF)</a>
    </div>
    ${pdfInline ? `<iframe id="ompPdfFrame" class="omp-pdf-frame" data-src="${attr(pdf)}" type="application/pdf" title="كتالوج البرنامج (PDF)" hidden></iframe>` : ''}
  </section>` : '';

  /* 4د) نموذج الطلب الرسمي المصغر */
  const tierOptions = tiers.map((t) => `<option value="${attr(tierLabel(t))}">${esc(tierLabel(t))}${t.price ? ` — ${esc(money(t.price, currency))}` : ''}</option>`).join('');
  const requestSection = `
  <section class="omp-section" id="omp-request">
    <h2>اطلب عرضاً رسمياً</h2>
    <p class="omp-muted">أرسل طلبك ويصلك عرض رسمي بالسعر النهائي والتوافر. هذا طلب عرض وليس حجزاً مؤكداً.</p>
    <form id="ompForm" class="omp-form" novalidate>
      <div class="omp-form-grid">
        <label class="omp-field"><span>الاسم الكامل <b class="req">*</b></span>
          <input class="omp-input" name="name" required autocomplete="name" placeholder="مثال: أحمد محمد">
        </label>
        <label class="omp-field"><span>رقم الهاتف / واتساب <b class="req">*</b></span>
          <input class="omp-input" name="phone" type="tel" required dir="ltr" autocomplete="tel" placeholder="0791234567">
        </label>
        <label class="omp-field"><span>البريد الإلكتروني (اختياري)</span>
          <input class="omp-input" name="email" type="email" dir="ltr" autocomplete="email" placeholder="name@example.com">
        </label>
        <label class="omp-field"><span>عدد المسافرين <b class="req">*</b></span>
          <input class="omp-input" name="adults" type="number" min="1" max="30" step="1" value="1" required inputmode="numeric">
        </label>
        ${tiers.length ? `
        <label class="omp-field"><span>خيار الفندق</span>
          <select class="omp-select" name="tier">${tierOptions}</select>
        </label>` : '<input type="hidden" name="tier" value="">'}
        <label class="omp-field omp-field-full"><span>ملاحظات</span>
          <textarea class="omp-textarea" name="notes" rows="3" placeholder="عدد المسافرين، التواريخ المفضلة، أي طلبات خاصة…"></textarea>
        </label>
      </div>
      <label class="check omp-consent">
        <input type="checkbox" name="consent" required>
        <span>${CONSENT_HTML}</span>
      </label>
      <button class="btn btn-primary btn-lg omp-submit" type="submit">أرسل طلب الحجز</button>
      <p class="field-hint" style="text-align:center;margin:8px 0 0">بإرسال الطلب تحصل على رقم مرجعي فوري، ويصل الطلب إلى فريق لوريت. الطلب ليس حجزًا مؤكدًا.</p>
      <p class="form-status" id="ompFormStatus" role="status" aria-live="polite"></p>
    </form>
  </section>`;

  const body = `${topBar}
  <main class="omp-page">
    ${advisorBar}
    ${hero}
    ${pricingSection}
    ${inquirySection}
    ${itinerarySection}
    ${catalogSection}
    ${requestSection}
  </main>`;

  /* JSON-LD واحد: Product/Offer */
  const ld = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: p.title,
    description: clampText(p.summary || p.title, 300),
    image: absUrl(ctx, poster.kind === 'img' ? poster.src : '/media/brand/og-default.jpg'),
    brand: { '@type': 'Brand', name: 'لوريت للسياحة والسفر' },
    offers: {
      '@type': 'Offer',
      price: p.price_from || 0,
      priceCurrency: 'JOD',
      availability: soldOut ? 'https://schema.org/SoldOut' : 'https://schema.org/InStock',
      url: `${ctx.baseUrl}/p/${p.slug}`,
    },
  };

  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#0B2A43">
<title>${esc(p.title)} | ${BRAND_TITLE_SUFFIX}</title>
<meta name="description" content="${attr(clampText(p.summary || `${p.title} — عرض رسمي من لوريت.`, 300))}">
<meta name="robots" content="index,follow">
<link rel="canonical" href="${attr(`${ctx.baseUrl}/p/${p.slug}`)}">
<link rel="icon" href="/media/brand/favicon-32.png" sizes="32x32" type="image/png">
<link rel="stylesheet" href="/assets/css/app.css?v=${ASSET_V}">
<style>
/* أنماط خاصة بهذه الصفحة فقط — القسم الكامل في app.css */
:root { --omp-bar-h: 66px; }
body.omp-body { padding-bottom: calc(var(--omp-bar-h) + env(safe-area-inset-bottom) + 12px); }
@media (min-width: 861px) { body.omp-body { padding-bottom: 0; } }
@media print { body.omp-body { padding-bottom: 0; } }
</style>
<script type="application/ld+json" nonce="${attr(ctx.nonce)}">${JSON.stringify(ld).replaceAll('<', '\\u003c')}</script>
</head>
<body class="omp-body">
${body}
${inquiryDialog(settings)}
<script src="/assets/js/inquiry-box.js?v=${ASSET_V}" nonce="${attr(ctx.nonce)}" defer></script>
<script nonce="${attr(ctx.nonce)}">
(function () {
  'use strict';
  var SLUG = ${jsonConst(p.slug)};
  var PATH = ${jsonConst(`/p/${slug}`)};
  var REF = ${jsonConst(advisor.ref)};
  var BRANCH = ${jsonConst(advisor.branch)};
  var WA_INTL = ${jsonConst(advisor.intl)};

  /* تتبع نقرات أي زر data-lead — fire-and-forget بلا منع السلوك الافتراضي */
  function trackLead(btn) {
    try {
      fetch('/api/track-event', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-requested-with': 'fetch' },
        body: JSON.stringify({ event: 'whatsapp_click', path: PATH, meta: { slug: SLUG, tier: btn.getAttribute('data-tier') || null } }),
      }).catch(function () {});
    } catch (e) { /* التتبع لا يكسر النقر أبداً */ }
  }
  document.addEventListener('click', function (e) {
    var btn = e.target && e.target.closest ? e.target.closest('[data-lead]') : null;
    if (btn) trackLead(btn);
  });

  /* عارض الكتالوج المدمج */
  var pdfToggle = document.getElementById('ompPdfToggle');
  var pdfFrame = document.getElementById('ompPdfFrame');
  if (pdfToggle && pdfFrame) {
    pdfToggle.addEventListener('click', function () {
      if (pdfFrame.hidden) {
        if (!pdfFrame.src) pdfFrame.src = pdfFrame.getAttribute('data-src') || '';
        pdfFrame.hidden = false;
        pdfToggle.textContent = 'إخفاء الكتالوج';
        pdfToggle.setAttribute('aria-expanded', 'true');
      } else {
        pdfFrame.hidden = true;
        pdfToggle.textContent = 'تصفح الكتالوج الآن داخل الصفحة';
        pdfToggle.setAttribute('aria-expanded', 'false');
      }
    });
  }

  /* نموذج الطلب الرسمي */
  var form = document.getElementById('ompForm');
  var status = document.getElementById('ompFormStatus');
  function setStatus(text, isError) {
    if (!status) return;
    status.textContent = text;
    status.className = isError ? 'form-status is-error' : 'form-status';
  }
  function renderSuccess(data) {
    var ref = String((data && data.reference) || '').trim();
    var box = document.createElement('div');
    box.className = 'omp-success';
    var h = document.createElement('h3');
    h.textContent = 'تم استلام طلبك بنجاح';
    box.appendChild(h);
    var p = document.createElement('p');
    p.className = 'omp-muted';
    p.textContent = ref ? 'احتفظ برقمك المرجعي لمتابعة طلبك:' : 'وصل طلبك إلى فريق لوريت، وسيتواصل معك مستشار العرض قريباً.';
    box.appendChild(p);
    if (ref) {
      var code = document.createElement('div');
      code.className = 'omp-ref';
      code.setAttribute('dir', 'ltr');
      code.textContent = ref;
      box.appendChild(code);
    }
    var row = document.createElement('div');
    row.className = 'btn-row omp-success-actions';
    if (WA_INTL) {
      var wa = document.createElement('a');
      wa.className = 'btn btn-wa';
      wa.target = '_blank';
      wa.rel = 'noopener';
      wa.setAttribute('data-lead', '');
      wa.href = 'https://wa.me/' + WA_INTL + '?text=' + encodeURIComponent('السلام عليكم، لدي طلب رقم ' + ref + ' وأرغب بمتابعته.');
      wa.textContent = 'متابعة عبر واتساب';
      row.appendChild(wa);
    }
    if (ref) {
      var tr = document.createElement('a');
      tr.className = 'btn btn-ghost';
      tr.href = '/track?reference=' + encodeURIComponent(ref);
      tr.textContent = 'متابعة الطلب';
      row.appendChild(tr);
    }
    box.appendChild(row);
    form.replaceWith(box);
    try { box.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (e) {}
  }
  if (form && status) {
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (typeof form.reportValidity === 'function' && !form.reportValidity()) return;
      var fd = new FormData(form);
      var consent = fd.get('consent') === 'on';
      if (!consent) { setStatus('يجب الموافقة على حفظ البيانات قبل إرسال الطلب.', true); return; }
      var submit = form.querySelector('.omp-submit');
      if (submit) submit.disabled = true;
      setStatus('', false);
      fetch('/api/public/offer-lead', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-requested-with': 'fetch' },
        body: JSON.stringify({
          slug: SLUG,
          ref: REF,
          branch: BRANCH,
          tier: String(fd.get('tier') || ''),
          adults: Math.max(1, Math.min(30, parseInt(fd.get('adults'), 10) || 1)),
          name: String(fd.get('name') || '').trim(),
          phone: String(fd.get('phone') || '').trim(),
          email: String(fd.get('email') || '').trim(),
          notes: String(fd.get('notes') || '').trim(),
          consent: true,
        }),
      })
        .then(function (r) { return r.json().catch(function () { return { ok: false }; }); })
        .then(function (data) {
          if (data && data.ok) renderSuccess(data);
          else throw new Error('rejected');
        })
        .catch(function () {
          if (submit) submit.disabled = false;
          setStatus('تعذر الإرسال الآن. تأكد من الاتصال وحاول مرة أخرى، أو تواصل مباشرة عبر واتساب.', true);
        });
    });
  }
})();
</script>
</body>
</html>`;
}
