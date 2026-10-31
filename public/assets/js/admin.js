/* لوحة إدارة لوريت */
(() => {
  "use strict";

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const root = $("#adminRoot");
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = (n) => Number(n || 0).toLocaleString("en-US");
  const dt = (iso) => (iso ? new Date(iso).toLocaleString('ar-JO', { dateStyle: 'short', timeStyle: 'short' }) : '—');
  const day = (iso) => (iso ? new Date(iso).toLocaleDateString('ar-JO') : '—');

  const state = { user: null, section: 'overview', query: {}, overlay: null };
  function hasPermission(permission) {
    if (Array.isArray(state.user?.permissions)) return state.user.permissions.includes('*') || state.user.permissions.includes(permission);
    if (state.user?.role === 'admin') return true;
    const legacy = {
      manager: ['requests:read', 'requests:write', 'customers:read', 'customers:write', 'programs:read', 'programs:write', 'content:write', 'visa:write', 'kb:write', 'audit:read', 'overview:read', 'reports:read'],
      agent: ['requests:read', 'requests:write', 'customers:read', 'customers:write', 'programs:read', 'overview:read', 'kb:write'],
    };
    const taskLegacy={'tasks:read':'requests:read','tasks:write':'requests:write','tasks:assign':'requests:write'};
    if(taskLegacy[permission])permission=taskLegacy[permission];
    if (permission === 'requests:assign') permission = 'requests:write';
    return (legacy[state.user?.role] || []).includes(permission);
  }

  async function api(path, options = {}) {
    const res = await fetch(path, {
      credentials: 'same-origin',
      headers: {
        ...(options.body ? { 'content-type': 'application/json' } : {}),
        'x-requested-with': 'fetch',
        ...(options.headers || {}),
      },
      ...options,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) {
      const err = new Error(data.message || `خطأ ${res.status}`);
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  function toast(message, kind = 'ok') {
    let stack = $('#toastStack');
    if (!stack) {
      stack = document.createElement('div');
      stack.id = 'toastStack';
      stack.className = 'toast-stack';
      stack.setAttribute('aria-live', 'polite');
      document.body.append(stack);
    }
    const el = document.createElement('div');
    el.className = `toast toast-${kind}`;
    el.textContent = message;
    stack.append(el);
    setTimeout(() => { el.classList.add('is-out'); setTimeout(() => el.remove(), 280); }, 3800);
  }

  /* ---------------- login ---------------- */
  function renderLogin(message = "") {
    closeDrawer();
    clearInterval(notificationTimer);notificationTimer=null;
    root.innerHTML = `<div class="login-wrap">
      <form class="login-card" id="loginForm" autocomplete="on">
        <div class="brand" style="margin-bottom:16px">
          <img class="brand-logo" src="/media/brand/logo.png" alt="لوريت للسياحة والسفر" width="380" height="156">
        </div>
        <p class="login-eyebrow">لوحة الإدارة</p>
        <h1>تسجيل الدخول</h1>
        <p class="muted" style="font-size:13px">للوصول إلى الطلبات والعملاء والبرامج. المحاولات محدودة لحماية الحساب.</p>
        <div class="field"><label for="lu">اسم المستخدم</label><input id="lu" name="username" autocomplete="username" dir="ltr" required></div>
        <div class="field"><label for="lp">كلمة المرور</label><input id="lp" name="password" type="password" autocomplete="current-password" dir="ltr" required></div>
        <p class="form-status is-error" id="lerr">${esc(message)}</p>
        <button class="btn btn-primary btn-block" type="submit">دخول</button>
      </form>
    </div>`;
    $("#loginForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const button = e.target.querySelector("button");
      button.disabled = true;
      try {
        const data = await api('/api/auth/login', { method: 'POST', body: JSON.stringify(Object.fromEntries(fd.entries())) });
        if (data.mfaChallenge) return renderMfaLogin(data.challenge);
        state.user = data.user;
        boot();
      } catch (err) {
        $('#lerr').textContent = err.message;
      } finally {
        button.disabled = false;
      }
    });
  }

  function renderMfaLogin(challenge) {
    root.innerHTML = `<div class="login-wrap"><form class="login-card" id="mfaLogin"><h1>التحقق بخطوتين</h1><p>أدخل رمز تطبيق المصادقة أو أحد رموز الاستعادة.</p><label>رمز التحقق<input name="code" autocomplete="one-time-code" dir="ltr" required maxlength="32"></label><p class="form-status is-error" role="status"></p><button class="btn btn-primary">تحقق</button><button type="button" class="btn btn-ghost" data-back>رجوع</button></form></div>`;
    $("[data-back]").onclick = () => renderLogin();
    $("#mfaLogin").onsubmit = async (event) => {
      event.preventDefault();
      const button = event.target.querySelector("button");
      button.disabled = true;
      try {
        await api("/api/auth/mfa/verify", {
          method: "POST",
          body: JSON.stringify({
            challenge,
            code: event.target.elements.code.value,
          }),
        });
        await boot();
      } catch (error) {
        $(".form-status", event.target).textContent = error.message;
      } finally {
        button.disabled = false;
      }
    };
  }
  function renderMfaEnrollment() {
    root.innerHTML = `<div class="login-wrap"><div class="login-card"><h1>تأمين حساب المسؤول</h1><p>يلزم ربط تطبيق مصادقة قبل استخدام الصلاحيات الإدارية. لن تظهر بيانات العمل قبل إكمال التحقق.</p><form id="mfaSetup"><label>كلمة المرور الحالية<input name="password" type="password" autocomplete="current-password" required></label><button class="btn btn-primary">بدء الربط</button><p class="form-status is-error" role="status"></p></form><div id="mfaConfirmSlot"></div><button class="btn btn-ghost" data-mfa-logout>خروج</button></div></div>`;
    $("[data-mfa-logout]").onclick = async () => {
      await api("/api/auth/logout", { method: "POST" });
      renderLogin();
    };
    $("#mfaSetup").onsubmit = async (event) => {
      event.preventDefault();
      const button = event.target.querySelector("button");
      button.disabled = true;
      try {
        const data = await api("/api/auth/mfa/setup", {
          method: "POST",
          body: JSON.stringify({
            password: event.target.elements.password.value,
          }),
        });
        event.target.remove();
        $("#mfaConfirmSlot").innerHTML =
          `<p>في تطبيق المصادقة اختر إضافة مفتاح يدوي باسم Laurette. احفظه داخل التطبيق فقط:</p><code dir="ltr" style="overflow-wrap:anywhere">${esc(data.secret)}</code><form id="mfaConfirm"><label>رمز التطبيق<input name="code" autocomplete="one-time-code" inputmode="numeric" pattern="[0-9]{6}" required></label><p class="form-status is-error" role="status"></p><button class="btn btn-primary">تفعيل والتحقق</button></form>`;
        $("#mfaConfirm").onsubmit = async (event) => {
          event.preventDefault();
          const button = event.target.querySelector("button");
          button.disabled = true;
          try {
            const saved = await api("/api/auth/mfa/confirm", {
              method: "POST",
              body: JSON.stringify({ code: event.target.elements.code.value }),
            });
            $("#mfaConfirmSlot").innerHTML =
              `<h2>رموز الاستعادة — تظهر مرة واحدة</h2><p>احفظها في مكان آمن منفصل. كل رمز يستخدم مرة واحدة لاستعادة الدخول عند فقد الهاتف.</p><pre dir="ltr" style="user-select:all">${saved.recoveryCodes.map(esc).join("\n")}</pre><button class="btn btn-primary" data-mfa-done>حفظت الرموز — متابعة</button>`;
            $("[data-mfa-done]").onclick = boot;
          } catch (error) {
            $(".form-status", event.target).textContent = error.message;
          } finally {
            button.disabled = false;
          }
        };
      } catch (error) {
        $(".form-status", event.target).textContent = error.message;
      } finally {
        button.disabled = false;
      }
    };
  }

  /* ---------------- shell ---------------- */
  const SECTIONS = [
    { id: 'overview', label: 'نظرة عامة', icon: '▤', permission: 'overview:read' },
    { id:'tasks',label:'مهامي والفريق',icon:'☑',permission:'tasks:read' },
    { id: 'followups', label: 'متابعاتي', icon: '◷', permission: 'requests:read' },
    { id: 'requests', label: 'صندوق الطلبات', icon: '✉', permission: 'requests:read' },
    { id: 'voucher', label: 'قسيمة حجز يدوية', icon: '▦', permission: 'requests:read' },
    { id: 'reports', label: 'تقارير الأداء', icon: '▥', permission: 'reports:read' },
    { id: 'customers', label: 'العملاء (CRM)', icon: '☺', permission: 'customers:read' },
    { id: 'programs', label: 'البرامج', icon: '✈', permission: 'programs:read' },
    { id: 'content', label: 'المحتوى والعروض', icon: '✎', permission: 'content:write' },
    { id: 'visa', label: 'التأشيرات', icon: '▤', permission: 'visa:write' },
    { id: 'kb', label: 'قاعدة معرفة المساعد', icon: '◈', permission: 'kb:write' },
    { id: 'marketing', label: 'التسويق والتتبع', icon: '◉', permission: 'settings:write' },
    { id: 'users', label: 'الموظفون والصلاحيات', icon: '⚿', permission: 'users:write' },
    { id: 'organization', label: 'الفروع والأقسام والأدوار', icon: '⌂', permission: 'organization:read' },
    { id: 'settings', label: 'الإعدادات', icon: '⚙', permission: 'settings:write' },
    { id: 'audit', label: 'سجل العمليات', icon: '≡', permission: 'audit:read' },
    { id: 'assistant', label: 'محادثات المساعد', icon: '✧', permission: 'overview:read' },
  ];

  function visibleSections() {
    const role = state.user?.role;
    if (Array.isArray(state.user?.permissions)) {
      return SECTIONS.filter((section) => state.user.permissions.includes('*') || state.user.permissions.includes(section.permission));
    }
    if (role === 'admin') return SECTIONS;
    const allowed = { manager: ['overview', 'requests', 'followups', 'tasks', 'voucher', 'reports', 'customers', 'programs', 'content', 'visa', 'kb', 'audit', 'assistant'], agent: ['overview', 'requests', 'followups', 'tasks', 'voucher', 'customers', 'kb', 'assistant'] }[role] || ['overview'];
    return SECTIONS.filter((s) => allowed.includes(s.id));
  }

  function renderShell() {
    closeDrawer();
    if (state.user.mustChange) {
      renderRequiredPasswordChange();
      return;
    }
    if (state.user.mfaRequired && !state.user.mfaVerified)
      return renderMfaEnrollment();
    const sections = visibleSections();
    if(!sections.length){root.innerHTML='<div class="login-wrap"><div class="login-card"><h1>لا توجد صلاحيات مفعلة</h1><p>اطلب من المسؤول تعيين دور مناسب لحسابك.</p><button data-no-access-logout>خروج</button></div></div>'; $('[data-no-access-logout]').onclick=async()=>{await api('/api/auth/logout',{method:'POST'});renderLogin();};return;}
    if (!sections.find((s) => s.id === state.section)) state.section = sections[0].id;
    root.innerHTML = `<div class="admin-shell">
      <aside class="admin-side">
        <a class="brand" href="/" style="text-decoration:none">
          <span class="brand-mark">ل</span>
          <span class="brand-text"><b>لوريت</b><span>لوحة الإدارة</span></span>
        </a>
        <ul class="admin-nav">
          ${sections.map((s) => `<li><button type="button" data-section="${s.id}" class="${state.section === s.id ? 'is-active' : ''}"><span aria-hidden="true">${s.icon}</span>${esc(s.label)}${s.id === 'requests' ? '<span class="count" data-req-count>0</span>' : ''}</button></li>`).join('')}
        </ul>
        <div style="margin-top:auto;padding-top:18px;font-size:12px;color:rgba(255,255,255,.55)">
          <div style="margin-bottom:8px">${esc(state.user.name)} · ${esc(state.user.roleName || { admin: 'مدير', manager: 'مدير قسم', agent: 'موظف' }[state.user.role] || state.user.role)}</div>
          <button class="btn btn-ghost btn-sm" type="button" id="logoutBtn">خروج</button>
        </div>
      </aside>
      <main class="admin-main">
        <div class="admin-top">
          <h1 id="pageTitle">${esc(sections.find((s) => s.id === state.section)?.label || '')}</h1>
          <span class="spacer"></span>
          ${hasPermission('tasks:read')?'<button class="btn btn-ghost btn-sm" id="staffNotifications" aria-label="فتح الإشعارات">الإشعارات</button>':''}<label id="membershipSlot"></label><span class="admin-user">${esc(state.user.department || "")}</span>
          <a class="btn btn-ghost btn-sm" href="/" target="_blank" rel="noopener">عرض الموقع</a>
        </div>
        <div id="view"></div>
      </main>
    </div>`;

    root.removeEventListener("click", onNavClick);
    root.addEventListener("click", onNavClick);
    $('#logoutBtn').addEventListener('click', async () => {
      await api('/api/auth/logout', { method: 'POST' });
      state.user = null;
      renderLogin();
    });
    loadSection();
    startNotifications();
    api("/api/auth/memberships")
      .then((data) => {
        if (data.memberships.length < 2) return;
        $("#membershipSlot").innerHTML =
          `جهة العمل <select aria-label="جهة العمل" id="staffContext"><option value="">الجهة الأساسية</option>${data.memberships
            .filter((m) => !m.is_primary)
            .map(
              (m) =>
                `<option value="${m.id}" ${Number(state.user.membershipId) === m.id ? "selected" : ""}>${esc([m.branch_name, m.department_name].filter(Boolean).join(" — "))}</option>`,
            )
            .join("")}</select>`;
        $("#staffContext").onchange = async (event) => {
          event.target.disabled = true;
          try {
            await api("/api/auth/context", {
              method: "POST",
              body: JSON.stringify({
                membershipId: event.target.value || null,
              }),
            });
            await boot();
          } catch (error) {
            toast(error.message, "bad");
            event.target.disabled = false;
          }
        };
      })
      .catch(() => {});
  }

  function renderRequiredPasswordChange() {
    root.innerHTML = `<div class="login-wrap">
      <form class="login-card" id="requiredPasswordForm" autocomplete="on">
        <div class="brand" style="margin-bottom:18px"><span class="brand-mark">ل</span>
          <span class="brand-text"><b>لوريت</b><span>تأمين الحساب</span></span></div>
        <h1>غيّر كلمة المرور المؤقتة</h1>
        <p class="muted" style="font-size:13px">يلزم تعيين كلمة مرور جديدة قبل استخدام لوحة الإدارة.</p>
        <div class="field"><label for="currentPassword">كلمة المرور الحالية</label><input id="currentPassword" name="currentPassword" type="password" autocomplete="current-password" dir="ltr" required></div>
        <div class="field"><label for="newPassword">كلمة المرور الجديدة</label><input id="newPassword" name="newPassword" type="password" minlength="12" maxlength="128" autocomplete="new-password" dir="ltr" required></div>
        <div class="field"><label for="confirmPassword">تأكيد كلمة المرور الجديدة</label><input id="confirmPassword" name="confirmPassword" type="password" minlength="10" maxlength="128" autocomplete="new-password" dir="ltr" required></div>
        <p class="form-status is-error" id="passwordChangeError" role="status" aria-live="polite"></p>
        <button class="btn btn-primary btn-block" type="submit">حفظ كلمة المرور</button>
        <button class="btn btn-ghost btn-block" id="requiredLogout" type="button">خروج</button>
      </form>
    </div>`;
    $('#requiredPasswordForm').addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const values = Object.fromEntries(new FormData(form).entries());
      const error = $('#passwordChangeError');
      if (values.newPassword !== values.confirmPassword) {
        error.textContent = 'كلمتا المرور غير متطابقتين';
        return;
      }
      const button = form.querySelector('button[type="submit"]');
      button.disabled = true;
      error.textContent = '';
      try {
        await api('/api/auth/change-password', {
          method: 'POST',
          body: JSON.stringify({ currentPassword: values.currentPassword, newPassword: values.newPassword }),
        });
        state.user = null;
        renderLogin('تم تغيير كلمة المرور. سجّل الدخول مجددًا.');
      } catch (err) {
        error.textContent = err.message;
      } finally {
        button.disabled = false;
      }
    });
    $('#requiredLogout').addEventListener('click', async () => {
      try { await api('/api/auth/logout', { method: 'POST' }); } catch { /* Clear the local UI if the session has expired. */ }
      state.user = null;
      renderLogin();
    });
  }

  function onNavClick(e) {
    const btn = e.target.closest('[data-section]');
    if (!btn) return;
    state.section = btn.dataset.section;
    $$('.admin-nav button').forEach((b) => b.classList.toggle('is-active', b.dataset.section === state.section));
    $('#pageTitle').textContent = btn.textContent.replace(/\d+$/, '').trim();
    loadSection();
  }

  function loadSection() {
    const view = $('#view');
    if (!view) return;
    view.innerHTML = '<div class="admin-card"><div class="admin-card-body">جارٍ التحميل…</div></div>';
    const map = {
      overview: renderOverview, requests: renderRequests, tasks: renderTasks, followups: renderFollowUps, customers: renderCustomers, programs: renderPrograms,
      content: renderContent, visa: () => renderResource('visa'), kb: () => renderResource('kb'),
      voucher: renderVoucher,
      users: renderUsers, organization: renderOrganization, settings: renderSettings, audit: renderAudit, assistant: renderAssistant,
      reports: renderReports, marketing: renderMarketing,
    };
    (map[state.section] || renderOverview)();
  }

  /* ---------------- manual voucher (standalone) ---------------- */
  async function renderVoucher() {
    const view = $('#view');
    if (!window.VoucherStudio) {
      view.innerHTML = '<div class="admin-card"><div class="admin-card-body">تعذّر تحميل أداة القسيمة. أعد تحميل الصفحة.</div></div>';
      return;
    }
    view.innerHTML = '';
    await window.VoucherStudio.mount(view);
  }

  /* ---------------- overview ---------------- */
  async function renderOverview() {
    const data = await api('/api/admin/overview');
    const s = data.stats;
    const count = (k) => s.byStatus[k] || 0;
    const badge = $('[data-req-count]');
    if (badge) badge.textContent = num(s.total);
    $('#view').innerHTML = `
      <div class="stat-grid">
        <div class="stat"><span>طلبات جديدة</span><b>${num(count('new'))}</b><small>إجمالي الطلبات: ${num(s.total)}</small></div>
        <div class="stat"><span>تحتاج متابعة</span><b>${num(s.followUps)}</b><small>${num(s.overdue)} طلب متأخر أكثر من يومين</small></div>
        <div class="stat"><span>عروض أسعار مرسلة</span><b>${num(s.quotes)}</b><small>مؤكدة: ${num(count('confirmed'))}</small></div>
        <div class="stat"><span>عملاء مسجلون</span><b>${num(s.customers)}</b><small>اليوم: ${num(s.today)} طلب</small></div>
      </div>
      <div class="stat-grid" style="grid-template-columns:repeat(3,minmax(0,1fr))">
        ${Object.entries(data.types).map(([k, t]) => `<div class="stat"><span>${esc(t.label)}</span><b>${num(s.byType[k] || 0)}</b><small>${esc(t.department)}</small></div>`).join('')}
      </div>
      <div class="admin-card mb-3">
        <div class="admin-card-head"><h2>طلبات تحتاج إجراءً</h2><span class="spacer" style="flex:1"></span><button class="btn btn-ghost btn-sm" data-refresh>تحديث</button></div>
        <div class="admin-card-body" style="padding:0">
          <table class="admin-table"><thead><tr><th>المرجع</th><th>النوع</th><th>الملخص</th><th>الحالة</th><th>آخر تحديث</th></tr></thead>
          <tbody>${data.needsAction.length ? data.needsAction.map((r) => `<tr data-request="${r.id}">
            <td class="ref">${esc(r.reference)}</td><td>${esc(data.types[r.type]?.label || r.type)}</td>
            <td>${esc(r.summary || '')}</td><td><span class="status-dot status-${r.status}">${esc(data.statuses[r.status]?.label)}</span></td>
            <td>${dt(r.updated_at)}</td></tr>`).join('') : '<tr><td colspan="5" class="muted">لا توجد طلبات تحتاج متابعة الآن.</td></tr>'}
          </tbody></table>
        </div>
      </div>
      <div class="admin-card">
        <div class="admin-card-head"><h2>أحدث الطلبات</h2></div>
        <div class="admin-card-body" style="padding:0">
          <table class="admin-table"><thead><tr><th>المرجع</th><th>العميل</th><th>النوع</th><th>الحالة</th><th>التاريخ</th></tr></thead>
          <tbody>${data.recent.length ? data.recent.map((r) => `<tr data-request="${r.id}">
            <td class="ref">${esc(r.reference)}</td><td>${esc(r.customer || '—')}</td>
            <td>${esc(data.types[r.type]?.label || r.type)}</td>
            <td><span class="status-dot status-${r.status}">${esc(data.statuses[r.status]?.label)}</span></td>
            <td>${dt(r.created_at)}</td></tr>`).join('') : '<tr><td colspan="5" class="muted">لا توجد طلبات بعد. الطلبات الواردة من الموقع ستظهر هنا مباشرة.</td></tr>'}
          </tbody></table>
        </div>
      </div>`;
    bindRequestRows();
    $('[data-refresh]')?.addEventListener('click', renderOverview);
  }

  function bindRequestRows() {
    $$('[data-request]').forEach((row) => {
      row.addEventListener('click', () => openRequest(Number(row.dataset.request)));
    });
  }


  /* ---------------- tasks and internal notifications ---------------- */
  const TASK_STATUS = {
    new: "جديدة",
    in_progress: "قيد العمل",
    waiting: "تنتظر طرفًا آخر",
    review: "بحاجة مراجعة",
    done: "مكتملة",
    cancelled: "ملغاة",
  };
  const TASK_PRIORITY = {
    low: "منخفضة",
    normal: "عادية",
    high: "مرتفعة",
    urgent: "عاجلة",
  };
  let notificationTimer = null,
    notificationBusy = false;
  function localInput(iso) {
    const d = new Date(iso);
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000)
      .toISOString()
      .slice(0, 16);
  }
  async function updateNotificationCount() {
    const button = $("#staffNotifications");
    if (!button || notificationBusy || document.hidden) return;
    notificationBusy = true;
    try {
      const data = await api("/api/admin/notifications");
      if (button.isConnected) {
        button.textContent = `الإشعارات (${num(data.unread)})`;
        button.title = "الإشعارات ضمن نطاق الوصول الحالي";
      }
    } catch (error) {
      if (button.isConnected) button.title = error.message;
    } finally {
      notificationBusy = false;
    }
  }
  function startNotifications() {
    clearInterval(notificationTimer);
    notificationTimer = null;
    if (!hasPermission("tasks:read")) return;
    $("#staffNotifications")?.addEventListener("click", () => openNotifications());
    updateNotificationCount();
    notificationTimer = setInterval(updateNotificationCount, 60000);
  }
  async function openNotifications(page = 1) {
    try {
      const data = await api(`/api/admin/notifications?page=${page}`);
      openDrawer(
        `<div class="drawer-head"><h2>الإشعارات</h2><button class="drawer-close" data-close-drawer aria-label="إغلاق">×</button></div><p>${num(data.unread)} غير مقروء · صفحة ${data.page}/${data.pages}</p><ul class="timeline">${data.notifications.map((n) => `<li><button class="btn btn-ghost" data-task-notification="${n.id}" data-task-id="${n.task_id}">${n.read_at ? "" : "● "}${esc(n.title)}</button><span>${esc({ created: "مهمة جديدة", updated: "تحديث المهمة", comment: "تعليق جديد", checklist: "تحديث قائمة التحقق" }[n.kind] || "تحديث مهمة")} · ${followDate(n.created_at)}</span></li>`).join("") || "<li>لا توجد إشعارات متاحة.</li>"}</ul><div class="btn-row"><button class="btn btn-ghost" data-notification-prev ${page <= 1 ? "disabled" : ""}>السابق</button><button class="btn btn-ghost" data-notification-next ${page >= data.pages ? "disabled" : ""}>التالي</button></div>`,
      );
      $("[data-notification-prev]").onclick=()=>openNotifications(page-1);
      $("[data-notification-next]").onclick=()=>openNotifications(page+1);
      $("[data-task-notification]").forEach(
        (b) =>
          (b.onclick = async () => {
            try {
              await api(
                `/api/admin/notifications/${b.dataset.taskNotification}/read`,
                { method: "POST" },
              );
              await openTask(Number(b.dataset.taskId));
              updateNotificationCount();
            } catch (e) {
              toast(e.message, "bad");
            }
          }),
      );
    } catch (error) {
      toast(error.message, "bad");
    }
  }
  async function renderTasks(page = 1) {
    const view = $("#view");
    try {
      const data = await api(
        "/api/admin/tasks?" +
          new URLSearchParams({ ...state.query, page: String(page) }),
      );
      if (state.section !== "tasks") return;
      view.innerHTML = `<div class="toolbar">${hasPermission("tasks:write") ? '<button class="btn btn-primary" data-new-task>مهمة جديدة</button>' : ""}<label>الحالة<select data-task-filter="status"><option value="open">المفتوحة</option><option value="all" ${state.query.status === "all" ? "selected" : ""}>كل الحالات</option>${Object.entries(
        TASK_STATUS,
      )
        .map(
          ([k, v]) =>
            `<option value="${k}" ${state.query.status === k ? "selected" : ""}>${v}</option>`,
        )
        .join(
          "",
        )}</select></label><label>الموعد<select data-task-filter="due"><option value="">كل المواعيد</option><option value="overdue" ${state.query.due === "overdue" ? "selected" : ""}>متأخرة</option><option value="next24h" ${state.query.due === "next24h" ? "selected" : ""}>خلال 24 ساعة</option></select></label>${hasPermission("tasks:assign") ? `<label>النطاق<select data-task-filter="view"><option value="mine">مهامي والمشارك بها</option><option value="team" ${state.query.view === "team" ? "selected" : ""}>الفريق ضمن نطاقي</option></select></label>` : ""}<label>بحث<input data-task-filter="q" value="${esc(state.query.q || "")}" maxlength="200"></label><button class="btn btn-ghost" data-task-apply>تصفية</button></div><p class="muted">${num(data.total)} مهمة · المواعيد بتوقيت عمّان</p><div class="admin-card"><div class="admin-card-body" style="overflow-x:auto"><table class="admin-table"><thead><tr><th>المهمة</th><th>المسؤول</th><th>الجهة</th><th>الحالة</th><th>الأولوية</th><th>الموعد</th></tr></thead><tbody>${data.tasks.map((t) => `<tr><td><button class="btn btn-ghost" data-task-open="${t.id}">${esc(t.title)}</button></td><td>${esc(t.assignee_name)}</td><td>${esc(t.branch_name)}<br>${esc(t.department_name || "كل الأقسام")}</td><td>${TASK_STATUS[t.status]}</td><td>${TASK_PRIORITY[t.priority]}</td><td>${followDate(t.due_at)}${t.overdue ? '<br><span class="badge badge-danger">متأخرة</span>' : ""}</td></tr>`).join("") || '<tr><td colspan="6">لا توجد مهام مطابقة.</td></tr>'}</tbody></table></div></div><div class="btn-row mt-3"><button class="btn btn-ghost" data-task-prev ${page <= 1 ? "disabled" : ""}>السابق</button><span>${page}/${data.pages}</span><button class="btn btn-ghost" data-task-next ${page >= data.pages ? "disabled" : ""}>التالي</button></div>`;
      $("[data-new-task]")?.addEventListener("click", () => openTaskCreate());
      $$("[data-task-open]", view).forEach(
        (b) => (b.onclick = () => openTask(Number(b.dataset.taskOpen))),
      );
      $("[data-task-apply]", view).onclick = () => {
        state.query = {};
        $$("[data-task-filter]", view).forEach((el) => {
          if (el.value) state.query[el.dataset.taskFilter] = el.value;
        });
        renderTasks();
      };
      $("[data-task-prev]", view).onclick = () => renderTasks(page - 1);
      $("[data-task-next]", view).onclick = () => renderTasks(page + 1);
    } catch (error) {
      if (state.section === "tasks") {
        view.innerHTML = `<p class="form-status is-error">${esc(error.message)}</p><button class="btn btn-ghost" data-task-retry>إعادة المحاولة</button>`;
        $("[data-task-retry]", view).onclick = () => renderTasks(page);
      }
    }
  }
  async function openTaskCreate(request = null) {
    try {
      const initial = await api("/api/admin/tasks/options");
      openDrawer(
        `<div class="drawer-head"><h2>مهمة جديدة</h2><button class="drawer-close" data-close-drawer aria-label="إغلاق">×</button></div><form id="taskCreate" class="stack"><label>العنوان<input name="title" required minlength="3" maxlength="160"></label><label>الوصف<textarea name="description" maxlength="4000"></textarea></label><div class="form-grid"><label>الفرع<select name="branchId" required><option value="">اختر الفرع</option>${initial.branches.map((b) => `<option value="${b.id}" ${Number(request?.branch_id || state.user.branchId) === b.id ? "selected" : ""}>${esc(b.name)}</option>`).join("")}</select></label><label>القسم<select name="departmentId"><option value="">دون قسم محدد</option></select></label></div><label>مرجع الطلب (اختياري)<input name="requestReference" maxlength="100" value="${esc(request?.reference || "")}" placeholder="مرجع الطلب كما يظهر في صندوق الطلبات"></label><p class="muted">ربط الطلب يتطلب تطابق الفرع والقسم والوصول المسبق إليه.</p><label>الموعد بتوقيت جهازك (${esc(Intl.DateTimeFormat().resolvedOptions().timeZone)})<input type="datetime-local" name="dueAt" required></label><label>الأولوية<select name="priority">${Object.entries(
          TASK_PRIORITY,
        )
          .map(
            ([k, v]) =>
              `<option value="${k}" ${k === "normal" ? "selected" : ""}>${v}</option>`,
          )
          .join(
            "",
          )}</select></label><label>المسؤول<select name="assignedTo" required></select></label>${hasPermission("tasks:assign") ? '<label>المشاركون (اختياري؛ يمكن تحديد أكثر من موظف)<select name="members" multiple size="5" aria-describedby="task-members-help"></select></label><small id="task-members-help">على الكمبيوتر استخدم Ctrl أو ⌘ لتحديد عدة مشاركين.</small>' : ""}<p class="form-status is-error" role="status"></p><button class="btn btn-primary" type="submit">إنشاء المهمة</button></form>`,
      );
      const form = $("#taskCreate"),
        branch = form.elements.branchId,
        dept = form.elements.departmentId,
        owner = form.elements.assignedTo,
        submit = form.querySelector('[type="submit"]');
      let loading = 0;
      const load = async (refreshDepartments = false) => {
        const ticket = ++loading;
        submit.disabled = true;
        try {
          if (!branch.value) {
            owner.innerHTML = "";
            return;
          }
          const desired = refreshDepartments
            ? (request?.department_id ??
              (Number(branch.value) === state.user.branchId
                ? state.user.departmentId
                : null) ??
              "")
            : dept.value;
          const options = await api(
            "/api/admin/tasks/options?" +
              new URLSearchParams({
                branchId: branch.value,
                departmentId: String(desired),
                ...(form.elements.requestReference.value
                  ? { requestReference: form.elements.requestReference.value }
                  : {}),
              }),
          );
          if (ticket !== loading || !form.isConnected) return;
          if (refreshDepartments)
            dept.innerHTML =
              '<option value="">دون قسم محدد</option>' +
              options.departments
                .map(
                  (d) =>
                    `<option value="${d.id}" ${Number(desired) === d.id ? "selected" : ""}>${esc(d.name)}</option>`,
                )
                .join("");
          owner.innerHTML = options.users
            .map(
              (u) =>
                `<option value="${u.id}" ${u.id === state.user.id ? "selected" : ""}>${esc(u.name)}</option>`,
            )
            .join("");
          if (form.elements.members)
            form.elements.members.innerHTML = options.users
              .map((u) => `<option value="${u.id}">${esc(u.name)}</option>`)
              .join("");
          form.querySelector('[role="status"]').textContent = "";
          submit.disabled = !owner.options.length;
        } catch (error) {
          if (ticket === loading)
            form.querySelector('[role="status"]').textContent = error.message;
        }
      };
      branch.onchange = () => {
        request = null;
        load(true);
      };
      dept.onchange = () => load();
      form.elements.requestReference.onchange = () => load();
      load(true);
      form.onsubmit = async (event) => {
        event.preventDefault();
        submit.disabled = true;
        try {
          const body = Object.fromEntries(new FormData(form));
          body.dueAt = new Date(body.dueAt).toISOString();
          body.members = form.elements.members
            ? [...form.elements.members.selectedOptions].map((o) =>
                Number(o.value),
              )
            : [];
          const result = await api("/api/admin/tasks", {
            method: "POST",
            body: JSON.stringify(body),
          });
          toast("أُنشئت المهمة");
          openTask(result.id);
          if (state.section === "tasks") renderTasks();
          updateNotificationCount();
        } catch (error) {
          form.querySelector('[role="status"]').textContent = error.message;
          submit.disabled = false;
        }
      };
    } catch (error) {
      toast(error.message, "bad");
    }
  }
  async function openTask(id) {
    try {
      const data = await api(`/api/admin/tasks/${id}`),
        t = data.task;
      const write = hasPermission("tasks:write"),
        edit =
          write &&
          (t.assigned_to === state.user.id ||
            t.created_by === state.user.id ||
            hasPermission("tasks:assign"));
      const options = hasPermission("tasks:assign")
        ? await api(
            "/api/admin/tasks/options?" +
              new URLSearchParams({
                branchId: String(t.branch_id),
                departmentId:
                  t.department_id === null ? "" : String(t.department_id),
                ...(t.request_id ? { requestId: String(t.request_id) } : {}),
              }),
          ).catch((error) => {
            toast("تعذر تحميل الموظفين: " + error.message, "bad");
            return { users: [] };
          })
        : null;
      openDrawer(`<div class="drawer-head"><h2>${esc(t.title)}</h2><button class="drawer-close" data-close-drawer aria-label="إغلاق">×</button></div><p class="badge-row"><span class="badge badge-soft">${TASK_STATUS[t.status]}</span><span class="badge badge-gold">${TASK_PRIORITY[t.priority]}</span></p><p style="white-space:pre-wrap">${esc(t.description || "دون وصف إضافي")}</p><p>المسؤول: ${esc(data.assigneeName || "غير متاح")}</p><p>الموعد: ${followDate(t.due_at)} بتوقيت عمّان</p><p>المشاركون: ${data.members.map((m) => esc(m.name)).join("، ") || "لا يوجد"}</p>${t.request_id ? `<button class="btn btn-ghost btn-sm" data-open-linked-request>فتح الطلب ${esc(data.requestReference)}</button>` : ""}
        ${
          edit
            ? `<details><summary>تعديل المهمة ونقل المسؤولية</summary><form id="taskEdit" class="stack"><label>العنوان<input name="title" value="${esc(t.title)}" required minlength="3" maxlength="160"></label><label>الوصف<textarea name="description" maxlength="4000">${esc(t.description)}</textarea></label><label>الموعد بتوقيت جهازك<input name="dueAt" type="datetime-local" value="${localInput(t.due_at)}" required></label><label>الأولوية<select name="priority">${Object.entries(
                TASK_PRIORITY,
              )
                .map(
                  ([k, v]) =>
                    `<option value="${k}" ${t.priority === k ? "selected" : ""}>${v}</option>`,
                )
                .join(
                  "",
                )}</select></label><label>الحالة<select name="status">${[t.status, ...data.statuses[t.status]].map((k) => `<option value="${k}">${TASK_STATUS[k]}</option>`).join("")}</select></label>${
                options
                  ? `<label>المسؤول<select name="assignedTo"><option value="${t.assigned_to}">${esc(data.assigneeName || "المسؤول الحالي")}</option>${options.users
                      .filter((u) => u.id !== t.assigned_to)
                      .map(
                        (u) => `<option value="${u.id}">${esc(u.name)}</option>`,
                      )
                      .join("")}</select></label>`
                  : ""
              }<label>سبب التعديل أو نتيجة الإتمام<textarea name="reason" required minlength="3" maxlength="500"></textarea></label><p class="form-status is-error" role="status"></p><button class="btn btn-primary">حفظ التغيير</button></form></details>`
            : ""
        }
        <hr><h3>قائمة التحقق</h3>${data.checklist.map((item) => `<label style="display:block;margin-block:10px"><input type="checkbox" data-task-check="${item.id}" ${item.done ? "checked" : ""} ${!write || ["done", "cancelled"].includes(t.status) ? "disabled" : ""}> ${esc(item.title)}</label>`).join("") || '<p class="muted">لا توجد بنود.</p>'}${write && !["done", "cancelled"].includes(t.status) ? '<form id="taskCheckAdd" class="stack"><label>بند جديد<input name="title" required maxlength="200"></label><p class="form-status is-error" role="status"></p><button class="btn btn-ghost">إضافة بند</button></form>' : ""}
        <hr><h3>التعليقات</h3>${write ? '<form id="taskComment" class="stack"><label>تعليق داخلي<textarea name="body" required maxlength="2000"></textarea></label><p class="form-status is-error" role="status"></p><button class="btn btn-primary">إضافة تعليق</button></form>' : ""}<ul class="timeline">${data.comments.map((c) => `<li><p style="white-space:pre-wrap">${esc(c.body)}</p><span>${esc(c.user_name)} · ${followDate(c.created_at)}</span></li>`).join("") || "<li>لا تعليقات بعد.</li>"}</ul>
        <h3>سجل المهمة (آخر 100 حدث)</h3><ul class="timeline">${data.events.map((e) => `<li><b>${esc(e.reason)}</b><span>${esc(e.actor_name || "النظام")} · ${followDate(e.created_at)}</span>${e.before_json ? `<small>${taskEventChange(e)}</small>` : ""}</li>`).join("")}</ul>`);
      $("[data-open-linked-request]")?.addEventListener("click", () =>
        openRequest(t.request_id),
      );
      const submitForm = (selector, path, method, build) => {
        $(selector)?.addEventListener("submit", async (event) => {
          event.preventDefault();
          const form = event.target,
            button = form.querySelector("button");
          button.disabled = true;
          try {
            await api(path, {
              method,
              body: JSON.stringify(build(Object.fromEntries(new FormData(form)))),
            });
            toast("تم الحفظ");
            await openTask(id);
            if (state.section === "tasks") renderTasks();
            updateNotificationCount();
          } catch (error) {
            form.querySelector('[role="status"]').textContent = error.message;
          } finally {
            button.disabled = false;
          }
        });
      };
      submitForm("#taskEdit", `/api/admin/tasks/${id}`, "PATCH", (body) => ({
        ...body,
        dueAt: new Date(body.dueAt).toISOString(),
        version: t.version,
      }));
      submitForm(
        "#taskComment",
        `/api/admin/tasks/${id}/comments`,
        "POST",
        (body) => body,
      );
      submitForm(
        "#taskCheckAdd",
        `/api/admin/tasks/${id}/checklist`,
        "POST",
        (body) => body,
      );
      $$("[data-task-check]").forEach(
        (box) =>
          (box.onchange = async () => {
            box.disabled = true;
            try {
              const item = data.checklist.find(
                (i) => i.id === Number(box.dataset.taskCheck),
              );
              await api(`/api/admin/task-checklist/${item.id}`, {
                method: "PATCH",
                body: JSON.stringify({
                  done: box.checked,
                  version: item.version,
                }),
              });
              openTask(id);
            } catch (error) {
              box.checked = !box.checked;
              box.disabled = false;
              toast(error.message, "bad");
            }
          }),
      );
    } catch (error) {
      toast(error.message, "bad");
    }
  }
  function taskEventChange(event) {
    try {
      const old = JSON.parse(event.before_json),
        next = JSON.parse(event.after_json);
      return [
        old.status !== next.status && next.status
          ? `${TASK_STATUS[old.status]} ← ${TASK_STATUS[next.status]}`
          : "",
        old.assigned_to !== next.assigned_to && next.assigned_to
          ? `نُقلت المسؤولية من ${event.from_assignee_name || "المسؤول السابق"} إلى ${event.to_assignee_name || "المسؤول الجديد"}`
          : "",
        old.due_at !== next.due_at && next.due_at
          ? `تغير الموعد إلى ${followDate(next.due_at)}`
          : "",
      ]
        .filter(Boolean)
        .map(esc)
        .join(" · ");
    } catch {
      return "";
    }
  }

  /* ---------------- scoped request follow-ups ---------------- */
  const FOLLOW_STATUS = { open: 'مفتوحة', done: 'مكتملة', cancelled: 'ملغاة' };
  const followDate = (iso) => new Date(iso).toLocaleString('ar-JO', { timeZone:'Asia/Amman', dateStyle:'short', timeStyle:'short' });
  function followRows(data) {
    return `<p class="muted">المواعيد المعروضة بتوقيت عمّان · ${num(data.total)} متابعة · ${data.page}/${data.pages}</p>
      <div class="admin-card"><div class="admin-card-body" style="overflow-x:auto"><table class="admin-table"><thead><tr><th>الطلب</th><th>المتابعة</th><th>المسؤول</th><th>الموعد</th><th>الحالة</th><th>الإجراء</th></tr></thead><tbody>
      ${data.followUps.map((f) => `<tr><td><button class="btn btn-ghost btn-sm ref" data-follow-request="${f.request_id}">${esc(f.reference)}</button></td><td style="white-space:pre-wrap">${esc(f.note)}</td><td>${esc(f.assignee_name || 'غير متاح')}</td><td>${esc(followDate(f.due_at))}${f.overdue ? '<br><span class="badge badge-danger">متأخرة</span>' : ''}</td><td>${esc(FOLLOW_STATUS[f.status])}</td><td>${f.status === 'open' && hasPermission('requests:write') && (f.assigned_to === state.user.id || hasPermission('requests:assign')) ? `<button class="btn btn-primary btn-sm" data-follow-finish="${f.id}" data-result="done">إكمال</button> <button class="btn btn-ghost btn-sm" data-follow-finish="${f.id}" data-result="cancelled">إلغاء</button>` : '—'}</td></tr>`).join('') || '<tr><td colspan="6">لا توجد متابعات مطابقة.</td></tr>'}
      </tbody></table></div></div>`;
  }
  function bindFollowRows(container, data, refresh) {
    $$('[data-follow-request]',container).forEach((b) => b.onclick = () => openRequest(Number(b.dataset.followRequest)));
    $$('[data-follow-finish]',container).forEach((b) => b.onclick = () => {
      const item = data.followUps.find((f) => f.id === Number(b.dataset.followFinish));
      openDrawer(`<div class="drawer-head"><h2>${b.dataset.result === 'done' ? 'إكمال المتابعة' : 'إلغاء المتابعة'}</h2><button class="drawer-close" data-close-drawer aria-label="إغلاق">×</button></div><p>${esc(item.note)}</p><form id="followFinishForm" class="stack"><label>النتيجة أو سبب الإلغاء<textarea name="reason" required minlength="3" maxlength="500"></textarea></label><p class="form-status is-error" role="status"></p><button class="btn btn-primary">حفظ</button></form>`);
      $('#followFinishForm').onsubmit = async (event) => {
        event.preventDefault(); const button = event.target.querySelector('button'); button.disabled = true;
        try { await api(`/api/admin/follow-ups/${item.id}/finish`, {method:'POST',body:JSON.stringify({status:b.dataset.result,reason:new FormData(event.target).get('reason')})}); closeDrawer(); toast('تم حفظ نتيجة المتابعة'); refresh(); }
        catch(error) { event.target.querySelector('[role="status"]').textContent=error.message; }
        finally { button.disabled=false; }
      };
    });
  }
  async function loadRequestFollowUps(id, page=1) {
    const slot = $('#requestFollowUps'); if (!slot) return;
    slot.innerHTML = '<p role="status">جارٍ تحميل المتابعات…</p>';
    try {
      const data = await api(`/api/admin/requests/${id}/follow-ups?status=all&page=${page}`);
      if (!slot.isConnected) return;
      slot.innerHTML = `<h3>متابعات الطلب</h3>${followRows(data)}<div class="btn-row"><button class="btn btn-ghost btn-sm" data-prev ${page<=1?'disabled':''}>السابق</button><button class="btn btn-ghost btn-sm" data-next ${page>=data.pages?'disabled':''}>التالي</button></div>
        ${hasPermission('requests:write') ? `<form id="followCreateForm" class="stack mt-3"><label>وصف المتابعة<textarea name="note" required minlength="3" maxlength="2000"></textarea></label><label>الموعد بتوقيت جهازك (${esc(Intl.DateTimeFormat().resolvedOptions().timeZone)})<input type="datetime-local" name="dueAt" required></label><label>مسؤول المتابعة<select name="assignedTo">${data.assignees.map((u)=>`<option value="${u.id}" ${u.id===state.user.id?'selected':''}>${esc(u.name)}</option>`).join('')}</select></label><p class="form-status is-error" role="status"></p><button class="btn btn-primary btn-sm">إضافة متابعة</button></form>` : ''}`;
      bindFollowRows(slot,data,()=>openRequest(id));
      $('[data-prev]',slot).onclick=()=>loadRequestFollowUps(id,page-1);
      $('[data-next]',slot).onclick=()=>loadRequestFollowUps(id,page+1);
      $('#followCreateForm')?.addEventListener('submit',async(event)=>{
        event.preventDefault();const button=event.target.querySelector('button');button.disabled=true;
        try { const body=Object.fromEntries(new FormData(event.target)); body.dueAt=new Date(body.dueAt).toISOString(); await api(`/api/admin/requests/${id}/follow-ups`,{method:'POST',body:JSON.stringify(body)}); toast('أُضيفت المتابعة'); loadRequestFollowUps(id); }
        catch(error) { event.target.querySelector('[role="status"]').textContent=error.message; }
        finally { button.disabled=false; }
      });
    } catch(error) { if(slot.isConnected) slot.innerHTML=`<p class="form-status is-error">${esc(error.message)}</p><button class="btn btn-ghost btn-sm" data-retry-follow>إعادة المحاولة</button>`; $('[data-retry-follow]',slot)?.addEventListener('click',()=>loadRequestFollowUps(id,page)); }
  }
  async function renderFollowUps(page=1) {
    const view=$('#view');
    try {
      const params=new URLSearchParams({...state.query,page:String(page)});
      const data=await api(`/api/admin/follow-ups?${params}`);
      if(state.section!=='followups') return;
      view.innerHTML=`<div class="toolbar"><label>الحالة<select data-follow-filter="status">${[['open','مفتوحة'],['done','مكتملة'],['cancelled','ملغاة'],['all','كل الحالات']].map(([k,v])=>`<option value="${k}" ${(state.query.status||'open')===k?'selected':''}>${v}</option>`).join('')}</select></label><label>الموعد<select data-follow-filter="due"><option value="">كل المواعيد</option><option value="overdue" ${state.query.due==='overdue'?'selected':''}>متأخرة</option><option value="next24h" ${state.query.due==='next24h'?'selected':''}>خلال 24 ساعة</option></select></label>${hasPermission('requests:assign')?`<label>المسؤول<select data-follow-filter="assigned"><option value="me">متابعاتي</option><option value="team" ${state.query.assigned==='team'?'selected':''}>الفريق ضمن نطاقي</option></select></label>`:''}<button class="btn btn-primary btn-sm" data-follow-apply>تصفية</button></div>${followRows(data)}<div class="btn-row mt-3"><button class="btn btn-ghost" data-prev ${page<=1?'disabled':''}>السابق</button><button class="btn btn-ghost" data-next ${page>=data.pages?'disabled':''}>التالي</button></div><p class="muted">لإضافة متابعة، افتح الطلب واختر «متابعات الطلب».</p>`;
      bindFollowRows(view,data,()=>renderFollowUps(page));
      $('[data-follow-apply]',view).onclick=()=>{ state.query={}; $$('[data-follow-filter]',view).forEach((el)=>{if(el.value)state.query[el.dataset.followFilter]=el.value;});renderFollowUps(); };
      $('[data-prev]',view).onclick=()=>renderFollowUps(page-1);
      $('[data-next]',view).onclick=()=>renderFollowUps(page+1);
    } catch(error) { if(state.section==='followups') { view.innerHTML=`<p class="form-status is-error">${esc(error.message)}</p><button class="btn btn-ghost" data-retry-follow>إعادة المحاولة</button>`; $('[data-retry-follow]',view).onclick=()=>renderFollowUps(page); } }
  }

  /* ---------------- requests ---------------- */
  async function renderRequests(page = 1) {
    const params = new URLSearchParams({ ...state.query, page: String(page) });
    const [data, transferData] = await Promise.all([
      api(`/api/admin/requests?${params}`),
      api('/api/admin/transfers'),
    ]);
    const badge = $('[data-req-count]');
    if (badge) badge.textContent = num(data.total);
    $('#view').innerHTML = `
      ${transferData.transfers.length ? `<div class="admin-card mb-3">
        <div class="admin-card-head"><h2>تحويلات بانتظار رد قسمك</h2><span class="spacer" style="flex:1"></span><span class="badge badge-warn">${num(transferData.transfers.length)}</span></div>
        <div class="admin-card-body" style="padding:0"><table class="admin-table"><thead><tr><th>الطلب</th><th>القسم المطلوب</th><th>موجه إلى</th><th>من</th><th>ملاحظة</th><th>إجراء</th></tr></thead>
          <tbody>${transferData.transfers.map((transfer) => `<tr><td class="ref">${esc(transfer.reference)}</td>
            <td>${esc(transfer.to_department)}</td><td>${esc(transfer.to_user || 'القسم')}</td><td>${esc(transfer.requested_by_name || '—')}</td>
            <td>${esc(transfer.note || '—')}</td><td class="btn-row">${hasPermission('requests:write') ? `<button class="btn btn-primary btn-sm" data-transfer-response="${transfer.id}" data-decision="accept">قبول</button>
            <button class="btn btn-danger btn-sm" data-transfer-response="${transfer.id}" data-decision="reject">رفض</button>` : '—'}</td></tr>`).join('')}</tbody></table>
        </div></div>` : ''}
      <div class="toolbar">
        <select data-filter="assigned" aria-label="إسناد الطلب"><option value="">كل الطلبات المخولة</option><option value="unassigned" ${state.query.assigned === 'unassigned' ? 'selected' : ''}>غير المخصصة</option><option value="me" ${state.query.assigned === 'me' ? 'selected' : ''}>المسندة لي</option></select>
        <select data-filter="type"><option value="">كل الأنواع</option>${Object.entries(data.types || {}).map(([k, t]) => `<option value="${k}" ${state.query.type === k ? 'selected' : ''}>${esc(t.label)}</option>`).join('')}</select>
        <select data-filter="status"><option value="">كل الحالات</option>${Object.entries(data.statuses || {}).map(([k, v]) => `<option value="${k}" ${state.query.status === k ? 'selected' : ''}>${esc(v.label)}</option>`).join('')}</select>
        <input data-filter="q" placeholder="بحث بالمرجع أو الاسم أو الهاتف" value="${esc(state.query.q || '')}">
        <button class="btn btn-ghost btn-sm" data-apply>تصفية</button>
        <span class="spacer"></span>
        <span class="muted" style="font-size:12px">${num(data.total)} طلب · صفحة ${data.page}/${data.pages}</span>
      </div>
      <div class="admin-card"><div class="admin-card-body" style="padding:0">
        <table class="admin-table">
          <thead><tr><th>المرجع</th><th>النوع</th><th>العميل</th><th>الملخص</th><th>الحالة</th><th>الفرع / القسم</th><th>العرض</th><th>الموظف</th><th>التاريخ</th></tr></thead>
          <tbody>${data.requests.length ? data.requests.map((r) => `<tr data-request="${r.id}">
            <td class="ref">${esc(r.reference)}</td>
            <td>${esc(data.types[r.type]?.label || r.type)}</td>
            <td>${esc(r.customer || '—')}<br><small class="muted" dir="ltr">${esc(r.phone || '')}</small></td>
            <td style="max-width:280px">${esc(r.summary || '')}</td>
            <td><span class="status-dot status-${r.status}">${esc(data.statuses[r.status]?.label)}</span></td>
            <td>${esc(r.branch_name || 'غير محدد')}<br><small class="muted">${esc(r.department_name || 'غير محدد')}</small></td>
            <td>${r.quote_amount ? `${num(r.quote_amount)} د.أ` : '—'}</td>
            <td>${esc(r.agent || '—')}</td>
            <td>${dt(r.created_at)}</td></tr>`).join('') : '<tr><td colspan="9" class="muted">لا توجد طلبات مطابقة.</td></tr>'}
          </tbody>
        </table>
      </div></div>
      <div class="toolbar mt-3" style="justify-content:center">
        <button class="btn btn-ghost btn-sm" data-page="${data.page - 1}" ${data.page <= 1 ? 'disabled' : ''}>السابق</button>
        <button class="btn btn-ghost btn-sm" data-page="${data.page + 1}" ${data.page >= data.pages ? 'disabled' : ''}>التالي</button>
      </div>`;
    bindRequestRows();
    $('[data-apply]')?.addEventListener('click', () => {
      state.query = {};
      $$('[data-filter]').forEach((el) => { if (el.value) state.query[el.dataset.filter] = el.value; });
      renderRequests(1);
    });
    $$('[data-page]').forEach((b) => b.addEventListener('click', () => renderRequests(Number(b.dataset.page))));
    $$('[data-transfer-response]').forEach((button) => button.addEventListener('click', async () => {
      try {
        await api(`/api/admin/transfers/${button.dataset.transferResponse}/respond`, {
          method: 'POST',
          body: JSON.stringify({ decision: button.dataset.decision }),
        });
        toast(button.dataset.decision === 'accept' ? 'قُبل التحويل' : 'رُفض التحويل');
        renderRequests(page);
      } catch (error) { toast(error.message, 'bad'); }
    }));
  }

  const FIELD_LABELS = {
    tripType: 'نوع الرحلة', origin: 'من', destination: 'إلى', departDate: 'تاريخ السفر', returnDate: 'تاريخ العودة',
    cabin: 'الدرجة', adults: 'البالغون', children: 'الأطفال', infants: 'الرضّع', baggage: 'الأمتعة', airline: 'شركة الطيران',
    segments: 'المسارات', country: 'الدولة', city: 'المدينة', hotelName: 'الفندق', checkIn: 'الدخول', checkOut: 'الخروج',
    rooms: 'الغرف', stars: 'التصنيف', mealPlan: 'الوجبات', budget: 'الميزانية', specialRequests: 'طلبات خاصة',
    childAges: 'أعمار الأطفال', programSlug: 'البرنامج', optionLabel: 'الخيار', preferredDate: 'التاريخ المفضل', roomType: 'نوع الغرفة',
    nationality: 'الجنسية', residence: 'الإقامة', visaType: 'نوع التأشيرة', purpose: 'الغرض', travelDate: 'تاريخ السفر',
    applicants: 'عدد المتقدمين', previousVisas: 'تأشيرات سابقة', topic: 'نوع الاستشارة', message: 'الرسالة', channel: 'قناة التواصل',
    preferredTime: 'وقت التواصل', name: 'الاسم', phone: 'الهاتف', email: 'البريد', city: 'المدينة', notes: 'ملاحظات', consent: 'الموافقة', hash: 'بصمة الطلب',
  };

  const TYPE_LABELS = { flight: 'تذكرة طيران', hotel: 'حجز فندق', program: 'برنامج سياحي', umrah: 'عمرة', visa: 'تأشيرة', consult: 'استشارة' };
  const STATUS_LABELS = {
    new: 'جديد', reviewing: 'قيد المراجعة', quoted: 'تم إرسال العرض', awaiting: 'في انتظار إعادة الاتصال',
    in_progress: 'قيد المتابعة', confirmed: 'تم التأكيد', cancelled: 'ملغي',
  };

  async function openRequest(id) {
    const data = await api(`/api/admin/requests/${id}`);
    const r = data.request;
    const canWriteRequests = hasPermission('requests:write');
    const statuses = data.statuses || {};
    const dealStages = data.dealStages || {};
    const payload = r.payload || {};
    const branchAgents = data.agents.filter((agent) => !r.branch_id || agent.branch_id === r.branch_id);
    const departmentAgents = branchAgents.filter((agent) => !r.department_id || agent.department_id === r.department_id);
    const ownerOptions = (agents, selected) => `<option value="">غير مسند</option>${selected && !agents.some((agent) => agent.id === selected) ? `<option value="${selected}" selected>المسؤول الحالي</option>` : ''}${agents.map((agent) => `<option value="${agent.id}" ${selected === agent.id ? 'selected' : ''}>${esc(agent.name)}</option>`).join('')}`;
    const rows = Object.entries(payload)
      .filter(([k]) => !['hash', 'userAgent', 'ip'].includes(k))
      .map(([k, v]) => `<dt>${esc(FIELD_LABELS[k] || k)}</dt><dd>${Array.isArray(v) ? v.map((x) => esc(typeof x === 'object' ? JSON.stringify(x) : x)).join('<br>') : esc(v === true ? 'نعم' : v === false ? 'لا' : v)}</dd>`)
      .join('');
    openDrawer(`
      <div class="drawer-head">
        <div><h2>${esc(r.title || '')}</h2><div class="ref">${esc(r.reference)}</div></div>
        <button class="drawer-close" type="button" data-close-drawer aria-label="إغلاق">×</button>
      </div>
      <div class="badge-row mb-2">
        <span class="status-dot status-${r.status}">${esc(statuses[r.status]?.label || r.status)}</span>
        <span class="badge badge-soft">${esc(r.type)}</span>
        ${r.quote_amount ? `<span class="badge badge-gold">عرض: ${num(r.quote_amount)} ${esc(r.quote_currency || 'د.أ')}</span>` : ''}
      </div>
      <p>${esc(r.summary || '')}</p>
      <div class="deal-strip">
        <span class="badge ${r.deal_status === 'won' ? 'badge-ok' : r.deal_status === 'lost' ? 'badge-danger' : r.deal_status === 'in_progress' ? 'badge-warn' : 'badge-soft'}">صفقة: ${esc(dealStages[r.deal_status]?.label || r.deal_status)}</span>
        <span class="deal-metric">أُنشئ: <b>${dt(r.created_at)}</b></span>
        <span class="deal-metric">أول استجابة: <b>${r.responseLabel || '—'}</b></span>
        <span class="deal-metric">مدة الإنجاز: <b>${r.completionLabel || '—'}</b></span>
        ${r.completed_at ? `<span class="deal-metric">أُغلقت: <b>${dt(r.completed_at)}</b></span>` : ''}
      </div>
      <dl class="kv">${rows}</dl>
      <hr>
      ${canWriteRequests ? `<h3>توزيع الطلب تنظيميًا</h3>
      <div class="form-grid">
        <div class="field"><label>الفرع</label><select id="dBranch"><option value="">غير محدد</option>
          ${data.branches.map((branch) => `<option value="${branch.id}" ${r.branch_id === branch.id ? 'selected' : ''}>${esc(branch.name)}</option>`).join('')}</select></div>
        <div class="field"><label>القسم</label><select id="dDepartment"><option value="">غير محدد</option>
          ${data.departments.map((department) => `<option value="${department.id}" ${r.department_id === department.id ? 'selected' : ''}>${esc(department.name)}</option>`).join('')}</select></div>
        <div class="field"><label>مصدر العميل</label><select id="dLeadOrigin">
          ${[['website','الموقع الإلكتروني'],['whatsapp','واتساب'],['phone','اتصال هاتفي'],['email','البريد الإلكتروني'],['branch','زيارة الفرع'],['referral','إحالة'],['other','أخرى']].map(([value,label]) => `<option value="${value}" ${(r.lead_origin || 'website') === value ? 'selected' : ''}>${label}</option>`).join('')}
        </select></div>
      </div>
      <button class="btn btn-ghost btn-sm mt-2" data-save-organization>حفظ التوزيع</button>
      <hr>` : ''}
      ${canWriteRequests ? `<h3>مسؤوليات الصفقة</h3>
      <div class="form-grid">
        <div class="field"><label>مسؤول المبيعات</label><select id="dSalesOwner">${ownerOptions(branchAgents, r.sales_owner_id)}</select></div>
        <div class="field"><label>مسؤول الخدمة</label><select id="dServiceOwner">${ownerOptions(departmentAgents, r.service_owner_id)}</select></div>
        <div class="field"><label>مسؤول التنفيذ</label><select id="dExecutionOwner">${ownerOptions(departmentAgents, r.execution_owner_id)}</select></div>
      </div>
      <button class="btn btn-ghost btn-sm mt-2" data-save-owners>حفظ المسؤوليات</button>
      <hr>` : ''}
      ${canWriteRequests ? `
      <h3>تحديث الحالة</h3>
      <div class="form-grid">
        <div class="field"><label>الحالة الجديدة</label>
          <select id="dStatus">${data.nextStatuses.map((s) => `<option value="${s}">${esc(statuses[s]?.label || s)}</option>`).join('') || '<option value="">لا يوجد انتقال متاح</option>'}</select>
        </div>
        <div class="field"><label>إسناد إلى</label>
          <select id="dAgent"><option value="">بدون إسناد</option>${data.agents.map((a) => `<option value="${a.id}" ${r.assigned_to === a.id ? 'selected' : ''}>${esc(a.name)}${a.department ? ` — ${esc(a.department)}` : ''}</option>`).join('')}</select>
        </div>
        <div class="field"><label>قيمة عرض السعر (د.أ)</label><input id="dQuote" type="number" min="0" step="1" value="${r.quote_amount ?? ''}"></div>
        <div class="field"><label>ملاحظة العرض</label><input id="dQuoteNote" value="${esc(r.quote_note || '')}" placeholder="مثال: شامل الطيران والتأشيرة"></div>
      </div>
      <div class="btn-row mt-2"><button class="btn btn-primary btn-sm" data-save-status ${data.nextStatuses.length ? '' : 'disabled'}>حفظ الحالة</button><button class="btn btn-ghost btn-sm" data-save-quote>حفظ العرض</button><button class="btn btn-ghost btn-sm" data-save-assign>حفظ الإسناد</button></div>
      <hr>` : ''}
      ${canWriteRequests ? `
      <h3>تحويل الطلب إلى قسم آخر</h3>
      <p class="field-hint">تبقى الملكية الحالية حتى يقبل القسم المستلم التحويل.</p>
      <div class="form-grid">
        <div class="field"><label>القسم المستلم</label><select id="dTransferDepartment"><option value="">اختر القسم</option>
          ${data.departments.map((department) => `<option value="${department.id}">${esc(department.name)}</option>`).join('')}</select></div>
        <div class="field"><label>الموظف المستلم (اختياري)</label><select id="dTransferUser"><option value="">القسم بالكامل</option></select></div>
        <div class="field field-full"><label>سبب التحويل</label><input id="dTransferNote" maxlength="1000"></div>
      </div>
      <button class="btn btn-ghost btn-sm mt-2" data-create-transfer>إرسال طلب التحويل</button>` : ''}
      ${data.transfers.length ? `<h3 class="mt-3">سجل التحويلات</h3><ul class="timeline">${data.transfers.map((transfer) => `<li>
        <b>${esc(transfer.from_department || 'غير محدد')} ← ${esc(transfer.to_department)}</b>
        <span>${esc({ pending: 'بانتظار الرد', accepted: 'مقبول', rejected: 'مرفوض', cancelled: 'ملغي' }[transfer.status] || transfer.status)} · ${dt(transfer.created_at)}${transfer.response_note ? ` · ${esc(transfer.response_note)}` : ''}</span>
      </li>`).join('')}</ul>` : ''}
      ${canWriteRequests ? '<hr>' : ''}
      ${canWriteRequests ? `
      <h3>إضافة ملاحظة داخلية</h3>
      <div class="field"><textarea id="dNote" rows="3" placeholder="ملاحظة تظهر للفريق فقط"></textarea></div>
      <button class="btn btn-primary btn-sm mt-2" data-add-note>إضافة الملاحظة</button>` : ''}
      <hr>
      ${hasPermission('tasks:write')?'<button class="btn btn-ghost btn-sm" data-new-linked-task>مهمة مرتبطة بهذا الطلب</button>':''}
      <section id="requestFollowUps" aria-label="متابعات الطلب" aria-live="polite"></section><hr>
      <h3>السجل</h3>
      <ul class="timeline">${data.events.map((e) => `<li><b>${esc(e.message || e.kind)}</b><span>${esc(e.actor_name || 'النظام')} · ${dt(e.created_at)}</span></li>`).join('')}</ul>
      <div class="btn-row mt-2"><button class="btn btn-gold btn-sm" type="button" data-voucher-admin>قسيمة الحجز</button></div>
      ${payload.phone ? `<div class="btn-row mt-3"><a class="btn btn-wa btn-sm" href="https://wa.me/${String(payload.phone).replace(/\D/g, '')}" target="_blank" rel="noopener">واتساب العميل</a><a class="btn btn-ghost btn-sm" href="tel:${esc(payload.phone)}">اتصال</a></div>` : ''}
    `);

    $('[data-new-linked-task]')?.addEventListener('click',()=>openTaskCreate(r));
    loadRequestFollowUps(id);
    const refresh = () => { closeDrawer(); openRequest(id); };
    $('[data-voucher-admin]')?.addEventListener('click', () => {
      if (!window.VoucherGenerator) { toast('وحدة القسيمة لم تُحمّل. أعد تحميل الصفحة.', 'bad'); return; }
      window.VoucherGenerator.open({ request: { ...r, typeLabel: data.types?.[r.type]?.label || r.type, statusLabel: statuses[r.status]?.label || r.status }, lang: 'ar' });
    });
    $('[data-save-organization]')?.addEventListener('click', async () => {
      try {
        await api('/api/admin/requests/' + id, { method: 'PATCH', body: JSON.stringify({
          branchId: $('#dBranch').value || null,
          departmentId: $('#dDepartment').value || null,
          leadOrigin: $('#dLeadOrigin').value,
        }) });
        toast('تم حفظ التوزيع التنظيمي');
        refresh();
      } catch (error) { toast(error.message, 'bad'); }
    });
    $('[data-save-owners]')?.addEventListener('click', async () => {
      try {
        await api('/api/admin/requests/' + id, { method: 'PATCH', body: JSON.stringify({
          salesOwnerId: $('#dSalesOwner').value || null,
          serviceOwnerId: $('#dServiceOwner').value || null,
          executionOwnerId: $('#dExecutionOwner').value || null,
        }) });
        toast('تم حفظ المسؤوليات');
        refresh();
      } catch (error) { toast(error.message, 'bad'); }
    });
    $('#dTransferDepartment')?.addEventListener('change', () => {
      const selectedDepartment = Number($('#dTransferDepartment').value);
      const staff = data.agents.filter((agent) => agent.department_id === selectedDepartment);
      $('#dTransferUser').innerHTML = '<option value="">القسم بالكامل</option>' + staff.map((agent) => '<option value="' + agent.id + '">' + esc(agent.name) + '</option>').join('');
    });
    $('[data-create-transfer]')?.addEventListener('click', async () => {
      const departmentId = $('#dTransferDepartment').value;
      if (!departmentId) return toast('اختر القسم المستلم', 'warn');
      try {
        await api('/api/admin/requests/' + id + '/transfers', {
          method: 'POST', body: JSON.stringify({
            departmentId, userId: $('#dTransferUser').value || null, note: $('#dTransferNote').value,
          }),
        });
        toast('أُرسل طلب التحويل');
        refresh();
      } catch (error) { toast(error.message, 'bad'); }
    });
    $('[data-save-status]')?.addEventListener('click', async () => {
      const status = $('#dStatus').value;
      if (!status) return;
      try { await api(`/api/admin/requests/${id}`, { method: 'PATCH', body: JSON.stringify({ status }) }); toast('تم تحديث الحالة'); refresh(); } catch (e) { toast(e.message, 'bad'); }
    });
    $('[data-save-quote]')?.addEventListener('click', async () => {
      try {
        await api(`/api/admin/requests/${id}`, { method: 'PATCH', body: JSON.stringify({ quoteAmount: $('#dQuote').value, quoteNote: $('#dQuoteNote').value }) });
        toast('تم حفظ عرض السعر'); refresh();
      } catch (e) { toast(e.message, 'bad'); }
    });
    $('[data-save-assign]')?.addEventListener('click', async () => {
      try { await api(`/api/admin/requests/${id}`, { method: 'PATCH', body: JSON.stringify({ assignedTo: $('#dAgent').value || null }) }); toast('تم حفظ الإسناد'); refresh(); } catch (e) { toast(e.message, 'bad'); }
    });
    $('[data-add-note]')?.addEventListener('click', async () => {
      const note = $('#dNote').value.trim();
      if (!note) return;
      try { await api(`/api/admin/requests/${id}`, { method: 'PATCH', body: JSON.stringify({ note }) }); toast('أُضيفت الملاحظة'); refresh(); } catch (e) { toast(e.message, 'bad'); }
    });
  }

  /* ---------------- customers ---------------- */
  async function renderCustomers() {
    const data = await api(`/api/admin/customers${state.query.cq ? `?q=${encodeURIComponent(state.query.cq)}` : ''}`);
    $('#view').innerHTML = `
      <div class="toolbar">
        <input id="cSearch" placeholder="بحث بالاسم أو الهاتف أو البريد" value="${esc(state.query.cq || '')}">
        <button class="btn btn-ghost btn-sm" data-csearch>بحث</button>
        <span class="spacer"></span><span class="muted" style="font-size:12px">${num(data.customers.length)} عميل</span>
      </div>
      <div class="admin-card"><div class="admin-card-body" style="padding:0">
        <table class="admin-table"><thead><tr><th>الاسم</th><th>الهاتف</th><th>البريد</th><th>الطلبات</th><th>آخر طلب</th><th>ملاحظات</th></tr></thead>
        <tbody>${data.customers.length ? data.customers.map((c) => `<tr data-customer="${c.id}">
          <td>${esc(c.name)}</td><td dir="ltr">${esc(c.phone)}</td><td dir="ltr">${esc(c.email || '—')}</td>
          <td>${num(c.n)}</td><td>${day(c.last_request)}</td><td class="muted" style="max-width:220px">${esc(c.notes || '')}</td>
        </tr>`).join('') : '<tr><td colspan="6" class="muted">لا يوجد عملاء بعد.</td></tr>'}</tbody></table>
      </div></div>`;
    $('[data-csearch]')?.addEventListener('click', () => { state.query.cq = $('#cSearch').value.trim(); renderCustomers(); });
    $$('[data-customer]').forEach((row) => row.addEventListener('click', () => openCustomer(Number(row.dataset.customer))));
  }

  async function openCustomer(id) {
    const data = await api(`/api/admin/customers/${id}`);
    const c = data.customer;
    openDrawer(`
      <div class="drawer-head"><div><h2>${esc(c.name)}</h2><div class="ref" dir="ltr">${esc(c.phone)}</div></div><button class="drawer-close" data-close-drawer>×</button></div>
      <dl class="kv"><dt>البريد</dt><dd dir="ltr">${esc(c.email || '—')}</dd><dt>الدولة</dt><dd>${esc(c.country || '—')}</dd><dt>الموافقة</dt><dd>${c.consent ? 'نعم' : 'لا'}</dd><dt>أول تواصل</dt><dd>${dt(c.created_at)}</dd></dl>
      <div class="field"><label>ملاحظات الموظف</label><textarea id="cNotes" rows="4">${esc(c.notes || '')}</textarea></div>
      <div class="field mt-2"><label>تفضيلات العميل</label><input id="cPref" value="${esc(c.preference || '')}" placeholder="مثال: يفضل فنادق قريبة من الحرم"></div>
      <button class="btn btn-primary btn-sm mt-2" data-save-customer>حفظ</button>
      <hr><h3>الطلبات</h3>
      <table class="admin-table"><thead><tr><th>المرجع</th><th>النوع</th><th>الحالة</th><th>الملخص</th></tr></thead>
      <tbody>${data.requests.map((r) => `<tr data-request="${r.id}"><td class="ref">${esc(r.reference)}</td><td>${esc(TYPE_LABELS[r.type] || r.type)}</td><td>${esc(STATUS_LABELS[r.status] || r.status)}</td><td>${esc(r.summary || '')}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">لا طلبات</td></tr>'}</tbody></table>
    `);
    $('[data-save-customer]')?.addEventListener('click', async () => {
      try {
        await api(`/api/admin/customers/${id}`, { method: 'PATCH', body: JSON.stringify({ notes: $('#cNotes').value, preference: $('#cPref').value }) });
        toast('تم الحفظ');
      } catch (e) { toast(e.message, 'bad'); }
    });
    bindRequestRows();
  }

  /* ---------------- programs ---------------- */
  const PROGRAM_FIELDS = [
    { key: 'title', label: 'العنوان', full: true },
    { key: 'slug', label: 'المعرّف في الرابط (slug)', hint: 'يُنشأ تلقائيًا إذا تُرك فارغًا' },
    { key: 'category', label: 'القسم', type: 'select', options: [['umrah', 'الحج والعمرة'], ['cruise', 'رحلات الكروز'], ['sharm', 'شرم الشيخ'], ['istanbul', 'إسطنبول']] },
    { key: 'level', label: 'المستوى', type: 'select', options: [['', 'غير محدد'], ['eco', 'اقتصادي'], ['3', 'ثلاث نجوم'], ['4', 'أربع نجوم'], ['5', 'خمس نجوم']] },
    { key: 'status', label: 'الحالة', type: 'select', options: [['published', 'منشور'], ['draft', 'مسودة'], ['sold_out', 'نفدت المقاعد'], ['archived', 'مؤرشف']] },
    { key: 'summary', label: 'ملخص قصير', full: true },
    { key: 'days', label: 'الأيام', type: 'number' },
    { key: 'nights', label: 'الليالي', type: 'number' },
    { key: 'priceFrom', label: 'السعر يبدأ من', type: 'number' },
    { key: 'artKey', label: 'الرسم', type: 'select', options: [['haram', 'الحرم'], ['madinah', 'المدينة'], ['istanbul', 'إسطنبول'], ['beach', 'شاطئ'], ['cruise', 'سفينة'], ['plane', 'طائرة'], ['hotel', 'فندق'], ['desert', 'صحراء'], ['cairo', 'القاهرة'], ['europe', 'أوروبا'], ['asia', 'آسيا'], ['gulf', 'الخليج']] },
    { key: 'destination', label: 'الوجهة' },
    { key: 'country', label: 'الدولة' },
    { key: 'meals', label: 'الوجبات' },
    { key: 'airline', label: 'شركة الطيران' },
    { key: 'departureDates', label: 'مواعيد المغادرة', full: true },
    { key: 'hotels', label: 'الفنادق', type: 'list', rows: 4, hint: 'سطر لكل فندق: المدينة | الاسم | النجوم | المسافة' },
    { key: 'options', label: 'خيارات الأسعار', type: 'list', rows: 5, hint: 'سطر لكل خيار: الوصف | السعر' },
    { key: 'itinerary', label: 'خط السير', type: 'list', rows: 6, hint: 'سطر لكل يوم بالترتيب' },
    { key: 'includes', label: 'المشمول', type: 'list', rows: 5 },
    { key: 'excludes', label: 'غير المشمول', type: 'list', rows: 5 },
    { key: 'terms', label: 'الشروط', type: 'list', rows: 4 },
    { key: 'flights', label: 'الرحلات الجوية', type: 'list', rows: 4 },
    { key: 'badges', label: 'الشارات', type: 'list', rows: 2 },
    { key: 'description', label: 'وصف داخلي', type: 'textarea', rows: 3 },
  ];

  async function renderPrograms() {
    const data = await api('/api/admin/programs');
    const items = data.items;
    $('#view').innerHTML = `
      <div class="toolbar">
        <button class="btn btn-primary btn-sm" data-new-program>+ برنامج جديد</button>
        <span class="spacer"></span>
        <span class="muted" style="font-size:12px">${num(items.length)} برنامج</span>
      </div>
      <div class="admin-card"><div class="admin-card-body" style="padding:0">
        <table class="admin-table"><thead><tr><th>العنوان</th><th>القسم</th><th>السعر</th><th>الحالة</th><th>مميز</th><th>تعديل</th></tr></thead>
        <tbody>${items.map((p) => `<tr>
          <td><b>${esc(p.title)}</b><br><small class="muted" dir="ltr">${esc(p.slug)}</small></td>
          <td>${esc(p.category)}</td><td>${p.price_from ? `${num(p.price_from)} ${esc(p.currency)}` : '—'}</td>
          <td><span class="badge ${p.status === 'published' ? 'badge-ok' : p.status === 'sold_out' ? 'badge-danger' : 'badge-line'}">${esc({ published: 'منشور', draft: 'مسودة', sold_out: 'نفدت', archived: 'مؤرشف' }[p.status] || p.status)}</span></td>
          <td>${p.featured ? '★' : '—'}</td>
          <td class="btn-row"><button class="btn btn-ghost btn-sm" data-edit-program="${p.id}">تعديل</button><button class="btn btn-danger btn-sm" data-del-program="${p.id}">حذف</button></td>
        </tr>`).join('')}</tbody></table>
      </div></div>`;
    $('[data-new-program]')?.addEventListener('click', () => openProgramForm(null));
    $$('[data-edit-program]').forEach((b) => b.addEventListener('click', () => openProgramForm(items.find((p) => p.id === Number(b.dataset.editProgram)))));
    $$('[data-del-program]').forEach((b) => b.addEventListener('click', async () => {
      if (!confirm('حذف أو أرشفة هذا البرنامج؟')) return;
      try { const r = await api(`/api/admin/programs/${b.dataset.delProgram}`, { method: 'DELETE' }); toast(r.message || 'تم'); renderPrograms(); } catch (e) { toast(e.message, 'bad'); }
    }));
  }

  function fieldControl(field, value) {
    const id = `ff-${field.key}`;
    if (field.type === 'select') {
      return `<select id="${id}" data-key="${field.key}">${field.options.map(([v, l]) => `<option value="${v}" ${String(v) === String(value ?? '') ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
    }
    if (field.type === 'textarea') return `<textarea id="${id}" data-key="${field.key}" rows="${field.rows || 4}">${esc(value ?? '')}</textarea>`;
    if (field.type === 'list') return `<textarea id="${id}" data-key="${field.key}" rows="${field.rows || 4}">${esc(Array.isArray(value) ? value.map((v) => (typeof v === 'object' ? (field.key === 'hotels' ? `${v.city} | ${v.name} | ${v.stars || 0} | ${v.distance || ''}` : `${v.label} | ${v.price}`) : v)).join('\n') : (value || ''))}</textarea>`;
    return `<input id="${id}" data-key="${field.key}" type="${field.type || 'text'}" value="${esc(value ?? '')}"${field.datalist ? ' list="mediaList"' : ''}>`;
  }

  function openProgramForm(program) {
    const p = program || { category: 'umrah', status: 'published', artKey: 'haram', currency: 'د.أ' };
    openDrawer(`
      <div class="drawer-head"><div><h2>${program ? 'تعديل برنامج' : 'برنامج جديد'}</h2></div><button class="drawer-close" data-close-drawer>×</button></div>
      <form id="programForm" class="stack">
        <div class="form-grid">
          ${PROGRAM_FIELDS.map((f) => `<div class="field ${f.full ? 'field-full' : ''}">
            <label for="ff-${f.key}">${esc(f.label)}</label>
            ${fieldControl(f, p[f.key])}
            ${f.hint ? `<span class="field-hint">${esc(f.hint)}</span>` : ''}
          </div>`).join('')}
        </div>
        <div class="check"><label class="check"><input type="checkbox" id="ff-featured" ${p.featured ? 'checked' : ''}> <span>برنامج مميز (يظهر في الرئيسية)</span></label></div>
        <p class="form-status is-error" data-form-error></p>
        <div class="btn-row"><button class="btn btn-primary" type="submit">حفظ</button><button class="btn btn-ghost" type="button" data-close-drawer>إلغاء</button></div>
      </form>
    `);
    $('#programForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const body = {};
      PROGRAM_FIELDS.forEach((f) => {
        const el = $(`[data-key="${f.key}"]`);
        if (!el) return;
        if (f.type === 'list') body[f.key] = el.value.split('\n').map((s) => s.trim()).filter(Boolean);
        else if (f.type === 'number') body[f.key] = el.value === '' ? null : Number(el.value);
        else body[f.key] = el.value.trim();
      });
      body.featured = $('#ff-featured').checked;
      try {
        if (program) await api(`/api/admin/programs/${program.id}`, { method: 'PATCH', body: JSON.stringify(body) });
        else await api('/api/admin/programs', { method: 'POST', body: JSON.stringify(body) });
        closeDrawer();
        toast('تم الحفظ');
        renderPrograms();
      } catch (err) {
        $('[data-form-error]').textContent = err.message;
      }
    });
  }

  /* ---------------- generic content resources ---------------- */
  const CONTENT = {
    offers: {
      label: 'العروض', titleKey: 'title', fields: [
        { key: 'title', label: 'عنوان العرض', full: true },
        { key: 'slug', label: 'slug' },
        { key: 'category', label: 'التصنيف', type: 'select', options: [['turkey', 'تركيا'], ['egypt', 'مصر'], ['georgia', 'جورجيا'], ['umrah', 'الحج والعمرة'], ['cruise', 'رحلات الكروز'], ['visa', 'التأشيرات']] },
        { key: 'priceFrom', label: 'السعر يبدأ من', type: 'number' },
        { key: 'days', label: 'الأيام', type: 'number' },
        { key: 'nights', label: 'الليالي', type: 'number' },
        { key: 'imageUrl', label: 'صورة البوستر', datalist: true, full: true, hint: 'اختر من مكتبة البوسترات أو الصق رابطًا. الصورة الرأسية 4:5 هي الأفضل.' },
        { key: 'imageAlt', label: 'وصف الصورة (لكبار المساعدة)', full: true },
        { key: 'body', label: 'وصف العرض', type: 'textarea', rows: 3, full: true },
        { key: 'includes', label: 'يشمل', type: 'list', rows: 5 },
        { key: 'sort', label: 'الترتيب', type: 'number' },
        { key: 'featured', label: 'مميز في الرئيسية', type: 'select', options: [['0', 'لا'], ['1', 'نعم']] },
        { key: 'validUntil', label: 'صالحة حتى (اختياري)', type: 'date' },
      ], toggle: ['active', 'مفعّل'],
    },
    news: {
      label: 'أخبار الطيران', titleKey: 'title', fields: [
        { key: 'title', label: 'العنوان', full: true }, { key: 'airline', label: 'شركة الطيران' },
        { key: 'publishedAt', label: 'التاريخ', type: 'date' }, { key: 'body', label: 'النص', type: 'textarea', rows: 6 },
      ], toggle: ['urgent', 'عاجل'],
    },
    articles: {
      label: 'مقالات الدليل', titleKey: 'title', fields: [
        { key: 'title', label: 'العنوان', full: true }, { key: 'slug', label: 'slug' },
        { key: 'category', label: 'التصنيف' }, { key: 'readingMinutes', label: 'دقائق القراءة', type: 'number' },
        { key: 'excerpt', label: 'مقتطف', full: true, type: 'textarea', rows: 2 },
        { key: 'body', label: 'المحتوى (Markdown)', type: 'textarea', rows: 10 }, { key: 'tags', label: 'كلمات مفتاحية', type: 'list', rows: 2 },
      ],
    },
    faq: {
      label: 'الأسئلة الشائعة', titleKey: 'question', fields: [
        { key: 'question', label: 'السؤال', full: true }, { key: 'answer', label: 'الجواب', type: 'textarea', rows: 5 },
        { key: 'category', label: 'التصنيف', type: 'select', options: [['general', 'عام'], ['visa', 'تأشيرات'], ['umrah', 'عمرة'], ['flights', 'طيران'], ['hotels', 'فنادق']] },
        { key: 'sort', label: 'الترتيب', type: 'number' },
      ],
    },
    destinations: {
      label: 'الوجهات', titleKey: 'name', fields: [
        { key: 'name', label: 'الاسم' }, { key: 'slug', label: 'slug' },
        { key: 'kind', label: 'النوع', type: 'select', options: [['city', 'مدينة'], ['country', 'دولة']] },
        { key: 'parentSlug', label: 'الدولة (slug)' }, { key: 'bestTime', label: 'أفضل وقت' },
        { key: 'summary', label: 'الوصف', type: 'textarea', rows: 4, full: true },
        { key: 'highlights', label: 'أبرز المعالم', type: 'list', rows: 4 },
        { key: 'mapUrl', label: 'رابط الخريطة', full: true },
      ],
    },
    reviews: {
      label: 'المراجعات', titleKey: 'name', fields: [
        { key: 'name', label: 'الاسم' }, { key: 'branch', label: 'الفرع' },
        { key: 'rating', label: 'التقييم', type: 'select', options: [['5', '★★★★★'], ['4', '★★★★'], ['3', '★★★'], ['2', '★★'], ['1', '★']] },
        { key: 'text', label: 'نص المراجعة', type: 'textarea', rows: 4, full: true },
        { key: 'source', label: 'المصدر' }, { key: 'publishedAt', label: 'التاريخ', type: 'date' },
      ], toggle: ['visible', 'ظاهرة'],
    },
  };

  const VISA_FIELDS = [
    { key: 'destination', label: 'الوجهة' }, { key: 'purpose', label: 'الغرض' },
    { key: 'summary', label: 'الملخص', type: 'textarea', rows: 5, full: true },
    { key: 'docs', label: 'المستندات', type: 'list', rows: 6 }, { key: 'notes', label: 'ملاحظات', type: 'list', rows: 4 },
    { key: 'sourceName', label: 'اسم المصدر' }, { key: 'sourceUrl', label: 'رابط المصدر', full: true },
    { key: 'lastVerified', label: 'آخر تحقق', type: 'date' },
  ];
  const KB_FIELDS = [
    { key: 'title', label: 'العنوان', full: true },
    { key: 'body', label: 'المحتوى', type: 'textarea', rows: 8, full: true },
    { key: 'category', label: 'التصنيف', type: 'select', options: [['policy', 'سياسة'], ['umrah', 'عمرة'], ['hotels', 'فنادق'], ['general', 'عام']] },
    { key: 'tags', label: 'كلمات', type: 'list', rows: 2 },
  ];

  async function renderContent() {
    const tabs = Object.entries(CONTENT);
    const current = state.contentTab || 'offers';
    const data = await api(`/api/admin/${current}`);
    $('#view').innerHTML = `
      <div class="tabs">${tabs.map(([k, v]) => `<button data-ctab="${k}" class="${current === k ? 'is-active' : ''}">${esc(v.label)}</button>`).join('')}</div>
      <div class="toolbar"><button class="btn btn-primary btn-sm" data-new-content>+ إضافة</button><span class="spacer"></span><span class="muted" style="font-size:12px">${num(data.items.length)} عنصر</span></div>
      <div class="admin-card"><div class="admin-card-body" style="padding:0">
        <table class="admin-table"><thead><tr><th>العنوان</th><th>تفاصيل</th><th>الحالة</th><th></th></tr></thead>
        <tbody>${data.items.map((it) => {
          const spec = CONTENT[current];
          const title = it[spec.titleKey] || it.title || it.name || it.question || '—';
          const extra = [
            current === 'reviews' && it.rating ? '★'.repeat(Math.max(0, Math.min(5, Number(it.rating)))) : '',
            it.valid_until ? `حتى ${it.valid_until}` : '', it.published_at || '', it.category || '', it.branch || '', it.last_verified || '',
          ].filter(Boolean).join(' · ');
          const status = spec.toggle ? (it[spec.toggle[0]] ? spec.toggle[1] : 'معطّل') : (it.status || (it.published ? 'منشور' : 'مسودة'));
          return `<tr><td><b>${esc(title)}</b></td><td class="muted">${esc(extra)}</td><td>${esc(status)}</td>
            <td class="btn-row"><button class="btn btn-ghost btn-sm" data-edit-content="${it.id}">تعديل</button><button class="btn btn-danger btn-sm" data-del-content="${it.id}">حذف</button></td></tr>`;
        }).join('') || '<tr><td colspan="4" class="muted">لا عناصر</td></tr>'}</tbody></table>
      </div></div>`;
    $$('[data-ctab]').forEach((b) => b.addEventListener('click', () => { state.contentTab = b.dataset.ctab; renderContent(); }));
    $('[data-new-content]')?.addEventListener('click', () => openContentForm(current, null, data.items));
    $$('[data-edit-content]').forEach((b) => b.addEventListener('click', () => openContentForm(current, data.items.find((i) => i.id === Number(b.dataset.editContent)), data.items)));
    $$('[data-del-content]').forEach((b) => b.addEventListener('click', async () => {
      if (!confirm('تأكيد الحذف؟')) return;
      try { await api(`/api/admin/${current}/${b.dataset.delContent}`, { method: 'DELETE' }); toast('تم الحذف'); renderContent(); } catch (e) { toast(e.message, 'bad'); }
    }));
  }

  function openContentForm(resource, item, items) {
    const spec = CONTENT[resource];
    openDrawer(`
      <div class="drawer-head"><div><h2>${item ? 'تعديل' : 'إضافة'} — ${esc(spec.label)}</h2></div><button class="drawer-close" data-close-drawer>×</button></div>
      <form id="contentForm" class="stack"><div class="form-grid">
        ${spec.fields.map((f) => `<div class="field ${f.full ? 'field-full' : ''}"><label for="cf-${f.key}">${esc(f.label)}</label>${fieldControl(f, item?.[f.key])}</div>`).join('')}
      </div>
      ${spec.toggle ? `<label class="check"><input type="checkbox" id="cf-toggle" ${item?.[spec.toggle[0]] ? 'checked' : ''}><span>${esc(spec.toggle[1])}</span></label>` : ''}
      <p class="form-status is-error" data-form-error></p>
      <div class="btn-row"><button class="btn btn-primary" type="submit">حفظ</button><button class="btn btn-ghost" type="button" data-close-drawer>إلغاء</button></div></form>`);
    $('#contentForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const body = {};
      spec.fields.forEach((f) => {
        const el = $(`[data-key="${f.key}"]`);
        if (!el) return;
        if (f.type === 'list') body[f.key] = el.value.split('\n').map((s) => s.trim()).filter(Boolean);
        else if (f.type === 'number') body[f.key] = el.value === '' ? null : Number(el.value);
        else body[f.key] = el.value.trim();
      });
      if (spec.toggle) body[spec.toggle[0]] = $('#cf-toggle').checked;
      if (resource === 'visa') body.requiresVerification = true;
      if (resource === 'destinations') body.published = true;
      try {
        if (item) await api(`/api/admin/${resource}/${item.id}`, { method: 'PATCH', body: JSON.stringify(body) });
        else await api(`/api/admin/${resource}`, { method: 'POST', body: JSON.stringify(body) });
        closeDrawer(); toast('تم الحفظ'); renderContent();
      } catch (err) { $('[data-form-error]').textContent = err.message; }
    });

    if (resource === 'offers') {
      api('/api/admin/media').then((media) => {
        const datalist = document.createElement('datalist');
        datalist.id = 'mediaList';
        datalist.innerHTML = media.files.map((f) => `<option value="${esc(f)}"></option>`).join('');
        $('#contentForm').append(datalist);
      }).catch(() => {});
    }
  }

  async function renderResource(kind) {
    const fields = kind === 'visa' ? VISA_FIELDS : KB_FIELDS;
    const data = await api(`/api/admin/${kind}`);
    const titleKey = kind === 'visa' ? 'destination' : 'title';
    $('#view').innerHTML = `
      <div class="toolbar"><button class="btn btn-primary btn-sm" data-new>+ إضافة</button><span class="spacer"></span><span class="muted" style="font-size:12px">${num(data.items.length)} عنصر</span></div>
      <div class="admin-card"><div class="admin-card-body" style="padding:0">
        <table class="admin-table"><thead><tr><th>${kind === 'visa' ? 'الوجهة' : 'العنوان'}</th><th>معلومات</th><th></th></tr></thead>
        <tbody>${data.items.map((it) => `<tr><td><b>${esc(it[titleKey])}</b></td>
          <td class="muted">${esc(kind === 'visa' ? `${it.purpose || ''} · آخر تحقق ${it.last_verified || '—'}` : `${it.category || ''} · ${(it.body || '').slice(0, 80)}…`)}</td>
          <td class="btn-row"><button class="btn btn-ghost btn-sm" data-edit="${it.id}">تعديل</button><button class="btn btn-danger btn-sm" data-del="${it.id}">حذف</button></td></tr>`).join('') || '<tr><td colspan="3" class="muted">لا عناصر</td></tr>'}</tbody></table>
      </div></div>`;
    $('[data-new]')?.addEventListener('click', () => openResourceForm(kind, fields, null));
    $$('[data-edit]').forEach((b) => b.addEventListener('click', () => openResourceForm(kind, fields, data.items.find((i) => i.id === Number(b.dataset.edit)))));
    $$('[data-del]').forEach((b) => b.addEventListener('click', async () => {
      if (!confirm('تأكيد الحذف؟')) return;
      try { await api(`/api/admin/${kind}/${b.dataset.del}`, { method: 'DELETE' }); toast('تم الحذف'); renderResource(kind); } catch (e) { toast(e.message, 'bad'); }
    }));
  }

  function openResourceForm(kind, fields, item) {
    openDrawer(`
      <div class="drawer-head"><div><h2>${item ? 'تعديل' : 'إضافة'}</h2></div><button class="drawer-close" data-close-drawer>×</button></div>
      <form id="resourceForm" class="stack"><div class="form-grid">
        ${fields.map((f) => `<div class="field ${f.full ? 'field-full' : ''}"><label for="cf-${f.key}">${esc(f.label)}</label>${fieldControl(f, item?.[f.key])}</div>`).join('')}
      </div><p class="form-status is-error" data-form-error></p>
      <div class="btn-row"><button class="btn btn-primary" type="submit">حفظ</button><button class="btn btn-ghost" type="button" data-close-drawer>إلغاء</button></div></form>`);
    $('#resourceForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const body = {};
      fields.forEach((f) => {
        const el = $(`[data-key="${f.key}"]`);
        if (!el) return;
        if (f.type === 'list') body[f.key] = el.value.split('\n').map((s) => s.trim()).filter(Boolean);
        else body[f.key] = el.value.trim();
      });
      try {
        if (item) await api(`/api/admin/${kind}/${item.id}`, { method: 'PATCH', body: JSON.stringify(body) });
        else await api(`/api/admin/${kind}`, { method: 'POST', body: JSON.stringify(body) });
        closeDrawer(); toast('تم الحفظ'); renderResource(kind);
      } catch (err) { $('[data-form-error]').textContent = err.message; }
    });
  }

  /* ---------------- users / settings / audit / assistant ---------------- */
  async function renderUsers() {
    const data = await api("/api/admin/users");
    $("#view").innerHTML = `
      <div class="toolbar"><button class="btn btn-primary btn-sm" data-new-user>+ موظف جديد</button></div>
      <div class="admin-card"><div class="admin-card-body" style="padding:0">
        <table class="admin-table"><thead><tr><th>الاسم</th><th>اسم الدخول</th><th>الدور</th><th>الفرع / القسم</th><th>آخر دخول</th><th>نشط</th><th></th></tr></thead>
        <tbody>${data.users
          .map(
            (
              u,
            ) => `<tr><td><b>${esc(u.name)}</b></td><td dir="ltr">${esc(u.username)}</td>
          <td>${esc(u.role_name || { admin: 'مدير', manager: 'مدير قسم', agent: 'موظف' }[u.role] || u.role)}</td>
          <td>${esc([u.branch_name, u.department_name || u.department].filter(Boolean).join(' · ') || '—')}</td><td>${dt(u.last_login_at)}</td><td>${u.active ? "✓" : "✕"}</td>
          <td class="btn-row"><button class="btn btn-ghost btn-sm" data-user-profile="${u.id}">الملف الوظيفي</button><button class="btn btn-ghost btn-sm" data-user-memberships="${u.id}">تفويضات العمل</button><button class="btn btn-ghost btn-sm" data-edit-user="${u.id}">تعديل</button>
          ${u.active ? `<button class="btn btn-danger btn-sm" data-toggle-user="${u.id}" data-active="0">تعطيل</button>` : `<button class="btn btn-ghost btn-sm" data-toggle-user="${u.id}" data-active="1">تنشيط</button>`}</td></tr>`,
          )
          .join("")}</tbody></table>
      </div></div>`;
    $$("[data-user-profile]").forEach(
      (button) =>
        (button.onclick = () =>
          openEmployeeProfile(Number(button.dataset.userProfile), data)),
    );
    $$("[data-user-memberships]").forEach(
      (button) =>
        (button.onclick = () =>
          openMemberships(Number(button.dataset.userMemberships), data)),
    );
    $('[data-new-user]')?.addEventListener('click', () => openUserForm(null, data));
    $$('[data-edit-user]').forEach((b) => b.addEventListener('click', () => openUserForm(data.users.find((u) => u.id === Number(b.dataset.editUser)), data)));
    $$('[data-toggle-user]').forEach((b) => b.addEventListener('click', async () => {
      try { await api(`/api/admin/users/${b.dataset.toggleUser}`, { method: 'PATCH', body: JSON.stringify({ active: b.dataset.active === '1' }) }); toast('تم'); renderUsers(); } catch (e) { toast(e.message, 'bad'); }
    }));
  }

  async function openEmployeeProfile(id, organization) {
    try {
      const { profile } = await api(`/api/admin/users/${id}/profile`);
      openDrawer(
        `<div class="drawer-head"><h2>الملف الوظيفي</h2><button data-close-drawer>×</button></div><form id="employeeProfile" class="stack"><label>الرقم الوظيفي<input name="employee_no" value="${esc(profile.employee_no)}" required maxlength="40"></label><label>المسمى<input name="job_title" value="${esc(profile.job_title)}" maxlength="100"></label><label>البريد المهني<input name="email" type="email" value="${esc(profile.email)}"></label><label>تاريخ التعيين<input name="hire_date" type="date" value="${esc(profile.hire_date || "")}"></label><label>المدير المباشر<select name="manager_id"><option value="">غير محدد</option>${organization.users
          .filter((u) => u.id !== id)
          .map(
            (u) =>
              `<option value="${u.id}" ${u.id === profile.manager_id ? "selected" : ""}>${esc(u.name)}</option>`,
          )
          .join(
            "",
          )}</select></label><label>سبب التعديل<textarea name="reason" required minlength="3" maxlength="500"></textarea></label><p class="form-status is-error"></p><button class="btn btn-primary">حفظ</button></form>`,
      );
      $("#employeeProfile").onsubmit = async (event) => {
        event.preventDefault();
        const button = event.target.querySelector("button");
        button.disabled = true;
        try {
          const body = Object.fromEntries(new FormData(event.target));
          body.manager_id = body.manager_id ? Number(body.manager_id) : null;
          await api(`/api/admin/users/${id}/profile`, {
            method: "PATCH",
            body: JSON.stringify(body),
          });
          closeDrawer();
          await renderUsers();
        } catch (error) {
          $(".form-status", event.target).textContent = error.message;
        } finally {
          button.disabled = false;
        }
      };
    } catch (error) {
      toast(error.message, "bad");
    }
  }
  async function openMemberships(id, organization) {
    try {
      const { memberships } = await api(`/api/admin/users/${id}/memberships`);
      openDrawer(
        `<div class="drawer-head"><h2>تفويضات العمل</h2><button data-close-drawer>×</button></div><p>كل تفويض يحدد جهة عمل وصلاحيات مستقلة. يتغير الوصول فور الإلغاء، ويلزم تسجيل الدخول مجددًا بعد أي تعديل.</p><ul>${memberships.map((m) => `<li>${esc([m.branch_name, m.department_name, m.role_name].filter(Boolean).join(" — "))} — ${m.is_primary ? "أساسي" : m.active ? "فعال" : "معطل"} ${m.is_primary ? "" : `<button type="button" data-member-id="${m.id}" data-next-active="${m.active ? "0" : "1"}">${m.active ? "تعطيل" : "تفعيل"}</button>`}</li>`).join("")}</ul><form id="membershipForm" class="stack"><label>الفرع<select name="branchId" required>${organization.branches.map((b) => `<option value="${b.id}">${esc(b.name)}</option>`).join("")}</select></label><label>القسم<select name="departmentId"><option value="">غير محدد</option>${organization.departments.map((d) => `<option value="${d.id}">${esc(d.name)}</option>`).join("")}</select></label><label>الدور<select name="roleKey" required>${organization.roles
          .filter((r) => r.data_scope !== "organization")
          .map(
            (r) => `<option value="${esc(r.role_key)}">${esc(r.name)}</option>`,
          )
          .join(
            "",
          )}</select></label><label>سبب التفويض<textarea name="reason" required minlength="3" maxlength="500"></textarea></label><p class="form-status is-error"></p><button class="btn btn-primary">إضافة تفويض</button></form>`,
      );
      $$("[data-member-id]").forEach(
        (button) =>
          (button.onclick = async () => {
            const reason = prompt("سبب تعديل التفويض");
            if (!reason) return;
            button.disabled = true;
            try {
              await api(
                `/api/admin/users/${id}/memberships/${button.dataset.memberId}`,
                {
                  method: "PATCH",
                  body: JSON.stringify({
                    active: button.dataset.nextActive === "1",
                    reason,
                  }),
                },
              );
              closeDrawer();
              await renderUsers();
            } catch (error) {
              toast(error.message, "bad");
              button.disabled = false;
            }
          }),
      );
      $("#membershipForm").onsubmit = async (event) => {
        event.preventDefault();
        const button = event.target.querySelector("button");
        button.disabled = true;
        try {
          await api(`/api/admin/users/${id}/memberships`, {
            method: "POST",
            body: JSON.stringify(
              Object.fromEntries(new FormData(event.target)),
            ),
          });
          closeDrawer();
          await renderUsers();
        } catch (error) {
          $(".form-status", event.target).textContent = error.message;
        } finally {
          button.disabled = false;
        }
      };
    } catch (error) {
      toast(error.message, "bad");
    }
  }

  function openUserForm(user, organization) {
    openDrawer(`
      <div class="drawer-head"><div><h2>${user ? "تعديل موظف" : "موظف جديد"}</h2></div><button class="drawer-close" data-close-drawer>×</button></div>
      <form id="userForm" class="stack">
        <div class="form-grid">
          <div class="field"><label>الاسم</label><input data-key="name" value="${esc(user?.name || '')}"></div>
          ${user ? '' : '<div class="field"><label>اسم المستخدم</label><input data-key="username" dir="auto" required maxlength="32" aria-describedby="username-help"><small id="username-help">من 3 إلى 32 حرفًا عربيًا أو إنجليزيًا أو رقمًا. يمكن استخدام . و _ و - دون مسافات. مثال: أحمد_01</small></div>'}
          <div class="field"><label>الدور الأساسي</label><select data-key="role">${[['agent', 'موظف'], ['manager', 'مدير قسم'], ['admin', 'مدير']].map(([v, l]) => `<option value="${v}" ${user?.role === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
          <div class="field"><label>قالب الصلاحيات</label><select data-key="roleKey"><option value="">استخدم صلاحيات الدور الأساسي</option>
            ${organization.roles.map((role) => `<option value="${esc(role.role_key)}" ${user?.role_key === role.role_key ? 'selected' : ''}>${esc(role.name)}</option>`).join('')}</select></div>
          <div class="field"><label>الفرع</label><select data-key="branchId"><option value="">غير محدد</option>
            ${organization.branches.map((branch) => `<option value="${branch.id}" ${String(user?.branch_id || '') === String(branch.id) ? 'selected' : ''}>${esc(branch.name)}</option>`).join('')}</select></div>
          <div class="field"><label>القسم</label><select data-key="departmentId"><option value="">غير محدد</option>
            ${organization.departments.map((department) => `<option value="${department.id}" ${String(user?.department_id || '') === String(department.id) ? 'selected' : ''}>${esc(department.name)}${department.branch_id ? ' — مرتبط بفرع' : ''}</option>`).join('')}</select></div>
          <div class="field"><label>${user ? "كلمة مرور جديدة (اختياري)" : "كلمة المرور"}</label><input data-key="password" type="password" dir="ltr" autocomplete="new-password"></div>
        </div>
        <p class="field-hint">12–128 حرفًا. يمكن استخدام عبارة مرور عربية طويلة. الموظف مطالب بتغييرها عند أول دخول.</p>
        <p class="form-status is-error" data-form-error></p>
        <div class="btn-row"><button class="btn btn-primary" type="submit">حفظ</button><button class="btn btn-ghost" type="button" data-close-drawer>إلغاء</button></div>
      </form>`);
    $('#userForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const body = {};
      $$('[data-key]', e.target).forEach((el) => {
        if (el.dataset.key === 'password' && !el.value) return;
        if (el.dataset.key === 'departmentId' || el.dataset.key === 'branchId' || el.dataset.key === 'roleKey') body[el.dataset.key] = el.value || null;
        else if (el.value) body[el.dataset.key] = el.value;
      });
      try {
        if (user) await api(`/api/admin/users/${user.id}`, { method: 'PATCH', body: JSON.stringify(body) });
        else await api('/api/admin/users', { method: 'POST', body: JSON.stringify(body) });
        closeDrawer(); toast('تم الحفظ'); renderUsers();
      } catch (err) { $('[data-form-error]').textContent = err.message; }
    });
  }

  /* ---------------- organization and access profiles ---------------- */
  async function renderOrganization() {
    const data = await api("/api/admin/organization");
    const scopeLabels = { organization: 'كل المؤسسة', branch: 'الفرع', department: 'القسم', assigned: 'الطلبات المسندة' };
    const permissionLabels = {
      "tasks:read":"عرض المهام", "tasks:write":"إنشاء وتحديث المهام", "tasks:assign":"إسناد المهام للغير",
      "overview:read": "نظرة عامة",
      "requests:read": "عرض الطلبات",
      "requests:write": "تحديث الطلبات",
      "customers:read": "عرض العملاء",
      "customers:write": "تعديل العملاء",
      "programs:read": "عرض البرامج",
      "programs:write": "إدارة البرامج",
      "content:write": "إدارة المحتوى",
      "visa:write": "إدارة التأشيرات",
      "kb:write": "قاعدة المعرفة",
      "audit:read": "سجل العمليات",
      "reports:read": "التقارير",
      "requests:assign": "إسناد الطلبات",
      "requests:transfer": "تحويل الطلبات",
      "requests:approve": "اعتماد التأكيد",
      "reports:export": "تصدير التقارير",
      "audit:export": "تصدير سجل التدقيق",
      "programs:delete": "حذف البرامج المسموح",
      "content:delete": "حذف المحتوى",
      "visa:delete": "حذف محتوى التأشيرات",
      "kb:delete": "حذف المعرفة",
      "users:admin": "إدارة صلاحيات المسؤولين",
      "users:write": "إدارة الموظفين",
      "settings:write": "الإعدادات",
      "organization:read": "عرض الهيكل التنظيمي",
      "organization:write": "إدارة الهيكل والأدوار",
    };
    $("#view").innerHTML = `
      <div class="admin-card mb-3">
        <div class="admin-card-head"><h2>الفروع والأقسام</h2></div>
        <div class="admin-card-body"><div id="unitControls"></div>
          <div class="form-grid">
            <form id="branchForm" class="stack">
              <h3>إضافة فرع</h3>
              <div class="field"><label>الاسم</label><input name="name" required maxlength="80"></div>
              <div class="field"><label>رمز الفرع (لاتيني)</label><input name="code" required pattern="[a-zA-Z0-9-]{2,32}" maxlength="32" dir="ltr"></div>
              <button class="btn btn-primary btn-sm">إضافة الفرع</button>
            </form>
            <form id="departmentForm" class="stack">
              <h3>إضافة قسم</h3>
              <div class="field"><label>اسم القسم</label><input name="name" required maxlength="80"></div>
              <div class="field"><label>نطاق الفرع</label><select name="branchId"><option value="">قسم مشترك بين الفروع</option>
                ${data.branches.filter((branch) => branch.active).map((branch) => `<option value="${branch.id}">${esc(branch.name)}</option>`).join('')}</select></div>
              <button class="btn btn-primary btn-sm">إضافة القسم</button>
            </form>
          </div>
          <div class="form-grid mt-3">
            <div><h3>الفروع (${num(data.branches.length)})</h3><ul class="timeline">${data.branches.map((branch) => `<li><b>${esc(branch.name)}</b><span dir="ltr">${esc(branch.code)} · ${branch.active ? 'نشط' : 'معطل'}</span></li>`).join('') || '<li>لا توجد فروع</li>'}</ul></div>
            <div><h3>الأقسام (${num(data.departments.length)})</h3><ul class="timeline">${data.departments.map((department) => `<li><b>${esc(department.name)}</b><span>${esc(department.branch_name || 'مشترك بين الفروع')} · ${department.active ? 'نشط' : 'معطل'}</span></li>`).join('') || '<li>لا توجد أقسام</li>'}</ul></div>
          </div>
        </div>
      </div>
      <div class="admin-card mb-3">
        <div class="admin-card-head"><h2>قوالب الأدوار والصلاحيات</h2></div>
        <div class="admin-card-body">
          <form id="roleForm" class="stack">
            <div class="form-grid">
              <div class="field"><label>اسم الدور</label><input name="name" required maxlength="80"></div>
              <div class="field"><label>المعرّف</label><input name="roleKey" required pattern="[a-z][a-z0-9_-]{1,39}" maxlength="40" dir="ltr"></div>
              <div class="field"><label>الدور الأساسي</label><select name="baseRole"><option value="agent">موظف</option><option value="manager">مدير</option></select></div>
              <div class="field"><label>نطاق البيانات</label><select name="dataScope">${data.scopes.map((scope) => `<option value="${scope}">${scopeLabels[scope]}</option>`).join('')}</select></div>
            </div>
            <fieldset class="check"><legend>الصلاحيات</legend><div class="form-grid">
              ${data.permissions.map((permission) => `<label class="check"><input type="checkbox" name="permissions" value="${esc(permission)}"><span>${esc(permissionLabels[permission] || permission)}</span></label>`).join('')}
            </div></fieldset>
            <button class="btn btn-primary btn-sm">إنشاء دور</button>
          </form>
          <div class="admin-card mt-3"><div class="admin-card-body" style="padding:0">
            <table class="admin-table"><thead><tr><th>الدور</th><th>النطاق</th><th>الصلاحيات</th><th>الحالة</th><th></th></tr></thead>
              <tbody>${data.roles.map((role) => `<tr><td><b>${esc(role.name)}</b><br><small dir="ltr">${esc(role.role_key)}</small></td>
                <td>${esc(scopeLabels[role.data_scope] || role.data_scope)}</td><td>${role.permissions.includes('*') ? 'كاملة' : num(role.permissions.length)}</td>
                <td>${role.active ? 'نشط' : 'معطل'}</td><td>${role.role_key === 'admin' ? '' : `<div class="btn-row"><button class="btn btn-ghost btn-sm" data-role-edit="${esc(role.role_key)}">تعديل</button>
                  <button class="btn btn-ghost btn-sm" data-role-toggle="${esc(role.role_key)}" data-active="${role.active ? '0' : '1'}">${role.active ? 'تعطيل' : 'تفعيل'}</button></div>`}</td></tr>`).join('')}</tbody>
            </table>
          </div></div>
        </div>
      </div>`;
    if ($("#unitControls") && hasPermission("organization:write")) {
      for (const [kind, units] of [
        ["branches", data.branches],
        ["departments", data.departments],
      ]) {
        const box = document.createElement("div");
        box.innerHTML = `<h3>${kind === "branches" ? "تعديل الفروع" : "تعديل الأقسام"}</h3>${units.map((unit) => `<p>${esc(unit.name)} — ${unit.active ? "نشط" : "معطل"} <button type="button" data-unit="${kind}/${unit.id}">تعديل</button></p>`).join("")}`;
        $("#unitControls").append(box);
        $$("[data-unit]", box).forEach(
          (button) =>
            (button.onclick = () => {
              const unit = units.find((u) =>
                button.dataset.unit.endsWith("/" + u.id),
              );
              openDrawer(
                `<h2>تعديل الجهة</h2><form id="unitForm" class="stack"><label>الاسم<input name="name" value="${esc(unit.name)}" required maxlength="80"></label><label>الحالة<select name="active"><option value="1" ${unit.active ? "selected" : ""}>نشط</option><option value="0" ${unit.active ? "" : "selected"}>معطل</option></select></label><label>السبب<textarea name="reason" required minlength="3" maxlength="500"></textarea></label><p class="form-status is-error"></p><button class="btn btn-primary">حفظ</button><button type="button" data-close-drawer>إلغاء</button></form>`,
              );
              $("#unitForm").onsubmit = async (event) => {
                event.preventDefault();
                const values = Object.fromEntries(new FormData(event.target)),
                  save = event.target.querySelector("button");
                save.disabled = true;
                try {
                  await api("/api/admin/" + button.dataset.unit, {
                    method: "PATCH",
                    body: JSON.stringify({
                      ...values,
                      active: values.active === "1",
                    }),
                  });
                  closeDrawer();
                  await renderOrganization();
                } catch (error) {
                  $(".form-status", event.target).textContent = error.message;
                } finally {
                  save.disabled = false;
                }
              };
            }),
        );
      }
    }
    $('#branchForm')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const body = Object.fromEntries(new FormData(event.currentTarget).entries());
      try { await api('/api/admin/branches', { method: 'POST', body: JSON.stringify(body) }); toast('تمت إضافة الفرع'); renderOrganization(); }
      catch (error) { toast(error.message, 'bad'); }
    });
    $('#departmentForm')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const body = Object.fromEntries(new FormData(event.currentTarget).entries());
      try { await api('/api/admin/departments', { method: 'POST', body: JSON.stringify(body) }); toast('تمت إضافة القسم'); renderOrganization(); }
      catch (error) { toast(error.message, 'bad'); }
    });
    $('#roleForm')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const body = Object.fromEntries(new FormData(form).entries());
      body.permissions = $$('input[name="permissions"]:checked', form).map((checkbox) => checkbox.value);
      try { await api('/api/admin/roles', { method: 'POST', body: JSON.stringify(body) }); toast('تم إنشاء الدور'); renderOrganization(); }
      catch (error) { toast(error.message, 'bad'); }
    });
    $$('[data-role-toggle]').forEach((button) => button.addEventListener('click', async () => {
      const role = data.roles.find((entry) => entry.role_key === button.dataset.roleToggle);
      if (!role) return;
      try {
        await api(`/api/admin/roles/${encodeURIComponent(role.role_key)}`, {
          method: 'PATCH',
          body: JSON.stringify({ active: button.dataset.active === '1' }),
        });
        toast('تم تحديث حالة الدور');
        renderOrganization();
      } catch (error) { toast(error.message, 'bad'); }
    }));
    $$('[data-role-edit]').forEach((button) => button.addEventListener('click', () => {
      const role = data.roles.find((entry) => entry.role_key === button.dataset.roleEdit);
      if (!role) return;
      openDrawer(`
        <div class="drawer-head"><div><h2>تعديل الدور — ${esc(role.name)}</h2></div><button class="drawer-close" data-close-drawer>×</button></div>
        <form id="editRoleForm" class="stack">
          <div class="form-grid">
            <div class="field"><label>اسم الدور</label><input name="name" required maxlength="80" value="${esc(role.name)}"></div>
            <div class="field"><label>الدور الأساسي</label><select name="baseRole">
              <option value="agent" ${role.base_role === 'agent' ? 'selected' : ''}>موظف</option>
              <option value="manager" ${role.base_role === 'manager' ? 'selected' : ''}>مدير</option>
            </select></div>
            <div class="field"><label>نطاق البيانات</label><select name="dataScope">
              ${data.scopes.map((scope) => `<option value="${scope}" ${role.data_scope === scope ? 'selected' : ''}>${scopeLabels[scope]}</option>`).join('')}
            </select></div>
          </div>
          <fieldset class="check"><legend>الصلاحيات</legend><div class="form-grid">
            ${data.permissions.map((permission) => `<label class="check"><input type="checkbox" name="permissions" value="${esc(permission)}" ${role.permissions.includes(permission) ? 'checked' : ''}><span>${esc(permissionLabels[permission] || permission)}</span></label>`).join('')}
          </div></fieldset>
          <p class="form-status is-error" data-role-error></p>
          <div class="btn-row"><button class="btn btn-primary" type="submit">حفظ الدور</button><button class="btn btn-ghost" type="button" data-close-drawer>إلغاء</button></div>
        </form>`);
      $('#editRoleForm')?.addEventListener('submit', async (event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const body = Object.fromEntries(new FormData(form).entries());
        body.permissions = $$('input[name="permissions"]:checked', form).map((checkbox) => checkbox.value);
        try {
          await api(`/api/admin/roles/${encodeURIComponent(role.role_key)}`, { method: 'PATCH', body: JSON.stringify(body) });
          closeDrawer();
          toast('تم تحديث الدور');
          renderOrganization();
        } catch (error) { $('[data-role-error]').textContent = error.message; }
      });
    }));
  }

  /* ---------------- performance reports ---------------- */
  async function renderReports() {
    state.report = state.report || { period: 'weekly', from: '', to: '', employee: '' };
    const opts = state.report;
    const params = new URLSearchParams({ period: opts.period });
    if (opts.from && opts.to) { params.set('from', opts.from); params.set('to', opts.to); }
    if (opts.employee) params.set('employee', opts.employee);
    const data = await api(`/api/admin/reports?${params.toString()}`);
    const s = data.summary;
    const max = Math.max(1, ...data.series.map((x) => x.total));
    const chart = data.series.map((x) => `<div class="chart-col" title="${esc(x.bucket)} — ${x.total} طلب / ${x.won} صفقة">
      <i style="height:${Math.round((x.total / max) * 100)}%"></i>
      <b style="height:${Math.round((x.won / max) * 100)}%"></b>
      <span>${esc(x.bucket.slice(5))}</span></div>`).join('');
    const employeeOptions = (data.agents || []).map((a) => `<option value="${a.id}" ${String(opts.employee) === String(a.id) ? 'selected' : ''}>${esc(a.name)}</option>`).join('');

    $('#view').innerHTML = `
      <div class="toolbar">
        <div class="tabs" style="margin:0;border:0">
          ${[['daily', 'يومي'], ['weekly', 'أسبوعي'], ['monthly', 'شهري']].map(([k, l]) => `<button type="button" data-period="${k}" class="${opts.period === k ? 'is-active' : ''}">${l}</button>`).join('')}
        </div>
        <input type="date" id="rFrom" value="${esc(data.range.from)}" aria-label="من">
        <input type="date" id="rTo" value="${esc(data.range.to)}" aria-label="إلى">
        <select id="rEmployee" aria-label="الموظف"><option value="">كل الموظفين</option><option value="unassigned" ${opts.employee === 'unassigned' ? 'selected' : ''}>غير مسند</option>${employeeOptions}</select>
        <button class="btn btn-primary btn-sm" type="button" data-report-apply>تطبيق</button>
        <a class="btn btn-ghost btn-sm" href="/api/admin/reports.csv?period=${encodeURIComponent(opts.period)}&from=${encodeURIComponent(data.range.from)}&to=${encodeURIComponent(data.range.to)}">تصدير CSV</a>
        <span class="spacer"></span><span class="muted" style="font-size:12px">${esc(data.range.from)} ← ${esc(data.range.to)}</span>
      </div>

      <div class="stat-grid">
        <div class="stat"><span>إجمالي الطلبات</span><b>${num(s.total)}</b><small>خلال الفترة المحددة</small></div>
        <div class="stat"><span>صفقات ناجحة</span><b>${num(s.won)}</b><small>ملغية: ${num(s.lost)} · مفتوحة: ${num(s.open)}</small></div>
        <div class="stat"><span>نسبة التحويل</span><b>${s.conversion}%</b><small>معدل الفوز: ${s.winRate}%</small></div>
        <div class="stat"><span>متوسط زمن الإنجاز</span><b>${esc(s.avgCompletionLabel)}</b><small>أول استجابة: ${esc(s.avgResponseLabel)}</small></div>
        <div class="stat"><span>قيمة الصفقات الناجحة</span><b>${num(s.revenue)}</b><small>د.أ (من عروض الأسعار)</small></div>
      </div>

      <div class="admin-card mb-3">
        <div class="admin-card-head"><h2>حركة الطلبات والصفقات</h2><span class="spacer" style="flex:1"></span><span class="chart-legend"><i></i> طلبات <b></b> صفقات</span></div>
        <div class="admin-card-body"><div class="chart">${chart || '<p class="muted">لا توجد بيانات في هذه الفترة.</p>'}</div></div>
      </div>

      <div class="admin-card mb-3">
        <div class="admin-card-head"><h2>أداء الموظفين</h2></div>
        <div class="admin-card-body" style="padding:0">
          <table class="admin-table"><thead><tr><th>الموظف</th><th>الطلبات</th><th>ناجحة</th><th>ملغية</th><th>التحويل</th><th>متوسط الإنجاز</th><th>أول استجابة</th><th>القيمة</th></tr></thead>
          <tbody>${data.employees.length ? data.employees.map((e) => `<tr><td><b>${esc(e.name)}</b></td><td>${num(e.total)}</td><td>${num(e.won)}</td><td>${num(e.lost)}</td><td>${e.conversion}%</td><td>${esc(e.avgCompletionLabel)}</td><td>${esc(e.avgResponseLabel)}</td><td>${num(e.revenue)}</td></tr>`).join('') : '<tr><td colspan="8" class="muted">لا توجد طلبات في هذه الفترة.</td></tr>'}</tbody></table>
        </div>
      </div>

      <div class="split-even grid">
        <div class="admin-card"><div class="admin-card-head"><h2>التحويل حسب الخدمة</h2></div><div class="admin-card-body" style="padding:0">
          <table class="admin-table"><thead><tr><th>الخدمة</th><th>الطلبات</th><th>ناجحة</th><th>التحويل</th></tr></thead><tbody>
          ${data.byType.length ? data.byType.map((t) => `<tr><td>${esc(t.label)}</td><td>${num(t.total)}</td><td>${num(t.won)}</td><td>${t.conversion}%</td></tr>`).join('') : '<tr><td colspan="4" class="muted">لا بيانات</td></tr>'}
          </tbody></table></div></div>
        <div class="admin-card"><div class="admin-card-head"><h2>قمع الحالات</h2></div><div class="admin-card-body">
          ${data.funnel.map((f) => `<div class="funnel-row"><span>${esc(f.label)}</span><div class="funnel-bar"><i style="width:${s.total ? Math.round((f.total / s.total) * 100) : 0}%"></i></div><b>${num(f.total)}</b></div>`).join('')}
        </div></div>
      </div>`;

    $$('[data-period]').forEach((b) => b.addEventListener('click', () => { state.report = { ...opts, period: b.dataset.period, from: '', to: '' }; renderReports(); }));
    $('[data-report-apply]')?.addEventListener('click', () => {
      state.report = { ...opts, from: $('#rFrom').value, to: $('#rTo').value, employee: $('#rEmployee').value };
      renderReports();
    });
  }

  /* ---------------- marketing & tracking ---------------- */
  async function renderMarketing() {
    const data = await api('/api/admin/settings');
    const s = data.settings || {};
    const events = await api('/api/admin/tracking-events').catch(() => ({ events: [], counts: [] }));
    const status = (id) => (id ? `<span class="badge badge-ok">مفعّل</span>` : `<span class="badge badge-line">غير مضاف</span>`);
    $('#view').innerHTML = `
      <div class="split">
        <div class="admin-card"><div class="admin-card-head"><h2>إعدادات التسويق والتتبع</h2></div><div class="admin-card-body">
          <form id="marketingForm" class="stack">
            <div class="field"><label>Meta Pixel ID ${status(s.metaPixelId)}</label><input data-key="metaPixelId" dir="ltr" value="${esc(s.metaPixelId || '')}" placeholder="123456789012345"><span class="field-hint">رقم البكسل من Meta Events Manager. يُضاف كود الصفحة والأحداث (Lead / Contact).</span></div>
            <div class="field"><label>Google Tag Manager ID ${status(s.gtmId)}</label><input data-key="gtmId" dir="ltr" value="${esc(s.gtmId || '')}" placeholder="GTM-XXXXXXX"><span class="field-hint">يُحمّل حاوية GTM بعد اكتمال الصفحة، مع نسخة noscript.</span></div>
            <div class="field"><label>Google Ads Conversion ID ${status(s.googleAdsId)}</label><input data-key="googleAdsId" dir="ltr" value="${esc(s.googleAdsId || '')}" placeholder="AW-123456789"><span class="field-hint">يُستخدم لإرسال تحويل عند إرسال الطلب.</span></div>
            <div class="field"><label>Conversion Label</label><input data-key="googleAdsLabel" dir="ltr" value="${esc(s.googleAdsLabel || '')}" placeholder="AbCdEfGhIj"><span class="field-hint">اختياري: التسمية المرتبطة بحدث التحويل في Google Ads.</span></div>
            <label class="check"><input type="checkbox" id="trackingEnabled" ${s.trackingEnabled === false ? '' : 'checked'}><span>تفعيل تتبع الحملات على الموقع العام</span></label>
            <button class="btn btn-primary" type="submit">حفظ إعدادات التتبع</button>
            <p class="form-status" data-marketing-status></p>
          </form>
          <div class="notice notice-info mt-3">الأكواد تُحمّل بعد <b>load</b> وبعد وقت خامل، فلا تؤثر على سرعة الرسم. تُحترم إشارة <code>Do Not Track</code>، ولا تُرسل أسماء أو أرقام هواتف إلى المنصات.</div>
        </div></div>
        <div class="stack">
          <div class="admin-card"><div class="admin-card-head"><h2>كيف تتحقق؟</h2></div><div class="admin-card-body" style="font-size:13px">
            <ol style="padding-inline-start:18px">
              <li>أضف المعرفات واحفظ.</li>
              <li>افتح <a href="/" target="_blank" rel="noopener">الموقع العام</a> في نافذة جديدة.</li>
              <li>أرسل طلبًا تجريبيًا، ثم راقب الأحداث في Meta Events Manager / GTM Preview.</li>
              <li>اضغط زر واتساب واختر فرعًا لتسجيل Contact.</li>
            </ol>
            <a class="btn btn-ghost btn-sm mt-2" href="/" target="_blank" rel="noopener">فتح الموقع</a>
          </div></div>
          <div class="admin-card"><div class="admin-card-head"><h2>أحداث آخر 7 أيام</h2></div><div class="admin-card-body" style="padding:0">
            <table class="admin-table"><thead><tr><th>الحدث</th><th>النوع</th><th>الوقت</th></tr></thead><tbody>
            ${events.events.length ? events.events.slice(0, 12).map((e) => `<tr><td>${esc(e.event)}</td><td>${esc(e.type || '—')}</td><td>${dt(e.created_at)}</td></tr>`).join('') : '<tr><td colspan="3" class="muted">لا أحداث مسجلة بعد.</td></tr>'}
            </tbody></table>
          </div></div>
        </div>
      </div>`;

    $('#marketingForm')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const body = {};
      $$('[data-key]', e.target).forEach((el) => { body[el.dataset.key] = el.value.trim(); });
      body.trackingEnabled = $('#trackingEnabled').checked;
      try {
        await api('/api/admin/settings', { method: 'PATCH', body: JSON.stringify(body) });
        toast('تم حفظ إعدادات التتبع');
        renderMarketing();
      } catch (err) { $('[data-marketing-status]').textContent = err.message; }
    });
  }

  async function renderSettings() {
    const data = await api('/api/admin/settings');
    const s = data.settings;
    $('#view').innerHTML = `
      <div class="split">
        <div class="admin-card"><div class="admin-card-head"><h2>إعدادات الموقع</h2></div><div class="admin-card-body">
          <form id="settingsForm" class="stack">
            ${[['brand', 'اسم الشركة'], ['brandShort', 'الاسم المختصر'], ['whatsapp', 'رقم واتساب (دولي بدون +)'], ['heroHeadline', 'عنوان الواجهة'], ['heroSub', 'وصف الواجهة']]
              .map(([k, l]) => `<div class="field"><label>${l}</label><input data-key="${k}" value="${esc(s[k] || '')}" ${k === 'whatsapp' ? 'dir="ltr"' : ''}></div>`).join('')}
            <div class="field"><label>رابط فيديو الواجهة (MP4)</label><input data-key="heroVideoUrl" dir="ltr" value="${esc(s.heroVideoUrl || '')}" placeholder="/media/hero/hero-loop.mp4"><span class="field-hint">اتركه فارغًا لإيقاف الفيديو واستخدام الصورة فقط.</span></div>
            <div class="field"><label>صورة غلاف الواجهة (Poster)</label><input data-key="heroPosterUrl" dir="ltr" value="${esc(s.heroPosterUrl || '')}" placeholder="/media/hero/hero-poster.jpg"><span class="field-hint">تُعرض فورًا قبل تحميل الفيديو وعلى الأجهزة التي توفّر البيانات.</span></div>
            <div class="field"><label>تنبيه التأشيرات</label><textarea data-key="visaDisclaimer" rows="3">${esc(s.visaDisclaimer || '')}</textarea></div>
            <div class="field"><label>ملاحظة المراجعات</label><textarea data-key="ratingNote" rows="2">${esc(s.ratingNote || '')}</textarea></div>
            <div class="field"><label>آخر تحديث للمحتوى</label><input data-key="lastContentUpdate" type="date" value="${esc(s.lastContentUpdate || '')}"></div>
            <button class="btn btn-primary" type="submit">حفظ الإعدادات</button>
            <p class="form-status" data-settings-status></p>
          </form>
        </div></div>
        <div class="admin-card"><div class="admin-card-head"><h2>كلمة المرور</h2></div><div class="admin-card-body">
          <form id="passwordForm" class="stack">
            <div class="field"><label>كلمة المرور الحالية</label><input data-key="currentPassword" type="password" dir="ltr" autocomplete="current-password"></div>
            <div class="field"><label>كلمة المرور الجديدة</label><input data-key="newPassword" type="password" dir="ltr" autocomplete="new-password"></div>
            <p class="field-hint">10 أحرف على الأقل، حرف ورقم. ستُنهى الجلسات الحالية بعد التغيير.</p>
            <button class="btn btn-primary" type="submit">تغيير كلمة المرور</button>
            <p class="form-status" data-password-status></p>
          </form>
        </div></div>
      </div>`;
    $('#settingsForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const body = {};
      $$('[data-key]', e.target).forEach((el) => { body[el.dataset.key] = el.value; });
      try {
        await api('/api/admin/settings', { method: 'PATCH', body: JSON.stringify(body) });
        $('[data-settings-status]').textContent = 'تم الحفظ';
        toast('تم حفظ الإعدادات');
      } catch (err) { $('[data-settings-status]').textContent = err.message; }
    });
    $('#passwordForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const body = {};
      $$('[data-key]', e.target).forEach((el) => { body[el.dataset.key] = el.value; });
      try {
        await api('/api/auth/change-password', { method: 'POST', body: JSON.stringify(body) });
        toast('تم تغيير كلمة المرور، سجّل الدخول من جديد');
        state.user = null;
        renderLogin('تم تغيير كلمة المرور. سجّل الدخول بكلمة المرور الجديدة.');
      } catch (err) { $('[data-password-status]').textContent = err.message; }
    });
  }

  async function renderAudit() {
    const data = await api("/api/admin/audit");
    $("#view").innerHTML =
      `<div class="admin-card"><div class="admin-card-head"><h2>سجل التغييرات</h2>${hasPermission("audit:export") ? '<button class="btn btn-ghost" data-audit-export>تنزيل نسخة موقعة (آخر 1000 سجل)</button>' : ""}</div><div class="admin-card-body"><table class="admin-table"><thead><tr><th>الوقت</th><th>المستخدم</th><th>الإجراء</th><th>العنصر</th><th>التفاصيل</th></tr></thead><tbody>${data.entries.map((e) => `<tr><td>${dt(e.created_at)}</td><td>${esc(e.user_name || "—")}</td><td>${esc(e.action)}</td><td>${esc(e.entity || "")} ${esc(e.entity_id || "")}</td><td><details><summary>${esc(e.reason || "عرض")}</summary><p>قبل</p><pre dir="ltr" style="white-space:pre-wrap">${esc(e.before_json || "—")}</pre><p>بعد</p><pre dir="ltr" style="white-space:pre-wrap">${esc(e.after_json || e.meta || "—")}</pre></details></td></tr>`).join("") || '<tr><td colspan="5">لا سجلات</td></tr>'}</tbody></table></div></div>`;
    $("[data-audit-export]")?.addEventListener("click", async (event) => {
      event.target.disabled = true;
      try {
        const exported = await api("/api/admin/audit/export");
        const url = URL.createObjectURL(
          new Blob([JSON.stringify(exported, null, 2)], {
            type: "application/json",
          }),
        );
        const link = document.createElement("a");
        link.href = url;
        link.download = "laurette-audit-signed.json";
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      } catch (error) {
        toast(error.message, "bad");
      } finally {
        event.target.disabled = false;
      }
    });
  }

  async function renderAssistant() {
    const data = await api('/api/admin/assistant-log');
    $('#view').innerHTML = `<div class="admin-card"><div class="admin-card-head"><h2>جلسات المساعد</h2><span class="spacer" style="flex:1"></span><span class="muted" style="font-size:12px">تُسجَّل فقط بموافقة العميل</span></div>
      <div class="admin-card-body" style="padding:0">
        <table class="admin-table"><thead><tr><th>الجلسة</th><th>الموافقة</th><th>عدد الرسائل</th><th>آخر نشاط</th></tr></thead>
        <tbody>${data.sessions.map((s) => `<tr><td class="ref">${esc(s.sid.slice(0, 10))}…</td><td>${s.consent ? '✓' : '✕'}</td><td>${num(s.messages)}</td><td>${dt(s.last_at)}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">لا جلسات محفوظة</td></tr>'}</tbody></table>
      </div></div>`;
  }

  /* ---------------- drawer ---------------- */
  function openDrawer(html) {
    closeDrawer();
    const wrap = document.createElement('div');
    wrap.className = 'drawer-backdrop';
    wrap.innerHTML = `<div class="drawer" role="dialog" aria-modal="true">${html}</div>`;
    document.body.append(wrap);
    state.overlay = wrap;
    wrap.addEventListener('click', (e) => {
      if (e.target === wrap || e.target.closest('[data-close-drawer]')) closeDrawer();
    });
    document.addEventListener('keydown', escClose);
  }

  function escClose(e) {
    if (e.key === 'Escape') closeDrawer();
  }

  function closeDrawer() {
    if (state.overlay) {
      state.overlay.remove();
      state.overlay = null;
      document.removeEventListener('keydown', escClose);
    }
  }

  /* ---------------- boot ---------------- */
  async function boot() {
    try {
      const me = await api('/api/auth/me');
      if (!me.user) return renderLogin();
      state.user = me.user;
      if (location.pathname.replace(/\/+$/, '') === '/admin/voucher') state.section = 'voucher';
      renderShell();
    } catch {
      renderLogin('تعذر الاتصال بالخادم.');
    }
  }

  boot();
})();
