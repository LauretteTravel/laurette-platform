import { one, q, exec, transaction } from "./db.js";
import { can } from "./auth.js";
import { readJson, json, HttpError } from "./http.js";
import { isoNow } from "./util.js";
import {
  taskScope,
  visibleTask,
  taskUnit,
  linkedRequest,
  taskRecipients,
  resolveLinkedRequest,
} from "./task-access.js";

const statuses = {
  new: ["in_progress", "cancelled"],
  in_progress: ["waiting", "review", "done", "cancelled"],
  waiting: ["in_progress", "review", "cancelled"],
  review: ["in_progress", "done", "cancelled"],
  done: [],
  cancelled: [],
};
const priorities = ["low", "normal", "high", "urgent"];
const nullableId = (value, fallback = null) =>
  value === undefined
    ? fallback
    : value === null || value === ""
      ? null
      : Number(value);
function text(value, min, max, label) {
  const v = String(value ?? "").trim();
  if (v.length < min || v.length > max)
    throw new HttpError(422, `${label}: من ${min} إلى ${max} حرف`);
  return v;
}
function deadline(value) {
  const v = String(value || "");
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(
      v,
    ) ||
    !Number.isFinite(Date.parse(v)) ||
    new Date(v.slice(0, 10)).toISOString().slice(0, 10) !== v.slice(0, 10)
  )
    throw new HttpError(422, "الموعد غير صالح أو بلا منطقة زمنية");
  return new Date(v).toISOString();
}
function coreAccess(ctx, task) {
  if (
    task.assigned_to !== ctx.user.id &&
    task.created_by !== ctx.user.id &&
    !can(ctx.user, "tasks:assign")
  )
    throw new HttpError(403, "تعديل المهمة للمسؤول أو منشئها أو مدير الإسناد");
}
function event(ctx, task, kind, reason, before = null, after = null) {
  const id = Number(
    exec(
      ctx.db,
      "INSERT INTO task_events(task_id,actor_id,kind,reason,before_json,after_json,created_at) VALUES(?,?,?,?,?,?,?)",
      [
        task.id,
        ctx.user.id,
        kind,
        reason,
        before ? JSON.stringify(before) : null,
        after ? JSON.stringify(after) : null,
        isoNow(),
      ],
    ).lastInsertRowid,
  );
  const users = q(
    ctx.db,
    "SELECT assigned_to AS id FROM tasks WHERE id=? UNION SELECT created_by FROM tasks WHERE id=? UNION SELECT user_id FROM task_members WHERE task_id=?",
    [task.id, task.id, task.id],
  );
  for (const user of users)
    if (user.id !== ctx.user.id)
      exec(
        ctx.db,
        "INSERT INTO staff_notifications(user_id,task_id,event_id,kind,created_at) VALUES(?,?,?,?,?)",
        [user.id, task.id, id, kind, isoNow()],
      );
  return id;
}
export function taskOptions(ctx) {
  const branchId = Number(ctx.query.branchId ?? ctx.user.branchId),
    departmentId = nullableId(
      ctx.query.departmentId,
      ctx.user.departmentId ?? null,
    );
  const scope = ctx.user.roleKey && ctx.user.dataScope !== "organization";
  const branches = q(
    ctx.db,
    `SELECT id,name FROM branches WHERE active=1${scope ? " AND id=?" : ""} ORDER BY name`,
    scope ? [ctx.user.branchId] : [],
  );
  const departments = q(
    ctx.db,
    `SELECT id,name,branch_id FROM departments WHERE active=1 AND (branch_id IS NULL OR branch_id=?)${scope && ["department", "assigned"].includes(ctx.user.dataScope) ? " AND id IS ?" : ""} ORDER BY name`,
    [
      branchId || null,
      ...(scope && ["department", "assigned"].includes(ctx.user.dataScope)
        ? [ctx.user.departmentId]
        : []),
    ],
  );
  let users = [];
  if (branchId) {
    taskUnit(ctx, branchId, departmentId);
    const request = resolveLinkedRequest(ctx, ctx.query);
    if (
      request &&
      (request.branch_id !== branchId || request.department_id !== departmentId)
    )
      throw new HttpError(422, "الجهة يجب أن تطابق الطلب");
    users = taskRecipients(ctx, branchId, departmentId, request);
  }
  return json(ctx.res, 200, {
    ok: true,
    branches,
    departments,
    users,
    statuses,
    priorities,
  });
}
export function listTasks(ctx) {
  const scope = taskScope(ctx.user),
    where = [scope.sql],
    params = [...scope.params];
  if (ctx.query.view !== "team" || !can(ctx.user, "tasks:assign")) {
    where.push(
      "(t.assigned_to=? OR EXISTS(SELECT 1 FROM task_members m WHERE m.task_id=t.id AND m.user_id=?))",
    );
    params.push(ctx.user.id, ctx.user.id);
  }
  if (ctx.query.status === "open" || !ctx.query.status)
    where.push("t.status NOT IN ('done','cancelled')");
  else if (ctx.query.status !== "all") {
    if (!Object.hasOwn(statuses, ctx.query.status))
      throw new HttpError(422, "حالة غير صالحة");
    where.push("t.status=?");
    params.push(ctx.query.status);
  }
  if (ctx.query.due === "overdue")
    where.push(
      "t.status NOT IN ('done','cancelled') AND julianday(t.due_at)<julianday('now')",
    );
  else if (ctx.query.due === "next24h")
    where.push(
      "julianday(t.due_at)>=julianday('now') AND julianday(t.due_at)<julianday('now','+1 day')",
    );
  else if (ctx.query.due) throw new HttpError(422, "مرشح موعد غير صالح");
  if (ctx.query.q) {
    where.push("t.title LIKE ?");
    params.push("%" + String(ctx.query.q).slice(0, 200) + "%");
  }
  const clause = " WHERE " + where.join(" AND "),
    page = Math.max(
      1,
      Math.min(100000, Math.trunc(Number(ctx.query.page)) || 1),
    );
  const total = one(
    ctx.db,
    "SELECT COUNT(*) n FROM tasks t" + clause,
    params,
  ).n;
  const tasks = q(
    ctx.db,
    `SELECT t.*,u.name AS assignee_name,b.name AS branch_name,d.name AS department_name,CASE WHEN t.status NOT IN ('done','cancelled') AND julianday(t.due_at)<julianday('now') THEN 1 ELSE 0 END AS overdue FROM tasks t JOIN users u ON u.id=t.assigned_to JOIN branches b ON b.id=t.branch_id LEFT JOIN departments d ON d.id=t.department_id${clause} ORDER BY julianday(t.due_at),t.id LIMIT 25 OFFSET ?`,
    [...params, (page - 1) * 25],
  );
  return json(ctx.res, 200, {
    ok: true,
    tasks,
    total,
    page,
    pages: Math.max(1, Math.ceil(total / 25)),
    statuses,
    priorities,
  });
}
export function getTask(ctx) {
  const task = visibleTask(ctx),
    id = task.id;
  return json(ctx.res, 200, {
    ok: true,
    task,
    assigneeName: one(ctx.db, "SELECT name FROM users WHERE id=?", [
      task.assigned_to,
    ])?.name,
    requestReference: task.request_id
      ? one(ctx.db, "SELECT reference FROM requests WHERE id=?", [
          task.request_id,
        ])?.reference
      : null,
    members: q(
      ctx.db,
      "SELECT m.user_id,u.name FROM task_members m JOIN users u ON u.id=m.user_id WHERE m.task_id=?",
      [id],
    ),
    comments: q(
      ctx.db,
      "SELECT c.*,u.name AS user_name FROM task_comments c JOIN users u ON u.id=c.user_id WHERE c.task_id=? ORDER BY c.id DESC LIMIT 100",
      [id],
    ),
    checklist: q(
      ctx.db,
      "SELECT * FROM task_checklist WHERE task_id=? ORDER BY id",
      [id],
    ),
    events: q(
      ctx.db,
      "SELECT e.*,u.name AS actor_name,(SELECT name FROM users WHERE id=json_extract(e.before_json,'$.assigned_to')) AS from_assignee_name,(SELECT name FROM users WHERE id=json_extract(e.after_json,'$.assigned_to')) AS to_assignee_name FROM task_events e LEFT JOIN users u ON u.id=e.actor_id WHERE e.task_id=? ORDER BY e.id DESC LIMIT 100",
      [id],
    ),
    statuses,
  });
}
export async function createTask(ctx) {
  const body = await readJson(ctx.req, 16384),
    title = text(body.title, 3, 160, "العنوان"),
    description = text(body.description, 0, 4000, "الوصف"),
    due = deadline(body.dueAt),
    priority = body.priority || "normal";
  if (!priorities.includes(priority))
    throw new HttpError(422, "الأولوية غير صالحة");
  const branchId = Number(body.branchId ?? ctx.user.branchId),
    departmentId = nullableId(body.departmentId, ctx.user.departmentId ?? null);
  taskUnit(ctx, branchId, departmentId);
  const request = resolveLinkedRequest(ctx, body);
  if (
    request &&
    (request.branch_id !== branchId || request.department_id !== departmentId)
  )
    throw new HttpError(422, "فرع وقسم المهمة يجب أن يطابقا الطلب");
  const assignedTo = Number(body.assignedTo ?? ctx.user.id),
    members = body.members ?? [];
  if (
    !Array.isArray(members) ||
    members.length > 30 ||
    members.some((id) => !Number.isInteger(id))
  )
    throw new HttpError(422, "المشاركون غير صالحين (30 كحد أقصى)");
  const recipients = taskRecipients(ctx, branchId, departmentId, request),
    ids = [...new Set([assignedTo, ...members])];
  if (ids.some((id) => !recipients.some((u) => u.id === id)))
    throw new HttpError(
      422,
      "المسؤول والمشاركون يجب أن يكونوا مخولين في الجهة والطلب",
    );
  if (ids.some((id) => id !== ctx.user.id) && !can(ctx.user, "tasks:assign"))
    throw new HttpError(403, "إسناد مهمة للغير يتطلب صلاحية الإسناد");
  const id = transaction(
    ctx.db,
    () => {
      const now = isoNow(),
        id = Number(
          exec(
            ctx.db,
            "INSERT INTO tasks(branch_id,department_id,request_id,title,description,priority,assigned_to,created_by,due_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
            [
              branchId,
              departmentId,
              request?.id ?? null,
              title,
              description,
              priority,
              assignedTo,
              ctx.user.id,
              due,
              now,
              now,
            ],
          ).lastInsertRowid,
        );
      for (const userId of new Set(members))
        exec(ctx.db, "INSERT INTO task_members VALUES(?,?)", [id, userId]);
      event(ctx, { id }, "created", "إنشاء مهمة", null, {
        assignedTo,
        branchId,
        departmentId,
        requestId: request?.id ?? null,
      });
      return id;
    },
    { immediate: true },
  );
  return json(ctx.res, 201, { ok: true, id });
}
export async function updateTask(ctx) {
  const task = visibleTask(ctx);
  coreAccess(ctx, task);
  const body = await readJson(ctx.req, 16384),
    reason = text(body.reason, 3, 500, "سبب التعديل");
  if (!Number.isInteger(body.version) || body.version !== task.version)
    throw new HttpError(409, "تغيرت المهمة؛ حدّثها قبل الحفظ");
  const next = { ...task };
  if (body.title !== undefined)
    next.title = text(body.title, 3, 160, "العنوان");
  if (body.description !== undefined)
    next.description = text(body.description, 0, 4000, "الوصف");
  if (body.priority !== undefined) {
    if (!priorities.includes(body.priority))
      throw new HttpError(422, "أولوية غير صالحة");
    next.priority = body.priority;
  }
  if (body.dueAt !== undefined) next.due_at = deadline(body.dueAt);
  if (body.status !== undefined && body.status !== task.status) {
    if (!statuses[task.status].includes(body.status))
      throw new HttpError(422, "انتقال الحالة غير مسموح");
    next.status = body.status;
  }
  if (
    body.assignedTo !== undefined &&
    Number(body.assignedTo) !== task.assigned_to
  ) {
    if (!can(ctx.user, "tasks:assign"))
      throw new HttpError(403, "لا تملك صلاحية نقل المسؤولية");
    const request = task.request_id
      ? linkedRequest(ctx, task.request_id)
      : null;
    if (
      !taskRecipients(ctx, task.branch_id, task.department_id, request).some(
        (u) => u.id === Number(body.assignedTo),
      )
    )
      throw new HttpError(422, "المستلم غير مخول");
    next.assigned_to = Number(body.assignedTo);
  }
  transaction(
    ctx.db,
    () => {
      if (
        next.status === "done" &&
        one(
          ctx.db,
          "SELECT id FROM task_checklist WHERE task_id=? AND done=0",
          [task.id],
        )
      )
        throw new HttpError(422, "أكمل قائمة التحقق قبل إتمام المهمة");
      const result = exec(
        ctx.db,
        "UPDATE tasks SET title=?,description=?,priority=?,due_at=?,status=?,assigned_to=?,version=version+1,updated_at=? WHERE id=? AND version=?",
        [
          next.title,
          next.description,
          next.priority,
          next.due_at,
          next.status,
          next.assigned_to,
          isoNow(),
          task.id,
          task.version,
        ],
      );
      if (!result.changes)
        throw new HttpError(409, "تغيرت المهمة؛ حدّث الصفحة");
      const fields = ["status", "assigned_to", "priority", "due_at", "version"];
      event(
        ctx,
        task,
        "updated",
        reason,
        Object.fromEntries(fields.map((k) => [k, task[k]])),
        Object.fromEntries(
          fields.map((k) => [k, k === "version" ? task.version + 1 : next[k]]),
        ),
      );
    },
    { immediate: true },
  );
  return json(ctx.res, 200, { ok: true });
}
export async function commentTask(ctx) {
  const task = visibleTask(ctx),
    body = await readJson(ctx.req, 8192),
    comment = text(body.body, 1, 2000, "التعليق");
  transaction(
    ctx.db,
    () => {
      exec(
        ctx.db,
        "INSERT INTO task_comments(task_id,user_id,body,created_at) VALUES(?,?,?,?)",
        [task.id, ctx.user.id, comment, isoNow()],
      );
      event(ctx, task, "comment", "إضافة تعليق داخلي");
    },
    { immediate: true },
  );
  return json(ctx.res, 201, { ok: true });
}
export async function addChecklist(ctx) {
  const task = visibleTask(ctx),
    body = await readJson(ctx.req, 4096),
    title = text(body.title, 1, 200, "البند");
  if (["done", "cancelled"].includes(task.status))
    throw new HttpError(409, "المهمة مغلقة");
  if (
    one(ctx.db, "SELECT COUNT(*) n FROM task_checklist WHERE task_id=?", [
      task.id,
    ]).n >= 50
  )
    throw new HttpError(422, "الحد الأقصى50بندًا");
  transaction(
    ctx.db,
    () => {
      const current = one(ctx.db, "SELECT status FROM tasks WHERE id=?", [
        task.id,
      ]);
      if (["done", "cancelled"].includes(current.status))
        throw new HttpError(409, "المهمة مغلقة");
      if (
        one(ctx.db, "SELECT COUNT(*) n FROM task_checklist WHERE task_id=?", [
          task.id,
        ]).n >= 50
      )
        throw new HttpError(422, "الحد الأقصى50بندًا");
      exec(
        ctx.db,
        "INSERT INTO task_checklist(task_id,title,updated_by,created_at) VALUES(?,?,?,?)",
        [task.id, title, ctx.user.id, isoNow()],
      );
      event(ctx, task, "checklist", "إضافة بند تحقق");
    },
    { immediate: true },
  );
  return json(ctx.res, 201, { ok: true });
}
export async function checkItem(ctx) {
  const item = one(ctx.db, "SELECT * FROM task_checklist WHERE id=?", [
    Number(ctx.params.id),
  ]);
  if (!item) throw new HttpError(404, "البند غير موجود");
  const task = visibleTask(ctx, item.task_id),
    body = await readJson(ctx.req, 2048);
  if (["done", "cancelled"].includes(task.status))
    throw new HttpError(409, "المهمة مغلقة");
  if (typeof body.done !== "boolean" || !Number.isInteger(body.version))
    throw new HttpError(422, "قيمة البند غير صالحة");
  transaction(
    ctx.db,
    () => {
      const current = one(ctx.db, "SELECT status FROM tasks WHERE id=?", [
        task.id,
      ]);
      if (["done", "cancelled"].includes(current.status))
        throw new HttpError(409, "المهمة مغلقة");
      const result = exec(
        ctx.db,
        "UPDATE task_checklist SET done=?,version=version+1,updated_by=? WHERE id=? AND version=?",
        [Number(body.done), ctx.user.id, item.id, body.version],
      );
      if (!result.changes) throw new HttpError(409, "تغير البند؛ حدّث القائمة");
      event(
        ctx,
        task,
        "checklist",
        body.done ? "إكمال بند تحقق" : "إعادة فتح بند تحقق",
        { itemId: item.id, done: item.done },
        { itemId: item.id, done: Number(body.done) },
      );
    },
    { immediate: true },
  );
  return json(ctx.res, 200, { ok: true });
}
export function notifications(ctx) {
  const scope=taskScope(ctx.user),where=`n.user_id=? AND ${scope.sql}`,params=[ctx.user.id,...scope.params];
  const page=Math.max(1,Math.min(100000,Math.trunc(Number(ctx.query.page))||1));
  const total=one(ctx.db,`SELECT COUNT(*) n FROM staff_notifications n JOIN tasks t ON t.id=n.task_id WHERE ${where}`,params).n;
  const rows=q(ctx.db,`SELECT n.id,n.task_id,n.kind,n.created_at,n.read_at,t.title FROM staff_notifications n JOIN tasks t ON t.id=n.task_id WHERE ${where} ORDER BY n.id DESC LIMIT 50 OFFSET ?`,[...params,(page-1)*50]);
  const unread=one(ctx.db,`SELECT COUNT(*) n FROM staff_notifications n JOIN tasks t ON t.id=n.task_id WHERE ${where} AND n.read_at IS NULL`,params).n;
  return json(ctx.res,200,{ok:true,notifications:rows,unread,total,page,pages:Math.max(1,Math.ceil(total/50))});
}
export function readNotification(ctx) {
  const row = one(
    ctx.db,
    "SELECT task_id FROM staff_notifications WHERE id=? AND user_id=?",
    [Number(ctx.params.id), ctx.user.id],
  );
  if (!row) throw new HttpError(404, "الإشعار غير موجود");
  visibleTask(ctx, row.task_id);
  exec(
    ctx.db,
    "UPDATE staff_notifications SET read_at=COALESCE(read_at,?) WHERE id=? AND user_id=?",
    [isoNow(), Number(ctx.params.id), ctx.user.id],
  );
  return json(ctx.res, 200, { ok: true });
}
