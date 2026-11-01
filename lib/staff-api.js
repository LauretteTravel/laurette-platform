import { one, q, exec, transaction } from "./db.js";
import { canDelegateProfile } from "./api.js";
import { createSession, destroySession } from "./auth.js";
import { HttpError, readJson, json, cookie } from "./http.js";
import { auditContext } from "./audit-context.js";
import { createHmac } from "node:crypto";

function reason(body) {
  const value = String(body.reason || "").trim();
  if (value.length < 3 || value.length > 500)
    throw new HttpError(422, "سبب التعديل مطلوب (3–500 حرف)");
  return value;
}
function context(ctx, why, fn) {
  return auditContext.run({ user: ctx.user, ip: ctx.ip, reason: why }, fn);
}
function managedUser(ctx) {
  const id = Number(ctx.params.id),
    row = one(ctx.db, "SELECT * FROM users WHERE id=?", [id]);
  if (!row) throw new HttpError(404, "الموظف غير موجود");
  const actor = ctx.user;
  if (actor.roleKey && actor.dataScope !== "organization") {
    if (
      (actor.dataScope === "branch" && row.branch_id !== actor.branchId) ||
      (actor.dataScope === "department" &&
        (row.branch_id !== actor.branchId ||
          row.department_id !== actor.departmentId)) ||
      actor.dataScope === "assigned"
    )
      throw new HttpError(404, "الموظف غير موجود");
  }
  const profile = row.role_key
    ? one(ctx.db, "SELECT * FROM role_definitions WHERE role_key=?", [
        row.role_key,
      ])
    : { data_scope: "organization", permissions: '["*"]' };
  if (!profile || !canDelegateProfile(actor, profile))
    throw new HttpError(403, "لا يمكنك إدارة موظف أعلى صلاحية");
  return row;
}
export function employeeProfile(ctx) {
  const user = managedUser(ctx);
  return json(ctx.res, 200, {
    ok: true,
    profile: one(ctx.db, "SELECT * FROM employees WHERE user_id=?", [user.id]),
  });
}
export async function updateEmployeeProfile(ctx) {
  const user = managedUser(ctx),
    body = await readJson(ctx.req, 8192),
    why = reason(body),
    old = one(ctx.db, "SELECT * FROM employees WHERE user_id=?", [user.id]);
  const next = { ...old };
  for (const [key, max] of [
    ["employee_no", 40],
    ["job_title", 100],
    ["email", 254],
  ])
    if (body[key] !== undefined) {
      next[key] = String(body[key]).trim();
      if (next[key].length > max)
        throw new HttpError(422, "قيمة الحقل أطول من المسموح");
    }
  if (
    !/^[\p{L}\p{N}_-]{2,40}$/u.test(next.employee_no) ||
    (next.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(next.email))
  )
    throw new HttpError(422, "رقم الموظف أو البريد غير صالح");
  if (body.hire_date !== undefined) {
    next.hire_date = body.hire_date || null;
    if (
      next.hire_date &&
      (!/^\d{4}-\d{2}-\d{2}$/.test(next.hire_date) ||
        !Number.isFinite(Date.parse(next.hire_date)) ||
        new Date(next.hire_date).toISOString().slice(0, 10) !== next.hire_date)
    )
      throw new HttpError(422, "تاريخ التعيين غير صالح");
  }
  if (body.manager_id !== undefined) {
    next.manager_id =
      body.manager_id === null || body.manager_id === ""
        ? null
        : Number(body.manager_id);
    let pointer = next.manager_id;
    const seen = new Set([user.id]);
    while (pointer !== null) {
      if (!Number.isInteger(pointer) || seen.has(pointer))
        throw new HttpError(422, "علاقة المدير غير صالحة أو دائرية");
      seen.add(pointer);
      const manager = one(
        ctx.db,
        "SELECT u.active,u.branch_id,e.manager_id FROM users u JOIN employees e ON e.user_id=u.id WHERE u.id=?",
        [pointer],
      );
      if (
        !manager?.active ||
        (ctx.user.roleKey &&
          ctx.user.dataScope !== "organization" &&
          manager.branch_id !== ctx.user.branchId)
      )
        throw new HttpError(422, "المدير غير متاح في نطاقك");
      pointer = manager.manager_id;
    }
  }
  try {
    context(ctx, why, () =>
      exec(
        ctx.db,
        "UPDATE employees SET employee_no=?,job_title=?,email=?,hire_date=?,manager_id=?,updated_at=? WHERE user_id=?",
        [
          next.employee_no,
          next.job_title,
          next.email,
          next.hire_date,
          next.manager_id,
          new Date().toISOString(),
          user.id,
        ],
      ),
    );
  } catch (e) {
    if (String(e.message).includes("UNIQUE"))
      throw new HttpError(409, "رقم الموظف مستخدم");
    throw e;
  }
  return employeeProfile(ctx);
}
export function listMemberships(ctx) {
  const user = managedUser(ctx);
  return json(ctx.res, 200, {
    ok: true,
    memberships: q(
      ctx.db,
      "SELECT m.*,b.name AS branch_name,d.name AS department_name,r.name AS role_name FROM staff_memberships m LEFT JOIN branches b ON b.id=m.branch_id LEFT JOIN departments d ON d.id=m.department_id LEFT JOIN role_definitions r ON r.role_key=m.role_key WHERE m.user_id=? ORDER BY m.is_primary DESC,m.id",
      [user.id],
    ),
  });
}
export async function createMembership(ctx) {
  const user = managedUser(ctx),
    body = await readJson(ctx.req, 8192),
    why = reason(body),
    branchId = Number(body.branchId),
    departmentId = body.departmentId ? Number(body.departmentId) : null,
    profile = one(
      ctx.db,
      "SELECT * FROM role_definitions WHERE role_key=? AND active=1",
      [String(body.roleKey || "")],
    );
  if (
    !profile ||
    profile.data_scope === "organization" ||
    !canDelegateProfile(ctx.user, profile)
  )
    throw new HttpError(403, "الدور غير مسموح لهذا التفويض");
  if (
    !one(ctx.db, "SELECT id FROM branches WHERE id=? AND active=1", [branchId])
  )
    throw new HttpError(422, "الفرع غير فعال");
  const dept = departmentId
    ? one(ctx.db, "SELECT * FROM departments WHERE id=? AND active=1", [
        departmentId,
      ])
    : null;
  if (
    (departmentId && !dept) ||
    (dept?.branch_id && dept.branch_id !== branchId) ||
    (profile.data_scope === "department" && !dept)
  )
    throw new HttpError(422, "القسم لا يتبع الفرع أو مطلوب للدور");
  if (
    (ctx.user.roleKey &&
      ctx.user.dataScope === "branch" &&
      branchId !== ctx.user.branchId) ||
    (ctx.user.roleKey &&
      ctx.user.dataScope === "department" &&
      (branchId !== ctx.user.branchId ||
        departmentId !== ctx.user.departmentId))
  )
    throw new HttpError(403, "التفويض خارج نطاقك");
  if (user.branch_id === branchId && user.department_id === departmentId)
    throw new HttpError(409, "هذه هي العضوية الأساسية بالفعل");
  try {
    context(ctx, why, () =>
      transaction(ctx.db, () => {
        exec(
          ctx.db,
          "INSERT INTO staff_memberships(user_id,role_key,branch_id,department_id,created_at,updated_at) VALUES(?,?,?,?,?,?)",
          [
            user.id,
            profile.role_key,
            branchId,
            departmentId,
            new Date().toISOString(),
            new Date().toISOString(),
          ],
        );
        exec(ctx.db, "DELETE FROM sessions WHERE user_id=?", [user.id]);
      }),
    );
  } catch (e) {
    if (String(e.message).includes("UNIQUE"))
      throw new HttpError(409, "يوجد تفويض لهذه الجهة");
    throw e;
  }
  return json(ctx.res, 201, { ok: true });
}
export async function updateMembership(ctx) {
  const user = managedUser(ctx),
    body = await readJson(ctx.req, 4096),
    why = reason(body),
    member = one(
      ctx.db,
      "SELECT * FROM staff_memberships WHERE id=? AND user_id=?",
      [Number(ctx.params.membershipId), user.id],
    );
  if (!member || member.is_primary)
    throw new HttpError(422, "عدّل العضوية الأساسية من ملف المستخدم");
  const profile = one(
    ctx.db,
    "SELECT * FROM role_definitions WHERE role_key=?",
    [member.role_key],
  );
  if (!profile || !canDelegateProfile(ctx.user, profile))
    throw new HttpError(403, "التفويض أعلى من صلاحياتك");
  if (
    (ctx.user.roleKey &&
      ctx.user.dataScope === "branch" &&
      member.branch_id !== ctx.user.branchId) ||
    (ctx.user.roleKey &&
      ctx.user.dataScope === "department" &&
      (member.branch_id !== ctx.user.branchId ||
        member.department_id !== ctx.user.departmentId))
  )
    throw new HttpError(403, "التفويض خارج نطاقك");
  if (typeof body.active !== "boolean")
    throw new HttpError(422, "حالة التفويض غير صالحة");
  context(ctx, why, () =>
    transaction(ctx.db, () => {
      exec(
        ctx.db,
        "UPDATE staff_memberships SET active=?,updated_at=? WHERE id=?",
        [body.active ? 1 : 0, new Date().toISOString(), member.id],
      );
      exec(ctx.db, "DELETE FROM sessions WHERE user_id=?", [user.id]);
    }),
  );
  return json(ctx.res, 200, { ok: true });
}
function self(ctx) {
  if (ctx.user.mustChange || (ctx.user.mfaRequired && !ctx.user.mfaVerified))
    throw new HttpError(403, "أكمل تأمين الحساب أولًا");
}
export function myMemberships(ctx) {
  self(ctx);
  const memberships = q(
    ctx.db,
    "SELECT m.id,m.is_primary,m.active,m.role_key,b.name AS branch_name,d.name AS department_name FROM staff_memberships m LEFT JOIN branches b ON b.id=m.branch_id LEFT JOIN departments d ON d.id=m.department_id WHERE m.user_id=? AND m.active=1 ORDER BY m.is_primary DESC,m.id",
    [ctx.user.id],
  );
  return json(ctx.res, 200, { ok: true, memberships });
}
export async function switchMembership(ctx) {
  self(ctx);
  const body = await readJson(ctx.req, 4096);
  let membershipId = null;
  if (body.membershipId) {
    const m = one(
      ctx.db,
      `SELECT m.*,r.data_scope,r.permissions FROM staff_memberships m JOIN role_definitions r ON r.role_key=m.role_key AND r.active=1 JOIN branches b ON b.id=m.branch_id AND b.active=1 LEFT JOIN departments d ON d.id=m.department_id WHERE m.id=? AND m.user_id=? AND m.active=1 AND (m.department_id IS NULL OR d.active=1)`,
      [Number(body.membershipId), ctx.user.id],
    );
    if (!m) throw new HttpError(403, "التفويض غير متاح");
    if (!m.is_primary) membershipId = m.id;
  }
  const session = transaction(ctx.db, () => {
    const session = createSession(
      ctx.db,
      ctx.user.id,
      ctx.ip,
      ctx.req.headers["user-agent"],
      { membershipId, mfaVerified: ctx.user.mfaVerified },
    );
    destroySession(ctx.db, ctx.token);
    return session;
  });
  return json(
    ctx.res,
    200,
    { ok: true },
    {
      "set-cookie": cookie("lt_session", session.token, {
        maxAge: 8 * 3600,
        sameSite: "Strict",
        secure: ctx.secure,
      }),
    },
  );
}
export async function updateOrganizationUnit(ctx) {
  if (ctx.user.roleKey && ctx.user.dataScope !== "organization")
    throw new HttpError(403, "تعديل الهيكل يتطلب نطاق المؤسسة");
  const table = ctx.path.includes("/branches/") ? "branches" : "departments",
    id = Number(ctx.params.id),
    old = one(ctx.db, `SELECT * FROM ${table} WHERE id=?`, [id]);
  if (!old) throw new HttpError(404, "الجهة غير موجودة");
  const body = await readJson(ctx.req, 8192),
    why = reason(body);
  const name = body.name === undefined ? old.name : String(body.name).trim();
  if (
    name.length < 2 ||
    name.length > 80 ||
    (body.active !== undefined && typeof body.active !== "boolean")
  )
    throw new HttpError(422, "بيانات الجهة غير صالحة");
  const active = body.active === undefined ? old.active : Number(body.active),
    column = table === "branches" ? "branch_id" : "department_id";
  if (!active) {
    const users = one(
      ctx.db,
      `SELECT 1 FROM users WHERE ${column}=? AND active=1 LIMIT 1`,
      [id],
    );
    const memberships = one(
      ctx.db,
      `SELECT 1 FROM staff_memberships m JOIN users u ON u.id=m.user_id WHERE m.${column}=? AND m.active=1 AND u.active=1 LIMIT 1`,
      [id],
    );
    const requests = one(
      ctx.db,
      `SELECT 1 FROM requests WHERE ${column}=? AND status NOT IN ('confirmed','cancelled') LIMIT 1`,
      [id],
    );
    const pending = one(
      ctx.db,
      `SELECT 1 FROM request_transfers WHERE status='pending' AND (from_${column}=? OR to_${column}=?) LIMIT 1`,
      [id, id],
    );
    const tasks=one(ctx.db, `SELECT 1 FROM tasks WHERE ${column}=? AND status NOT IN ('done','cancelled') LIMIT 1`,[id]);
    if (users || memberships || requests || pending || tasks)
      throw new HttpError(
        409,
        "لا يمكن تعطيل جهة مرتبطة بموظفين أو نشاط مفتوح",
      );
  }
  try {
    context(ctx, why, () =>
      exec(
        ctx.db,
        `UPDATE ${table} SET name=?,active=?,updated_at=? WHERE id=?`,
        [name, active, new Date().toISOString(), id],
      ),
    );
  } catch (e) {
    if (String(e.message).includes("UNIQUE"))
      throw new HttpError(409, "الاسم مستخدم");
    throw e;
  }
  return json(ctx.res, 200, { ok: true });
}
export function exportAudit(ctx) {
  if (ctx.user.roleKey && ctx.user.dataScope !== "organization")
    throw new HttpError(403, "التصدير متاح على مستوى المؤسسة");
  const key = process.env.AUDIT_EXPORT_KEY;
  if (!key) throw new HttpError(503, "يلزم إعداد مفتاح توقيع تصدير التدقيق");
  exec(
    ctx.db,
    "INSERT INTO audit_log(user_id,user_name,action,entity,reason,created_at) VALUES(?,?,?,?,?,?)",
    [
      ctx.user.id,
      ctx.user.name,
      "audit-export",
      "audit_log",
      "تصدير موقع لسجل التدقيق",
      new Date().toISOString(),
    ],
  );
  const entries = q(
      ctx.db,
      "SELECT * FROM audit_log ORDER BY id DESC LIMIT 1000",
    ).reverse(),
    document = JSON.stringify({
      format: "laurette-audit-v1",
      exportedAt: new Date().toISOString(),
      entries,
    });
  const signature = createHmac("sha256", key).update(document).digest("hex");
  return json(
    ctx.res,
    200,
    { ok: true, algorithm: "HMAC-SHA256", document, signature },
    { "cache-control": "no-store" },
  );
}
