import { ASSET_V } from "./views/layout.js";
import { esc } from "./util.js";
const n = (v) =>
  v === null || v === undefined
    ? "غير متاح"
    : typeof v === "number"
      ? v.toLocaleString("en-US", { maximumFractionDigits: 3 })
      : String(v);
const table = (heads, rows) =>
  `<table><thead><tr>${heads.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((v) => `<td>${esc(n(v))}</td>`).join("")}</tr>`).join("") || `<tr><td colspan="${heads.length}">لا بيانات مسجلة</td></tr>`}</tbody></table>`;
export function reportDocument(d) {
  const names = {
    branch: "الفرع المنفذ",
    receivedBranch: "فرع الاستقبال",
    department: "القسم",
    employee: "الموظف",
    type: "الخدمة",
    source: "المصدر",
  };
  const metricNames = {
    total: "الطلبات الجديدة",
    won: "طلبات مؤكدة",
    lost: "ملغية",
    conversion: "التحويل %",
    winRate: "الفوز %",
    avgResponseMinutes: "أول إجراء (دقيقة)",
    avgCompletionMinutes: "الإغلاق (دقيقة)",
    overdue: "متابعات متأخرة",
  };
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>تقرير أداء Laurette Travel</title><link rel="stylesheet" href="/assets/fonts/cairo.css"><link rel="stylesheet" href="/assets/css/report-document.css?v=${ASSET_V}"></head><body data-filename="Laurette-report-${d.range.from}_${d.range.to}"><nav><button id="rdPdf">تنزيل PDF</button><button id="rdPrint">طباعة</button><span id="rdStatus" role="status"></span></nav><main id="rdSheet"><header class="vd-block"><img src="/media/brand/logo.png" alt="Laurette Travel" width="150"><span>LAURETTE TRAVEL</span><h1>تقرير الأداء والتشغيل</h1><p>${esc(d.range.from)} إلى ${esc(d.range.to)} · Asia/Amman</p><p>الفترة السابقة: ${esc(d.range.previous.from)} إلى ${esc(d.range.previous.to)}</p><p>توليد: ${esc(d.generatedAt)} (UTC) · العملة الأساسية JOD دون تحويل</p><p>الفلاتر: ${esc(
    Object.entries(d.filters)
      .map(([k, v]) => `${names[k]}: ${v}`)
      .join(" · ") || "كل البيانات ضمن نطاق الجلسة المصرح",
  )}</p></header>
 <section><h2>المؤشرات والمقارنة</h2>${table(
   ["المؤشر", "الحالي", "السابق", "التغير"],
   Object.entries(metricNames).map(([k, label]) => [
     label,
     d.summary[k],
     d.comparison[k]?.previous ?? null,
     d.comparison[k]?.change ?? null,
   ]),
 )}<p class="vd-block">عينات أول إجراء: ${d.summary.responseSamples}/${d.summary.total}؛ عينات الإغلاق: ${d.summary.completionSamples}. العملاء الجدد: ${n(d.customers.count)}.</p></section>
 <section><h2>أداء الموظفين — الإسناد الحالي</h2>${table(
   ["الموظف", "طلبات", "مؤكدة", "ملغية", "التحويل %"],
   d.employees.map((r) => [r.name, r.total, r.won, r.lost, r.conversion]),
 )}</section>
 ${[
   ["byType", "الخدمات"],
   ["bySource", "المصادر"],
   ["executionBranches", "الفروع المنفذة"],
   ["receivedBranches", "فروع الاستقبال"],
   ["byDepartment", "الأقسام"],
 ]
   .map(
     ([k, title]) =>
       `<section><h2>${title}</h2>${table(
         ["البعد", "طلبات", "مؤكدة", "ملغية"],
         d[k].map((r) => [r.label || r.name || r.key, r.total, r.won, r.lost]),
       )}</section>`,
   )
   .join("")}
 <section><h2>أسباب الخسارة</h2>${table(
   ["السبب", "العدد"],
   d.lostReasons.map((r) => [r.reason, r.total]),
 )}</section>
 <section><h2>الحجوزات حسب عملتها — ليست تحصيلات أو أرباحًا محققة</h2>${
   d.finance.available
     ? table(
         [
           "العملة",
           "عدد",
           "قيمة الحجز",
           "التكلفة الكاملة",
           "هامش تقديري",
           "عينات التكلفة",
         ],
         d.finance.currencies.map((r) => [
           r.currency,
           r.bookingCount,
           r.bookedAmount,
           r.cost,
           r.estimatedMargin,
           `${r.costSamples}/${r.bookingCount}`,
         ]),
       )
     : `<p class="vd-block">${esc(d.finance.reason)}</p>`
 }${d.finance.reason ? `<p class="vd-block">${esc(d.finance.reason)}</p>` : ""}</section>
 <section><h2>التدفق النقدي ورصيد حجوزات الفترة الحالي</h2>${
   d.finance.available
     ? table(
         [
           "العملة",
           "قبض الفترة",
           "استرداد الفترة",
           "صافي الفترة",
           "رصيد مستحق حالي",
           "رصيد زائد",
         ],
         d.finance.currencies.map((r) => [
           r.currency,
           r.receipts,
           r.refunds,
           r.netReceipts,
           r.outstanding,
           r.credit,
         ]),
       )
     : '<p class="vd-block">غير متاح</p>'
 }<p class="vd-block">لا توجد بيانات اعتراف محاسبي لإثبات الربح المحقق. الدفعات ذات العملة المختلفة عن الحجز تمنع استنتاج الرصيد الكامل.</p></section>
 <section><h2>التزام المهام حسب الاستحقاق</h2>${d.tasks.available ? table(["مستحقة", "منجزة", "متأخرة حاليًا", "عينات إنجاز", "في الموعد", "الالتزام %"], [[d.tasks.summary.total, d.tasks.summary.done, d.tasks.summary.overdue, d.tasks.summary.completionSamples, d.tasks.summary.onTime, d.tasks.summary.onTimeRate]]) : `<p class="vd-block">${esc(d.tasks.reason)}</p>`}</section>
 <section><h2>الأهداف — نتيجة كل هدف لفترته الكاملة</h2>${table(
   ["الجهة/الموظف", "الفترة", "المقياس", "الهدف", "الفعلي", "%"],
   d.targets.items.map((g) => [
     g.employee_name || g.department_name || g.branch_name,
     `${g.from_day} / ${g.to_day}`,
     `${g.metric} ${g.currency || ""}`,
     g.value,
     g.actual,
     g.progress,
   ]),
 )}<p class="vd-block">${esc(d.targets.reason || "")}</p></section>
 <section><h2>التعريفات وحدود القياس</h2>${d.definitions.map(([, name, body]) => `<p class="vd-block"><b>${esc(name)}:</b> ${esc(body)}</p>`).join("")}${d.warnings.map((w) => `<p class="vd-block">${esc(w)}</p>`).join("")}<p class="vd-block">الحملات: ${esc(d.availability.campaigns.reason)}. الرضا: ${esc(d.availability.customerSatisfaction.reason)}.</p></section>
 <footer class="vd-block">Laurette Travel · تقرير داخلي خاص بالنطاق المصرح · المصدر قاعدة النظام وقت التوليد</footer></main><script src="/assets/js/report-document.js?v=${ASSET_V}" defer></script></body></html>`;
}
