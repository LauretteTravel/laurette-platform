/* Private, versioned program workspace. The public catalogue changes only after approval + publish. */
window.ProgramWorkspace = {
  async mount(container, { api, hasPermission }) {
    const root = document.createElement("div");
    root.className = "pw";
    container.replaceChildren(root);
    const alive = () => root.isConnected,
      esc = (v) =>
        String(v ?? "").replace(
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
    const base = "/api/admin/program-workspace",
      stateLabel = {
        draft: "مسودة",
        review: "قيد المراجعة",
        approved: "معتمد للنشر",
        published: "منشور",
        archived: "مؤرشف",
      };
    const labels = {
      title: "العنوان",
      summary: "ملخص العرض",
      description: "الوصف",
      destination: "الوجهة",
      country: "الدولة",
      level: "المستوى",
      art_key: "رمز الرسم",
      image_url: "صورة من مكتبة الوسائط",
      meals: "الوجبات",
      airline: "شركة الطيران",
      departure_dates: "مواعيد المغادرة",
      mode: "وسيلة السفر",
      route: "المسار",
      category: "التصنيف",
      days: "الأيام",
      nights: "الليالي",
      sort: "ترتيب العرض",
      valid_from: "السعر صالح من",
      valid_until: "السعر صالح حتى",
      travel_start: "بداية فترة السفر",
      travel_end: "نهاية فترة السفر",
      includes: "يشمل",
      excludes: "لا يشمل",
      terms: "الشروط",
      itinerary: "البرنامج اليومي",
      flights: "الرحلات الجوية",
      hotels: "الفنادق",
      badges: "الشارات",
      pricing: "تفاصيل التسعير",
      public_status: "حالة المقاعد",
    };
    const eventLabel = {
      created: "إنشاء",
      saved: "حفظ مسودة",
      submitted: "إرسال للمراجعة",
      approved: "اعتماد",
      published: "نشر",
      archived: "أرشفة",
      "source-added": "إضافة مصدر",
    };
    const timeLabel = (value) =>
      new Intl.DateTimeFormat("ar-JO", {
        timeZone: "Asia/Amman",
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(value));
    const checks = {
      source: "راجعت المصادر والمقارنة مع العرض الحالي",
      prices: "راجعت أسعار البيع والتكلفة",
      basis: "راجعت الفرد/الغرفة والإشغال لكل سعر",
      currencies: "راجعت العملات دون تحويل أو دمج",
      dates: "راجعت صلاحية الأسعار وفترة السفر",
      conditions: "راجعت الشروط والمشمول وغير المشمول",
    };
    let meta,
      details,
      current,
      dirty = false,
      page = 1,
      filters = { q: "", state: "", category: "" };
    const message = (v, ok = false) => {
      const e = root.querySelector("[data-pw-status]");
      if (e) {
        e.textContent = v;
        e.classList.toggle("pw-saved", ok);
      }
    };
    const button = (text, attrs = "") =>
      `<button type="button" class="btn btn-ghost btn-sm" ${attrs}>${text}</button>`;
    const opts = (rows, value) =>
      rows
        .map(
          ([v, t]) =>
            `<option value="${esc(v)}" ${String(v) === String(value ?? "") ? "selected" : ""}>${esc(t)}</option>`,
        )
        .join("");
    const field = (key, value, { type = "text", full = false, rows } = {}) =>
      `<label class="${full ? "pw-full" : ""}">${esc(labels[key] || key)}${rows ? `<textarea data-field="${key}" rows="${rows}">${esc(value)}</textarea>` : `<input data-field="${key}" type="${type}" value="${esc(value)}" ${type === "number" ? 'min="0" step="1"' : ""}>`}</label>`;
    const displayList = (k, v) =>
      (v || [])
        .map((o) =>
          k === "hotels"
            ? `${o.city || ""} | ${o.name || ""} | ${o.stars || 0} | ${o.distance || ""}`
            : typeof o === "object"
              ? JSON.stringify(o)
              : o,
        )
        .join("\n");
    const display = (v) =>
      v == null
        ? "—"
        : Array.isArray(v)
          ? v
              .map((o) =>
                typeof o === "object"
                  ? Object.entries(o)
                      .filter(([k]) => k !== "cost")
                      .map(
                        ([k, x]) =>
                          `${{ label: "الوصف", sale: "البيع", currency: "العملة", basis: "الأساس", occupancy: "الإشغال", price: "السعر", name: "الفندق", city: "المدينة", stars: "النجوم", distance: "المسافة" }[k] || k}: ${x}`,
                      )
                      .join(" · ")
                  : o,
              )
              .join("\n")
          : String(v);
    function pending() {
      dirty = true;
      root
        .querySelectorAll("[data-command]")
        .forEach((b) => (b.disabled = true));
      message("توجد تعديلات غير محفوظة؛ احفظها قبل المراجعة أو النشر.");
    }
    function rowPrice(p = {}, index = 0) {
      return `<div class="pw-price" data-price><div class="pw-fields"><label>وصف السعر<input data-price-key="label" value="${esc(p.label || "")}"></label><label>سعر البيع<input data-price-key="sale" type="number" min="0" step="0.001" value="${esc(p.sale ?? "")}"></label><label>التكلفة (داخلية)<input data-price-key="cost" type="number" min="0" step="0.001" value="${esc(p.cost ?? "")}"></label><label>العملة<select data-price-key="currency">${opts(
        ["JOD", "USD", "EUR", "SAR", "AED", "TRY", "EGP", "GBP"].map((x) => [
          x,
          x,
        ]),
        p.currency || "JOD",
      )}</select></label><label>أساس السعر<select data-price-key="basis">${opts(
        [
          ["", "اختر صراحة"],
          ["person", "للفرد"],
          ["room", "للغرفة"],
          ["booking", "للحجز"],
        ],
        p.basis,
      )}</select></label><label>الإشغال<select data-price-key="occupancy">${opts(
        [
          ["", "اختر صراحة"],
          ["single", "مفرد"],
          ["double", "مزدوج"],
          ["triple", "ثلاثي"],
          ["quad", "رباعي"],
          ["na", "غير منطبق"],
        ],
        p.occupancy,
      )}</select></label></div><div class="pw-actions"><label class="pw-check"><input type="radio" name="displayPrice" value="${index}" ${index === (current?.data.display_price ?? 0) ? "checked" : ""}>سعر العرض الرئيسي</label>${button("حذف صف", "data-remove-price")}</div></div>`;
    }
    async function list() {
      const params = new URLSearchParams({ ...filters, page }),
        r = await api(base + "?" + params);
      if (!alive()) return;
      root.innerHTML = `<div class="pw-header"><div><h2>البرامج والعروض</h2><p class="pw-muted">مسودات منفصلة، أسعار واضحة، ومراجعة موثقة قبل النشر.</p></div>${hasPermission("programs:write") ? button("+ برنامج جديد", "data-new") : ""}</div><form class="pw-filters"><label>بحث<input name="q" value="${esc(filters.q)}" placeholder="العنوان أو الرابط"></label><label>الحالة<select name="state">${opts([["", "كل الحالات"], ...Object.entries(stateLabel)], filters.state)}</select></label><label>التصنيف<select name="category">${opts([["", "كل التصنيفات"], ...meta.categories.map((c) => [c.key, c.name])], filters.category)}</select></label><button class="btn btn-primary btn-sm">بحث</button></form><div class="pw-panel pw-scroll"><table><thead><tr><th>البرنامج</th><th>الحالة</th><th>آخر تعديل</th><th></th></tr></thead><tbody>${r.items.map((w) => `<tr><td><b>${esc(w.title)}</b><br><span class="pw-muted" dir="ltr">${esc(w.slug)}</span></td><td><span class="pw-badge">${stateLabel[w.state]}</span>${w.expired ? "<br>سعر منتهي" : ""}</td><td>${esc(w.updated_at.slice(0, 10))}</td><td>${button("فتح", `data-open="${esc(w.id)}"`)}</td></tr>`).join("") || '<tr><td colspan="4">لا توجد برامج في نطاقك. البرامج القديمة تبقى عامة؛ يحدد مسؤول المؤسسة فرعها ومسؤولها أولًا.</td></tr>'}</tbody></table></div><div class="pw-actions">${button("السابق", `data-page="-1" ${page <= 1 ? "disabled" : ""}`)}<span>${page} · ${r.total} برنامج</span>${button("التالي", `data-page="1" ${page * 25 >= r.total ? "disabled" : ""}`)}</div><p class="pw-status" data-pw-status role="status"></p>${hasPermission("programs:categories") ? `<details class="pw-panel"><summary>إدارة التصنيفات</summary><form data-category-form class="pw-fields"><label>المعرّف<input name="key" required placeholder="europe"></label><label>الاسم<input name="name" required></label><label class="pw-check"><input type="checkbox" name="active" checked>نشط</label><label>سبب التعديل<input name="reason" required minlength="3"></label><button class="btn btn-primary">حفظ التصنيف</button></form><p class="pw-muted">لتعديل اسم أو إيقاف تصنيف، استخدم معرّفه الحالي. لا تُحذف البرامج القديمة.</p><p>${meta.categories.map((c) => `${esc(c.name)} (${esc(c.key)}) ${c.active ? "" : "— موقوف"}`).join(" · ")}</p></details>` : ""}`;
      root.querySelector(".pw-filters").onsubmit = (e) => {
        e.preventDefault();
        filters = Object.fromEntries(new FormData(e.target));
        page = 1;
        list().catch((e) => message(e.message));
      };
      root
        .querySelector("[data-new]")
        ?.addEventListener("click", () => edit(null));
      root
        .querySelectorAll("[data-open]")
        .forEach((b) => (b.onclick = () => load(b.dataset.open)));
      root.querySelectorAll("[data-page]").forEach(
        (b) =>
          (b.onclick = () => {
            page += Number(b.dataset.page);
            list().catch((e) => message(e.message));
          }),
      );
      root
        .querySelector("[data-category-form]")
        ?.addEventListener("submit", async (e) => {
          e.preventDefault();
          const b = Object.fromEntries(new FormData(e.target));
          b.active = e.target.active.checked;
          try {
            meta = await api(base + "/categories", {
              method: "POST",
              body: JSON.stringify(b),
            });
            await list();
            message("تم حفظ التصنيف", true);
          } catch (e) {
            message(e.message);
          }
        });
    }
    async function load(id) {
      try {
        const r = await api(base + "/" + id);
        if (alive()) edit(r);
      } catch (e) {
        message(e.message);
      }
    }
    function edit(r) {
      details = r;
      current = r?.workspace || {
        data: {
          title: "",
          category: "",
          pricing: [],
          display_price: 0,
          art_key: "plane",
          currency: "JOD",
        },
        branch_id: meta.current.branchId,
        department_id: meta.current.departmentId,
        owner_id: meta.current.id,
        state: "draft",
      };
      dirty = false;
      const w = current,
        d = w.data,
        published = r?.published || {},
        write = hasPermission("programs:write");
      const compareKeys = [
        "title",
        "category",
        "summary",
        "destination",
        "days",
        "nights",
        "hotels",
        "itinerary",
        "includes",
        "excludes",
        "terms",
        "pricing",
        "valid_from",
        "valid_until",
        "travel_start",
        "travel_end",
      ];
      const before = {
        ...published,
        pricing: published.options ? JSON.parse(published.options) : [],
      };
      for (const k of [
        "hotels",
        "itinerary",
        "includes",
        "excludes",
        "terms",
      ]) {
        try {
          before[k] = JSON.parse(published[k] || "[]");
        } catch {
          before[k] = [];
        }
      }
      root.innerHTML = `<div class="pw-header"><div><h2>${esc(d.title || "برنامج جديد")}</h2><span class="pw-badge">${stateLabel[w.state]}</span> ${w.revision ? `<span class="pw-muted">مراجعة ${w.revision} · اعتماد ${w.approved_version}</span>` : ""}</div>${button("العودة للقائمة", "data-back")}</div><div class="pw-grid"><div><form data-editor><fieldset ${write ? "" : "disabled"} style="border:0;padding:0;margin:0"><section class="pw-panel"><h3>بيانات البرنامج</h3><div class="pw-fields">${field("title", d.title, { full: true })}<label>الرابط (ثابت)<input data-slug value="${esc(w.slug || "")}" dir="ltr" ${w.id ? "disabled" : ""} placeholder="amman-summer-2027"></label><label>التصنيف<select data-field="category">${opts(
        [
          ["", "اختر تصنيفًا"],
          ...meta.categories
            .filter((c) => c.active || c.key === d.category)
            .map((c) => [c.key, c.name + (c.active ? "" : " — موقوف")]),
        ],
        d.category,
      )}</select></label>${["destination", "country", "days", "nights", "summary"].map((k) => field(k, d[k], { type: ["days", "nights"].includes(k) ? "number" : "text", full: k === "summary" })).join("")}<label>الفرع<select data-unit="branchId">${opts([["", "اختر الفرع"], ...meta.branches.map((c) => [c.id, c.name])], w.branch_id)}</select></label><label>القسم<select data-unit="departmentId">${opts([["", "دون قسم"], ...meta.departments.map((c) => [c.id, c.name])], w.department_id)}</select></label><label>المسؤول<select data-unit="ownerId">${opts([["", "اختر الموظف"], ...meta.owners.map((c) => [c.id, c.name])], w.owner_id)}</select></label><label>حالة المقاعد<select data-field="public_status">${opts(
        [
          ["published", "متاح"],
          ["sold_out", "نفدت المقاعد"],
        ],
        d.public_status || "published",
      )}</select></label></div></section><section class="pw-panel"><h3>التسعير وصلاحية العرض</h3><p class="pw-muted">كل صف يحتفظ بعملته وأساسه وإشغاله. لا تحويل تلقائي. التكلفة خاصة بالموظفين في النطاق المصرح.</p>${!d.pricing?.length && published.price_from != null ? `<div class="pw-warning">السعر القديم محفوظ في الموقع: ${esc(published.price_from)} ${esc(published.currency)}. حدّد خيارات السعر المنظمة وراجعها قبل إعادة النشر؛ لن نفترض أساس الخيارات القديمة.</div>` : ""}<div data-prices>${(d.pricing || []).map(rowPrice).join("")}</div>${button("+ خيار سعر", "data-add-price")}<div class="pw-fields" style="margin-top:14px">${["valid_from", "valid_until", "travel_start", "travel_end"].map((k) => field(k, d[k], { type: "date" })).join("")}</div></section><section class="pw-panel"><h3>تفاصيل الرحلة والشروط</h3><div class="pw-fields">${["includes", "excludes", "terms", "itinerary", "flights", "hotels", "badges"].map((k) => `<label class="pw-full">${labels[k]}<textarea data-list="${k}">${esc(displayList(k, d[k]))}</textarea>${k === "hotels" ? '<small class="pw-muted">المدينة | اسم الفندق | النجوم (0–5) | المسافة، سطر لكل فندق</small>' : '<small class="pw-muted">سطر لكل بند</small>'}</label>`).join("")}</div><details><summary>خيارات العرض الإضافية</summary><div class="pw-fields">${["description", "level", "meals", "airline", "departure_dates", "art_key", "image_url", "mode", "route", "sort"].map((k) => field(k, d[k], { type: k === "sort" ? "number" : "text", rows: k === "description" ? 3 : undefined })).join("")}<label class="pw-check"><input type="checkbox" data-field="featured" ${d.featured ? "checked" : ""}>برنامج مميز</label></div></details></section></fieldset></form></div><aside><section class="pw-panel"><h3>المراجعة والنشر</h3><div class="pw-warning">حفظ المسودة لا يغير الموقع. النشر يحتاج اعتماد النسخة الحالية، مع تسجيل الموظف والسبب. أي تعديل أو مصدر جديد يلغي الاعتماد الحالي.</div><label>سبب العملية<input data-reason minlength="3" maxlength="500" placeholder="مراجعة عرض المورد وتحديث الصلاحية"></label><div class="pw-actions">${write ? button("حفظ المسودة", "data-save") : ""}${w.id && write && w.state === "draft" ? button("إرسال للمراجعة", 'data-command="submit"') : ""}${w.id && hasPermission("programs:approve") && w.state === "review" ? button("اعتماد المراجعة", 'data-command="approve"') : ""}${w.id && hasPermission("programs:publish") && w.state === "approved" ? button("نشر النسخة المعتمدة", 'data-command="publish"') : ""}${w.id && hasPermission("programs:publish") && w.state !== "archived" ? button("أرشفة العرض", 'data-command="archive"') : ""}</div><p class="pw-status pw-saved" data-pw-status role="status">${w.id ? "النسخة المعروضة محفوظة." : "أكمل البيانات واحفظ لإنشاء المسودة."}</p>${
        w.state === "review"
          ? Object.entries(checks)
              .map(
                ([k, t]) =>
                  `<label class="pw-check"><input type="checkbox" data-check="${k}">${t}</label>`,
              )
              .join("")
          : ""
      }${w.program_id ? `<a href="/programs/${esc(w.slug)}" target="_blank" rel="noopener">فتح العرض العام الحالي</a>` : ""}</section><section class="pw-panel"><h3>المصادر والاستيراد</h3><p class="pw-muted">الاقتراحات غير متحققة. انسخ الحقول التي راجعتها إلى المحرر يدويًا، ثم احفظ وأرسل للمراجعة.</p>${w.id && write && hasPermission("programs:sources") ? `<label>اسم المصدر<input data-source-name placeholder="عرض المورد — مراجعة يدوية"></label><label>نص المصدر<textarea data-source-text placeholder="الصق النص والجداول هنا للمقارنة"></textarea></label>${button("حفظ النص كمصدر", "data-source-text-save")}<hr><label>PDF أو DOCX، حد 5MiB<input type="file" data-source-file accept=".pdf,.docx" ${meta.uploadsEnabled ? "" : "disabled"}></label>${meta.uploadsEnabled ? button("فحص واستخراج الملف", "data-source-file-save") : '<p class="pw-warning">رفع الملفات مغلق حتى تجهيز الفحص الأمني. النص اليدوي متاح.</p>'}` : '<p class="pw-muted">احفظ البرنامج أولًا. إضافة المصادر تحتاج صلاحية التحرير والمصادر.</p>'}${(r?.sources || []).map((s) => `<div class="pw-source"><b>${esc(s.filename)}</b><p class="pw-muted">${esc(s.kind)} · ${s.bytes} بايت · ${s.extraction.status === "failed" ? "فشل الاستخراج" : "نص مستخرج غير متحقق"}</p>${s.kind !== "text" && hasPermission("programs:sources") ? `<a href="${base}/${w.id}/sources/${s.id}">تنزيل الأصل الخاص</a>` : ""}${s.extraction.error ? `<p class="pw-warning">${esc(s.extraction.error)}</p>` : ""}<details><summary>النص والمقاطع المرشحة</summary><pre>${esc(s.extraction.text)}</pre>${s.extraction.candidates.map((c) => `<div class="pw-evidence">صفحة ${c.page}، سطر ${c.line} — غير متحقق<br>${esc(c.text)}<br>الأساس: ${esc(c.basis || "غير محدد")} · الإشغال: ${esc(c.occupancy || "غير محدد")}</div>`).join("")}${s.extraction.warnings.map((t) => `<p class="pw-muted">${esc(t)}</p>`).join("")}</details>${w.state === "review" ? `<label class="pw-check"><input type="checkbox" data-source-review="${s.id}">راجعت هذا المصدر والأصل</label>` : ""}</div>`).join("")}${w.state === "review" && (r?.sources || []).some((s) => s.extraction.status === "failed") ? '<label class="pw-check"><input type="checkbox" data-manual-extraction>راجعت الأصل يدويًا وصححت الحقول رغم فشل الاستخراج</label>' : ""}</section><details class="pw-panel"><summary>المقارنة مع العرض العام الحالي</summary><p class="pw-muted">المقارنة للنسخة المحفوظة. التسعير القديم قد لا يتضمن أساسًا أو إشغالًا موثقًا.</p><table class="pw-diff"><thead><tr><th>الحقل</th><th>الحالي</th><th>المسودة</th></tr></thead><tbody>${
        compareKeys
          .filter((k) => display(before[k]) !== display(d[k]))
          .map(
            (k) =>
              `<tr><th>${labels[k]}</th><td>${esc(display(before[k]))}</td><td>${esc(display(d[k]))}</td></tr>`,
          )
          .join("") || '<tr><td colspan="3">لا تغييرات ظاهرة.</td></tr>'
      }</tbody></table></details><section class="pw-panel"><h3>الإصدارات وسجل العمليات</h3><div class="pw-actions">${(r?.versions || []).map((v) => button(`اعتماد ${v.version}`, `data-version="${v.version}"`)).join("")}</div><div data-version-view></div><div class="pw-history">${(r?.events || []).map((e) => `<p><b>${esc(e.actor)}</b> · ${esc(eventLabel[e.kind] || e.kind)} · ${esc(timeLabel(e.created_at))}<br>${esc(e.reason)}</p>`).join("") || '<p class="pw-muted">لم تُسجّل عمليات بعد.</p>'}</div></section></aside></div>`;
      root.querySelector("[data-back]").onclick = () => {
        if (!dirty || confirm("هناك تعديلات غير محفوظة. العودة دون حفظ؟"))
          list().catch((e) => message(e.message));
      };
      root.querySelector("[data-editor]").addEventListener("input", pending);
      root.querySelector("[data-editor]").addEventListener("change", pending);
      function wirePrices() {
        root.querySelectorAll("[data-remove-price]").forEach(
          (b) =>
            (b.onclick = () => {
              b.closest("[data-price]").remove();
              root
                .querySelectorAll("[name=displayPrice]")
                .forEach((e, i) => (e.value = i));
              pending();
            }),
        );
      }
      wirePrices();
      root.querySelector("[data-add-price]").onclick = () => {
        const rows = root.querySelectorAll("[data-price]");
        root
          .querySelector("[data-prices]")
          .insertAdjacentHTML("beforeend", rowPrice({}, rows.length));
        wirePrices();
        pending();
      };
      root.querySelector("[data-save]")?.addEventListener("click", async () => {
        try {
          const data = readData(),
            body = { data, reason: reason(), revision: w.revision };
          root
            .querySelectorAll("[data-unit]")
            .forEach(
              (el) =>
                (body[el.dataset.unit] = el.value ? Number(el.value) : null),
            );
          if (!w.id) body.slug = root.querySelector("[data-slug]").value.trim();
          const result = await api(w.id ? base + "/" + w.id : base, {
            method: w.id ? "PATCH" : "POST",
            body: JSON.stringify(body),
          });
          await load(w.id || result.id);
          message("تم حفظ المسودة دون تغيير الموقع.", true);
        } catch (e) {
          message(e.message);
        }
      });
      root.querySelectorAll("[data-command]").forEach(
        (b) =>
          (b.onclick = async () => {
            try {
              if (dirty) throw new Error("احفظ التعديلات أولًا");
              const action = b.dataset.command;
              if (
                ["publish", "archive"].includes(action) &&
                !confirm(
                  action === "publish"
                    ? "سيُحدّث العرض العام بالنسخة المعتمدة. تأكيد النشر؟"
                    : "سيُؤرشف العرض العام مع الاحتفاظ بالسجل. تأكيد الأرشفة؟",
                )
              )
                return;
              const body = { revision: w.revision, reason: reason() };
              if (action === "approve") {
                body.checks = Object.fromEntries(
                  [...root.querySelectorAll("[data-check]")].map((e) => [
                    e.dataset.check,
                    e.checked,
                  ]),
                );
                body.reviewedSourceIds = [
                  ...root.querySelectorAll("[data-source-review]:checked"),
                ].map((e) => e.dataset.sourceReview);
                body.manualExtraction =
                  root.querySelector("[data-manual-extraction]")?.checked ||
                  false;
              }
              const result = await api(`${base}/${w.id}/${action}`, {
                method: "POST",
                body: JSON.stringify(body),
              });
              if (alive()) {
                edit(result);
                message("تمت العملية وحُفظ سجلها.", true);
              }
            } catch (e) {
              message(e.message);
            }
          }),
      );
      async function source(file) {
        try {
          if (dirty) throw new Error("احفظ تعديلات البرنامج قبل إضافة المصدر");
          const body = {
            revision: w.revision,
            reason: reason(),
            kind: "text",
            filename:
              root.querySelector("[data-source-name]").value ||
              "manual-source.txt",
            text: root.querySelector("[data-source-text]").value,
          };
          if (file) {
            const f = root.querySelector("[data-source-file]").files[0];
            if (!f || f.size > 5 * 1024 * 1024)
              throw new Error("اختر PDF أو DOCX حتى 5MiB");
            body.filename = f.name;
            body.kind = "file";
            delete body.text;
            body.base64 = await new Promise((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () =>
                resolve(String(reader.result).split(",")[1]);
              reader.onerror = reject;
              reader.readAsDataURL(f);
            });
          }
          await api(base + "/" + w.id + "/sources", {
            method: "POST",
            body: JSON.stringify(body),
          });
          await load(w.id);
          message("حُفظ المصدر؛ راجع المقاطع قبل تعديل الأسعار.", true);
        } catch (e) {
          message(e.message);
        }
      }
      root
        .querySelector("[data-source-text-save]")
        ?.addEventListener("click", () => source(false));
      root
        .querySelector("[data-source-file-save]")
        ?.addEventListener("click", () => source(true));
      root.querySelectorAll("[data-version]").forEach(
        (b) =>
          (b.onclick = async () => {
            try {
              const v = await api(
                `${base}/${w.id}/versions/${b.dataset.version}`,
              );
              if (alive())
                root.querySelector("[data-version-view]").innerHTML =
                  `<p class="pw-muted">اعتماد ${v.version} بتاريخ ${esc(v.approvedAt)} — المحفوظ في السجل</p><table class="pw-diff">${["title", "destination", "pricing", "valid_from", "valid_until", "travel_start", "travel_end", "terms"].map((k) => `<tr><th>${labels[k]}</th><td>${esc(display(v.snapshot.data[k]))}</td></tr>`).join("")}</table>`;
            } catch (e) {
              message(e.message);
            }
          }),
      );
    }
    function reason() {
      const v = root.querySelector("[data-reason]").value.trim();
      if (v.length < 3) throw new Error("أدخل سبب العملية (3 أحرف على الأقل)");
      return v;
    }
    function readData() {
      const d = structuredClone(current.data);
      root.querySelectorAll("[data-field]").forEach((el) => {
        const k = el.dataset.field;
        d[k] =
          el.type === "checkbox"
            ? el.checked
            : el.type === "number"
              ? el.value === ""
                ? null
                : Number(el.value)
              : el.value.trim();
      });
      root.querySelectorAll("[data-list]").forEach((el) => {
        const k = el.dataset.list;
        if (el.value === displayList(k, d[k])) return;
        const lines = el.value
          .split("\n")
          .map((s) => s.trim())
          .filter(Boolean);
        d[k] =
          k === "hotels"
            ? lines.map((s) => {
                const [city, name, stars, distance] = s
                  .split("|")
                  .map((v) => v.trim());
                return { city, name, stars: Number(stars), distance };
              })
            : lines;
      });
      d.pricing = [...root.querySelectorAll("[data-price]")].map((row) =>
        Object.fromEntries(
          [...row.querySelectorAll("[data-price-key]")].map((el) => [
            el.dataset.priceKey,
            ["sale", "cost"].includes(el.dataset.priceKey)
              ? el.value === ""
                ? null
                : Number(el.value)
              : el.value,
          ]),
        ),
      );
      d.display_price = Number(
        root.querySelector("[name=displayPrice]:checked")?.value ?? 0,
      );
      return d;
    }
    try {
      meta = await api(base + "/meta");
      if (alive()) await list();
    } catch (e) {
      if (alive()) root.textContent = e.message;
    }
  },
};
