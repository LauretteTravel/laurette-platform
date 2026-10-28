/* ============================================================
   Laurette — booking voucher generator
   Used by the staff area (request drawer) and by the public
   "track request" result. Renders an A4 sheet that can be
   printed or exported to PDF with jsPDF + html2canvas.
   Both libraries are self-hosted under /vendor and loaded
   lazily only when a PDF is requested.
   ============================================================ */
(() => {
  'use strict';

  const VENDOR = { html2canvas: '/assets/vendor/html2canvas.min.js', jspdf: '/assets/vendor/jspdf.umd.min.js' };

  const LABELS = {
    ar: {
      docTitle: 'قسيمة حجز', docSub: 'Booking Voucher', ref: 'الرقم المرجعي',
      issued: 'تاريخ الإصدار', customer: 'اسم العميل', phone: 'الهاتف', email: 'البريد الإلكتروني',
      status: 'حالة الطلب', service: 'نوع الخدمة', details: 'تفاصيل الخدمة', programme: 'البرنامج', dates: 'التواريخ',
      travellers: 'المسافرون', rooms: 'الغرف', route: 'المسار', price: 'السعر', from: 'يبدأ من',
      quote: 'عرض السعر', notPriced: 'السعر عند الطلب', summary: 'ملخص الطلب',
      terms: 'شروط وملاحظات', print: 'طباعة', pdf: 'تنزيل PDF', close: 'إغلاق',
      preparing: 'جارٍ تجهيز الملف…', printHint: 'اختر «حفظ كـ PDF» من نافذة الطباعة.',
      fallback: 'تعذّر تجهيز PDF هنا؛ فُتحت نافذة الطباعة بدلًا منها.',
      adult: 'بالغ', child: 'طفل', infant: 'رضيع', night: 'ليلة', day: 'يوم',
      term1: 'هذه القسيمة صادرة إلكترونيًا من منصة لوريت، وتُستخدم للتعريف بالطلب ومتابعته.',
      term2: 'الأسعار للشخص الواحد وتخضع للتوافر والموسم، والسعر المعتمد هو الصادر في عرض رسمي.',
      term3: 'لا تُعدّ هذه القسيمة فاتورة ضريبية ولا تأكيدًا نهائيًا إلا إذا كانت حالة الطلب «تم التأكيد».',
      term4: 'يُرجى إبراز الرقم المرجعي عند التواصل مع الفريق أو عند الوصول.',
      confirmed: 'حجز مؤكد', signCustomer: 'توقيع العميل', signCompany: 'عن شركة لوريت',
      page: 'صفحة 1 من 1',
    },
    en: {
      docTitle: 'Booking Voucher', docSub: 'قسيمة حجز', ref: 'Reference',
      issued: 'Issue date', customer: 'Customer', phone: 'Phone', email: 'Email',
      status: 'Status', service: 'Service', details: 'Service details', programme: 'Programme', dates: 'Dates',
      travellers: 'Travellers', rooms: 'Rooms', route: 'Route', price: 'Price', from: 'From',
      quote: 'Quotation', notPriced: 'Price on request', summary: 'Request summary',
      terms: 'Terms & notes', print: 'Print', pdf: 'Download PDF', close: 'Close',
      preparing: 'Preparing the file…', printHint: 'Choose “Save as PDF” in the print dialog.',
      fallback: 'PDF export is unavailable here; the print dialog was opened instead.',
      adult: 'adult', child: 'child', infant: 'infant', night: 'night', day: 'day',
      term1: 'This voucher is issued electronically by Laurette and identifies your request for follow-up.',
      term2: 'Prices are per person and subject to availability and season; the confirmed price is the one in an official quotation.',
      term3: 'This voucher is not a tax invoice and is not a final confirmation unless the request status is “Confirmed”.',
      term4: 'Please quote the reference number when contacting our team or on arrival.',
      confirmed: 'Confirmed', signCustomer: 'Customer signature', signCompany: 'For Laurette',
      page: 'Page 1 of 1',
    },
  };

  const esc = (value) => String(value == null ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  const money = (amount, currency, lang) => {
    if (amount == null || amount === '') return '';
    const n = Number(amount);
    if (!Number.isFinite(n)) return String(amount);
    const formatted = n.toLocaleString(lang === 'en' ? 'en-US' : 'ar-JO', { maximumFractionDigits: 2 });
    const cur = String(currency || 'JOD');
    const shown = lang === 'en' ? (cur === 'د.أ' ? 'JOD' : cur) : (cur === 'JOD' ? 'د.أ' : cur);
    return `${formatted} ${shown}`;
  };

  const dateText = (value, lang) => {
    if (!value) return '';
    const raw = String(value);
    const parsed = new Date(raw.length <= 10 ? `${raw}T12:00:00` : raw);
    if (Number.isNaN(parsed.getTime())) return raw;
    return parsed.toLocaleDateString(lang === 'en' ? 'en-GB' : 'ar-JO', { year: 'numeric', month: 'short', day: 'numeric' });
  };

  const cleanPhone = (value) => String(value || '').replace(/\D/g, '');

  function normalize(request) {
    const r = request || {};
    const p = r.payload || {};
    const type = r.type || 'program';
    const adults = Number(p.adults || 0);
    const children = Number(p.children || 0);
    const infants = Number(p.infants || 0);
    const hasPax = adults + children + infants > 0;
    const pax = hasPax
      ? [
        adults ? `${adults}` : '', children ? `${children}` : '', infants ? `${infants}` : '',
      ]
      : [];

    let route = '';
    if (type === 'flight') {
      const legs = Array.isArray(p.segments) ? p.segments : [];
      if (legs.length) route = legs.map((s) => `${s.from || '?'} → ${s.to || '?'}`).join(' · ');
      else if (p.origin || p.destination) route = `${p.origin || '?'} → ${p.destination || '?'}`;
    }

    const dates = [];
    const pushDate = (label, value) => { if (value) dates.push({ label, value }); };
    if (type === 'hotel') {
      pushDate('checkIn', p.checkIn);
      pushDate('checkOut', p.checkOut);
    } else {
      pushDate('travel', p.departDate || p.preferredDate || p.travelDate);
      pushDate('return', p.returnDate);
    }

    return {
      reference: r.reference || '',
      type,
      typeLabel: r.typeLabel || r.type || '',
      statusLabel: r.statusLabel || r.status || '',
      status: r.status || '',
      title: r.title || p.programTitle || '',
      summary: r.summary || '',
      customer: p.name || r.customerName || '',
      phone: p.phone || '',
      email: p.email || '',
      createdAt: r.createdAt || r.created_at || '',
      adults, children, infants, hasPax,
      rooms: Number(p.rooms || 0),
      route,
      dates,
      price: r.quote && r.quote.amount != null ? r.quote.amount : (p.priceFromAtRequest != null ? p.priceFromAtRequest : null),
      priceKind: r.quote && r.quote.amount != null ? 'quote' : 'from',
      currency: (r.quote && r.quote.currency) || p.currency || 'JOD',
      quoteNote: (r.quote && r.quote.note) || '',
      nights: Number(r.nights || p.nights || 0),
      days: Number(r.days || p.days || 0),
      optionLabel: p.optionLabel || '',
      branch: r.branch || p.branch || '',
    };
  }

  function row(label, value) {
    if (!value) return '';
    return `<div class="voucher-row"><span>${esc(label)}</span><b>${esc(value)}</b></div>`;
  }

  function buildSheet(data, settings, lang) {
    const t = LABELS[lang];
    const dict = lang === 'en' ? window.__voucherDict || null : null;
    const tr = (value) => {
      if (!dict || value == null || value === '') return value;
      const hit = dict[String(value).trim()];
      return hit || value;
    };
    const dir = lang === 'en' ? 'ltr' : 'rtl';
    const brand = settings.brand || (lang === 'en' ? 'Laurette Travel, Tourism, Hajj & Umrah' : 'لوريت للسياحة والسفر والحج والعمرة');
    const short = settings.brandShort || (lang === 'en' ? 'Laurette' : 'لوريت');
    const branches = Array.isArray(settings.branches) ? settings.branches : [];
    const branchLine = branches.map((b) => `${b.name || ''}${b.phone ? `: ${b.phone}` : ''}`).join('  ·  ');

    const travellers = [];
    if (data.adults) travellers.push(`${data.adults} ${t.adult}`);
    if (data.children) travellers.push(`${data.children} ${t.child}`);
    if (data.infants) travellers.push(`${data.infants} ${t.infant}`);

    const detailRows = [
      row(t.service, tr(data.typeLabel)),
      row(t.programme, tr(data.title)),
      row(t.route, data.route),
      ...data.dates.map((d) => row(d.label === 'checkIn' ? (lang === 'en' ? 'Check-in' : 'تاريخ الدخول')
        : d.label === 'checkOut' ? (lang === 'en' ? 'Check-out' : 'تاريخ الخروج')
          : d.label === 'return' ? (lang === 'en' ? 'Return' : 'تاريخ العودة')
            : (lang === 'en' ? 'Travel date' : 'تاريخ السفر'), dateText(d.value, lang))),
      row(t.travellers, travellers.join(' · ')),
      row(t.rooms, data.rooms ? String(data.rooms) : ''),
      row(lang === 'en' ? 'Room / option' : 'الغرفة / الخيار', data.optionLabel),
    ].filter(Boolean).join('');

    const priceText = data.price != null ? money(data.price, data.currency, lang) : t.notPriced;
    const priceLabel = data.priceKind === 'quote' ? t.quote : t.from;

    const terms = [t.term1, t.term2, t.term3, t.term4];

    return `
<article class="voucher-sheet" dir="${dir}" data-lang="${lang}" data-ref="${esc(data.reference)}">
  <header class="voucher-head">
    <div class="voucher-brand">
      <span class="voucher-brand-mark" aria-hidden="true">${lang === 'en' ? 'L' : 'ل'}</span>
      <div><b>${esc(short)}</b><span>${esc(brand)}</span></div>
    </div>
    <div class="voucher-doc">
      <h1>${esc(t.docTitle)}</h1>
      <span class="en">${esc(t.docSub)}</span>
      <div class="voucher-ref"><span aria-hidden="true">#</span>${esc(data.reference || '—')}</div>
    </div>
  </header>

  <section class="voucher-meta">${(() => {
    const branchLabel = lang === 'en' ? 'Branch' : 'الفرع';
    const pairs = [
      [[t.customer, data.customer], [t.phone, data.phone]],
      [[t.email, data.email], [t.status, tr(data.statusLabel)]],
      [[t.issued, dateText(data.createdAt, lang)], data.branch ? [branchLabel, tr(data.branch)] : null],
    ];
    const cell = (pair) => (pair && pair[1]
      ? `<div class="voucher-row"><span>${esc(pair[0])}</span><b>${esc(pair[1])}</b></div>`
      : '<div class="voucher-row is-empty" aria-hidden="true"></div>');
    return pairs.flatMap((pair) => pair.map(cell)).join('');
  })()}</section>

  <h2 class="voucher-section-title">${esc(t.details)}</h2>
  <section class="voucher-meta">${detailRows}</section>

  ${(() => {
    const summaryText = lang === 'en' && /[\u0600-\u06FF]/.test(tr(data.summary)) ? (tr(data.title) || '') : tr(data.summary);
    const duplicateTitle = lang === 'en' && summaryText && summaryText === tr(data.title);
    return summaryText && !duplicateTitle ? `<h2 class="voucher-section-title">${esc(t.summary)}</h2><div class="voucher-summary">${esc(summaryText)}</div>` : '';
  })()}

  <div class="voucher-price">
    <div><small>${esc(priceLabel)}</small><b>${esc(priceText)}</b></div>
    <div class="cur">${esc(tr(data.quoteNote) || '')}</div>
  </div>

  <section class="voucher-terms">
    <b>${esc(t.terms)}</b>
    <ul>${terms.map((line) => `<li>${esc(line)}</li>`).join('')}</ul>
    <div class="voucher-sign"><div>${esc(t.signCustomer)}</div><div>${esc(t.signCompany)}</div></div>
  </section>

  <footer class="voucher-foot">
    <span>${branchLine ? `<b>${esc(branchLine)}</b>` : ''}</span>
    <span>${esc(t.page)}</span>
  </footer>
</article>`;
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      if (document.querySelector(`script[src="${src}"]`)) return resolve();
      const script = document.createElement('script');
      script.src = src;
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error(`Failed to load ${src}`));
      document.head.appendChild(script);
    });
  }

  async function ensurePdfLibs() {
    if (!window.html2canvas) await loadScript(VENDOR.html2canvas);
    if (!window.jspdf) await loadScript(VENDOR.jspdf);
    if (!window.html2canvas || !window.jspdf) throw new Error('PDF libraries unavailable');
  }

  function close() {
    document.body.classList.remove('voucher-printing');
    document.querySelector('.voucher-overlay')?.remove();
    document.removeEventListener('keydown', onKey);
  }

  function onKey(event) {
    if (event.key === 'Escape') close();
  }

  const state = { request: null, settings: {}, lang: 'ar' };

  function renderOverlay() {
    const overlay = document.createElement('div');
    overlay.className = 'voucher-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.innerHTML = `
      <div class="voucher-toolbar">
        <div class="voucher-lang" role="group" aria-label="Language">
          <button type="button" data-vlang="ar" class="${state.lang === 'ar' ? 'is-active' : ''}">عربي</button>
          <button type="button" data-vlang="en" class="${state.lang === 'en' ? 'is-active' : ''}">EN</button>
        </div>
        <span class="voucher-note" data-vnote role="status"></span>
        <span class="spacer"></span>
        <button type="button" class="btn btn-ghost btn-sm" data-vprint>${LABELS[state.lang].print}</button>
        <button type="button" class="btn btn-primary btn-sm" data-vpdf>${LABELS[state.lang].pdf}</button>
        <button type="button" class="btn btn-ghost btn-sm" data-vclose>${LABELS[state.lang].close}</button>
      </div>
      <div class="voucher-stage"></div>`;
    document.body.appendChild(overlay);
    document.body.classList.remove('voucher-printing');
  }

  function paint() {
    const stage = document.querySelector('.voucher-stage');
    if (!stage) return;
    const data = normalize(state.request);
    stage.innerHTML = buildSheet(data, state.settings, state.lang);
    document.querySelectorAll('[data-vlang]').forEach((b) => b.classList.toggle('is-active', b.dataset.vlang === state.lang));
    const note = document.querySelector('[data-vnote]');
    if (note) note.textContent = '';
  }

  async function printVoucher() {
    document.body.classList.add('voucher-printing');
    await new Promise((resolve) => setTimeout(resolve, 120));
    window.print();
    setTimeout(() => document.body.classList.remove('voucher-printing'), 800);
  }

  async function downloadPdf() {
    const sheet = document.querySelector('.voucher-sheet');
    const note = document.querySelector('[data-vnote]');
    if (!sheet) return;
    if (note) note.textContent = LABELS[state.lang].preparing;
    try {
      await ensurePdfLibs();
      const canvas = await window.html2canvas(sheet, {
        scale: Math.min(2, window.devicePixelRatio > 1 ? 2 : 1.5),
        backgroundColor: '#ffffff',
        useCORS: true,
        logging: false,
        windowWidth: sheet.scrollWidth,
      });
      const { jsPDF } = window.jspdf;
      const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
      const pageW = 210;
      const pageH = 297;
      const ratio = canvas.height / canvas.width;
      let imgW = pageW;
      let imgH = pageW * ratio;
      if (imgH > pageH) { imgH = pageH; imgW = pageH / ratio; }
      doc.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', (pageW - imgW) / 2, 0, imgW, imgH);
      const ref = (normalize(state.request).reference || 'voucher').replace(/[^\w-]+/g, '');
      doc.save(`Laurette-${ref}.pdf`);
      if (note) note.textContent = '';
    } catch (err) {
      if (note) note.textContent = LABELS[state.lang].fallback;
      await printVoucher();
    }
  }

  async function fetchSettings() {
    try {
      const res = await fetch('/api/settings', { headers: { 'x-requested-with': 'fetch' } });
      if (res.ok) {
        const data = await res.json();
        if (data && data.settings) return data.settings;
      }
    } catch { /* ignore */ }
    return {};
  }

  async function ensureDict() {
    if (window.__voucherDict) return;
    try {
      const res = await fetch('/i18n/en.json');
      if (res.ok) window.__voucherDict = await res.json();
    } catch { /* ignore */ }
  }

  async function open({ request, settings, lang } = {}) {
    close();
    state.request = request || {};
    state.lang = lang || (document.documentElement.lang === 'en' ? 'en' : 'ar');
    state.settings = settings || await fetchSettings();
    if (state.lang === 'en') await ensureDict();
    renderOverlay();
    paint();
    document.addEventListener('keydown', onKey);

    const overlay = document.querySelector('.voucher-overlay');
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) close();
      const langBtn = event.target.closest('[data-vlang]');
      if (langBtn) {
        state.lang = langBtn.dataset.vlang;
        if (state.lang === 'en') ensureDict().then(() => { paint(); renderToolbarLabels(); });
        else { paint(); renderToolbarLabels(); }
      }
      if (event.target.closest('[data-vclose]')) close();
      if (event.target.closest('[data-vprint]')) printVoucher();
      if (event.target.closest('[data-vpdf]')) downloadPdf();
    });
  }

  function renderToolbarLabels() {
    const t = LABELS[state.lang];
    const map = { '[data-vprint]': t.print, '[data-vpdf]': t.pdf, '[data-vclose]': t.close };
    Object.entries(map).forEach(([selector, text]) => {
      const el = document.querySelector(selector);
      if (el) el.textContent = text;
    });
  }

  window.VoucherGenerator = { open, close, print: printVoucher, downloadPdf };
})();
