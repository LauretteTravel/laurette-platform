import { one, q } from "./db.js";
import { can } from "./auth.js";
import { durationLabel, REQUEST_TYPES, STATUSES } from "./domain.js";
import {
  reportAccess,
  reportFilters,
  requestWhere,
  taskWhere,
  originSql,
} from "./report-access.js";
import { registerReportTime, reportRange, shiftDay } from "./report-time.js";
import { HttpError } from "./http.js";
export const DEFINITIONS = [
  [
    "total",
    "الطلبات الجديدة",
    "طلبات أُنشئت في الفترة؛ الحالة والمسؤول والجهة بحسب البيانات الحالية.",
  ],
  [
    "won",
    "طلبات مؤكدة",
    "طلبات فترة الإنشاء المؤكدة حاليًا؛ لا يعني ذلك حجز مورد أو تحصيلًا.",
  ],
  [
    "conversion",
    "التحويل إلى تأكيد",
    "طلبات مؤكدة ÷ جميع طلبات فترة الإنشاء. مقام صفر = غير متاح.",
  ],
  [
    "winRate",
    "معدل الفوز",
    "المؤكدة ÷ (المؤكدة + الملغية) من مجموعة الإنشاء الحالية.",
  ],
  [
    "response",
    "أول إجراء مسجل",
    "متوسط المدة بين إنشاء الطلب وأول إجراء موظف مسجل للعينات الصالحة؛ قد يمثل إسنادًا أو تعديلًا، وليس أول اتصال مثبت بالعميل.",
  ],
  [
    "completion",
    "زمن الإغلاق",
    "متوسط المدة بين إنشاء الطلب وإغلاقه للطلبات المغلقة حاليًا ذات التواريخ الصالحة؛ إعادة الفتح تغيّر هذا القياس.",
  ],
  [
    "newCustomers",
    "عملاء CRM جدد",
    "عملاء أُنشئوا في الفترة، ضمن الصلاحية؛ النطاق المحدود أو الفلاتر تتطلب طلبًا مرتبطًا مرئيًا، ولا يشمل حسابات العملاء غير المرتبطة.",
  ],
  [
    "overdue",
    "طلبات بمتابعة متأخرة",
    "طلبات من مجموعة الإنشاء الحالية لها متابعة مفتوحة مستحقة قبل وقت توليد التقرير.",
  ],
  [
    "finance",
    "الحجوزات والتدفق النقدي",
    "قيمة وتكلفة وهامش الحجوزات المؤكدة بحسب تاريخ تأكيدها، وقبض/استرداد بحسب تاريخ قيد الدفعة؛ لا تُعد قيمة عرض السعر إيرادًا.",
  ],
  [
    "balance",
    "رصيد حجوزات الفترة",
    "رصيد حالي حتى توليد التقرير لحجوزات فترة التأكيد المؤكدة حاليًا، وليس كشفًا تاريخيًا بنهاية الفترة. دفعات بعملة مختلفة تجعل الرصيد غير مكتمل.",
  ],
  [
    "tasks",
    "التزام المهام",
    "المهام حسب تاريخ الاستحقاق وحالتها الحالية. الإنجاز في الموعد من آخر حدث انتقال إلى حالة منجزة وموعده المسجل؛ العينات المفقودة لا تُفترض ناجحة.",
  ],
  [
    "ownership",
    "نسبة العمل للموظف",
    "الإسناد الأساسي الحالي، مع احترام كل مالكي الطلب في صلاحية الرؤية؛ ليست نسبة تاريخية لمن أغلق الطلب.",
  ],
  [
    "currency",
    "العملات",
    "الأساس JOD؛ تطبيع JOD/JD/د.أ فقط. لا مصدر صرف معتمد ولا تحويل أو جمع بين عملتين.",
  ],
];
export const rate = (n, d) => (d > 0 ? Math.round((n / d) * 1000) / 10 : null);
const rounded = (v) => (v == null ? null : Math.round(v * 1000) / 1000);
const moneyCode = (a) =>
  `CASE WHEN UPPER(TRIM(${a}.currency)) IN('JOD','JD','د.أ','د.ا') THEN 'JOD' ELSE COALESCE(NULLIF(UPPER(TRIM(${a}.currency)),''),'غير مسجلة') END`;
const validMoney = (column) =>
  `typeof(${column}) IN ('integer','real') AND ${column}>=0 AND ${column}<=1000000000000000`;
const during = (column) =>
  `julianday(${column})>=julianday(?) AND julianday(${column})<julianday(?)`;
export const requestLate = `EXISTS(SELECT 1 FROM request_follow_ups f WHERE f.request_id=r.id AND f.status='open' AND julianday(f.due_at)<julianday(?))`;
function cohort(ctx, filters, range, at) {
  const w = requestWhere(ctx, filters);
  return {
    sql: `${w.sql} AND ${during("r.created_at")} AND julianday(r.created_at)<=julianday(?)`,
    params: [...w.params, range.start, range.end, at],
  };
}
const responseValid = `julianday(r.first_response_at)>=julianday(r.created_at) AND julianday(r.first_response_at)<=julianday(?)`;
const completionValid = `r.deal_status IN('won','lost') AND julianday(r.completed_at)>=julianday(r.created_at) AND julianday(r.completed_at)<=julianday(?)`;
function requestSummary(ctx, filters, range, at) {
  const w = cohort(ctx, filters, range, at),
    r = one(
      ctx.db,
      `SELECT COUNT(*) total,COALESCE(SUM(r.deal_status='won'),0) won,COALESCE(SUM(r.deal_status='lost'),0) lost,
 COALESCE(SUM(CASE WHEN ${responseValid} THEN 1 ELSE 0 END),0) responseSamples,
 AVG(CASE WHEN ${responseValid} THEN (julianday(r.first_response_at)-julianday(r.created_at))*1440 END) avgResponse,
 COALESCE(SUM(CASE WHEN ${completionValid} THEN 1 ELSE 0 END),0) completionSamples,
 AVG(CASE WHEN ${completionValid} THEN (julianday(r.completed_at)-julianday(r.created_at))*1440 END) avgCompletion,
 COALESCE(SUM(r.deal_status NOT IN('won','lost') AND ${requestLate}),0) overdue FROM requests r WHERE ${w.sql}`,
      [at, at, at, at, at, ...w.params],
    );
  return {
    total: r.total,
    won: r.won,
    lost: r.lost,
    open: r.total - r.won - r.lost,
    overdue: r.overdue,
    conversion: rate(r.won, r.total),
    winRate: rate(r.won, r.won + r.lost),
    lossRate: rate(r.lost, r.total),
    responseRate: rate(r.responseSamples, r.total),
    responseSamples: r.responseSamples,
    completionSamples: r.completionSamples,
    avgResponseMinutes: rounded(r.avgResponse),
    avgCompletionMinutes: rounded(r.avgCompletion),
    avgResponseLabel: durationLabel(r.avgResponse),
    avgCompletionLabel: durationLabel(r.avgCompletion),
    revenue: null,
  };
}
export function financeMetrics(ctx, filters, range, at) {
  if (!can(ctx.user, "reports:finance"))
    return {
      available: false,
      reason: "تحتاج صلاحية التقارير المالية",
      currencies: [],
    };
  const w = requestWhere(ctx, filters),
    bCode = moneyCode("b"),
    pCode = moneyCode("p");
  const goodAmount = validMoney("b.amount"),
    goodCost = validMoney("b.cost_amount"),
    goodPayment = validMoney("p.amount");
  const sales = q(
    ctx.db,
    `WITH paid AS (SELECT p.booking_id,COALESCE(SUM(CASE WHEN ${pCode}=${bCode} AND ${goodPayment} THEN CASE WHEN p.kind='receipt' THEN p.amount ELSE -p.amount END ELSE 0 END),0) net,COALESCE(SUM(${pCode}!=${bCode} OR NOT (${goodPayment})),0) mismatched FROM booking_payments p JOIN bookings b ON b.id=p.booking_id WHERE julianday(p.created_at)<=julianday(?) GROUP BY p.booking_id)
 SELECT ${bCode} currency,COUNT(*) bookingCount,SUM(CASE WHEN ${goodAmount} THEN b.amount END) bookedAmount,COUNT(CASE WHEN ${goodAmount} THEN 1 END) amountSamples,COUNT(CASE WHEN ${goodCost} AND ${goodAmount} THEN 1 END) costSamples,SUM(CASE WHEN ${goodCost} AND ${goodAmount} THEN b.cost_amount END) knownCost,
 SUM(CASE WHEN ${goodCost} AND ${goodAmount} THEN b.amount-b.cost_amount END) knownMargin,
 SUM(CASE WHEN COALESCE(paid.mismatched,0)=0 AND ${goodAmount} THEN MAX(b.amount-COALESCE(paid.net,0),0) END) knownOutstanding,
 SUM(CASE WHEN COALESCE(paid.mismatched,0)=0 AND ${goodAmount} THEN MAX(COALESCE(paid.net,0)-b.amount,0) END) knownCredit,
 COALESCE(SUM(COALESCE(paid.mismatched,0)>0 OR NOT (${goodAmount})),0) unmatchedBookings
 FROM bookings b JOIN requests r ON r.id=b.request_id LEFT JOIN paid ON paid.booking_id=b.id WHERE ${w.sql} AND b.status='confirmed' AND ${during("b.confirmed_at")} AND julianday(b.confirmed_at)<=julianday(?) GROUP BY ${bCode} ORDER BY currency`,
    [at, ...w.params, range.start, range.end, at],
  );
  const cash = q(
    ctx.db,
    `SELECT ${pCode} currency,COUNT(*) paymentCount,COALESCE(SUM(NOT (${goodPayment})),0) invalidPayments,COALESCE(SUM(CASE WHEN p.kind='receipt' AND ${goodPayment} THEN p.amount ELSE 0 END),0) receipts,COALESCE(SUM(CASE WHEN p.kind='refund' AND ${goodPayment} THEN p.amount ELSE 0 END),0) refunds FROM booking_payments p JOIN bookings b ON b.id=p.booking_id JOIN requests r ON r.id=b.request_id WHERE ${w.sql} AND ${during("p.created_at")} AND julianday(p.created_at)<=julianday(?) GROUP BY ${pCode} ORDER BY currency`,
    [...w.params, range.start, range.end, at],
  );
  const currencies = [
    ...new Set([...sales, ...cash].map((r) => r.currency)),
  ].map((currency) => {
    const s = sales.find((r) => r.currency === currency),
      p = cash.find((r) => r.currency === currency);
    return {
      currency,
      bookingCount: s?.bookingCount ?? 0,
      bookedAmount:
        s && s.amountSamples === s.bookingCount
          ? rounded(s.bookedAmount)
          : null,
      invalidAmounts: s ? s.bookingCount - s.amountSamples : 0,
      costSamples: s?.costSamples ?? 0,
      knownCost: rounded(s?.knownCost),
      cost: s && s.costSamples === s.bookingCount ? rounded(s.knownCost) : null,
      estimatedMargin:
        s && s.costSamples === s.bookingCount ? rounded(s.knownMargin) : null,
      knownMargin: rounded(s?.knownMargin),
      outstanding:
        s && s.unmatchedBookings === 0 ? rounded(s.knownOutstanding) : null,
      credit: s && s.unmatchedBookings === 0 ? rounded(s.knownCredit) : null,
      unmatchedBookings: s?.unmatchedBookings ?? 0,
      paymentCount: p?.paymentCount ?? 0,
      receipts: p && p.invalidPayments === 0 ? rounded(p.receipts) : null,
      refunds: p && p.invalidPayments === 0 ? rounded(p.refunds) : null,
      invalidPayments: p?.invalidPayments ?? 0,
      netReceipts:
        p && p.invalidPayments === 0 ? rounded(p.receipts - p.refunds) : null,
    };
  });
  return {
    available: true,
    currencies,
    reason: currencies.length
      ? null
      : "لا حجوزات أو دفعات مسجلة في الفترة؛ لا نستنتج الإيراد من عروض الأسعار",
    realizedProfit: null,
    realizedProfitReason:
      "لا يوجد دفتر اعتراف بالإيراد والتكلفة الفعلية؛ الهامش المعروض تقديري فقط",
    exchangeRates: { base: "JOD", source: null, converted: false },
  };
}
export function taskMetrics(ctx, filters, range, at) {
  if (!can(ctx.user, "tasks:read"))
    return {
      available: false,
      reason: "لا تملك صلاحية المهام",
      summary: null,
      employees: [],
    };
  const w = taskWhere(ctx, filters),
    done = `(SELECT e.created_at FROM task_events e WHERE e.task_id=t.id AND json_valid(e.after_json) AND json_extract(CASE WHEN json_valid(e.after_json) THEN e.after_json ELSE '{}' END,'$.status')='done' AND (e.before_json IS NULL OR (json_valid(e.before_json) AND COALESCE(json_extract(CASE WHEN json_valid(e.before_json) THEN e.before_json ELSE '{}' END,'$.status'),'')!='done')) ORDER BY e.id DESC LIMIT 1)`;
  const select = `SELECT t.*,${done} AS done_at FROM tasks t WHERE ${w.sql} AND ${during("t.due_at")} AND julianday(t.created_at)<=julianday(?)`;
  const params = [...w.params, range.start, range.end, at];
  const aggregate = `COUNT(*) total,COALESCE(SUM(status='done'),0) done,COALESCE(SUM(status='cancelled'),0) cancelled,COALESCE(SUM(status NOT IN('done','cancelled') AND julianday(due_at)<julianday(?)),0) overdue,COALESCE(SUM(status='done' AND julianday(done_at)>=julianday(created_at) AND julianday(done_at)<=julianday(?)),0) completionSamples,COALESCE(SUM(status='done' AND julianday(done_at)>=julianday(created_at) AND julianday(done_at)<=julianday(due_at) AND julianday(done_at)<=julianday(?)),0) onTime`;
  const summary = one(
    ctx.db,
    `WITH measured AS (${select}) SELECT ${aggregate} FROM measured`,
    [...params, at, at, at],
  );
  summary.onTimeRate = rate(summary.onTime, summary.completionSamples);
  summary.missingCompletion = summary.done - summary.completionSamples;
  const employees = q(
    ctx.db,
    `WITH measured AS (${select}) SELECT assigned_to AS employeeId,${aggregate} FROM measured GROUP BY assigned_to ORDER BY total DESC LIMIT 100`,
    [...params, at, at, at],
  );
  return {
    available: true,
    summary,
    employees,
    cohort: "due_at",
    groupLimit: 100,
  };
}
function customerMetric(ctx, filters, range, at) {
  if (!can(ctx.user, "customers:read"))
    return { available: false, count: null, reason: "لا تملك صلاحية العملاء" };
  const w = requestWhere(ctx, filters),
    org =
      (!ctx.user.roleKey || ctx.user.dataScope === "organization") &&
      !Object.keys(filters).length;
  const r = one(
    ctx.db,
    `SELECT COUNT(*) n FROM customers c WHERE ${during("c.created_at")} AND julianday(c.created_at)<=julianday(?)${org ? "" : ` AND EXISTS(SELECT 1 FROM requests r WHERE r.customer_id=c.id AND ${w.sql})`}`,
    [range.start, range.end, at, ...(org ? [] : w.params)],
  );
  return { available: true, count: r.n, reason: null };
}
const delta = (current, previous) => ({
  current,
  previous,
  change:
    current == null || previous == null ? null : rounded(current - previous),
  percent:
    current == null || !previous
      ? null
      : rounded(((current - previous) / previous) * 100),
});
function metadata(ctx) {
  const u = ctx.user,
    org = !u.roleKey || u.dataScope === "organization";
  let sql = "1",
    args = [];
  if (!org) {
    sql =
      "(u.branch_id=? OR EXISTS(SELECT 1 FROM staff_memberships m WHERE m.user_id=u.id AND m.active=1 AND m.branch_id=?))";
    args = [u.branchId ?? null, u.branchId ?? null];
    if (["department", "assigned"].includes(u.dataScope)) {
      sql =
        "((u.branch_id=? AND u.department_id IS ?) OR EXISTS(SELECT 1 FROM staff_memberships m WHERE m.user_id=u.id AND m.active=1 AND m.branch_id=? AND m.department_id IS ?))";
      args = [
        u.branchId ?? null,
        u.departmentId ?? null,
        u.branchId ?? null,
        u.departmentId ?? null,
      ];
    }
    if (u.dataScope === "assigned") {
      sql += " AND u.id=?";
      args.push(u.id);
    }
  }
  return {
    agents: q(
      ctx.db,
      `SELECT u.id,u.name FROM users u WHERE u.active=1 AND ${sql} ORDER BY name`,
      args,
    ),
    branches: q(
      ctx.db,
      "SELECT id,name FROM branches WHERE active=1" + (org ? "" : " AND id=?"),
      org ? [] : [u.branchId ?? null],
    ),
    departments: q(
      ctx.db,
      "SELECT id,name,branch_id FROM departments WHERE active=1" +
        (org
          ? ""
          : ["department", "assigned"].includes(u.dataScope)
            ? " AND id IS ?"
            : " AND (branch_id IS NULL OR branch_id=?)"),
      org
        ? []
        : [
            ["department", "assigned"].includes(u.dataScope)
              ? (u.departmentId ?? null)
              : (u.branchId ?? null),
          ],
    ),
  };
}
export function buildReport(ctx, { at = new Date().toISOString() } = {}) {
  reportAccess(ctx);
  registerReportTime(ctx.db);
  const filters = reportFilters(ctx.query),
    range = reportRange(ctx.query, at),
    summary = requestSummary(ctx, filters, range, at),
    previous = requestSummary(ctx, filters, range.previous, at),
    w = cohort(ctx, filters, range, at);
  const groups = (column, join = "", name = column) =>
    q(
      ctx.db,
      `SELECT ${column} AS key,${name} AS name,COUNT(*) total,COALESCE(SUM(r.deal_status='won'),0) won,COALESCE(SUM(r.deal_status='lost'),0) lost FROM requests r ${join} WHERE ${w.sql} GROUP BY ${column} ORDER BY total DESC,key LIMIT 100`,
      w.params,
    ).map((r) => ({ ...r, conversion: rate(r.won, r.total) }));
  const employeeTimes = q(
    ctx.db,
    `SELECT r.assigned_to id,AVG(CASE WHEN ${responseValid} THEN (julianday(r.first_response_at)-julianday(r.created_at))*1440 END) response,AVG(CASE WHEN ${completionValid} THEN (julianday(r.completed_at)-julianday(r.created_at))*1440 END) completion FROM requests r WHERE ${w.sql} GROUP BY r.assigned_to`,
    [at, at, ...w.params],
  );
  const employees = groups(
    "r.assigned_to",
    "LEFT JOIN users u ON u.id=r.assigned_to",
    "COALESCE(u.name,'غير مسند')",
  ).map((r) => {
    const t = employeeTimes.find((t) => t.id === r.key);
    return {
      ...r,
      employeeId: r.key,
      revenue: null,
      avgResponseMinutes: rounded(t?.response),
      avgCompletionMinutes: rounded(t?.completion),
      avgResponseLabel: durationLabel(t?.response),
      avgCompletionLabel: durationLabel(t?.completion),
    };
  });
  const transferScope = requestWhere(ctx, filters),
    transfers = one(
      ctx.db,
      `SELECT COUNT(DISTINCT CASE WHEN x.from_branch_id IS NOT x.to_branch_id THEN x.request_id END) betweenBranches,COUNT(DISTINCT CASE WHEN x.from_department_id IS NOT x.to_department_id THEN x.request_id END) betweenDepartments FROM request_transfers x JOIN requests r ON r.id=x.request_id WHERE ${transferScope.sql} AND ${during("x.created_at")} AND julianday(x.created_at)<=julianday(?)`,
      [...transferScope.params, range.start, range.end, at],
    );
  const byType = groups("r.type").map((r) => ({
    ...r,
    type: r.key,
    label: REQUEST_TYPES[r.key]?.label || r.key,
  }));
  const daily = q(
      ctx.db,
      `SELECT report_day(r.created_at) bucket,COUNT(*) total,COALESCE(SUM(r.deal_status='won'),0) won,COALESCE(SUM(r.deal_status='lost'),0) lost FROM requests r WHERE ${w.sql} GROUP BY bucket ORDER BY bucket`,
      w.params,
    ),
    series = [];
  for (let day = range.from; day <= range.to; day = shiftDay(day, 1))
    series.push(
      daily.find((r) => r.bucket === day) || {
        bucket: day,
        total: 0,
        won: 0,
        lost: 0,
      },
    );
  const status = q(
    ctx.db,
    `SELECT r.status,COUNT(*) total FROM requests r WHERE ${w.sql} GROUP BY r.status`,
    w.params,
  );
  const lostReasons = q(
    ctx.db,
    `SELECT COALESCE(NULLIF(TRIM(r.lost_reason),''),'غير مسجل') reason,COUNT(*) total FROM requests r WHERE ${w.sql} AND r.deal_status='lost' GROUP BY reason ORDER BY total DESC,reason LIMIT 100`,
    w.params,
  );
  const finance = financeMetrics(ctx, filters, range, at),
    previousFinance = financeMetrics(ctx, filters, range.previous, at),
    customers = customerMetric(ctx, filters, range, at),
    oldCustomers = customerMetric(ctx, filters, range.previous, at);
  const comparable = Object.fromEntries(
    [
      "total",
      "won",
      "lost",
      "conversion",
      "winRate",
      "responseRate",
      "avgResponseMinutes",
      "avgCompletionMinutes",
      "overdue",
    ].map((k) => [k, delta(summary[k], previous[k])]),
  );
  return {
    ok: true,
    range,
    filters,
    generatedAt: at,
    summary,
    previous,
    comparison: comparable,
    transfers,
    employees,
    byType,
    bySource: groups(originSql("r")),
    byDepartment: groups(
      "r.department_id",
      "LEFT JOIN departments d ON d.id=r.department_id",
      "COALESCE(d.name,'غير محدد')",
    ),
    receivedBranches: groups(
      "r.received_branch_id",
      "LEFT JOIN branches b ON b.id=r.received_branch_id",
      "COALESCE(b.name,'غير محدد')",
    ),
    executionBranches: groups(
      "r.branch_id",
      "LEFT JOIN branches b ON b.id=r.branch_id",
      "COALESCE(b.name,'غير محدد')",
    ),
    lostReasons,
    funnel: Object.entries(STATUSES).map(([key, meta]) => ({
      status: key,
      label: meta.label,
      total: status.find((r) => r.status === key)?.total || 0,
    })),
    series,
    customers,
    customerComparison: delta(customers.count, oldCustomers.count),
    finance,
    previousFinance,
    financialComparison: finance.currencies.map((r) => ({
      currency: r.currency,
      bookedAmount: delta(
        r.bookedAmount,
        previousFinance.currencies.find((p) => p.currency === r.currency)
          ?.bookedAmount ?? null,
      ),
      netReceipts: delta(
        r.netReceipts,
        previousFinance.currencies.find((p) => p.currency === r.currency)
          ?.netReceipts ?? null,
      ),
    })),
    tasks: taskMetrics(ctx, filters, range, at),
    ...metadata(ctx),
    definitions: DEFINITIONS,
    limits: { groupRows: 100, detailsPage: 50, maxRangeDays: 366 },
    availability: {
      campaigns: {
        available: false,
        reason:
          "لا يوجد ربط معتمد بين الحملة والطلب والإنفاق؛ أحداث الزيارة ليست عائد حملة",
      },
      customerSatisfaction: {
        available: false,
        reason: "لا توجد تقييمات موثقة لجودة الخدمة أو رضا العملاء",
      },
      trueFirstContact: {
        available: false,
        reason: "الحقل المتاح أول إجراء موظف، لا سجل مراسلات يثبت أول رد",
      },
    },
    warnings: [
      "النتائج تعكس الحالات والإسنادات الحالية، وليست لقطة تاريخية غير قابلة للتعديل.",
      "جدول المجموعات يعرض أول 100 مجموعة؛ المجاميع والمؤشرات تحسب كل الصفوف المطابقة. استخدم الفلاتر والتفاصيل لتضييق النطاق.",
      "النطاق مبني على أيام Asia/Amman، والفترة السابقة لها العدد نفسه من الأيام.",
    ],
  };
}
export function detailQuery(
  ctx,
  { at = new Date().toISOString(), limit = 50, offset = 0 } = {},
) {
  reportAccess(ctx);
  registerReportTime(ctx.db);
  const f = reportFilters(ctx.query),
    range = reportRange(ctx.query, at),
    kind = ctx.query.kind || "requests";
  let select, from, where, params;
  if (
    ["requests", "won", "lost", "overdue", "responded", "closed"].includes(kind)
  ) {
    const w = cohort(ctx, f, range, at),
      extra =
        kind === "won"
          ? " AND r.deal_status='won'"
          : kind === "lost"
            ? " AND r.deal_status='lost'"
            : kind === "overdue"
              ? ` AND r.deal_status NOT IN('won','lost') AND ${requestLate}`
              : kind === "responded"
                ? ` AND ${responseValid}`
                : kind === "closed"
                  ? ` AND ${completionValid}`
                  : "";
    select =
      "r.id,r.reference,r.type,r.status,r.deal_status,r.assigned_to,r.created_at,r.first_response_at,r.completed_at,r.branch_id,r.department_id,r.lost_reason," +
      originSql("r") +
      " AS lead_origin";
    from = "FROM requests r";
    where = w.sql + extra;
    params = [
      ...w.params,
      ...(["overdue", "responded", "closed"].includes(kind) ? [at] : []),
    ];
  } else if (kind === "bookings" || kind === "payments") {
    if (!can(ctx.user, "reports:finance"))
      return {
        available: false,
        items: [],
        total: null,
        reason: "تحتاج صلاحية التقارير المالية",
      };
    const w = requestWhere(ctx, f);
    from =
      kind === "bookings"
        ? "FROM bookings b JOIN requests r ON r.id=b.request_id"
        : "FROM booking_payments p JOIN bookings b ON b.id=p.booking_id JOIN requests r ON r.id=b.request_id";
    const c = kind === "bookings" ? "b.confirmed_at" : "p.created_at";
    where =
      w.sql +
      ` AND ${during(c)} AND julianday(${c})<=julianday(?)` +
      (kind === "bookings" ? " AND b.status='confirmed'" : "");
    params = [...w.params, range.start, range.end, at];
    select =
      kind === "bookings"
        ? "b.id,b.reference,b.amount,b.cost_amount,b.currency,b.confirmed_at,r.id AS request_id,r.reference AS request_reference"
        : "p.id,p.kind,p.amount,p.currency,p.reference,p.created_at,b.reference AS booking_reference,r.id AS request_id,r.reference AS request_reference";
  } else if (kind === "tasks") {
    if (!can(ctx.user, "tasks:read"))
      return {
        available: false,
        items: [],
        total: null,
        reason: "لا تملك صلاحية المهام",
      };
    const w = taskWhere(ctx, f);
    from = "FROM tasks t";
    where =
      w.sql +
      ` AND ${during("t.due_at")} AND julianday(t.created_at)<=julianday(?)`;
    params = [...w.params, range.start, range.end, at];
    select =
      "t.id,t.title,t.status,t.assigned_to,t.due_at,t.created_at,t.branch_id,t.department_id";
  } else throw new HttpError(400, "نوع تفاصيل غير صالح");
  if (ctx.query.currency && ["bookings", "payments"].includes(kind)) {
    where += " AND " + moneyCode(kind === "bookings" ? "b" : "p") + "=?";
    params.push(String(ctx.query.currency).slice(0, 100));
  }
  return {
    available: true,
    kind,
    range,
    filters: f,
    total: one(ctx.db, `SELECT COUNT(*) n ${from} WHERE ${where}`, params).n,
    items: q(
      ctx.db,
      `SELECT ${select} ${from} WHERE ${where} ORDER BY ${kind === "tasks" ? "t" : kind === "payments" ? "p" : kind === "bookings" ? "b" : "r"}.id DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset],
    ),
    limit,
    offset,
  };
}
