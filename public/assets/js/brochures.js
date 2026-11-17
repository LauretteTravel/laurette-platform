const grid = document.querySelector('#brochure-grid');
const status = document.querySelector('#brochure-status');
const more = document.querySelector('#brochure-more');
const filters = document.querySelector('#brochure-filters');
const tabs = document.querySelector('#brochure-categories');
const dialog = document.querySelector('#brochure-preview');
let category = '';
let query = '';
let page = 0;
let pending;
let destination = '';
let selectedBrochure;
let inquiryVersion = 0;
const inquiry = dialog.querySelector('#brochure-inquiry');
const inquiryStatus = inquiry.querySelector('#bh-inquiry-status');
const destinationsSection = document.querySelector('#brochure-destinations');
const locations = destinationsSection.querySelector('.bh-destination-list');
const clearDestination = document.querySelector('#brochure-clear-destination');
const jod = new Intl.NumberFormat('ar-JO', { maximumFractionDigits: 3 });
let mapRequest;

function pinLabel(pin) {
  return pin.destination_name + ' — ' + (pin.lowest_price_jod == null ? 'السعر عند الاستفسار' :
    'ابتداءً من ' + jod.format(pin.lowest_price_jod) + ' دينار');
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function fileSize(bytes) {
  const value = Number(bytes) || 0;
  const format = new Intl.NumberFormat('ar-JO', { maximumFractionDigits: 1 });
  if (value >= 1024 * 1024) return format.format(value / (1024 * 1024)) + ' ميغابايت';
  return Math.max(1, Math.round(value / 1024)).toLocaleString('ar-JO') + ' كيلوبايت';
}

function download(link, url) {
  link.href = url;
  link.download = '';
  link.addEventListener('click', () => {
    if (link.dataset.busy) return;
    const original = link.dataset.label || link.textContent;
    link.dataset.label = original;
    link.dataset.busy = '1';
    link.setAttribute('aria-busy', 'true');
    link.textContent = 'جارٍ بدء التحميل…';
    setTimeout(() => { link.textContent = '✓ بدأ التحميل'; }, 650);
    setTimeout(() => {
      link.textContent = original;
      link.removeAttribute('aria-busy');
      delete link.dataset.busy;
    }, 2600);
  });
}

function preview(brochure) {
  selectedBrochure = brochure;
  inquiryVersion++;
  inquiry.reset();
  inquiry.querySelector('[type=submit]').disabled = false;
  inquiryStatus.textContent = '';
  updateInquiryWhatsApp();
  dialog.querySelector('h2').textContent = brochure.title;
  const frame = dialog.querySelector('iframe');
  frame.src = brochure.preview_url;
  dialog.querySelector('[data-open]').href = brochure.preview_url;
  const share = new URL('https://wa.me/');
  share.searchParams.set('text', brochure.title + '\n' + new URL(brochure.download_url, location.origin).href);
  dialog.querySelector('[data-share]').href = share;
  dialog.querySelector('[data-download]').href = brochure.download_url;
  dialog.showModal();
}

function card(brochure, categories) {
  const article = element('article', 'bh-card');
  const image = element('img', 'bh-cover');
  image.src = brochure.cover_image_url || '/media/brand/og-default.jpg';
  image.alt = '';
  image.width = 640;
  image.height = 640;
  image.loading = 'lazy';
  const body = element('div', 'bh-card-body');
  body.append(element('span', 'bh-badge', categories[brochure.category]));
  body.append(element('h2', '', brochure.title));
  body.append(element('p', 'bh-muted', [brochure.destination, brochure.duration].filter(Boolean).join(' · ')));
  body.append(element('p', 'bh-muted', 'PDF · ' + fileSize(brochure.file_size)));
  body.append(element('p', 'bh-price', brochure.starting_price ? 'ابتداءً من ' + brochure.starting_price : 'السعر عند الاستفسار'));
  const actions = element('div', 'bh-card-actions');
  const direct = element('a', 'btn btn-primary', 'تحميل البرنامج (PDF)');
  download(direct, brochure.download_url);
  const quick = element('button', 'btn btn-ghost', 'معاينة سريعة');
  quick.type = 'button';
  quick.addEventListener('click', () => preview(brochure));
  actions.append(direct, quick);
  body.append(actions);
  article.append(image, body);
  return article;
}

async function load(reset = false) {
  pending?.abort();
  const request = new AbortController();
  pending = request;
  if (reset) {
    page = 0;
    grid.replaceChildren();
    more.hidden = true;
  }
  const params = new URLSearchParams({ category, q: query, destination, page: page + 1 });
  status.textContent = 'جارٍ تحميل الكتيبات…';
  more.disabled = true;
  try {
    const response = await fetch('/api/brochures?' + params, { signal: request.signal });
    if (!response.ok) throw new Error();
    const result = await response.json();
    if (request.signal.aborted) return;
    grid.append(...result.brochures.map(brochure => card(brochure, result.categories)));
    page = result.page;
    more.hidden = !result.hasMore;
    status.textContent = grid.childElementCount ? '' : 'لا توجد كتيبات مطابقة. جرّب تصنيفًا آخر أو كلمة بحث مختلفة.';
  } catch {
    if (request.signal.aborted) return;
    const retry = element('button', 'btn btn-ghost', 'إعادة المحاولة');
    retry.type = 'button';
    retry.addEventListener('click', () => load());
    status.replaceChildren(document.createTextNode('تعذّر تحميل الكتيبات. '), retry);
  } finally {
    if (pending === request) more.disabled = false;
  }
}

filters.addEventListener('submit', event => {
  event.preventDefault();
  query = new FormData(filters).get('q').trim();
  refreshCatalogue();
});
tabs.addEventListener('click', event => {
  const button = event.target.closest('[data-category]');
  if (!button) return;
  category = button.dataset.category;
  for (const tab of tabs.children) tab.setAttribute('aria-pressed', String(tab === button));
  refreshCatalogue();
});
more.addEventListener('click', () => load());
dialog.addEventListener('close', () => dialog.querySelector('iframe').removeAttribute('src'));
download(dialog.querySelector('[data-download]'), '#');

function updateInquiryWhatsApp() {
  const url = new URL('https://wa.me/' + dialog.dataset.sales);
  const question = inquiry.elements.message.value.trim();
  url.searchParams.set('text', ['مرحبًا لوريت، أود الاستفسار عن كتيب «' + selectedBrochure.title + '».', question].filter(Boolean).join('\n'));
  inquiry.querySelector('[data-inquiry-whatsapp]').href = url;
}

inquiry.addEventListener('input', updateInquiryWhatsApp);
inquiry.querySelector('.bh-inquiry-chips').addEventListener('click', event => {
  const button = event.target.closest('button');
  if (!button) return;
  inquiry.elements.message.value = button.textContent;
  updateInquiryWhatsApp();
  inquiry.elements.message.focus();
});
inquiry.addEventListener('submit', async event => {
  event.preventDefault();
  const message = inquiry.elements.message.value.trim();
  if (message.length < 2) { inquiryStatus.textContent = 'اكتب سؤالك أولًا.'; return; }
  const version = inquiryVersion;
  const submit = inquiry.querySelector('[type=submit]');
  submit.disabled = true;
  inquiryStatus.textContent = 'جارٍ إرسال الاستفسار…';
  try {
    const response = await fetch('/api/inquiries', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ brochure_id: selectedBrochure.id, message, phone: inquiry.elements.phone.value.trim() }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || 'تعذّر إرسال الاستفسار.');
    if (version === inquiryVersion) inquiryStatus.textContent = 'تم حفظ استفسارك. رقم الطلب #' + data.id;
  } catch (error) {
    if (version === inquiryVersion) inquiryStatus.textContent = error.message || 'تعذّر إرسال الاستفسار.';
  } finally {
    if (version === inquiryVersion) submit.disabled = false;
  }
});

function selectDestination(pin, scroll = false) {
  destination = pin?.key || '';
  clearDestination.hidden = !pin;
  clearDestination.textContent = pin ? 'إزالة فلتر ' + pin.destination_name + ' ×' : '';
  for (const button of locations.children) button.setAttribute('aria-pressed', String(button.dataset.destination === destination));
  load(true);
  if (scroll && pin) {
    clearDestination.focus({ preventScroll: true });
    clearDestination.scrollIntoView({ block: 'nearest' });
  }
}
clearDestination.onclick = () => selectDestination(null);

function locationButton(pin) {
  const button = element('button', 'bh-location', pinLabel(pin));
  button.type = 'button';
  button.dataset.destination = pin.key;
  button.setAttribute('aria-pressed', String(destination === pin.key));
  button.onclick = () => selectDestination(pin, true);
  return button;
}

dialog.addEventListener('close', () => { inquiryVersion++; });

async function loadDestinations() {
  mapRequest?.abort();
  const request = new AbortController();
  mapRequest = request;
  try {
    const params = new URLSearchParams({ category, q: query });
    const response = await fetch('/api/brochures/map?' + params, { signal: request.signal });
    if (!response.ok) throw new Error();
    const { pins } = await response.json();
    if (request.signal.aborted) return;
    locations.replaceChildren(...pins.map(locationButton));
    destinationsSection.hidden = pins.length === 0;
  } catch {
    if (request.signal.aborted) return;
    destinationsSection.hidden = true;
  }
}

function refreshCatalogue() {
  selectDestination(null);
  void loadDestinations();
}

refreshCatalogue();
