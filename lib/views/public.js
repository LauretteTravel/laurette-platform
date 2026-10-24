import { q, one } from '../db.js';
import { esc, attr, money, formatDate, clampText } from '../util.js';
import { artUrl, categoryArt } from '../art.js';
import { hydrateProgram, searchPrograms, programBySlug, STATUSES } from '../domain.js';
import { layout, breadcrumbs, programCard, offerCard, offerPosterCard, offerThumb, quoteCard, newsItem, faqItem, articleCard, icon, priceLabel, markdown, statusPill } from './layout.js';
import { flightForm, hotelForm, visaForm, consultForm, programRequestForm } from './forms.js';

const CATEGORY_LABEL = { umrah: 'الحج والعمرة', cruise: 'رحلات الكروز', sharm: 'شرم الشيخ', istanbul: 'إسطنبول' };

const LEVEL_LABEL = { eco: 'اقتصادي', 3: 'ثلاث نجوم', 4: 'أربع نجوم', 5: 'خمس نجوم' };

function levelLabel(program) {
  if (LEVEL_LABEL[program.level]) return LEVEL_LABEL[program.level];
  const stars = (program.hotels || []).find((h) => Number(h.stars) > 0)?.stars;
  if (stars) return `${'★'.repeat(Number(stars))} نجوم`;
  return 'برنامج عمرة';
}

function galleryKeys(program) {
  const extras = {
    umrah: ['madinah', 'hotel'],
    istanbul: ['hotel', 'plane'],
    sharm: ['hotel', 'plane'],
    cruise: ['istanbul', 'hotel'],
  }[program.category] || ['hotel', 'plane'];
  const keys = [program.art_key, ...extras.filter((k) => k !== program.art_key)].slice(0, 3);
  return keys.length < 3 ? [...keys, ...extras].slice(0, 3) : keys;
}

const setting = (db, key) => one(db, 'SELECT value FROM settings WHERE key = ?', [key])?.value;

export function getSettings(db) {
  const get = (k, fb = null) => {
    const row = one(db, 'SELECT value FROM settings WHERE key = ?', [k]);
    if (!row) return fb;
    try { return JSON.parse(row.value); } catch { return row.value; }
  };
  return {
    brand: get('brand', 'لوريت للسياحة والسفر'),
    brandShort: get('brandShort', 'لوريت'),
    whatsapp: get('whatsapp', ''),
    currency: get('currency', 'د.أ'),
    heroHeadline: get('heroHeadline', ''),
    heroSub: get('heroSub', ''),
    heroVideoUrl: get('heroVideoUrl', ''),
    heroPosterUrl: get('heroPosterUrl', ''),
    contactGroups: get('contactGroups', []),
    branches: get('branches', []),
    googleBranches: get('googleBranches', []),
    social: get('social', {}),
    ratingNote: get('ratingNote', ''),
    reviewsCheckedAt: get('reviewsCheckedAt', ''),
    visaDisclaimer: get('visaDisclaimer', ''),
    lastContentUpdate: get('lastContentUpdate', ''),
    metaPixelId: get('metaPixelId', ''),
    gtmId: get('gtmId', ''),
    googleAdsId: get('googleAdsId', ''),
    googleAdsLabel: get('googleAdsLabel', ''),
    trackingEnabled: get('trackingEnabled', true),
  };
}

function pageHead({ title, sub, crumbs, actions = '' }) {
  return `<section class="page-head"><div class="wrap">
    ${crumbs ? breadcrumbs(crumbs) : ''}
    <h1>${esc(title)}</h1>
    ${sub ? `<p>${esc(sub)}</p>` : ''}
    ${actions ? `<div class="btn-row mt-3">${actions}</div>` : ''}
  </div></section>`;
}

function sectionHead({ eyebrow, title, sub, href, linkLabel = 'عرض الكل' }) {
  return `<div class="section-head">
    <div>${eyebrow ? `<span class="eyebrow">${esc(eyebrow)}</span>` : ''}<h2>${esc(title)}</h2>${sub ? `<p>${esc(sub)}</p>` : ''}</div>
    ${href ? `<a class="link-more" href="${attr(href)}">${esc(linkLabel)} ›</a>` : ''}
  </div>`;
}

function emptyState(title, text, action = '') {
  return `<div class="empty"><b>${esc(title)}</b><p>${esc(text)}</p>${action}</div>`;
}

/* ============================ HOME ============================ */

export function homePage(ctx) {
  const { db, settings } = ctx;
  const featured = searchPrograms(db, { sort: 'recommended', limit: 8 });
  const umrah = searchPrograms(db, { category: 'umrah', sort: 'price', limit: 3 });
  const offers = q(db, "SELECT * FROM offers WHERE active = 1 ORDER BY featured DESC, sort ASC, id LIMIT 4");
  const allOffers = q(db, "SELECT * FROM offers WHERE active = 1 ORDER BY featured DESC, sort ASC, id");
  const offerData = allOffers.map((o) => ({
    slug: o.slug, title: o.title, price: o.price_from, currency: o.currency, days: o.days, nights: o.nights,
    category: o.category, body: o.body, image: o.image_url, thumb: offerThumb(o), alt: o.image_alt,
    includes: (() => { try { return JSON.parse(o.includes); } catch { return []; } })(),
  }));
  const news = q(db, 'SELECT * FROM news ORDER BY urgent DESC, published_at DESC LIMIT 4');
  const reviews = q(db, 'SELECT * FROM reviews WHERE visible = 1 ORDER BY id LIMIT 3');
  const articles = q(db, "SELECT * FROM articles WHERE status = 'published' ORDER BY published_at DESC LIMIT 3");
  const faqs = q(db, 'SELECT * FROM faq WHERE published = 1 ORDER BY sort LIMIT 6');
  const cities = q(db, "SELECT * FROM destinations WHERE kind = 'city' AND published = 1 ORDER BY sort LIMIT 6");
  const counts = {
    programs: one(db, "SELECT COUNT(*) n FROM programs WHERE status IN ('published','sold_out')").n,
    destinations: one(db, 'SELECT COUNT(*) n FROM destinations WHERE published = 1').n,
    reviews: one(db, 'SELECT COUNT(*) n FROM reviews WHERE visible = 1').n,
  };
  const tickerItems = news.map((n) => `<a href="/news#n-${n.id}">${n.urgent ? '🔴' : '✈'} ${esc(n.title)}</a>`).join('');

  const body = `
  <div class="ticker" aria-label="آخر أخبار الطيران"><div class="wrap ticker-inner">${tickerItems}${tickerItems}</div></div>

  <section class="hero">
    <div class="hero-art">
      ${settings.heroVideoUrl ? `<video class="hero-video" id="heroVideo" muted loop playsinline preload="none" aria-hidden="true" data-src="${attr(settings.heroVideoUrl)}" data-poster="${attr(settings.heroPosterUrl || artUrl('hero', 1))}"></video>` : ''}
      <img class="hero-poster" src="${attr(settings.heroPosterUrl || artUrl('hero', 1))}" alt="مشهد توضيحي لمآذن وقباب في ساعة الغروب" width="1920" height="1080" fetchpriority="high" decoding="async">
    </div>
    <div class="hero-blobs" aria-hidden="true">
      <span class="blob blob-1"></span>
      <span class="blob blob-2"></span>
      <span class="blob blob-3"></span>
      <span class="hero-ring"></span>
      <span class="hero-spark hero-spark-1"></span>
      <span class="hero-spark hero-spark-2"></span>
    </div>
    <div class="wrap hero-inner">
      <div class="hero-copy">
        <span class="eyebrow">✦ ${esc(settings.brand)}</span>
        <h1>العالم بين يديك... <em>وخبير سفرك معك في كل خطوة</em></h1>
        <p class="hero-sub">${esc(settings.heroSub || 'من تذاكر الطيران وحجوزات الفنادق إلى التأشيرات والبرامج السياحية، نساعدك على التخطيط لرحلتك المثالية بكل سهولة وثقة.')}</p>
        <div class="btn-row">
          <a class="btn btn-gold btn-lg" href="#services">ابدأ التخطيط</a>
          <button class="btn btn-ghost btn-lg" type="button" data-wa data-wa-text="السلام عليكم، أرغب بالتواصل مع مستشار سفر من لوريت">${icon('whatsapp', 18)} تحدث مع مستشار</button>
        </div>
        <div class="hero-stats">
          <div class="hero-stat"><b>${counts.programs}</b><span>برنامج منشور</span></div>
          <div class="hero-stat"><b>${counts.destinations}</b><span>وجهة ومدينة</span></div>
          <div class="hero-stat"><b>2</b><span>فرعان: إربد وعمّان</span></div>
          <div class="hero-stat"><b>${counts.reviews}</b><span>مراجعة على Google</span></div>
        </div>
      </div>
    </div>
  </section>

  <div class="wrap hero-search-wrap">
      <div class="search-card" id="services">
        <div class="service-tabs" role="tablist" aria-label="خدمات البحث">
          ${[
            ['programs', 'البرامج السياحية', 'compass'],
            ['flights', 'تذاكر الطيران', 'plane'],
            ['hotels', 'حجز الفنادق', 'hotel'],
            ['visa', 'التأشيرات', 'visa'],
            ['umrah', 'الحج والعمرة', 'kaaba'],
            ['consult', 'استشارة خبير', 'chat'],
          ].map(([k, l, ic], i) => `<button class="service-tab" role="tab" id="tab-${k}" aria-controls="panel-${k}" aria-selected="${i === 0}" tabindex="${i === 0 ? 0 : -1}" data-tab="${k}">${icon(ic, 16)} ${l}</button>`).join('')}
        </div>

        <form class="search-panel" role="tabpanel" id="panel-programs" aria-labelledby="tab-programs" action="/programs" method="get" data-cols="2">
          <div class="search-field"><label for="q-dest">إلى أين ترغب بالسفر؟</label><input id="q-dest" name="q" placeholder="مكة، إسطنبول، شرم الشيخ…" list="destList"><datalist id="destList">${cities.map((c) => `<option value="${attr(c.name)}">`).join('')}</datalist></div>
          <div class="search-field"><label for="q-cat">القسم</label><select id="q-cat" name="category"><option value="all">كل الأقسام</option>${Object.entries(CATEGORY_LABEL).map(([k, v]) => `<option value="${attr(k)}">${esc(v)}</option>`).join('')}</select></div>
          <button class="btn btn-primary" type="submit">ابحث عن برنامج</button>
        </form>

        <form class="search-panel" role="tabpanel" id="panel-flights" aria-labelledby="tab-flights" action="/flights" method="get" hidden>
          <div class="search-field"><label for="q-from">من</label><input id="q-from" name="origin" value="عمّان (AMM)" required></div>
          <div class="search-field"><label for="q-to">إلى</label><input id="q-to" name="destination" placeholder="إسطنبول (IST)" required></div>
          <div class="search-field"><label for="q-dep">تاريخ السفر</label><input id="q-dep" name="departDate" type="date"></div>
          <button class="btn btn-primary" type="submit">اطلب تذكرة</button>
        </form>

        <form class="search-panel" role="tabpanel" id="panel-hotels" aria-labelledby="tab-hotels" action="/hotels" method="get" hidden>
          <div class="search-field"><label for="q-city">المدينة</label><input id="q-city" name="city" placeholder="مكة المكرمة"></div>
          <div class="search-field"><label for="q-in">الدخول</label><input id="q-in" name="checkIn" type="date"></div>
          <div class="search-field"><label for="q-out">الخروج</label><input id="q-out" name="checkOut" type="date"></div>
          <button class="btn btn-primary" type="submit">اطلب فندقًا</button>
        </form>

        <form class="search-panel" role="tabpanel" id="panel-visa" aria-labelledby="tab-visa" action="/visa" method="get" hidden>
          <div class="search-field"><label for="q-nat">الجنسية</label><input id="q-nat" name="nationality" value="أردني"></div>
          <div class="search-field"><label for="q-visa-dest">الوجهة</label><select id="q-visa-dest" name="destination"><option>السعودية</option><option>تركيا</option><option>مصر</option><option>شنغن</option><option>الولايات المتحدة</option></select></div>
          <button class="btn btn-primary" type="submit">اعرف المتطلبات</button>
        </form>

        <form class="search-panel" role="tabpanel" id="panel-umrah" aria-labelledby="tab-umrah" action="/umrah" method="get" hidden>
          <div class="search-field"><label for="q-level">نوع البرنامج</label><select id="q-level" name="level"><option value="">كل البرامج</option><option value="eco">اقتصادي</option><option value="4">4 نجوم</option><option value="5">خمس نجوم VIP</option></select></div>
          <div class="search-field"><label for="q-pax">عدد المسافرين</label><input id="q-pax" name="pax" type="number" min="1" max="20" value="2"></div>
          <button class="btn btn-primary" type="submit">اعرض برامج العمرة</button>
        </form>

        <form class="search-panel" role="tabpanel" id="panel-consult" aria-labelledby="tab-consult" action="/consult" method="get" data-cols="2" hidden>
          <div class="search-field"><label for="q-topic">نوع الاستشارة</label><select id="q-topic" name="topic"><option value="trip">تخطيط رحلة</option><option value="visa">استشارة تأشيرة</option><option value="flight">حجز طيران</option><option value="hotel">اختيار فندق</option><option value="honeymoon">شهر عسل</option><option value="family">رحلة عائلية</option><option value="umrah">حج وعمرة</option><option value="general">استفسار عام</option></select></div>
          <div class="search-field"><label for="q-phone">رقم الهاتف</label><input id="q-phone" name="phone" type="tel" dir="ltr" placeholder="اختياري"></div>
          <button class="btn btn-primary" type="submit">اسأل خبيرًا</button>
        </form>
        <p class="search-hint">كل خدمة تعمل فعليًا: البحث يُرشّح برامجنا المنشورة، والطلبات تُحفظ برقم مرجعي وتظهر في لوحة الإدارة.</p>
      </div>
  </div>

  <section class="section" id="all-services">
    <div class="wrap">
      ${sectionHead({ eyebrow: 'خدمات لوريت', title: 'كل ما تحتاجه لرحلة متكاملة', sub: 'ست خدمات مترابطة، من الفكرة الأولى حتى العودة إلى البيت.' })}
      <div class="service-grid">
        ${[
          ['/umrah', 'kaaba', 'الحج والعمرة', 'برامج اقتصادية وخمس نجوم، فنادق قريبة من الحرمين، ومقارنة شفافة بين البرامج.'],
          ['/flights', 'plane', 'تذاكر الطيران', 'طلب عرض سعر لرحلة ذهاب أو ذهاب وعودة أو وجهات متعددة، مع مراجعة بشرية للتوافر.'],
          ['/hotels', 'hotel', 'حجز الفنادق', 'فنادق داخل برامجنا أو فندق تحدده أنت، مع مراجعة السعر والوجبات والموقع.'],
          ['/visa', 'visa', 'مركز التأشيرات', 'متطلبات موثّقة بمصادرها وتاريخ تحديثها، وطلب مراجعة ملفك قبل التقديم.'],
          ['/programs', 'compass', 'البرامج السياحية', 'تركيا، مصر، الكروز، والعمرة — بأسعار الشركة المنشورة وتفاصيل كاملة.'],
          ['/consult', 'chat', 'اسأل خبير لوريت', 'استشارة بشرية أو عبر المساعد الذكي، وتصل كتذكرة للقسم المختص.'],
        ].map(([href, ic, title, text]) => `<a class="service-tile" href="${attr(href)}">
          <span class="service-icon">${icon(ic, 22)}</span>
          <span><b>${esc(title)}</b><span>${esc(text)}</span></span>
        </a>`).join('')}
      </div>
    </div>
  </section>

  <section class="section section-sand">
    <div class="wrap">
      ${sectionHead({ eyebrow: 'مختارات لوريت', title: 'برامج يحبّها عملاؤنا', sub: 'كل برنامج هنا منشور بسعره الفعلي «يبدأ من» وتفاصيله الكاملة.', href: '/programs', linkLabel: 'كل البرامج' })}
      <div class="grid grid-4">
        ${featured.map((p) => programCard(p)).join('')}
      </div>
    </div>
  </section>

  <section class="section section-ink">
    <div class="wrap">
      <div class="split">
        <div>
          <span class="eyebrow">الحج والعمرة</span>
          <h2>إلى رحاب الحرمين… بترتيب يليق بالرحلة</h2>
          <p style="color:rgba(255,255,255,.78)">${one(db, "SELECT COUNT(*) n FROM programs WHERE category='umrah' AND status='published'").n} برنامج عمرة منشورًا: اقتصادي، أربع نجوم، وخمس نجوم VIP — مع تفاصيل الفنادق والمسافة إلى الحرم والرحلات والوجبات.</p>
          <div class="btn-row">
            <a class="btn btn-gold" href="/umrah">استعرض برامج العمرة</a>
            <a class="btn btn-ghost" href="/umrah#compare">قارن بين البرامج</a>
          </div>
        </div>
        <div class="stack">
          ${umrah.map((p) => `<a class="service-tile" href="/programs/${attr(p.slug)}" style="background:rgba(255,255,255,.06);border-color:rgba(255,255,255,.14);color:#fff">
            <span class="service-icon" style="background:rgba(217,163,74,.18);color:var(--gold-2)">${icon('kaaba', 20)}</span>
            <span><b style="color:#fff">${esc(p.title)}</b><span style="color:rgba(255,255,255,.7)">${esc(p.summary || '')}</span></span>
            <b style="color:var(--gold-2);margin-inline-start:auto;white-space:nowrap">${esc(money(p.price_from, p.currency))}</b>
          </a>`).join('')}
        </div>
      </div>
    </div>
  </section>

  <section class="section section-sand" id="offers">
    <div class="wrap">
      ${sectionHead({ eyebrow: 'عروض محدودة', title: 'عروض لوريت بالصور', sub: 'اختر العرض واضغط على البوستر لعرض التفاصيل والبرنامج الشامل والسعر، ثم احجز عبر واتساب أو اطلب عرض سعر.', href: '/offers', linkLabel: 'كل العروض' })}
      ${offers.length ? `<div class="poster-grid">${offers.map((o) => offerPosterCard(o)).join('')}</div>` : emptyState('لا توجد عروض منشورة الآن', 'تابعنا على واتساب لتصلك العروض الجديدة أولًا.')}
    </div>
  </section>

  <section class="section section-sand">
    <div class="wrap">
      ${sectionHead({ eyebrow: 'لماذا لوريت', title: 'خبرة تُشبه الاطمئنان', sub: 'لا نبيع تذكرة فقط، بل نرافقك من أول سؤال حتى آخر خطوة في الرحلة.' })}
      <div class="grid grid-4">
        ${[
          ['shield', 'تأشيرات بإجراء واضح', 'مراجعة مستنداتك قبل التقديم، وتوضيح الرسوم والمتطلبات قبل أي التزام.'],
          ['hotel', 'فنادق مختارة', 'المسافة إلى الحرم، الوجبات، وتصنيف الفندق مذكورة بوضوح لا بعبارات عامة.'],
          ['plane', 'تذاكر بمراجعة بشرية', 'لا نعرض سعرًا تقديريًا؛ يصلك عرض فعلي من شركة الطيران بعد المراجعة.'],
          ['phone', 'دعم من فرعين', 'إربد وعمّان، وأرقام مباشرة لفريق الحج والعمرة والطيران.'],
        ].map(([ic, t, d]) => `<div class="quote">
          <span class="service-icon">${icon(ic, 22)}</span>
          <b style="color:var(--navy);font-size:15.5px">${esc(t)}</b>
          <p>${esc(d)}</p>
        </div>`).join('')}
      </div>
    </div>
  </section>

  <section class="section">
    <div class="wrap">
      ${sectionHead({ eyebrow: 'آراء العملاء', title: 'مقتطفات من مراجعات Google', sub: settings.ratingNote || 'مقتطفات كما ظهرت عند آخر تحقق.', href: '/faq', linkLabel: 'الأسئلة الشائعة' })}
      ${reviews.length ? `<div class="quote-grid">${reviews.map((r) => quoteCard(r)).join('')}</div>
        <p class="source-note mt-2">آخر تحقق من المراجعات: ${esc(settings.reviewsCheckedAt || '—')} · ${(settings.googleBranches || []).map((b) => `${esc(b.name)}: ${esc(b.rating)} (${esc(b.count)})`).join(' · ')}</p>`
        : emptyState('لا توجد مراجعات منشورة', 'يمكن للفريق إضافة مقتطفات موثقة من Google من لوحة الإدارة.')}
    </div>
  </section>

  <section class="section section-sand">
    <div class="wrap">
      ${sectionHead({ eyebrow: 'أخبار الطيران', title: 'تعاميم وتحديثات تهم المسافر', sub: 'تصدر عن شركات الطيران وتُحدَّث يدويًا من لوحة الإدارة.', href: '/news', linkLabel: 'كل الأخبار' })}
      <div class="accordion">${news.map((n) => newsItem(n)).join('')}</div>
    </div>
  </section>

  <section class="section">
    <div class="wrap">
      ${sectionHead({ eyebrow: 'دليل السفر', title: 'اقرأ قبل أن تحجز', sub: 'مقالات عملية عن التوقيت، الفنادق، الحقائب، والتأشيرات.', href: '/guide', linkLabel: 'كل المقالات' })}
      ${articles.length ? `<div class="grid grid-3">${articles.map((a) => articleCard(a)).join('')}</div>` : emptyState('المحتوى قيد الإعداد', 'نعمل على إضافة أدلة السفر.')}
    </div>
  </section>

  <section class="section section-sand">
    <div class="wrap">
      ${sectionHead({ eyebrow: 'أسئلة شائعة', title: 'إجابات سريعة قبل التواصل', href: '/faq', linkLabel: 'كل الأسئلة' })}
      <div class="accordion">${faqs.map((f) => faqItem(f)).join('')}</div>
    </div>
  </section>

  <section class="section-tight">
    <div class="wrap">
      <div class="cta-band">
        <div><h2>جاهز لرحلتك القادمة؟</h2><p>أرسل تفاصيل رحلتك، ويصلك عرض رسمي من خبير لوريت مع رقم مرجعي للمتابعة.</p></div>
        <div class="btn-row"><a class="btn btn-gold btn-lg" href="/consult">اطلب استشارة</a><a class="btn btn-ghost btn-lg" href="/programs">تصفح البرامج</a></div>
      </div>
    </div>
  </section>`;

  return layout({
    settings, path: '/', nonce: ctx.nonce,
    title: 'لوريت للسياحة والسفر — برامج سياحية وحج وعمرة وتذاكر وتأشيرات',
    description: 'من تذاكر الطيران وحجوزات الفنادق إلى التأشيرات وبرامج الحج والعمرة، يخطط فريق لوريت رحلتك من إربد وعمّان ويعود إليك بعرض رسمي.',
    canonical: ctx.baseUrl,
    body,
    offerData,
    jsonLd: [
      {
        '@context': 'https://schema.org', '@type': 'TravelAgency',
        name: 'لوريت للسياحة والسفر والحج والعمرة',
        url: ctx.baseUrl,
        image: `${ctx.baseUrl}${artUrl('haram', 1)}`,
        telephone: '+962 79 119 3888',
        priceRange: 'د.أ',
        address: (settings.branches || []).map((b) => ({ '@type': 'PostalAddress', streetAddress: b.address, addressLocality: b.name.replace('فرع ', ''), addressCountry: 'JO' })),
        areaServed: 'JO',
        sameAs: [settings.social?.facebook, settings.social?.instagram].filter(Boolean),
      },
      {
        '@context': 'https://schema.org', '@type': 'WebSite', name: 'لوريت للسياحة والسفر', url: ctx.baseUrl,
        potentialAction: { '@type': 'SearchAction', target: `${ctx.baseUrl}/programs?q={search_term_string}`, 'query-input': 'required name=search_term_string' },
      },
      faqs.length ? {
        '@context': 'https://schema.org', '@type': 'FAQPage',
        mainEntity: faqs.map((f) => ({ '@type': 'Question', name: f.question, acceptedAnswer: { '@type': 'Answer', text: f.answer } })),
      } : null,
    ],
  });
}

/* ============================ PROGRAMS ============================ */

export function programsPage(ctx) {
  const { db, settings, query } = ctx;
  const category = String(query.category || 'all');
  const list = searchPrograms(db, {
    category,
    q: query.q,
    maxPrice: query.maxPrice,
    minDays: query.minDays,
    maxDays: query.maxDays,
    sort: query.sort,
    limit: 120,
  });
  const counts = Object.fromEntries(q(db, "SELECT category, COUNT(*) n FROM programs WHERE status IN ('published','sold_out') GROUP BY category").map((r) => [r.category, r.n]));
  const total = Object.values(counts).reduce((a, b) => a + b, 0);

  const body = `
  ${pageHead({
    title: 'البرامج السياحية',
    sub: 'برامج لوريت المنشورة بأسعارها وتفاصيلها: الحج والعمرة، تركيا، مصر، ورحلات الكروز. اختر وجهتك وسنكمل الباقي معك.',
    crumbs: [{ href: '/', label: 'الرئيسية' }, { label: 'البرامج السياحية' }],
  })}
  <section class="section-tight">
    <div class="wrap">
      <div class="chips mb-3" role="group" aria-label="تصفية الأقسام">
        <a class="chip ${category === 'all' ? 'is-active' : ''}" href="/programs">كل الأقسام <span class="muted">(${total})</span></a>
        ${Object.entries(CATEGORY_LABEL).map(([k, l]) => `<a class="chip ${category === k ? 'is-active' : ''}" href="/programs?category=${attr(k)}">${esc(l)} <span class="muted">(${counts[k] || 0})</span></a>`).join('')}
      </div>

      <form class="filters" method="get" action="/programs" role="search">
        <input type="hidden" name="category" value="${attr(category)}">
        <div class="field"><label for="f-q">بحث</label><input id="f-q" name="q" value="${attr(query.q || '')}" placeholder="وجهة أو اسم برنامج"></div>
        <div class="field"><label for="f-price">الميزانية القصوى (للشخص)</label><input id="f-price" name="maxPrice" type="number" min="0" step="50" value="${attr(query.maxPrice || '')}" placeholder="مثال: 800"></div>
        <div class="field"><label for="f-days">مدة الرحلة (أيام)</label><select id="f-days" name="maxDays"><option value="">أي مدة</option>${[4, 5, 8, 10, 12].map((d) => `<option value="${d}" ${String(query.maxDays) === String(d) ? 'selected' : ''}>حتى ${d} أيام</option>`).join('')}</select></div>
        <div class="field"><label for="f-sort">الترتيب</label><select id="f-sort" name="sort"><option value="recommended">الأنسب</option><option value="price" ${query.sort === 'price' ? 'selected' : ''}>الأقل سعرًا</option><option value="priceDesc" ${query.sort === 'priceDesc' ? 'selected' : ''}>الأعلى سعرًا</option><option value="duration" ${query.sort === 'duration' ? 'selected' : ''}>الأطول مدة</option></select></div>
        <button class="btn btn-primary" type="submit">تصفية</button>
      </form>

      <div class="section-head mt-4" style="margin-bottom:18px">
        <div><h2 style="font-size:20px">${list.length} برنامج${query.q ? ` يطابق «${esc(query.q)}»` : ''}</h2></div>
        <a class="link-more" href="/consult">لم تجد ما يناسبك؟ اطلب برنامجًا مخصصًا ›</a>
      </div>

      ${list.length ? `<div class="grid grid-3">${list.map((p) => programCard(p)).join('')}</div>` : emptyState('لا توجد برامج مطابقة', 'جرّب توسيع الميزانية أو اختيار قسم آخر، أو اطلب برنامجًا مخصصًا من خبير لوريت.', '<a class="btn btn-gold mt-2" href="/consult">اطلب برنامجًا مخصصًا</a>')}
    </div>
  </section>

  <section class="section section-sand">
    <div class="wrap">
      ${sectionHead({ eyebrow: 'اختيار أسرع', title: 'دعنا نرشّح لك البرنامج المناسب', sub: 'خمسة أسئلة قصيرة، وترشيحات من برامجنا المنشورة فقط.' })}
      <div class="panel" data-quiz>
        <form id="quizForm" class="stack">
          <div class="form-grid-3">
            <div class="field"><label for="qz-budget">ميزانيتك للشخص (د.أ)</label><input id="qz-budget" name="budget" type="number" min="100" step="50" placeholder="مثال: 600"></div>
            <div class="field"><label for="qz-pax">عدد المسافرين</label><input id="qz-pax" name="pax" type="number" min="1" max="20" value="2"></div>
            <div class="field"><label for="qz-month">شهر السفر</label><input id="qz-month" name="month" type="month"></div>
            <div class="field"><label for="qz-style">تفضيلك</label><select id="qz-style" name="style"><option value="sea">البحر</option><option value="nature">الطبيعة</option><option value="city">المدن</option><option value="culture">الثقافة والتاريخ</option><option value="shopping">التسوق</option></select></div>
            <div class="field"><label for="qz-trip">نوع الرحلة</label><select id="qz-trip" name="trip"><option value="family">عائلية</option><option value="honeymoon">شهر عسل</option><option value="umrah">عمرة</option><option value="friends">أصدقاء</option><option value="solo">فردية</option></select></div>
            <div class="field" style="justify-content:end"><button class="btn btn-primary" type="submit">اقترح برامج</button></div>
          </div>
        </form>
        <div id="quizResults" class="mt-3" aria-live="polite"></div>
      </div>
    </div>
  </section>`;

  return layout({
    settings, path: '/programs', nonce: ctx.nonce,
    title: query.q ? `برامج سياحية: ${query.q}` : 'البرامج السياحية — أسعار وتفاصيل',
    description: 'استعرض برامج لوريت السياحية (الحج والعمرة، تركيا، مصر، الكروز) بأسعارها المنشورة وتفاصيل الإقامة والرحلات، واطلب عرض سعر رسمي.',
    canonical: `${ctx.baseUrl}/programs${category !== 'all' ? `?category=${category}` : ''}`,
    body,
    jsonLd: [{
      '@context': 'https://schema.org', '@type': 'ItemList',
      itemListElement: list.slice(0, 20).map((p, i) => ({ '@type': 'ListItem', position: i + 1, url: `${ctx.baseUrl}/programs/${p.slug}`, name: p.title })),
    }, {
      '@context': 'https://schema.org', '@type': 'BreadcrumbList',
      itemListElement: [{ '@type': 'ListItem', position: 1, name: 'الرئيسية', item: ctx.baseUrl }, { '@type': 'ListItem', position: 2, name: 'البرامج السياحية', item: `${ctx.baseUrl}/programs` }],
    }],
  });
}

export function programPage(ctx, slug) {
  const { db, settings } = ctx;
  const p = programBySlug(db, slug);
  if (!p || p.status === 'archived') return null;
  const related = q(db, `SELECT * FROM programs WHERE category = ? AND slug <> ? AND status IN ('published','sold_out') ORDER BY featured DESC, price_from ASC LIMIT 3`, [p.category, p.slug]).map(hydrateProgram);
  const isUmrah = p.category === 'umrah';
  const options = (p.options || []).filter((o) => Number(o.price) > 0);
  const galleryItems = p.image_url
    ? [{ src: p.image_url, alt: p.title }, ...galleryKeys(p).slice(0, 2).map((key) => ({ src: artUrl(key, 2), alt: '' }))]
    : galleryKeys(p).map((key, i) => ({ src: artUrl(key, i + 1), alt: i === 0 ? p.title : '' }));
  const waText = `السلام عليكم، أود الاستفسار عن برنامج: ${p.title}\n${p.days ? `${p.days} أيام / ${p.nights} ليالٍ` : ''}\n${p.price_from ? `السعر المعروض يبدأ من ${p.price_from} ${p.currency}` : ''}`;
  const waHref = `https://wa.me/${String(settings.whatsapp).replace(/\D/g, '')}?text=${encodeURIComponent(waText)}`;
  const body = `
  <section class="page-head">
    <div class="wrap">
      ${breadcrumbs([{ href: '/', label: 'الرئيسية' }, { href: '/programs', label: 'البرامج السياحية' }, { label: p.title }])}
      <h1>${esc(p.title)}</h1>
      <p>${esc(p.summary || '')}</p>
      <div class="btn-row mt-3">
        ${p.days ? `<span class="badge badge-ink">${icon('calendar', 14)} ${esc(p.days)} أيام / ${esc(p.nights)} ليالٍ</span>` : ''}
        ${p.destination ? `<span class="badge badge-ink">${icon('map', 14)} ${esc(p.destination)}</span>` : ''}
        ${p.status === 'sold_out' ? '<span class="badge badge-danger">نفدت المقاعد</span>' : ''}
      </div>
    </div>
  </section>

  <section class="section-tight">
    <div class="wrap">
      <div class="split">
        <div class="stack">
          <div class="gallery">
            ${galleryItems.map((item, i) => `<img src="${attr(item.src)}" alt="${attr(item.alt)}" width="800" height="600" ${i === 0 ? 'fetchpriority="high"' : 'loading="lazy"'} decoding="async">`).join('')}
          </div>

          <div class="panel">
            <h2 style="font-size:20px">تفاصيل البرنامج</h2>
            <ul class="fact-list">
              ${p.days ? `<li><span>المدة</span><b>${esc(p.days)} أيام / ${esc(p.nights)} ليالٍ</b></li>` : ''}
              ${p.mode ? `<li><span>نوع الرحلة</span><b>${esc({ air: 'جوي', bus: 'بري (حافلات)', sea: 'بحري' }[p.mode] || p.mode)}</b></li>` : ''}
              ${p.route ? `<li><span>المسار</span><b>${esc({ both: 'مكة والمدينة', makkah: 'مكة المكرمة فقط', madinah: 'المدينة المنورة فقط' }[p.route] || p.route)}</b></li>` : ''}
              ${p.level ? `<li><span>مستوى البرنامج</span><b>${esc(levelLabel(p))}</b></li>` : ''}
              ${p.airline ? `<li><span>شركة الطيران</span><b>${esc(p.airline)}</b></li>` : ''}
              ${p.meals ? `<li><span>الوجبات</span><b>${esc(p.meals)}</b></li>` : ''}
              ${p.departure_dates ? `<li><span>مواعيد المغادرة</span><b>${esc(p.departure_dates)}</b></li>` : ''}
              <li><span>حالة البرنامج</span><b>${p.status === 'sold_out' ? 'نفدت المقاعد — يمكنك طلب البديل' : 'متاح للطلب'}</b></li>
            </ul>
            ${(p.badges || []).length ? `<div class="badge-row mt-2">${p.badges.map((b) => `<span class="badge badge-soft">${esc(b)}</span>`).join('')}</div>` : ''}
          </div>

          ${(p.hotels || []).length ? `<div class="panel">
            <h2 style="font-size:20px">الإقامة والفنادق</h2>
            <div class="table-wrap"><table class="table-small">
              <thead><tr><th>المدينة</th><th>الفندق</th><th>التصنيف</th><th>المسافة / ملاحظة</th></tr></thead>
              <tbody>${p.hotels.map((h) => `<tr><td>${esc(h.city)}</td><td>${esc(h.name)}</td><td>${h.stars ? `${'★'.repeat(Number(h.stars))}` : 'إيواء سياحي'}</td><td>${esc(h.distance || '—')}</td></tr>`).join('')}</tbody>
            </table></div>
            <p class="field-hint mt-2">الفنادق المذكورة هي المذكورة في البرنامج المنشور؛ أي تغيير يُعرض عليك قبل التأكيد.</p>
          </div>` : ''}

          ${(p.itinerary || []).length ? `<div class="panel">
            <h2 style="font-size:20px">خط سير الرحلة</h2>
            <ul class="timeline">${p.itinerary.map((step, i) => `<li><b>اليوم ${i + 1}</b><span>${esc(step)}</span></li>`).join('')}</ul>
          </div>` : ''}

          ${(p.flights || []).length ? `<div class="panel">
            <h2 style="font-size:20px">جدول الرحلات الجوية</h2>
            <div class="table-wrap"><table class="table-small"><tbody>${p.flights.map((f) => `<tr><td>${esc(f)}</td></tr>`).join('')}</tbody></table></div>
            <p class="field-hint mt-2">أرقام الرحلات وأوقاتها كما وردت في البرنامج، وتُثبَّت عند إصدار التذكرة.</p>
          </div>` : ''}

          <div class="split-even grid">
            <div class="panel">
              <h3 style="font-size:17px;color:var(--ok)">${icon('check', 18)} المشمول</h3>
              <ul style="font-size:13.5px;color:#334E63">${(p.includes || []).map((x) => `<li>${esc(x)}</li>`).join('') || '<li>—</li>'}</ul>
            </div>
            <div class="panel">
              <h3 style="font-size:17px;color:var(--danger)">غير المشمول</h3>
              <ul style="font-size:13.5px;color:#334E63">${(p.excludes || []).map((x) => `<li>${esc(x)}</li>`).join('') || '<li>—</li>'}</ul>
            </div>
          </div>

          ${(p.terms || []).length ? `<div class="panel">
            <h2 style="font-size:20px">شروط الحجز والإلغاء</h2>
            <div class="accordion">${p.terms.map((t, i) => `<details class="acc-item"><summary>الشرط ${i + 1}</summary><div class="acc-body"><p>${esc(t)}</p></div></details>`).join('')}</div>
          </div>` : ''}

          <div class="panel" id="request">
            <h2 style="font-size:20px">اطلب هذا البرنامج</h2>
            <p class="muted" style="font-size:13.5px">أرسل طلبك، ويصلك عرض رسمي بالسعر النهائي والتوافر. هذا طلب عرض سعر وليس حجزًا مؤكدًا.</p>
            ${programRequestForm(p, isUmrah ? 'umrah' : 'program')}
          </div>
        </div>

        <aside class="stack sticky-side">
          <div class="panel">
            <span class="card-kicker">السعر المنشور</span>
            <div class="price" style="margin:6px 0 12px">${priceLabel(p.price_from, p.currency)}</div>
            ${options.length ? `<div class="table-wrap"><table class="table-small"><thead><tr><th>الخيار</th><th>للشخص</th></tr></thead><tbody>
              ${options.map((o) => `<tr><td>${esc(o.label)}</td><td class="price-cell">${esc(money(o.price, p.currency))}</td></tr>`).join('')}
            </tbody></table></div>` : ''}
            <p class="field-hint mt-2">الأسعار للشخص الواحد وتختلف حسب نوع الغرفة والموسم. السعر المعتمد هو الصادر في العرض الرسمي.</p>
            <div class="btn-row mt-3">
              <a class="btn btn-primary btn-block" href="#request">اطلب عرض سعر</a>
              <button class="btn btn-wa btn-block" type="button" data-wa data-wa-text="${attr(waText)}">${icon('whatsapp', 17)} استفسر عبر واتساب</button>
            </div>
          </div>
          <div class="panel panel-quiet">
            <h3 style="font-size:16px">تحتاج مساعدة؟</h3>
            <p style="font-size:13px;margin-bottom:12px">اتصل بفريق لوريت أو تحدث مع المساعد الذكي؛ سيحوّلك لموظف عند الحاجة.</p>
            <div class="btn-row">
              <a class="btn btn-ghost btn-sm" href="tel:+962791193888" dir="ltr">+962 79 119 3888</a>
              <button class="btn btn-gold btn-sm" type="button" data-open-chat>${icon('chat', 16)} مساعد لوريت</button>
            </div>
          </div>
        </aside>
      </div>

      ${related.length ? `<div class="mt-4">
        ${sectionHead({ eyebrow: 'برامج مشابهة', title: 'قد يناسبك أيضًا', href: `/programs?category=${attr(p.category)}` })}
        <div class="grid grid-3">${related.map((r) => programCard(r)).join('')}</div>
      </div>` : ''}
    </div>
  </section>`;

  return layout({
    settings, path: '/programs', nonce: ctx.nonce,
    title: p.title,
    description: clampText(p.summary || `${p.title} — ${p.days} أيام / ${p.nights} ليالٍ، يبدأ من ${p.price_from} ${p.currency}.`, 300),
    canonical: `${ctx.baseUrl}/programs/${p.slug}`,
    body,
    jsonLd: [
      {
        '@context': 'https://schema.org',
        '@type': 'Product',
        name: p.title,
        description: clampText(p.summary || p.title, 300),
        image: `${ctx.baseUrl}${artUrl(p.art_key, 1)}`,
        brand: { '@type': 'Brand', name: 'لوريت للسياحة والسفر' },
        category: CATEGORY_LABEL[p.category] || p.category,
        offers: p.price_from ? {
          '@type': 'Offer', price: p.price_from, priceCurrency: 'JOD',
          availability: p.status === 'sold_out' ? 'https://schema.org/SoldOut' : 'https://schema.org/InStock',
          url: `${ctx.baseUrl}/programs/${p.slug}`,
        } : undefined,
      },
      {
        '@context': 'https://schema.org', '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'الرئيسية', item: ctx.baseUrl },
          { '@type': 'ListItem', position: 2, name: 'البرامج السياحية', item: `${ctx.baseUrl}/programs` },
          { '@type': 'ListItem', position: 3, name: p.title, item: `${ctx.baseUrl}/programs/${p.slug}` },
        ],
      },
    ],
  });
}

/* ============================ UMRAH ============================ */

export function umrahPage(ctx) {
  const { db, settings, query } = ctx;
  const level = String(query.level || '');
  const all = q(db, "SELECT * FROM programs WHERE category = 'umrah' AND status IN ('published','sold_out') ORDER BY price_from ASC").map(hydrateProgram);
  const filtered = level ? all.filter((p) => String(p.level) === level) : all;
  const makkahOnly = filtered.filter((p) => p.route === 'makkah');
  const both = filtered.filter((p) => p.route !== 'makkah');
  const steps = q(db, "SELECT title, body FROM kb_docs WHERE active = 1 AND category = 'umrah' ORDER BY id LIMIT 8");
  const faqs = q(db, "SELECT * FROM faq WHERE published = 1 AND category = 'umrah' ORDER BY sort LIMIT 6");
  const compareData = all.map((p) => ({
    slug: p.slug, title: p.title, price: p.price_from, days: p.days, nights: p.nights,
    makkah: p.hotels?.find((h) => h.city.includes('مكة')) || null,
    madinah: p.hotels?.find((h) => h.city.includes('المدينة')) || null,
    meals: p.meals, airline: p.airline, mode: p.mode,
  }));

  const card = (p) => `<article class="card" data-compare-card="${attr(p.slug)}">
    <a class="card-media" href="/programs/${attr(p.slug)}" tabindex="-1" aria-hidden="true"><img src="${attr(artUrl(p.art_key, (p.id || 0) % 4))}" alt="" loading="lazy" width="800" height="500"></a>
    <div class="card-badges">${p.status === 'sold_out' ? '<span class="badge badge-danger">نفدت المقاعد</span>' : ''}${p.level === '5' ? '<span class="badge badge-gold">VIP</span>' : ''}</div>
    <div class="card-body">
      <span class="card-kicker">${esc(levelLabel(p))} · ${esc(p.route === 'makkah' ? 'مكة فقط' : 'مكة والمدينة')}</span>
      <h3 class="card-title"><a href="/programs/${attr(p.slug)}">${esc(p.title)}</a></h3>
      <div class="card-meta">
        <span>${icon('calendar', 15)} ${esc(p.days)} أيام</span>
        ${(p.hotels || [])[0] ? `<span>${icon('hotel', 15)} ${esc(p.hotels[0].name)}</span>` : ''}
        ${p.meals ? `<span>${icon('check', 15)} ${esc(p.meals)}</span>` : ''}
      </div>
      <div class="card-foot">
        <span class="price">${priceLabel(p.price_from, p.currency)}</span>
        <div class="btn-row">
          <label class="chip" style="cursor:pointer"><input type="checkbox" data-compare="${attr(p.slug)}" style="margin-inline-end:6px;width:15px;height:15px"> قارن</label>
          <a class="btn btn-quiet btn-sm" href="/programs/${attr(p.slug)}">التفاصيل</a>
        </div>
      </div>
    </div>
  </article>`;

  const body = `
  ${pageHead({
    title: 'الحج والعمرة',
    sub: 'برامج عمرة اقتصادية وخمس نجوم، مكة فقط أو مكة والمدينة، بفنادق ومسافات وأسعار معلنة — وقارن بينها قبل أن تقرر.',
    crumbs: [{ href: '/', label: 'الرئيسية' }, { label: 'الحج والعمرة' }],
    actions: '<a class="btn btn-gold" href="#custom">اطلب برنامج عمرة خاص</a><a class="btn btn-ghost" href="#compare">قارن البرامج</a>',
  })}

  <section class="section-tight">
    <div class="wrap">
      <div class="chips mb-3">
        <a class="chip ${!level ? 'is-active' : ''}" href="/umrah">كل البرامج (${all.length})</a>
        <a class="chip ${level === 'eco' ? 'is-active' : ''}" href="/umrah?level=eco">اقتصادي</a>
        <a class="chip ${level === '4' ? 'is-active' : ''}" href="/umrah?level=4">أربع نجوم</a>
        <a class="chip ${level === '5' ? 'is-active' : ''}" href="/umrah?level=5">خمس نجوم VIP</a>
      </div>

      <div class="notice notice-info mb-3">الأسعار للشخص الواحد و«تبدأ من» حسب نوع الغرفة. السعر النهائي يصلك في عرض رسمي، ولا يُطلب منك أي دفع قبل موافقتك على العرض.</div>

      <h2 style="font-size:20px">برامج مكة والمدينة (${both.length})</h2>
      <div class="grid grid-3 mb-4">${both.map(card).join('') || emptyState('لا توجد برامج في هذا التصنيف', 'جرّب تصنيفًا آخر أو اطلب برنامجًا مخصصًا.')}</div>

      ${makkahOnly.length ? `<h2 style="font-size:20px">برامج مكة المكرمة فقط (${makkahOnly.length})</h2><div class="grid grid-3">${makkahOnly.map(card).join('')}</div>` : ''}
    </div>
  </section>

  <section class="section section-sand" id="compare">
    <div class="wrap">
      ${sectionHead({ eyebrow: 'مقارنة شفافة', title: 'قارن برامج العمرة', sub: 'اختر برنامجين أو ثلاثة من البطاقات أعلاه، ثم اضغط «قارن المحدد».' })}
      <div id="compareArea">
        <div class="empty"><b>لم تحدد برامج بعد</b><p>حدد برنامجين على الأقل من البطاقات أعلاه لتظهر المقارنة هنا.</p></div>
      </div>
    </div>
  </section>

  <section class="section">
    <div class="wrap split">
      <div>
        ${sectionHead({ eyebrow: 'خطوات العمرة', title: 'من الحجز إلى العودة' })}
        <div class="accordion">${steps.map((s, i) => `<details class="acc-item" ${i === 0 ? 'open' : ''}><summary>${esc(s.title)}</summary><div class="acc-body"><p>${esc(s.body)}</p></div></details>`).join('')}</div>
      </div>
      <div>
        ${sectionHead({ eyebrow: 'أسئلة العمرة', title: 'أسئلة تتكرر' })}
        <div class="accordion">${faqs.map((f) => faqItem(f)).join('')}</div>
      </div>
    </div>
  </section>

  <section class="section section-sand" id="custom">
    <div class="wrap">
      ${sectionHead({ eyebrow: 'طلب خاص', title: 'اطلب برنامج عمرة على مقاسك', sub: 'حدد التواريخ وعدد الأشخاص ومستوى الفنادق، ويجمع لك الفريق عرضًا مخصصًا.' })}
      <div class="panel">
        <form class="request-form" data-request-type="umrah" novalidate>
          <div class="form-body">
            <input type="hidden" name="programSlug" value="${attr(all[0]?.slug || '')}">
            <input type="hidden" name="customRequest" value="1">
            <fieldset>
              <legend><span class="step">1</span> تفاصيل البرنامج المطلوب</legend>
              <div class="form-grid">
                <div class="field"><label for="u-level">مستوى الفنادق</label><select id="u-level" name="roomType"><option value="custom">حسب اقتراح الفريق</option><option value="double">غرفة ثنائية</option><option value="triple">غرفة ثلاثية</option><option value="quad">غرفة رباعية</option></select></div>
                <div class="field"><label for="u-date">تاريخ السفر المفضل</label><input id="u-date" name="preferredDate" type="date"></div>
              </div>
              <div class="form-grid-3 mt-2">
                <div class="field"><label for="u-adults">البالغون</label><input id="u-adults" name="adults" type="number" min="1" max="30" value="2" required></div>
                <div class="field"><label for="u-children">الأطفال</label><input id="u-children" name="children" type="number" min="0" max="20" value="0"></div>
                <div class="field"><label for="u-infants">الرضّع</label><input id="u-infants" name="infants" type="number" min="0" max="10" value="0"></div>
              </div>
            </fieldset>
            <fieldset>
              <legend><span class="step">2</span> بيانات التواصل</legend>
              <div class="form-grid">
                <div class="field"><label for="u-name">الاسم الكامل <span class="req">*</span></label><input id="u-name" name="name" required autocomplete="name"></div>
                <div class="field"><label for="u-phone">رقم الهاتف <span class="req">*</span></label><input id="u-phone" name="phone" type="tel" dir="ltr" required placeholder="0791234567"></div>
                <div class="field"><label for="u-email">البريد الإلكتروني</label><input id="u-email" name="email" type="email" dir="ltr"></div>
              </div>
              <div class="field field-full mt-2"><label for="u-notes">ملاحظات</label><textarea id="u-notes" name="notes" rows="3" placeholder="مثال: نفضل فندقًا على بعد أقل من 500 م من الحرم، ووجود غرف متجاورة."></textarea></div>
              <label class="check mt-3"><input type="checkbox" name="consent" required><span>أوافق على حفظ بياناتي للتواصل بخصوص هذا الطلب، وعلى <a href="/privacy">سياسة الخصوصية</a>.</span></label>
              <button class="btn btn-primary btn-lg btn-block mt-2" type="submit">إرسال طلب العمرة</button>
              <p class="form-status" data-form-status role="status" aria-live="polite"></p>
            </fieldset>
          </div>
        </form>
      </div>
    </div>
  </section>

  <script type="application/json" id="compareData" nonce="${ctx.nonce}">${JSON.stringify(compareData).replaceAll('<', '\\u003c')}</script>`;

  return layout({
    settings, path: '/umrah', nonce: ctx.nonce,
    title: 'برامج الحج والعمرة — أسعار وفنادق ومقارنة',
    description: 'برامج عمرة من لوريت: اقتصادية وخمس نجوم، مكة فقط أو مكة والمدينة، مع فنادق ومسافات وأسعار معلنة وإمكانية المقارنة وطلب عرض رسمي.',
    canonical: `${ctx.baseUrl}/umrah`,
    body,
    jsonLd: [{
      '@context': 'https://schema.org', '@type': 'ItemList', name: 'برامج العمرة',
      itemListElement: all.slice(0, 20).map((p, i) => ({ '@type': 'ListItem', position: i + 1, url: `${ctx.baseUrl}/programs/${p.slug}`, name: p.title })),
    }],
  });
}

/* ============================ HOTELS ============================ */

export function hotelsPage(ctx) {
  const { db, settings, query } = ctx;
  const rows = q(db, "SELECT * FROM programs WHERE status IN ('published','sold_out') AND hotels IS NOT NULL ORDER BY featured DESC, price_from ASC LIMIT 120").map(hydrateProgram);
  const seen = new Map();
  for (const p of rows) {
    for (const h of p.hotels || []) {
      const key = `${h.city}|${h.name}`;
      if (!seen.has(key)) seen.set(key, { ...h, program: p });
    }
  }
  const hotels = [...seen.values()].slice(0, 18);
  const tips = q(db, "SELECT title, body FROM kb_docs WHERE active = 1 AND category = 'hotels' ORDER BY id LIMIT 6");

  const body = `
  ${pageHead({
    title: 'حجز الفنادق',
    sub: 'فنادق ضمن برامجنا المنشورة أو فندق تختاره أنت. نراجع التوافر والسعر والوجبات والموقع قبل أي تأكيد.',
    crumbs: [{ href: '/', label: 'الرئيسية' }, { label: 'حجز الفنادق' }],
  })}
  <section class="section-tight">
    <div class="wrap">
      <div class="split">
        <div class="form-shell">
          <div class="form-head"><h2>طلب حجز فندق</h2><p>املأ التفاصيل وسيراجعها فريق الفنادق ويعود إليك بعرض رسمي.</p></div>
          ${hotelForm(query)}
        </div>
        <aside class="stack sticky-side">
          <div class="panel panel-quiet">
            <h3 style="font-size:17px">كيف نعمل؟</h3>
            <ol style="font-size:13.5px;color:#334E63;padding-inline-start:20px">
              <li>ترسل المدينة والتواريخ وعدد الغرف.</li>
              <li>نراجع التوافر مع الفنادق أو الموردين.</li>
              <li>يصلك عرض بالسعر والوجبات وسياسة الإلغاء.</li>
              <li>تؤكد، فنجهّز قسيمة الحجز باسمك.</li>
            </ol>
            <p class="field-hint">لا نعرض سعرًا نهائيًا قبل التأكد من التوافر، لأن أسعار الفنادق تتغير يوميًا.</p>
          </div>
          <div class="panel">
            <h3 style="font-size:17px">نصائح اختيار الفندق</h3>
            <div class="accordion">${tips.map((t) => `<details class="acc-item"><summary>${esc(t.title)}</summary><div class="acc-body"><p>${esc(t.body)}</p></div></details>`).join('')}</div>
          </div>
        </aside>
      </div>
    </div>
  </section>

  <section class="section section-sand">
    <div class="wrap">
      ${sectionHead({ eyebrow: 'من برامجنا', title: 'فنادق تظهر في برامج لوريت', sub: 'هذه الفنادق مذكورة في البرامج المنشورة — اضغط لعرض البرنامج الذي يتضمنها.', href: '/programs', linkLabel: 'كل البرامج' })}
      <div class="grid grid-3">
        ${hotels.map((h) => `<article class="card"><div class="card-body">
          <span class="card-kicker">${esc(h.city)}</span>
          <h3 class="card-title">${esc(h.name)}</h3>
          <div class="card-meta">${h.stars ? `<span>${'★'.repeat(Number(h.stars))}</span>` : '<span>إيواء سياحي</span>'}${h.distance ? `<span>${icon('map', 15)} ${esc(h.distance)}</span>` : ''}</div>
          <div class="card-foot"><span class="price">${priceLabel(h.program.price_from, h.program.currency)}</span><a class="btn btn-quiet btn-sm" href="/programs/${attr(h.program.slug)}">البرنامج</a></div>
        </div></article>`).join('')}
      </div>
    </div>
  </section>`;

  return layout({
    settings, path: '/hotels', nonce: ctx.nonce,
    title: 'طلب حجز فندق — مراجعة توافر وسعر',
    description: 'أرسل طلب حجز فندق في مكة أو المدينة أو إسطنبول أو شرم الشيخ، ونراجع التوافر والسعر والوجبات ونرسل عرضًا رسميًا.',
    canonical: `${ctx.baseUrl}/hotels`,
    body,
  });
}
