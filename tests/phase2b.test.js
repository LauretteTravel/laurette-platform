import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, copyFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { createApp } from "../server.js";
import { openDb } from "../lib/db.js";
import { createSession, hashPassword } from "../lib/auth.js";

let app,
  db,
  base,
  branches,
  depts,
  manager,
  owner,
  peer,
  outside,
  counter = 0;
const password = "Synthetic-Tasks-Password42",
  hash = hashPassword(password),
  now = () => new Date().toISOString();
const path = () =>
  `data/phase1b-testing/tasks-${randomBytes(5).toString("hex")}.db`;
function actor(
  scope = "assigned",
  {
    branch = branches[0],
    department = depts[0],
    assign = false,
    permissions,
    mfa = true,
    mustChange = false,
    legacy,
  } = {},
) {
  const key = "tasks_" + ++counter,
    grants = permissions || [
      "tasks:read",
      "tasks:write",
      "requests:read",
      ...(assign ? ["tasks:assign"] : []),
    ];
  if (!legacy)
    db.prepare(
      "INSERT INTO role_definitions(role_key,name,base_role,data_scope,permissions,created_at,updated_at) VALUES(?,?,?,?,?,?,?)",
    ).run(key, key, "agent", scope, JSON.stringify(grants), now(), now());
  const id = Number(
    db
      .prepare(
        "INSERT INTO users(username,name,role,role_key,branch_id,department_id,password_hash,password_salt,must_change,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
      )
      .run(
        key,
        key,
        legacy || "agent",
        legacy ? null : key,
        branch,
        department,
        hash.hash,
        hash.salt,
        Number(mustChange),
        now(),
      ).lastInsertRowid,
  );
  return {
    id,
    branch,
    department,
    cookie:
      "lt_session=" +
      createSession(db, id, "127.0.0.1", "test", { mfaVerified: mfa }).token,
  };
}
async function call(
  path,
  { user = owner, body, method = body ? "POST" : "GET", origin } = {},
) {
  const res = await fetch(base + path, {
    method,
    headers: {
      origin: origin || base,
      "content-type": "application/json",
      ...(user ? { cookie: user.cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json() };
}
const payload = (extra = {}) => ({
  title: "مهمة تجريبية",
  description: "بيانات مصطنعة فقط",
  branchId: branches[0],
  departmentId: depts[0],
  dueAt: new Date(Date.now() + 3600000).toISOString(),
  ...extra,
});
const create = (extra = {}, user = owner) =>
  call("/api/admin/tasks", { user, body: payload(extra) });
const get = (id, user = owner) => call("/api/admin/tasks/" + id, { user });
const update = (id, extra = {}, user = owner) =>
  call("/api/admin/tasks/" + id, {
    user,
    method: "PATCH",
    body: { version: 1, reason: "تعديل تشغيلي تجريبي", ...extra },
  });
function request(user = owner) {
  return Number(
    db
      .prepare(
        "INSERT INTO requests(reference,type,branch_id,department_id,assigned_to,payload,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)",
      )
      .run(
        "TASK-REQ-" + ++counter,
        "flight",
        user.branch,
        user.department,
        user.id,
        "{}",
        now(),
        now(),
      ).lastInsertRowid,
  );
}
const snapshot = () =>
  JSON.stringify(
    [
      "tasks",
      "task_members",
      "task_events",
      "task_comments",
      "task_checklist",
      "staff_notifications",
      "audit_log",
    ].map((t) => db.prepare(`SELECT * FROM ${t}`).all()),
  );
before(async () => {
  const seed = JSON.parse(readFileSync("data/seed.json", "utf8"));
  app = createApp({
    dbFile: ":memory:",
    seed: { ...seed, users: [] },
    adminPassword: password,
    baseUrl: "http://127.0.0.1:0",
  });
  db = app.db;
  branches = db
    .prepare("SELECT id FROM branches ORDER BY id")
    .all()
    .map((r) => r.id);
  depts = db
    .prepare(
      "SELECT id FROM departments WHERE branch_id IS NULL ORDER BY id LIMIT 2",
    )
    .all()
    .map((r) => r.id);
  const addr = await app.listen(0, "127.0.0.1");
  base = `http://127.0.0.1:${addr.port}`;
  owner = actor();
  peer = actor();
  manager = actor("branch", { assign: true });
  outside = actor("assigned", { branch: branches[1] });
});
after(async () => await app?.close());
beforeEach(() => app.limiter.reset());

test("2B migration upgrades v2 with a restorable private snapshot and preserves prior checksums and identity", () => {
  const file = path();
  let raw = new DatabaseSync(file);
  raw.exec(readFileSync("tests/fixtures/pre-identity-crm.sql", "utf8"));
  raw.close();
  let migrated = openDb(file);
  const backup = migrated.migrationBackups[2];
  assert.equal(migrated.prepare("PRAGMA user_version").get().user_version, 3);
  migrated.close();
  const restored = path();
  copyFileSync(backup, restored);
  raw = new DatabaseSync(restored);
  assert.equal(raw.prepare("PRAGMA user_version").get().user_version, 2);
  const ledger = raw
      .prepare("SELECT * FROM schema_migrations ORDER BY version")
      .all(),
    users = raw.prepare("SELECT * FROM users").all(),
    profiles = raw.prepare("SELECT * FROM employees").all();
  raw.close();
  migrated = openDb(restored);
  assert.equal(migrated.migrationBackups.length, 1);
  assert.deepEqual(
    migrated
      .prepare(
        "SELECT * FROM schema_migrations WHERE version<3 ORDER BY version",
      )
      .all(),
    ledger,
  );
  assert.deepEqual(migrated.prepare("SELECT * FROM users").all(), users);
  assert.deepEqual(migrated.prepare("SELECT * FROM employees").all(), profiles);
  assert.equal(
    migrated.prepare("PRAGMA integrity_check").get().integrity_check,
    "ok",
  );
  assert.equal(migrated.prepare("PRAGMA foreign_key_check").all().length, 0);
  const second = migrated.migrationBackups[0];
  raw = new DatabaseSync(second, { readOnly: true });
  assert.equal(
    raw.prepare("PRAGMA integrity_check").get().integrity_check,
    "ok",
  );
  assert.equal(raw.prepare("PRAGMA user_version").get().user_version, 2);
  raw.close();
  migrated.close();
  migrated = openDb(restored);
  assert.equal(migrated.migrationBackups.length, 0);
  migrated.close();
});

test("2B existing role grants expand explicitly, task privileges remain independently configurable", async () => {
  const role = JSON.parse(
    db
      .prepare(
        "SELECT permissions FROM role_definitions WHERE role_key='sales_agent'",
      )
      .get().permissions,
  );
  assert.equal(role.includes("tasks:read"), true);
  assert.equal(role.includes("tasks:write"), true);
  const reader = actor("branch", { permissions: ["tasks:read"] });
  const before = snapshot();
  assert.equal((await create({}, reader)).status, 403);
  assert.equal(snapshot(), before);
  const id = (await create()).data.id;
  assert.equal((await get(id, reader)).status, 200);
  assert.equal(
    (await get(id, actor("branch", { permissions: ["requests:read"] }))).status,
    403,
  );
});

test("2B personal and group tasks retain one owner and notify only other participants", async () => {
  const result = await create(
    { assignedTo: owner.id, members: [peer.id, peer.id] },
    manager,
  );
  assert.equal(result.status, 201);
  const task = (await get(result.data.id)).data;
  assert.equal(task.task.assigned_to, owner.id);
  assert.deepEqual(
    task.members.map((m) => m.user_id),
    [peer.id],
  );
  assert.equal((await get(result.data.id, peer)).status, 200);
  const notifications = (await call("/api/admin/notifications")).data;
  assert.equal(
    notifications.notifications.some((n) => n.task_id === result.data.id),
    true,
  );
  assert.equal(
    db
      .prepare(
        "SELECT COUNT(*) n FROM staff_notifications WHERE task_id=? AND user_id=?",
      )
      .get(result.data.id, manager.id).n,
    0,
  );
  const reader = actor("branch", { permissions: ["tasks:read"] });
  assert.equal(
    (await call("/api/admin/notifications", { user: reader })).data.unread,
    0,
  );
});

test("2B branch/department/ownership isolation and assignment cannot grant linked request access", async () => {
  const id = (await create()).data.id,
    departmentActor = actor("department", { department: depts[1] }),
    before = snapshot();
  for (const user of [outside, peer, departmentActor]) {
    assert.equal((await get(id, user)).status, 404);
    assert.equal((await update(id, {}, user)).status, 404);
    assert.equal(
      (
        await call(`/api/admin/tasks/${id}/comments`, {
          user,
          body: { body: "not allowed" },
        })
      ).status,
      404,
    );
  }
  assert.equal(snapshot(), before);
  assert.equal((await create({ assignedTo: outside.id }, manager)).status, 422);
  assert.equal((await create({ assignedTo: peer.id })).status, 422);
  const requestId = request();
  assert.equal(
    (await create({ requestId, assignedTo: peer.id }, manager)).status,
    422,
  );
  const reference = db
    .prepare("SELECT reference FROM requests WHERE id=?")
    .get(requestId).reference;
  assert.equal(
    (await create({ requestReference: reference, requestId: requestId + 999 }))
      .status,
    422,
  );
  const linked = (await create({ requestReference: reference })).data.id;
  assert.equal((await get(linked)).status, 200);
  db.prepare("UPDATE requests SET assigned_to=? WHERE id=?").run(
    peer.id,
    requestId,
  );
  assert.equal((await get(linked)).status, 404);
  assert.equal((await get(linked, peer)).status, 404);
});

test("2B task transitions, checklist completion and optimistic edit conflicts are atomic", async () => {
  const id = (await create()).data.id;
  assert.equal((await update(id, { status: "done" })).status, 422);
  assert.equal((await update(id, { status: "in_progress" })).status, 200);
  let before = snapshot();
  assert.equal((await update(id, { status: "waiting" })).status, 409);
  assert.equal(snapshot(), before);
  assert.equal(
    (
      await call(`/api/admin/tasks/${id}/checklist`, {
        body: { title: "مراجعة المستندات" },
      })
    ).status,
    201,
  );
  assert.equal((await update(id, { version: 2, status: "done" })).status, 422);
  const item = (await get(id)).data.checklist[0];
  assert.equal(
    (
      await call(`/api/admin/task-checklist/${item.id}`, {
        method: "PATCH",
        body: { version: item.version, done: true },
      })
    ).status,
    200,
  );
  before = snapshot();
  assert.equal(
    (
      await call(`/api/admin/task-checklist/${item.id}`, {
        method: "PATCH",
        body: { version: item.version, done: false },
      })
    ).status,
    409,
  );
  assert.equal(snapshot(), before);
  assert.equal((await update(id, { version: 2, status: "done" })).status, 200);
  assert.equal(
    (await update(id, { version: 3, status: "in_progress" })).status,
    422,
  );
});

test("2B task ownership transfer needs explicit capability and logs from/to and reason", async () => {
  const id = (await create({}, manager)).data.id;
  let before = snapshot();
  assert.equal(
    (await update(id, { assignedTo: owner.id }, manager)).status,
    200,
  );
  const row = (await get(id)).data.task;
  assert.equal(row.assigned_to, owner.id);
  assert.equal(row.version, 2);
  const event = db
    .prepare(
      "SELECT before_json,after_json FROM task_events WHERE task_id=? AND kind='updated'",
    )
    .get(id);
  assert.equal(JSON.parse(event.before_json).assigned_to, manager.id);
  assert.equal(JSON.parse(event.after_json).assigned_to, owner.id);
  before = snapshot();
  assert.equal(
    (await update(id, { version: 2, assignedTo: peer.id })).status,
    403,
  );
  assert.equal(snapshot(), before);
  assert.equal(
    (await call("/api/admin/notifications")).data.notifications.some(
      (n) => n.task_id === id,
    ),
    true,
  );
});

test("2B comments and task history are append-only; participants can collaborate without core ownership power", async () => {
  const id = (
    await create({ assignedTo: owner.id, members: [peer.id] }, manager)
  ).data.id;
  assert.equal(
    (
      await call(`/api/admin/tasks/${id}/comments`, {
        user: peer,
        body: { body: "<script>تعليق داخلي</script>" },
      })
    ).status,
    201,
  );
  assert.equal(
    (await get(id, peer)).data.comments[0].body,
    "<script>تعليق داخلي</script>",
  );
  assert.equal((await update(id, {}, peer)).status, 403);
  assert.throws(
    () =>
      db
        .prepare("UPDATE task_events SET reason='changed' WHERE task_id=?")
        .run(id),
    /append-only/,
  );
  assert.throws(
    () => db.prepare("DELETE FROM task_comments WHERE task_id=?").run(id),
    /append-only/,
  );
  const audited = db
    .prepare(
      "SELECT after_json FROM audit_log WHERE entity='tasks' AND entity_id=? AND action='db-insert'",
    )
    .get(String(id));
  assert.equal(audited.after_json.includes("description"), false);
  assert.equal(audited.after_json.includes("title"), false);
});

test("2B notifications and unread counts do not leak after request access or ownership is removed", async () => {
  const req = request();
  const id = (await create({ assignedTo: owner.id, requestId: req }, manager))
    .data.id;
  const first = (await call("/api/admin/notifications")).data;
  const notification = first.notifications.find((n) => n.task_id === id);
  assert.ok(notification);
  assert.equal(
    (
      await call(`/api/admin/notifications/${notification.id}/read`, {
        user: peer,
        body: {},
      })
    ).status,
    404,
  );
  assert.equal(
    (
      await call(`/api/admin/notifications/${notification.id}/read`, {
        body: {},
      })
    ).status,
    200,
  );
  const readAt = db
    .prepare("SELECT read_at FROM staff_notifications WHERE id=?")
    .get(notification.id).read_at;
  assert.equal(
    (
      await call(`/api/admin/notifications/${notification.id}/read`, {
        body: {},
      })
    ).status,
    200,
  );
  assert.equal(
    db
      .prepare("SELECT read_at FROM staff_notifications WHERE id=?")
      .get(notification.id).read_at,
    readAt,
  );
  db.prepare("UPDATE requests SET assigned_to=? WHERE id=?").run(peer.id, req);
  const hidden = (await call("/api/admin/notifications")).data;
  assert.equal(
    hidden.notifications.some((n) => n.task_id === id),
    false,
  );
  assert.equal(
    (
      await call(`/api/admin/notifications/${notification.id}/read`, {
        body: {},
      })
    ).status,
    404,
  );
  assert.equal(
    hidden.unread,
    db
      .prepare(
        `SELECT COUNT(*) n FROM staff_notifications n JOIN tasks t ON t.id=n.task_id WHERE n.user_id=? AND n.read_at IS NULL AND t.request_id IS NULL AND (t.assigned_to=? OR t.created_by=? OR EXISTS(SELECT 1 FROM task_members m WHERE m.task_id=t.id AND m.user_id=?))`,
      )
      .get(owner.id, owner.id, owner.id, owner.id).n,
  );
});

test("2B invalid input, CSRF and MFA/must_change gates leave business records unchanged", async () => {
  const before = snapshot();
  for (const extra of [
    { title: "ab" },
    { departmentId: "invalid" },
    { dueAt: "2026-02-30T10:00:00Z" },
    { dueAt: "2026-11-01T10:00" },
    { priority: "fake" },
    { members: [-1] },
    { members: Array(31).fill(peer.id) },
  ])
    assert.equal((await create(extra)).status, 422, JSON.stringify(extra));
  assert.equal(
    (
      await call("/api/admin/tasks", {
        body: payload(),
        origin: "https://outside.invalid",
      })
    ).status,
    403,
  );
  const temp = actor("assigned", { mustChange: true }),
    unverified = actor("organization", { legacy: "admin", mfa: false });
  for (const user of [temp, unverified])
    assert.equal((await create({}, user)).status, 403);
  // Actor fixture creation itself is audited; compare only business tables after it.
  assert.equal(
    db.prepare("SELECT COUNT(*) n FROM tasks").get().n,
    JSON.parse(before)[0].length,
  );
});

test("2B list filters distinguish team, own, overdue and terminal tasks", async () => {
  const user = actor(),
    id = (
      await create({ dueAt: new Date(Date.now() - 60000).toISOString() }, user)
    ).data.id;
  assert.equal(
    (await call("/api/admin/tasks?due=overdue", { user })).data.tasks.some(
      (t) => t.id === id && t.overdue === 1,
    ),
    true,
  );
  assert.equal(
    (await call("/api/admin/tasks?due=next24h", { user })).data.total,
    0,
  );
  assert.equal(
    (await call("/api/admin/tasks?view=team", { user })).data.total,
    1,
  );
  assert.equal((await update(id, { status: "cancelled" }, user)).status, 200);
  assert.equal((await call("/api/admin/tasks", { user })).data.total, 0);
  assert.equal(
    (await call("/api/admin/tasks?status=all", { user })).data.total,
    1,
  );
});

test("2B active delegated context isolates standalone tasks and notifications between branches", async () => {
  const user = actor(),
    primaryTask = (await create({}, user)).data.id;
  const role = db
    .prepare("SELECT role_key FROM users WHERE id=?")
    .get(user.id).role_key;
  const membership = Number(
    db
      .prepare(
        "INSERT INTO staff_memberships(user_id,role_key,branch_id,department_id,active,is_primary,created_at,updated_at) VALUES(?,?,?,?,1,0,?,?)",
      )
      .run(user.id, role, branches[1], depts[0], now(), now()).lastInsertRowid,
  );
  const delegated = {
    ...user,
    cookie:
      "lt_session=" +
      createSession(db, user.id, "127.0.0.1", "test", {
        membershipId: membership,
        mfaVerified: true,
      }).token,
  };
  const second = await create({ branchId: branches[1] }, delegated);
  assert.equal(second.status, 201);
  assert.equal((await get(primaryTask, delegated)).status, 404);
  assert.equal((await get(second.data.id, user)).status, 404);
  assert.equal((await get(second.data.id, delegated)).status, 200);
  const event = Number(
    db
      .prepare(
        "INSERT INTO task_events(task_id,kind,reason,created_at) VALUES(?,'created','Synthetic notification',?)",
      )
      .run(second.data.id, now()).lastInsertRowid,
  );
  db.prepare(
    "INSERT INTO staff_notifications(user_id,task_id,event_id,kind,created_at) VALUES(?,?,?,'created',?)",
  ).run(user.id, second.data.id, event, now());
  assert.equal(
    (await call("/api/admin/notifications", { user })).data.unread,
    0,
  );
  assert.equal(
    (await call("/api/admin/notifications", { user: delegated })).data.unread,
    1,
  );
});

test("2B open standalone tasks prevent organizational unit deactivation", async () => {
  const admin = actor("organization", { legacy: "admin" });
  const branchId = Number(
    db
      .prepare(
        "INSERT INTO branches(code,name,created_at,updated_at) VALUES(?,?,?,?)",
      )
      .run("task-unit-" + ++counter, "جهة تجريبية " + counter, now(), now())
      .lastInsertRowid,
  );
  const result = await create({ branchId, departmentId: null }, admin);
  assert.equal(result.status, 201);
  assert.equal(
    (
      await call("/api/admin/branches/" + branchId, {
        user: admin,
        method: "PATCH",
        body: { active: false, reason: "اختبار حماية النشاط" },
      })
    ).status,
    409,
  );
  assert.equal(
    (await update(result.data.id, { status: "cancelled" }, admin)).status,
    200,
  );
  assert.equal(
    (
      await call("/api/admin/branches/" + branchId, {
        user: admin,
        method: "PATCH",
        body: { active: false, reason: "تسوية النشاط قبل التعطيل" },
      })
    ).status,
    200,
  );
});


test('2B a notification insertion failure rolls back task, participants, events and audit together', async () => {
  const before = snapshot();
  db.exec("CREATE TRIGGER synthetic_notification_failure BEFORE INSERT ON staff_notifications BEGIN SELECT RAISE(ABORT,'synthetic delivery failure'); END;");
  try {
    const result = await create({assignedTo:owner.id,members:[peer.id]},manager);
    assert.equal(result.status,500);
    assert.equal(snapshot(),before);
  } finally { db.exec('DROP TRIGGER synthetic_notification_failure'); }
});


test('2B notification pagination retains access to older unread notifications without duplicates',async()=>{
 const user=actor(),id=(await create({},user)).data.id;
 for(let i=0;i<55;i++){
   const event=Number(db.prepare("INSERT INTO task_events(task_id,kind,reason,created_at) VALUES(?,'comment','Synthetic pagination',?)").run(id,now()).lastInsertRowid);
   db.prepare("INSERT INTO staff_notifications(user_id,task_id,event_id,kind,created_at) VALUES(?,?,?,'comment',?)").run(user.id,id,event,now());
 }
 const first=(await call('/api/admin/notifications',{user})).data,second=(await call('/api/admin/notifications?page=2',{user})).data;
 assert.equal(first.unread,55);assert.equal(first.notifications.length,50);assert.equal(second.notifications.length,5);assert.equal(first.pages,2);
 assert.equal(second.notifications.some(n=>first.notifications.some(a=>a.id===n.id)),false);
 assert.equal((await call('/api/admin/notifications/'+second.notifications[0].id+'/read',{user,body:{}})).status,200);
 assert.equal((await call('/api/admin/notifications',{user})).data.unread,54);
});
