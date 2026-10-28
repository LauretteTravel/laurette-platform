/* لوريت — بوابة حساب العميل */
(() => {
  'use strict';

  const portal = document.getElementById('clientPortal');
  if (!portal) return;

  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[char]);
  let phoneCodes = [];
  let currentUser = null;
  let pendingEmail = '';
  let currentPage = 1;
  const fieldLabels = { firstName: 'الاسم الأول', lastName: 'اسم العائلة', email: 'البريد الإلكتروني', password: 'كلمة المرور', phone: 'رقم الهاتف' };

  async function waitForTransition() {
    if (window.loretShowTransition) {
      await window.loretShowTransition();
      window.loretHideTransition?.();
    } else {
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }

  async function transitionStep(render) {
    await waitForTransition();
    render();
  }

  async function api(path, { method = 'GET', body } = {}) {
    const response = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: {
        ...(body ? { 'content-type': 'application/json' } : {}),
        ...(method !== 'GET' ? { 'x-requested-with': 'fetch' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await response.json();
    if (!response.ok || !data.ok) {
      const error = new Error(data.message || 'تعذر تنفيذ الطلب');
      error.status = response.status;
      error.data = data;
      throw error;
    }
    return data;
  }

  function showMessage(message, isError = false) {
    const slot = portal.querySelector('[data-account-message]');
    if (!slot) return;
    slot.textContent = message || '';
    slot.classList.toggle('is-error', isError);
    slot.classList.toggle('is-success', Boolean(message) && !isError);
  }

  function field(name, label, { type = 'text', value = '', autocomplete = '', required = true, inputmode = '', readonly = false } = {}) {
    return `<label class="client-field">${esc(label)}<input name="${esc(name)}" type="${esc(type)}" value="${esc(value)}" ${autocomplete ? `autocomplete="${esc(autocomplete)}"` : ''} ${inputmode ? `inputmode="${esc(inputmode)}"` : ''} ${required ? 'required' : ''} ${readonly ? 'readonly' : ''}></label>`;
  }

  function phoneFields(phone = '+962') {
    const match = phoneCodes
      .filter((country) => phone.startsWith(country.callingCode))
      .sort((a, b) => b.callingCode.length - a.callingCode.length)[0];
    const code = match?.callingCode || '+962';
    const local = phone.startsWith(code) ? phone.slice(code.length) : phone.replace(/^\+/, '');
    const options = phoneCodes.map((country) => `<option value="${esc(country.callingCode)}" ${country.callingCode === code && country === match ? 'selected' : ''}>${esc(country.flag)} ${esc(country.name)} (${esc(country.callingCode)})</option>`).join('');
    return `<div class="client-field"><span>رقم الهاتف</span><div class="client-phone-row"><select name="phoneCountryCode" aria-label="رمز الدولة" required>${options || `<option value="+962" selected>🇯🇴 الأردن (+962)</option>`}</select><input name="phone" type="tel" dir="ltr" inputmode="tel" autocomplete="tel-national" value="${esc(local)}" placeholder="791234567" required></div></div>`;
  }

  function shell(title, subtitle, content, actions = '') {
    portal.innerHTML = `<section class="client-auth-card panel"><span class="eyebrow">حساب لوريت</span><h2>${esc(title)}</h2><p class="muted">${esc(subtitle)}</p>${content}<p class="client-message" data-account-message role="status" aria-live="polite"></p>${actions ? `<div class="client-auth-actions">${actions}</div>` : ''}</section>`;
  }

  function showLogin(message = '') {
    shell('مرحبًا بعودتك', 'سجّل الدخول لمتابعة حجوزاتك وعروض الأسعار.', `
      <form class="client-form" data-form="login">
        ${field('email', 'البريد الإلكتروني', { type: 'email', autocomplete: 'email' })}
        ${field('password', 'كلمة المرور', { type: 'password', autocomplete: 'current-password' })}
        <button class="btn btn-primary btn-lg" type="submit">تسجيل الدخول</button>
      </form>`,
    '<button class="client-text-button" type="button" data-action="signup">إنشاء حساب جديد</button>');
    showMessage(message, Boolean(message));
  }

  function showSignup(message = '') {
    shell('أنشئ حسابك', 'استخدم بياناتك لتجميع طلبات السفر ومتابعة تحديثاتها.', `
      <form class="client-form" data-form="signup">
        <div class="client-name-grid">${field('firstName', 'الاسم الأول', { autocomplete: 'given-name' })}${field('lastName', 'اسم العائلة', { autocomplete: 'family-name' })}</div>
        ${field('email', 'البريد الإلكتروني', { type: 'email', autocomplete: 'email' })}
        ${phoneFields()}
        ${field('password', 'كلمة المرور (10 أحرف على الأقل)', { type: 'password', autocomplete: 'new-password' })}
        <p class="client-help">سنرسل رمز تأكيد إلى بريدك الإلكتروني. لا يمكن تسجيل الدخول قبل تأكيده.</p>
        <button class="btn btn-primary btn-lg" type="submit">إنشاء الحساب وإرسال الرمز</button>
      </form>`,
    '<button class="client-text-button" type="button" data-action="login">لديك حساب؟ سجّل الدخول</button>');
    showMessage(message, Boolean(message));
  }

  function showVerification(email, message = '') {
    pendingEmail = email;
    shell('أكد بريدك الإلكتروني', `أدخل رمز التحقق المكوّن من 6 أرقام الذي أرسلناه إلى ${email}. الرمز صالح لمدة 10 دقائق.`, `
      <form class="client-form" data-form="verify">
        ${field('code', 'رمز التأكيد', { type: 'text', autocomplete: 'one-time-code', inputmode: 'numeric' })}
        <button class="btn btn-primary btn-lg" type="submit">تأكيد البريد والدخول</button>
      </form>
      <button class="client-text-button" type="button" data-action="resend">إعادة إرسال الرمز</button>`,
    '<button class="client-text-button" type="button" data-action="login">العودة لتسجيل الدخول</button>');
    const input = portal.querySelector('[name="code"]');
    input.maxLength = 6;
    input.pattern = '[0-9]{6}';
    input.autofocus = true;
    showMessage(message, Boolean(message));
  }

  function statusClass(status) {
    return ({ new: 'blue', reviewing: 'amber', quoted: 'violet', awaiting: 'amber', confirmed: 'green', cancelled: 'red' })[status] || 'blue';
  }

  function dateLabel(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('ar-JO', { dateStyle: 'medium', timeStyle: 'short' });
  }

  function bookingCard(booking) {
    const steps = [
      { id: 'new', label: 'استلام الطلب' },
      { id: 'reviewing', label: 'المراجعة' },
      { id: 'quoted', label: 'العرض' },
      { id: 'confirmed', label: 'التأكيد' },
    ];
    const position = ({ new: 0, reviewing: 1, quoted: 2, awaiting: 2, confirmed: 3, cancelled: -1 })[booking.status] ?? 0;
    const timeline = booking.timeline?.length
      ? `<details class="booking-history"><summary>سجل التحديثات (${booking.timeline.length})</summary><ol class="timeline">${booking.timeline.map((event) => `<li><b>${esc(event.message || event.kind)}</b><span>${esc(dateLabel(event.at))}</span></li>`).join('')}</ol></details>`
      : '';
    const quote = booking.quote
      ? `<div class="booking-quote"><span>عرض السعر</span><strong>${Number(booking.quote.amount).toLocaleString('en-US')} ${esc(booking.quote.currency || 'د.أ')}</strong>${booking.quote.note ? `<p>${esc(booking.quote.note)}</p>` : ''}</div>`
      : '';
    return `<article class="booking-card">
      <div class="booking-card-head"><div><span class="badge badge-soft">${esc(booking.typeLabel)}</span><span class="status-dot status-${esc(booking.status)}">${esc(booking.statusLabel)}</span></div><strong dir="ltr">${esc(booking.reference)}</strong></div>
      <h3>${esc(booking.summary || booking.typeLabel)}</h3>
      <p class="booking-date">تاريخ الإرسال: ${esc(dateLabel(booking.createdAt))}</p>
      ${quote}
      ${booking.status === 'cancelled'
        ? '<p class="booking-cancelled">تم إلغاء هذا الطلب.</p>'
        : `<ol class="booking-progress" aria-label="تقدم الطلب">${steps.map((step, index) => `<li class="${index < position ? 'is-done' : ''} ${index === position ? 'is-current' : ''}"><span>${index < position ? '✓' : index + 1}</span><small>${step.label}</small></li>`).join('')}</ol>`}
      ${timeline}
      <a class="booking-track-link" href="/track?reference=${encodeURIComponent(booking.reference)}">فتح صفحة المتابعة ›</a>
    </article>`;
  }

  async function showDashboard(view = 'bookings', message = '', page = 1, transition = false) {
    const [bookingData, me] = await Promise.all([api(`/api/client/bookings?page=${page}`), api('/api/client/auth/me')]);
    currentUser = me.user;
    currentPage = bookingData.page || 1;
    if (!currentUser) {
      if (transition) {
        await transitionStep(() => showLogin('انتهت الجلسة. سجّل الدخول مرة أخرى.'));
        return;
      }
      showLogin('انتهت الجلسة. سجّل الدخول مرة أخرى.');
      return;
    }
    if (transition) {
      await waitForTransition();
    }
    const bookings = bookingData.bookings || [];
    const profileView = view === 'profile';
    const content = profileView
      ? `<section class="client-dashboard-body"><div class="client-section-heading"><div><span class="eyebrow">بيانات الحساب</span><h2>ملفي الشخصي</h2><p>حدّث اسمك ورقم التواصل. البريد الإلكتروني المؤكد لا يمكن تغييره من هذه الصفحة.</p></div><a class="client-text-button" href="/account">عرض حجوزاتي</a></div>
          <form class="client-form client-profile-form" data-form="profile">
            <div class="client-name-grid">${field('firstName', 'الاسم الأول', { value: currentUser.firstName, autocomplete: 'given-name' })}${field('lastName', 'اسم العائلة', { value: currentUser.lastName, autocomplete: 'family-name' })}</div>
            ${field('email', 'البريد الإلكتروني المؤكد', { type: 'email', value: currentUser.email, autocomplete: 'email', readonly: true })}
            ${phoneFields(currentUser.phone)}
            <button class="btn btn-primary" type="submit">حفظ التغييرات</button>
          </form></section>`
      : `<section class="client-dashboard-body"><div class="client-section-heading"><div><span class="eyebrow">ملفك السياحي</span><h2>حجوزاتي وطلباتي</h2><p>كل طلباتك المرتبطة ببريدك المؤكد، مع الحالة والعروض وسجل التحديثات.</p></div><div class="client-heading-actions"><button class="btn btn-ghost btn-sm" type="button" data-action="refresh">تحديث الحالات</button><a class="btn btn-gold btn-sm" href="/programs">استكشف البرامج</a></div></div>
          ${bookings.length ? `<div class="client-bookings">${bookings.map(bookingCard).join('')}</div>` : `<div class="client-empty"><span class="client-empty-mark">✦</span><h3>لا توجد طلبات مرتبطة بحسابك بعد</h3><p>أرسل أول طلب سفر، وسنضيف الطلبات المرتبطة ببريدك المؤكد إلى هذه الصفحة.</p><div class="btn-row"><a class="btn btn-primary" href="/flights">اطلب رحلة</a><a class="btn btn-ghost" href="/programs">تصفح البرامج</a></div></div>`}
          ${bookingData.pages > 1 ? `<nav class="booking-pagination" aria-label="صفحات الطلبات"><button type="button" data-action="booking-page" data-page="${currentPage - 1}" ${currentPage <= 1 ? 'disabled' : ''}>الأحدث</button><span>صفحة ${currentPage} من ${bookingData.pages} · ${bookingData.total} طلب</span><button type="button" data-action="booking-page" data-page="${currentPage + 1}" ${currentPage >= bookingData.pages ? 'disabled' : ''}>الأقدم</button></nav>` : ''}</section>`;

    portal.innerHTML = `<div class="client-dashboard">
      <aside class="client-sidebar panel">
        <div class="client-avatar" aria-hidden="true">${esc((currentUser.firstName || 'ل').slice(0, 1))}</div>
        <h2>${esc(currentUser.firstName)} ${esc(currentUser.lastName)}</h2>
        <p>${esc(currentUser.email)}</p>
        <span class="client-verified"><b aria-hidden="true">✓</b> بريد مؤكد</span>
        <nav class="client-account-nav" aria-label="قائمة الحساب">
          <a href="/account" ${profileView ? '' : 'aria-current="page"'}>حجوزاتي <span>${bookingData.total}</span></a>
          <a href="/account/profile" ${profileView ? 'aria-current="page"' : ''}>ملفي الشخصي</a>
        </nav>
        <button class="client-text-button client-logout" type="button" data-action="logout">تسجيل الخروج</button>
      </aside>
      <div class="client-dashboard-main">${content}<p class="client-message" data-account-message role="status" aria-live="polite"></p></div>
    </div>`;
    showMessage(message, false);
  }

  function setBusy(form, busy, label) {
    const button = form.querySelector('button[type="submit"]');
    if (!button) return;
    button.disabled = busy;
    if (busy) {
      button.dataset.originalText = button.textContent;
      button.textContent = label || 'جارٍ التنفيذ…';
    } else if (button.dataset.originalText) {
      button.textContent = button.dataset.originalText;
      delete button.dataset.originalText;
    }
  }

  function formData(form) {
    return Object.fromEntries(new FormData(form).entries());
  }

  portal.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-action]');
    if (!button) return;
    const action = button.dataset.action;
    if (action === 'signup') return transitionStep(() => showSignup());
    if (action === 'login') return transitionStep(() => showLogin());
    if (action === 'refresh') {
      button.disabled = true;
      try {
        await showDashboard('bookings', 'تم تحديث الحالات الآن.', currentPage, true);
      } catch (error) {
        showMessage(error.message, true);
        const refreshButton = portal.querySelector('[data-action="refresh"]');
        if (refreshButton) refreshButton.disabled = false;
      }
      return;
    }
    if (action === 'booking-page') {
      const page = Number(button.dataset.page);
      if (Number.isInteger(page) && page > 0) {
        try {
          await showDashboard('bookings', '', page, true);
        } catch (error) {
          showMessage(error.message, true);
        }
      }
      return;
    }
    if (action === 'resend') {
      button.disabled = true;
      try {
        const result = await api('/api/client/auth/resend', { method: 'POST', body: { email: pendingEmail } });
        await transitionStep(() => showVerification(pendingEmail, result.message));
      } catch (error) {
        await transitionStep(() => showVerification(pendingEmail, error.message));
      }
      return;
    }
    if (action === 'logout') {
      button.disabled = true;
      try {
        await api('/api/client/auth/logout', { method: 'POST', body: {} });
        currentUser = null;
        await transitionStep(() => showLogin('تم تسجيل الخروج بأمان.'));
        showMessage('تم تسجيل الخروج بأمان.', false);
      } catch (error) {
        button.disabled = false;
        showMessage(error.message, true);
      }
    }
  });

  portal.addEventListener('submit', async (event) => {
    const form = event.target.closest('[data-form]');
    if (!form) return;
    event.preventDefault();
    form.querySelectorAll('[aria-invalid="true"]').forEach((input) => input.removeAttribute('aria-invalid'));
    setBusy(form, true);
    const values = formData(form);
    try {
      if (form.dataset.form === 'signup') {
        const result = await api('/api/client/auth/register', { method: 'POST', body: values });
        await transitionStep(() => showVerification(values.email.trim().toLowerCase(), result.message));
      } else if (form.dataset.form === 'login') {
        const result = await api('/api/client/auth/login', { method: 'POST', body: values });
        currentUser = result.user;
        await showDashboard(portal.dataset.initialView === 'profile' ? 'profile' : 'bookings', '', 1, true);
      } else if (form.dataset.form === 'verify') {
        const result = await api('/api/client/auth/verify', { method: 'POST', body: { email: pendingEmail, code: values.code } });
        currentUser = result.user;
        await showDashboard('bookings', 'تم تأكيد بريدك الإلكتروني.', 1, true);
      } else if (form.dataset.form === 'profile') {
        const result = await api('/api/client/profile', { method: 'PATCH', body: values });
        currentUser = result.user;
        await showDashboard('profile', 'تم حفظ بياناتك بنجاح.', 1, true);
      }
    } catch (error) {
      if (form.dataset.form === 'login' && error.data?.errors?.emailVerificationRequired) {
        await transitionStep(() => showVerification(values.email.trim().toLowerCase(), error.message));
      } else if (form.dataset.form === 'signup' && error.status === 503) {
        await transitionStep(() => showVerification(values.email.trim().toLowerCase(), error.message));
      } else {
        const details = Object.entries(error.data?.errors || {})
          .map(([name, message]) => `${fieldLabels[name] || name}: ${message}`)
          .join(' · ');
        showMessage(details ? `${error.message} — ${details}` : error.message, true);
        const firstInvalid = Object.keys(error.data?.errors || {})
          .map((name) => form.elements.namedItem(name))
          .find(Boolean);
        if (firstInvalid) {
          firstInvalid.setAttribute('aria-invalid', 'true');
          firstInvalid.focus();
        }
        setBusy(form, false);
      }
      return;
    }
    setBusy(form, false);
  });

  async function initialize() {
    try {
      const response = await fetch('/assets/data/phone-codes.json', { credentials: 'same-origin' });
      if (!response.ok) throw new Error(`Unable to load country codes (${response.status})`);
      phoneCodes = await response.json();
    } catch (error) {
      console.error('[client-account]', error.message);
    }
    try {
      const result = await api('/api/client/auth/me');
      if (result.user) {
        currentUser = result.user;
        await showDashboard(portal.dataset.initialView === 'profile' ? 'profile' : 'bookings');
      } else {
        showLogin();
      }
    } catch (error) {
      console.error('[client-account]', error.message);
      showLogin('تعذر تحميل الحساب. حدّث الصفحة وحاول مرة أخرى.');
    }
  }

  initialize();
})();
