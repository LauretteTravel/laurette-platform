(() => {
  const dialog = document.querySelector('#programInquiryDialog');
  if (!dialog?.showModal) return;
  const find = selector => dialog.querySelector(selector);
  const loading = find('#pi-loading');
  const header = find('#pi-context');
  const details = find('#pi-details');
  const box = find('#pi-box');
  const form = find('#pi-form');
  const feedback = find('#pi-feedback');
  const success = find('#pi-success');
  const submit = form.querySelector('[type=submit]');
  const number = new Intl.NumberFormat('ar-JO', { maximumFractionDigits: 3 });
  let opening;
  let submitting = false;

  function element(tag, value) {
    const node = document.createElement(tag);
    if (value != null) node.textContent = value;
    return node;
  }

  function amount(price, currency) {
    return price == null ? 'السعر عند الطلب' : number.format(price) + ' ' + (currency === 'JOD' || !currency ? 'دينار أردني' : currency);
  }

  function showProgram(program, useDetails, href) {
    find('#pi-title').textContent = useDetails ? 'تفاصيل البرنامج' : 'تخصيص العرض أو السؤال عن فندق آخر';
    header.replaceChildren(element('h3', program.title));
    const facts = element('dl');
    for (const [label, value] of [
      ['الفندق الحالي', program.current_hotel || 'غير محدد'],
      ['المدة', program.days ? program.days + ' أيام / ' + program.nights + ' ليالٍ' : 'حسب البرنامج'],
      ['السعر المنشور', amount(program.price, program.currency)],
    ]) facts.append(element('dt', label), element('dd', value));
    header.append(facts);
    if (useDetails) {
      if (program.tiers.length) {
        const table = element('table');
        table.className = 'table-small';
        table.createCaption().textContent = 'الأسعار حسب الإشغال';
        const head = table.createTHead().insertRow();
        for (const text of ['الإشغال / الخيار', 'السعر']) {
          const cell = element('th', text);
          cell.scope = 'col';
          head.append(cell);
        }
        const rows = table.createTBody();
        for (const tier of program.tiers) {
          const row = rows.insertRow();
          row.insertCell().textContent = tier.label;
          row.insertCell().textContent = amount(tier.price, tier.currency);
        }
        details.append(table);
      }
      if (program.itinerary.length) {
        const itinerary = element('ol');
        for (const step of program.itinerary) itinerary.append(element('li', step));
        details.append(element('h3', 'خط سير الرحلة'), itinerary);
      }
      const fullPage = element('a', 'عرض صفحة البرنامج الكاملة');
      fullPage.href = href;
      details.append(fullPage);
      details.hidden = false;
    }
    form.elements.program_id.value = program.id;
    form.elements.category.value = program.category;
    box.open = !useDetails;
    header.hidden = box.hidden = false;
  }

  async function openProgram(trigger, useDetails) {
    opening?.abort();
    const request = new AbortController();
    opening = request;
    form.reset();
    feedback.textContent = '';
    find('#pi-title').textContent = useDetails ? 'تفاصيل البرنامج' : 'تخصيص العرض أو السؤال عن فندق آخر';
    header.hidden = details.hidden = box.hidden = success.hidden = true;
    details.replaceChildren();
    loading.textContent = 'جارٍ تحميل البرنامج…';
    if (!dialog.open) dialog.showModal();
    try {
      const slug = new URL(trigger.href).pathname.split('/').filter(Boolean).at(-1);
      const response = await fetch('/api/inquiries/program?' + new URLSearchParams({ slug: decodeURIComponent(slug) }), { signal: request.signal });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'تعذّر تحميل البرنامج.');
      if (request.signal.aborted) return;
      loading.textContent = '';
      showProgram(data.program, useDetails, trigger.href);
    } catch (error) {
      if (request.signal.aborted) return;
      const link = element('a', 'فتح صفحة البرنامج');
      link.href = trigger.href;
      loading.replaceChildren(error.message + ' ', link);
    }
  }

  document.addEventListener('click', event => {
    const trigger = event.target.closest('[data-program-inquiry],[data-program-details]');
    if (!trigger || event.defaultPrevented || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.button !== 0) return;
    event.preventDefault();
    if (!submitting) openProgram(trigger, trigger.hasAttribute('data-program-details'));
  });

  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (submitting) return;
    const values = Object.fromEntries(new FormData(form));
    values.program_id = Number(values.program_id);
    submitting = true;
    submit.disabled = true;
    feedback.textContent = 'جارٍ إرسال الاستفسار…';
    try {
      const response = await fetch('/api/inquiries', { method: 'POST', headers: { 'content-type': 'application/json', 'x-requested-with': 'fetch' },
        body: JSON.stringify(values) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || 'تعذّر الحفظ. حاول مرة أخرى.');
      box.hidden = true;
      success.querySelector('p').textContent = 'رقم الاستفسار #' + result.id + '. يمكن أيضًا إرسال التفاصيل إلى الفرع عبر واتساب.';
      success.querySelector('a').href = result.whatsapp_url;
      success.hidden = false;
      form.reset();
      success.querySelector('h3').focus();
    } catch (error) {
      feedback.textContent = error.message;
    } finally {
      submitting = false;
      submit.disabled = false;
    }
  });
  dialog.addEventListener('close', () => opening?.abort());
  dialog.addEventListener('cancel', event => { if (submitting) event.preventDefault(); });
  dialog.querySelector('[method=dialog]').addEventListener('submit', event => { if (submitting) event.preventDefault(); });
})();
