import { createHash } from "node:crypto";
import { one, q, exec, transaction } from "./db.js";
import { can } from "./auth.js";
import { taskScope } from "./task-access.js";
import { requestScope } from "./api.js";
import { audit } from "./domain.js";
import { auditContext } from "./audit-context.js";
import { readJson, json, HttpError } from "./http.js";

const POLICY = "operations.deadline-policy.v1",
  HEALTH = "operations.deadline-health.v1";
export function deadlinePolicy(db) {
  const row = one(db, "SELECT value FROM meta WHERE key=?", [POLICY]);
  if (!row)
    return {
      enabled: false,
      soonMinutes: 60,
      escalateMinutes: 1440,
      revision: 0,
    };
  let p;
  try {
    p = JSON.parse(row.value);
  } catch {
    throw new HttpError(503, "سياسة المواعيد غير صالحة؛ المجدول متوقف");
  }
  if (
    typeof p.enabled !== "boolean" ||
    !Number.isInteger(p.soonMinutes) ||
    p.soonMinutes < 15 ||
    p.soonMinutes > 1440 ||
    !Number.isInteger(p.escalateMinutes) ||
    p.escalateMinutes < 60 ||
    p.escalateMinutes > 10080 ||
    !Number.isInteger(p.revision) ||
    p.revision < 0
  )
    throw new HttpError(503, "سياسة المواعيد غير صالحة؛ المجدول متوقف");
  return p;
}
const cycleFor = (row) =>
  createHash("sha256").update(`${row.due_at}|${row.owner_id}`).digest("hex");
function managerAccess(ctx) {
  if (
    ctx.user.roleKey
      ? ctx.user.dataScope !== "organization"
      : ctx.user.role !== "admin"
  )
    throw new HttpError(403, "ضبط سياسة المواعيد يتطلب إدارة المؤسسة");
}
export function getDeadlinePolicy(ctx) {
  managerAccess(ctx);
  const health = one(ctx.db, "SELECT value FROM meta WHERE key=?", [HEALTH]);
  return json(ctx.res, 200, {
    ok: true,
    policy: deadlinePolicy(ctx.db),
    health: health ? JSON.parse(health.value) : null,
  });
}
export async function setDeadlinePolicy(ctx) {
  managerAccess(ctx);
  const body = await readJson(ctx.req, 4096);
  if (
    typeof body.enabled !== "boolean" ||
    !Number.isInteger(body.soonMinutes) ||
    body.soonMinutes < 15 ||
    body.soonMinutes > 1440 ||
    !Number.isInteger(body.escalateMinutes) ||
    body.escalateMinutes < 60 ||
    body.escalateMinutes > 10080
  )
    throw new HttpError(422, "قرب الموعد15–1440دقيقة والتصعيد60–10080دقيقة");
  const reason = String(body.reason || "").trim();
  if (reason.length < 3 || reason.length > 500)
    throw new HttpError(422, "سبب تغيير السياسة مطلوب (3–500 حرف)");
  const policy = transaction(
    ctx.db,
    () => {
      const old = deadlinePolicy(ctx.db);
      if (body.revision !== old.revision)
        throw new HttpError(409, "تغيرت السياسة؛ حدّث الصفحة");
      const next = {
        enabled: body.enabled,
        soonMinutes: body.soonMinutes,
        escalateMinutes: body.escalateMinutes,
        revision: old.revision + 1,
      };
      exec(
        ctx.db,
        "INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        [POLICY, JSON.stringify(next)],
      );
      audit(ctx.db, {
        user: ctx.user,
        action: "deadline.policy",
        entity: "operations",
        meta: { before: old, after: next, reason },
        ip: ctx.ip,
      });
      return next;
    },
    { immediate: true },
  );
  return json(ctx.res, 200, { ok: true, policy });
}
function contexts(db, id) {
  const row = one(
    db,
    `SELECT u.*,r.permissions,r.data_scope FROM users u LEFT JOIN role_definitions r ON r.role_key=u.role_key AND r.active=1 WHERE u.id=? AND u.active=1`,
    [id],
  );
  if (!row) return [];
  const result = [];
  const add = (r) => {
    let permissions = null;
    try {
      permissions = r.permissions ? JSON.parse(r.permissions) : null;
    } catch {
      return;
    }
    if (r.role_key && !r.data_scope) return;
    if (
      r.branch_id &&
      !one(db, "SELECT id FROM branches WHERE id=? AND active=1", [r.branch_id])
    )
      return;
    if (
      r.department_id &&
      !one(db, "SELECT id FROM departments WHERE id=? AND active=1", [
        r.department_id,
      ])
    )
      return;
    result.push({
      id,
      role: r.role,
      roleKey: r.role_key,
      branchId: r.branch_id,
      departmentId: r.department_id,
      dataScope: r.data_scope || "organization",
      permissions,
    });
  };
  add(row);
  for (const member of q(
    db,
    `SELECT m.*,r.base_role AS role,r.permissions,r.data_scope FROM staff_memberships m JOIN role_definitions r ON r.role_key=m.role_key AND r.active=1 WHERE m.user_id=? AND m.active=1 AND m.is_primary=0`,
    [id],
  ))
    add(member);
  return result;
}
function allowed(db, user, row, escalation = false) {
  // The unified deadline inbox itself requires tasks:read. Never enqueue unreachable alerts.
  if (!can(user, "tasks:read")) return false;
  if (
    !can(user, row.entity === "task" ? "tasks:read" : "requests:read") ||
    (escalation &&
      !can(user, row.entity === "task" ? "tasks:assign" : "requests:assign"))
  )
    return false;
  if (row.entity === "task") {
    const scope = taskScope(user);
    return Boolean(
      one(db, `SELECT t.id FROM tasks t WHERE t.id=? AND ${scope.sql}`, [
        row.id,
        ...scope.params,
      ]),
    );
  }
  const scope = requestScope(user);
  return Boolean(
    one(
      db,
      `SELECT r.id FROM request_follow_ups f JOIN requests r ON r.id=f.request_id WHERE f.id=?${scope.sql ? " AND " + scope.sql : ""}`,
      [row.id, ...scope.params],
    ),
  );
}
function sources(db, ceiling, offset) {
  return q(
    db,
    `SELECT 'task' AS entity,id,due_at,assigned_to AS owner_id FROM tasks WHERE status NOT IN ('done','cancelled') AND julianday(due_at)<=julianday(?) UNION ALL SELECT 'follow' AS entity,id,due_at,assigned_to FROM request_follow_ups WHERE status='open' AND assigned_to IS NOT NULL AND julianday(due_at)<=julianday(?) ORDER BY due_at,id,entity LIMIT 500 OFFSET ?`,
    [ceiling, ceiling, offset],
  );
}
export function runDeadlineJob(db, { now = Date.now() } = {}) {
  if (!Number.isFinite(now)) throw new Error("Invalid deadline clock");
  return auditContext.run({ reason: "تشغيل مجدول المواعيد" }, () =>
    transaction(
      db,
      () => {
        const p = deadlinePolicy(db),
          summary = {
            enabled: p.enabled,
            created: 0,
            duplicates: 0,
            unroutable: 0,
            examined: 0,
            at: new Date(now).toISOString(),
          };
        if (!p.enabled) return summary;
        const ceiling = new Date(now + p.soonMinutes * 60000).toISOString();
        const health=one(db,'SELECT value FROM meta WHERE key=?',[HEALTH]);
        const previous=health?JSON.parse(health.value):{};
        const offset=Number.isSafeInteger(previous.nextOffset)&&previous.nextOffset>=0?previous.nextOffset:0;
        const batch=sources(db,ceiling,offset);
        summary.nextOffset=batch.length===500?offset+batch.length:0;
        for (const row of batch) {
          if (summary.created >= 1000) break;
          const delta = Date.parse(row.due_at) - now;
          if (!Number.isFinite(delta) || delta > p.soonMinutes * 60000)
            continue;
          summary.examined++;
          const ownerContexts = contexts(db, row.owner_id),
            kind = delta > 0 ? "soon" : "overdue";
          const deliveries = [];
          if (ownerContexts.some((u) => allowed(db, u, row)))
            deliveries.push({ userId: row.owner_id, kind });
          else summary.unroutable++;
          if (delta <= -p.escalateMinutes * 60000) {
            const manager = one(
              db,
              "SELECT manager_id FROM employees WHERE user_id=?",
              [row.owner_id],
            )?.manager_id;
            if (
              manager &&
              manager !== row.owner_id &&
              contexts(db, manager).some((u) => allowed(db, u, row, true))
            )
              deliveries.push({ userId: manager, kind: "escalated" });
            else summary.unroutable++;
          }
          for (const target of deliveries) {
            const result = exec(
              db,
              "INSERT OR IGNORE INTO operations_alerts(user_id,task_id,follow_up_id,cycle,kind,due_at,owner_id,created_at) VALUES(?,?,?,?,?,?,?,?)",
              [
                target.userId,
                row.entity === "task" ? row.id : null,
                row.entity === "follow" ? row.id : null,
                cycleFor(row),
                target.kind,
                row.due_at,
                row.owner_id,
                summary.at,
              ],
            );
            if (!result.changes) {
              summary.duplicates++;
              continue;
            }
            summary.created++;
            audit(db, {
              action: "deadline." + target.kind,
              entity: "operations_alert",
              entityId: Number(result.lastInsertRowid),
              meta: {
                entity: row.entity,
                id: row.id,
                recipientId: target.userId,
                ownerId: row.owner_id,
                dueAt: row.due_at,
              },
            });
            if (target.kind === "escalated") {
              if (row.entity === "task")
                exec(
                  db,
                  "INSERT INTO task_events(task_id,kind,reason,after_json,created_at) VALUES(?,'escalated','تصعيد تأخير إلى المدير المباشر المخول',?,?)",
                  [
                    row.id,
                    JSON.stringify({
                      recipientId: target.userId,
                      dueAt: row.due_at,
                    }),
                    summary.at,
                  ],
                );
              else {
                const request = one(
                  db,
                  "SELECT request_id FROM request_follow_ups WHERE id=?",
                  [row.id],
                );
                exec(
                  db,
                  "INSERT INTO request_events(request_id,actor_name,kind,message,meta,created_at) VALUES(?,'النظام','follow_up','تصعيد تأخير متابعة إلى المدير المباشر المخول',?,?)",
                  [
                    request.request_id,
                    JSON.stringify({
                      followUpId: row.id,
                      recipientId: target.userId,
                      dueAt: row.due_at,
                    }),
                    summary.at,
                  ],
                );
              }
            }
          }
        }
        exec(
          db,
          "INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
          [HEALTH, JSON.stringify(summary)],
        );
        return summary;
      },
      { immediate: true },
    ),
  );
}
export function runDeadlines(ctx) {
  managerAccess(ctx);
  return json(ctx.res, 200, { ok: true, result: runDeadlineJob(ctx.db) });
}
function visibleSources(ctx) {
  const task = taskScope(ctx.user),
    request = requestScope(ctx.user),
    params = [...task.params];
  let sql = `SELECT 'task' entity,t.id,t.title,t.assigned_to owner_id,t.due_at,t.branch_id,t.department_id,t.request_id FROM tasks t WHERE t.status NOT IN ('done','cancelled') AND ${task.sql}`;
  if (can(ctx.user, "requests:read")) {
    sql += ` UNION ALL SELECT 'follow',f.id,r.reference,f.assigned_to,f.due_at,r.branch_id,r.department_id,r.id FROM request_follow_ups f JOIN requests r ON r.id=f.request_id WHERE f.status='open'${request.sql ? " AND " + request.sql : ""}`;
    params.push(...request.params);
  }
  if (ctx.query.owner) {
    const owner =
      ctx.query.owner === "unassigned" ? null : Number(ctx.query.owner);
    if (owner !== null && !Number.isInteger(owner))
      throw new HttpError(422, "المسؤول غير صالح");
    sql = "SELECT * FROM (" + sql + ") WHERE owner_id IS ?";
    params.push(owner);
  }
  return { sql, params };
}
function alertQuery(ctx) {
  const src = visibleSources(ctx);
  return {
    sql: `FROM operations_alerts a JOIN (${src.sql}) s ON (s.entity='task' AND s.id=a.task_id OR s.entity='follow' AND s.id=a.follow_up_id) WHERE a.user_id=? AND s.due_at=a.due_at AND s.owner_id=a.owner_id AND (a.kind<>'escalated' OR (EXISTS(SELECT 1 FROM employees e WHERE e.user_id=a.owner_id AND e.manager_id=a.user_id) AND ((s.entity='task' AND ?=1) OR (s.entity='follow' AND ?=1))))`,
    params: [
      ...src.params,
      ctx.user.id,
      Number(can(ctx.user, "tasks:assign")),
      Number(can(ctx.user, "requests:assign")),
    ],
  };
}
export function deadlineAlerts(ctx) {
  const source = alertQuery(ctx),
    page = Math.max(
      1,
      Math.min(100000, Math.trunc(Number(ctx.query.page)) || 1),
    );
  const total = one(ctx.db, "SELECT COUNT(*) n " + source.sql, source.params).n,
    unread = one(
      ctx.db,
      "SELECT COUNT(*) n " + source.sql + " AND a.read_at IS NULL",
      source.params,
    ).n;
  const alerts = q(
    ctx.db,
    "SELECT a.id,a.kind,a.due_at,a.created_at,a.read_at,s.entity,s.id AS entity_id,s.title,s.request_id " +
      source.sql +
      " ORDER BY a.id DESC LIMIT 50 OFFSET ?",
    [...source.params, (page - 1) * 50],
  );
  return json(ctx.res, 200, {
    ok: true,
    alerts,
    total,
    unread,
    page,
    pages: Math.max(1, Math.ceil(total / 50)),
  });
}
export function readDeadlineAlert(ctx) {
  const src = alertQuery(ctx),
    row = one(ctx.db, "SELECT a.id " + src.sql + " AND a.id=?", [
      ...src.params,
      Number(ctx.params.id),
    ]);
  if (!row) throw new HttpError(404, "التنبيه غير موجود");
  exec(
    ctx.db,
    "UPDATE operations_alerts SET read_at=COALESCE(read_at,?) WHERE id=?",
    [new Date().toISOString(), row.id],
  );
  return json(ctx.res, 200, { ok: true });
}
export function deadlineDashboard(ctx) {
  const src = visibleSources(ctx),
    policy = deadlinePolicy(ctx.db),
    now = new Date().toISOString(),
    soon = new Date(Date.now() + policy.soonMinutes * 60000).toISOString();
  const rows = q(
    ctx.db,
    `SELECT s.owner_id,u.name AS owner_name,u.active,COUNT(*) open,SUM(CASE WHEN julianday(s.due_at)<=julianday(?) THEN 1 ELSE 0 END) overdue,SUM(CASE WHEN julianday(s.due_at)>julianday(?) AND julianday(s.due_at)<=julianday(?) THEN 1 ELSE 0 END) soon FROM (${src.sql}) s LEFT JOIN users u ON u.id=s.owner_id GROUP BY s.owner_id ORDER BY overdue DESC,open DESC`,
    [now, now, soon, ...src.params],
  );
  const page = Math.max(
      1,
      Math.min(100000, Math.trunc(Number(ctx.query.page)) || 1),
    ),
    total = one(
      ctx.db,
      `SELECT COUNT(*) n FROM (${src.sql}) s WHERE julianday(s.due_at)<=julianday(?)`,
      [...src.params, soon],
    ).n;
  const due = q(
    ctx.db,
    `SELECT s.*,u.name AS owner_name FROM (${src.sql}) s LEFT JOIN users u ON u.id=s.owner_id WHERE julianday(s.due_at)<=julianday(?) ORDER BY julianday(s.due_at),s.id LIMIT 25 OFFSET ?`,
    [...src.params, soon, (page - 1) * 25],
  );
  return json(ctx.res, 200, {
    ok: true,
    rows,
    due,
    total,
    page,
    pages: Math.max(1, Math.ceil(total / 25)),
    policy: {
      enabled: policy.enabled,
      soonMinutes: policy.soonMinutes,
      escalateMinutes: policy.escalateMinutes,
    },
    generatedAt: now,
  });
}
