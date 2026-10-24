import { esc, attr, money } from '../util.js';
import { artUrl } from '../art.js';
import { statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PUBLIC = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..', 'public');
const mtime = (file) => {
  try { return Math.round(statSync(join(PUBLIC, file)).mtimeMs).toString(36); } catch { return '1'; }
};
export const ASSET_V = `${mtime('assets/css/app.css')}-${mtime('assets/js/app.js')}-${mtime('assets/js/admin.js')}-${mtime('assets/js/account.js')}-${mtime('assets/data/phone-codes.json')}`;

export const ICONS = {
  plane: '<path d="M2.5 19l19-7-19-7 3.5 7L2.5 19z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M6 12h6" stroke="currentColor" stroke-width="1.7"/>',
  hotel: '<path d="M3 21V5a1 1 0 011-1h10a1 1 0 011 1v16M15 21V9h5a1 1 0 011 1v11M1 21h22" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><path d="M6 8h2M10 8h2M6 12h2M10 12h2M6 16h2M10 16h2M18 13h1M18 17h1" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>',
  kaaba: '<path d="M12 2l9 4.5v11L12 22 3 17.5v-11L12 2z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M3 6.5l9 4.5 9-4.5M12 11v11" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M6 15.5h12" stroke="currentColor" stroke-width="2.4"/>',
  visa: '<rect x="3" y="4" width="18" height="16" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M7 9h6M7 13h10M7 17h4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><circle cx="17" cy="9" r="2" fill="none" stroke="currentColor" stroke-width="1.5"/>',
  compass: '<circle cx="12" cy="12" r="9.2" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M15.5 8.5l-2 5-5 2 2-5 5-2z" fill="currentColor"/>',
  chat: '<path d="M21 12a8 8 0 01-8 8H8l-5 3 1.6-4.6A8 8 0 1121 12z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M8.5 11h7M8.5 14.5h4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>',
  phone: '<path d="M5 3h3l2 5-2.5 1.5a12 12 0 006 6L15 13l5 2v3a2 2 0 01-2.2 2A17 17 0 013 5.2 2 2 0 015 3z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>',
  whatsapp: '<path d="M12 3a9 9 0 00-7.7 13.6L3 21l4.5-1.2A9 9 0 1012 3z" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M8.8 8.3c.4 2.6 2.3 4.6 4.9 5.1l1.3-1.2 2 .9-.3 2c-2.9.6-6.9-2.4-8.2-5.6l-.6-1.9 1.7-.6 1 .9-.8 1.4" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>',
  arrow: '<path d="M14 6l-6 6 6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
  arrowBack: '<path d="M10 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
  check: '<path d="M4 12.5l5 5L20 6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>',
  star: '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1L3.2 9.5l6.1-.9L12 3z" fill="currentColor"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M8 3v4M16 3v4M3 10h18" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>',
  users: '<circle cx="9" cy="8" r="3.4" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M2.5 20c.6-4 3.2-6 6.5-6s5.9 2 6.5 6" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><path d="M16 5.2a3.2 3.2 0 010 5.8M17.5 14.4c2.4.6 3.8 2.4 4 5.6" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>',
  map: '<path d="M12 21s7-6 7-11a7 7 0 10-14 0c0 5 7 11 7 11z" fill="none" stroke="currentColor" stroke-width="1.7"/><circle cx="12" cy="10" r="2.6" fill="none" stroke="currentColor" stroke-width="1.7"/>',
  shield: '<path d="M12 3l7 3v6c0 4.6-3 8-7 9-4-1-7-4.4-7-9V6l7-3z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M9 12l2 2 4-4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
  spark: '<path d="M12 2l1.8 5.4L19 9l-5.2 1.6L12 16l-1.8-5.4L5 9l5.2-1.6L12 2z" fill="currentColor"/><path d="M18.5 14.5l.9 2.6 2.6.9-2.6.9-.9 2.6-.9-2.6-2.6-.9 2.6-.9.9-2.6z" fill="currentColor" opacity=".7"/>',
  guide: '<path d="M4 5.5A2.5 2.5 0 016.5 3H20v15H6.5A2.5 2.5 0 004 20.5V5.5z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M4 20.5A2.5 2.5 0 016.5 18H20v3H6.5A2.5 2.5 0 014 20.5z" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M8 8h8M8 11.5h5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
  clock: '<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M12 7v5.5l3.5 2" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>',
  info: '<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M12 11v5M12 8h.01" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  close: '<path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
};

export function icon(name, size = 20) {
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true" focusable="false">${ICONS[name] || ICONS.spark}</svg>`;
}

export const NAV = [
  { href: '/', label: 'الرئيسية' },
  { href: '/programs', label: 'البرامج السياحية' },
  { href: '/umrah', label: 'الحج والعمرة' },
  { href: '/flights', label: 'الطيران' },
  { href: '/hotels', label: 'الفنادق' },
  { href: '/visa', label: 'التأشيرات' },
  { href: '/account', label: 'حسابي' },
  { href: '/destinations', label: 'الوجهات' },
  { href: '/guide', label: 'دليل السفر' },
];

export const WA = (settings, text = 'السلام عليكم، أرغب بالاستفسار عن خدمات لوريت') => {
  const num = String(settings?.whatsapp || '').replace(/\D/g, '');
  return `https://wa.me/${num}?text=${encodeURIComponent(text)}`;
};

export function header(settings, path) {
  const links = NAV.map((item) => {
    const active = item.href === '/' ? path === '/' : path.startsWith(item.href);
    return `<a href="${attr(item.href)}"${active ? ' aria-current="page"' : ''}>${esc(item.label)}</a>`;
  }).join('');
  return `<header class="site-header" id="siteHeader">
  <div class="wrap header-inner">
    <a class="brand" href="/" aria-label="${attr(settings.brand)} — الصفحة الرئيسية">
      <span class="brand-mark" aria-hidden="true">ل</span>
      <span class="brand-text"><b>لوريت</b><span>للسياحة والسفر والحج والعمرة</span></span>
    </a>
    <button class="nav-toggle" id="navToggle" aria-label="فتح القائمة" aria-expanded="false" aria-controls="mainNav">${icon('menu', 22)}</button>
    <nav class="main-nav" id="mainNav" aria-label="التنقل الرئيسي">${links}</nav>
    <div class="header-actions">
      <a class="btn btn-ghost btn-sm header-track" href="/track"${path === '/track' ? ' aria-current="page"' : ''}>تتبع الطلب</a>
      <a class="btn btn-gold btn-sm" href="/consult">اطلب عرض سعر</a>
    </div>
  </div>
</header>`;
}

export function footer(settings) {
  const branches = (settings.branches || []).map((b) => `<li><b>${esc(b.name)}</b><br>${esc(b.address)}<br><a href="tel:${attr(String(b.phone).replace(/\s/g, ''))}" dir="ltr">${esc(b.phone)}</a></li>`).join('');
  const social = [
    settings.social?.facebook ? `<a href="${attr(settings.social.facebook)}" target="_blank" rel="noopener noreferrer" aria-label="فيسبوك">f</a>` : '',
    settings.social?.instagram ? `<a href="${attr(settings.social.instagram)}" target="_blank" rel="noopener noreferrer" aria-label="إنستغرام">◎</a>` : '',
  ].join('');
  return `<footer class="site-footer">
  <div class="wrap">
    <div class="footer-grid">
      <div class="footer-brand">
        <div class="brand" style="margin-bottom:14px">
          <span class="brand-mark" aria-hidden="true">ل</span>
          <span class="brand-text"><b style="color:#fff">لوريت</b><span style="color:rgba(255,255,255,.6)">للسياحة والسفر</span></span>
        </div>
        <p>${esc(settings.brand)} — خبرة في تنظيم رحلات الحج والعمرة والبرامج السياحية وتذاكر الطيران والفنادق والتأشيرات، من فرعي إربد وعمّان.</p>
        <div class="socials">${social}</div>
      </div>
      <div>
        <h4>خدماتنا</h4>
        <ul>
          <li><a href="/umrah">الحج والعمرة</a></li>
          <li><a href="/flights">طلب تذاكر طيران</a></li>
          <li><a href="/hotels">طلب حجز فندق</a></li>
          <li><a href="/visa">مركز التأشيرات</a></li>
          <li><a href="/programs">البرامج السياحية</a></li>
          <li><a href="/consult">اسأل خبير لوريت</a></li>
        </ul>
      </div>
      <div>
        <h4>معلومات</h4>
        <ul>
          <li><a href="/destinations">دليل الوجهات</a></li>
          <li><a href="/guide">دليل السفر والمقالات</a></li>
          <li><a href="/faq">الأسئلة الشائعة</a></li>
          <li><a href="/track">متابعة طلب</a></li>
          <li><a href="/about">عن لوريت</a></li>
          <li><a href="/admin">دخول الموظفين</a></li>
        </ul>
      </div>
      <div>
        <h4>تواصل معنا</h4>
        <ul>${branches}</ul>
      </div>
    </div>
    <div class="footer-bottom">
      <span>© ${new Date().getFullYear()} ${esc(settings.brand)} — جميع الحقوق محفوظة.</span>
      <span>الأسعار المنشورة «تبدأ من» وتتغير حسب الموسم والتوافر، والسعر المعتمد هو الصادر في عرض رسمي.</span>
    </div>
  </div>
</footer>`;
}

export function soundToggle() {
  return `<button class="sound-toggle" id="soundToggle" type="button" aria-pressed="true" aria-label="كتم المؤثرات الصوتية" title="المؤثرات الصوتية: مفعّلة">
  <svg class="ico-on" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor"/><path d="M16 8.5a5 5 0 010 7M18.5 6a8.5 8.5 0 010 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
  <svg class="ico-off" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor"/><path d="M16 9l6 6M22 9l-6 6" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/></svg>
</button>`;
}

export function floating(settings) {
  const wa = WA(settings);
  return `<div class="float-actions">
  <button class="fab fab-wa" type="button" data-wa data-wa-text="السلام عليكم، أرغب بالاستفسار عن خدمات لوريت" aria-label="تواصل عبر واتساب">${icon('whatsapp', 18)}<span>واتساب</span></button>
  <button class="fab fab-chat" type="button" id="chatOpen" aria-label="فتح مساعد لوريت" aria-expanded="false" aria-controls="chatPanel">${icon('chat', 18)}<span>مساعد لوريت</span></button>
</div>
<div class="chat-panel" id="chatPanel" role="dialog" aria-modal="false" aria-labelledby="chatTitle" hidden>
  <div class="chat-head">
    <span class="avatar" aria-hidden="true">ل</span>
    <div><b id="chatTitle">مساعد لوريت السياحي</b><span>يجيب من بيانات الموقع المنشورة · وفريقنا بانتظارك</span></div>
    <button class="chat-close" type="button" id="chatClose" aria-label="إغلاق المحادثة">×</button>
  </div>
  <div class="chat-body" id="chatBody" aria-live="polite"></div>
  <div class="chat-note">لا يخترع المساعد أسعارًا أو مواعيد، ويحوّلك لموظف عند نقص المعلومة.</div>
  <form class="chat-foot" id="chatForm" autocomplete="off">
    <label class="sr-only" for="chatInput">اكتب استفسارك</label>
    <input id="chatInput" name="message" placeholder="اكتب استفسارك…" maxlength="1000" required>
    <button type="submit">إرسال</button>
  </form>
</div>`;
}

export function layout({ settings, path, title, description, canonical, body, bodyClass = '', jsonLd = [], nonce = '', robots = 'index,follow', extraHead = '', offerData = null }) {
  const fullTitle = title ? `${title} | ${settings.brandShort || 'لوريت'}` : `${settings.brand} — ${settings.heroHeadline || 'رحلتك تبدأ مع لوريت'}`;
  const desc = description || settings.heroSub || '';
  const ld = jsonLd.filter(Boolean).map((obj) => `<script type="application/ld+json" nonce="${nonce}">${JSON.stringify(obj).replaceAll('<', '\\u003c')}</script>`).join('\n');
  const ogImage = `${artUrl('haram', 0)}`;
  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#0B2A43">
<title>${esc(fullTitle)}</title>
<meta name="description" content="${attr(desc)}">
<meta name="robots" content="${attr(robots)}">
${canonical ? `<link rel="canonical" href="${attr(canonical)}">` : ''}
<link rel="alternate" hreflang="ar" href="${attr(canonical || '/')}">
<meta property="og:type" content="website">
<meta property="og:locale" content="ar_JO">
<meta property="og:site_name" content="${attr(settings.brand)}">
<meta property="og:title" content="${attr(fullTitle)}">
<meta property="og:description" content="${attr(desc)}">
<meta property="og:image" content="${attr(ogImage)}">
${canonical ? `<meta property="og:url" content="${attr(canonical)}">` : ''}
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${attr(fullTitle)}">
<meta name="twitter:description" content="${attr(desc)}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/assets/css/app.css?v=${ASSET_V}">
<link rel="icon" href="/art/haram.svg?v=0" type="image/svg+xml">
<link rel="manifest" href="/site.webmanifest">
${extraHead}
${ld}
${trackingHead(settings, nonce)}
</head>
<body class="${attr(bodyClass)}">
${trackingBody(settings)}
<a class="skip-link" href="#main">تخطَّ إلى المحتوى</a>
${header(settings, path)}
<main id="main">
${body}
</main>
${footer(settings)}
${floating(settings)}
${soundToggle()}
${whatsappModal(settings)}
${offerDialog(offerData)}
${offerData ? `<script type="application/json" id="offersData" nonce="${nonce}">${JSON.stringify(offerData).replaceAll('<', '\\u003c')}</script>` : ''}
<div class="toast-stack" id="toastStack" aria-live="polite"></div>
<script src="/assets/js/app.js?v=${ASSET_V}" nonce="${nonce}" defer></script>
</body>
</html>`;
}

/* ---------- shared components ---------- */

export function breadcrumbs(items) {
  return `<ul class="breadcrumb">${items.map((it, i) => (i === items.length - 1
    ? `<li aria-current="page">${esc(it.label)}</li>`
    : `<li><a href="${attr(it.href)}">${esc(it.label)}</a></li>`)).join('')}</ul>`;
}

export function priceLabel(price, currency = 'د.أ') {
  if (!price) return '<small>السعر عند الطلب</small>';
  return `<small>يبدأ من</small><b>${esc(money(price, currency))}</b>`;
}

export function photoThumb(url) {
  const u = String(url || '');
  if (u.startsWith('/media/hero/') && u.endsWith('.jpg') && !u.endsWith('-thumb.jpg')) {
    return u.replace(/\.jpg$/, '-thumb.jpg');
  }
  return u;
}

export function programCard(p, { compact = false } = {}) {
  const badges = (p.badges || []).slice(0, 2).map((b) => `<span class="badge">${esc(b)}</span>`).join('');
  const soldOut = p.status === 'sold_out';
  const media = p.image_url ? photoThumb(p.image_url) : artUrl(p.art_key, (p.id || 0) % 4);
  return `<article class="card">
  <a class="card-media" href="/programs/${attr(p.slug)}" tabindex="-1" aria-hidden="true">
    <img src="${attr(media)}" alt="" loading="lazy" decoding="async" width="800" height="500">
  </a>
  <div class="card-badges">${soldOut ? '<span class="badge badge-danger">نفدت المقاعد</span>' : ''}${badges}</div>
  <div class="card-body">
    <span class="card-kicker">${esc(p.destination || '')}${compact ? '' : ` · ${esc(p.country || '')}`}</span>
    <h3 class="card-title"><a href="/programs/${attr(p.slug)}">${esc(p.title)}</a></h3>
    <div class="card-meta">
      ${p.days ? `<span>${icon('calendar', 15)} ${esc(p.days)} أيام / ${esc(p.nights)} ليالٍ</span>` : ''}
      ${p.meals ? `<span>${icon('hotel', 15)} ${esc(p.meals)}</span>` : ''}
      ${(p.hotels || [])[0]?.name ? `<span>${icon('map', 15)} ${esc((p.hotels || [])[0].name)}</span>` : ''}
    </div>
    <div class="card-foot">
      <span class="price">${priceLabel(p.price_from, p.currency)}</span>
      <a class="btn btn-quiet btn-sm" href="/programs/${attr(p.slug)}">التفاصيل</a>
    </div>
  </div>
</article>`;
}

export function offerThumb(o) {
  const url = String(o.image_url || '');
  if (url.startsWith('/media/offers/') && url.endsWith('.jpg') && !url.endsWith('-thumb.jpg')) {
    return url.replace(/\.jpg$/, '-thumb.jpg');
  }
  return url;
}

export function offerPosterCard(o, { rail = false } = {}) {
  const currency = o.currency || 'د.أ';
  const price = o.price_from ? `${Number(o.price_from).toLocaleString('en-US')} ${currency}` : 'السعر عند الطلب';
  const duration = o.days ? `${o.days} أيام / ${o.nights} ليالٍ` : '';
  const waText = `السلام عليكم، أرغب بالاستفسار عن العرض: ${o.title}${o.price_from ? ` — السعر المعلن ${price}` : ''}`;
  return `<article class="poster-card${rail ? ' is-rail' : ''}">
  <button class="poster-media" type="button" data-offer-open="${attr(o.slug)}" aria-label="عرض تفاصيل ${attr(o.title)}">
    <img src="${attr(offerThumb(o))}" alt="${attr(o.image_alt || o.title)}" loading="lazy" decoding="async" width="480" height="600">
    <span class="poster-price">${esc(price)}</span>
    ${duration ? `<span class="poster-duration">${esc(duration)}</span>` : ''}
    <span class="poster-zoom" aria-hidden="true">＋</span>
  </button>
  <div class="poster-body">
    <h3 class="poster-title"><button type="button" data-offer-open="${attr(o.slug)}">${esc(o.title)}</button></h3>
    ${o.body ? `<p class="poster-sub">${esc(o.body)}</p>` : ''}
    <div class="btn-row">
      <button class="btn btn-wa btn-sm" type="button" data-wa data-wa-text="${attr(waText)}">${icon('whatsapp', 16)} احجز عبر واتساب</button>
      <button class="btn btn-ghost btn-sm" type="button" data-offer-open="${attr(o.slug)}">التفاصيل</button>
    </div>
  </div>
</article>`;
}

export function offerCard(o) {
  return offerPosterCard(o);
}

export function whatsappModal(settings) {
  const groups = (settings.contactGroups || [])
    .filter((g) => !/الإدارة/.test(g.g))
    .sort((a, b) => {
      const rank = (g) => (/إربد/.test(g.g) ? 0 : /عمّان/.test(g.g) ? 1 : 2);
      return rank(a) - rank(b);
    })
    .map((g) => {
      const numbers = (g.items || []).map((item) => {
        const intl = String(item.p || '').replace(/\D/g, '');
        const local = intl.startsWith('962') ? `0${intl.slice(3)}` : intl;
        return `<a class="wa-number" href="https://wa.me/${attr(intl)}" target="_blank" rel="noopener noreferrer" data-wa-number="${attr(intl)}">
          <span class="wa-num-label">${esc(item.n || 'رقم')}</span>
          <span class="wa-num-value" dir="ltr">${esc(local)}</span>
        </a>`;
      }).join('');
      return `<div class="wa-group"><h4>${esc(g.g)}</h4><div class="wa-numbers">${numbers}</div></div>`;
    }).join('');

  const landlines = (settings.branches || []).map((b) => `<a href="tel:${attr(String(b.phone).replace(/[^\d+]/g, ''))}" class="wa-landline">${esc(b.name)}: <span dir="ltr">${esc(b.phone)}</span></a>`).join('');

  return `<div class="modal-backdrop" id="waModal" hidden>
  <div class="modal-card" role="dialog" aria-modal="true" aria-labelledby="waModalTitle">
    <button class="modal-close" type="button" data-wa-close aria-label="إغلاق">×</button>
    <h3 id="waModalTitle">اختر الفرع للتواصل عبر واتساب</h3>
    <p class="modal-sub">اختر الفرع الأقرب، وسيُفتح واتساب برسالة جاهزة تحمل تفاصيل طلبك.</p>
    <div class="wa-groups">${groups}</div>
    <div class="wa-footer">
      <span>هواتف الفروع:</span>${landlines}
    </div>
  </div>
</div>`;
}

export function offerDialog(offerData) {
  if (!offerData || !offerData.length) return '';
  return `<dialog class="offer-dialog" id="offerDialog" aria-labelledby="offerDialogTitle">
  <button class="dialog-close" type="button" data-offer-close aria-label="إغلاق">×</button>
  <div class="offer-dialog-grid">
    <figure class="offer-dialog-media"><img id="offerDialogImage" src="" alt="" width="900" height="1125"></figure>
    <div class="offer-dialog-body">
      <span class="card-kicker" id="offerDialogKicker"></span>
      <h3 id="offerDialogTitle"></h3>
      <p id="offerDialogText" class="muted"></p>
      <ul id="offerDialogIncludes" class="check-list"></ul>
      <div class="offer-dialog-price"><small>يبدأ من</small><b id="offerDialogPrice"></b></div>
      <div class="btn-row">
        <button class="btn btn-wa" type="button" data-wa id="offerDialogWa">${icon('whatsapp', 17)} احجز عبر واتساب</button>
        <a class="btn btn-ghost" id="offerDialogConsult" href="/consult">اطلب عرض سعر</a>
      </div>
      <p class="source-note">السعر المعلن «يبدأ من» ويختلف حسب التواريخ والغرف والتوافر؛ السعر المعتمد هو الصادر في عرض رسمي من لوريت.</p>
    </div>
  </div>
</dialog>`;
}

export function quoteCard(r) {
  const initials = String(r.name || '؟').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('');
  return `<figure class="quote">
  <div class="badge-row"><span class="badge badge-soft">${icon('star', 13)} مقتطف من Google</span></div>
  <blockquote><p>${esc(r.text)}</p></blockquote>
  <figcaption class="quote-who">
    <span class="avatar" aria-hidden="true">${esc(initials)}</span>
    <div><b>${esc(r.name)}</b><span>${esc(r.branch || '')}</span></div>
  </figcaption>
</figure>`;
}

export function newsItem(n) {
  return `<article class="acc-item">
  <details>
    <summary>${n.urgent ? '<span class="badge badge-danger">عاجل</span> ' : ''}${esc(n.title)}</summary>
    <div class="acc-body"><p class="source-note">${esc(n.airline || '')} · ${esc(n.published_at || '')}</p>${String(n.body || '').split('\n').map((line) => `<p>${esc(line)}</p>`).join('')}</div>
  </details>
</article>`;
}

export function faqItem(f) {
  return `<details class="acc-item" id="q-${attr(f.id)}">
  <summary>${esc(f.question)}</summary>
  <div class="acc-body"><p>${esc(f.answer)}</p></div>
</details>`;
}

export function articleCard(a) {
  return `<article class="card">
  <div class="card-body">
    <span class="card-kicker">${esc(a.category || 'دليل السفر')} · ${esc(a.reading_minutes || 4)} دقائق قراءة</span>
    <h3 class="card-title"><a href="/guide/${attr(a.slug)}">${esc(a.title)}</a></h3>
    <p class="muted" style="font-size:13.5px;margin:0">${esc(a.excerpt || '')}</p>
    <div class="card-foot"><span class="source-note">آخر تحديث: ${esc(a.updated_at || '')}</span><a class="link-more" href="/guide/${attr(a.slug)}">اقرأ المقال ›</a></div>
  </div>
</article>`;
}

export function statusPill(status, label) {
  return `<span class="status-dot status-${attr(status)}">${esc(label)}</span>`;
}

export function trackingFlags(settings) {
  const enabled = settings.trackingEnabled !== false;
  const pixel = String(settings.metaPixelId || '').trim();
  const gtm = String(settings.gtmId || '').trim();
  const ads = String(settings.googleAdsId || '').trim();
  return { enabled: enabled && !!(pixel || gtm || ads), pixel: !!pixel, gtm: !!gtm, ads: !!ads };
}

export function trackingHead(settings, nonce) {
  if (!trackingFlags(settings).enabled) return '';
  const pixel = String(settings.metaPixelId || '').trim();
  const gtm = String(settings.gtmId || '').trim();
  const ads = String(settings.googleAdsId || '').trim();
  const label = String(settings.googleAdsLabel || '').trim();
  return `<script nonce="${nonce}">
(function(){
  var PIXEL=${JSON.stringify(pixel)}, GTM=${JSON.stringify(gtm)}, ADS=${JSON.stringify(ads)}, LABEL=${JSON.stringify(label)};
  if (navigator.doNotTrack === '1') return;
  window.dataLayer = window.dataLayer || [];
  function gtag(){ window.dataLayer.push(arguments); }
  window.gtag = window.gtag || gtag;
  function fbq(){ fbq.callMethod ? fbq.callMethod.apply(fbq, arguments) : fbq.queue.push(arguments); }
  if (!window._fbq) window._fbq = fbq;
  fbq.push = fbq; fbq.loaded = true; fbq.version = '2.0'; fbq.queue = [];
  window.fbq = window.fbq || fbq;

  function inject(src){ var s=document.createElement('script'); s.async=true; s.src=src; document.head.appendChild(s); }
  function loadTags(){
    if (GTM) { window.dataLayer.push({'gtm.start': Date.now(), event:'gtm.js'}); inject('https://www.googletagmanager.com/gtm.js?id='+encodeURIComponent(GTM)); }
    if (ADS) { inject('https://www.googletagmanager.com/gtag/js?id='+encodeURIComponent(ADS)); gtag('js', new Date()); gtag('config', ADS); }
    if (PIXEL) { inject('https://connect.facebook.net/en_US/fbevents.js'); fbq('init', PIXEL); fbq('track','PageView'); }
  }
  function idle(fn){ if ('requestIdleCallback' in window) requestIdleCallback(fn,{timeout:2500}); else setTimeout(fn,1500); }
  if (document.readyState === 'complete') idle(loadTags);
  else window.addEventListener('load', function(){ idle(loadTags); }, {once:true});

  function beacon(event, type){
    try {
      var payload = JSON.stringify({event:event, type:type||'', path:location.pathname});
      if (navigator.sendBeacon) navigator.sendBeacon('/api/track-event', new Blob([payload], {type:'application/json'}));
    } catch(e) {}
  }

  window.loretTrack = function(name, params){
    params = params || {};
    var type = String(params.type || '');
    var value = Number(params.value) || 0;
    if (name === 'lead') {
      window.dataLayer.push({event:'generate_lead', lead_type:type, value:value, currency:'JOD'});
      if (window.fbq) { fbq('track','Lead',{content_category:type, value:value, currency:'JOD'}); fbq('trackCustom','SubmitApplication',{content_category:type}); }
      if (ADS) gtag('event','conversion',{send_to: ADS + (LABEL ? ('/'+LABEL) : ''), value:value, currency:'JOD'});
      beacon('lead', type);
    } else if (name === 'whatsapp') {
      window.dataLayer.push({event:'whatsapp_click', lead_type:type});
      if (window.fbq) fbq('track','Contact',{content_category:type});
      if (ADS) gtag('event','whatsapp_click',{lead_type:type});
      beacon('whatsapp_click', type);
    } else if (name === 'cta') {
      window.dataLayer.push({event:'cta_click', cta:type});
      beacon('cta_click', type);
    }
  };
  window.addEventListener('loret:lead', function(e){ window.loretTrack('lead', e.detail || {}); });
  window.addEventListener('loret:whatsapp', function(e){ window.loretTrack('whatsapp', e.detail || {}); });
  window.addEventListener('loret:cta', function(e){ window.loretTrack('cta', e.detail || {}); });
})();
</script>`;
}

export function trackingBody(settings) {
  if (!trackingFlags(settings).enabled) return '';
  const pixel = String(settings.metaPixelId || '').trim();
  const gtm = String(settings.gtmId || '').trim();
  return `${gtm ? `<noscript><iframe src="https://www.googletagmanager.com/ns.html?id=${encodeURIComponent(gtm)}" height="0" width="0" style="display:none;visibility:hidden" title="GTM"></iframe></noscript>` : ''}
${pixel ? `<noscript><img height="1" width="1" style="display:none" alt="" src="https://www.facebook.com/tr?id=${encodeURIComponent(pixel)}&ev=PageView&noscript=1"></noscript>` : ''}`;
}

/* Tiny, safe markdown renderer (escape first, then format). */
export function markdown(md) {
  const safe = esc(md || '');
  const lines = safe.split(/\r?\n/);
  const out = [];
  let inList = false;
  const closeList = () => { if (inList) { out.push('</ul>'); inList = false; } };
  for (const line of lines) {
    const t = line.trim();
    if (!t) { closeList(); continue; }
    if (t.startsWith('### ')) { closeList(); out.push(`<h3>${t.slice(4)}</h3>`); continue; }
    if (t.startsWith('## ')) { closeList(); out.push(`<h2>${t.slice(3)}</h2>`); continue; }
    if (t.startsWith('# ')) { closeList(); out.push(`<h2>${t.slice(2)}</h2>`); continue; }
    if (/^[-*•]\s+/.test(t)) {
      if (!inList) { out.push('<ul>'); inList = true; }
      out.push(`<li>${t.replace(/^[-*•]\s+/, '')}</li>`);
      continue;
    }
    closeList();
    out.push(`<p>${t}</p>`);
  }
  closeList();
  return out.join('\n');
}
