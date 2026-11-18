// No libraries, tracking or storage of contact details in the browser.
document.querySelectorAll('[role="tablist"]').forEach(list => {
  const tabs = [...list.querySelectorAll('[role="tab"]')];
  function select(tab) {
    tabs.forEach(item => {
      const selected = item === tab;
      item.setAttribute('aria-selected', String(selected));
      item.tabIndex = selected ? 0 : -1;
      if (!tab.dataset.program) document.getElementById(item.getAttribute('aria-controls')).hidden = !selected;
    });
    if (tab.dataset.program) {
      document.getElementById('program-panel').setAttribute('aria-labelledby', tab.id);
      document.getElementById('program-title').textContent = tab.textContent;
      document.getElementById('preferred-program').value = tab.dataset.program;
    }
  }
  tabs.forEach(tab => tab.addEventListener('click', () => select(tab)));
  list.addEventListener('keydown', event => {
    const current = tabs.indexOf(document.activeElement);
    if (current < 0) return;
    const delta = event.key === 'ArrowLeft' ? 1 : event.key === 'ArrowRight' ? -1 : 0;
    let next;
    if (delta) next = (current + delta + tabs.length) % tabs.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = tabs.length - 1;
    else return;
    event.preventDefault(); select(tabs[next]); tabs[next].focus();
  });
});

const storageKey = 'laurette-hajj-1448-packing-v1';
const checks = [...document.querySelectorAll('.checklist input')];
try {
  const saved = JSON.parse(localStorage.getItem(storageKey) || '[]');
  if (Array.isArray(saved)) checks.forEach(input => { input.checked = saved.includes(input.value); });
} catch { /* Checklist remains usable when browser storage is unavailable. */ }
function updateChecklist(save = true) {
  const selected = checks.filter(input => input.checked).map(input => input.value);
  document.getElementById('check-count').textContent = `${selected.length} / ${checks.length}`;
  document.getElementById('check-progress').value = selected.length;
  if (save) { try { localStorage.setItem(storageKey, JSON.stringify(selected)); } catch {} }
}
checks.forEach(input => input.addEventListener('change', () => updateChecklist()));
document.getElementById('reset-checklist').addEventListener('click', () => { checks.forEach(input => { input.checked = false; }); updateChecklist(); });
updateChecklist(false);

document.getElementById('interest-form').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  if (form.dataset.sending === 'true' || !form.reportValidity()) return;
  const data = new FormData(form);
  const phone = String(data.get('phone')).replace(/[٠-٩۰-۹]/g, c => String(c.charCodeAt(0) & 15)).replace(/[\s().-]/g, '');
  const status = document.getElementById('form-status');
  if (!/^(?:07\d{8}|(?:\+|00)[1-9]\d{6,14}|9627\d{8})$/.test(phone)) {
    status.textContent = 'أدخل رقمًا أردنيًا مثل 0791234567 أو رقمًا دوليًا يبدأ برمز الدولة.';
    document.getElementById('customer-phone').focus(); return;
  }
  const submit = form.querySelector('[type="submit"]');
  const track = document.getElementById('request-track');
  track.hidden = true; form.dataset.sending = 'true'; submit.disabled = true;
  status.textContent = 'جارٍ إرسال طلبك…';
  try {
    // Uses the existing consultation inbox; no unconfirmed program record is created.
    const response = await fetch('/api/requests', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'consult', topic: 'umrah', channel: 'whatsapp',
        name: String(data.get('name')).trim(), phone, consent: true, source: 'hajj-2027',
        message: `تسجيل اهتمام بالحج المميز 1448هـ - 2027م. برنامج الحج ${data.get('program')}، عدد الأفراد: ${data.get('people')}. يرجى التواصل لتأكيد التفاصيل.` }),
      signal: AbortSignal.timeout(20000),
    });
    const result = await response.json();
    if (!response.ok || !result.ok || !result.reference) throw new Error(result.error || 'تعذر حفظ الطلب. يرجى المحاولة مجددًا.');
    status.textContent = `شكرًا لك، تم تسجيل اهتمامك. رقم المتابعة: ${result.reference}. سيتواصل معك فريق لوريت.`;
    track.href = `/track?reference=${encodeURIComponent(result.reference)}`;
    track.hidden = false; form.reset();
  } catch (error) {
    status.textContent = error.name === 'TimeoutError'
      ? 'لم يصل تأكيد الحفظ بعد. يمكنك إعادة المحاولة أو التواصل معنا عبر واتساب.'
      : 'تعذر تأكيد حفظ الطلب. تحقق من اتصالك والبيانات ثم حاول مجددًا، أو تواصل معنا عبر واتساب.';
  } finally { submit.disabled = false; form.dataset.sending = 'false'; }
});
