import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, copyFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { createApp } from "../server.js";
import { openDb } from "../lib/db.js";
import { createSession, hashPassword } from "../lib/auth.js";
import { runDeadlineJob, deadlinePolicy } from "../lib/deadlines.js";
let app,
  db,
  base,
  branches,
  depts,
  admin,
  n = 0;
const tick = Date.now(),
  hash = hashPassword("Synthetic-Deadline-Password42");
function actor(
  scope = "assigned",
  {
    branch = branches[0],
    department = depts[0],
    assign = false,
    org = false,
    legacy,
  } = {},
) {
  const key = "deadline_" + ++n,
    now = new Date().toISOString();
  if (!legacy)
    db.prepare(
      "INSERT INTO role_definitions(role_key,name,base_role,data_scope,permissions,created_at,updated_at) VALUES(?,?,?,?,?,?,?)",
    ).run(
      key,
      key,
      "agent",
      scope,
      JSON.stringify([
        "tasks:read",
        "tasks:write",
        "requests:read",
        ...(assign ? ["tasks:assign", "requests:assign"] : []),
        ...(org ? ["organization:write"] : []),
      ]),
      now,
      now,
    );
  const id = Number(
    db
      .prepare(
        "INSERT INTO users(username,name,role,role_key,branch_id,department_id,password_hash,password_salt,created_at) VALUES(?,?,?,?,?,?,?,?,?)",
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
        now,
      ).lastInsertRowid,
  );
  return {
    id,
    key,
    branch,
    department,
    cookie:
      "lt_session=" +
      createSession(db, id, "127.0.0.1", "test", { mfaVerified: true }).token,
  };
}
function task(user, minutes, requestId = null) {
  const now = new Date().toISOString();
  return Number(
    db
      .prepare(
        "INSERT INTO tasks(branch_id,department_id,request_id,title,priority,assigned_to,created_by,due_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
      )
      .run(
        user.branch,
        user.department,
        requestId,
        "Synthetic deadline " + ++n,
        "normal",
        user.id,
        user.id,
        new Date(tick + minutes * 60000).toISOString(),
        now,
        now,
      ).lastInsertRowid,
  );
}
function follow(user, minutes) {
  const now = new Date().toISOString(),
    request = Number(
      db
        .prepare(
          "INSERT INTO requests(reference,type,branch_id,department_id,assigned_to,payload,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)",
        )
        .run(
          "DEADLINE-" + ++n,
          "flight",
          user.branch,
          user.department,
          user.id,
          "{}",
          now,
          now,
        ).lastInsertRowid,
    ),
    id = Number(
      db
        .prepare(
          "INSERT INTO request_follow_ups(request_id,assigned_to,due_at,note,created_at) VALUES(?,?,?,?,?)",
        )
        .run(
          request,
          user.id,
          new Date(tick + minutes * 60000).toISOString(),
          "Synthetic follow-up",
          now,
        ).lastInsertRowid,
    );
  return { id, request };
}
async function api(
  path,
  { user = admin, body, method = body ? "POST" : "GET", origin } = {},
) {
  const res = await fetch(base + path, {
    method,
    headers: {
      origin: origin || base,
      "content-type": "application/json",
      cookie: user.cookie,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json() };
}
const alerts = (kind, id) =>
  db
    .prepare(
      `SELECT * FROM operations_alerts WHERE ${kind === "task" ? "task_id" : "follow_up_id"}=? ORDER BY id`,
    )
    .all(id);
before(async () => {
  const seed = JSON.parse(readFileSync("data/seed.json", "utf8"));
  app = createApp({
    dbFile: ":memory:",
    seed: { ...seed, users: [] },
    adminPassword: "Synthetic-Deadline-Password42",
    baseUrl: "http://127.0.0.1:0",
  });
  db = app.db;
  const a = await app.listen(0, "127.0.0.1");
  base = `http://127.0.0.1:${a.port}`;
  branches = db
    .prepare("SELECT id FROM branches ORDER BY id LIMIT 2")
    .all()
    .map((r) => r.id);
  depts = db
    .prepare("SELECT id FROM departments WHERE branch_id IS NULL LIMIT 2")
    .all()
    .map((r) => r.id);
  admin = actor("organization", { legacy: "admin" });
});
after(async () => await app.close());
beforeEach(() => app.limiter.reset());

test("2D default is disabled and policy changes require institution scope, reason and revision", async () => {
  const owner = actor();
  task(owner, -2000);
  const before = db.prepare("SELECT COUNT(*) n FROM audit_log").get().n;
  assert.equal(deadlinePolicy(db).enabled, false);
  assert.equal(runDeadlineJob(db, { now: tick }).created, 0);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM audit_log").get().n, before);
  const branchManager = actor("branch", { org: true });
  assert.equal(
    (await api("/api/admin/deadline-policy", { user: branchManager })).status,
    403,
  );
  const body = {
    enabled: true,
    soonMinutes: 60,
    escalateMinutes: 120,
    revision: 0,
    reason: "اعتماد سياسة اختبار مصطنعة",
  };
  assert.equal(
    (await api("/api/admin/deadline-policy", { body: { ...body, reason: "" } }))
      .status,
    422,
  );
  assert.equal(
    (
      await api("/api/admin/deadline-policy", {
        body: { ...body, soonMinutes: 1 },
      })
    ).status,
    422,
  );
  assert.equal(
    (
      await api("/api/admin/deadline-policy", {
        body,
        origin: "https://outside.invalid",
      })
    ).status,
    403,
  );
  assert.equal((await api("/api/admin/deadline-policy", { body })).status, 200);
  assert.equal((await api("/api/admin/deadline-policy", { body })).status, 409);
});
test("2D due-soon, overdue and escalation occur once per deadline and owner without changing work", () => {
  const owner = actor(),
    manager = actor("branch", { assign: true });
  db.prepare("UPDATE employees SET manager_id=? WHERE user_id=?").run(
    manager.id,
    owner.id,
  );
  const id = task(owner, 30),
    before = db.prepare("SELECT * FROM tasks WHERE id=?").get(id);
  runDeadlineJob(db, { now: tick });
  assert.deepEqual(
    alerts("task", id).map((r) => r.kind),
    ["soon"],
  );
  assert.equal(runDeadlineJob(db, { now: tick }).created, 0);
  runDeadlineJob(db, { now: tick + 60 * 60000 });
  assert.deepEqual(
    alerts("task", id).map((r) => r.kind),
    ["soon", "overdue"],
  );
  runDeadlineJob(db, { now: tick + 180 * 60000 });
  assert.deepEqual(
    alerts("task", id).map((r) => r.kind),
    ["soon", "overdue", "escalated"],
  );
  assert.equal(alerts("task", id)[2].user_id, manager.id);
  assert.equal(runDeadlineJob(db, { now: tick + 180 * 60000 }).created, 0);
  assert.deepEqual(
    db.prepare("SELECT * FROM tasks WHERE id=?").get(id),
    before,
  );
  assert.equal(
    db
      .prepare(
        "SELECT COUNT(*) n FROM task_events WHERE task_id=? AND kind='escalated'",
      )
      .get(id).n,
    1,
  );
});
test("2D escalation never routes to absent, disabled, cross-branch or unprivileged manager", () => {
  for (const opts of [
    null,
    { branch: branches[1], assign: true },
    { assign: false },
    { assign: true, disabled: true },
  ]) {
    const owner = actor(),
      id = task(owner, -300);
    if (opts) {
      const manager = actor("branch", opts);
      db.prepare("UPDATE employees SET manager_id=? WHERE user_id=?").run(
        manager.id,
        owner.id,
      );
      if (opts.disabled)
        db.prepare("UPDATE users SET active=0 WHERE id=?").run(manager.id);
    }
    runDeadlineJob(db, { now: tick });
    assert.equal(
      alerts("task", id).filter((r) => r.kind === "escalated").length,
      0,
    );
  }
});
test("2D escalation visibility follows the current direct manager and assignment privilege", async () => {
  const owner = actor(),
    manager = actor("branch", { assign: true });
  db.prepare("UPDATE employees SET manager_id=? WHERE user_id=?").run(
    manager.id,
    owner.id,
  );
  const id = task(owner, -300);
  runDeadlineJob(db, { now: tick });
  assert.equal(
    (
      await api("/api/admin/deadline-alerts", { user: manager })
    ).data.alerts.some((a) => a.entity_id === id),
    true,
  );
  db.prepare("UPDATE employees SET manager_id=NULL WHERE user_id=?").run(
    owner.id,
  );
  assert.equal(
    (
      await api("/api/admin/deadline-alerts", { user: manager })
    ).data.alerts.some((a) => a.entity_id === id),
    false,
  );
});
test("2D request follow-ups escalate with request scope and keep their original status and owner", async () => {
  const owner = actor(),
    manager = actor("department", { assign: true });
  db.prepare("UPDATE employees SET manager_id=? WHERE user_id=?").run(
    manager.id,
    owner.id,
  );
  const f = follow(owner, -180),
    before = db
      .prepare("SELECT * FROM request_follow_ups WHERE id=?")
      .get(f.id);
  runDeadlineJob(db, { now: tick });
  assert.equal(
    alerts("follow", f.id).filter((a) => a.kind === "escalated").length,
    1,
  );
  assert.deepEqual(
    db.prepare("SELECT * FROM request_follow_ups WHERE id=?").get(f.id),
    before,
  );
  const data = (await api("/api/admin/deadline-alerts", { user: owner })).data;
  assert.equal(
    data.alerts.some(
      (a) =>
        a.entity === "follow" &&
        a.entity_id === f.id &&
        a.request_id === f.request,
    ),
    true,
  );
  assert.equal(
    db
      .prepare(
        "SELECT COUNT(*) n FROM request_events WHERE request_id=? AND kind='follow_up'",
      )
      .get(f.request).n,
    1,
  );
});
test("2D alerts and unread counts hide resolved, rescheduled, reassigned and inaccessible linked work", async () => {
  const owner = actor(),
    id = task(owner, -10);
  runDeadlineJob(db, { now: tick });
  const a = alerts("task", id)[0];
  assert.ok(a);
  const other = actor();
  assert.equal(
    (
      await api("/api/admin/deadline-alerts/" + a.id + "/read", {
        user: other,
        body: {},
      })
    ).status,
    404,
  );
  assert.equal(
    (
      await api("/api/admin/deadline-alerts/" + a.id + "/read", {
        user: owner,
        body: {},
      })
    ).status,
    200,
  );
  db.prepare("UPDATE tasks SET due_at=? WHERE id=?").run(
    new Date(tick - 20 * 60000).toISOString(),
    id,
  );
  assert.equal(
    (await api("/api/admin/deadline-alerts", { user: owner })).data.alerts.some(
      (r) => r.id === a.id,
    ),
    false,
  );
  runDeadlineJob(db, { now: tick });
  assert.equal(alerts("task", id).length, 2);
  db.prepare("UPDATE tasks SET status='done' WHERE id=?").run(id);
  assert.equal(
    (await api("/api/admin/deadline-alerts", { user: owner })).data.unread,
    0,
  );
  const f = follow(owner, -30),
    linked = task(owner, -30, f.request);
  runDeadlineJob(db, { now: tick });
  db.prepare("UPDATE requests SET assigned_to=? WHERE id=?").run(
    other.id,
    f.request,
  );
  const hidden = (await api("/api/admin/deadline-alerts", { user: owner }))
    .data;
  assert.equal(
    hidden.alerts.some((a) => a.entity_id === linked && a.entity === "task"),
    false,
  );
  assert.equal(
    hidden.alerts.some((a) => a.entity_id === f.id && a.entity === "follow"),
    false,
  );
});
test("2D workload and paged drill-down contain only authorized source records and actual counts", async () => {
  const owner = actor(),
    outsider = actor("assigned", { branch: branches[1] });
  for (let i = 0; i < 27; i++) task(owner, -10);
  task(outsider, -20);
  follow(owner, 30);
  task(owner, 240);
  const data = (await api("/api/admin/deadlines", { user: owner })).data;
  assert.equal(data.rows.length, 1);
  assert.equal(data.rows[0].open, 29);
  assert.equal(data.rows[0].overdue, 27);
  assert.equal(data.rows[0].soon, 1);
  assert.equal(data.due.length, 25);
  assert.equal(data.total, 28);
  assert.equal(data.pages, 2);
  assert.equal(
    (await api("/api/admin/deadlines?page=2", { user: owner })).data.due.length,
    3,
  );
  assert.equal(
    (await api("/api/admin/deadlines?owner=" + outsider.id, { user: owner }))
      .data.total,
    0,
  );
});
test("2D scheduler batch is atomic when notification insertion fails; retries remain possible", () => {
  const owner = actor(),
    id = task(owner, -100),
    before = JSON.stringify(alerts("task", id));
  db.exec(
    `CREATE TRIGGER synthetic_deadline_failure BEFORE INSERT ON operations_alerts WHEN NEW.task_id=${id} BEGIN SELECT RAISE(ABORT,'Synthetic alert failure');END;`,
  );
  try {
    assert.throws(
      () => runDeadlineJob(db, { now: tick }),
      /Synthetic alert failure/,
    );
    assert.equal(JSON.stringify(alerts("task", id)), before);
  } finally {
    db.exec("DROP TRIGGER synthetic_deadline_failure");
  }
  runDeadlineJob(db, { now: tick });
  assert.equal(alerts("task", id).length, 1);
});
test("2D migration4 snapshot restores ledger and alert deduplication survives database reopen", () => {
  const file =
    "data/phase1b-testing/deadlines-" + randomBytes(6).toString("hex") + ".db";
  let raw = new DatabaseSync(file);
  raw.exec(readFileSync("tests/fixtures/pre-identity-crm.sql", "utf8"));
  raw.close();
  let d = openDb(file);
  assert.equal(d.prepare("PRAGMA user_version").get().user_version, 5);
  const backup = d.migrationBackups[4];
  d.close();
  const restored = file + ".v4";
  copyFileSync(backup, restored);
  raw = new DatabaseSync(restored, { readOnly: true });
  assert.equal(raw.prepare("PRAGMA user_version").get().user_version, 4);
  const ledger = raw.prepare("SELECT * FROM schema_migrations").all();
  raw.close();
  d = openDb(restored);
  assert.equal(d.migrationBackups.length, 1);
  assert.deepEqual(
    d.prepare("SELECT * FROM schema_migrations WHERE version<5").all(),
    ledger,
  );
  assert.equal(d.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
  d.close();
  const snapshot = file + ".alerts";
  db.prepare("VACUUM INTO ?").run(snapshot);
  const old = db.prepare("SELECT * FROM operations_alerts ORDER BY id").all();
  d = openDb(snapshot);
  assert.deepEqual(
    d.prepare("SELECT * FROM operations_alerts ORDER BY id").all(),
    old,
  );
  assert.equal(runDeadlineJob(d, { now: tick }).created, 0);
  d.close();
});


test('2D bounded batches advance through old duplicate alerts without starving later deadlines',()=>{
 const owner=actor();for(let i=0;i<501;i++)task(owner,-1000);
 for(let i=0;i<4;i++){const result=runDeadlineJob(db,{now:tick});assert.ok(result.examined<=500);assert.ok(result.created<=1000);}
 assert.equal(db.prepare('SELECT COUNT(*) n FROM operations_alerts WHERE user_id=?').get(owner.id).n,501);
});


test('phase2 review: request-only roles do not receive alerts they cannot open in the deadline inbox', async()=>{
 const owner=actor();const f=follow(owner,-1001);
 db.prepare('UPDATE role_definitions SET permissions=? WHERE role_key=?').run('["requests:read"]',owner.key);
 runDeadlineJob(db,{now:tick});
 assert.equal(alerts('follow',f.id).length,0);
 assert.equal((await api('/api/admin/deadline-alerts',{user:owner})).status,403);
});
