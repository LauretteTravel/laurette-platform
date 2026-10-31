import { one, q } from "./db.js";
import { can } from "./auth.js";
import { requestScope } from "./api.js";
import { HttpError } from "./http.js";

export function taskScope(user, alias = "t") {
  const where = [],
    params = [];
  if (user.roleKey && user.dataScope !== "organization") {
    if (!user.branchId) return { sql: "0", params: [] };
    where.push(`${alias}.branch_id=?`);
    params.push(user.branchId);
    if (user.dataScope === "department") {
      if (!user.departmentId) return { sql: "0", params: [] };
      where.push(`${alias}.department_id=?`);
      params.push(user.departmentId);
    } else if (user.dataScope === "assigned") {
      where.push(
        `${alias}.department_id IS ? AND (${alias}.assigned_to=? OR ${alias}.created_by=? OR EXISTS(SELECT 1 FROM task_members m WHERE m.task_id=${alias}.id AND m.user_id=?))`,
      );
      params.push(user.departmentId, user.id, user.id, user.id);
    } else if (user.dataScope !== "branch") return { sql: "0", params: [] };
  }
  const scope = requestScope(user, "linked");
  where.push(
    can(user, "requests:read")
      ? `(${alias}.request_id IS NULL OR EXISTS(SELECT 1 FROM requests linked WHERE linked.id=${alias}.request_id${scope.sql ? " AND " + scope.sql : ""}))`
      : `${alias}.request_id IS NULL`,
  );
  if (can(user, "requests:read")) params.push(...scope.params);
  return { sql: where.join(" AND "), params };
}
export function visibleTask(ctx, id = ctx.params.id) {
  const scope = taskScope(ctx.user);
  const row = one(
    ctx.db,
    `SELECT t.* FROM tasks t WHERE t.id=? AND ${scope.sql}`,
    [Number(id), ...scope.params],
  );
  if (!row) throw new HttpError(404, "المهمة غير موجودة");
  return row;
}
export function linkedRequest(ctx, id) {
  if (!can(ctx.user, "requests:read"))
    throw new HttpError(403, "ربط المهمة يتطلب صلاحية الطلبات");
  const scope = requestScope(ctx.user);
  const row = one(
    ctx.db,
    `SELECT r.* FROM requests r WHERE r.id=?${scope.sql ? " AND " + scope.sql : ""}`,
    [Number(id), ...scope.params],
  );
  if (!row) throw new HttpError(404, "الطلب غير موجود");
  return row;
}
export function taskUnit(ctx, branchId, departmentId) {
  const branch = one(
    ctx.db,
    "SELECT id FROM branches WHERE id=? AND active=1",
    [branchId],
  );
  const dept =
    departmentId === null
      ? null
      : one(
          ctx.db,
          "SELECT id,branch_id FROM departments WHERE id=? AND active=1",
          [departmentId],
        );
  if (
    !Number.isInteger(branchId) ||
    !branch ||
    (departmentId !== null && (!Number.isInteger(departmentId) || !dept)) ||
    (dept?.branch_id && dept.branch_id !== branchId)
  )
    throw new HttpError(422, "اختر فرعًا وقسمًا نشطين ومتوافقين");
  if (
    ctx.user.roleKey &&
    ctx.user.dataScope !== "organization" &&
    (ctx.user.branchId !== branchId ||
      (["assigned", "department"].includes(ctx.user.dataScope) &&
        ctx.user.departmentId !== departmentId))
  )
    throw new HttpError(403, "الجهة خارج نطاقك الحالي");
}
function roleUser(row) {
  let permissions;
  try {
    permissions = row.permissions ? JSON.parse(row.permissions) : null;
  } catch {
    return null;
  }
  if (row.role_key && !row.data_scope) return null;
  return {
    id: row.id,
    role: row.role,
    roleKey: row.role_key,
    branchId: row.branch_id,
    departmentId: row.department_id,
    dataScope: row.data_scope || "organization",
    permissions,
  };
}
export function taskRecipients(ctx, branchId, departmentId, request) {
  let users = [];
  if (can(ctx.user, "tasks:assign"))
    users = q(
      ctx.db,
      `SELECT u.id,u.name,u.role,u.role_key,u.branch_id,u.department_id,r.permissions,r.data_scope FROM users u LEFT JOIN role_definitions r ON r.role_key=u.role_key AND r.active=1 WHERE u.active=1 AND u.branch_id=? AND u.department_id IS ?`,
      [branchId, departmentId],
    );
  const allowed = users
    .filter((row) => {
      const user = roleUser(row);
      if (!user || !can(user, "tasks:read")) return false;
      if (
        user.roleKey &&
        !["organization", "branch", "department", "assigned"].includes(
          user.dataScope,
        )
      )
        return false;
      if (request) {
        if (!can(user, "requests:read")) return false;
        const scope = requestScope(user);
        if (
          !one(
            ctx.db,
            `SELECT r.id FROM requests r WHERE r.id=?${scope.sql ? " AND " + scope.sql : ""}`,
            [request.id, ...scope.params],
          )
        )
          return false;
      }
      return true;
    })
    .map(({ id, name }) => ({ id, name }));
  if (can(ctx.user, "tasks:read") && !allowed.some((u) => u.id === ctx.user.id))
    allowed.unshift({ id: ctx.user.id, name: ctx.user.name });
  return allowed;
}

export function resolveLinkedRequest(ctx, input) {
  if (!input.requestReference)
    return input.requestId ? linkedRequest(ctx, input.requestId) : null;
  if (!can(ctx.user, "requests:read"))
    throw new HttpError(403, "ربط المهمة يتطلب صلاحية الطلبات");
  const scope = requestScope(ctx.user);
  const row = one(
    ctx.db,
    `SELECT r.* FROM requests r WHERE r.reference=?${scope.sql ? " AND " + scope.sql : ""}`,
    [String(input.requestReference).trim().slice(0, 100), ...scope.params],
  );
  if (!row) throw new HttpError(404, "مرجع الطلب غير موجود أو خارج نطاقك");
  if (input.requestId && Number(input.requestId) !== row.id)
    throw new HttpError(422, "مرجع الطلب غير متطابق");
  return row;
}
