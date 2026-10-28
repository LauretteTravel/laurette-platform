/* لوريت — واجهة الموقع العام */
(() => {
  'use strict';

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const arNum = (n) => Number(n || 0).toLocaleString('en-US');
  const TRANSITION_MS = 2000;

  function showTransition() {
    const overlay = $('#loretTransition');
    if (overlay) {
      overlay.hidden = false;
      overlay.setAttribute('aria-hidden', 'false');
      document.body.classList.add('is-transitioning');
    }
    return new Promise((resolve) => setTimeout(resolve, TRANSITION_MS));
  }

  function hideTransition() {
    const overlay = $('#loretTransition');
    if (!overlay) return;
    overlay.hidden = true;
    overlay.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('is-transitioning');
  }

  window.loretShowTransition = showTransition;
  window.loretHideTransition = hideTransition;

  document.addEventListener('click', (event) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (event.target.closest('[data-print-catalog]')) {
      event.preventDefault();
      window.print();
      return;
    }
    const link = event.target.closest('a[href]');
    if (!link || link.target || link.hasAttribute('download') || link.dataset.noTransition !== undefined) return;
    const destination = new URL(link.href, window.location.href);
    if (destination.origin !== window.location.origin) return;
    if (destination.pathname === window.location.pathname
      && destination.search === window.location.search
      && destination.hash) return;
    if (destination.href === window.location.href) return;
    event.preventDefault();
    showTransition().then(() => window.location.assign(destination.href));
  }, true);

  document.addEventListener('submit', (event) => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement) || form.method.toLowerCase() !== 'get'
      || form.matches('.request-form, #quizForm, #trackForm, [data-form]')
      || form.dataset.transitionPending === 'true') return;
    const destination = new URL(form.action || window.location.href, window.location.href);
    if (destination.origin !== window.location.origin) return;
    event.preventDefault();
    form.dataset.transitionPending = 'true';
    showTransition().then(() => event.submitter ? form.requestSubmit(event.submitter) : form.requestSubmit());
  }, true);

  /* ---------------- toasts ---------------- */
  function toast(message, kind = 'ok', ms = 4200) {
    let stack = $('#toastStack');
    if (!stack) {
      stack = document.createElement('div');
      stack.id = 'toastStack';
      stack.className = 'toast-stack';
      stack.setAttribute('aria-live', 'polite');
      document.body.append(stack);
    }
    const el = document.createElement('div');
    el.className = `toast toast-${kind}`;
    el.textContent = message;
    stack.append(el);
    setTimeout(() => { el.classList.add('is-out'); setTimeout(() => el.remove(), 300); }, ms);
  }
  window.loretToast = toast;

  /* ---------------- header & nav ---------------- */
  const header = $('#siteHeader');
  const onScroll = () => header && header.classList.toggle('is-stuck', window.scrollY > 8);
  onScroll();
  window.addEventListener('scroll', onScroll, { passive: true });

  const arabicLanguageButton = $('[data-language-reset="ar"]');
  arabicLanguageButton?.addEventListener('click', () => {
    const host = window.location.hostname;
    const rootDomain = host.split('.').slice(-2).join('.');
    for (const cookieName of ['googtrans', 'googtransopt']) {
      document.cookie = `${cookieName}=; Max-Age=0; path=/; SameSite=Lax`;
      for (const domain of new Set([host.includes('.') ? `.${host}` : '', rootDomain.includes('.') ? `.${rootDomain}` : ''])) {
        if (domain) document.cookie = `${cookieName}=; Max-Age=0; path=/; domain=${domain}; SameSite=Lax`;
      }
    }
    document.documentElement.lang = 'ar';
    document.documentElement.dir = 'rtl';
    window.location.reload();
  });

  const toggle = $('#navToggle');
  const nav = $('#mainNav');
  if (toggle && nav) {
    toggle.addEventListener('click', () => {
      const open = nav.classList.toggle('is-open');
      toggle.setAttribute('aria-expanded', String(open));
      toggle.setAttribute('aria-label', open ? 'إغلاق القائمة' : 'فتح القائمة');
    });
    nav.addEventListener('click', (e) => {
      if (e.target.closest('a')) {
        nav.classList.remove('is-open');
        toggle.setAttribute('aria-expanded', 'false');
      }
    });
  }

  /* ---------------- hero service tabs ---------------- */
  const tabs = $$('.service-tab');
  if (tabs.length) {
    const activate = (key) => {
      tabs.forEach((t) => {
        const on = t.dataset.tab === key;
        t.setAttribute('aria-selected', String(on));
        t.tabIndex = on ? 0 : -1;
      });
      $$('.search-panel').forEach((panel) => {
        panel.hidden = panel.id !== `panel-${key}`;
      });
    };
    tabs.forEach((tab, index) => {
      tab.addEventListener('click', () => activate(tab.dataset.tab));
      tab.addEventListener('keydown', (e) => {
        if (!['ArrowRight', 'ArrowLeft'].includes(e.key)) return;
        e.preventDefault();
        const dir = e.key === 'ArrowRight' ? -1 : 1;
        const next = tabs[(index + dir + tabs.length) % tabs.length];
        next.focus();
        activate(next.dataset.tab);
      });
    });
  }

  /* ---------------- request forms ---------------- */
  const phoneRe = /^\+?[0-9]{8,15}$/;

  function setFieldError(form, name, message) {
    const wrap = form.querySelector(`[data-field-wrap="${CSS.escape(name)}"]`);
    const slot = form.querySelector(`[data-error-for="${CSS.escape(name)}"]`);
    if (wrap) wrap.classList.toggle('has-error', !!message);
    if (slot) slot.textContent = message || '';
    const input = form.querySelector(`[name="${CSS.escape(name)}"]`);
    if (input) input.setAttribute('aria-invalid', message ? 'true' : 'false');
  }

  function clearErrors(form) {
    $$('[data-field-wrap]', form).forEach((w) => w.classList.remove('has-error'));
    $$('[data-error-for]', form).forEach((s) => { s.textContent = ''; });
  }

  function collect(form) {
    const type = form.dataset.requestType;
    const fd = new FormData(form);
    const data = { type };
    for (const [k, v] of fd.entries()) {
      if (k.startsWith('seg')) continue;
      data[k] = typeof v === 'string' ? v.trim() : v;
    }
    for (const key of ['adults', 'children', 'infants', 'rooms', 'applicants', 'pax']) {
      if (key in data) data[key] = data[key] === '' ? undefined : Number(data[key]);
    }
    data.consent = !!(form.querySelector('[name="consent"]') && form.querySelector('[name="consent"]').checked);

    if (type === 'flight') {
      data.tripType = String(fd.get('tripType') || 'return');
      if (data.tripType === 'multi') {
        const segments = [];
        for (let i = 0; i < 4; i++) {
          const from = fd.get(`segFrom${i}`);
          const to = fd.get(`segTo${i}`);
          const date = fd.get(`segDate${i}`);
          if (from && to && date) segments.push({ from: String(from).trim(), to: String(to).trim(), date: String(date) });
        }
        data.segments = segments;
        delete data.origin; delete data.destination; delete data.departDate; delete data.returnDate;
      } else {
        delete data.segments;
        if (data.tripType === 'oneway') delete data.returnDate;
      }
      delete data.returnDateHidden;
    }
    if (type === 'hotel') {
      const ages = String(fd.get('childAges') || '').split(/[،,]/).map((s) => Number(s.trim())).filter((n) => Number.isInteger(n));
      data.childAges = ages;
    }
    if (type === 'program' || type === 'umrah') {
      const visible = fd.get('optionLabelVisible');
      if (visible) data.optionLabel = String(visible);
      delete data.optionLabelVisible;
      if (!String(data.programSlug || '').trim()) delete data.programSlug;
    }
    return data;
  }

  function validateClient(form, data) {
    const errors = {};
    if (!data.name || data.name.length < 2) errors.name = 'أدخل الاسم الكامل';
    if (!phoneRe.test(String(data.phone || '').replace(/[\s\-()]/g, ''))) errors.phone = 'رقم هاتف غير صالح';
    if (data.email && !/^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/.test(data.email)) errors.email = 'بريد إلكتروني غير صالح';
    if (!data.consent) errors.consent = 'يلزم الموافقة على حفظ البيانات';
    if (data.type === 'flight') {
      if (data.tripType === 'multi') {
        if (!Array.isArray(data.segments) || data.segments.length < 2) errors.segments = 'أضف مسارين على الأقل';
      } else {
        if (!data.origin) errors.origin = 'مطار المغادرة مطلوب';
        if (!data.destination) errors.destination = 'مطار الوصول مطلوب';
        if (!data.departDate) errors.departDate = 'تاريخ السفر مطلوب';
        if (data.tripType === 'return' && !data.returnDate) errors.returnDate = 'تاريخ العودة مطلوب';
      }
    }
    if (data.type === 'hotel') {
      if (!data.country) errors.country = 'الدولة مطلوبة';
      if (!data.city) errors.city = 'المدينة مطلوبة';
      if (!data.checkIn) errors.checkIn = 'تاريخ الدخول مطلوب';
      if (!data.checkOut) errors.checkOut = 'تاريخ الخروج مطلوب';
      if (data.checkIn && data.checkOut && data.checkOut <= data.checkIn) errors.checkOut = 'تاريخ الخروج يجب أن يكون بعد الدخول';
    }
    if (data.type === 'visa') {
      ['nationality', 'residence', 'destination'].forEach((k) => { if (!data[k]) errors[k] = 'هذا الحقل مطلوب'; });
    }
    if (data.type === 'consult' && (!data.message || data.message.length < 10)) errors.message = 'اكتب استفسارك (10 أحرف على الأقل)';
    return errors;
  }

  function resultMarkup(res) {
    const wa = res.whatsapp ? `<a class="btn btn-wa" href="${res.whatsapp}" target="_blank" rel="noopener noreferrer">متابعة عبر واتساب</a>` : '';
    return `<div class="result" role="status">
      <h2>تم استلام طلبك ✔</h2>
      <p>${res.duplicate ? 'لاحظنا طلبًا مطابقًا أُرسل قبل قليل، وهذا رقمه المرجعي نفسه — لا حاجة لإعادة الإرسال.' : 'سجّلنا طلبك وأعطيناه رقمًا مرجعيًا. احتفظ به لمتابعة الحالة.'}</p>
      <div class="reference"><span>الرقم المرجعي:</span><code>${res.reference}</code><button class="btn btn-ghost btn-sm" type="button" data-copy="${res.reference}">نسخ</button></div>
      ${res.summary ? `<p class="muted">${res.summary}</p>` : ''}
      <div class="btn-row">
        <a class="btn btn-primary" href="${res.trackUrl}">متابعة الطلب</a>
        ${wa}
        <button class="btn btn-ghost" type="button" data-new-request>إرسال طلب آخر</button>
      </div>
      <p class="field-hint mt-2">هذا طلب عرض سعر وليس حجزًا مؤكدًا. لا تُصدر أي تذكرة أو تُحجز أي غرفة قبل موافقتك على العرض الرسمي.</p>
    </div>`;
  }

  async function submitForm(form) {
    const status = form.querySelector('[data-form-status]');
    const button = form.querySelector('button[type="submit"]');
    clearErrors(form);
    const data = collect(form);
    const clientErrors = validateClient(form, data);
    if (Object.keys(clientErrors).length) {
      Object.entries(clientErrors).forEach(([k, msg]) => setFieldError(form, k, msg));
      if (status) { status.textContent = 'راجع الحقول المعلّمة بالأحمر.'; status.classList.add('is-error'); }
      const first = Object.keys(clientErrors)[0];
      const el = form.querySelector(`[data-field-wrap="${CSS.escape(first)}"] input, [data-field-wrap="${CSS.escape(first)}"] select, [data-field-wrap="${CSS.escape(first)}"] textarea`);
      if (el) el.focus();
      return;
    }
    if (button) { button.disabled = true; button.dataset.label = button.textContent; button.textContent = 'جارٍ الإرسال…'; }
    try {
      const res = await fetch('/api/requests', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-requested-with': 'fetch' },
        body: JSON.stringify(data),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok || !payload.ok) {
        const errors = payload.errors || {};
        Object.entries(errors).forEach(([k, msg]) => {
          const key = k.includes('.') ? k.split('.').pop() : k;
          setFieldError(form, k, msg);
          setFieldError(form, key, msg);
        });
        if (status) { status.textContent = payload.message || 'تعذر إرسال الطلب. تحقق من البيانات.'; status.classList.add('is-error'); }
        return;
      }
      const wrapper = document.createElement('div');
      wrapper.innerHTML = resultMarkup(payload);
      await showTransition();
      hideTransition();
      form.replaceWith(wrapper.firstElementChild);
      wrapper.firstElementChild.scrollIntoView({ behavior: 'smooth', block: 'center' });
      window.dispatchEvent(new CustomEvent('loret:lead', {
        detail: { type: data.type, value: Number(payload.value) || 0, duplicate: !!payload.duplicate },
      }));
    } catch {
      if (status) { status.textContent = 'تعذر الاتصال بالخادم. تحقق من الإنترنت وحاول مرة أخرى.'; status.classList.add('is-error'); }
    } finally {
      if (button && button.isConnected) { button.disabled = false; button.textContent = button.dataset.label || 'إرسال'; }
    }
  }

  $$('.request-form').forEach((form) => {
    form.addEventListener('submit', (e) => { e.preventDefault(); submitForm(form); });
    const tripInputs = $$('[name="tripType"]', form);
    const simple = $('[data-trip-panel="simple"]', form);
    const multi = $('[data-trip-panel="multi"]', form);
    const syncTrip = () => {
      if (!tripInputs.length) return;
      const value = (form.querySelector('[name="tripType"]:checked') || {}).value || 'return';
      if (simple) simple.hidden = value === 'multi';
      if (multi) multi.hidden = value !== 'multi';
      const ret = $('[name="returnDate"]', form);
      if (ret) ret.closest('.field').style.display = value === 'return' ? '' : 'none';
    };
    tripInputs.forEach((i) => i.addEventListener('change', syncTrip));
    syncTrip();

    const addSegment = $('[data-add-segment]', form);
    if (addSegment) {
      addSegment.addEventListener('click', () => {
        const host = $('[data-segments]', form);
        const count = $$('[data-segment]', host).length;
        if (count >= 4) return toast('الحد الأقصى 4 مسارات', 'warn');
        const block = document.createElement('div');
        block.className = 'form-grid-3 mt-2';
        block.dataset.segment = '';
        block.innerHTML = `
          <div class="field"><label>من (المسار ${count + 1})</label><input name="segFrom${count}" placeholder="عمّان"></div>
          <div class="field"><label>إلى (المسار ${count + 1})</label><input name="segTo${count}" placeholder="إسطنبول"></div>
          <div class="field"><label>التاريخ (المسار ${count + 1})</label><input name="segDate${count}" type="date"></div>`;
        host.append(block);
      });
    }
  });

  document.addEventListener('click', async (e) => {
    const copy = e.target.closest('[data-copy]');
    if (copy) {
      try {
        await navigator.clipboard.writeText(copy.dataset.copy);
        toast('تم نسخ الرقم المرجعي');
      } catch { toast('انسخ الرقم يدويًا', 'warn'); }
    }
    if (e.target.closest('[data-new-request]')) showTransition().then(() => location.reload());
    if (e.target.closest('[data-open-chat]')) openChat();
  });

  /* ---------------- recommendation quiz ---------------- */
  const quiz = $('#quizForm');
  if (quiz) {
    quiz.addEventListener('submit', async (e) => {
      e.preventDefault();
      const out = $('#quizResults');
      const fd = new FormData(quiz);
      out.innerHTML = '<p class="muted">جارٍ الترشيح…</p>';
      try {
        const res = await fetch('/api/recommend', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-requested-with': 'fetch' },
          body: JSON.stringify(Object.fromEntries(fd.entries())),
        });
        const data = await res.json();
        await showTransition();
        hideTransition();
        if (!data.ok || !data.matches.length) {
          out.innerHTML = '<div class="empty"><b>لا توجد مطابقة مباشرة</b><p>وسّع الميزانية أو غيّر الشهر، أو اطلب برنامجًا مخصصًا.</p><a class="btn btn-gold" href="/consult">اطلب برنامجًا مخصصًا</a></div>';
          return;
        }
        out.innerHTML = `<p class="muted">${data.note}</p><div class="grid grid-3">${data.matches.map((p) => `
          <article class="card"><div class="card-body">
            <span class="card-kicker">${p.destination || ''}</span>
            <h3 class="card-title"><a href="${p.url}">${p.title}</a></h3>
            <div class="card-meta"><span>${p.days} أيام / ${p.nights} ليالٍ</span>${p.meals ? `<span>${p.meals}</span>` : ''}</div>
            <div class="card-foot"><span class="price"><small>يبدأ من</small><b>${arNum(p.priceFrom)} ${p.currency}</b></span><a class="btn btn-quiet btn-sm" href="${p.url}">التفاصيل</a></div>
          </div></article>`).join('')}</div>`;
      } catch {
        out.innerHTML = '<p class="form-status is-error">تعذر الترشيح الآن. حاول لاحقًا.</p>';
      }
    });
  }

  /* ---------------- umrah comparison ---------------- */
  const compareData = $('#compareData');
  if (compareData) {
    let selected = [];
    const area = $('#compareArea');
    const bar = document.createElement('div');
    bar.className = 'compare-bar';
    bar.hidden = true;
    bar.innerHTML = '<span>محدد: <b data-count>0</b></span><span class="spacer" style="flex:1"></span><button class="btn btn-gold btn-sm" type="button" data-do-compare>قارن المحدد</button><button class="btn btn-ghost btn-sm" type="button" data-clear-compare>إلغاء</button>';
    document.body.append(bar);

    const rows = JSON.parse(compareData.textContent || '[]');
    const hotel = (h) => (h ? `${h.name}${h.stars ? ` (${'★'.repeat(Number(h.stars))})` : ''}${h.distance ? ` — ${h.distance}` : ''}` : '—');

    const render = () => {
      bar.hidden = selected.length === 0;
      const counter = bar.querySelector('[data-count]');
      if (counter) counter.textContent = String(selected.length);
      if (selected.length < 2) {
        area.innerHTML = `<div class="empty"><b>حدد برنامجين على الأقل</b><p>اختر ${2 - selected.length} برنامجًا آخر من البطاقات أعلاه لتظهر المقارنة.</p></div>`;
        return;
      }
      const items = selected.map((slug) => rows.find((r) => r.slug === slug)).filter(Boolean);
      const minPrice = Math.min(...items.map((i) => Number(i.price) || Infinity));
      const minDays = Math.min(...items.map((i) => Number(i.days) || Infinity));
      area.innerHTML = `<div class="table-wrap"><table class="compare-table">
        <thead><tr><th>المعيار</th>${items.map((i) => `<th>${i.title}</th>`).join('')}</tr></thead>
        <tbody>
          <tr><th>السعر يبدأ من (للشخص)</th>${items.map((i) => `<td class="${Number(i.price) === minPrice ? 'best' : ''}">${arNum(i.price)} د.أ</td>`).join('')}</tr>
          <tr><th>المدة</th>${items.map((i) => `<td class="${Number(i.days) === minDays ? 'best' : ''}">${i.days} أيام / ${i.nights} ليالٍ</td>`).join('')}</tr>
          <tr><th>فندق مكة</th>${items.map((i) => `<td>${hotel(i.makkah)}</td>`).join('')}</tr>
          <tr><th>فندق المدينة</th>${items.map((i) => `<td>${hotel(i.madinah)}</td>`).join('')}</tr>
          <tr><th>الوجبات</th>${items.map((i) => `<td>${i.meals || '—'}</td>`).join('')}</tr>
          <tr><th>شركة الطيران</th>${items.map((i) => `<td>${i.airline || '—'}</td>`).join('')}</tr>
          <tr><th>نوع الرحلة</th>${items.map((i) => `<td>${i.mode === 'bus' ? 'بري' : i.mode === 'sea' ? 'بحري' : 'جوي'}</td>`).join('')}</tr>
          <tr><th></th>${items.map((i) => `<td><a class="btn btn-quiet btn-sm" href="/programs/${i.slug}">التفاصيل والطلب</a></td>`).join('')}</tr>
        </tbody>
      </table></div>
      <p class="source-note mt-2">المقارنة مبنية على البيانات المنشورة فقط. الأسعار «تبدأ من» وتختلف حسب نوع الغرفة والموسم.</p>`;
    };

    document.addEventListener('change', (e) => {
      const box = e.target.closest('[data-compare]');
      if (!box) return;
      const slug = box.dataset.compare;
      selected = box.checked ? [...new Set([...selected, slug])] : selected.filter((s) => s !== slug);
      if (selected.length > 4) {
        box.checked = false;
        selected = selected.slice(0, 4);
        toast('يمكن مقارنة 4 برامج كحد أقصى', 'warn');
      }
      render();
    });
    bar.addEventListener('click', (e) => {
      if (e.target.closest('[data-do-compare]')) {
        area.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
      if (e.target.closest('[data-clear-compare]')) {
        selected = [];
        $$('[data-compare]').forEach((b) => { b.checked = false; });
        render();
      }
    });
    render();
  }

  /* ---------------- track ---------------- */
  const trackForm = $('#trackForm');
  if (trackForm) {
    const status = trackForm.querySelector('[data-track-status]');
    trackForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(trackForm);
      const out = $('#trackResult');
      status.textContent = 'جارٍ البحث…';
      status.classList.remove('is-error');
      out.innerHTML = '';
      try {
        const res = await fetch('/api/track', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-requested-with': 'fetch' },
          body: JSON.stringify(Object.fromEntries(fd.entries())),
        });
        const data = await res.json();
        if (!res.ok || !data.ok) {
          status.textContent = data.message || 'لم نجد الطلب';
          status.classList.add('is-error');
          return;
        }
        status.textContent = '';
        const r = data.request;
        out.innerHTML = `<div class="panel">
          <div class="badge-row mb-2"><span class="badge badge-soft">${r.typeLabel}</span><span class="status-dot status-${r.status}">${r.statusLabel}</span></div>
          <h2 style="font-size:20px">${r.reference}</h2>
          <p class="muted">${r.summary || ''}</p>
          <ul class="fact-list">
            <li><span>تاريخ الإنشاء</span><b>${new Date(r.createdAt).toLocaleString('ar-JO')}</b></li>
            <li><span>آخر تحديث</span><b>${new Date(r.updatedAt).toLocaleString('ar-JO')}</b></li>
            ${r.quote ? `<li><span>عرض السعر</span><b>${arNum(r.quote.amount)} ${r.quote.currency}</b></li>` : '<li><span>عرض السعر</span><b>لم يُرسل بعد</b></li>'}
          </ul>
          ${r.quote && r.quote.note ? `<div class="notice notice-info mt-2">${r.quote.note}</div>` : ''}
          <h3 class="mt-3" style="font-size:16px">سجل الحالة</h3>
          <ul class="timeline">${r.timeline.map((t) => `<li><b>${t.message || t.kind}</b><span>${new Date(t.at).toLocaleString('ar-JO')}</span></li>`).join('')}</ul>
        </div>`;
      } catch {
        status.textContent = 'تعذر الاتصال بالخادم';
        status.classList.add('is-error');
      }
    });
  }

  /* ---------------- chat ---------------- */
  const panel = $('#chatPanel');
  const chatBody = $('#chatBody');
  const chatForm = $('#chatForm');
  const chatInput = $('#chatInput');
  const chatOpen = $('#chatOpen');
  let sid = sessionStorage.getItem('loret_chat_sid') || null;
  let consent = sessionStorage.getItem('loret_chat_consent') === '1';
  let greeted = false;

  function addMsg(text, who = 'bot', sources = []) {
    if (!chatBody) return;
    const el = document.createElement('div');
    el.className = `msg msg-${who}`;
    el.textContent = text;
    if (sources && sources.length) {
      const src = document.createElement('span');
      src.className = 'msg-src';
      src.innerHTML = sources.slice(0, 2).map((s) => `<a href="${s.url}" ${String(s.url).startsWith('http') ? 'target="_blank" rel="noopener noreferrer"' : ''}>${s.label}</a>`).join(' · ');
      el.append(src);
    }
    chatBody.append(el);
    chatBody.scrollTop = chatBody.scrollHeight;
  }

  function addSuggestions(list) {
    if (!chatBody || !list || !list.length) return;
    const wrap = document.createElement('div');
    wrap.className = 'chat-suggest';
    list.slice(0, 4).forEach((s) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = s;
      b.addEventListener('click', () => send(s));
      wrap.append(b);
    });
    chatBody.append(wrap);
    chatBody.scrollTop = chatBody.scrollHeight;
  }

  function addConsentRow() {
    if (!chatBody || chatBody.querySelector('[data-consent-row]')) return;
    const row = document.createElement('div');
    row.dataset.consentRow = '';
    row.className = 'msg msg-bot';
    row.innerHTML = `<label class="check" style="gap:8px">
      <input type="checkbox" data-chat-consent ${consent ? 'checked' : ''}>
      <span style="font-size:11.5px">أوافق على حفظ المحادثة ليتابعها فريق لوريت (اختياري).</span>
    </label>`;
    chatBody.append(row);
    row.querySelector('input').addEventListener('change', (e) => {
      consent = e.target.checked;
      sessionStorage.setItem('loret_chat_consent', consent ? '1' : '0');
      if (consent && !sid) {
        sid = crypto.randomUUID().replace(/-/g, '');
        sessionStorage.setItem('loret_chat_sid', sid);
      }
      if (!consent) {
        sid = null;
        sessionStorage.removeItem('loret_chat_sid');
      }
    });
  }

  async function send(text) {
    if (!chatBody || !text.trim()) return;
    addMsg(text, 'user');
    chatInput.value = '';
    const typing = document.createElement('div');
    typing.className = 'msg msg-bot';
    typing.textContent = '…';
    chatBody.append(typing);
    chatBody.scrollTop = chatBody.scrollHeight;
    try {
      const res = await fetch('/api/assistant', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-requested-with': 'fetch' },
        body: JSON.stringify({ message: text, sessionId: consent ? sid : null, consent }),
      });
      const data = await res.json();
      typing.remove();
      if (!data.ok) {
        addMsg(data.message || 'تعذر الرد الآن. جرّب واتساب مع فريقنا.', 'bot');
        return;
      }
      if (data.sessionId) {
        sid = data.sessionId;
        sessionStorage.setItem('loret_chat_sid', sid);
      }
      addMsg(data.reply, 'bot', data.sources);
      addSuggestions(data.suggestions);
    } catch {
      typing.remove();
      addMsg('تعذر الاتصال. يمكنك التواصل عبر واتساب مع فريق لوريت.', 'bot');
    }
  }

  function openChat() {
    if (!panel) return;
    panel.hidden = false;
    if (chatOpen) chatOpen.setAttribute('aria-expanded', 'true');
    if (!greeted) {
      greeted = true;
      addMsg('أهلًا وسهلًا في لوريت 🕋✈️\nأساعدك في برامج العمرة، عروض تركيا ومصر والكروز، تذاكر الطيران، الفنادق، ومتطلبات التأشيرات.\nعن ماذا تحب أن تسأل؟');
      addConsentRow();
      addSuggestions(['برامج العمرة', 'عروض إسطنبول', 'متطلبات التأشيرة', 'طلب عرض سعر']);
    }
    chatInput?.focus();
  }

  if (chatOpen) chatOpen.addEventListener('click', openChat);
  const chatClose = $('#chatClose');
  if (chatClose) {
    chatClose.addEventListener('click', () => {
      panel.hidden = true;
      chatOpen.setAttribute('aria-expanded', 'false');
      chatOpen.focus();
    });
  }
  if (chatForm) {
    chatForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const value = chatInput.value.trim();
      if (!value) return;
      if (!consent) {
        // sending without consent: no session id, nothing persisted server-side
        sid = null;
      }
      send(value);
    });
  }
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && panel && !panel.hidden) {
      panel.hidden = true;
      chatOpen?.setAttribute('aria-expanded', 'false');
    }
  });

  /* ---------------- direct contact chooser ---------------- */
  const waModal = $('#waModal');
  let waDefaultText = 'السلام عليكم، أرغب بالاستفسار عن خدمات لوريت';

  function openWa(text) {
    if (!waModal) return;
    if (offerDialogEl && offerDialogEl.open) offerDialogEl.close();
    const message = (text || waDefaultText).trim();
    $$('[data-wa-direct]', waModal).forEach((a) => {
      a.href = `https://wa.me/${a.dataset.waNumber}?text=${encodeURIComponent(message)}`;
    });
    waModal.hidden = false;
    document.body.classList.add('no-scroll');
    setTimeout(() => waModal.querySelector('.modal-close')?.focus(), 30);
  }

  function closeWa() {
    if (!waModal || waModal.hidden) return;
    waModal.hidden = true;
    document.body.classList.remove('no-scroll');
  }

  document.addEventListener('click', (e) => {
    const trigger = e.target.closest('[data-wa]');
    if (trigger) {
      e.preventDefault();
      openWa(trigger.getAttribute('data-wa-text') || trigger.dataset.waText || waDefaultText);
      return;
    }
    if (e.target.closest('[data-wa-close]') || e.target === waModal) closeWa();
  });

  waModal?.addEventListener('click', (e) => {
    const contact = e.target.closest('[data-wa-direct], [data-contact-call]');
    if (!contact || contact.getAttribute('aria-disabled') === 'true') return;
    window.dispatchEvent(new CustomEvent('loret:whatsapp', {
      detail: { type: contact.hasAttribute('data-contact-call') ? 'direct-call' : 'direct-message' },
    }));
  });

  /* ---------------- offer posters & lightbox ---------------- */
  const offerDialogEl = $('#offerDialog');
  const offersDataEl = $('#offersData');
  const OFFER_CATEGORY = { turkey: 'تركيا', egypt: 'مصر', georgia: 'جورجيا', umrah: 'الحج والعمرة', cruise: 'رحلات الكروز', visa: 'التأشيرات' };
  const offersMap = new Map();
  if (offersDataEl) {
    try {
      JSON.parse(offersDataEl.textContent).forEach((o) => offersMap.set(o.slug, o));
    } catch { /* ignore malformed data */ }
  }

  function openOffer(slug) {
    const offer = offersMap.get(slug);
    if (!offer || !offerDialogEl) return;
    const currency = offer.currency || 'د.أ';
    const price = offer.price ? `${Number(offer.price).toLocaleString('en-US')} ${currency}` : 'السعر عند الطلب';
    $('#offerDialogImage').src = offer.image || offer.thumb || '';
    $('#offerDialogImage').alt = offer.alt || offer.title;
    $('#offerDialogKicker').textContent = `${OFFER_CATEGORY[offer.category] || 'عرض خاص'}${offer.days ? ` · ${offer.days} أيام / ${offer.nights} ليالٍ` : ''}`;
    $('#offerDialogTitle').textContent = offer.title;
    $('#offerDialogText').textContent = offer.body || '';
    $('#offerDialogPrice').textContent = price;
    $('#offerDialogIncludes').innerHTML = (offer.includes || []).map((item) => {
      const li = document.createElement('li');
      li.textContent = item;
      return li.outerHTML;
    }).join('');
    const waBtn = $('#offerDialogWa');
    if (waBtn) waBtn.setAttribute('data-wa-text', `السلام عليكم، أرغب بالاستفسار عن العرض: ${offer.title}${offer.price ? ` — السعر المعلن ${price}` : ''}`);
    if (typeof offerDialogEl.showModal === 'function') offerDialogEl.showModal();
    else offerDialogEl.setAttribute('open', '');
    document.body.classList.add('no-scroll');
  }

  function closeOffer() {
    if (!offerDialogEl) return;
    offerDialogEl.close();
    document.body.classList.remove('no-scroll');
  }

  document.addEventListener('click', (e) => {
    const opener = e.target.closest('[data-offer-open]');
    if (opener) {
      e.preventDefault();
      openOffer(opener.getAttribute('data-offer-open'));
      return;
    }
    if (e.target.closest('[data-offer-close]')) closeOffer();
    if (e.target === offerDialogEl) closeOffer();
  });

  offerDialogEl?.addEventListener('close', () => document.body.classList.remove('no-scroll'));

  /* deep link: /offers#offer-trabzon opens that poster (initial load and hash changes) */
  function openOfferFromHash() {
    const slug = decodeURIComponent((location.hash || '').replace(/^#/, ''));
    if (slug && offersMap.has(slug)) openOffer(slug);
  }
  window.addEventListener('hashchange', openOfferFromHash);
  setTimeout(openOfferFromHash, 250);

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (waModal && !waModal.hidden) closeWa();
  });

  /* ---------------- UI sounds (Web Audio API, no audio files) ---------------- */
  const SoundKit = (() => {
    const KEY = 'loret_sound';
    let ctx = null;
    let master = null;
    let enabled = true;
    try { enabled = localStorage.getItem(KEY) !== 'off'; } catch { /* private mode */ }
    let lastHover = 0;

    function ensure() {
      if (!enabled) return null;
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      if (!ctx) {
        ctx = new AC();
        master = ctx.createGain();
        master.gain.value = 0.45;
        master.connect(ctx.destination);
      }
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      return ctx;
    }

    function tone({ freq = 880, to = 1180, dur = 0.07, gain = 0.03, type = 'sine', delay = 0 }) {
      const c = ensure();
      if (!c) return;
      const t0 = c.currentTime + delay;
      const osc = c.createOscillator();
      const g = c.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, t0);
      osc.frequency.exponentialRampToValueAtTime(Math.max(60, to), t0 + dur);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(gain, t0 + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(g);
      g.connect(master);
      osc.start(t0);
      osc.stop(t0 + dur + 0.02);
    }

    return {
      get enabled() { return enabled; },
      hover() {
        if (!enabled) return;
        const now = performance.now();
        if (now - lastHover < 90) return;
        lastHover = now;
        tone({ freq: 1040, to: 1320, dur: 0.055, gain: 0.018, type: 'sine' });
      },
      click() {
        if (!enabled) return;
        tone({ freq: 620, to: 780, dur: 0.06, gain: 0.03, type: 'triangle' });
        tone({ freq: 930, to: 1040, dur: 0.05, gain: 0.018, type: 'sine', delay: 0.045 });
      },
      toggle() {
        enabled = !enabled;
        try { localStorage.setItem(KEY, enabled ? 'on' : 'off'); } catch { /* ignore */ }
        if (enabled) {
          ensure();
          tone({ freq: 700, to: 980, dur: 0.09, gain: 0.028 });
        }
        return enabled;
      },
      prime() { if (enabled) ensure(); },
    };
  })();

  const soundBtn = $('#soundToggle');
  function syncSoundButton() {
    if (!soundBtn) return;
    soundBtn.setAttribute('aria-pressed', String(SoundKit.enabled));
    const label = SoundKit.enabled ? 'كتم المؤثرات الصوتية' : 'تفعيل المؤثرات الصوتية';
    soundBtn.setAttribute('aria-label', label);
    soundBtn.title = label;
  }
  syncSoundButton();
  soundBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    SoundKit.toggle();
    syncSoundButton();
  });

  // AudioContext needs one user gesture before it can start.
  document.addEventListener('pointerdown', () => SoundKit.prime(), { once: true });
  document.addEventListener('keydown', () => SoundKit.prime(), { once: true });

  const SOUND_TARGETS = 'a[href], button, [role="button"], .card-media, .poster-media, .service-tile, .chip, .figure';
  document.addEventListener('pointerover', (e) => {
    if (e.pointerType && e.pointerType !== 'mouse') return;
    const el = e.target.closest(SOUND_TARGETS);
    if (!el || el.disabled || el.id === 'soundToggle') return;
    SoundKit.hover();
  }, { passive: true });

  document.addEventListener('pointerdown', (e) => {
    const el = e.target.closest('a[href], button, [role="button"]');
    if (!el || el.disabled || el.id === 'soundToggle') return;
    SoundKit.click();
  }, { passive: true });

  /* ---------------- lazy hero video (poster first, video on demand) ---------------- */
  const heroVideo = $('#heroVideo');
  if (heroVideo) {
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const conn = navigator.connection || {};
    const saveData = conn.saveData === true || /(^|-)2g$/.test(conn.effectiveType || '');
    if (reduceMotion || saveData) {
      heroVideo.remove();
    } else {
      const startVideo = () => {
        if (!heroVideo.src) {
          heroVideo.poster = heroVideo.dataset.poster || '';
          heroVideo.src = heroVideo.dataset.src;
          heroVideo.load();
        }
        const playing = heroVideo.play();
        if (playing && playing.catch) playing.catch(() => {});
      };
      heroVideo.addEventListener('loadeddata', () => heroVideo.classList.add('is-ready'), { once: true });
      if ('IntersectionObserver' in window) {
        const io = new IntersectionObserver((entries) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting) startVideo();
            else heroVideo.pause();
          });
        }, { rootMargin: '240px 0px' });
        io.observe(heroVideo);
        // Fallback for environments where IO callbacks are throttled or unavailable.
        setTimeout(() => {
          const rect = heroVideo.getBoundingClientRect();
          if (rect.top < window.innerHeight + 320 && rect.bottom > -320) startVideo();
        }, 1200);
      } else {
        startVideo();
      }
      document.addEventListener('visibilitychange', () => {
        if (!heroVideo.src) return;
        if (document.hidden) heroVideo.pause();
        else heroVideo.play().catch(() => {});
      });
    }
  }

  /* ---------------- misc ---------------- */
  $$('a[href^="#"]').forEach((a) => {
    a.addEventListener('click', (e) => {
      const id = a.getAttribute('href');
      if (!id || id === '#') return;
      const target = document.querySelector(id);
      if (target) {
        e.preventDefault();
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  });
})();
