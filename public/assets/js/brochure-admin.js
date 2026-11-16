function destinationControls(presets, brochure = {}) {
  const fieldset = document.createElement('fieldset');
  fieldset.className = 'bh-destination-fields';
  const legend = document.createElement('legend');
  legend.textContent = 'الموقع على خريطة العالم';
  fieldset.append(legend);
  const addField = (label, name, input) => {
    const field = document.createElement('label');
    field.className = 'field';
    field.textContent = label;
    input.name = name;
    field.append(input);
    fieldset.append(field);
    return input;
  };
  const picker = addField('وجهة جاهزة', '', document.createElement('select'));
  picker.add(new Option('اختر وجهة أو أدخل موقعًا يدويًا', ''));
  presets.forEach((preset, i) => picker.add(new Option(preset.destination_name, String(i))));
  const inputs = {};
  for (const [name, label, limit, max] of [
    ['destination_name','اسم الدبوس',100], ['country_code','رمز الدولة (مثل TR)',2],
    ['latitude','خط العرض',0,90], ['longitude','خط الطول',0,180],
  ]) {
    const input = addField(label, name, document.createElement('input'));
    input.value = brochure[name] ?? '';
    if (limit) input.maxLength = limit;
    else { input.type = 'number'; input.step = 'any'; input.min = -max; input.max = max; input.dir = 'ltr'; }
    inputs[name] = input;
  }
  picker.onchange = () => {
    if (picker.value === '') return;
    const preset = presets[Number(picker.value)];
    for (const [key, input] of Object.entries(inputs)) input.value = preset[key];
    const destination = fieldset.form?.elements.namedItem('destination');
    if (destination && !destination.value.trim()) destination.value = preset.destination_name;
  };
  const hint = document.createElement('small');
  hint.textContent = 'يمكن تعديل الإحداثيات بعد الاختيار. اترك الإحداثيات فارغة لإبقاء الكتيب في البطاقات فقط.';
  fieldset.append(hint);
  return fieldset;
}

const MAX_PDF = 25 * 1024 * 1024;

export async function mountBrochureAdmin(view) {
  const categories = await request('/api/admin/brochures');
  if (!view.isConnected) return;
  view.innerHTML = `
    <section class="admin-card"><div class="admin-card-body">
      <h2>رفع كتيب سفر</h2>
      <form id="bh-upload">
        <fieldset style="border:0;padding:0;margin:0">
          <label class="field" id="bh-drop" style="border:2px dashed #8299ac;border-radius:12px;padding:20px">
            اسحب ملف PDF هنا أو اختره من الجهاز · 25 ميغابايت كحد أقصى
            <input name="pdf" type="file" accept="application/pdf,.pdf">
            <span id="bh-file-name" aria-live="polite"></span>
          </label>
          <div class="grid grid-2">
            <label class="field">عنوان البرنامج<input name="title" required maxlength="160"></label>
            <label class="field">التصنيف<select name="category" required></select></label>
            <label class="field">الوجهة<input name="destination" required maxlength="100"></label>
            <label class="field">المدة<input name="duration" maxlength="80" placeholder="10 أيام / 9 ليالٍ"></label>
            <label class="field">السعر المبدئي<input name="starting_price" maxlength="80" placeholder="1249 دينار"></label>
            <label class="field">غلاف اختياري<input name="cover" type="file" accept="image/jpeg,image/png,image/webp"></label>
          </div>
          <button class="btn btn-primary" type="submit">رفع ونشر الكتيب</button>
        </fieldset>
        <progress max="100" hidden aria-label="تقدم رفع الكتيب"></progress>
        <p id="bh-upload-status" role="status"></p>
      </form>
    </div></section>
    <section class="admin-card" style="margin-top:16px"><div class="admin-card-body">
      <h2>الكتيبات المنشورة والمخفية</h2>
      <p><a href="/brochures" target="_blank" rel="noopener">فتح قسم الكتيبات على الموقع</a></p>
      <p id="bh-list-status" role="status"></p><div id="bh-list"></div>
      <button class="btn btn-ghost" id="bh-more" type="button" hidden>عرض المزيد</button>
    </div></section>`;
  const at = selector => view.querySelector(selector);
  const form = at('#bh-upload');
  form.querySelector('[type=submit]').before(destinationControls(categories.destinations));
  const list = at('#bh-list');
  const more = at('#bh-more');
  const feedback = at('#bh-upload-status');
  const listStatus = at('#bh-list-status');
  const drop = at('#bh-drop');
  const progress = form.querySelector('progress');
  let selectedPdf;
  let page = 0;
  for (const [key, label] of Object.entries(categories.categories)) {
    form.elements.category.add(new Option(label, key));
  }

  function choose(file) {
    selectedPdf = undefined;
    at('#bh-file-name').textContent = file?.name || '';
    feedback.textContent = '';
    if (!file) return;
    if (file.size > MAX_PDF || (file.type !== 'application/pdf' && !(!file.type && /\.pdf$/i.test(file.name)))) {
      feedback.textContent = 'اختر ملف PDF بحجم لا يتجاوز 25 ميغابايت.';
      return;
    }
    selectedPdf = file;
  }
  form.elements.pdf.addEventListener('change', () => choose(form.elements.pdf.files[0]));
  drop.addEventListener('dragover', event => { event.preventDefault(); });
  drop.addEventListener('drop', event => {
    event.preventDefault();
    if (!form.querySelector('fieldset').disabled) choose(event.dataTransfer.files[0]);
  });

  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (!selectedPdf) {
      feedback.textContent = 'اختر ملف PDF صالحًا أولًا.';
      return;
    }
    const data = new FormData(form);
    const pdf = selectedPdf.type ? selectedPdf : new Blob([selectedPdf], { type: 'application/pdf' });
    data.set('pdf', pdf, selectedPdf.name);
    if (!form.elements.cover.files.length) data.delete('cover');
    const fieldset = form.querySelector('fieldset');
    fieldset.disabled = true;
    progress.hidden = false;
    progress.removeAttribute('value');
    feedback.textContent = 'جارٍ رفع الكتيب…';
    try {
      await upload(data, percent => {
        progress.value = percent;
        if (percent === 100) feedback.textContent = 'جارٍ حفظ الكتيب…';
      });
      form.reset();
      selectedPdf = undefined;
      at('#bh-file-name').textContent = '';
      feedback.textContent = 'تم نشر الكتيب.';
      await load(true);
    } catch (error) {
      feedback.textContent = error.message;
    } finally {
      fieldset.disabled = false;
      progress.hidden = true;
    }
  });

  function addRow(brochure) {
    const row = document.createElement('article');
    row.className = 'admin-card';
    row.style.marginBlock = '10px';
    const content = document.createElement('div');
    content.className = 'admin-card-body';
    const title = document.createElement('h3');
    title.textContent = brochure.title;
    const info = document.createElement('p');
    info.textContent = [categories.categories[brochure.category], brochure.destination,
      brochure.is_active ? 'منشور' : 'مخفي', brochure.download_count + ' تحميل'].join(' · ');
    const toggle = document.createElement('button');
    toggle.className = 'btn btn-ghost btn-sm';
    toggle.textContent = brochure.is_active ? 'إخفاء' : 'نشر';
    const remove = document.createElement('button');
    remove.className = 'btn btn-ghost btn-sm';
    remove.textContent = 'حذف';
    const actions = document.createElement('div');
    actions.className = 'btn-row';
    actions.append(toggle, remove);
    if (brochure.is_active) {
      const preview = document.createElement('a');
      preview.className = 'btn btn-ghost btn-sm';
      preview.href = brochure.preview_url;
      preview.target = '_blank';
      preview.rel = 'noopener';
      preview.textContent = 'معاينة';
      actions.append(preview);
    }
    const change = async (method, suffix) => {
      toggle.disabled = true;
      remove.disabled = true;
      try {
        await request('/api/brochures/' + brochure.id + suffix, method);
        await load(true);
      } catch (error) {
        listStatus.textContent = error.message;
      } finally {
        toggle.disabled = false;
        remove.disabled = false;
      }
    };
    toggle.onclick = () => change('PATCH', '/toggle');
    remove.onclick = () => { if (window.confirm('حذف هذا الكتيب وملفه نهائيًا؟')) change('DELETE', ''); };
    const edit = document.createElement('details');
    const summary = document.createElement('summary');
    summary.textContent = 'تعديل البيانات';
    const editForm = document.createElement('form');
    for (const [key, label, max] of [['title','العنوان',160], ['category','التصنيف',0],
      ['destination','الوجهة',100], ['duration','المدة',80], ['starting_price','السعر المبدئي',80]]) {
      const field = document.createElement('label');
      field.className = 'field';
      field.textContent = label;
      const input = document.createElement(max ? 'input' : 'select');
      input.name = key;
      if (max) input.maxLength = max;
      else for (const [value, name] of Object.entries(categories.categories)) input.add(new Option(name, value));
      input.value = brochure[key];
      input.required = ['title','destination','category'].includes(key);
      field.append(input);
      editForm.append(field);
    }
    const save = document.createElement('button');
    save.className = 'btn btn-primary btn-sm';
    save.textContent = 'حفظ التغييرات';
    editForm.append(destinationControls(categories.destinations, brochure), save);
    editForm.onsubmit = async event => {
      event.preventDefault();
      save.disabled = true;
      try {
        await request('/api/brochures/' + brochure.id, 'PATCH', Object.fromEntries(new FormData(editForm)));
        await load(true);
      } catch (error) {
        listStatus.textContent = error.message;
      } finally {
        save.disabled = false;
      }
    };
    edit.append(summary, editForm);
    content.append(title, info, actions, edit);
    row.append(content);
    list.append(row);
  }

  let requestId = 0;
  async function load(reset = false, initial = null) {
    const id = ++requestId;
    if (reset) page = 0;
    more.hidden = true;
    more.disabled = true;
    listStatus.textContent = 'جارٍ تحميل القائمة…';
    try {
      const result = initial || await request('/api/admin/brochures?page=' + (page + 1));
      if (id !== requestId) return;
      if (reset) list.replaceChildren();
      result.brochures.forEach(addRow);
      page = result.page;
      more.hidden = !result.hasMore;
      listStatus.textContent = list.childElementCount ? '' : 'لم تُرفع كتيبات بعد.';
    } catch (error) {
      if (id !== requestId) return;
      const retry = document.createElement('button');
      retry.className = 'btn btn-ghost btn-sm';
      retry.textContent = 'إعادة المحاولة';
      retry.onclick = () => load(reset);
      listStatus.replaceChildren(error.message + ' ', retry);
    } finally {
      if (id === requestId) more.disabled = false;
    }
  }
  more.onclick = () => load();
  await load(true, categories);
}

async function request(url, method = 'GET', body) {
  const response = await fetch(url, { method, headers: { 'x-requested-with': 'fetch',
    ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.message || 'تعذّر تنفيذ الطلب. حاول مجددًا.');
  return result;
}

function upload(data, progress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/brochures');
    xhr.setRequestHeader('x-requested-with', 'fetch');
    xhr.responseType = 'json';
    xhr.upload.onprogress = event => {
      if (event.lengthComputable) progress(Math.round(event.loaded / event.total * 100));
    };
    xhr.onload = () => {
      if (xhr.status === 201) resolve(xhr.response);
      else reject(new Error(xhr.response?.message || 'تعذّر رفع الملف. حاول مجددًا.'));
    };
    xhr.onerror = () => reject(new Error('انقطع الاتصال أثناء الرفع. تحقق من اتصالك وحاول مجددًا.'));
    xhr.send(data);
  });
}
