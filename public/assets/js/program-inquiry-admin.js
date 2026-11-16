const formatDate = new Intl.DateTimeFormat('ar-JO', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Asia/Amman' });

function node(tag, value) {
  const el = document.createElement(tag);
  if (value != null) el.textContent = value;
  return el;
}

export async function mountProgramInquiriesAdmin(view, { api, canWrite, setCount, isActive }) {
  const card = node('section');
  card.className = 'admin-card';
  const body = node('div');
  body.className = 'admin-card-body';
  const message = node('p');
  message.setAttribute('role', 'status');
  const scroll = node('div');
  scroll.className = 'table-wrap';
  const buttons = node('div');
  buttons.className = 'btn-row';
  const previous = node('button', 'السابق');
  const next = node('button', 'التالي');
  for (const button of [previous, next]) { button.type = 'button'; button.className = 'btn btn-ghost'; button.disabled = true; }
  const position = node('span');
  buttons.append(previous, position, next);
  body.append(message, scroll, buttons);
  card.append(body);
  view.replaceChildren(card);
  let page = 1;

  function fillTable(data) {
    const table = node('table');
    table.className = 'admin-table';
    table.createCaption().textContent = 'استفسارات الفنادق والعروض · بتوقيت عمّان';
    const header = table.createTHead().insertRow();
    for (const label of ['التاريخ والوقت','العميل','الهاتف / واتساب','البرنامج','نوع الاستفسار','الفندق المطلوب / الملاحظات','الفرع','الحالة']) {
      const cell = node('th', label);
      cell.scope = 'col';
      header.append(cell);
    }
    const rows = table.createTBody();
    for (const inquiry of data.inquiries) {
      const row = rows.insertRow();
      row.insertCell().textContent = formatDate.format(new Date(inquiry.created_at));
      row.insertCell().textContent = inquiry.customer_name || '—';
      const link = node('a', inquiry.customer_phone);
      link.href = 'https://wa.me/' + inquiry.customer_phone.replace(/\D/g, '');
      link.dir = 'ltr';
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      const contact = row.insertCell();
      if (inquiry.customer_phone) contact.append(link);
      else contact.textContent = '—';
      const program = row.insertCell();
      program.textContent = inquiry.program_title;
      if (inquiry.current_hotel) program.append(node('br'), node('small', inquiry.current_hotel));
      row.insertCell().textContent = inquiry.brochure_title ? 'استفسار من معاينة كتيب' : (data.types[inquiry.inquiry_type] || inquiry.inquiry_type);
      const notes = row.insertCell();
      notes.textContent = inquiry.requested_hotel_notes || '—';
      notes.style.cssText = 'min-width:12rem;white-space:pre-wrap;overflow-wrap:anywhere';
      row.insertCell().textContent = data.branches[inquiry.preferred_branch] || 'أي فرع';
      const status = row.insertCell();
      if (!canWrite) { status.textContent = inquiry.status; continue; }
      const select = node('select');
      select.setAttribute('aria-label', 'حالة الاستفسار #' + inquiry.id);
      for (const option of data.statuses) select.add(new Option(option, option));
      select.value = inquiry.status;
      select.onchange = async () => {
        select.disabled = true;
        message.textContent = 'جارٍ تحديث الحالة…';
        try {
          const updated = await api('/api/admin/inquiries/' + inquiry.id, {
            method: 'PATCH', body: JSON.stringify({ status: select.value }),
          });
          inquiry.status = updated.status;
          message.textContent = 'تم تحديث الحالة.';
          void api('/api/admin/inquiries?count=1').then(count => {
            if (isActive()) setCount(count.new_count);
          }).catch(() => {});
        } catch (error) {
          select.value = inquiry.status;
          message.textContent = error.message;
        } finally { select.disabled = false; }
      };
      status.append(select);
    }
    scroll.replaceChildren(table);
  }

  async function load(target) {
    previous.disabled = next.disabled = true;
    message.textContent = 'جارٍ تحميل الاستفسارات…';
    try {
      const data = await api('/api/admin/inquiries?page=' + target);
      if (!isActive() || !card.isConnected) return;
      page = data.page;
      position.textContent = 'صفحة ' + page;
      previous.disabled = page === 1;
      next.disabled = !data.has_more;
      setCount(data.new_count);
      if (data.inquiries.length) { fillTable(data); message.textContent = ''; }
      else { scroll.replaceChildren(); message.textContent = 'لا توجد استفسارات في نطاق عملك.'; }
    } catch (error) {
      const retry = node('button', 'إعادة المحاولة');
      retry.type = 'button';
      retry.className = 'btn btn-ghost btn-sm';
      retry.onclick = () => load(target);
      message.replaceChildren(error.message + ' ', retry);
    }
  }
  previous.onclick = () => load(page - 1);
  next.onclick = () => load(page + 1);
  await load(1);
}
