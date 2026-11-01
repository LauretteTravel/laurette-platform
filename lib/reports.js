import { transaction } from "./db.js";
import { buildReport, detailQuery, DEFINITIONS } from "./report-engine.js";
import { targetData } from "./report-targets.js";
import { reportAccess } from "./report-access.js";
import { json, HttpError } from "./http.js";
import { can } from "./auth.js";
import { audit } from "./domain.js";
import { reportDocument } from "./report-document.js";
export const reportData = (ctx) =>
  transaction(ctx.db, () => {
    const data = buildReport(ctx);
    data.targets = targetData(ctx, { at: data.generatedAt });
    if (data.targets.total > data.targets.items.length)
      data.warnings.push(
        "الأهداف المعروضة أول 50 من " +
          data.targets.total +
          "؛ ضيق الجهة أو الفترة لعرض الباقي.",
      );
    return data;
  });
export function reports(ctx) {
  return json(ctx.res, 200, reportData(ctx));
}
export function details(ctx) {
  const n = ctx.query.page === undefined ? 1 : Number(ctx.query.page);
  if (!Number.isSafeInteger(n) || n < 1 || n > 100000)
    throw new HttpError(400, "صفحة غير صالحة");
  return json(ctx.res, 200, {
    ok: true,
    page: n,
    ...detailQuery(ctx, { offset: (n - 1) * 50 }),
  });
}
export function csvCell(value) {
  if (value == null) return '""';
  let s = String(value).replaceAll("\u0000", "");
  if (typeof value === "string" && /^[\s\uFEFF]*[=+@-]/.test(s)) s = "'" + s;
  return '"' + s.replaceAll('"', '""') + '"';
}
export function reportCsvRows(d) {
  const rows = [
      ["القسم", "المؤشر/الموظف", "القيمة", "العملة", "من", "إلى", "ملاحظة"],
    ],
    push = (section, key, value, currency = "", note = "") =>
      rows.push([
        section,
        key,
        value,
        currency,
        d.range.from,
        d.range.to,
        note,
      ]);
  const summaryLabels = {
    total: "الطلبات الجديدة",
    won: "طلبات مؤكدة",
    lost: "طلبات ملغية",
    open: "طلبات مفتوحة",
    conversion: "التحويل %",
    winRate: "الفوز %",
    lossRate: "الخسارة %",
    overdue: "متابعات متأخرة",
    responseRate: "عينات أول إجراء %",
    responseSamples: "عينات أول إجراء",
    completionSamples: "عينات الإغلاق",
    avgResponseMinutes: "أول إجراء - دقيقة",
    avgCompletionMinutes: "الإغلاق - دقيقة",
  };
  for (const [key, label] of Object.entries(summaryLabels))
    push("ملخص", label, d.summary[key]);
  push("تحويلات", "بين الفروع", d.transfers.betweenBranches);
  push("تحويلات", "بين الأقسام", d.transfers.betweenDepartments);
  for (const row of d.series) {
    push("تسلسل يومي", row.bucket, row.total, "", "طلبات جديدة");
    push("تسلسل يومي", row.bucket, row.won, "", "مؤكدة من مجموعة اليوم");
  }

  for (const [key, c] of Object.entries(d.comparison))
    push(
      "مقارنة",
      key,
      c.previous,
      "",
      `الفترة السابقة ${d.range.previous.from} إلى ${d.range.previous.to}؛ تغير ${c.change ?? "غير متاح"}؛ نسبة ${c.percent ?? "غير متاحة"}`,
    );
  for (const [key, title] of [
    ["employees", "الموظف"],
    ["byType", "الخدمة"],
    ["bySource", "المصدر"],
    ["executionBranches", "الفرع المنفذ"],
    ["receivedBranches", "فرع الاستقبال"],
    ["byDepartment", "القسم"],
  ])
    for (const row of d[key]) {
      push(
        title,
        (row.label ?? row.name ?? row.key) || "غير مسند",
        row.total,
        "",
        "عدد الطلبات",
      );
      push(
        title,
        (row.name ?? row.label ?? row.key) || "غير مسند",
        row.won,
        "",
        "طلبات مؤكدة",
      );
    }
  for (const e of d.employees) {
    push("زمن الموظف", e.name, e.avgResponseMinutes, "", "أول إجراء - دقيقة");
    push("زمن الموظف", e.name, e.avgCompletionMinutes, "", "الإغلاق - دقيقة");
  }
  for (const row of d.lostReasons) push("سبب الخسارة", row.reason, row.total);
  push(
    "العملاء",
    "عملاء CRM جدد",
    d.customers.count,
    "",
    d.customers.reason || "ضمن النطاق المصرح",
  );
  if (d.finance.available)
    for (const row of d.finance.currencies)
      for (const [key, label] of [
        ["bookingCount", "عدد الحجوزات"],
        ["bookedAmount", "قيمة الحجوزات"],
        ["cost", "التكلفة الكاملة"],
        ["estimatedMargin", "الهامش التقديري"],
        ["receipts", "القبض"],
        ["refunds", "الاسترداد"],
        ["netReceipts", "صافي التحصيل"],
        ["outstanding", "الرصيد الحالي لحجوزات الفترة"],
        ["credit", "رصيد زائد للعميل"],
      ])
        push(
          "مالي",
          label,
          row[key],
          row.currency,
          row[key] === null
            ? "غير متاح أو بيانات غير مكتملة"
            : "لا تحويل عملة؛ الهامش تقديري",
        );
  else push("مالي", "غير متاح", null, "", d.finance.reason);
  if (d.tasks.available)
    for (const [key, v] of Object.entries(d.tasks.summary))
      push("مهام", key, v, "", "مجموعة تاريخ الاستحقاق؛ عينات الإغلاق موثقة");
  else push("مهام", "غير متاح", null, "", d.tasks.reason);
  for (const g of d.targets.items) {
    push(
      "هدف",
      g.employee_name || g.department_name || g.branch_name,
      g.value,
      g.currency || "",
      `${g.metric}؛ فترة الهدف ${g.from_day} إلى ${g.to_day}`,
    );
    push(
      "نتيجة الهدف",
      g.employee_name || g.department_name || g.branch_name,
      g.actual,
      g.currency || "",
      `التقدم ${g.progress ?? "غير متاح"}%؛ فترة الهدف كاملة`,
    );
  }
  for (const row of d.definitions) push("تعريف", row[1], null, "", row[2]);
  for (const w of d.warnings) push("حدود", w, null);
  return rows;
}
function exportAccess(ctx) {
  reportAccess(ctx);
  if (!can(ctx.user, "reports:export"))
    throw new HttpError(403, "تحتاج صلاحية تصدير التقارير");
}
function recordExport(ctx, format, range) {
  audit(ctx.db, {
    user: ctx.user,
    action: "report.export",
    entity: "report",
    meta: { format, from: range.from, to: range.to, filters: ctx.query },
    ip: ctx.ip,
  });
}
export function reportsCsv(ctx) {
  exportAccess(ctx);
  let rows, range;
  if (ctx.query.section === "details") {
    const d = detailQuery(ctx, { limit: 10000 });
    if (!d.available) throw new HttpError(403, d.reason);
    if (d.total > 10000)
      throw new HttpError(
        422,
        "التفاصيل تتجاوز 10000 صف؛ ضيق الفلاتر للتصدير الكامل",
      );
    range = d.range;
    const fields = Object.keys(d.items[0] || { reference: null });
    rows = [fields, ...d.items.map((r) => fields.map((k) => r[k]))];
  } else {
    const d = reportData(ctx);
    range = d.range;
    rows = reportCsvRows(d);
  }
  recordExport(ctx, "csv", range);
  ctx.res.writeHead(200, {
    "content-type": "text/csv; charset=utf-8",
    "content-disposition": `attachment; filename="laurette-report-${range.from}_${range.to}.csv"`,
    "cache-control": "private, no-store",
    "x-content-type-options": "nosniff",
  });
  ctx.res.end(
    "\uFEFF" + rows.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n",
  );
}
export function document(ctx) {
  exportAccess(ctx);
  const d = reportData(ctx);
  recordExport(ctx, "pdf-document", d.range);
  ctx.res.writeHead(200, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "private, no-store",
    "x-content-type-options": "nosniff",
    "content-security-policy":
      "default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data:; connect-src 'none'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
  });
  ctx.res.end(reportDocument(d));
}
