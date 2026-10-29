import { q, one } from '../db.js';
import { esc, attr, formatDate, clampText } from '../util.js';
import { artUrl } from '../art.js';
import { hydrateProgram, searchPrograms } from '../domain.js';
import { layout, breadcrumbs, programCard, articleCard, faqItem, icon, markdown, offerPosterCard, offerThumb, photoThumb } from './layout.js';
import { flightForm, visaForm, consultForm } from './forms.js';

function pageHead({ title, sub, crumbs, actions = '' }) {
  return `<section class="page-head"><div class="wrap">
    ${crumbs ? breadcrumbs(crumbs) : ''}
    <h1>${esc(title)}</h1>
    ${sub ? `<p>${esc(sub)}</p>` : ''}
    ${actions ? `<div class="btn-row mt-3">${actions}</div>` : ''}
  </div></section>`;
}

function emptyState(title, text, action = '') {
  return `<div class="empty"><b>${esc(title)}</b><p>${esc(text)}</p>${action}</div>`;
}

function sectionHead({ eyebrow, title, sub, href, linkLabel = 'عرض الكل' }) {
  return `<div class="section-head">
    <div>${eyebrow ? `<span class="eyebrow">${esc(eyebrow)}</span>` : ''}<h2>${esc(title)}</h2>${sub ? `<p>${esc(sub)}</p>` : ''}</div>
    ${href ? `<a class="link-more" href="${attr(href)}">${esc(linkLabel)} ›</a>` : ''}
  </div>`;
}

/* ============================ OFFERS ============================ */

const OFFER_CATEGORIES = {
  turkey: 'تركيا',
  egypt: 'مصر',
  georgia: 'جورجيا',
  umrah: 'الحج والعمرة',
  cruise: 'رحلات الكروز',
  visa: 'التأشيرات',
};

export function offersPage(ctx) {
  const { db, settings, query } = ctx;
  const category = String(query.category || 'all');
  const rows = q(db, "SELECT * FROM offers WHERE active = 1 ORDER BY featured DESC, sort ASC, id");
  const list = category === 'all' ? rows : rows.filter((o) => o.category === category);
  const counts = rows.reduce((acc, o) => ({ ...acc, [o.category]: (acc[o.category] || 0) + 1 }), {});
  const offerData = rows.map((o) => ({
    slug: o.slug, title: o.title, price: o.price_from, currency: o.currency, days: o.days, nights: o.nights,
    category: o.category, body: o.body, image: o.image_url, thumb: offerThumb(o), alt: o.image_alt,
    includes: (() => { try { return JSON.parse(o.includes); } catch { return []; } })(),
  }));

  const body = `
  ${pageHead({
    title: 'عروض لوريت',
    sub: 'بوسترات العروض المنشورة من إدارة الشركة: اضغط على أي بوستر لعرض البرنامج الشامل والسعر، ثم احجز عبر واتساب أو اطلب عرض سعر رسمي.',
    crumbs: [{ href: '/', label: 'الرئيسية' }, { label: 'العروض' }],
    actions: '<button class="btn btn-gold" type="button" data-wa data-wa-text="السلام عليكم، أرغب بالاستفسار عن العروض الحالية">اطلب تفاصيل عرض</button>',
  })}
  <section class="section-tight">
    <div class="wrap">
      <div class="chips mb-3">
        <a class="chip ${category === 'all' ? 'is-active' : ''}" href="/offers">كل العروض <span class="muted">(${rows.length})</span></a>
        ${Object.entries(OFFER_CATEGORIES).filter(([k]) => counts[k]).map(([k, l]) => `<a class="chip ${category === k ? 'is-active' : ''}" href="/offers?category=${attr(k)}">${esc(l)} <span class="muted">(${counts[k]})</span></a>`).join('')}
      </div>
      ${list.length ? `<div class="poster-grid poster-grid-wide">${list.map((o) => offerPosterCard(o)).join('')}</div>` : emptyState('لا توجد عروض في هذا التصنيف', 'اختر تصنيفًا آخر أو تواصل معنا لمعرفة العروض الحالية.', '<a class="btn btn-gold mt-2" href="/offers">كل العروض</a>')}
      <div class="notice notice-warn mt-4">الأسعار المنشورة «تبدأ من» للشخص وتختلف حسب التواريخ ونوع الغرفة والتوافر. السعر المعتمد والتفاصيل النهائية تصلك في عرض رسمي من فريق لوريت قبل أي دفع.</div>
    </div>
  </section>

  <section class="section section-sand">
    <div class="wrap split">
      <div>
        ${sectionHead({ eyebrow: 'لم تجد عرضك؟', title: 'نصمم لك عرضًا خاصًا', sub: 'أخبرنا بالوجهة والتواريخ وعدد المسافرين، ونعود إليك بعرض يناسبك.' })}
      </div>
      <div class="panel">
        <h3 style="font-size:18px">تواصل مع خبير لوريت</h3>
        <p style="font-size:13.5px">اختر الفرع على واتساب لتصلك الإجابة من الفريق المسؤول، أو أرسل استشارة برقم مرجعي.</p>
        <div class="btn-row">
          <button class="btn btn-wa" type="button" data-wa data-wa-text="السلام عليكم، أرغب بعرض خاص لرحلة">واتساب الفروع</button>
          <a class="btn btn-gold" href="/consult?topic=trip">اطلب عرض سعر</a>
        </div>
      </div>
    </div>
  </section>`;

  return layout({
    settings, path: '/offers', nonce: ctx.nonce,
    title: 'عروض لوريت — بوسترات وأسعار وبرامج',
    description: 'عروض لوريت الحالية بالصور: تركيا، مصر، جورجيا، العمرة، الكروز، وتأشيرة الولايات المتحدة — مع السعر والمدة والبرنامج الشامل.',
    canonical: `${ctx.baseUrl}/offers${category !== 'all' ? `?category=${category}` : ''}`,
    body,
    offerData,
    jsonLd: [
      {
        '@context': 'https://schema.org', '@type': 'ItemList', name: 'عروض لوريت',
        itemListElement: list.map((o, i) => ({
          '@type': 'ListItem', position: i + 1, name: o.title,
          item: { '@type': 'Product', name: o.title, image: `${ctx.baseUrl}${o.image_url || ''}`, offers: o.price_from ? { '@type': 'Offer', price: o.price_from, priceCurrency: 'JOD', url: `${ctx.baseUrl}/offers` } : undefined },
        })),
      },
    ],
  });
}

/* ============================ FROM JORDAN ============================ */

export function jordanPage(ctx) {
  const { db, settings } = ctx;
  const slugs = ['istanbul', 'dubai', 'abu-dhabi', 'doha', 'cairo', 'sharm', 'tbilisi', 'batumi', 'trabzon', 'antalya', 'bangkok', 'phuket', 'kuala-lumpur', 'london', 'paris', 'mecca', 'medina'];
  const marks = slugs.map(() => '?').join(',');
  const destinations = q(db, `SELECT * FROM destinations WHERE slug IN (${marks}) AND published = 1`, slugs);
  const hotels = q(db, 'SELECT * FROM hotel_guides WHERE published = 1 ORDER BY sort LIMIT 16');
  const airlines = q(db, 'SELECT * FROM airlines WHERE published = 1 ORDER BY sort');
  const trips = q(db, 'SELECT * FROM trip_ideas WHERE published = 1 ORDER BY sort LIMIT 10').map((t) => ({
    ...t,
    itinerary: (() => { try { return JSON.parse(t.itinerary); } catch { return []; } })(),
    includes: (() => { try { return JSON.parse(t.includes); } catch { return []; } })(),
  }));
  const tripArt = (t) => {
    if (t.image_url) return photoThumb(t.image_url);
    if (t.country === 'تركيا') return artUrl('istanbul', 1);
    if (t.country === 'تايلاند') return artUrl('asia', 1);
    if (t.country === 'بريطانيا') return artUrl('europe', 1);
    if (t.country === 'جورجيا') return artUrl('europe', 2);
    return artUrl('haram', 1);
  };

  const body = `
  ${pageHead({
    title: 'دليل السفر من الأردن',
    sub: 'وجهات مختارة، فنادق معروفة، شركات طيران تخدم عمّان، وأفكار رحلات — كلها من عمّان، وبأرقام لا تشمل أسعارًا منقولة.',
    crumbs: [{ href: '/', label: 'الرئيسية' }, { label: 'من الأردن' }],
    actions: '<button class="btn btn-gold" type="button" data-wa data-wa-text="السلام عليكم، أرغب باستشارة سفر من الأردن">استشر خبيرًا</button>',
  })}

  <section class="section-tight">
    <div class="wrap">
      <div class="notice notice-info mb-3">
        <b>من عمّان إلى العالم:</b> هذه الصفحة دليل تخطيط، وليست حجزًا فوريًا. أسماء الفنادق والوجهات والشركات مأخوذة من الأدلة العامة للمسافر (25 أكتوبر 2026) وأُعيدت صياغتها، أما الأسعار فتصلك في عرض رسمي من لوريت.
      </div>
      <div class="guide-stats">
        <div><b>${destinations.length}</b><span>وجهة مقترحة</span></div>
        <div><b>${hotels.length}</b><span>فندقًا معروفًا</span></div>
        <div><b>${airlines.length}</b><span>شركة طيران</span></div>
        <div><b>${trips.length}</b><span>فكرة رحلة</span></div>
      </div>
    </div>
  </section>

  <section class="section" id="destinations">
    <div class="wrap">
      ${sectionHead({ eyebrow: 'أولًا: الوجهات', title: 'أين يسافر الأردنيون؟', sub: 'وجهات قريبة وبعيدة، مع أفضل وقت للزيارة وما يميزها — اضغط لعرض الدليل الكامل.', href: '/destinations', linkLabel: 'كل الوجهات' })}
      <div class="grid grid-4">
        ${destinations.map((d) => `<article class="card">
          <a class="card-media" href="/destinations/${attr(d.slug)}" tabindex="-1" aria-hidden="true">
            <img src="${attr(d.image_url ? photoThumb(d.image_url) : artUrl(d.art_key, (d.id || 0) % 4))}" alt="" loading="lazy" decoding="async" width="800" height="500">
          </a>
          <div class="card-body">
            <span class="card-kicker">${esc(d.best_time || 'وجهة')}</span>
            <h3 class="card-title"><a href="/destinations/${attr(d.slug)}">${esc(d.name)}</a></h3>
            <p class="muted" style="font-size:13px;margin:0">${esc((d.summary || '').slice(0, 120))}</p>
            <div class="card-foot"><a class="btn btn-quiet btn-sm" href="/destinations/${attr(d.slug)}">دليل الوجهة</a><a class="btn btn-ghost btn-sm" href="/programs?q=${encodeURIComponent(d.name)}">البرامج</a></div>
          </div>
        </article>`).join('')}
      </div>
    </div>
  </section>

  <section class="section section-sand" id="hotels">
    <div class="wrap">
      ${sectionHead({ eyebrow: 'ثانيًا: الفنادق', title: 'فنادق معروفة في وجهات الأردنيين', sub: 'أسماء ومواقع من الأدلة العامة، دون أسعار منقولة. اطلب الفندق وسنراجع التوافر والسعر لك.', href: '/hotels', linkLabel: 'طلب فندق' })}
      <div class="grid grid-3">
        ${hotels.map((h) => `<article class="hotel-card">
          <div class="hotel-card-top"><span class="badge badge-soft">${esc(h.city)}</span>${h.stars ? `<span class="hotel-stars" aria-label="${h.stars} نجوم">${'★'.repeat(Number(h.stars))}</span>` : ''}</div>
          <h3>${esc(h.name)}</h3>
          <p class="hotel-area">${esc(h.area || '')}</p>
          <p class="hotel-note">${esc(h.note || '')}</p>
          <div class="hotel-actions">
            <a class="btn btn-quiet btn-sm" href="/hotels?city=${encodeURIComponent(h.city)}&hotelName=${encodeURIComponent(h.name)}">اطلب هذا الفندق</a>
            <a class="btn btn-ghost btn-sm" href="/destinations/${attr(h.city_slug || '')}">دليل المدينة</a>
          </div>
        </article>`).join('')}
      </div>
      <p class="source-note mt-2">تصنيف النجوم كما هو معروف لدى الأدلة العامة وقد يتغير؛ نؤكده لك قبل الحجز.</p>
    </div>
  </section>

  <section class="section" id="airlines">
    <div class="wrap">
      ${sectionHead({ eyebrow: 'ثالثًا: الطيران', title: 'شركات تخدم المسافر من عمّان', sub: 'الناقل الوطني، الخليجية، التركية، والمصرية — مع محور كل شركة وما تفيدك به.', href: '/flights', linkLabel: 'طلب تذكرة' })}
      <div class="airline-grid">
        ${airlines.map((a) => `<a class="airline-card" href="/flights?airline=${encodeURIComponent(a.code || a.name)}">
          <span class="airline-code">${esc(a.code || '✈')}</span>
          <span class="airline-body"><b>${esc(a.name)}</b><small>${esc(a.hub || '')}</small><span>${esc(a.note || '')}</span></span>
        </a>`).join('')}
      </div>
      <p class="source-note mt-2">المسارات المتاحة تتغير بحسب الموسم والشركة؛ نتحقق من التوافر عند الطلب.</p>
    </div>
  </section>

  <section class="section section-sand" id="trips">
    <div class="wrap">
      ${sectionHead({ eyebrow: 'رابعًا: رحلات مقترحة', title: 'أفكار رحلات تبدأ من عمّان', sub: 'برامج إرشادية بالمدة وأفضل وقت والمشمول — دون سعر ثابت؛ اطلب عرضًا ونصممه لك.', href: '/programs', linkLabel: 'كل البرامج' })}
      <div class="grid grid-2">
        ${trips.map((t) => `<article class="trip-card">
          <a class="trip-media" href="/consult?topic=trip"><img src="${attr(tripArt(t))}" alt="" loading="lazy" decoding="async" width="800" height="500"></a>
          <div class="trip-body">
            <span class="card-kicker">${esc(t.country || '')} · ${esc(t.days)} أيام / ${esc(t.nights)} ليالٍ</span>
            <h3>${esc(t.title)}</h3>
            <p>${esc(t.summary || '')}</p>
            <div class="trip-meta"><span>أفضل وقت: ${esc(t.best_time || 'حسب الموسم')}</span></div>
            <div class="badge-row">${(t.includes || []).slice(0, 4).map((i) => `<span class="badge badge-line">${esc(i)}</span>`).join('')}</div>
            <div class="btn-row"><a class="btn btn-gold btn-sm" href="/consult?topic=trip">اطلب عرض سعر</a><button class="btn btn-wa btn-sm" type="button" data-wa data-wa-text="السلام عليكم، أرغب بالاستفسار عن: ${attr(t.title)}">واتساب</button></div>
          </div>
        </article>`).join('')}
      </div>
    </div>
  </section>

  <section class="section-tight">
    <div class="wrap">
      <div class="notice notice-warn">
        <b>تنبيه المصدر:</b> البيانات المنظمة (أسماء الفنادق، الوجهات، شركات الطيران) مأخوذة من صفحات عامة في المسافر بتاريخ 25 أكتوبر 2026، وأُعيدت صياغتها لأغراض التخطيط. لا تمثل أسعارًا ولا توافرًا لحظيًا، ولا تُنسب إلى المسافر كشريك. الأسعار والتوافر يؤكدهما فريق لوريت قبل أي حجز.
      </div>
    </div>
  </section>`;

  return layout({
    settings, path: '/jordan', nonce: ctx.nonce,
    title: 'دليل السفر من الأردن — وجهات وفنادق وشركات طيران',
    description: 'دليل عملي للمسافر من الأردن: أفضل الوجهات، فنادق معروفة، شركات طيران تخدم عمّان، وأفكار رحلات مع طلب عرض سعر من لوريت.',
    canonical: `${ctx.baseUrl}/jordan`,
    body,
    jsonLd: [{
      '@context': 'https://schema.org', '@type': 'ItemList', name: 'وجهات من الأردن',
      itemListElement: destinations.slice(0, 10).map((d, i) => ({ '@type': 'ListItem', position: i + 1, name: d.name, url: `${ctx.baseUrl}/destinations/${d.slug}` })),
    }],
  });
}

/* ============================ FLIGHTS ============================ */

export function flightsPage(ctx) {
  const { db, settings, query } = ctx;
  const faqs = q(db, "SELECT * FROM faq WHERE published = 1 AND category IN ('flights','general') ORDER BY sort LIMIT 6");
  const body = `
  ${pageHead({
    title: 'طلب تذكرة طيران',
    sub: 'أرسل تفاصيل رحلتك، ويراجع مختص الطيران التوافر والأسعار ويعود إليك بعرض رسمي. لا نعرض أسعارًا تقديرية غير مؤكدة.',
    crumbs: [{ href: '/', label: 'الرئيسية' }, { label: 'تذاكر الطيران' }],
  })}
  <section class="section-tight">
    <div class="wrap">
      <div class="split">
        <div class="form-shell">
          <div class="form-head"><h2>نموذج طلب الرحلة</h2><p>الحقول المعلّمة بـ * مطلوبة. تستغرق العملية دقيقتين.</p></div>
          ${flightForm(query)}
        </div>
        <aside class="stack sticky-side">
          <div class="panel panel-quiet">
            <h3 style="font-size:17px">ماذا يحدث بعد الإرسال؟</h3>
            <ol style="font-size:13.5px;color:#334E63;padding-inline-start:20px">
              <li>تحصل على رقم مرجعي فوري (مثال: LT-FL-XXXXXX).</li>
              <li>يظهر الطلب في لوحة الإدارة تحت «تذاكر الطيران».</li>
              <li>يراجع المختص التوافر والأسعار مع شركات الطيران.</li>
              <li>يصلك عرض رسمي، وبعد موافقتك تُصدر التذكرة.</li>
            </ol>
            <div class="notice notice-warn mt-2">الأسعار تتغير حتى لحظة الإصدار، لذلك لا نعرض سعرًا قبل التأكيد من شركة الطيران.</div>
          </div>
          <div class="panel">
            <h3 style="font-size:17px">تفضل التواصل المباشر؟</h3>
            <p style="font-size:13.5px">فريق التذاكر في فرعي إربد وعمّان جاهز هاتفيًا أو عبر واتساب.</p>
            <div class="btn-row">
              <a class="btn btn-wa btn-sm" href="${attr(`https://wa.me/${String(settings.whatsapp).replace(/\D/g, '')}?text=${encodeURIComponent('السلام عليكم، أرغب بحجز تذكرة طيران')}`)}" target="_blank" rel="noopener noreferrer">${icon('whatsapp', 16)} واتساب</a>
              <a class="btn btn-ghost btn-sm" href="tel:+962791193888" dir="ltr">+962 79 119 3888</a>
            </div>
          </div>
          <div class="panel">
            <h3 style="font-size:17px">أسئلة التذاكر</h3>
            <div class="accordion">${faqs.map((f) => faqItem(f)).join('')}</div>
          </div>
        </aside>
      </div>
    </div>
  </section>

  <section class="section section-sand">
    <div class="wrap">
      ${sectionHead({ eyebrow: 'خدمات التذاكر', title: 'ما نستطيع ترتيبه لك', sub: 'رحلات فردية وجماعية، ووجهات متعددة، ودرجات سفر مختلفة.' })}
      <div class="grid grid-4">
        ${[
          ['plane', 'ذهاب وعودة', 'أفضل الأسعار على مساراتك المعتادة مع مرونة في التواريخ عند الإمكان.'],
          ['compass', 'وجهات متعددة', 'مسار من عدة مدن في رحلة واحدة، مع ترتيب منطقي للتنقل.'],
          ['users', 'مجموعات وعائلات', 'ترتيب مقاعد متجاورة، وأسعار أطفال ورضّع، وأمتعة إضافية.'],
          ['shield', 'مراجعة قبل الإصدار', 'نتحقق من تهجئة الأسماء وجواز السفر وصلاحية التأشيرة قبل الإصدار.'],
        ].map(([ic, t, d]) => `<div class="quote"><span class="service-icon">${icon(ic, 22)}</span><b style="color:var(--navy)">${esc(t)}</b><p>${esc(d)}</p></div>`).join('')}
      </div>
    </div>
  </section>`;

  return layout({
    settings, path: '/flights', nonce: ctx.nonce,
    title: 'طلب تذكرة طيران — عرض سعر رسمي',
    description: 'أرسل تفاصيل رحلتك إلى فريق تذاكر لوريت: ذهاب وعودة، ذهاب فقط، أو وجهات متعددة، مع مراجعة بشرية للتوافر والسعر.',
    canonical: `${ctx.baseUrl}/flights`,
    body,
  });
}

/* ============================ VISA ============================ */

export function visaPage(ctx) {
  const { db, settings, query } = ctx;
  const rules = q(db, 'SELECT * FROM visa_rules WHERE published = 1 ORDER BY id');
  const faqs = q(db, "SELECT * FROM faq WHERE published = 1 AND category = 'visa' ORDER BY sort LIMIT 6");
  const parse = (s) => { try { const v = JSON.parse(s); return Array.isArray(v) ? v : []; } catch { return []; } };
  const selected = String(query.destination || '');

  const body = `
  ${pageHead({
    title: 'مركز التأشيرات',
    sub: 'معلومات موثّقة بمصادرها وتاريخ آخر تحديث، ومراجعة بشرية لملفك قبل التقديم. لا نضمن إصدار التأشيرة، والقرار للجهة الرسمية.',
    crumbs: [{ href: '/', label: 'الرئيسية' }, { label: 'التأشيرات' }],
  })}
  <section class="section-tight">
    <div class="wrap">
      <div class="notice notice-warn mb-3"><b>اقرأ هذا أولًا:</b> ${esc(settings.visaDisclaimer || 'المعلومات إرشادية وتتغير بحسب الجهة الرسمية.')}</div>
      <div class="split">
        <div class="stack">
          <div class="form-shell">
            <div class="form-head"><h2>طلب مراجعة تأشيرة</h2><p>يراجع القسم المختص ملفك ويحدد المستندات الناقصة قبل التقديم.</p></div>
            ${visaForm(query)}
          </div>
        </div>
        <aside class="stack sticky-side">
          <div class="panel panel-quiet">
            <h3 style="font-size:17px">ما لا نفعله</h3>
            <ul style="font-size:13.5px;color:#334E63;padding-inline-start:20px">
              <li>لا نضمن الموافقة على أي تأشيرة.</li>
              <li>لا نصنّفك «مؤهلًا» بشكل قطعي دون قواعد رسمية محدثة.</li>
              <li>لا نطلب صور جوازات عبر روابط عامة أو واتساب.</li>
              <li>لا نرسل مستنداتك لأي جهة غير معنية بالطلب.</li>
            </ul>
          </div>
          <div class="panel">
            <h3 style="font-size:17px">مستنداتك محمية</h3>
            <p style="font-size:13.5px">تُسلَّم المستندات الحساسة في الفرع أو عبر قناة آمنة يحددها الموظف، وتُحفظ بصلاحيات وصول محددة، ولا تُرسل عبر روابط عامة.</p>
          </div>
        </aside>
      </div>
    </div>
  </section>

  <section class="section section-sand" id="requirements">
    <div class="wrap">
      ${sectionHead({ eyebrow: 'المتطلبات المنشورة', title: 'دليل التأشيرات', sub: 'كل بطاقة تذكر المصدر الرسمي وتاريخ آخر تحقق. تحقق دائمًا من المصدر قبل الحجز.' })}
      ${rules.length ? `<div class="grid grid-2">${rules.map((r) => `<article class="panel" id="visa-${r.id}">
        <div class="badge-row mb-2"><span class="badge badge-soft">${esc(r.destination)}</span>${r.purpose ? `<span class="badge badge-line">${esc(r.purpose)}</span>` : ''}${r.requires_verification ? '<span class="badge badge-warn">تحقق قبل التقديم</span>' : ''}</div>
        <h3 style="font-size:18px">تأشيرة ${esc(r.destination)}${r.purpose ? ` — ${esc(r.purpose)}` : ''}</h3>
        <p style="font-size:13.5px;color:#334E63">${esc(r.summary)}</p>
        ${parse(r.docs).length ? `<b style="font-size:13px">المستندات الأساسية</b><ul style="font-size:13px;color:#334E63">${parse(r.docs).map((d) => `<li>${esc(d)}</li>`).join('')}</ul>` : ''}
        ${parse(r.notes).length ? `<b style="font-size:13px">ملاحظات</b><ul style="font-size:13px;color:#334E63">${parse(r.notes).map((d) => `<li>${esc(d)}</li>`).join('')}</ul>` : ''}
        <p class="source-note">آخر تحديث: ${esc(r.last_verified || 'غير محدد')} · المصدر: ${r.source_url ? `<a href="${attr(r.source_url)}" target="_blank" rel="noopener noreferrer">${esc(r.source_name || r.source_url)}</a>` : esc(r.source_name || '—')}</p>
        <a class="btn btn-quiet btn-sm mt-2" href="#visa-form">اطلب مراجعة هذه التأشيرة</a>
      </article>`).join('')}</div>` : emptyState('دليل التأشيرات قيد التحديث', 'تواصل معنا لمعرفة المتطلبات الحالية من مصدرها الرسمي.')}
    </div>
  </section>

  <section class="section">
    <div class="wrap">
      ${sectionHead({ eyebrow: 'أسئلة التأشيرات', title: 'أسئلة شائعة' })}
      <div class="accordion">${faqs.map((f) => faqItem(f)).join('')}</div>
    </div>
  </section>`;

  return layout({
    settings, path: '/visa', nonce: ctx.nonce,
    title: 'مركز التأشيرات — متطلبات ومراجعة ملف',
    description: 'متطلبات تأشيرات السعودية وتركيا ومصر وشنغن والولايات المتحدة، مع مصدر رسمي وتاريخ تحديث، وطلب مراجعة ملف من فريق لوريت.',
    canonical: `${ctx.baseUrl}/visa`,
    body,
    jsonLd: rules.length ? [{
      '@context': 'https://schema.org', '@type': 'FAQPage',
      mainEntity: faqs.map((f) => ({ '@type': 'Question', name: f.question, acceptedAnswer: { '@type': 'Answer', text: f.answer } })),
    }] : [],
  });
}

/* ============================ CONSULT ============================ */

export function consultPage(ctx) {
  const { db, settings, query } = ctx;
  const body = `
  ${pageHead({
    title: 'اسأل خبير لوريت',
    sub: 'استشارة مجانية بلا التزام: أخبرنا بخططك، ويصلك رد من القسم المختص كتذكرة داخل النظام مع رقم مرجعي.',
    crumbs: [{ href: '/', label: 'الرئيسية' }, { label: 'اسأل خبير لوريت' }],
  })}
  <section class="section-tight">
    <div class="wrap">
      <div class="split">
        <div class="form-shell">
          <div class="form-head"><h2>أرسل استشارتك</h2><p>كلما كانت التفاصيل أوضح، كان الرد أدق.</p></div>
          ${consultForm(db, query)}
        </div>
        <aside class="stack sticky-side">
          <div class="panel">
            <h3 style="font-size:17px">مساعد ذكي يعمل الآن</h3>
            <p style="font-size:13.5px">المساعد الآلي يجيب من بيانات الموقع المنشورة، ولا يخترع أسعارًا. جرّبه من الزر العائم في أسفل الشاشة.</p>
            <button class="btn btn-gold btn-block" type="button" data-open-chat>${icon('chat', 17)} افتح مساعد لوريت</button>
          </div>
          <div class="panel panel-quiet">
            <h3 style="font-size:17px">ماذا يحدث بعد الإرسال؟</h3>
            <ol style="font-size:13.5px;color:#334E63;padding-inline-start:20px">
              <li>تُنشأ تذكرة استشارة برقم مرجعي.</li>
              <li>تُسند إلى القسم المختص (تأشيرات، طيران، فنادق، عمرة…).</li>
              <li>يتواصل معك الموظف عبر القناة التي اخترتها.</li>
              <li>يمكنك متابعة الحالة من صفحة «متابعة طلب».</li>
            </ol>
          </div>
          <div class="panel">
            <h3 style="font-size:17px">تواصل مباشر</h3>
            <ul class="fact-list">
              ${(settings.branches || []).map((b) => `<li><span>${esc(b.name)}</span><b dir="ltr">${esc(b.phone)}</b></li>`).join('')}
            </ul>
          </div>
        </aside>
      </div>
    </div>
  </section>`;

  return layout({
    settings, path: '/consult', nonce: ctx.nonce,
    title: 'اسأل خبير لوريت — استشارة سفر مجانية',
    description: 'استشارة سفر مجانية من فريق لوريت: تخطيط رحلة، تأشيرة، طيران، فندق، شهر عسل، رحلة عائلية، أو حج وعمرة.',
    canonical: `${ctx.baseUrl}/consult`,
    body,
  });
}

/* ============================ DESTINATIONS ============================ */

export function destinationsPage(ctx) {
  const { db, settings } = ctx;
  const all = q(db, 'SELECT * FROM destinations WHERE published = 1 ORDER BY sort').map((d) => ({
    ...d, highlights: (() => { try { return JSON.parse(d.highlights); } catch { return []; } })(),
  }));
  const countries = all.filter((d) => d.kind === 'country');
  const citiesOf = (slug) => all.filter((d) => d.kind === 'city' && d.parent_slug === slug);
  const programs = q(db, "SELECT category, COUNT(*) n FROM programs WHERE status IN ('published','sold_out') GROUP BY category");
  const catCount = Object.fromEntries(programs.map((r) => [r.category, r.n]));

  const body = `
  ${pageHead({
    title: 'دليل الوجهات',
    sub: 'دول ومدن نعمل عليها فعليًا، مع ما يميز كل وجهة وروابط مباشرة إلى برامجنا المنشورة فيها.',
    crumbs: [{ href: '/', label: 'الرئيسية' }, { label: 'الوجهات' }],
  })}
  <section class="section-tight">
    <div class="wrap stack">
      ${countries.map((c) => `<div class="panel">
        <div class="split-even grid" style="gap:18px;align-items:center">
          <div>
            <span class="card-kicker">دولة</span>
            <h2 style="font-size:22px;margin:4px 0 8px">${esc(c.name)}</h2>
            <p style="font-size:14px;color:#334E63">${esc(clampText(c.summary || '', 320))}</p>
            ${c.highlights?.length ? `<div class="badge-row">${c.highlights.slice(0, 4).map((h) => `<span class="badge badge-soft">${esc(h)}</span>`).join('')}</div>` : ''}
            <div class="btn-row mt-3"><a class="btn btn-ghost btn-sm" href="/destinations/${attr(c.slug)}">تفاصيل ${esc(c.name)}</a><a class="btn btn-quiet btn-sm" href="/programs?q=${encodeURIComponent(c.name)}">برامج ${esc(c.name)}</a></div>
          </div>
          <a href="/destinations/${attr(c.slug)}" class="figure"><img src="${attr(c.image_url ? photoThumb(c.image_url) : artUrl(c.art_key, 1))}" alt="${attr(c.name)}" loading="lazy" decoding="async" width="600" height="400"></a>
        </div>
        <div class="chips mt-3">
          ${citiesOf(c.slug).map((city) => `<a class="chip" href="/destinations/${attr(city.slug)}">${esc(city.name)}</a>`).join('')}
        </div>
      </div>`).join('')}
      <div class="notice notice-info">قائمة المدن والأدلة قابلة للتوسعة من لوحة الإدارة. البرامج المرتبطة: ${Object.entries(catCount).map(([k, n]) => `${esc({ umrah: 'الحج والعمرة', cruise: 'الكروز', sharm: 'شرم الشيخ', istanbul: 'إسطنبول' }[k] || k)} (${n})`).join(' · ')}.</div>
    </div>
  </section>`;

  return layout({
    settings, path: '/destinations', nonce: ctx.nonce,
    title: 'دليل الوجهات — مدن ودول نعمل عليها',
    description: 'دليل وجهات لوريت: الأردن، السعودية، مصر، تركيا، سوريا — مع مدن رئيسية وما يميز كل وجهة وروابط البرامج.',
    canonical: `${ctx.baseUrl}/destinations`,
    body,
    jsonLd: [{
      '@context': 'https://schema.org', '@type': 'ItemList',
      itemListElement: countries.map((c, i) => ({ '@type': 'ListItem', position: i + 1, name: c.name, url: `${ctx.baseUrl}/destinations/${c.slug}` })),
    }],
  });
}

export function destinationPage(ctx, slug) {
  const { db, settings } = ctx;
  const d = one(db, 'SELECT * FROM destinations WHERE slug = ? AND published = 1', [slug]);
  if (!d) return null;
  const highlights = (() => { try { return JSON.parse(d.highlights); } catch { return []; } })();
  const parent = d.parent_slug ? one(db, 'SELECT * FROM destinations WHERE slug = ?', [d.parent_slug]) : null;
  const cities = citiesOf(db, d.slug);
  const programs = searchPrograms(db, { q: d.name, limit: 6 });
  const fallbackPrograms = programs.length ? programs : searchPrograms(db, { limit: 3 });

  const body = `
  ${pageHead({
    title: d.name,
    sub: d.summary || '',
    crumbs: [{ href: '/', label: 'الرئيسية' }, { href: '/destinations', label: 'الوجهات' }, ...(parent ? [{ href: `/destinations/${parent.slug}`, label: parent.name }] : []), { label: d.name }],
  })}
  <section class="section-tight">
    <div class="wrap split">
      <div class="stack">
        <div class="figure"><img src="${attr(d.image_url || artUrl(d.art_key, 2))}" alt="${attr(d.name)}" width="900" height="500" decoding="async"></div>
        ${highlights.length ? `<div class="panel"><h2 style="font-size:20px">ما يميز ${esc(d.name)}</h2>
          <ul style="font-size:14px;color:#334E63">${highlights.map((h) => `<li>${esc(h)}</li>`).join('')}</ul></div>` : ''}
        ${cities.length ? `<div class="panel"><h2 style="font-size:20px">مدن ومناطق قريبة</h2>
          <div class="chips">${cities.map((c) => `<a class="chip" href="/destinations/${attr(c.slug)}">${esc(c.name)}</a>`).join('')}</div></div>` : ''}
        ${programs.length ? `<div>${sectionHead({ eyebrow: 'برامج مرتبطة', title: `برامج تشمل ${d.name}` })}<div class="grid grid-2">${programs.map((p) => programCard(p)).join('')}</div></div>` : `<div>${sectionHead({ eyebrow: 'اقتراحات', title: 'برامج قد تناسبك' })}<div class="grid grid-2">${fallbackPrograms.map((p) => programCard(p)).join('')}</div></div>`}
      </div>
      <aside class="stack sticky-side">
        <div class="panel">
          <h3 style="font-size:17px">بطاقة الوجهة</h3>
          <ul class="fact-list">
            <li><span>النوع</span><b>${d.kind === 'country' ? 'دولة' : 'مدينة'}</b></li>
            ${parent ? `<li><span>الدولة</span><b>${esc(parent.name)}</b></li>` : ''}
            ${d.best_time ? `<li><span>أفضل وقت للزيارة</span><b>${esc(d.best_time)}</b></li>` : ''}
            <li><span>برامج مرتبطة</span><b>${programs.length}</b></li>
          </ul>
          <div class="btn-row mt-3">
            ${d.map_url ? `<a class="btn btn-ghost btn-sm" href="${attr(d.map_url)}" target="_blank" rel="noopener noreferrer">${icon('map', 16)} الخريطة</a>` : ''}
            <a class="btn btn-gold btn-sm" href="/consult?topic=trip">اسأل خبيرًا</a>
          </div>
        </div>
        <div class="panel panel-quiet"><h3 style="font-size:16px">ملاحظة</h3><p style="font-size:13px">أفضل أوقات الزيارة إرشادية وتتغير بحسب الموسم والطقس. راجع خبيرنا قبل تثبيت التواريخ.</p></div>
      </aside>
    </div>
  </section>`;

  return layout({
    settings, path: '/destinations', nonce: ctx.nonce,
    title: `${d.name} — دليل الوجهة وبرامج لوريت`,
    description: clampText(d.summary || `دليل ${d.name}: ما يميزها، أفضل وقت للزيارة، والبرامج المتاحة من لوريت.`, 300),
    canonical: `${ctx.baseUrl}/destinations/${d.slug}`,
    body,
    jsonLd: [{
      '@context': 'https://schema.org', '@type': 'TouristDestination', name: d.name,
      description: clampText(d.summary || d.name, 300),
      image: `${ctx.baseUrl}${artUrl(d.art_key, 2)}`,
      url: `${ctx.baseUrl}/destinations/${d.slug}`,
    }],
  });
}

function citiesOf(db, countrySlug) {
  return q(db, "SELECT * FROM destinations WHERE kind = 'city' AND parent_slug = ? AND published = 1 ORDER BY sort", [countrySlug]);
}

/* ============================ GUIDE ============================ */

export function guidePage(ctx) {
  const { db, settings, query } = ctx;
  const cat = String(query.category || '');
  const all = q(db, "SELECT * FROM articles WHERE status = 'published' ORDER BY published_at DESC");
  const list = cat ? all.filter((a) => a.category === cat) : all;
  const cats = [...new Set(all.map((a) => a.category).filter(Boolean))];

  const body = `
  ${pageHead({
    title: 'دليل السفر',
    sub: 'مقالات عملية تُكتب لتساعدك على القرار: التوقيت، الفنادق، الحقائب، والتأشيرات — بلا مبالغة ولا وعود.',
    crumbs: [{ href: '/', label: 'الرئيسية' }, { label: 'دليل السفر' }],
  })}
  <section class="section-tight">
    <div class="wrap">
      ${cats.length ? `<div class="chips mb-3"><a class="chip ${!cat ? 'is-active' : ''}" href="/guide">كل المقالات</a>${cats.map((c) => `<a class="chip ${cat === c ? 'is-active' : ''}" href="/guide?category=${encodeURIComponent(c)}">${esc(c)}</a>`).join('')}</div>` : ''}
      ${list.length ? `<div class="grid grid-3">${list.map((a) => articleCard(a)).join('')}</div>` : emptyState('لا توجد مقالات منشورة', 'يمكن للفريق إضافة المقالات من لوحة الإدارة.')}
    </div>
  </section>`;

  return layout({
    settings, path: '/guide', nonce: ctx.nonce,
    title: 'دليل السفر — مقالات ونصائح',
    description: 'مقالات سفر من لوريت: أفضل وقت للعمرة، اختيار فندق قريب من الحرم، تجهيز الحقيبة، والتأشيرات للمسافر الأردني.',
    canonical: `${ctx.baseUrl}/guide`,
    body,
    jsonLd: [{
      '@context': 'https://schema.org', '@type': 'Blog', name: 'دليل السفر — لوريت',
      blogPost: list.slice(0, 10).map((a) => ({ '@type': 'BlogPosting', headline: a.title, datePublished: a.published_at, url: `${ctx.baseUrl}/guide/${a.slug}` })),
    }],
  });
}

export function articlePage(ctx, slug) {
  const { db, settings } = ctx;
  const a = one(db, "SELECT * FROM articles WHERE slug = ? AND status = 'published'", [slug]);
  if (!a) return null;
  const more = q(db, "SELECT * FROM articles WHERE slug <> ? AND status = 'published' ORDER BY published_at DESC LIMIT 3", [slug]);
  const programs = searchPrograms(db, { category: a.category === 'دليل السفر' ? undefined : undefined, limit: 3 });

  const body = `
  ${pageHead({
    title: a.title,
    sub: a.excerpt || '',
    crumbs: [{ href: '/', label: 'الرئيسية' }, { href: '/guide', label: 'دليل السفر' }, { label: a.title }],
  })}
  <section class="section-tight">
    <div class="wrap split">
      <article class="stack">
        <div class="source-note">${esc(a.category || '')} · ${esc(a.reading_minutes || 4)} دقائق قراءة · آخر تحديث: ${esc(a.updated_at || a.published_at || '')}</div>
        <div class="panel article-body" style="font-size:15px;line-height:1.9">${markdown(a.body)}</div>
        <div class="notice notice-info">هل تحتاج مساعدة في تطبيق هذا على رحلتك؟ <a href="/consult">أرسل استشارة</a> وسيتواصل معك القسم المختص.</div>
      </article>
      <aside class="stack sticky-side">
        <div class="panel"><h3 style="font-size:16px">برامج قد تفيدك</h3><div class="stack">${programs.map((p) => `<a class="service-tile" href="/programs/${attr(p.slug)}"><span><b>${esc(p.title)}</b><span>${esc(p.days)} أيام · يبدأ من ${esc(p.price_from)} ${esc(p.currency)}</span></span></a>`).join('')}</div></div>
        <div class="panel panel-quiet"><h3 style="font-size:16px">مقالات أخرى</h3><ul style="font-size:13px;padding-inline-start:18px">${more.map((m) => `<li><a href="/guide/${attr(m.slug)}">${esc(m.title)}</a></li>`).join('')}</ul></div>
      </aside>
    </div>
  </section>`;

  return layout({
    settings, path: '/guide', nonce: ctx.nonce,
    title: a.title,
    description: clampText(a.excerpt || a.body, 300),
    canonical: `${ctx.baseUrl}/guide/${a.slug}`,
    body,
    jsonLd: [{
      '@context': 'https://schema.org', '@type': 'Article',
      headline: a.title, description: clampText(a.excerpt || a.body, 300),
      datePublished: a.published_at, dateModified: a.updated_at || a.published_at,
      author: { '@type': 'Organization', name: 'لوريت للسياحة والسفر' },
      publisher: { '@type': 'Organization', name: 'لوريت للسياحة والسفر' },
      mainEntityOfPage: `${ctx.baseUrl}/guide/${a.slug}`,
    }],
  });
}

/* ============================ FAQ ============================ */

export function faqPage(ctx) {
  const { db, settings } = ctx;
  const rows = q(db, 'SELECT * FROM faq WHERE published = 1 ORDER BY sort');
  const groups = { visa: 'التأشيرات', umrah: 'الحج والعمرة', flights: 'الطيران', hotels: 'الفنادق', general: 'عام' };
  const byCat = {};
  for (const r of rows) (byCat[r.category] ||= []).push(r);

  const body = `
  ${pageHead({
    title: 'الأسئلة الشائعة',
    sub: 'إجابات عن الأسئلة التي تصleنا فعلًا: الأمتعة، الأسعار، التأشيرات، العمرة، والفنادق.',
    crumbs: [{ href: '/', label: 'الرئيسية' }, { label: 'الأسئلة الشائعة' }],
  })}
  <section class="section-tight">
    <div class="wrap stack">
      ${Object.entries(byCat).map(([cat, list]) => `<div class="panel">
        <h2 style="font-size:20px">${esc(groups[cat] || cat)}</h2>
        <div class="accordion">${list.map((f) => faqItem(f)).join('')}</div>
      </div>`).join('') || emptyState('لا توجد أسئلة منشورة', 'أضف الأسئلة من لوحة الإدارة.')}
      <div class="cta-band"><div><h2>سؤالك غير موجود؟</h2><p>أرسله وسيصل إلى القسم المختص مع رقم مرجعي.</p></div><a class="btn btn-gold btn-lg" href="/consult">اسأل خبيرًا</a></div>
    </div>
  </section>`;

  return layout({
    settings, path: '/faq', nonce: ctx.nonce,
    title: 'الأسئلة الشائعة — تأشيرات وسفر وعمرة',
    description: 'أسئلة شائعة عن الأمتعة، أسعار التذاكر، التأشيرات، برامج العمرة، والفنادق — مع إجابات واضحة من فريق لوريت.',
    canonical: `${ctx.baseUrl}/faq`,
    body,
    jsonLd: [{
      '@context': 'https://schema.org', '@type': 'FAQPage',
      mainEntity: rows.map((f) => ({ '@type': 'Question', name: f.question, acceptedAnswer: { '@type': 'Answer', text: f.answer } })),
    }],
  });
}

/* ============================ TRACK ============================ */

export function trackPage(ctx) {
  const { settings } = ctx;
  const body = `
  ${pageHead({
    title: 'متابعة طلب',
    sub: 'أدخل الرقم المرجعي ورقم الهاتف الذي استخدمته في الطلب لعرض الحالة والتحديثات.',
    crumbs: [{ href: '/', label: 'الرئيسية' }, { label: 'متابعة طلب' }],
  })}
  <section class="section-tight">
    <div class="wrap-narrow">
      <div class="form-shell">
        <div class="form-head"><h2>حالة الطلب</h2><p>لحماية خصوصيتك نطلب رقم الهاتف نفسه، ونعرض آخر 4 أرقام فقط.</p></div>
        <form class="form-body" id="trackForm">
          <div class="field"><label for="tr-ref">الرقم المرجعي</label><input id="tr-ref" name="reference" placeholder="LT-FL-XXXXXX" dir="ltr" required></div>
          <div class="field"><label for="tr-phone">رقم الهاتف</label><input id="tr-phone" name="phone" type="tel" dir="ltr" placeholder="0791234567" required></div>
          <button class="btn btn-primary btn-lg" type="submit">اعرض الحالة</button>
          <p class="form-status" data-track-status role="status" aria-live="polite"></p>
        </form>
      </div>
      <div id="trackResult" class="mt-3" aria-live="polite"></div>
      <div class="notice notice-info mt-3">لا تملك رقمًا مرجعيًا؟ <a href="/consult">أرسل استشارة</a> أو تواصل عبر واتساب. لا نعرض تفاصيل الطلب لأي شخص لا يملك الرقم والهاتف معًا.</div>
    </div>
  </section>`;

  return layout({ settings, path: '/track', nonce: ctx.nonce, title: 'متابعة طلب', description: 'تابع حالة طلبك في لوريت بالرقم المرجعي ورقم الهاتف.', canonical: `${ctx.baseUrl}/track`, body, robots: 'noindex,follow' });
}

/* ============================ ABOUT / PRIVACY / NEWS ============================ */

export function aboutPage(ctx) {
  const { db, settings } = ctx;
  const counts = {
    programs: one(db, "SELECT COUNT(*) n FROM programs WHERE status IN ('published','sold_out')").n,
    umrah: one(db, "SELECT COUNT(*) n FROM programs WHERE category='umrah' AND status='published'").n,
    cities: one(db, "SELECT COUNT(*) n FROM destinations WHERE kind='city'").n,
  };
  const body = `
  ${pageHead({ title: 'عن لوريت', sub: 'شركة أردنية للسياحة والسفر والحج والعمرة، من فرعي إربد وعمّان.', crumbs: [{ href: '/', label: 'الرئيسية' }, { label: 'عن لوريت' }] })}
  <section class="section-tight">
    <div class="wrap split">
      <div class="stack">
        <div class="panel">
          <h2>من نحن</h2>
          <p>لوريت للسياحة والسفر شركة أردنية تعمل في تنظيم رحلات الحج والعمرة والبرامج السياحية وإصدار تذاكر الطيران وحجوزات الفنادق ومعاملات التأشيرات. نخدم عملاءنا من فرعي إربد وعمّان، ونرافق الرحلة من التخطيط حتى العودة.</p>
          <p>هذا الموقع هو منصتنا العاملة: يعرض برامجنا بأسعارها المنشورة، ويستقبل طلباتكم مباشرة داخل النظام برقم مرجعي، ليتابعها الموظف المختص بدلًا من ضياعها في محادثات متفرقة.</p>
          <ul class="fact-list">
            <li><span>البرامج المنشورة</span><b>${counts.programs} برنامجًا (${counts.umrah} عمرة)</b></li>
            <li><span>مدن في الدليل</span><b>${counts.cities}</b></li>
            <li><span>الفروع</span><b>${(settings.branches || []).length}</b></li>
          </ul>
        </div>
        <div class="panel">
          <h2>التزامنا</h2>
          <ul style="font-size:14px;color:#334E63">
            <li>سعر «يبدأ من» يعني أنه قابل للتغير بحسب الموسم ونوع الغرفة، ولا يُثبَّت إلا في عرض رسمي.</li>
            <li>لا نؤكد توافر رحلة أو فندق إلا من مصدر حجز متصل وموثوق.</li>
            <li>لا نضمن إصدار تأشيرة، ونوضح ذلك قبل أي التزام.</li>
            <li>لا نستلم مستندات حساسة عبر روابط عامة، ولا نشاركها مع أي جهة غير معنية.</li>
          </ul>
        </div>
      </div>
      <aside class="stack sticky-side">
        ${(settings.branches || []).map((b) => `<div class="panel">
          <h3 style="font-size:17px">${esc(b.name)}</h3>
          <ul class="fact-list"><li><span>العنوان</span><b>${esc(b.address)}</b></li><li><span>الهاتف</span><b dir="ltr">${esc(b.phone)}</b></li></ul>
          <div class="btn-row mt-3">
            <a class="btn btn-ghost btn-sm" href="tel:${attr(String(b.phone).replace(/[^\d+]/g, ''))}">اتصل</a>
            ${b.mapUrl ? `<a class="btn btn-quiet btn-sm" href="${attr(b.mapUrl)}" target="_blank" rel="noopener noreferrer">${icon('map', 16)} الموقع</a>` : ''}
          </div>
        </div>`).join('')}
        <div class="panel panel-quiet"><h3 style="font-size:16px">أرقام الفريق</h3><ul class="fact-list">${(settings.contactGroups || []).flatMap((g) => g.items.slice(0, 2).map((i) => `<li><span>${esc(g.g)}</span><b dir="ltr">${esc(i.p)}</b></li>`)).join('')}</ul></div>
      </aside>
    </div>
  </section>`;
  return layout({ settings, path: '/about', nonce: ctx.nonce, title: 'عن لوريت للسياحة والسفر', description: 'لوريت للسياحة والسفر: شركة أردنية للحج والعمرة والبرامج السياحية والطيران والفنادق والتأشيرات، من فرعي إربد وعمّان.', canonical: `${ctx.baseUrl}/about`, body });
}

export function privacyPage(ctx) {
  const { settings } = ctx;
  const body = `
  ${pageHead({ title: 'سياسة الخصوصية', sub: 'ما نجمعه، ولماذا، وكيف تحمي بياناتك.', crumbs: [{ href: '/', label: 'الرئيسية' }, { label: 'سياسة الخصوصية' }] })}
  <section class="section-tight">
    <div class="wrap-narrow stack">
      <div class="panel">
        <h2>ما نجمعه</h2>
        <ul><li>بيانات التواصل التي ترسلها في النماذج: الاسم، الهاتف، البريد، المدينة.</li><li>عند إنشاء حساب: الاسم والبريد المؤكد ورقم الهاتف وتجزئة كلمة المرور وبيانات الجلسة؛ يمر رمز التأكيد المؤقت عبر مزود البريد Resend ولا يُخزّن كنص صريح.</li><li>تفاصيل الطلب: الوجهة، التواريخ، عدد المسافرين، وتفضيلاتك.</li><li>بيانات تقنية محدودة لحماية الموقع من الإساءة (مثل عنوان IP ووقت الطلب).</li></ul>
        <h2>لماذا</h2>
        <p>لمعالجة طلبك والتواصل معك بشأنه، ولإصدار عروض الأسعار والمستندات اللازمة لخدمتك. لا نستخدم بياناتك لتسويق غير مطلوب دون موافقة منفصلة.</p>
        <h2>من يراها</h2>
        <p>فريق لوريت المختص فقط، ومزودو الخدمة المعنيون بالطلب (شركة طيران، فندق، جهة تأشيرات). يستخدم البريد الإلكتروني Resend لتوصيل رمز التحقق. لا نبيع البيانات ولا نشاركها لأي غرض آخر.</p>
        <h2>التنبيهات والتنسيق الداخلي (n8n)</h2>
        <p>لضمان سرعة الرد وتنسيق الفريق، تُرسل تفاصيل الطلب آليًا إلى نظام الأتمتة الداخلي لدينا (n8n) الذي نشغّله، ثم إلى <b>جداول Google Sheets</b> خاصة بالشركة وإلى <b>بريد Gmail</b> لفريق الحجز. ما يُرسل: الرقم المرجعي، نوع الطلب، الاسم، رقم الهاتف، البريد إن أدخلته، ملخص الطلب والملاحظات، وحالة الطلب عند تغيّرها.</p>
        <p>قاعدة بيانات الموقع هي المصدر الرسمي للطلب وحالته؛ الجدول والبريد نسخة للتنبيه فقط. الوصول إلى الجدول والبريد مقصور على الموظفين المخوّلين، ولا تُرسل كلمة المرور أو بيانات الدفع أو صور الوثائق إلى هذه الأنظمة.</p>
        <p>إن كانت لديك ملاحظة لا ترغب بمشاركتها مع فريق التنبيه، اكتبها في خانة الملاحظات مع عبارة «للإدارة فقط» أو أرسلها مباشرة إلى الفرع.</p>
        <h2>حسابك</h2>
        <p>يمكنك مراجعة طلباتك المرتبطة ببريدك المؤكد وتحديث اسمك ورقم هاتفك من صفحة حسابك. جلسة الحساب تستخدم ملف تعريف ارتباط محميًا، ولا يمكن لعميل آخر الوصول إلى حجوزاتك.</p>
        <h2>المستندات الحساسة</h2>
        <p>لا تُرسل صور الجوازات عبر النماذج أو روابط عامة. تُسلَّم في الفرع أو عبر قناة آمنة يحددها الموظف، وتُحفظ بصلاحيات وصول محددة.</p>
        <h2>المحادثات مع المساعد</h2>
        <p>لا نحفظ محادثات المساعد الآلي إلا بموافقتك. عند الموافقة تُحفظ لتحسين جودة الردود ومتابعة الطلبات، ويمكنك طلب حذفها بالتواصل معنا.</p>
        <h2>حقوقك</h2>
        <p>يمكنك طلب الوصول إلى بياناتك أو تصحيحها أو حذفها بمراسلة الفرع. نحتفظ ببيانات الطلبات للمدة اللازمة للمحاسبة والالتزامات القانونية. وعند طلب الحذف نحذف السجل من الموقع ومن جدول التنبيهات معًا.</p>
        <p class="source-note">آخر تحديث لهذه السياسة: ${esc(settings.lastContentUpdate || '2026-10-23')}.</p>
      </div>
    </div>
  </section>`;
  return layout({ settings, path: '/privacy', nonce: ctx.nonce, title: 'سياسة الخصوصية', description: 'سياسة خصوصية لوريت: البيانات التي نجمعها، الغرض منها، ومن يصل إليها، وحقوقك.', canonical: `${ctx.baseUrl}/privacy`, body });
}

export function newsPage(ctx) {
  const { db, settings } = ctx;
  const news = q(db, 'SELECT * FROM news ORDER BY urgent DESC, published_at DESC');
  const body = `
  ${pageHead({ title: 'أخبار الطيران', sub: 'تعاميم وتحديثات صادرة عن شركات الطيران، تُنشر يدويًا من لوحة الإدارة.', crumbs: [{ href: '/', label: 'الرئيسية' }, { label: 'أخبار الطيران' }] })}
  <section class="section-tight">
    <div class="wrap-narrow stack">
      ${news.length ? news.map((n) => `<article class="panel" id="n-${n.id}">
        <div class="badge-row mb-2">${n.urgent ? '<span class="badge badge-danger">عاجل</span>' : ''}<span class="badge badge-soft">${esc(n.airline || '')}</span><span class="badge badge-line">${esc(n.published_at || '')}</span></div>
        <h2 style="font-size:19px">${esc(n.title)}</h2>
        ${String(n.body || '').split('\n').filter(Boolean).map((line) => `<p style="font-size:14px;color:#334E63">${esc(line)}</p>`).join('')}
      </article>`).join('') : emptyState('لا توجد أخبار منشورة', 'ستظهر تعاميم شركات الطيران هنا عند إضافتها.')}
    </div>
  </section>`;
  return layout({ settings, path: '/news', nonce: ctx.nonce, title: 'أخبار الطيران والتعاميم', description: 'تعاميم وتحديثات شركات الطيران التي تهم المسافرين من الأردن.', canonical: `${ctx.baseUrl}/news`, body });
}

export function offlinePage(ctx) {
  const { settings } = ctx;
  const body = `${pageHead({ title: 'الصفحة غير موجودة', sub: 'الرابط قديم أو مكتوب بشكل غير صحيح.' })}
  <section class="section"><div class="wrap-narrow center">
    <p class="lead">جرّب الصفحات التالية:</p>
    <div class="btn-row" style="justify-content:center"><a class="btn btn-primary" href="/">الرئيسية</a><a class="btn btn-ghost" href="/programs">البرامج</a><a class="btn btn-ghost" href="/umrah">العمرة</a><a class="btn btn-ghost" href="/consult">استشارة</a></div>
  </div></section>`;
  return layout({ settings, path: '/404', nonce: ctx.nonce, title: 'الصفحة غير موجودة', description: 'الصفحة المطلوبة غير موجودة.', body, robots: 'noindex,follow' });
}
