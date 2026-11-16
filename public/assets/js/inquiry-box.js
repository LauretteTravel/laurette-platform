/* صندوق «طلب فندق بديل أو الاستفسار عن العرض» — متحكم الواجهة العامة.
   يقرأ سياق البرنامج من خصائص data-iq-* على الزر (يرندرها lib/views/inquiry-box.js)،
   ثم يرسل الطلب إلى POST /api/inquiries ويبدّل النموذج إلى حالة نجاح فيها المرجع
   وزر واتساب جاهز بالرسالة المنسّقة القادمة من الخادم.

   قواعد العمل (التحقق، نص واتساب، الكتابة، n8n) ليست هنا إطلاقاً — lib/inquiries.js. */
(() => {
  'use strict';

  const modal = document.getElementById('inquiryModal');
  if (!modal) return;
  const form = modal.querySelector('#inquiryForm');
  const statusEl = modal.querySelector('#inquiryStatus');
  const successEl = modal.querySelector('#inquirySuccess');
  const submitBtn = modal.querySelector('.inquiry-submit');
  const refEl = modal.querySelector('#inquiryRef');
  const waEl = modal.querySelector('#inquiryWa');
  const nameInput = modal.querySelector('#inquiryName');
  const phoneInput = modal.querySelector('#inquiryPhone');
  const notesInput = modal.querySelector('#inquiryNotes');
  const views = {
    title: modal.querySelector('[data-iq-view="title"]'),
    hotel: modal.querySelector('[data-iq-view="hotel"]'),
    duration: modal.querySelector('[data-iq-view="duration"]'),
    price: modal.querySelector('[data-iq-view="price"]'),
  };
  let lastFocus = null;

  function setStatus(message, isError = false) {
    if (!statusEl) return;
    statusEl.textContent = message || '';
    statusEl.className = isError ? 'form-status is-error' : 'form-status';
  }

  function clearErrors() {
    modal.querySelectorAll('.field.has-error').forEach((field) => field.classList.remove('has-error'));
  }

  function markError(input) {
    const field = input?.closest('.field');
    if (field) field.classList.add('has-error');
    input?.focus();
  }

  function fillContext(trigger) {
    const data = trigger ? trigger.dataset : {};
    const title = String(data.iqTitle || '').trim();
    const values = {
      title: title || 'عرض من لوريت',
      hotel: String(data.iqHotel || '').trim() || '—',
      duration: String(data.iqDuration || '').trim() || '—',
      price: String(data.iqPrice || '').trim() || 'السعر عند الطلب',
    };
    for (const [key, node] of Object.entries(views)) {
      if (node) node.textContent = values[key];
    }
    form.elements.slug.value = String(data.iqSlug || '');
    form.elements.programId.value = String(data.iqId || '');
    form.elements.category.value = String(data.iqCategory || '');
  }

  function open(trigger) {
    /* بوسترات /offers تُفتح داخل <dialog> في الطبقة العليا؛ نغلقها كي لا يحجب الصندوق. */
    document.querySelectorAll('dialog[open]').forEach((dialog) => {
      try { dialog.close(); } catch { /* ignore */ }
    });
    lastFocus = trigger || document.activeElement;
    form.reset();
    form.hidden = false;
    successEl.hidden = true;
    clearErrors();
    setStatus('');
    if (submitBtn) submitBtn.disabled = false;
    fillContext(trigger);
    modal.hidden = false;
    document.body.classList.add('no-scroll');
    setTimeout(() => nameInput?.focus(), 40);
  }

  function close() {
    if (modal.hidden) return;
    modal.hidden = true;
    if (!document.querySelector('dialog[open]')) document.body.classList.remove('no-scroll');
    try { lastFocus?.focus?.(); } catch { /* ignore */ }
  }

  document.addEventListener('click', (event) => {
    const trigger = event.target.closest('[data-inquiry-open]');
    if (trigger) {
      event.preventDefault();
      open(trigger);
      return;
    }
    if (event.target.closest('[data-inquiry-close]') || event.target === modal) close();
  });

  document.addEventListener('keydown', (event) => {
    if (modal.hidden) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusables = [...modal.querySelectorAll('button, [href], input, select, textarea')]
      .filter((el) => !el.disabled && el.offsetParent !== null);
    if (!focusables.length) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });

  /* لوحة مفاتيح عربية: تحويل الأرقام الهندية إلى لاتينية داخل حقل الهاتف. */
  phoneInput?.addEventListener('input', () => {
    const next = phoneInput.value
      .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
      .replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
    if (next !== phoneInput.value) phoneInput.value = next;
  });

  function validate(payload) {
    if (payload.name.trim().length < 2) {
      setStatus('أدخل الاسم الكامل (حرفان على الأقل).', true);
      markError(nameInput);
      return false;
    }
    const digits = payload.phone.replace(/\D/g, '');
    if (!/^\+?[0-9]{8,15}$/.test(payload.phone.replace(/[\s\-().]/g, '')) || digits.length < 8) {
      setStatus('رقم الهاتف غير صالح (مثال: 0791234567).', true);
      markError(phoneInput);
      return false;
    }
    if (!payload.consent) {
      setStatus('يجب الموافقة على حفظ البيانات قبل الإرسال.', true);
      form.elements.consent.focus();
      return false;
    }
    return true;
  }

  function track(slug, inquiryType) {
    try {
      fetch('/api/track-event', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-requested-with': 'fetch' },
        body: JSON.stringify({
          event: 'lead',
          type: 'inquiry_box',
          path: location.pathname,
          meta: { slug, inquiryType },
        }),
      }).catch(() => {});
    } catch { /* التتبع لا يكسر الإرسال */ }
  }

  function renderSuccess(data) {
    form.hidden = true;
    successEl.hidden = false;
    refEl.textContent = data.reference || '';
    if (data.whatsappUrl) {
      waEl.href = data.whatsappUrl;
      waEl.hidden = false;
    } else {
      waEl.hidden = true;
    }
    setStatus('');
    try { successEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch { /* ignore */ }
    setTimeout(() => (data.whatsappUrl ? waEl : successEl.querySelector('[data-inquiry-close]'))?.focus(), 60);
  }

  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearErrors();
    setStatus('');
    const checkedType = form.querySelector('input[name="inquiryType"]:checked');
    const checkedBranch = form.querySelector('input[name="branch"]:checked');
    const payload = {
      slug: form.elements.slug.value,
      programId: form.elements.programId.value,
      category: form.elements.category.value,
      title: views.title?.textContent === 'عرض من لوريت' ? '' : views.title?.textContent || '',
      inquiryType: checkedType?.value || 'alternative_hotel',
      notes: notesInput?.value || '',
      name: nameInput?.value || '',
      phone: phoneInput?.value || '',
      branch: checkedBranch?.value || '',
      consent: form.elements.consent.checked,
    };
    if (!validate(payload)) return;

    submitBtn.disabled = true;
    setStatus('جارٍ إرسال الاستفسار…');
    try {
      const res = await fetch('/api/inquiries', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-requested-with': 'fetch' },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) {
        if (res.status === 429) setStatus('عدد المحاولات كبير. حاول بعد قليل أو راسلنا على واتساب مباشرة.', true);
        else if (data.errors) {
          const [field, message] = Object.entries(data.errors)[0] || [];
          setStatus(message || 'تحقق من الحقول المطلوبة.', true);
          if (field === 'name') markError(nameInput);
          else if (field === 'phone') markError(phoneInput);
          else if (field === 'consent') form.elements.consent.focus();
        } else setStatus(data.message || 'تعذر إرسال الاستفسار الآن. حاول مرة أخرى أو راسلنا على واتساب.', true);
        submitBtn.disabled = false;
        return;
      }
      renderSuccess(data);
      track(payload.slug, payload.inquiryType);
    } catch {
      setStatus('تعذر الاتصال بالخادم. تحقق من الشبكة وحاول مرة أخرى.', true);
      submitBtn.disabled = false;
    }
  });
})();
