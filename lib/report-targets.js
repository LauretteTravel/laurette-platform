import { one, q, exec, transaction } from "./db.js";
import { can, sessionUser } from "./auth.js";
import { HttpError, json, readJson } from "./http.js";
import {
  reportAccess,
  reportFilters,
  targetWhere,
  requestWhere,
} from "./report-access.js";
import { reportRange } from "./report-time.js";
import { taskUnit } from "./task-access.js";
import { audit } from "./domain.js";
const now = () => new Date().toISOString();
function visible(ctx) {
  const w = targetWhere(ctx);
  const r = one(
    ctx.db,
    `SELECT g.* FROM report_targets g WHERE g.id=? AND ${w.sql}${can(ctx.user, "reports:finance") ? "" : " AND g.metric!='net_receipts'"}`,
    [Number(ctx.params.id), ...w.params],
  );
  if (!r) throw new HttpError(404, "الهدف غير موجود في نطاقك");
  return r;
}
function reason(b) {
  if (
    typeof b.reason !== "string" ||
    b.reason.trim().length < 3 ||
    b.reason.length > 500
  )
    throw new HttpError(422, "سبب التعديل مطلوب (3–500 حرف)");
  return b.reason.trim();
}
function refresh(ctx) {
  ctx.user = sessionUser(ctx.db, ctx.token);
  reportAccess(ctx);
  if (!can(ctx.user, "reports:targets"))
    throw new HttpError(403, "تحتاج صلاحية إدارة الأهداف");
}
function value(v, metric) {
  if (
    typeof v !== "number" ||
    !Number.isFinite(v) ||
    v <= 0 ||
    v > 1e9 ||
    (metric !== "net_receipts" && !Number.isInteger(v)) ||
    Math.abs(v * 1000 - Math.round(v * 1000)) > 0.00001
  )
    throw new HttpError(
      422,
      "هدف موجب صالح مطلوب؛ أعداد الطلبات صحيحة والمبالغ حتى 3 منازل",
    );
  return v;
}
function targetUnit(ctx, b) {
  taskUnit(ctx, b.branchId, b.departmentId);
  if (
    ctx.user.roleKey &&
    ctx.user.dataScope === "assigned" &&
    b.employeeId !== ctx.user.id
  )
    throw new HttpError(403, "يمكنك إدارة هدفك الشخصي فقط");
  if (
    b.employeeId !== null &&
    (!Number.isInteger(b.employeeId) ||
      !one(
        ctx.db,
        `SELECT u.id FROM users u WHERE u.id=? AND u.active=1 AND ((u.branch_id=? AND u.department_id IS ?) OR EXISTS(SELECT 1 FROM staff_memberships m WHERE m.user_id=u.id AND m.active=1 AND m.branch_id=? AND m.department_id IS ?))`,
        [b.employeeId, b.branchId, b.departmentId, b.branchId, b.departmentId],
      ))
  )
    throw new HttpError(422, "اختر موظفًا نشطًا في جهة الهدف");
}
function overlap(ctx, r, except = 0) {
  if (
    one(
      ctx.db,
      "SELECT 1 FROM report_targets WHERE id!=? AND active=1 AND branch_id=? AND department_id IS ? AND employee_id IS ? AND metric=? AND currency IS ? AND from_day<=? AND to_day>=?",
      [
        except,
        r.branch_id,
        r.department_id,
        r.employee_id,
        r.metric,
        r.currency,
        r.to_day,
        r.from_day,
      ],
    )
  )
    throw new HttpError(
      409,
      "يوجد هدف نشط متداخل للجهة والمقياس والفترة نفسها",
    );
}
function event(ctx, before, after, why) {
  exec(
    ctx.db,
    "INSERT INTO report_target_events(target_id,actor_id,reason,before_json,after_json,revision,created_at) VALUES(?,?,?,?,?,?,?)",
    [
      after.id,
      ctx.user.id,
      why,
      before ? JSON.stringify(before) : null,
      JSON.stringify(after),
      after.revision,
      now(),
    ],
  );
  audit(ctx.db, {
    user: ctx.user,
    action: "report.target",
    entity: "report_target",
    entityId: after.id,
    meta: { reason: why, revision: after.revision },
    ip: ctx.ip,
  });
}
function actual(ctx, g, at) {
  const filters = {
      branch: g.branch_id,
      ...(g.department_id === null ? {} : { department: g.department_id }),
      ...(g.employee_id === null ? {} : { employee: g.employee_id }),
    },
    w = requestWhere(ctx, filters),
    r = reportRange({ from: g.from_day, to: g.to_day }, at);
  if (g.metric === "net_receipts") {
    if (!can(ctx.user, "reports:finance")) return null;
    const s = one(
      ctx.db,
      `SELECT COUNT(*) samples,SUM(CASE WHEN typeof(p.amount) IN('integer','real') AND p.amount>0 AND p.amount<=1000000000000000 THEN 0 ELSE 1 END) invalid,SUM(CASE WHEN p.kind='receipt' THEN p.amount ELSE -p.amount END) total FROM booking_payments p JOIN bookings b ON b.id=p.booking_id JOIN requests r ON r.id=b.request_id WHERE ${w.sql} AND (CASE WHEN UPPER(TRIM(p.currency)) IN('JOD','JD','د.أ','د.ا') THEN 'JOD' ELSE UPPER(TRIM(p.currency)) END)=? AND julianday(p.created_at)>=julianday(?) AND julianday(p.created_at)<julianday(?) AND julianday(p.created_at)<=julianday(?)`,
      [...w.params, g.currency, r.start, r.end, at],
    );
    return s.samples && !s.invalid ? Math.round(s.total * 1000) / 1000 : null;
  }
  return one(
    ctx.db,
    `SELECT COUNT(*) n FROM requests r WHERE ${w.sql} AND julianday(r.created_at)>=julianday(?) AND julianday(r.created_at)<julianday(?) AND julianday(r.created_at)<=julianday(?)${g.metric === "confirmed_requests" ? " AND r.deal_status='won'" : ""}`,
    [...w.params, r.start, r.end, at],
  ).n;
}
export function targetData(ctx, { at = now() } = {}) {
  reportAccess(ctx);
  const filters = reportFilters(ctx.query),
    range = reportRange(ctx.query, at);
  if (filters.source || filters.type || filters.receivedBranch)
    return {
      available: true,
      items: [],
      total: 0,
      reason:
        "الأهداف للجهة والمسؤول؛ أزل مرشح المصدر والخدمة وفرع الاستقبال لعرض التقدم الكامل دون احتساب جزئي",
    };
  const w = targetWhere(ctx, filters),
    sql = `${w.sql} AND g.from_day<=? AND g.to_day>=?${can(ctx.user, "reports:finance") ? "" : " AND g.metric!='net_receipts'"}`,
    params = [...w.params, range.to, range.from];
  const rows = q(
    ctx.db,
    `SELECT g.*,b.name branch_name,d.name department_name,u.name employee_name FROM report_targets g JOIN branches b ON b.id=g.branch_id LEFT JOIN departments d ON d.id=g.department_id LEFT JOIN users u ON u.id=g.employee_id WHERE ${sql} ORDER BY g.active DESC,g.from_day DESC,g.id DESC LIMIT 50`,
    params,
  );
  return {
    available: true,
    items: rows.map((g) => {
      const v = actual(ctx, g, at);
      return {
        ...g,
        actual: v,
        progress: v === null ? null : Math.round((v / g.value) * 1000) / 10,
      };
    }),
    total: one(
      ctx.db,
      `SELECT COUNT(*) n FROM report_targets g WHERE ${sql}`,
      params,
    ).n,
    limit: 50,
    reason:
      "نتيجة كل هدف لفترته وجهته الكاملتين وحالته الحالية، وليست جزء الفترة المعروضة",
  };
}
export function listTargets(ctx) {
  return json(ctx.res, 200, { ok: true, ...targetData(ctx) });
}
export async function createTarget(ctx) {
  const b = await readJson(ctx.req, 8192);
  refresh(ctx);
  const why = reason(b);
  if (!["requests", "confirmed_requests", "net_receipts"].includes(b.metric))
    throw new HttpError(422, "مقياس هدف غير صالح");
  if (b.metric === "net_receipts" && !can(ctx.user, "reports:finance"))
    throw new HttpError(403, "تحتاج صلاحية التقارير المالية");
  const range = reportRange({ from: b.from, to: b.to });
  if (!b.from || !b.to) throw new HttpError(422, "فترة الهدف مطلوبة");
  const currency = b.metric === "net_receipts" ? b.currency : null;
  if (
    b.metric === "net_receipts" &&
    !["JOD", "USD", "EUR", "SAR", "AED", "TRY", "EGP", "GBP"].includes(currency)
  )
    throw new HttpError(422, "عملة الهدف مطلوبة دون تحويل");
  const unit = {
    ...b,
    departmentId: b.departmentId ?? null,
    employeeId: b.employeeId ?? null,
  };
  targetUnit(ctx, unit);
  const v = value(b.value, b.metric);
  let id;
  transaction(ctx.db, () => {
    const r = {
      branch_id: b.branchId,
      department_id: unit.departmentId,
      employee_id: unit.employeeId,
      metric: b.metric,
      currency,
      from_day: range.from,
      to_day: range.to,
    };
    overlap(ctx, r);
    id = Number(
      exec(
        ctx.db,
        "INSERT INTO report_targets(branch_id,department_id,employee_id,metric,currency,from_day,to_day,value,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
        [
          r.branch_id,
          r.department_id,
          r.employee_id,
          r.metric,
          r.currency,
          r.from_day,
          r.to_day,
          v,
          ctx.user.id,
          now(),
          now(),
        ],
      ).lastInsertRowid,
    );
    event(
      ctx,
      null,
      one(ctx.db, "SELECT * FROM report_targets WHERE id=?", [id]),
      why,
    );
  });
  return json(ctx.res, 201, { ok: true, id });
}
export async function updateTarget(ctx) {
  const b = await readJson(ctx.req, 8192);
  refresh(ctx);
  const why = reason(b);
  if (
    Object.keys(b).some(
      (k) => !["value", "active", "revision", "reason"].includes(k),
    )
  )
    throw new HttpError(
      422,
      "جهة الهدف وفترته ومقياسه ثابتة؛ أوقفه وأنشئ بديلًا لتغييرها",
    );
  transaction(ctx.db, () => {
    const r = visible(ctx);
    if (b.revision !== r.revision)
      throw new HttpError(409, "تغير الهدف؛ أعد تحميله");
    const active =
      b.active === undefined
        ? r.active
        : b.active === true
          ? 1
          : b.active === false
            ? 0
            : null;
    if (active === null) throw new HttpError(422, "حالة الهدف غير صالحة");
    const v = b.value === undefined ? r.value : value(b.value, r.metric);
    if (active) overlap(ctx, r, r.id);
    exec(
      ctx.db,
      "UPDATE report_targets SET value=?,active=?,revision=revision+1,updated_at=? WHERE id=?",
      [v, active, now(), r.id],
    );
    event(
      ctx,
      r,
      one(ctx.db, "SELECT * FROM report_targets WHERE id=?", [r.id]),
      why,
    );
  });
  return json(ctx.res, 200, { ok: true });
}
export function targetHistory(ctx) {
  reportAccess(ctx);
  const r = visible(ctx);
  return json(ctx.res, 200, {
    ok: true,
    target: r,
    events: q(
      ctx.db,
      "SELECT e.*,u.name actor FROM report_target_events e JOIN users u ON u.id=e.actor_id WHERE target_id=? ORDER BY e.id DESC LIMIT 100",
      [r.id],
    ),
  });
}
