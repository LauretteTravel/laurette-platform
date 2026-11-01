import { can } from "./auth.js";
import { requestScope } from "./api.js";
import { taskScope } from "./task-access.js";
import { HttpError } from "./http.js";
export function reportAccess(ctx) {
  if (!ctx.user) throw new HttpError(401, "يلزم تسجيل الدخول");
  if (
    ctx.user.mustChange ||
    (ctx.user.mfaRequired && !ctx.user.mfaVerified) ||
    !can(ctx.user, "reports:read") ||
    !can(ctx.user, "requests:read")
  )
    throw new HttpError(
      403,
      "تحتاج صلاحية التقارير وقراءة الطلبات وجلسة مكتملة",
    );
}
export function reportFilters(query = {}) {
  const f = {};
  for (const key of ["branch", "receivedBranch", "department", "employee"]) {
    const v = query[key];
    if (v == null || v === "") continue;
    if (v === "unassigned") {
      f[key] = v;
      continue;
    }
    const id = Number(v);
    if (!Number.isSafeInteger(id) || id < 1)
      throw new HttpError(400, "معرّف فلتر غير صالح");
    f[key] = id;
  }
  for (const key of ["type", "source"]) {
    const v = query[key];
    if (v == null || v === "") continue;
    if (typeof v !== "string" || v.length > 100)
      throw new HttpError(400, "فلتر نصي غير صالح");
    f[key] = v;
  }
  if (
    f.type &&
    ![
      "flight",
      "hotel",
      "program",
      "umrah",
      "visa",
      "consult",
      "cruise",
    ].includes(f.type)
  )
    throw new HttpError(400, "نوع خدمة غير صالح");
  return f;
}
export const originSql = (a) =>
  `COALESCE(NULLIF(TRIM(${a}.lead_origin),''),NULLIF(TRIM(${a}.source),''),'غير مسجل')`;
export function requestWhere(ctx, filters = {}, alias = "r") {
  const s = requestScope(ctx.user, alias),
    sql = [s.sql || "1"],
    params = [...s.params];
  if (ctx.user.roleKey && ctx.user.dataScope === "assigned") {
    sql.push(`${alias}.branch_id=? AND ${alias}.department_id IS ?`);
    params.push(ctx.user.branchId ?? null, ctx.user.departmentId ?? null);
  }
  for (const [key, col] of [
    ["branch", "branch_id"],
    ["receivedBranch", "received_branch_id"],
    ["department", "department_id"],
    ["type", "type"],
  ])
    if (filters[key] != null) {
      if (filters[key] === "unassigned") sql.push(`${alias}.${col} IS NULL`);
      else {
        sql.push(`${alias}.${col}=?`);
        params.push(filters[key]);
      }
    }
  if (filters.employee === "unassigned")
    sql.push(`${alias}.assigned_to IS NULL`);
  else if (filters.employee) {
    sql.push(`${alias}.assigned_to=?`);
    params.push(filters.employee);
  }
  if (filters.source) {
    sql.push(originSql(alias) + "=?");
    params.push(filters.source);
  }
  return { sql: sql.join(" AND "), params };
}
export function taskWhere(ctx, filters = {}) {
  const s = taskScope(ctx.user, "t"),
    sql = [s.sql],
    params = [...s.params];
  const linkedScope = requestWhere(ctx, {}, "report_link");
  sql.push(
    `(t.request_id IS NULL OR EXISTS(SELECT 1 FROM requests report_link WHERE report_link.id=t.request_id AND ${linkedScope.sql}))`,
  );
  params.push(...linkedScope.params);
  for (const [key, col] of [
    ["branch", "branch_id"],
    ["department", "department_id"],
    ["employee", "assigned_to"],
  ])
    if (filters[key] != null) {
      if (filters[key] === "unassigned") sql.push(`t.${col} IS NULL`);
      else {
        sql.push(`t.${col}=?`);
        params.push(filters[key]);
      }
    }
  const linked = Object.fromEntries(
    ["receivedBranch", "source", "type"]
      .filter((k) => filters[k] != null)
      .map((k) => [k, filters[k]]),
  );
  if (Object.keys(linked).length) {
    const r = requestWhere(ctx, linked, "f");
    sql.push(
      `EXISTS(SELECT 1 FROM requests f WHERE f.id=t.request_id AND ${r.sql})`,
    );
    params.push(...r.params);
  }
  return { sql: sql.join(" AND "), params };
}
export function targetWhere(ctx, filters = {}) {
  let sql = "1",
    params = [];
  const u = ctx.user;
  if (u.roleKey && u.dataScope !== "organization") {
    if (!u.branchId) return { sql: "0", params: [] };
    sql = "g.branch_id=?";
    params.push(u.branchId);
    if (["department", "assigned"].includes(u.dataScope)) {
      sql += " AND g.department_id IS ?";
      params.push(u.departmentId ?? null);
    } else if (u.dataScope !== "branch") return { sql: "0", params: [] };
    if (u.dataScope === "assigned") {
      sql += " AND g.employee_id=?";
      params.push(u.id);
    }
  }
  for (const [key, col] of [
    ["branch", "branch_id"],
    ["department", "department_id"],
    ["employee", "employee_id"],
  ])
    if (filters[key] != null) {
      if (filters[key] === "unassigned") sql += " AND 0";
      else {
        sql += ` AND g.${col}=?`;
        params.push(filters[key]);
      }
    }
  return { sql, params };
}
