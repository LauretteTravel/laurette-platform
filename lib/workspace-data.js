import { can } from "./auth.js";
import { requestWhere, taskWhere } from "./report-access.js";
import { ammanDay, dayStart } from "./report-time.js";
import { HttpError } from "./http.js";

// A bounded projection for the existing overview endpoint, not a parallel CRM API.
export function workspaceData(ctx, { now = new Date().toISOString() } = {}) {
  const db = ctx.db,
    user = ctx.user,
    today = ammanDay(now);
  const next = new Date(Date.parse(today + "T12:00:00Z") + 86400000)
    .toISOString()
    .slice(0, 10);
  const start = dayStart(today),
    end = dayStart(next),
    r = requestWhere(ctx),
    t = taskWhere(ctx);
  const readRequests = can(user, "requests:read"),
    readTasks = can(user, "tasks:read");
  const tab = String(ctx.query.workspaceTab || "all");
  const due = String(ctx.query.workspaceDue || "all");
  if (!["all", "today", "overdue"].includes(due))
    throw new HttpError(400, "مرشح الموعد غير صالح");
  if (!["all", "new", "quotes", "followups", "tasks", "bookings"].includes(tab))
    throw new HttpError(400, "مرشح العمل غير صالح");
  const page = Number(ctx.query.workspacePage || 1);
  if (!Number.isSafeInteger(page) || page < 1 || page > 10000)
    throw new HttpError(400, "صفحة العمل غير صالحة");
  const count = (sql, args) => Number(db.prepare(sql).get(...args)?.n || 0);
  const within = (column) =>
    `julianday(${column})>=julianday(?) AND julianday(${column})<julianday(?)`;
  const metrics = {
    newCustomers: null,
    upcomingBookings: null,
    waitingQuotes: null,
    todayFollowUps: null,
    overdueTasks: null,
  };
  const sources = [],
    args = [];
  const payload = `CASE WHEN json_valid(r.payload) THEN r.payload ELSE '{}' END`;
  const destination = `COALESCE(NULLIF(json_extract(${payload},'$.destination'),''),NULLIF(json_extract(${payload},'$.country'),''),NULLIF(json_extract(${payload},'$.programTitle'),''),'')`;
  const requestFields = `r.id AS requestId,NULL AS taskId,r.customer_id AS customerId,COALESCE(c.name,r.title,r.reference) AS customer,${destination} AS destination,r.type AS service,c.phone AS phone,NULL AS priority`;
  const join = "FROM requests r LEFT JOIN customers c ON c.id=r.customer_id";
  const add = (kind, sql, params) => {
    if (tab === "all" || tab === kind) {
      sources.push(sql);
      args.push(...params);
    }
  };
  if (readRequests) {
    metrics.waitingQuotes = count(
      `SELECT COUNT(*) n FROM requests r WHERE ${r.sql} AND r.status='quoted'`,
      r.params,
    );
    metrics.todayFollowUps = count(
      `SELECT COUNT(*) n FROM request_follow_ups f JOIN requests r ON r.id=f.request_id WHERE ${r.sql} AND f.status='open' AND ${within("f.due_at")}`,
      [...r.params, start, end],
    );
    if (can(user, "customers:read"))
      metrics.newCustomers = count(
        `SELECT COUNT(*) n FROM customers c WHERE ${within("c.created_at")} AND EXISTS(SELECT 1 FROM requests r WHERE r.customer_id=c.id AND ${r.sql})`,
        [start, end, ...r.params],
      );
    if (can(user, "customers:read")) {
      const other = requestWhere(ctx, {}, "latest");
      add(
        "new",
        `SELECT 'new-'||c.id AS rowKey,'new' AS kind,${requestFields},NULL AS dueAt,r.reference AS reference,c.created_at AS sortAt ${join} WHERE ${r.sql} AND ${within("c.created_at")} AND r.id=(SELECT latest.id FROM requests latest WHERE latest.customer_id=c.id AND ${other.sql} ORDER BY latest.id DESC LIMIT 1)`,
        [...r.params, start, end, ...other.params],
      );
    }
    add(
      "quotes",
      `SELECT 'quote-'||r.id AS rowKey,'quotes' AS kind,${requestFields},NULL AS dueAt,r.reference AS reference,r.updated_at AS sortAt ${join} WHERE ${r.sql} AND r.status='quoted'`,
      r.params,
    );
    const followDue =
      tab === "followups" && due === "today"
        ? within("f.due_at")
        : "julianday(f.due_at)<julianday(?)";
    const followArgs =
      tab === "followups" && due === "today"
        ? [start, end]
        : [tab === "followups" && due === "overdue" ? now : end];
    add(
      "followups",
      `SELECT 'follow-'||f.id AS rowKey,'followups' AS kind,${requestFields},f.due_at AS dueAt,r.reference AS reference,f.due_at AS sortAt FROM request_follow_ups f JOIN requests r ON r.id=f.request_id LEFT JOIN customers c ON c.id=r.customer_id WHERE ${r.sql} AND f.status='open' AND ${followDue}`,
      [...r.params, ...followArgs],
    );
  }
  const taskFilter = `${t.sql}${readRequests ? "" : " AND t.request_id IS NULL"}`;
  if (readTasks) {
    metrics.overdueTasks = count(
      `SELECT COUNT(*) n FROM tasks t WHERE ${taskFilter} AND t.status NOT IN('done','cancelled') AND julianday(t.due_at)<julianday(?)`,
      [...t.params, now],
    );
    const taskDue =
      tab === "tasks" && due === "today"
        ? within("t.due_at")
        : "julianday(t.due_at)<julianday(?)";
    const taskArgs =
      tab === "tasks" && due === "today"
        ? [start, end]
        : [tab === "tasks" && due === "overdue" ? now : end];
    const taskCustomer = readRequests ? "COALESCE(c.name,t.title)" : "t.title",
      taskDestination = readRequests ? destination : "''",
      taskService = readRequests ? "COALESCE(r.type,'task')" : "'task'",
      taskPhone = readRequests ? "c.phone" : "NULL";
    const taskJoin = readRequests
      ? " LEFT JOIN requests r ON r.id=t.request_id LEFT JOIN customers c ON c.id=r.customer_id"
      : "";
    add(
      "tasks",
      `SELECT 'task-'||t.id AS rowKey,'tasks' AS kind,${readRequests ? "t.request_id" : "NULL"} AS requestId,t.id AS taskId,NULL AS customerId,${taskCustomer} AS customer,${taskDestination} AS destination,${taskService} AS service,${taskPhone} AS phone,t.priority,t.due_at AS dueAt,'TASK-'||t.id AS reference,t.due_at AS sortAt FROM tasks t ${taskJoin} WHERE ${taskFilter} AND t.status NOT IN('done','cancelled') AND ${taskDue}`,
      [...t.params, ...taskArgs],
    );
  }
  let bookingSource = null,
    bookingArgs = [];
  if (readRequests && can(user, "vouchers:read")) {
    const at = `CASE WHEN v.kind='flight' THEN json_extract(s.snapshot_json,'$.data.flight.segments[0].departAt') ELSE json_extract(s.snapshot_json,'$.data.hotel.checkIn') END`;
    const from = `FROM employee_vouchers v JOIN voucher_bookings b ON b.id=v.booking_id JOIN requests r ON r.id=b.request_id LEFT JOIN customers c ON c.id=r.customer_id JOIN voucher_versions s ON s.voucher_id=v.id AND s.version=v.current_version WHERE ${r.sql} AND v.status='issued' AND r.status='confirmed' AND ((v.kind='flight' AND julianday(${at})>=julianday(?)) OR (v.kind='hotel' AND date(${at})>=?))`;
    bookingArgs = [...r.params, now, today];
    metrics.upcomingBookings = count("SELECT COUNT(*) n " + from, bookingArgs);
    bookingSource = `SELECT 'booking-'||v.id AS rowKey,'bookings' AS kind,r.id AS requestId,NULL AS taskId,r.customer_id AS customerId,COALESCE(c.name,r.title,r.reference) AS customer,${destination} AS destination,v.kind AS service,c.phone AS phone,NULL AS priority,${at} AS dueAt,v.reference AS reference,${at} AS sortAt ${from}`;
    if (tab === "bookings") {
      sources.push(bookingSource);
      args.push(...bookingArgs);
    }
  }
  const union = sources.join(" UNION ALL "),
    limit = 4;
  const total = union ? count(`SELECT COUNT(*) n FROM (${union})`, args) : 0;
  const items = union
    ? db
        .prepare(
          `SELECT * FROM (${union}) ORDER BY sortAt,rowKey LIMIT ? OFFSET ?`,
        )
        .all(...args, limit, (page - 1) * limit)
    : [];
  const counts = { all: 0, new: 0, quotes: 0, followups: 0, tasks: 0 };
  if (readRequests) {
    counts.new = metrics.newCustomers || 0;
    counts.quotes = metrics.waitingQuotes;
    counts.followups = count(
      `SELECT COUNT(*) n FROM request_follow_ups f JOIN requests r ON r.id=f.request_id WHERE ${r.sql} AND f.status='open' AND julianday(f.due_at)<julianday(?)`,
      [...r.params, end],
    );
  }
  if (readTasks)
    counts.tasks = count(
      `SELECT COUNT(*) n FROM tasks t WHERE ${taskFilter} AND t.status NOT IN('done','cancelled') AND julianday(t.due_at)<julianday(?)`,
      [...t.params, end],
    );
  counts.all = counts.new + counts.quotes + counts.followups + counts.tasks;
  const eventSources = [],
    eventArgs = [];
  if (readRequests) {
    eventSources.push(
      `SELECT 'request-'||e.id AS id,'request' AS entity,r.id AS entityId,e.kind,substr(e.message,1,200) AS message,e.actor_name AS actor,e.created_at AS at FROM request_events e JOIN requests r ON r.id=e.request_id WHERE ${r.sql}`,
    );
    eventArgs.push(...r.params);
  }
  if (readTasks) {
    eventSources.push(
      `SELECT 'task-'||e.id AS id,'task' AS entity,t.id AS entityId,e.kind,'تحديث المهمة: '||substr(t.title,1,140) AS message,u.name AS actor,e.created_at AS at FROM task_events e JOIN tasks t ON t.id=e.task_id LEFT JOIN users u ON u.id=e.actor_id WHERE ${taskFilter}`,
    );
    eventArgs.push(...t.params);
  }
  const eventPage = Number(ctx.query.workspaceActivityPage || 1);
  if (!Number.isSafeInteger(eventPage) || eventPage < 1 || eventPage > 10000)
    throw new HttpError(400, "صفحة النشاط غير صالحة");
  const eventUnion = eventSources.join(" UNION ALL ");
  const activities = eventUnion
    ? db
        .prepare(
          `SELECT * FROM (${eventUnion}) ORDER BY at DESC,id DESC LIMIT 4 OFFSET ?`,
        )
        .all(...eventArgs, (eventPage - 1) * 4)
    : [];
  const activityTotal = eventUnion
    ? count(`SELECT COUNT(*) n FROM (${eventUnion})`, eventArgs)
    : 0;
  let intake = null;
  if (can(user, "requests:write")) {
    const org = user.roleKey
        ? user.dataScope === "organization"
        : ["admin", "manager"].includes(user.role),
      limited = !org;
    const deptWhere = limited
      ? user.dataScope === "branch"
        ? " AND (branch_id IS NULL OR branch_id=?)"
        : " AND id IS ?"
      : "";
    intake = {
      branches: db
        .prepare(
          `SELECT id,name FROM branches WHERE active=1${limited ? " AND id=?" : ""} ORDER BY name`,
        )
        .all(...(limited ? [user.branchId ?? null] : [])),
      departments: db
        .prepare(
          `SELECT id,name,branch_id FROM departments WHERE active=1${deptWhere} ORDER BY name`,
        )
        .all(
          ...(limited
            ? [
                user.dataScope === "branch"
                  ? (user.branchId ?? null)
                  : (user.departmentId ?? null),
              ]
            : []),
        ),
    };
  }
  return {
    generatedAt: now,
    today,
    timeZone: "Asia/Amman",
    scope: user.roleKey
      ? user.dataScope
      : user.role === "agent"
        ? "assigned"
        : "organization",
    metrics,
    metricNotes: {
      upcomingBookings:
        "مواعيد قسائم طيران وفنادق صادرة لطلبات مؤكدة؛ ليست كل حجوزات الشركة",
      todayFollowUps: "متابعات مفتوحة تستحق خلال يوم عمّان",
      waitingQuotes: "طلبات حالتها تم إرسال العرض، وليست قيمة مالية",
      newCustomers: "عملاء CRM أُنشئوا اليوم ولهم طلب مرئي",
      overdueTasks: "مهام مفتوحة موعدها قبل وقت التوليد",
    },
    work: {
      tab,
      due,
      items,
      total,
      page,
      pages: Math.max(1, Math.ceil(total / limit)),
      counts,
      limit,
      note:
        due === "today"
          ? "تصفية: مواعيد يوم عمّان فقط"
          : due === "overdue"
            ? "تصفية: البنود المتأخرة قبل وقت التوليد"
            : "بنود عمل؛ قد يرتبط الطلب بأكثر من بند. المهام والمتابعات تشمل المتأخر واليوم.",
    },
    activity: {
      items: activities,
      page: eventPage,
      total: activityTotal,
      pages: Math.max(1, Math.ceil(activityTotal / 4)),
    },
    intake,
    companyWhatsapp: String(ctx.settings.whatsapp || ctx.settings.phone || "")
      .replace(/[^+\d]/g, "")
      .slice(0, 20),
  };
}
