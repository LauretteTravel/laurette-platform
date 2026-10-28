/* ============================================================
   Laurette — Manual Booking Voucher (standalone studio)
   Original design: navy/orange, Playfair + Inter, A4 sheet.
   No dependency on booking forms or the requests API.
   ============================================================ */
(() => {
  'use strict';

  const LOGO = '/assets/img/laurette-logo.png';
  const DRAFT_KEY = 'laurette.voucher.draft.v1';
  const VENDOR = { html2canvas: '/assets/vendor/html2canvas.min.js', jspdf: '/assets/vendor/jspdf.umd.min.js' };

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const today = () => new Date().toISOString().slice(0, 10);

  function defaults(settings = {}) {
    return {
      voucherType: 'travel',
      orderId: '',
      reservationCode: '',
      airlinePnr: '',
      issueDate: today(),
      issuingOffice: settings.brandShort || 'لوريت للسياحة والسفر',
      paymentMethod: 'Cash',
      passengers: [{ name: '', type: 'Adult', ticketNumber: '', seat: 'Check-In Required' }],
      flights: [{ date: '', flightNumber: '', airline: 'Turkish Airlines', from: '', fromCode: '', to: '', toCode: '', departTime: '', arriveTime: '', cabin: 'Economy', aircraft: '' }],
      baggage: { checkedKg: 23, cabinKg: 8, perPassenger: true },
      hotels: [{ name: '', stars: 4, city: '', address: '', checkInDate: '', checkOutDate: '', nights: 1, checkInTime: '14:00', checkOutTime: '12:00', amenities: '' }],
      dailyProgram: [{ dayNumber: 1, date: '', title: '', location: '', schedule: [{ time: '', activity: '', description: '' }] }],
      notes: [
        'Please verify flight times prior to departure. Schedule changes may occur without prior notice.',
        'Online check-in opens 24 hours before departure.',
        'Passengers must present a valid passport and this e-ticket receipt at the airport.',
      ],
      terms: [
        'All bookings are subject to Laurette Travel terms & conditions.',
        'Cancellation fees may apply according to airline/hotel policies.',
        'Travel insurance is recommended for all international trips.',
      ],
      contactPhone: settings.whatsapp ? `+${String(settings.whatsapp).replace(/\D/g, '')}` : '',
      contactEmail: settings.email || '',
      logo: LOGO,
    };
  }

  const app = { root: null, data: null, step: 1, pane: 'form', settings: {}, saveTimer: null, scale: 1 };

  /* ---------------- data helpers ---------------- */
  const get = (path) => path.split('.').reduce((obj, key) => (obj == null ? obj : obj[key]), app.data);
  function setPath(path, value) {
    const keys = path.split('.');
    let obj = app.data;
    for (let i = 0; i < keys.length - 1; i += 1) {
      const k = keys[i];
      if (obj[k] == null) obj[k] = /^\d+$/.test(keys[i + 1]) ? [] : {};
      obj = obj[k];
    }
    obj[keys[keys.length - 1]] = value;
  }

  function loadDraft(initial) {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (!raw) return initial;
      const parsed = JSON.parse(raw);
      return { ...initial, ...parsed, logo: LOGO };
    } catch {
      return initial;
    }
  }

  function saveDraft() {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(app.data));
      const note = $('.vs-draft', app.root);
      if (note) {
        note.textContent = 'تم حفظ المسودة';
        clearTimeout(app.saveTimer);
        app.saveTimer = setTimeout(() => { note.textContent = 'المسودة تُحفظ تلقائيًا على هذا الجهاز'; }, 1800);
      }
    } catch { /* ignore */ }
  }

  /* ---------------- date helpers ---------------- */
  function fmtDate(value) {
    if (!value) return '—';
    const d = new Date(value.length <= 10 ? `${value}T12:00:00` : value);
    if (Number.isNaN(d.getTime())) return value;
    return d.toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });
  }
  const shortDate = (value) => {
    if (!value) return '—';
    const d = new Date(value.length <= 10 ? `${value}T12:00:00` : value);
    if (Number.isNaN(d.getTime())) return value;
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
  };
  const nightsBetween = (a, b) => {
    if (!a || !b) return 0;
    const diff = Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86400000);
    return Number.isFinite(diff) && diff > 0 ? diff : 0;
  };

  /* ---------------- shell ---------------- */
  function shell() {
    const d = app.data;
    return `
<div class="vs-studio" data-pane="${app.pane}">
  <div class="vs-toolbar">
    <div>
      <h2>قسيمة حجز يدوية</h2>
      <div class="vs-sub">أداة مستقلة داخل لوحة الموظفين — لا ترتبط بنماذج الحجز أو الطلبات.</div>
    </div>
    <span class="spacer"></span>
    <span class="vs-draft">المسودة تُحفظ تلقائيًا على هذا الجهاز</span>
    <button type="button" class="vs-btn" data-vs="reset">مسودة جديدة</button>
    <button type="button" class="vs-btn is-primary" data-vs="pdf">تنزيل PDF</button>
    <button type="button" class="vs-btn is-accent" data-vs="print">طباعة</button>
  </div>

  <div class="vs-mobile-tabs">
    <button type="button" class="vs-btn ${app.pane === 'form' ? 'is-primary' : ''}" data-vs-pane="form">النموذج</button>
    <button type="button" class="vs-btn ${app.pane === 'preview' ? 'is-primary' : ''}" data-vs-pane="preview">المعاينة</button>
  </div>

  <div class="vs-layout">
    <section class="vs-form">
      <nav class="vs-steps" aria-label="خطوات القسيمة">
        ${steps().map((s, i) => `<button type="button" data-vs-step="${i + 1}" class="${app.step === i + 1 ? 'is-active' : ''} ${app.step > i + 1 ? 'is-done' : ''}">${i + 1}. ${s.short}</button>`).join('')}
      </nav>
      <div class="vs-step" id="vsStep"></div>
      <div class="vs-actions">
        <button type="button" class="vs-btn" data-vs="prev" ${app.step === 1 ? 'disabled' : ''}>السابق</button>
        <span class="spacer"></span>
        <button type="button" class="vs-btn is-primary" data-vs="next" ${app.step === steps().length ? 'disabled' : ''}>التالي</button>
      </div>
    </section>

    <aside class="vs-preview">
      <div class="vs-preview-head"><span>معاينة مباشرة — A4</span><span class="spacer"></span><span>${d.voucherType === 'travel' ? 'Travel Plan' : 'Flight Voucher'}</span></div>
      <div class="vs-paper-wrap">
        <div class="vs-paper-scale" id="vsScale"><article class="vs-sheet" id="vsSheet">${previewHtml()}</article></div>
      </div>
    </aside>
  </div>
</div>`;
  }

  function steps() {
    return [
      { id: 'type', short: 'النوع' },
      { id: 'booking', short: 'الحجز' },
      { id: 'pax', short: 'المسافرون' },
      { id: 'flights', short: 'الرحلات' },
      { id: 'stay', short: 'الإقامة' },
      { id: 'program', short: 'البرنامج' },
      { id: 'notes', short: 'الشروط' },
      { id: 'review', short: 'الإصدار' },
    ];
  }

  /* ---------------- step forms ---------------- */
  function field(label, path, opts = {}) {
    const value = get(path) ?? '';
    if (opts.type === 'select') {
      return `<label class="vs-field"><span>${esc(label)}</span><select data-path="${path}">${opts.options.map(([v, l]) => `<option value="${esc(v)}" ${String(v) === String(value) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>`;
    }
    if (opts.type === 'textarea') {
      return `<label class="vs-field ${opts.full ? 'vs-full' : ''}"><span>${esc(label)}</span><textarea data-path="${path}" rows="${opts.rows || 3}" placeholder="${esc(opts.placeholder || '')}">${esc(value)}</textarea></label>`;
    }
    return `<label class="vs-field ${opts.full ? 'vs-full' : ''}"><span>${esc(label)}</span><input type="${opts.type || 'text'}" data-path="${path}" value="${esc(value)}" placeholder="${esc(opts.placeholder || '')}" ${opts.min != null ? `min="${opts.min}"` : ''}></label>`;
  }

  function renderStep() {
    const host = $('#vsStep');
    if (!host) return;
    const step = steps()[app.step - 1].id;
    host.innerHTML = ({
      type: renderType, booking: renderBooking, pax: renderPax, flights: renderFlights,
      stay: renderStay, program: renderProgram, notes: renderNotes, review: renderReview,
    })[step]();
    $$('[data-vs-step]').forEach((b) => b.classList.toggle('is-active', Number(b.dataset.vsStep) === app.step));
  }

  function renderType() {
    const d = app.data;
    const card = (value, title, sub) => `
      <button type="button" class="vs-row-card" data-vs-type="${value}" style="text-align:start;cursor:pointer;${d.voucherType === value ? 'border-color:#1e3a8a;box-shadow:0 0 0 2px rgba(30,58,138,.12)' : ''}">
        <b style="color:#1e3a8a;font-size:14px">${title}</b>
        <div style="font-size:12px;color:#6b7280;margin-top:4px">${sub}</div>
      </button>`;
    return `
      <h3>نوع القسيمة</h3>
      <p class="vs-hint">اختر نوع المستند ثم أكمل البيانات. كل شيء قابل للتعديل قبل الإصدار.</p>
      <div class="vs-grid">
        ${card('travel', 'Travel Plan — قسيمة برنامج سفر', 'رحلات + فنادق + برنامج يومي + شروط')}
        ${card('flight', 'Flight Voucher — قسيمة طيران', 'رحلات + مسافرون + أمتعة + شروط')}
      </div>`;
  }

  function renderBooking() {
    return `
      <h3>بيانات الحجز</h3>
      <p class="vs-hint">هذه الحقول تظهر في شريط الرموز أعلى القسيمة.</p>
      <div class="vs-grid">
        ${field('Order ID', 'orderId', { placeholder: 'ORD-2026-001' })}
        ${field('Reservation Code', 'reservationCode', { placeholder: 'ABC123' })}
        ${field('Airline PNR', 'airlinePnr', { placeholder: '6X7Y2Z' })}
        ${field('تاريخ الإصدار', 'issueDate', { type: 'date' })}
        ${field('مكتب الإصدار', 'issuingOffice')}
        ${field('طريقة الدفع', 'paymentMethod', { type: 'select', options: [['Cash', 'Cash'], ['Card', 'Card'], ['Bank Transfer', 'Bank Transfer'], ['آجل', 'آجل']] })}
      </div>`;
  }

  function renderPax() {
    const rows = app.data.passengers.map((p, i) => `
      <div class="vs-row-card">
        <div class="vs-row-head"><b>مسافر ${i + 1}</b><span class="spacer"></span><button type="button" class="vs-icon-btn" data-vs-remove="passengers.${i}" title="حذف">×</button></div>
        <div class="vs-grid">
          ${field('الاسم كما في الجواز', `passengers.${i}.name`, { full: true })}
          ${field('النوع', `passengers.${i}.type`, { type: 'select', options: [['Adult', 'Adult'], ['Child', 'Child'], ['Infant', 'Infant']] })}
          ${field('رقم التذكرة', `passengers.${i}.ticketNumber`, { placeholder: '176-XXXXXXXXXX' })}
          ${field('المقعد / الحالة', `passengers.${i}.seat`, { placeholder: 'Check-In Required' })}
        </div>
      </div>`).join('');
    return `
      <h3>المسافرون</h3>
      <p class="vs-hint">أضف كل مسافر بسطر منفصل. تظهر الأسماء في القسيمة وفي شريط الرحلة.</p>
      ${rows || '<div class="vs-empty">لا يوجد مسافرون بعد.</div>'}
      <button type="button" class="vs-add" data-vs-add="passengers">+ إضافة مسافر</button>`;
  }

  function renderFlights() {
    const rows = app.data.flights.map((f, i) => `
      <div class="vs-row-card">
        <div class="vs-row-head"><b>رحلة ${i + 1}</b><span class="spacer"></span><button type="button" class="vs-icon-btn" data-vs-remove="flights.${i}" title="حذف">×</button></div>
        <div class="vs-grid">
          ${field('التاريخ', `flights.${i}.date`, { type: 'date' })}
          ${field('رقم الرحلة', `flights.${i}.flightNumber`, { placeholder: 'TK 1017' })}
          ${field('شركة الطيران', `flights.${i}.airline`)}
          ${field('الدرجة', `flights.${i}.cabin`, { type: 'select', options: [['Economy', 'Economy'], ['Business', 'Business'], ['First', 'First']] })}
          ${field('من (مدينة)', `flights.${i}.from`)}
          ${field('رمز المطار', `flights.${i}.fromCode`, { placeholder: 'AMM' })}
          ${field('إلى (مدينة)', `flights.${i}.to`)}
          ${field('رمز المطار', `flights.${i}.toCode`, { placeholder: 'IST' })}
          ${field('الإقلاع', `flights.${i}.departTime`, { type: 'time' })}
          ${field('الوصول', `flights.${i}.arriveTime`, { type: 'time' })}
        </div>
      </div>`).join('');
    return `
      <h3>الرحلات</h3>
      <p class="vs-hint">الرحلة الأولى تحدد عنوان المسار في القسيمة.</p>
      ${rows || '<div class="vs-empty">لا توجد رحلات.</div>'}
      <button type="button" class="vs-add" data-vs-add="flights">+ إضافة رحلة</button>`;
  }

  function renderStay() {
    if (app.data.voucherType === 'flight') {
      const b = app.data.baggage;
      return `
        <h3>الأمتعة</h3>
        <p class="vs-hint">تظهر في بطاقتين داخل القسيمة.</p>
        <div class="vs-grid">
          ${field('الوزن المسموح (كغ)', 'baggage.checkedKg', { type: 'number', min: 0 })}
          ${field('أمتعة الكابينة (كغ)', 'baggage.cabinKg', { type: 'number', min: 0 })}
        </div>`;
    }
    const rows = app.data.hotels.map((h, i) => `
      <div class="vs-row-card">
        <div class="vs-row-head"><b>فندق ${i + 1}</b><span class="spacer"></span><button type="button" class="vs-icon-btn" data-vs-remove="hotels.${i}" title="حذف">×</button></div>
        <div class="vs-grid">
          ${field('اسم الفندق', `hotels.${i}.name`, { full: true })}
          ${field('المدينة', `hotels.${i}.city`)}
          ${field('التصنيف', `hotels.${i}.stars`, { type: 'select', options: [['5', '5 نجوم'], ['4', '4 نجوم'], ['3', '3 نجوم']] })}
          ${field('العنوان', `hotels.${i}.address`, { full: true })}
          ${field('تاريخ الدخول', `hotels.${i}.checkInDate`, { type: 'date' })}
          ${field('تاريخ الخروج', `hotels.${i}.checkOutDate`, { type: 'date' })}
          ${field('وقت الدخول', `hotels.${i}.checkInTime`, { type: 'time' })}
          ${field('وقت الخروج', `hotels.${i}.checkOutTime`, { type: 'time' })}
          ${field('المرافق', `hotels.${i}.amenities`, { full: true, placeholder: 'Free Wi-Fi · Breakfast · Airport shuttle' })}
        </div>
      </div>`).join('');
    return `
      <h3>الفنادق</h3>
      <p class="vs-hint">عدد الليالي يُحسب تلقائيًا من تاريخي الدخول والخروج.</p>
      ${rows || '<div class="vs-empty">لا توجد فنادق.</div>'}
      <button type="button" class="vs-add" data-vs-add="hotels">+ إضافة فندق</button>`;
  }

  function renderProgram() {
    if (app.data.voucherType !== 'travel') {
      return `<h3>البرنامج اليومي</h3><p class="vs-hint">البرنامج اليومي متاح في قسيمة Travel Plan فقط.</p>`;
    }
    const days = app.data.dailyProgram.map((day, i) => `
      <div class="vs-row-card">
        <div class="vs-row-head"><b>اليوم ${day.dayNumber}</b><span class="spacer"></span><button type="button" class="vs-icon-btn" data-vs-remove="dailyProgram.${i}" title="حذف">×</button></div>
        <div class="vs-grid">
          ${field('التاريخ', `dailyProgram.${i}.date`, { type: 'date' })}
          ${field('العنوان', `dailyProgram.${i}.title`, { placeholder: 'Arrival & Old Town' })}
          ${field('المدينة', `dailyProgram.${i}.location`)}
        </div>
        <div style="margin-top:10px">
          ${day.schedule.map((item, j) => `
            <div class="vs-grid" style="grid-template-columns:110px 1fr 1.4fr 30px;align-items:end;margin-bottom:6px">
              ${field('الوقت', `dailyProgram.${i}.schedule.${j}.time`, { placeholder: '09:00' })}
              ${field('النشاط', `dailyProgram.${i}.schedule.${j}.activity`)}
              ${field('التفاصيل', `dailyProgram.${i}.schedule.${j}.description`)}
              <button type="button" class="vs-icon-btn" data-vs-remove="dailyProgram.${i}.schedule.${j}" title="حذف">×</button>
            </div>`).join('')}
          <button type="button" class="vs-add" data-vs-add="schedule" data-day="${i}">+ إضافة بند لليوم</button>
        </div>
      </div>`).join('');
    return `
      <h3>البرنامج اليومي</h3>
      <p class="vs-hint">لكل يوم بنود زمنية. تظهر كخط زمني داخل القسيمة.</p>
      ${days || '<div class="vs-empty">لا توجد أيام.</div>'}
      <button type="button" class="vs-add" data-vs-add="dailyProgram">+ إضافة يوم</button>`;
  }

  function renderNotes() {
    return `
      <h3>الملاحظات والشروط</h3>
      <p class="vs-hint">سطر واحد لكل ملاحظة. تُطبع في بطاقتين أسفل القسيمة.</p>
      <div class="vs-grid">
        ${field('ملاحظات المسافر', 'notes', { type: 'textarea', rows: 5, full: true })}
        ${field('الشروط والأحكام', 'terms', { type: 'textarea', rows: 5, full: true })}
        ${field('هاتف التواصل', 'contactPhone')}
        ${field('البريد الإلكتروني', 'contactEmail', { type: 'email' })}
      </div>`;
  }

  function renderReview() {
    const d = app.data;
    const missing = [];
    if (!d.passengers.some((p) => p.name.trim())) missing.push('اسم مسافر واحد على الأقل');
    if (!d.flights.some((f) => f.flightNumber || f.from)) missing.push('رحلة واحدة على الأقل');
    if (!d.reservationCode && !d.orderId) missing.push('رقم حجز أو Order ID');
    return `
      <h3>الإصدار</h3>
      <p class="vs-hint">راجع المعاينة على اليسار. يمكنك الرجوع لأي خطوة قبل الطباعة أو التنزيل.</p>
      <div class="vs-card" style="margin-bottom:12px">
        <div class="vs-card-body">
          <div class="vs-kv"><span class="vs-kv-label">النوع</span><span class="vs-kv-value">${d.voucherType === 'travel' ? 'Travel Plan' : 'Flight Voucher'}</span></div>
          <div class="vs-kv"><span class="vs-kv-label">المسافرون</span><span class="vs-kv-value">${d.passengers.length}</span></div>
          <div class="vs-kv"><span class="vs-kv-label">الرحلات</span><span class="vs-kv-value">${d.flights.length}</span></div>
          <div class="vs-kv"><span class="vs-kv-label">${d.voucherType === 'travel' ? 'الفنادق / الأيام' : 'الأمتعة'}</span><span class="vs-kv-value">${d.voucherType === 'travel' ? `${d.hotels.length} / ${d.dailyProgram.length}` : `${d.baggage.checkedKg}kg + ${d.baggage.cabinKg}kg`}</span></div>
        </div>
      </div>
      ${missing.length ? `<div class="vs-empty" style="border-color:#fecaca;color:#b91c1c;text-align:start">نواقص مقترحة: ${missing.map(esc).join(' · ')}</div>` : '<div class="vs-empty" style="border-color:#bbf7d0;color:#15803d">البيانات الأساسية مكتملة.</div>'}
      <div class="vs-actions" style="padding:16px 0 0">
        <button type="button" class="vs-btn is-primary" data-vs="pdf">تنزيل PDF</button>
        <button type="button" class="vs-btn is-accent" data-vs="print">طباعة A4</button>
      </div>`;
  }

  /* ---------------- preview ---------------- */
  function previewHtml() {
    const d = app.data;
    const isTravel = d.voucherType === 'travel';
    const paxNames = d.passengers.map((p) => p.name.trim()).filter(Boolean).join(' · ') || '—';
    const first = d.flights[0] || {};
    const last = d.flights[d.flights.length - 1] || {};

    const flightsRows = d.flights.map((f) => `
      <tr>
        <td style="font-size:8.5pt;color:#6b7280">${esc(fmtDate(f.date))}</td>
        <td class="vs-flight-no">${esc(f.flightNumber || '—')}</td>
        <td class="vs-route">${esc(f.from || '—')} (${esc(f.fromCode || '—')}) <span class="vs-arrow">→</span> ${esc(f.to || '—')} (${esc(f.toCode || '—')})</td>
        <td class="center" style="font-weight:600">${esc(f.departTime || '—')}</td>
        <td class="center" style="font-weight:600">${esc(f.arriveTime || '—')}</td>
        <td>${esc(f.cabin || '—')}</td>
      </tr>`).join('');

    const paxRows = d.passengers.map((p) => `
      <tr>
        <td style="font-weight:600">${esc(p.name || '—')}</td>
        <td class="center" style="color:#6b7280;font-size:8pt">${esc(p.type)}</td>
        <td class="center vs-ticket">${esc(p.ticketNumber || '—')}</td>
        <td class="center"><span class="vs-seat">${esc(p.seat || 'Check-In Required')}</span></td>
      </tr>`).join('');

    const hotels = (d.hotels || []).map((h) => {
      const nights = h.nights || nightsBetween(h.checkInDate, h.checkOutDate);
      return `
      <div class="vs-card">
        <div class="vs-card-head"><span class="vs-card-name">${esc(h.name || 'Hotel')}</span><span class="vs-card-stars">${'★'.repeat(Number(h.stars) || 0)}</span></div>
        <div class="vs-card-body">
          <div class="vs-kv"><span class="vs-kv-label">City</span><span class="vs-kv-value">${esc(h.city || '—')}</span></div>
          <div class="vs-kv"><span class="vs-kv-label">Address</span><span class="vs-kv-value">${esc(h.address || '—')}</span></div>
          <div class="vs-kv"><span class="vs-kv-label">Stay</span><span class="vs-kv-value">${esc(shortDate(h.checkInDate))} – ${esc(shortDate(h.checkOutDate))} (${nights} night${nights === 1 ? '' : 's'})</span></div>
          <div class="vs-kv"><span class="vs-kv-label">Check-in/out</span><span class="vs-kv-value">From ${esc(h.checkInTime || '—')} / Until ${esc(h.checkOutTime || '—')}</span></div>
          ${h.amenities ? `<div class="vs-kv"><span class="vs-kv-label">Amenities</span><span class="vs-kv-value">${esc(h.amenities)}</span></div>` : ''}
        </div>
      </div>`;
    }).join('');

    const days = (d.dailyProgram || []).map((day) => `
      <div class="vs-day">
        <div class="vs-day-head">
          <div class="vs-day-num"><small>Day</small><b>${esc(day.dayNumber)}</b></div>
          <div class="vs-day-info">
            <div class="vs-day-date">${esc(fmtDate(day.date))}</div>
            <div class="vs-day-title">${esc(day.title || '—')}</div>
          </div>
          <div class="vs-day-loc">${day.location ? `<b>${esc(day.location)}</b><span>Location</span>` : ''}</div>
        </div>
        <div class="vs-timeline">
          ${(day.schedule || []).filter((s) => s.time || s.activity || s.description).map((s) => `
            <div class="vs-tl-item">
              <div class="vs-tl-time">${esc(s.time || '')}</div>
              <div class="vs-tl-content"><span class="vs-tl-title">${esc(s.activity || '')}</span>${s.description ? `<span class="vs-tl-desc">${esc(s.description)}</span>` : ''}</div>
            </div>`).join('') || '<div class="vs-tl-item"><div class="vs-tl-time"></div><div class="vs-tl-content" style="color:#9ca3af">No schedule added.</div></div>'}
        </div>
      </div>`).join('');

    const baggage = `
      <div class="vs-two">
        <div class="vs-bag">
          <div class="vs-bag-title">Checked Baggage</div>
          <div class="vs-bag-row"><span>Allowance</span><b>${esc(d.baggage?.checkedKg ?? 0)} kg</b></div>
          <div class="vs-bag-row"><span>Per</span><b>${d.baggage?.perPassenger ? 'Passenger' : 'Booking'}</b></div>
        </div>
        <div class="vs-bag">
          <div class="vs-bag-title">Cabin Baggage</div>
          <div class="vs-bag-row"><span>Allowance</span><b>${esc(d.baggage?.cabinKg ?? 0)} kg</b></div>
          <div class="vs-bag-row"><span>Per</span><b>${d.baggage?.perPassenger ? 'Passenger' : 'Booking'}</b></div>
        </div>
      </div>`;

    return `
      <header class="vs-header">
        <div class="vs-brand">
          <img src="${esc(d.logo || LOGO)}" alt="Laurette">
          <div class="vs-brand-tagline">Amman: ${esc(d.contactPhone || '—')}${d.contactEmail ? ` · ${esc(d.contactEmail)}` : ''}</div>
        </div>
        <div class="vs-doc">
          <div class="vs-doc-type">${isTravel ? 'Travel Plan' : 'E-Ticket Itinerary'}</div>
          <div class="vs-doc-title">${isTravel ? 'Travel Plan' : 'Flight Voucher'}</div>
          <div class="vs-issue"><div>Date of Issue: <strong>${esc(fmtDate(d.issueDate))}</strong></div><div>Issuing Office: <strong>${esc(d.issuingOffice || '—')}</strong></div></div>
        </div>
      </header>

      <div class="vs-banner">
        <div class="vs-banner-label">${isTravel ? 'Travel Itinerary' : 'Flight Route'}</div>
        <div class="vs-banner-title">${isTravel
          ? (first.from || first.to ? `${esc(first.from || '—')} → ${esc(first.to || '—')}${d.flights.length > 1 ? ` → ${esc(last.to || '')}` : ''}` : 'New itinerary')
          : (first.fromCode || last.toCode ? `${esc(first.fromCode || '—')} ↔ ${esc(last.toCode || '—')}` : 'New flight itinerary')}</div>
        <div class="vs-banner-sub">${isTravel
          ? `${d.passengers.length} Passenger(s) · ${d.flights.length} Flight(s) · ${(d.hotels || []).length} Hotel(s) · ${(d.dailyProgram || []).length} Day(s)`
          : `Prepared for <strong style="color:#fff">${esc(paxNames)}</strong>`}</div>
      </div>

      <div class="vs-section-title"><span class="vs-badge">PNR</span><span class="vs-section-label">Reservation Codes</span><span class="vs-section-line"></span></div>
      <div class="vs-codes">
        <div class="vs-code"><div class="vs-code-label">Order ID</div><div class="vs-code-value">${esc(d.orderId || '—')}</div></div>
        <div class="vs-code"><div class="vs-code-label">Reservation Code</div><div class="vs-code-value">${esc(d.reservationCode || '—')}</div></div>
        <div class="vs-code"><div class="vs-code-label">Airline PNR</div><div class="vs-code-value">${esc(d.airlinePnr || '—')}</div></div>
      </div>

      <div class="vs-section-title"><span class="vs-badge">Flights</span><span class="vs-section-label">Flight Details</span><span class="vs-section-line"></span></div>
      <table class="vs-table">
        <thead><tr><th>Date</th><th>Flight</th><th>Route</th><th class="center">Depart</th><th class="center">Arrive</th><th>Cabin</th></tr></thead>
        <tbody>${flightsRows || '<tr><td colspan="6" style="color:#9ca3af">No flights added.</td></tr>'}</tbody>
      </table>

      <div class="vs-section-title"><span class="vs-badge">Pax</span><span class="vs-section-label">Passenger Details</span><span class="vs-section-line"></span></div>
      <table class="vs-table">
        <thead><tr><th>Passenger Name</th><th class="center">Type</th><th class="center">eTicket Number</th><th class="center">Seat</th></tr></thead>
        <tbody>${paxRows || '<tr><td colspan="4" style="color:#9ca3af">No passengers added.</td></tr>'}</tbody>
      </table>

      ${isTravel
        ? `<div class="vs-section-title"><span class="vs-badge">Hotels</span><span class="vs-section-label">Accommodation</span><span class="vs-section-line"></span></div>
           <div class="vs-two">${hotels || '<div class="vs-empty">No hotels added.</div>'}</div>
           <div class="vs-section-title"><span class="vs-badge">Program</span><span class="vs-section-label">Daily Itinerary</span><span class="vs-section-line"></span></div>
           ${days || '<div class="vs-empty">No days added.</div>'}`
        : `<div class="vs-section-title"><span class="vs-badge">Baggage</span><span class="vs-section-label">Baggage Allowance</span><span class="vs-section-line"></span></div>${baggage}`}

      <div class="vs-notes">
        <div class="vs-note">
          <div class="vs-note-title">Important Notes</div>
          <ul>${(d.notes || []).map((n) => `<li>${esc(n)}</li>`).join('')}</ul>
        </div>
        <div class="vs-note is-accent">
          <div class="vs-note-title">Terms &amp; Conditions</div>
          <ul>${(d.terms || []).map((t) => `<li>${esc(t)}</li>`).join('')}</ul>
        </div>
      </div>

      <footer class="vs-footer">
        <div><b>LAURETTE TRAVEL &amp; TOURISM</b>${d.contactPhone ? ` · Amman: ${esc(d.contactPhone)}` : ''}</div>
        <div>Program subject to change based on opening hours, weather &amp; local conditions.</div>
        <div>Manual voucher</div>
      </footer>`;
  }

  function renderPreview() {
    const sheet = $('#vsSheet');
    if (!sheet) return;
    sheet.innerHTML = previewHtml();
    fitPreview();
  }

  function fitPreview() {
    const holder = $('#vsScale');
    const wrap = $('.vs-paper-wrap');
    const sheet = $('#vsSheet');
    if (!holder || !wrap || !sheet) return;
    const available = wrap.clientWidth - 28;
    const width = 794; // 210mm at 96dpi
    const scale = Math.min(1, Math.max(0.35, available / width));
    app.scale = scale;
    holder.style.width = `${Math.round(width * scale)}px`;
    holder.style.height = `${Math.round(sheet.offsetHeight * scale)}px`;
    sheet.style.transformOrigin = 'top left';
    sheet.style.transform = `scale(${scale})`;
  }

  /* ---------------- bindings ---------------- */
  function bind() {
    const root = app.root;

    root.addEventListener('input', (event) => {
      const el = event.target.closest('[data-path]');
      if (!el || !root.contains(el)) return;
      let value = el.value;
      if (el.type === 'number') value = Number(value || 0);
      if (el.dataset.path.endsWith('.checkOutDate') || el.dataset.path.endsWith('.checkInDate')) {
        const base = el.dataset.path.replace(/\.(checkOutDate|checkInDate)$/, '');
        const hotel = get(base);
        if (hotel) hotel.nights = nightsBetween(hotel.checkInDate, hotel.checkOutDate);
      }
      if (el.dataset.path === 'notes' || el.dataset.path === 'terms') {
        value = value.split('\n').map((s) => s.trim()).filter(Boolean);
      }
      setPath(el.dataset.path, value);
      renderPreview();
      saveDraft();
    });

    root.addEventListener('click', (event) => {
      const btn = event.target.closest('[data-vs], [data-vs-step], [data-vs-type], [data-vs-add], [data-vs-remove], [data-vs-pane]');
      if (!btn || !root.contains(btn)) return;

      if (btn.dataset.vsPane) {
        app.pane = btn.dataset.vsPane;
        root.querySelector('.vs-studio').dataset.pane = app.pane;
        $$('[data-vs-pane]', root).forEach((b) => b.classList.toggle('is-primary', b.dataset.vsPane === app.pane));
        return;
      }
      if (btn.dataset.vsStep) { app.step = Number(btn.dataset.vsStep); renderStep(); return; }
      if (btn.dataset.vsType) {
        app.data.voucherType = btn.dataset.vsType;
        renderStep();
        renderPreview();
        saveDraft();
        return;
      }
      if (btn.dataset.vsAdd) { addRow(btn.dataset.vsAdd, btn.dataset.day); return; }
      if (btn.dataset.vsRemove) { removeRow(btn.dataset.vsRemove); return; }

      const action = btn.dataset.vs;
      if (action === 'next') { app.step = Math.min(steps().length, app.step + 1); renderStep(); }
      if (action === 'prev') { app.step = Math.max(1, app.step - 1); renderStep(); }
      if (action === 'print') printVoucher();
      if (action === 'pdf') downloadPdf(btn);
      if (action === 'reset') {
        if (!window.confirm('بدء مسودة جديدة؟ سيُفقد المحتوى غير المنشور على هذا الجهاز.')) return;
        localStorage.removeItem(DRAFT_KEY);
        app.data = defaults(app.settings);
        app.step = 1;
        app.pane = 'form';
        mountContent();
      }
    });

    window.addEventListener('resize', fitPreview);
  }

  function addRow(kind, dayIndex) {
    if (kind === 'passengers') app.data.passengers.push({ name: '', type: 'Adult', ticketNumber: '', seat: 'Check-In Required' });
    if (kind === 'flights') app.data.flights.push({ date: '', flightNumber: '', airline: 'Turkish Airlines', from: '', fromCode: '', to: '', toCode: '', departTime: '', arriveTime: '', cabin: 'Economy' });
    if (kind === 'hotels') app.data.hotels.push({ name: '', stars: 4, city: '', address: '', checkInDate: '', checkOutDate: '', nights: 1, checkInTime: '14:00', checkOutTime: '12:00', amenities: '' });
    if (kind === 'dailyProgram') {
      const n = app.data.dailyProgram.length + 1;
      app.data.dailyProgram.push({ dayNumber: n, date: '', title: '', location: '', schedule: [{ time: '', activity: '', description: '' }] });
    }
    if (kind === 'schedule') {
      const day = app.data.dailyProgram[Number(dayIndex)];
      if (day) day.schedule.push({ time: '', activity: '', description: '' });
    }
    renderStep();
    renderPreview();
    saveDraft();
  }

  function removeRow(path) {
    const keys = path.split('.');
    const index = Number(keys.pop());
    const list = get(keys.join('.'));
    if (!Array.isArray(list)) return;
    list.splice(index, 1);
    app.data.dailyProgram.forEach((day, i) => { day.dayNumber = i + 1; });
    renderStep();
    renderPreview();
    saveDraft();
  }

  /* ---------------- print / pdf ---------------- */
  async function printVoucher() {
    const sheet = $('#vsSheet');
    if (!sheet) return;
    const holder = document.createElement('div');
    holder.className = 'vs-print-root';
    holder.innerHTML = `<article class="vs-sheet">${previewHtml()}</article>`;
    document.body.appendChild(holder);
    document.body.classList.add('vs-printing');
    await new Promise((resolve) => setTimeout(resolve, 120));
    window.print();
    setTimeout(() => {
      document.body.classList.remove('vs-printing');
      holder.remove();
    }, 900);
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      if (document.querySelector(`script[src="${src}"]`)) return resolve();
      const script = document.createElement('script');
      script.src = src;
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error(`load ${src}`));
      document.head.appendChild(script);
    });
  }

  async function ensureLibs() {
    if (!window.html2canvas) await loadScript(VENDOR.html2canvas);
    if (!window.jspdf) await loadScript(VENDOR.jspdf);
    if (!window.html2canvas || !window.jspdf) throw new Error('libs');
  }

  async function downloadPdf(button) {
    const sheet = $('#vsSheet');
    if (!sheet) return;
    const label = button ? button.textContent : '';
    if (button) { button.disabled = true; button.textContent = 'جارٍ التجهيز…'; }
    try {
      await ensureLibs();
      const holder = $('#vsScale');
      const previous = sheet.style.transform;
      sheet.style.transform = 'none';
      const canvas = await window.html2canvas(sheet, { scale: 2, backgroundColor: '#ffffff', useCORS: true, logging: false });

      const { jsPDF } = window.jspdf;
      const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
      const pageW = 210;
      const pageH = 297;
      const pxPerMm = canvas.width / pageW;
      const pageHeightPx = Math.floor(pageH * pxPerMm);

      // Slice on block boundaries so a hotel card or a day card is never cut in half.
      const sheetBox = sheet.getBoundingClientRect();
      const ratio = canvas.height / sheet.offsetHeight;
      const candidates = [...sheet.querySelectorAll('.vs-section-title, .vs-day, .vs-card, .vs-table, .vs-notes, .vs-footer, .vs-banner')]
        .map((el) => {
          const box = el.getBoundingClientRect();
          const top = (box.top - sheetBox.top) * ratio;
          const bottom = (box.bottom - sheetBox.top) * ratio;
          return el.classList.contains('vs-section-title') ? [top] : [top, bottom];
        })
        .flat()
        .filter((y) => y > 0 && y < canvas.height)
        .sort((a, b) => a - b);
      sheet.style.transform = previous;

      let offset = 0;
      let page = 0;
      const minFill = pageHeightPx * 0.45;
      while (offset < canvas.height - 2) {
        const limit = offset + pageHeightPx;
        let cut = Math.min(limit, canvas.height);
        if (cut < canvas.height) {
          const allowed = candidates.filter((y) => y > offset + minFill && y <= limit);
          if (allowed.length) cut = allowed[allowed.length - 1];
          // Never leave a section heading alone at the bottom of a page.
          const orphan = [...sheet.querySelectorAll('.vs-section-title')].find((el) => {
            const box = el.getBoundingClientRect();
            const bottom = (box.bottom - sheetBox.top) * ratio;
            return bottom <= cut + 1 && bottom >= cut - 80;
          });
          if (orphan) cut = (orphan.getBoundingClientRect().top - sheetBox.top) * ratio;
        }
        const sliceHeight = Math.max(1, Math.round(cut - offset));        const part = document.createElement('canvas');
        part.width = canvas.width;
        part.height = sliceHeight;
        part.getContext('2d').drawImage(canvas, 0, offset, canvas.width, sliceHeight, 0, 0, canvas.width, sliceHeight);
        if (page > 0) pdf.addPage();
        pdf.addImage(part.toDataURL('image/jpeg', 0.94), 'JPEG', 0, 0, pageW, sliceHeight / pxPerMm);
        offset += sliceHeight;
        page += 1;
      }
      const name = `Laurette-${(app.data.reservationCode || app.data.orderId || 'voucher').replace(/[^\w-]+/g, '')}.pdf`;
      pdf.save(name);
    } catch {
      if (sheet) sheet.style.transform = '';
      await printVoucher();
    } finally {
      if (button) { button.disabled = false; button.textContent = label || 'تنزيل PDF'; }
    }
  }

  /* ---------------- mount ---------------- */
  function mountContent() {
    app.root.innerHTML = shell();
    renderStep();
    fitPreview();
  }

  async function mount(container, options = {}) {
    app.root = container;
    app.settings = options.settings || app.settings || {};
    try {
      const res = await fetch('/api/settings');
      if (res.ok) {
        const data = await res.json();
        app.settings = { ...app.settings, ...(data.settings || {}) };
      }
    } catch { /* offline is fine */ }
    app.data = loadDraft(defaults(app.settings));
    app.step = 1;
    app.pane = 'form';
    mountContent();
    if (!app.root.dataset.bound) {
      bind();
      app.root.dataset.bound = '1';
    }
  }

  window.VoucherStudio = { mount };
})();
