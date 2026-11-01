(() => {
  "use strict";
  const esc = (value) =>
    String(value ?? "").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
  const STATUS = { draft: "مسودة", issued: "صادرة", cancelled: "ملغاة" },
    TYPE = { flight: "طيران", hotel: "فندق" };
  const fmt = (value) =>
    new Intl.DateTimeFormat("ar-JO", {
      timeZone: "Asia/Amman",
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(value));
  async function mount(container, { api, hasPermission }) {
    container.innerHTML =
      '<div class="vl-root"><p>جارٍ تحميل أرشيف القسائم…</p></div>';
    const host = container.firstElementChild,
      $ = (selector) => host.querySelector(selector),
      can = (action) => hasPermission("vouchers:" + action);
    let row = null,
      data = null,
      page = 1,
      filters = {},
      generation = 0,
      dirty = false;
    const status = (message) => {
      const slot = $("[data-vl-status]");
      if (slot) slot.textContent = message;
    };
    function defaultData(kind) {
      return {
        language: "ar",
        bookingReference: "",
        people: [{ name: "", ticketNumber: "" }],
        notes: "",
        ...(kind === "flight"
          ? { flight: { airline: "", baggage: "", segments: [segment()] } }
          : {
              hotel: {
                name: "",
                address: "",
                checkIn: "",
                checkOut: "",
                checkInTime: "14:00",
                checkOutTime: "12:00",
                roomType: "",
                mealPlan: "",
                guestCount: 1,
                cancellationPolicy: "",
              },
            }),
      };
    }
    function segment() {
      return {
        from: "",
        to: "",
        flightNumber: "",
        departAt: "",
        departZone: "Asia/Amman",
        arriveAt: "",
        arriveZone: "Europe/Istanbul",
      };
    }
    async function archive() {
      const token = ++generation;
      row = null;
      try {
        const result = await api(
          "/api/admin/vouchers?" + new URLSearchParams({ ...filters, page }),
        );
        if (!host.isConnected || token !== generation) return;
        host.innerHTML = `<div class="toolbar">${can("write") ? '<button class="btn btn-primary" data-vl-new>قسيمة جديدة</button>' : ""}<p>قسائم الطيران والفنادق المحفوظة — التواريخ بتوقيت عمّان</p></div><form data-vl-filter class="toolbar"><label>بحث بالمرجع أو الاسم أو الطلب<input name="q" maxlength="100" value="${esc(filters.q)}"></label><label>النوع<select name="kind"><option value="">الكل</option>${Object.entries(
          TYPE,
        )
          .map(
            ([key, label]) =>
              `<option value="${key}" ${filters.kind === key ? "selected" : ""}>${label}</option>`,
          )
          .join(
            "",
          )}</select></label><label>الحالة<select name="status"><option value="">الكل</option>${Object.entries(
          STATUS,
        )
          .map(
            ([key, label]) =>
              `<option value="${key}" ${filters.status === key ? "selected" : ""}>${label}</option>`,
          )
          .join(
            "",
          )}</select></label><label>من<input type="date" name="from" value="${esc(filters.from)}"></label><label>إلى<input type="date" name="to" value="${esc(filters.to)}"></label><button class="btn btn-ghost">بحث</button></form><p data-vl-status class="form-status" role="status" aria-live="polite"></p><p>${result.total} قسيمة</p><div class="vl-archive"><table class="admin-table"><thead><tr><th>المرجع</th><th>النوع</th><th>الطلب</th><th>الحالة</th><th>الإصدار</th><th>التحديث</th></tr></thead><tbody>${result.vouchers.map((v) => `<tr><td><button class="btn btn-ghost" data-vl-open="${v.id}" dir="ltr">${esc(v.reference)}</button></td><td>${TYPE[v.kind]}</td><td>${esc(v.request_reference)}</td><td>${STATUS[v.status]}${v.has_draft && v.current_version ? " · مسودة مراجعة" : ""}</td><td>${v.current_version || "لم تصدر"}</td><td>${fmt(v.updated_at)}</td></tr>`).join("") || '<tr><td colspan="6">لا توجد قسائم مطابقة.</td></tr>'}</tbody></table></div><div class="btn-row"><button class="btn btn-ghost" data-vl-prev ${page <= 1 ? "disabled" : ""}>السابق</button><span>${page}/${result.pages}</span><button class="btn btn-ghost" data-vl-next ${page >= result.pages ? "disabled" : ""}>التالي</button></div>`;
        $("[data-vl-new]")?.addEventListener("click", createForm);
        $("[data-vl-filter]").onsubmit = (e) => {
          e.preventDefault();
          filters = Object.fromEntries(new FormData(e.target));
          page = 1;
          archive();
        };
        host
          .querySelectorAll("[data-vl-open]")
          .forEach(
            (button) => (button.onclick = () => open(button.dataset.vlOpen)),
          );
        $("[data-vl-prev]").onclick = () => {
          page--;
          archive();
        };
        $("[data-vl-next]").onclick = () => {
          page++;
          archive();
        };
      } catch (error) {
        if (host.isConnected && token === generation)
          host.innerHTML = `<p class="form-status is-error" role="alert">${esc(error.message)}</p><button class="btn btn-ghost" data-vl-retry>إعادة المحاولة</button>`;
        $("[data-vl-retry]")?.addEventListener("click", archive);
      }
    }
    function back() {
      const b = $("[data-vl-back]");
      if (b) b.onclick = archive;
    }
    function createForm() {
      ++generation;
      row = null;
      host.innerHTML = `<button class="btn btn-ghost" data-vl-back>عودة للأرشيف</button><h2>قسيمة جديدة مرتبطة بطلب</h2><p>سجل الحجز هنا داخلي. لا ينشئ حجزًا لدى شركة طيران أو فندق، ولا يؤكد الطلب تلقائيًا.</p><form data-vl-search class="toolbar"><label>ابحث عن طلب بالمرجع أو العميل<input name="q" maxlength="100"></label><button class="btn btn-ghost">بحث عن طلب</button></form><form data-vl-create class="stack"><label>الطلب<select name="requestId" required><option value="">ابحث عن الطلب أولًا</option></select></label><label>نوع القسيمة<select name="kind"><option value="flight">طيران</option><option value="hotel">فندق</option></select></label><label>سبب الإنشاء<input name="reason" required minlength="3" maxlength="500"></label><p data-vl-status class="form-status is-error" role="status"></p><button class="btn btn-primary">إنشاء المسودة</button></form>`;
      back();
      $("[data-vl-search]").onsubmit = async (e) => {
        e.preventDefault();
        const button = e.target.querySelector("button");
        button.disabled = true;
        try {
          const result = await api(
            "/api/admin/requests?" +
              new URLSearchParams({
                q: new FormData(e.target).get("q") || "",
                limit: 25,
              }),
          );
          if (!host.isConnected || !$("[data-vl-create]")) return;
          $("[name=requestId]").innerHTML =
            '<option value="">اختر الطلب</option>' +
            result.requests
              .filter((r) => r.status !== "cancelled")
              .map(
                (r) =>
                  `<option value="${r.id}">${esc(r.reference)} · ${esc(r.title || r.summary || "طلب")}</option>`,
              )
              .join("");
          status(
            result.requests.length
              ? "اختر طلبًا من النتائج"
              : "لا توجد طلبات مطابقة ضمن صلاحياتك",
          );
        } catch (error) {
          status(error.message);
        } finally {
          button.disabled = false;
        }
      };
      $("[data-vl-create]").onsubmit = async (e) => {
        e.preventDefault();
        const button = e.target.querySelector("button");
        button.disabled = true;
        try {
          const values = Object.fromEntries(new FormData(e.target)),
            result = await api("/api/admin/vouchers", {
              method: "POST",
              body: JSON.stringify({
                requestId: Number(values.requestId),
                kind: values.kind,
                reason: values.reason,
                data: defaultData(values.kind),
              }),
            });
          if (host.isConnected) await open(result.id);
        } catch (error) {
          status(error.message);
          button.disabled = false;
        }
      };
    }
    async function open(id) {
      const token = ++generation;
      host.innerHTML = "<p>جارٍ تحميل القسيمة…</p>";
      try {
        const result = await api(
          "/api/admin/vouchers/" + encodeURIComponent(id),
        );
        if (!host.isConnected || token !== generation) return;
        row = result.voucher;
        data = structuredClone(row.data);
        dirty = false;
        editor(result);
      } catch (error) {
        if (host.isConnected && token === generation) {
          host.innerHTML = `<button class="btn btn-ghost" data-vl-back>عودة للأرشيف</button><p role="alert">${esc(error.message)}</p>`;
          back();
        }
      }
    }
    function get(path) {
      return path.split(".").reduce((value, key) => value?.[key], data) ?? "";
    }
    function field(
      label,
      path,
      { type = "text", area = false, hint = "" } = {},
    ) {
      const value = esc(get(path));
      return `<label>${esc(label)}${area ? `<textarea data-vl-path="${path}" rows="3">${value}</textarea>` : `<input data-vl-path="${path}" type="${type}" value="${value}" ${type === "number" ? 'min="1" max="30"' : ""}>`}${hint ? `<small>${esc(hint)}</small>` : ""}</label>`;
    }
    function editor(result) {
      const writable =
        row.hasDraft && can("write") && row.status !== "cancelled";
      host.innerHTML = `<div class="toolbar"><button class="btn btn-ghost" data-vl-back>عودة للأرشيف</button><h2 dir="ltr">${esc(row.reference)}</h2><span>${STATUS[row.status]} · نسخة ${row.current_version || "غير صادرة"}</span></div><p class="vl-note">الطلب ${esc(row.request_reference)} · حالته الحالية: ${row.request_status === "confirmed" ? "مؤكد" : row.request_status === "cancelled" ? "ملغى" : "غير مؤكد"}. لا تُصدر القسيمة قبل تأكيد الطلب في CRM.</p><div class="vl-editor"><section><form data-vl-edit class="stack"><fieldset ${writable ? "" : "disabled"}><legend>بيانات ${TYPE[row.kind]}</legend><label>لغة المستند<select data-vl-path="language"><option value="ar" ${data.language === "ar" ? "selected" : ""}>العربية</option><option value="en" ${data.language === "en" ? "selected" : ""}>English</option></select></label>${field(row.kind === "flight" ? "مرجع الحجز / PNR" : "مرجع حجز الفندق", "bookingReference")}<h3>${row.kind === "flight" ? "المسافرون" : "النزلاء"}</h3>${data.people.map((p, i) => `<fieldset><legend>${i + 1}</legend>${field("الاسم كما في الجواز", `people.${i}.name`)}${row.kind === "flight" ? field("رقم التذكرة إن وجد", `people.${i}.ticketNumber`) : ""}${writable ? `<button type="button" class="btn btn-ghost" data-vl-remove-person="${i}">حذف الاسم</button>` : ""}</fieldset>`).join("")}${writable ? '<button type="button" class="btn btn-ghost" data-vl-person>إضافة اسم</button>' : ""}${row.kind === "flight" ? flightFields(writable) : hotelFields()}${field("ملاحظات وشروط", "notes", { area: true })}</fieldset><label>سبب العملية<input name="reason" required minlength="3" maxlength="500" autocomplete="off"></label><p data-vl-status class="form-status is-error" role="status" aria-live="polite"></p><div class="btn-row">${writable ? '<button class="btn btn-primary" type="submit">حفظ المسودة</button>' : ""}${row.hasDraft && can("issue") && row.status !== "cancelled" ? '<button class="btn btn-primary" type="button" data-vl-action="issue">إصدار النسخة المحفوظة</button>' : ""}${!row.hasDraft && row.status === "issued" && can("write") ? '<button class="btn btn-ghost" type="button" data-vl-action="revisions">بدء مراجعة جديدة</button>' : ""}${row.status !== "cancelled" && can("cancel") ? '<button class="btn btn-ghost" type="button" data-vl-action="cancel">إلغاء القسيمة</button>' : ""}</div><small>الإصدار يستخدم البيانات المحفوظة على الخادم. احفظ تعديلات النموذج أولًا.</small></form><h3>الإصدارات المحفوظة</h3><ul>${result.versions.map((v) => `<li>نسخة ${v.version} · ${fmt(v.issued_at)} · ${row.status === "cancelled" ? "ملغاة" : v.version === row.current_version ? "الحالية" : "مستبدلة"} ${can("export") ? `<a class="btn btn-ghost" target="_blank" rel="noopener noreferrer" href="/api/admin/vouchers/${row.id}/versions/${v.version}/document">فتح المستند وPDF</a>` : ""}</li>`).join("") || "<li>لم تصدر نسخة بعد.</li>"}</ul><details><summary>سجل التعديلات — آخر 100 حدث</summary><ul class="vl-events">${result.events.map((e) => `<li>${esc(e.actor)} · ${esc(e.kind)} · ${fmt(e.created_at)}<p>${esc(e.reason)}</p></li>`).join("")}</ul></details></section><aside class="vl-preview" aria-label="معاينة البيانات"><img src="/assets/img/laurette-logo.png" alt="Laurette Travel"><h3>معاينة البيانات ${row.hasDraft ? "— مسودة غير صالحة للاستخدام" : ""}</h3><div data-vl-preview></div></aside></div>`;
      back();
      preview();
      if (dirty)
        status("تعديلات غير محفوظة؛ احفظ المسودة قبل المغادرة أو الإصدار");
      $("[data-vl-edit]").oninput = (e) => {
        const path = e.target.dataset.vlPath;
        if (!path) return;
        const keys = path.split(".");
        let target = data;
        for (const key of keys.slice(0, -1)) target = target[key];
        target[keys.at(-1)] =
          e.target.type === "number" ? Number(e.target.value) : e.target.value;
        dirty = true;
        status("تعديلات غير محفوظة؛ احفظ المسودة قبل المغادرة أو الإصدار");
        preview();
      };
      $("[data-vl-edit]").onsubmit = async (e) => {
        e.preventDefault();
        await mutate("", { data });
      };
      host
        .querySelectorAll("[data-vl-action]")
        .forEach(
          (button) => (button.onclick = () => mutate(button.dataset.vlAction)),
        );
      $("[data-vl-person]")?.addEventListener("click", () => {
        if (data.people.length >= 30) return status("الحد 30 اسمًا");
        data.people.push({ name: "", ticketNumber: "" });
        if (data.hotel) data.hotel.guestCount = data.people.length;
        dirty = true;
        editor(result);
      });
      host.querySelectorAll("[data-vl-remove-person]").forEach(
        (b) =>
          (b.onclick = () => {
            data.people.splice(Number(b.dataset.vlRemovePerson), 1);
            if (data.hotel)
              data.hotel.guestCount = Math.max(1, data.people.length);
            dirty = true;
            editor(result);
          }),
      );
      $("[data-vl-segment]")?.addEventListener("click", () => {
        if (data.flight.segments.length >= 6) return status("الحد 6 قطاعات");
        data.flight.segments.push(segment());
        dirty = true;
        editor(result);
      });
      host.querySelectorAll("[data-vl-remove-segment]").forEach(
        (b) =>
          (b.onclick = () => {
            data.flight.segments.splice(Number(b.dataset.vlRemoveSegment), 1);
            dirty = true;
            editor(result);
          }),
      );
    }
    function flightFields(writable) {
      return `${field("شركة الطيران", "flight.airline")}${field("الأمتعة والشروط الخاصة بها", "flight.baggage", { area: true })}<h3>قطاعات الطيران</h3>${data.flight.segments.map((s, i) => `<fieldset><legend>قطاع ${i + 1}</legend><div class="vl-fields">${field("مطار المغادرة", `flight.segments.${i}.from`)}${field("مطار الوصول", `flight.segments.${i}.to`)}${field("رقم الرحلة", `flight.segments.${i}.flightNumber`)}${field("المغادرة مع إزاحة UTC", `flight.segments.${i}.departAt`, { hint: "2027-04-01T12:30+03:00" })}${field("منطقة المغادرة الزمنية", `flight.segments.${i}.departZone`, { hint: "Asia/Amman" })}${field("الوصول مع إزاحة UTC", `flight.segments.${i}.arriveAt`, { hint: "2027-04-01T15:30+03:00" })}${field("منطقة الوصول الزمنية", `flight.segments.${i}.arriveZone`, { hint: "Europe/Istanbul" })}</div>${writable ? `<button type="button" class="btn btn-ghost" data-vl-remove-segment="${i}">حذف القطاع</button>` : ""}</fieldset>`).join("")}${writable ? '<button type="button" class="btn btn-ghost" data-vl-segment>إضافة قطاع</button>' : ""}`;
    }
    function hotelFields() {
      return `<h3>بيانات الإقامة</h3><div class="vl-fields">${field("اسم الفندق", "hotel.name")}${field("العنوان", "hotel.address", { area: true })}${field("تاريخ الدخول", "hotel.checkIn", { type: "date" })}${field("تاريخ الخروج", "hotel.checkOut", { type: "date" })}${field("وقت الدخول المحلي", "hotel.checkInTime", { type: "time" })}${field("وقت الخروج المحلي", "hotel.checkOutTime", { type: "time" })}${field("نوع الغرفة", "hotel.roomType")}${field("الوجبات", "hotel.mealPlan")}${field("عدد الضيوف", "hotel.guestCount", { type: "number" })}</div>${field("سياسة الإلغاء", "hotel.cancellationPolicy", { area: true })}`;
    }
    function preview() {
      const box = $("[data-vl-preview]");
      if (!box) return;
      const lines = [
        data.bookingReference,
        ...data.people.map((p) => p.name),
        ...(data.flight
          ? [
              data.flight.airline,
              data.flight.baggage,
              ...data.flight.segments.map(
                (s) =>
                  `${s.flightNumber} · ${s.from} → ${s.to}\n${s.departAt} ${s.departZone}\n${s.arriveAt} ${s.arriveZone}`,
              ),
            ]
          : [
              data.hotel.name,
              data.hotel.address,
              `${data.hotel.checkIn} → ${data.hotel.checkOut}`,
              data.hotel.roomType,
              data.hotel.mealPlan,
              data.hotel.cancellationPolicy,
            ]),
        data.notes,
      ];
      box.innerHTML =
        lines
          .filter(Boolean)
          .map((line) => `<p dir="auto">${esc(line)}</p>`)
          .join("") || "<p>أدخل البيانات لتظهر المعاينة.</p>";
    }
    async function mutate(action, extra = {}) {
      if (action === "issue" && dirty)
        return status("احفظ تعديلات النموذج أولًا قبل إصدار النسخة");
      const reason = $("[name=reason]").value.trim();
      if (reason.length < 3 || reason.length > 500)
        return status("أدخل سبب العملية (3–500 حرف)");
      const buttons = [...host.querySelectorAll("button")];
      buttons.forEach((b) => (b.disabled = true));
      status("جارٍ الحفظ…");
      const id = row.id;
      try {
        await api("/api/admin/vouchers/" + id + (action ? "/" + action : ""), {
          method: action ? "POST" : "PATCH",
          body: JSON.stringify({ revision: row.revision, reason, ...extra }),
        });
        if (host.isConnected) {
          await open(id);
          status(
            action ? "تم تنفيذ العملية وحفظها في السجل" : "تم حفظ المسودة",
          );
        }
      } catch (error) {
        status(error.message);
        if (error.status === 409)
          status(error.message + " عد إلى الأرشيف وافتح القسيمة مجددًا.");
        buttons.forEach((b) => (b.disabled = false));
      }
    }
    await archive();
  }
  window.VoucherLedger = { mount };
})();
