/* Laurette Workspace: real overview data and existing workflow actions. */
(() => {
  "use strict";
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
    );
  const paths = {
    home: "M3 10 12 3l9 7v11h-6v-7H9v7H3Z",
    users:
      "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M16 3a4 4 0 0 1 0 8M22 21v-2a4 4 0 0 0-3-3.87M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z",
    inbox: "M4 3h16v16H4ZM8 7h8M8 11h6M4 19l4 3v-3",
    ticket: "M3 7h18v4a2 2 0 0 0 0 4v4H3v-4a2 2 0 0 0 0-4ZM8 7v2m0 3v2m0 3v2",
    plane: "m2 16 7-4-5-7 2-1 8 6 6-3q3-1 2 2l-6 5-1 8-2 1-2-7-6 3Z",
    layers: "m12 3 10 5-10 5L2 8Zm-10 10 10 5 10-5M2 18l10 5 10-5",
    calendar: "M4 5h16v16H4ZM8 2v6m8-6v6M4 10h16",
    chart: "M4 3v18h18M8 16v-5m5 5V7m5 9V4",
    settings:
      "m9 3 1-2h4l1 2 3 1 2 3-1 2v4l1 2-2 3-3 1-1 2h-4l-1-2-3-1-2-3 1-2V9L4 7l2-3Zm6 9a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z",
    building: "M4 22V3h12v19M16 9h5v13M8 7h4m-4 4h4m-4 4h4M1 22h22",
    shield: "m12 2 9 4v6c0 6-9 10-9 10S3 18 3 12V6Zm-4 10 3 3 5-6",
    search: "M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z",
    bell: "M18 8a6 6 0 0 0-12 0c0 7-3 7-3 10h18c0-3-3-3-3-10M10 22h4",
    wa: "M21 11a9 9 0 0 1-13 8L2 21l2-6A9 9 0 1 1 21 11ZM8 7c0 5 3 8 8 8l1-3-3-1-1 1-3-3 1-1-1-3Z",
    clock: "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM12 6v6l4 2",
    pin: "M19 10c0 6-7 12-7 12S5 16 5 10a7 7 0 1 1 14 0ZM15 10a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z",
    refresh:
      "M20 7v5h-5M4 17v-5h5M5 7a8 8 0 0 1 13-2l2 3M4 16l2 3a8 8 0 0 0 13-2",
    chevron: "m6 9 6 6 6-6",
    arrow: "M20 12H4m6-6-6 6 6 6",
    plus: "M12 3v18M3 12h18",
    phone: "M5 3 2 5c0 10 7 17 17 17l3-3-5-5-3 2-6-6 2-3Z",
    more: "M12 4v.1M12 12v.1M12 20v.1",
    heart: "M20 4c-4-3-8 2-8 2S8 1 4 4c-6 5 8 16 8 16S26 9 20 4Z",
    palm: "M12 22V9M4 8c1-7 7-6 8-1 2-7 8-6 9 1-4-2-6-2-9 0-3-2-5-2-8 0ZM9 22h8",
    passport:
      "M5 2h14v20H5ZM16 9a4 4 0 1 1-8 0 4 4 0 0 1 8 0ZM12 5v8M8 9h8M8 18h8",
    ship: "M5 13V6h14v7M9 6V2h6v4M3 14l9-3 9 3-3 7-6-2-6 2ZM1 23l5-2 6 2 6-2 5 2",
    kaaba: "m3 6 9-4 9 4v15H3Zm0 5h18M12 2v19",
    upload: "M12 16V2m-5 5 5-5 5 5M4 14v8h16v-8",
    menu: "M3 6h18M3 12h18M3 18h18",
    check: "m4 12 5 5L20 6",
    eye: "M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Zm13 0a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z",
    close: "m6 6 12 12M6 18 18 6",
  };
  const icon = (name, cls = "") =>
    `<svg class="wx-icon ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[name] || paths.layers}"></path></svg>`;
  const names = {
    USD: ["الدولار الأمريكي", "🇺🇸"],
    EUR: ["اليورو", "🇪🇺"],
    GBP: ["الجنيه الإسترليني", "🇬🇧"],
    SAR: ["الريال السعودي", "🇸🇦"],
    AED: ["الدرهم الإماراتي", "🇦🇪"],
    TRY: ["الليرة التركية", "🇹🇷"],
    KWD: ["الدينار الكويتي", "🇰🇼"],
    QAR: ["الريال القطري", "🇶🇦"],
    BHD: ["الدينار البحريني", "🇧🇭"],
    OMR: ["الريال العماني", "🇴🇲"],
    EGP: ["الجنيه المصري", "🇪🇬"],
    CHF: ["الفرنك السويسري", "🇨🇭"],
    CAD: ["الدولار الكندي", "🇨🇦"],
    AUD: ["الدولار الأسترالي", "🇦🇺"],
    JPY: ["الين الياباني", "🇯🇵"],
  };
  const typeNames = {
    flight: "تذاكر طيران",
    hotel: "حجز فندق",
    program: "برنامج سياحي",
    umrah: "عمرة",
    visa: "تأشيرات",
    consult: "استشارة",
    cruise: "رحلة بحرية",
    task: "مهمة",
  };
  const workNames = {
    all: "الكل",
    new: "عملاء جدد",
    quotes: "عروض",
    followups: "متابعات",
    tasks: "مهام",
    bookings: "الحجوزات القادمة",
  };
  let cleanup = () => {},
    bookingAction = () => {};
  const date = (s) =>
    s && Number.isFinite(Date.parse(s))
      ? new Date(s).toLocaleString("ar-JO", {
          timeZone: "Asia/Amman",
          dateStyle: "short",
          timeStyle: "short",
        })
      : "لا موعد محدد";
  const number = (n) => (n == null ? "—" : Number(n).toLocaleString("en-US"));
  function phoneLinks(phone) {
    const p = String(phone || "").replace(/[^+\d]/g, "");
    let digits = p.replace(/\D/g, "");
    if (/^07\d{8}$/.test(digits)) digits = "962" + digits.slice(1);
    else if (digits.startsWith("00")) digits = digits.slice(2);
    const wa = /^[1-9]\d{7,14}$/.test(digits);
    return {
      tel: /^\+?\d{8,15}$/.test(p) ? "tel:" + p : null,
      wa: wa ? "https://wa.me/" + digits : null,
    };
  }
  function thumb(row) {
    const s = (row.destination || "").toLowerCase();
    return /بالي|bali/.test(s)
      ? "/media/workspace/bali-thumbnail.webp"
      : /مكة|مكه|عمرة|umrah|makkah/.test(s) || row.service === "umrah"
        ? "/media/hero/dest-makkah-thumb.jpg"
        : /اسطنبول|إسطنبول|تركيا|istanbul|turkey/.test(s)
          ? "/media/hero/dest-istanbul-thumb.jpg"
          : /مصر|القاهرة|egypt/.test(s)
            ? "/media/hero/dest-egypt-thumb.jpg"
            : /شرم|sharm/.test(s)
              ? "/media/hero/dest-sharm-thumb.jpg"
              : "/media/hero/hero-poster-thumb.jpg";
  }
  function skeleton() {
    return `<div class="wx-skeleton" aria-label="جارٍ تحميل لوحة العمل"><div></div><div></div><div class="wx-skeleton-grid">${Array.from({ length: 5 }, () => "<span></span>").join("")}</div><div class="wx-skeleton-body"></div></div>`;
  }
  async function mount(container, options) {
    cleanup();
    const {
      api,
      user,
      hasPermission,
      go,
      openRequest,
      openTask,
      openPanel,
      closePanel,
      notify,
      openNotifications,
      notificationButton,
    } = options;
    const root = document.createElement("div");
    root.className = "wx-workspace";
    container.replaceChildren(root);
    root.innerHTML = skeleton();
    let alive = true,
      data = null,
      fx = null,
      tab = "all",
      dueFilter = "all",
      page = 1,
      searchTimer,
      sequence = 0,
      loadSequence = 0,
      searchController,
      clockTimer,
      fxTimer,
      observer,
      membershipObserver;
    const cleanups = [];
    cleanup = () => {
      alive = false;
      clearTimeout(searchTimer);
      clearInterval(clockTimer);
      clearInterval(fxTimer);
      searchController?.abort();
      observer?.disconnect();
      membershipObserver?.disconnect();
      for (const f of cleanups) f();
    };
    const valid = () => alive && root.isConnected;
    const $ = (s) => root.querySelector(s);
    function fail(message, retry) {
      root.innerHTML = `<section class="wx-failure" role="alert"><h1>تعذر تحميل مساحة العمل</h1><p>${esc(message)}</p><button class="wx-button" data-workspace-retry>إعادة المحاولة</button></section>`;
      $("[data-workspace-retry]").onclick = retry;
    }
    async function load({ initial = false } = {}) {
      const current = ++loadSequence;
      try {
        const d = await api(
          "/api/admin/overview?" +
            new URLSearchParams({
              workspaceTab: tab,
              workspacePage: page,
              workspaceDue: dueFilter,
            }),
        );
        if (!valid() || current !== loadSequence) return;
        data = d.workspace;
        render();
        if (initial) loadFx();
      } catch (e) {
        if (valid() && current === loadSequence)
          fail(e.message, () => load({ initial: true }));
      }
    }
    function clock() {
      if (!valid()) return;
      const d = new Date();
      $("[data-workspace-time]").textContent = d.toLocaleTimeString("ar-JO", {
        timeZone: "Asia/Amman",
        hour: "2-digit",
        minute: "2-digit",
        hour12: true,
      });
      $("[data-workspace-date]").textContent = d.toLocaleDateString("ar-JO", {
        timeZone: "Asia/Amman",
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
      });
    }
    function row(item) {
      const p = phoneLinks(item.phone),
        prior = {
          urgent: ["high", "عالي"],
          high: ["high", "عالي"],
          normal: ["medium", "متوسط"],
          low: ["low", "منخفض"],
        }[item.priority] || ["none", "غير محددة"];
      const overdue = item.dueAt && Date.parse(item.dueAt) < Date.now(),
        isToday =
          item.dueAt &&
          new Intl.DateTimeFormat("en-CA", {
            timeZone: "Asia/Amman",
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
          }).format(new Date(item.dueAt)) === data.today;
      const due =
        item.kind === "quotes"
          ? "بانتظار رد العميل"
          : isToday
            ? item.kind === "tasks"
              ? "مهمة اليوم"
              : item.kind === "bookings"
                ? "موعد الحجز اليوم"
                : "متابعة اليوم"
            : date(item.dueAt);
      return `<article class="wx-work-row" data-work-row="${esc(item.rowKey)}"><span class="wx-priority wx-priority-${prior[0]}">${prior[1]}</span><img class="wx-destination" loading="lazy" width="112" height="52" src="${thumb(item)}" alt="" data-wx-image><button class="wx-row-name" data-work-open="${esc(item.rowKey)}">${icon(item.kind === "tasks" ? "check" : "users")}<span><strong>${esc(item.customer)}</strong><small>${esc(item.destination || typeNames[item.service] || "طلب عميل")} ${item.destination ? " • " + esc(typeNames[item.service] || "") : ""}</small></span></button><span class="wx-row-due ${overdue ? "wx-due-late" : ""}">${icon("calendar")}<span>${esc(due)}</span></span><div class="wx-row-actions">${p.wa ? `<a class="wx-contact wx-whatsapp" href="${p.wa}" target="_blank" rel="noopener" aria-label="واتساب ${esc(item.customer)}">${icon("wa")}</a>` : ""}${p.tel ? `<a class="wx-contact" href="${p.tel}" aria-label="اتصال ${esc(item.customer)}">${icon("phone")}</a>` : ""}<button class="wx-contact wx-row-more" data-work-menu="${esc(item.rowKey)}" aria-label="المزيد عن ${esc(item.customer)}">${icon("more")}</button></div></article>`;
    }
    function activityRow(a) {
      return `<button class="wx-activity" data-work-activity="${esc(a.id)}"><span class="wx-activity-icon">${icon(a.entity === "task" ? "check" : /quote/.test(a.kind) ? "upload" : /status/.test(a.kind) ? "plane" : "clock")}</span><span><strong>${esc(a.message || "تحديث مسجل")}</strong><small>${esc(date(a.at))}${a.actor ? " • " + esc(a.actor) : ""}</small></span></button>`;
    }
    function render() {
      if (!valid()) return;
      const context =
        $("[data-workspace-membership] select") ||
        document.querySelector("#membershipSlot select");
      const hour = Number(
        new Intl.DateTimeFormat("en-GB", {
          timeZone: "Asia/Amman",
          hour: "2-digit",
          hourCycle: "h23",
        }).format(new Date()),
      );
      const kpis = [
        ["upcomingBookings", "حجوزات قادمة", "plane", "purple", "bookings"],
        ["newCustomers", "عملاء جدد", "users", "blue", "new"],
        ["waitingQuotes", "عروض بانتظار رد", "ticket", "green", "quotes"],
        ["todayFollowUps", "متابعات اليوم", "calendar", "cyan", "followups"],
        ["overdueTasks", "مهام متأخرة", "bell", "rose", "tasks"],
      ];
      const services = [
        ["عمرة وحج", "kaaba", "umrah"],
        ["برامج سياحية", "palm", "program"],
        ["شهر عسل", "heart", "honeymoon"],
        ["تذاكر طيران", "plane", "flight"],
        ["تأشيرات", "passport", "visa"],
        ["رحلات بحرية", "ship", "cruise"],
      ];
      root.innerHTML = `<header class="wx-topbar"><button class="wx-nav-toggle wx-icon-button" data-workspace-menu aria-label="فتح قائمة العمل">${icon("menu")}</button><div class="wx-time-group"><span>${icon("clock")}<time data-workspace-time></time></span><span>${icon("calendar")}<time data-workspace-date></time></span><span class="wx-location">${icon("pin")}توقيت عمّان</span></div><form class="wx-global-search" role="search" data-workspace-search><label class="sr-only" for="workspaceSearch">ابحث عن عميل، طلب، عرض، حجز</label>${icon("search")}<input id="workspaceSearch" type="search" autocomplete="off" maxlength="100" placeholder="ابحث عن عميل، طلب، عرض، حجز..." aria-controls="workspaceSearchResults"><kbd>Ctrl K</kbd><div class="wx-search-results" id="workspaceSearchResults" role="group" aria-label="نتائج البحث" hidden></div></form><div class="wx-top-actions">${hasPermission("tasks:read") ? `<button class="wx-icon-button wx-notification" data-workspace-notifications aria-label="فتح الإشعارات">${icon("bell")}<span data-workspace-notification-count hidden></span></button>` : ""}${data.companyWhatsapp && phoneLinks(data.companyWhatsapp).wa ? `<a class="wx-icon-button" href="${phoneLinks(data.companyWhatsapp).wa}" target="_blank" rel="noopener" aria-label="واتساب لوريت">${icon("wa")}</a>` : ""}<button class="wx-icon-button" data-workspace-refresh aria-label="تحديث بيانات العمل">${icon("refresh")}</button></div></header>
        <section class="wx-currency-bar" aria-label="أسعار العملات مقابل الدينار"><div class="wx-currency-heading">${icon("chart")}<strong>أسعار العملات</strong><small>مقابل الدينار الأردني</small></div><div class="wx-currency-items" tabindex="0" role="region" aria-label="أسعار العملات؛ مرر لعرض البقية" data-workspace-currencies>${currencyLoading()}</div><div class="wx-currency-tools"><button class="wx-more-currencies" data-workspace-currency-more aria-haspopup="dialog">عرض المزيد ${icon("chevron")}</button><span class="wx-currency-status" data-workspace-currency-status>جارٍ القراءة…</span></div></section>
        <section class="wx-hero"><h1 tabindex="-1" data-workspace-heading>${hour < 12 ? "صباح الخير" : "مساء الخير"}، ${esc(user.name)} <span aria-hidden="true">👋</span></h1><p>جاهز ليوم عمل ناجح جديد في عالم السفر والسياحة</p><span class="wx-context">${esc({ organization: "جميع الجهات المصرح بها", branch: "نطاق الفرع الحالي", department: "نطاق القسم الحالي", assigned: "الأعمال المصرح بها لك" }[data.scope] || "جهة العمل الحالية")}</span><div class="wx-membership-slot" data-workspace-membership></div></section>
        <div class="wx-dashboard-content"><nav class="wx-service-pills" aria-label="اختصارات خدمات السفر">${services.map(([name, symbol, type]) => `<button data-workspace-service="${type}" ${!hasPermission("requests:read") && !hasPermission("programs:read") ? "disabled" : ""}>${icon(symbol)}<span>${name}</span></button>`).join("")}</nav>
        <section class="wx-kpi-grid" aria-label="مؤشرات العمل">${kpis.map(([key, label, symbol, color, target]) => `<button class="wx-kpi wx-kpi-${color}" data-workspace-kpi="${target}" title="${esc(data.metricNotes[key])}" ${data.metrics[key] === null ? "disabled" : ""}><span class="wx-kpi-icon">${icon(symbol)}</span><span><strong>${number(data.metrics[key])}</strong><span>${label}</span>${data.metrics[key] === null ? "<small>غير متاح ضمن صلاحياتك</small>" : ""}</span></button>`).join("")}</section>
        <div class="wx-main-grid"><section class="wx-glass wx-today"><div class="wx-panel-heading"><h2>${icon("calendar")} ${tab === "bookings" ? "مواعيد الحجوزات القادمة" : "شغلك اليوم"}</h2><span class="wx-work-total">${number(data.work.total)} بند</span></div><div class="wx-work-tabs" role="group" aria-label="تصفية شغلك اليوم">${Object.entries(
          data.work.counts,
        )
          .map(
            ([key, value]) =>
              `<button data-workspace-tab="${key}" aria-pressed="${tab === key}" class="${tab === key ? "is-active" : ""}">${workNames[key]} <span>(${number(tab === key ? data.work.total : value)})</span></button>`,
          )
          .join(
            "",
          )}</div><div data-workspace-rows>${data.work.items.map(row).join("") || `<div class="wx-empty">${icon("check")}<strong>${tab === "followups" ? "لا توجد متابعات مطلوبة اليوم 🎉" : tab === "bookings" ? "لا توجد مواعيد قسائم مؤكدة قادمة" : "لا توجد بنود مطابقة ضمن صلاحياتك"}</strong><p>ستظهر الأعمال المسجلة هنا عند توفرها.</p></div>`}</div><div class="wx-work-footer"><small>${esc(tab === "bookings" ? data.metricNotes.upcomingBookings : data.work.note)}</small><div><button data-workspace-page="${page - 1}" aria-label="الصفحة السابقة" ${page <= 1 ? "disabled" : ""}>‹</button><span>${page}/${data.work.pages}</span><button data-workspace-page="${page + 1}" aria-label="الصفحة التالية" ${page >= data.work.pages ? "disabled" : ""}>›</button></div></div></section>
        <section class="wx-glass wx-updates"><div class="wx-panel-heading"><h2>${icon("clock")} آخر التحديثات</h2></div><div>${data.activity.items.map(activityRow).join("") || '<p class="wx-empty-activity">لا توجد تحديثات مسجلة ضمن نطاقك.</p>'}</div><button class="wx-all-activity" data-workspace-all-activity ${!data.activity.total ? "disabled" : ""}>عرض جميع الأنشطة ${icon("arrow")}</button></section></div>
        <section class="wx-quick-block" aria-labelledby="workspaceQuickTitle"><h2 id="workspaceQuickTitle">إجراءات سريعة <span aria-hidden="true">⚡</span></h2><div class="wx-quick-actions">${[
          [
            "new",
            "عميل جديد",
            "plus",
            hasPermission("requests:write") && hasPermission("customers:write"),
          ],
          [
            "quote",
            "إرسال عرض",
            "upload",
            hasPermission("requests:read") && hasPermission("requests:write"),
          ],
          ["customers", "عملائي", "users", hasPermission("customers:read")],
          ["followups", "متابعاتي", "calendar", hasPermission("requests:read")],
          [
            "bookings",
            "الحجوزات",
            "plane",
            hasPermission("vouchers:read") && hasPermission("requests:read"),
          ],
          ["voucher", "إنشاء قسيمة", "ticket", hasPermission("requests:read")],
        ]
          .map(([key, label, symbol, allowed]) =>
            allowed
              ? `<button class="wx-quick ${key === "new" ? "wx-quick-gold" : ""}" data-workspace-quick="${key}">${icon(symbol)}<strong>${label}</strong></button>`
              : "",
          )
          .join(
            "",
          )}</div></section><p class="wx-page-status sr-only" role="status" data-workspace-status></p></div>`;
      clock();
      clearInterval(clockTimer);
      clockTimer = setInterval(clock, 60000);
      if (context) $("[data-workspace-membership]").append(context);
      membershipObserver?.disconnect();
      const membershipSlot = document.querySelector("#membershipSlot");
      if (membershipSlot) {
        membershipObserver = new MutationObserver(() => {
          const select = membershipSlot.querySelector("select");
          if (select && valid())
            $("[data-workspace-membership]")?.append(select);
        });
        membershipObserver.observe(membershipSlot, {
          childList: true,
          subtree: true,
        });
      }
      bind();
      if (fx) paintFx();
      observeNotifications();
    }
    function bind() {
      root.querySelectorAll("[data-workspace-tab]").forEach(
        (b) =>
          (b.onclick = () => {
            tab = b.dataset.workspaceTab;
            dueFilter = "all";
            page = 1;
            load();
          }),
      );
      root.querySelectorAll("[data-workspace-page]").forEach(
        (b) =>
          (b.onclick = () => {
            page = Number(b.dataset.workspacePage);
            load();
          }),
      );
      root.querySelectorAll("[data-workspace-kpi]").forEach(
        (b) =>
          (b.onclick = () => {
            tab = b.dataset.workspaceKpi;
            dueFilter =
              tab === "followups"
                ? "today"
                : tab === "tasks"
                  ? "overdue"
                  : "all";
            page = 1;
            load();
          }),
      );
      root.querySelectorAll("[data-workspace-service]").forEach(
        (b) =>
          (b.onclick = () => {
            const type = b.dataset.workspaceService;
            if (type === "honeymoon" && hasPermission("programs:read"))
              go("programs", { programSearch: "شهر عسل" });
            else if (hasPermission("requests:read"))
              go("requests", { type: type === "honeymoon" ? "program" : type });
            else go("programs", { programSearch: b.textContent.trim() });
          }),
      );
      root.querySelectorAll("[data-work-open],[data-work-menu]").forEach(
        (b) =>
          (b.onclick = () => {
            const key = b.dataset.workOpen || b.dataset.workMenu,
              item = data.work.items.find((i) => i.rowKey === key);
            if (!item) return;
            if (item.taskId) openTask(item.taskId);
            else if (item.requestId) openRequest(item.requestId);
          }),
      );
      root.querySelectorAll("[data-work-activity]").forEach(
        (b) =>
          (b.onclick = () => {
            const a = data.activity.items.find(
              (i) => i.id === b.dataset.workActivity,
            );
            if (a)
              a.entity === "task"
                ? openTask(a.entityId)
                : openRequest(a.entityId);
          }),
      );
      root
        .querySelectorAll("[data-workspace-quick]")
        .forEach((b) => (b.onclick = () => quick(b.dataset.workspaceQuick)));
      root.querySelectorAll("[data-wx-image]").forEach(
        (img) =>
          (img.onerror = () => {
            img.onerror = null;
            img.src = "/media/hero/hero-poster-thumb.jpg";
          }),
      );
      $("[data-workspace-refresh]").onclick = () => load({ initial: true });
      $("[data-workspace-notifications]")?.addEventListener(
        "click",
        openNotifications,
      );
      $("[data-workspace-menu]").onclick = () => options.openMenu();
      $("[data-workspace-currency-more]").onclick = openCurrencies;
      $("[data-workspace-all-activity]").onclick = () => activities(1);
      const input = $("#workspaceSearch");
      input.oninput = () => {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => search(input.value), 300);
      };
      $("[data-workspace-search]").onsubmit = (e) => {
        e.preventDefault();
        clearTimeout(searchTimer);
        search(input.value);
      };
      input.onkeydown = (e) => {
        if (e.key === "Escape") $("#workspaceSearchResults").hidden = true;
        if (e.key === "ArrowDown") {
          $("#workspaceSearchResults button")?.focus();
          e.preventDefault();
        }
      };
    }
    function observeNotifications() {
      observer?.disconnect();
      if (!notificationButton) return;
      const update = () => {
        const badge = $("[data-workspace-notification-count]");
        if (!badge) return;
        const n = notificationButton.textContent.match(/\(([\d,]+)\)/)?.[1];
        badge.hidden = !n || Number(n.replaceAll(",", "")) === 0;
        badge.textContent = n || "";
      };
      observer = new MutationObserver(update);
      observer.observe(notificationButton, {
        subtree: true,
        childList: true,
        characterData: true,
      });
      update();
    }
    async function search(term) {
      const slot = $("#workspaceSearchResults");
      if (!slot) return;
      term = term.trim();
      if (term.length < 2) {
        slot.hidden = true;
        return;
      }
      const current = ++sequence;
      searchController?.abort();
      searchController = new AbortController();
      slot.hidden = false;
      slot.innerHTML = '<p role="status">جارٍ البحث…</p>';
      const groups = [];
      if (hasPermission("requests:read"))
        groups.push([
          "الطلبات",
          "requests",
          "/api/admin/requests?q=" + encodeURIComponent(term),
          (r) =>
            r.requests
              .map((x) => ({
                label: x.customer || x.reference,
                sub: x.reference,
                open: () => openRequest(x.id),
              }))
              .slice(0, 4),
        ]);
      if (hasPermission("customers:read"))
        groups.push([
          "العملاء",
          "customers",
          "/api/admin/customers?q=" + encodeURIComponent(term),
          (r) =>
            r.customers
              .map((x) => ({
                label: x.name,
                sub: x.phone,
                open: () => options.openCustomer(x.id),
              }))
              .slice(0, 3),
        ]);
      if (hasPermission("programs:read"))
        groups.push([
          "البرامج",
          "programs",
          "/api/admin/program-workspace?q=" + encodeURIComponent(term),
          (r) =>
            r.items
              .map((x) => ({
                label: x.title,
                sub: x.slug,
                open: () => go("programs", { programSearch: x.slug }),
              }))
              .slice(0, 2),
        ]);
      if (hasPermission("vouchers:read") && hasPermission("requests:read"))
        groups.push([
          "القسائم",
          "voucherArchive",
          "/api/admin/vouchers?q=" + encodeURIComponent(term),
          (r) =>
            r.vouchers
              .map((x) => ({
                label: x.reference,
                sub: x.request_reference,
                open: () =>
                  go("voucherArchive", { voucherSearch: x.reference }),
              }))
              .slice(0, 2),
        ]);
      const results = await Promise.allSettled(
        groups.map((g) => api(g[2], { signal: searchController.signal })),
      );
      if (!valid() || current !== sequence) return;
      let html = "",
        actions = [],
        failed = 0;
      results.forEach((r, i) => {
        if (r.status === "rejected") {
          failed++;
          return;
        }
        const found = groups[i][3](r.value);
        if (!found.length) return;
        html += `<h3>${groups[i][0]}</h3>`;
        for (const item of found) {
          const index = actions.push(item.open) - 1;
          html += `<button type="button" data-search-result="${index}">${icon(groups[i][1] === "customers" ? "users" : "search")}<span><strong>${esc(item.label)}</strong><small>${esc(item.sub)}</small></span></button>`;
        }
      });
      slot.innerHTML =
        (html || "<p>لا توجد نتائج مطابقة ضمن صلاحياتك.</p>") +
        (failed
          ? '<p role="status">تعذر البحث في بعض الأقسام. حاول مجددًا.</p>'
          : "");
      slot.querySelectorAll("[data-search-result]").forEach(
        (b) =>
          (b.onclick = () => {
            slot.hidden = true;
            actions[Number(b.dataset.searchResult)]();
          }),
      );
      slot.onkeydown = (e) => {
        if (e.key === "Escape") {
          slot.hidden = true;
          $("#workspaceSearch").focus();
        }
        if (["ArrowDown", "ArrowUp"].includes(e.key)) {
          const buttons = [...slot.querySelectorAll("button")],
            i = buttons.indexOf(document.activeElement);
          buttons[
            (i + (e.key === "ArrowDown" ? 1 : -1) + buttons.length) %
              buttons.length
          ]?.focus();
          e.preventDefault();
        }
      };
    }
    function quick(action) {
      if (action === "new") newCustomer();
      else if (action === "quote") {
        go("requests");
        notify("اختر طلب العميل لإرسال العرض");
      } else if (action === "bookings") {
        tab = "bookings";
        dueFilter = "all";
        page = 1;
        load();
      } else go(action === "voucher" ? "voucher" : action);
    }
    async function newCustomer() {
      if (!data.intake?.branches.length) {
        notify("لا توجد جهة استقبال نشطة لحسابك؛ راجع المسؤول", "bad");
        return;
      }
      const panel = openPanel(
        `<div class="drawer-head"><h2>عميل وطلب استشارة جديد</h2><button class="drawer-close" data-close-drawer aria-label="إغلاق">×</button></div><p>سيُحفظ العميل مع طلب استشارة ظاهر ضمن جهة العمل. تسري قواعد العمل والإشعارات الحالية على الطلب.</p><form data-wx-customer class="stack"><label>اسم العميل<input name="name" required minlength="2" maxlength="80"></label><label>الهاتف مع رمز البلد<input name="phone" type="tel" dir="ltr" required maxlength="20" placeholder="+962791234567"></label><label>البريد (اختياري)<input name="email" type="email" maxlength="150"></label><label>فرع الاستقبال<select name="branchId">${data.intake.branches.map((b) => `<option value="${b.id}" ${b.id === user.branchId ? "selected" : ""}>${esc(b.name)}</option>`).join("")}</select></label><label>القسم<select name="departmentId"></select></label><label>موضوع الاستشارة<select name="topic">${Object.entries(
          {
            general: "عام",
            flight: "طيران",
            hotel: "فنادق",
            trip: "برنامج سياحي",
            visa: "تأشيرات",
            honeymoon: "شهر عسل",
            family: "عائلة",
            umrah: "عمرة",
          },
        )
          .map(([k, v]) => `<option value="${k}">${v}</option>`)
          .join(
            "",
          )}</select></label><label>تفاصيل الطلب<textarea name="message" required minlength="10" maxlength="1000"></textarea></label><label>قناة التواصل<select name="channel"><option value="phone">هاتف</option><option value="whatsapp">واتساب</option><option value="email">بريد</option></select></label><label><input name="consent" type="checkbox" required>أؤكد موافقة العميل على حفظ بيانات طلبه</label><p role="status" data-wx-status></p><button class="btn btn-primary" type="submit">حفظ العميل والطلب</button></form>`,
      );
      const form = panel.querySelector("form"),
        branch = form.elements.branchId,
        dept = form.elements.departmentId;
      const departments = () => {
        const list = data.intake.departments.filter(
          (d) => d.branch_id == null || d.branch_id === Number(branch.value),
        );
        dept.innerHTML = list
          .map(
            (d) =>
              `<option value="${d.id}" ${d.id === user.departmentId ? "selected" : ""}>${esc(d.name)}</option>`,
          )
          .join("");
      };
      departments();
      branch.onchange = departments;
      form.onsubmit = async (e) => {
        e.preventDefault();
        const button = form.querySelector("[type=submit]");
        button.disabled = true;
        try {
          const values = Object.fromEntries(new FormData(form));
          const result = await api("/api/admin/requests", {
            method: "POST",
            body: JSON.stringify({
              ...values,
              type: "consult",
              consent: true,
              whatsappUpdates: false,
              assignedTo:
                user.branchId === Number(branch.value) &&
                user.departmentId === Number(dept.value)
                  ? user.id
                  : null,
            }),
          });
          closePanel();
          notify("حُفظ العميل والطلب");
          await load();
          if (result.requestId) openRequest(result.requestId);
        } catch (error) {
          form.querySelector("[data-wx-status]").textContent = error.message;
          button.disabled = false;
        }
      };
    }
    async function activities(activityPage) {
      try {
        const d = await api(
          "/api/admin/overview?" +
            new URLSearchParams({ workspaceActivityPage: activityPage }),
        );
        if (!valid()) return;
        const a = d.workspace.activity;
        const panel = openPanel(
          `<div class="drawer-head"><h2>الأنشطة المسجلة</h2><button class="drawer-close" data-close-drawer aria-label="إغلاق">×</button></div><p>أحداث الطلبات والمهام المصرح بها؛ ليست تتبع مشاهدة العميل للعروض.</p>${a.items.map(activityRow).join("")}<div class="btn-row"><button class="btn btn-ghost" data-prev ${activityPage <= 1 ? "disabled" : ""}>السابق</button><span>${activityPage}/${a.pages}</span><button class="btn btn-ghost" data-next ${activityPage >= a.pages ? "disabled" : ""}>التالي</button></div>`,
        );
        panel.querySelectorAll("[data-work-activity]").forEach(
          (b) =>
            (b.onclick = () => {
              const item = a.items.find((x) => x.id === b.dataset.workActivity);
              closePanel();
              item.entity === "task"
                ? openTask(item.entityId)
                : openRequest(item.entityId);
            }),
        );
        panel.querySelector("[data-prev]").onclick = () =>
          activities(activityPage - 1);
        panel.querySelector("[data-next]").onclick = () =>
          activities(activityPage + 1);
      } catch (e) {
        notify(e.message, "bad");
      }
    }
    function currencyLoading() {
      return Array.from(
        { length: 6 },
        () => '<span class="wx-currency-skeleton"></span>',
      ).join("");
    }
    function currencyItem(item) {
      const [label, flag] = names[item.code] || [item.code, "🌐"];
      return `<div class="wx-currency-item"><span class="wx-currency-flag" aria-hidden="true">${["USD", "EUR", "GBP", "SAR", "AED", "TRY"].includes(item.code) ? `<img src="/media/workspace/flags/${item.code.toLowerCase()}.svg" alt="" width="30" height="30">` : flag}</span><span><b dir="ltr">${item.code}</b><small>${esc(label)}</small><span class="wx-currency-value" dir="ltr">${item.value == null ? "غير متاح" : Number(item.value).toLocaleString("en-US", { minimumFractionDigits: 3, maximumFractionDigits: 6 }) + " JOD"}</span></span><span class="wx-rate-state ${item.state === "stale" ? "is-stale" : ""}">${{ manual: "يدوي", api: "API", fallback: "بديل", stale: "قديمة", unavailable: "—" }[item.state]}${item.changePercent == null ? "" : `<small class="${item.changePercent >= 0 ? "wx-rate-up" : "wx-rate-down"}" dir="ltr">${item.changePercent >= 0 ? "↑" : "↓"} ${Math.abs(item.changePercent).toFixed(2)}%</small>`}</span></div>`;
    }
    async function loadFx() {
      try {
        const r = await api("/api/admin/exchange-rates");
        if (!valid()) return;
        fx = r;
        paintFx();
        clearInterval(fxTimer);
        fxTimer = setInterval(() => {
          if (!document.hidden) loadFx();
        }, r.refreshSeconds * 1000);
      } catch (e) {
        if (valid()) {
          $("[data-workspace-currencies]").innerHTML =
            '<span class="wx-currency-unavailable">تعذر قراءة العملات</span>';
          $("[data-workspace-currency-status]").textContent = e.message;
        }
      }
    }
    function paintFx() {
      if (!valid() || !fx) return;
      $("[data-workspace-currencies]").innerHTML = fx.selected
        .map((code) => currencyItem(fx.items.find((i) => i.code === code)))
        .join("");
      const any = fx.items.find(
        (i) => fx.selected.includes(i.code) && i.value !== null,
      );
      $("[data-workspace-currency-status]").textContent = any
        ? (fx.refreshFailed ? "تعذر التحديث • " : "") +
          "آخر تحديث: " +
          date(any.asOf)
        : "المصدر غير مهيأ • لا أسعار حية";
    }
    function openCurrencies() {
      if (!fx) {
        loadFx();
        notify("تجري قراءة أسعار العملات");
        return;
      }
      const panel = openPanel(
        `<div class="drawer-head"><h2>أسعار العملات والحاسبة</h2><button class="drawer-close" data-close-drawer aria-label="إغلاق">×</button></div><p>${esc(fx.note)}</p><div class="wx-rate-legend">يدوي: سعر معتمد يدويًا • API: من المزود • قديمة: تجاوزت صلاحيتها • بديل: تجاوزت اليدوية صلاحيتها.</div><form class="wx-calculator"><label>المبلغ<input name="amount" type="number" min="0" max="100000000" step="0.001" value="1"></label><label>العملة<select name="code">${fx.items.map((i) => `<option value="${i.code}">${i.code} — ${esc((names[i.code] || [i.code])[0])}</option>`).join("")}</select></label><output role="status"></output></form><div class="wx-currency-expanded">${fx.items.map(currencyItem).join("")}</div>${hasPermission("exchange:manage") && user.dataScope === "organization" ? '<button class="btn btn-primary" data-wx-manage>إدارة العملات</button>' : ""}`,
      );
      const form = panel.querySelector("form"),
        calculate = () => {
          const item = fx.items.find(
              (i) => i.code === form.elements.code.value,
            ),
            amount = Number(form.elements.amount.value);
          form.querySelector("output").textContent =
            item.value != null &&
            Number.isFinite(amount) &&
            amount >= 0 &&
            amount <= 100000000
              ? (amount * item.value).toLocaleString("en-US", {
                  maximumFractionDigits: 3,
                }) +
                " JOD • " +
                (item.state === "stale"
                  ? "تنبيه: بيانات قديمة"
                  : item.manual
                    ? "سعر يدوي إرشادي"
                    : "سعر إرشادي")
              : "السعر غير متاح";
        };
      form.oninput = calculate;
      calculate();
      panel
        .querySelector("[data-wx-manage]")
        ?.addEventListener("click", manageCurrencies);
    }
    function manageCurrencies() {
      const panel = openPanel(
        `<div class="drawer-head"><h2>إدارة العملات</h2><button class="drawer-close" data-close-drawer aria-label="إغلاق">×</button></div><p>الأسعار اليدوية تبقى موسومة بذلك. لا اتصال بمزود أو شراء خدمة من هذه الشاشة.</p><form class="stack" data-wx-currency-form><fieldset><legend>العملات الظاهرة (حتى12)</legend><div class="wx-currency-checks">${fx.items.map((i) => `<label><input type="checkbox" name="selected" value="${i.code}" ${fx.selected.includes(i.code) ? "checked" : ""}>${i.code}</label>`).join("")}</div></fieldset><label>عملة التعديل اليدوي<select name="code">${fx.items.map((i) => `<option value="${i.code}">${i.code}</option>`).join("")}</select></label><label>دينار أردني مقابل وحدة أجنبية واحدة<input name="value" type="number" min="0.00000001" max="1000000" step="0.00000001"></label><label>اسم المصدر<input name="source" maxlength="100" placeholder="اسم مصدر السعر الذي راجعته"></label><label>وقت السعر (بتوقيت جهازك)<input name="asOf" type="datetime-local"></label><label>صالح حتى (بتوقيت جهازك، بحد7أيام)<input name="validUntil" type="datetime-local"></label><label><input name="remove" type="checkbox">إلغاء التجاوز اليدوي لهذه العملة</label><label>سبب التغيير<textarea name="reason" minlength="3" maxlength="500" required></textarea></label><p role="status" data-wx-fx-status></p><button class="btn btn-primary" type="submit">حفظ الإعداد والسعر المعتمد</button></form>`,
      );
      const form = panel.querySelector("form");
      form.onsubmit = async (e) => {
        e.preventDefault();
        const b = form.querySelector("[type=submit]");
        b.disabled = true;
        try {
          const selected = [
              ...form.querySelectorAll("[name=selected]:checked"),
            ].map((i) => i.value),
            overrides = [];
          if (form.elements.remove.checked)
            overrides.push({ code: form.elements.code.value, value: null });
          else if (form.elements.value.value) {
            if (!form.elements.asOf.value || !form.elements.validUntil.value)
              throw Error("حدد وقت السعر ووقت انتهاء صلاحيته");
            overrides.push({
              code: form.elements.code.value,
              value: Number(form.elements.value.value),
              source: form.elements.source.value,
              asOf: new Date(form.elements.asOf.value).toISOString(),
              validUntil: new Date(
                form.elements.validUntil.value,
              ).toISOString(),
            });
          }
          fx = await api("/api/admin/exchange-rates", {
            method: "PATCH",
            body: JSON.stringify({
              revision: fx.revision,
              selected,
              overrides,
              reason: form.elements.reason.value,
            }),
          });
          paintFx();
          notify("حُفظت إعدادات العملات مع سجل التعديل");
          closePanel();
        } catch (error) {
          form.querySelector("[data-wx-fx-status]").textContent = error.message;
          b.disabled = false;
        }
      };
    }
    const key = (e) => {
      if (valid() && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        $("#workspaceSearch")?.focus();
      }
    };
    document.addEventListener("keydown", key);
    cleanups.push(() => document.removeEventListener("keydown", key));
    const outside = (e) => {
      const s = $("#workspaceSearchResults");
      if (s && !e.target.closest(".wx-global-search")) s.hidden = true;
    };
    document.addEventListener("click", outside);
    cleanups.push(() => document.removeEventListener("click", outside));
    bookingAction = () => {
      if (valid()) {
        tab = "bookings";
        page = 1;
        load();
      }
    };
    await load({ initial: true });
  }
  window.EmployeeWorkspace = {
    mount,
    icon,
    destroy: () => cleanup(),
    openBookings: () => bookingAction(),
  };
})();
