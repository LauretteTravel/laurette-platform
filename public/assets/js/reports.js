window.PerformanceReports = {
  async mount(container, { api, hasPermission }) {
    const root = document.createElement("div");
    root.className = "rp";
    container.replaceChildren(root);
    const alive = () => root.isConnected;
    const esc = (v) =>
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
        ),
      n = (v) =>
        v == null
          ? "غير متاح"
          : Number(v).toLocaleString("en-US", { maximumFractionDigits: 3 });
    const metricLabel = {
        requests: "طلبات جديدة",
        confirmed_requests: "طلبات مؤكدة من مجموعة الإنشاء",
        net_receipts: "صافي التحصيل",
      },
      kindLabel = {
        requests: "طلبات الفترة",
        won: "طلبات مؤكدة",
        lost: "طلبات ملغية",
        overdue: "طلبات ذات متابعة متأخرة",
        responded: "عينات أول إجراء",
        closed: "عينات الإغلاق",
        bookings: "الحجوزات بتاريخ التأكيد",
        payments: "الدفعات بتاريخ القيد",
        tasks: "المهام بحسب الاستحقاق",
      };
    const fieldLabel = {
      id: "المعرّف",
      reference: "المرجع",
      type: "الخدمة",
      status: "الحالة",
      deal_status: "مرحلة الصفقة",
      assigned_to: "الموظف",
      created_at: "الإنشاء",
      first_response_at: "أول إجراء",
      completed_at: "الإغلاق",
      branch_id: "الفرع",
      department_id: "القسم",
      amount: "المبلغ",
      cost_amount: "التكلفة",
      currency: "العملة",
      confirmed_at: "التأكيد",
      request_id: "الطلب",
      request_reference: "مرجع الطلب",
      kind: "نوع القيد",
      booking_reference: "مرجع الحجز",
      title: "العنوان",
      due_at: "الاستحقاق",
      lost_reason: "سبب الخسارة",
      lead_origin: "المصدر",
    };
    const opts = (rows, value) =>
      rows
        .map(
          ([v, label]) =>
            `<option value="${esc(v)}" ${String(v) === String(value ?? "") ? "selected" : ""}>${esc(label)}</option>`,
        )
        .join("");
    const table = (heads, rows) =>
      `<div class="rp-scroll" role="group" tabindex="0" aria-label="جدول يمكن تمريره أفقيًا"><table class="${heads.length >= 5 ? "rp-wide" : ""}"><thead><tr>${heads.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${rows.length ? rows.map((row) => `<tr>${row.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("") : `<tr><td colspan="${heads.length}">لا بيانات مطابقة ضمن نطاقك.</td></tr>`}</tbody></table></div>`;
    const btn = (label, attrs = "") =>
      `<button class="btn btn-ghost btn-sm" type="button" ${attrs}>${label}</button>`;
    let filters = { period: "weekly" },
      data,
      detailPage = 1,
      detailKind = "requests";
    const query = (extra = {}) =>
      new URLSearchParams({ ...filters, ...extra }).toString();
    function status(text) {
      const el = root.querySelector("[data-rp-status]");
      if (el) el.textContent = text;
    }
    const delta = (k) => {
      const d = data.comparison[k];
      return `السابق: ⁦${n(d?.previous)}⁩ · التغير: ⁦${n(d?.change)}⁩${d?.percent == null ? "" : ` (⁦${n(d.percent)}%⁩)`}`;
    };
    function grouped(rows, label, key) {
      return table(
        [label, "طلبات", "مؤكدة", "ملغية", "التحويل %"],
        rows.map((r) => [
          `<button type="button" class="btn btn-ghost btn-sm" data-group-key="${esc(key)}" data-group-value="${esc(r.key ?? "unassigned")}">${esc(r.label || r.name || r.key || "غير مسند")}</button>`,
          n(r.total),
          n(r.won),
          n(r.lost),
          n(r.conversion),
        ]),
      );
    }
    async function load() {
      try {
        const r = await api("/api/admin/reports?" + query());
        if (!alive()) return;
        data = r;
        filters = { ...filters, from: r.range.from, to: r.range.to };
        render();
      } catch (e) {
        if (alive())
          root.innerHTML = `<p class="rp-status">${esc(e.message)}</p>`;
      }
    }
    function render() {
      const s = data.summary,
        exported = hasPermission("reports:export"),
        finance = data.finance,
        tasks = data.tasks;
      const stat = (title, value, key, notes = "") =>
        `<button type="button" class="rp-stat" data-drill="${key}"><span>${title}</span><b>${n(value)}</b><small>${esc(notes)}</small></button>`;
      const max = Math.max(1, ...data.series.map((p) => p.total)),
        groups =
          data.series.length > 31
            ? data.series.filter(
                (_, i) => i % Math.ceil(data.series.length / 31) === 0,
              )
            : data.series;
      root.innerHTML = `<header class="rp-header"><div><h2>تقارير الأداء والتشغيل</h2><span class="rp-muted">Asia/Amman · مقارنة بفترة سابقة مساوية · بيانات فعلية ضمن نطاقك</span></div><div class="rp-actions">${exported ? `<a class="btn btn-ghost btn-sm" data-report-csv href="/api/admin/reports.csv?${esc(query())}">تصدير CSV</a><a class="btn btn-primary btn-sm" data-report-pdf href="/api/admin/reports/document?${esc(query())}" target="_blank" rel="noopener">تقرير PDF</a>` : ""}</div></header>
  <form class="rp-filters" data-rp-filters><label>الفترة<select name="period">${opts(
    [
      ["daily", "يومي"],
      ["weekly", "أسبوعي"],
      ["monthly", "شهري"],
    ],
    filters.period,
  )}</select></label><label>من<input type="date" name="from" value="${esc(data.range.from)}"></label><label>إلى<input type="date" name="to" value="${esc(data.range.to)}"></label><label>الموظف الأساسي<select name="employee">${opts([["", "الكل ضمن النطاق"], ["unassigned", "غير مسند"], ...data.agents.map((r) => [r.id, r.name])], filters.employee)}</select></label><label>الفرع المنفذ<select name="branch">${opts([["", "الكل ضمن النطاق"], ["unassigned", "غير محدد"], ...data.branches.map((r) => [r.id, r.name])], filters.branch)}</select></label><label>فرع الاستقبال<select name="receivedBranch">${opts([["", "الكل ضمن النطاق"], ["unassigned", "غير محدد"], ...data.branches.map((r) => [r.id, r.name])], filters.receivedBranch)}</select></label><label>القسم<select name="department">${opts([["", "الكل ضمن النطاق"], ["unassigned", "غير محدد"], ...data.departments.map((r) => [r.id, r.name])], filters.department)}</select></label><label>الخدمة<select name="type">${opts(
    [
      ["", "كل الخدمات"],
      ["flight", "طيران"],
      ["hotel", "فندق"],
      ["program", "برامج"],
      ["umrah", "عمرة"],
      ["visa", "تأشيرات"],
      ["consult", "استشارة"],
      ["cruise", "كروز"],
    ],
    filters.type,
  )}</select></label><label>المصدر (مطابقة تامة)<input name="source" maxlength="100" value="${esc(filters.source || "")}" placeholder="website"></label><div class="rp-actions"><button class="btn btn-primary btn-sm">تطبيق</button>${btn("إعادة الضبط", "data-reset")}</div><p class="rp-muted rp-full">الفترة السابقة ${esc(data.range.previous.from)} إلى ${esc(data.range.previous.to)}. الحالة والإسناد حاليان؛ ليست لقطة تاريخية لنهاية الفترة.</p></form>
  <div class="rp-stats">${stat("طلبات جديدة", s.total, "requests", delta("total"))}${stat("طلبات مؤكدة", s.won, "won", delta("won"))}${stat("التحويل %", s.conversion, "won", delta("conversion"))}${stat("طلبات ملغية", s.lost, "lost", delta("lost"))}${stat("أول إجراء مسجل — دقيقة", s.avgResponseMinutes, "responded", `عينات ${s.responseSamples}/${s.total}؛ لا يثبت أول اتصال بالعميل`)}${stat("زمن الإغلاق — دقيقة", s.avgCompletionMinutes, "closed", `عينات ${s.completionSamples} · ${delta("avgCompletionMinutes")}`)}${stat("ذات متابعة متأخرة", s.overdue, "overdue", delta("overdue"))}<div class="rp-stat"><span>عملاء CRM جدد</span><b>${n(data.customers.count)}</b><small>${esc(data.customers.reason || "بتاريخ إنشاء العميل ضمن النطاق المصرح")}</small></div></div>
  <section class="rp-panel"><h3>اتجاه الطلبات الجديدة</h3><div class="rp-chart">${groups.map((p) => `<div class="rp-bar" style="height:${Math.max(1, (p.total / max) * 100)}%" title="${esc(p.bucket)}: ${p.total} طلب"><span>${esc(p.bucket.slice(5))}</span></div>`).join("")}</div><p class="rp-muted">${data.series.length > 31 ? "عينة يومية منتظمة للرسم؛ المؤشرات والتصدير تحسب كامل الفترة." : "لكل يوم من الفترة."}</p></section>
  <section class="rp-panel"><h3>أداء الموظفين — الإسناد الأساسي الحالي</h3>${table(
    [
      "الموظف",
      "طلبات",
      "مؤكدة",
      "ملغية",
      "التحويل %",
      "أول إجراء - دقيقة",
      "الإغلاق - دقيقة",
    ],
    data.employees.map((e) => [
      btn(
        esc(e.name),
        `data-group-key="employee" data-group-value="${e.key ?? "unassigned"}"`,
      ),
      n(e.total),
      n(e.won),
      n(e.lost),
      n(e.conversion),
      n(e.avgResponseMinutes),
      n(e.avgCompletionMinutes),
    ]),
  )}<p class="rp-muted">لا تنسب هذه الأرقام العمل تاريخيًا إلى من أغلق الطلب. اضغط الموظف لتصفية الشاشة والتصدير والتفاصيل معًا.</p></section>
  <div class="rp-split"><section class="rp-panel"><h3>الطلبات حسب الخدمة</h3>${grouped(data.byType, "الخدمة", "type")}</section><section class="rp-panel"><h3>المصادر</h3>${grouped(data.bySource, "المصدر", "source")}</section></div>
  <div class="rp-split"><section class="rp-panel"><h3>الفروع المنفذة</h3>${grouped(data.executionBranches, "الفرع", "branch")}</section><section class="rp-panel"><h3>فروع الاستقبال</h3>${grouped(data.receivedBranches, "الفرع", "receivedBranch")}</section></div>
  <div class="rp-split"><section class="rp-panel"><h3>الأقسام</h3>${grouped(data.byDepartment, "القسم", "department")}</section><section class="rp-panel"><h3>أسباب الخسارة</h3>${table(
    ["السبب", "طلبات"],
    data.lostReasons.map((r) => [esc(r.reason), n(r.total)]),
  )}<p class="rp-muted">السبب غير المسجل يظهر كما هو؛ لا نستنتج سببًا من الملاحظات.</p></section></div>
  <section class="rp-panel"><h3>الحجوزات حسب تاريخ التأكيد والعملات</h3><div class="rp-notice">القيم من سجل الحجوزات. الهامش تقديري، والربح المحقق غير متاح دون اعتراف محاسبي. لا تحويل عملة أو جمع بين عملتين.</div>${
    finance.available
      ? table(
          [
            "العملة",
            "الحجوزات",
            "قيمة الحجز",
            "التكلفة الكاملة",
            "هامش تقديري",
            "تغطية التكلفة",
          ],
          finance.currencies.map((r) => [
            esc(r.currency),
            n(r.bookingCount),
            n(r.bookedAmount),
            n(r.cost),
            n(r.estimatedMargin),
            `${r.costSamples}/${r.bookingCount}`,
          ]),
        )
      : `<p>${esc(finance.reason)}</p>`
  }${finance.available && finance.reason ? `<p class="rp-muted">${esc(finance.reason)}</p>` : ""}${finance.available ? `<div class="rp-actions">${btn("تفاصيل الحجوزات", 'data-drill="bookings"')}${btn("تفاصيل الدفعات", 'data-drill="payments"')}</div>` : ""}</section>
  <section class="rp-panel"><h3>القبض والاسترداد ورصيد حجوزات الفترة</h3>${
    finance.available
      ? table(
          [
            "العملة",
            "قبض الفترة",
            "استرداد الفترة",
            "صافي الفترة",
            "رصيد حالي مستحق",
            "زائد للعميل",
            "حجوزات بعملة دفعة أو مبلغ غير صالح",
          ],
          finance.currencies.map((r) => [
            esc(r.currency),
            n(r.receipts),
            n(r.refunds),
            n(r.netReceipts),
            n(r.outstanding),
            n(r.credit),
            n(r.unmatchedBookings),
          ]),
        )
      : `<p>${esc(finance.reason)}</p>`
  }<p class="rp-muted">الرصيد حتى وقت التوليد لحجوزات فترة التأكيد، لا رصيد تاريخي بنهاية الفترة. عملات الدفعات غير المطابقة أو المبالغ غير الصالحة تجعل الرصيد غير مكتمل.</p></section>
  <section class="rp-panel"><h3>المهام والالتزام بالموعد</h3>${tasks.available ? table(["مستحقة بالفترة", "منجزة", "متأخرة حاليًا", "عينات إنجاز موثقة", "في الموعد", "الالتزام %"], [[n(tasks.summary.total), n(tasks.summary.done), n(tasks.summary.overdue), n(tasks.summary.completionSamples), n(tasks.summary.onTime), n(tasks.summary.onTimeRate)]]) : `<p>${esc(tasks.reason)}</p>`}${
    tasks.available
      ? `${btn("تفاصيل المهام", 'data-drill="tasks"')}<p class="rp-muted">الإنجاز من سجل أحداث المهمة؛ ${tasks.summary.missingCompletion} مهمة منجزة بلا توقيت صالح، ولا تُفترض ناجحة.</p>${table(
          [
            "الموظف",
            "مهام مستحقة",
            "منجزة",
            "متأخرة",
            "عينات موثقة",
            "في الموعد",
          ],
          tasks.employees.map((t) => [
            esc(
              data.agents.find((a) => a.id === t.employeeId)?.name ||
                "مسؤول ضمن النطاق",
            ),
            n(t.total),
            n(t.done),
            n(t.overdue),
            n(t.completionSamples),
            n(t.onTime),
          ]),
        )}`
      : ""
  }</section>
  <section class="rp-panel"><h3>الأهداف مقابل النتائج</h3><p class="rp-muted">${esc(data.targets.reason || "")}</p>${table(
    [
      "الجهة/الموظف",
      "الفترة",
      "المقياس",
      "الهدف",
      "الفعلي",
      "التقدم %",
      "الإجراء",
    ],
    data.targets.items.map((g) => [
      esc(g.employee_name || g.department_name || g.branch_name),
      `${esc(g.from_day)} — ${esc(g.to_day)}`,
      `${esc(metricLabel[g.metric])} ${esc(g.currency || "")} ${g.active ? "" : "(موقوف)"}`,
      n(g.value),
      n(g.actual),
      n(g.progress),
      `${btn("السجل", `data-goal-history="${g.id}"`)}${hasPermission("reports:targets") ? btn(g.active ? "إيقاف" : "تفعيل", `data-goal-toggle="${g.id}"`) + btn("تعديل القيمة", `data-goal-edit="${g.id}"`) : ""}`,
    ]),
  )}<p class="rp-muted">${data.targets.items.length}/${data.targets.total} هدف معروض (حد 50). التقدم محسوب لفترة الهدف الكاملة وجهته؛ لا تُجمع أهداف متداخلة لجهات مختلفة.</p>
  ${
    hasPermission("reports:targets")
      ? `<details><summary>إضافة هدف موثق</summary><form data-goal-form class="rp-target-grid"><label>الفرع<select name="branchId" required>${opts([["", "اختر الفرع"], ...data.branches.map((r) => [r.id, r.name])], filters.branch)}</select></label><label>القسم<select name="departmentId">${opts([["", "كل أقسام الفرع"], ...data.departments.map((r) => [r.id, r.name])], filters.department)}</select></label><label>الموظف<select name="employeeId">${opts([["", "هدف الجهة كاملة"], ...data.agents.map((r) => [r.id, r.name])], filters.employee === "unassigned" ? "" : filters.employee)}</select></label><label>المقياس<select name="metric">${opts(
          Object.entries(metricLabel).filter(
            ([k]) => k !== "net_receipts" || hasPermission("reports:finance"),
          ),
          "requests",
        )}</select></label><label>العملة (للتحصيل فقط)<select name="currency">${opts(
          ["JOD", "USD", "EUR", "SAR", "AED", "TRY", "EGP", "GBP"].map((v) => [
            v,
            v,
          ]),
          "JOD",
        )}</select></label><label>القيمة<input name="value" type="number" min="0.001" step="0.001" required></label><label>من<input name="from" type="date" value="${esc(data.range.from)}" required></label><label>إلى<input name="to" type="date" value="${esc(data.range.to)}" required></label><label>سبب اعتماد الهدف<input name="reason" minlength="3" maxlength="500" required></label><button class="btn btn-primary btn-sm">حفظ الهدف</button></form></details>`
      : ""
  }</section>
  <section class="rp-panel" data-details-panel><h3>التفاصيل المفلترة</h3><div class="rp-actions"><label>نوع السجل<select data-detail-kind>${opts(
    Object.entries(kindLabel).filter(
      ([k]) =>
        (!["bookings", "payments"].includes(k) || finance.available) &&
        (k !== "tasks" || tasks.available),
    ),
    detailKind,
  )}</select></label>${btn("عرض التفاصيل", "data-load-details")}${exported ? `<a class="btn btn-ghost btn-sm" data-details-csv href="/api/admin/reports.csv?${esc(query({ section: "details", kind: detailKind }))}">CSV للتفاصيل</a>` : ""}</div><div data-detail-view></div></section>
  <details class="rp-panel"><summary>تعريف المؤشرات والبيانات غير المتاحة</summary>${data.definitions.map(([, name, text]) => `<p class="rp-definition"><b>${esc(name)}:</b> ${esc(text)}</p>`).join("")}${Object.values(
    data.availability,
  )
    .map((v) => `<p class="rp-notice">${esc(v.reason)}</p>`)
    .join(
      "",
    )}${data.warnings.map((w) => `<p class="rp-muted">${esc(w)}</p>`).join("")}</details><p class="rp-status" data-rp-status role="status"></p><dialog data-history-dialog><div class="rp-actions">${btn("إغلاق", "data-close-history")}</div><div data-history-content></div></dialog>`;
      root.querySelector("[data-rp-filters]").onsubmit = (e) => {
        e.preventDefault();
        filters = Object.fromEntries(
          [...new FormData(e.target)].filter(([, v]) => v !== ""),
        );
        detailPage = 1;
        load();
      };
      root.querySelector("[name=period]").onchange = (e) => {
        filters = { ...filters, period: e.target.value };
        delete filters.from;
        delete filters.to;
        load();
      };
      root.querySelector("[data-reset]").onclick = () => {
        filters = { period: "weekly" };
        detailPage = 1;
        load();
      };
      root.querySelectorAll("[data-group-key]").forEach(
        (b) =>
          (b.onclick = () => {
            const k = b.dataset.groupKey,
              v = b.dataset.groupValue;
            filters = { ...filters, [k]: v };
            detailPage = 1;
            load();
          }),
      );
      root.querySelectorAll("[data-drill]").forEach(
        (b) =>
          (b.onclick = () => {
            detailKind = b.dataset.drill;
            detailPage = 1;
            root.querySelector("[data-detail-kind]").value = detailKind;
            loadDetails();
            root
              .querySelector("[data-details-panel]")
              .scrollIntoView({ behavior: "smooth" });
          }),
      );
      root.querySelector("[data-detail-kind]").onchange = (e) => {
        detailKind = e.target.value;
        detailPage = 1;
        const a = root.querySelector("[data-details-csv]");
        if (a)
          a.href =
            "/api/admin/reports.csv?" +
            query({ section: "details", kind: detailKind });
      };
      root.querySelector("[data-load-details]").onclick = () => loadDetails();
      root.querySelector("[data-close-history]").onclick = () =>
        root.querySelector("[data-history-dialog]").close();
      root.querySelectorAll("[data-goal-history]").forEach(
        (b) =>
          (b.onclick = async () => {
            try {
              const r = await api(
                "/api/admin/report-targets/" +
                  b.dataset.goalHistory +
                  "/events",
              );
              if (!alive()) return;
              root.querySelector("[data-history-content]").innerHTML =
                `<h3>سجل تعديل الهدف</h3>${table(
                  ["الموظف", "السبب", "المراجعة", "قبل", "بعد"],
                  r.events.map((e) => {
                    const before = e.before_json
                        ? JSON.parse(e.before_json)
                        : null,
                      after = JSON.parse(e.after_json);
                    return [
                      esc(e.actor),
                      esc(e.reason),
                      n(e.revision),
                      before
                        ? `${n(before.value)} · ${before.active ? "نشط" : "موقوف"}`
                        : "إنشاء",
                      `${n(after.value)} · ${after.active ? "نشط" : "موقوف"}`,
                    ];
                  }),
                )}`;
              root.querySelector("[data-history-dialog]").showModal();
            } catch (e) {
              status(e.message);
            }
          }),
      );
      root
        .querySelector("[data-goal-form]")
        ?.addEventListener("submit", async (e) => {
          e.preventDefault();
          try {
            const b = Object.fromEntries(new FormData(e.target));
            for (const k of ["branchId", "departmentId", "employeeId"])
              b[k] = b[k] ? Number(b[k]) : null;
            b.value = Number(b.value);
            await api("/api/admin/report-targets", {
              method: "POST",
              body: JSON.stringify(b),
            });
            await load();
            status("تم حفظ الهدف وسجل اعتماده.");
          } catch (e) {
            status(e.message);
          }
        });
      async function updateGoal(id, edit) {
        const goal = data.targets.items.find((g) => g.id === Number(id));
        const reason = prompt("سبب تعديل الهدف (3 أحرف على الأقل)");
        if (reason === null) return;
        const b = { reason, revision: goal.revision };
        if (edit) {
          const next = prompt("القيمة الجديدة", String(goal.value));
          if (next === null) return;
          b.value = Number(next);
        } else b.active = !goal.active;
        try {
          await api("/api/admin/report-targets/" + id, {
            method: "PATCH",
            body: JSON.stringify(b),
          });
          await load();
          status("تم تحديث الهدف مع الاحتفاظ بالسجل.");
        } catch (e) {
          status(e.message);
        }
      }
      root
        .querySelectorAll("[data-goal-toggle]")
        .forEach(
          (b) => (b.onclick = () => updateGoal(b.dataset.goalToggle, false)),
        );
      root
        .querySelectorAll("[data-goal-edit]")
        .forEach(
          (b) => (b.onclick = () => updateGoal(b.dataset.goalEdit, true)),
        );
    }
    async function loadDetails() {
      try {
        const d = await api(
          "/api/admin/reports/details?" +
            query({ kind: detailKind, page: detailPage }),
        );
        if (!alive()) return;
        const el = root.querySelector("[data-detail-view]");
        if (!d.available) {
          el.textContent = d.reason;
          return;
        }
        const keys = Object.keys(d.items[0] || { reference: "" }),
          agents = new Map(data.agents.map((a) => [a.id, a.name]));
        el.innerHTML =
          table(
            keys.map((k) => fieldLabel[k] || k),
            d.items.map((row) =>
              keys.map((k) =>
                esc(
                  k === "assigned_to"
                    ? agents.get(row[k]) || row[k] || "غير مسند"
                    : (row[k] ?? "—"),
                ),
              ),
            ),
          ) +
          `<div class="rp-actions">${btn("السابق", `data-detail-page="-1" ${detailPage <= 1 ? "disabled" : ""}`)}<span>${detailPage} · ${d.total} سجل</span>${btn("التالي", `data-detail-page="1" ${detailPage * 50 >= d.total ? "disabled" : ""}`)}</div>`;
        el.querySelectorAll("[data-detail-page]").forEach(
          (b) =>
            (b.onclick = () => {
              detailPage += Number(b.dataset.detailPage);
              loadDetails();
            }),
        );
        const a = root.querySelector("[data-details-csv]");
        if (a)
          a.href =
            "/api/admin/reports.csv?" +
            query({ section: "details", kind: detailKind });
      } catch (e) {
        status(e.message);
      }
    }
    await load();
  },
};
