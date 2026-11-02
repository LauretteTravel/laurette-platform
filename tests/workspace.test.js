import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomBytes, createHash } from "node:crypto";
import { createApp } from "../server.js";
import { hashPassword, createSession, sessionUser } from "../lib/auth.js";
import { workspaceData } from "../lib/workspace-data.js";
import { createExchangeRateService } from "../lib/exchange-rates.js";
const fixed = "2026-11-02T12:00:00.000Z",
  all = [
    "overview:read",
    "requests:read",
    "requests:write",
    "customers:read",
    "customers:write",
    "tasks:read",
    "vouchers:read",
    "exchange:manage",
  ];
let app,
  db,
  base,
  branch,
  otherBranch,
  dept,
  otherDept,
  owner,
  seq = 0;
function actor({
  scope = "assigned",
  perms = all,
  unit = branch,
  department = dept,
  mfa = true,
  mustChange = 0,
} = {}) {
  const key = "ws-" + randomBytes(4).toString("hex"),
    p = hashPassword("Synthetic-Workspace-Password42");
  db.prepare(
    "INSERT INTO role_definitions(role_key,name,base_role,data_scope,permissions,created_at,updated_at) VALUES(?,?,?,?,?,?,?)",
  ).run(key, key, "agent", scope, JSON.stringify(perms), fixed, fixed);
  const id = Number(
    db
      .prepare(
        "INSERT INTO users(username,name,role,role_key,branch_id,department_id,password_hash,password_salt,must_change,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
      )
      .run(
        key,
        key,
        "agent",
        key,
        unit,
        department,
        p.hash,
        p.salt,
        mustChange,
        fixed,
      ).lastInsertRowid,
  );
  const token = createSession(db, id, "127.0.0.1", "synthetic", {
    mfaVerified: mfa,
  }).token;
  return {
    id,
    key,
    branch: unit,
    dept: department,
    token,
    cookie: "lt_session=" + token,
  };
}
function customer(at = fixed) {
  return Number(
    db
      .prepare(
        "INSERT INTO customers(name,phone,created_at,updated_at) VALUES(?,?,?,?)",
      )
      .run(
        "عميل اختبار " + ++seq,
        "+962790" + String(seq).padStart(6, "0"),
        at,
        at,
      ).lastInsertRowid,
  );
}
function request({
  u = owner,
  created = fixed,
  status = "new",
  client = customer(),
  unit = u.branch,
  department = u.dept,
} = {}) {
  return Number(
    db
      .prepare(
        "INSERT INTO requests(reference,type,status,deal_status,customer_id,assigned_to,branch_id,department_id,payload,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
      )
      .run(
        "WS-" + ++seq,
        "flight",
        status,
        status === "confirmed" ? "won" : "new",
        client,
        u.id,
        unit,
        department,
        JSON.stringify({ destination: "وجهة اختبار" }),
        created,
        created,
      ).lastInsertRowid,
  );
}
function follow(id, due) {
  return Number(
    db
      .prepare(
        "INSERT INTO request_follow_ups(request_id,assigned_to,due_at,note,status,created_by,created_at) VALUES(?,?,?,?,?,?,?)",
      )
      .run(id, owner.id, due, "متابعة اختبار", "open", owner.id, fixed)
      .lastInsertRowid,
  );
}
function task(u, due, requestId = null) {
  return Number(
    db
      .prepare(
        "INSERT INTO tasks(branch_id,department_id,request_id,title,priority,status,assigned_to,created_by,due_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
      )
      .run(
        u.branch,
        u.dept,
        requestId,
        "مهمة اختبار",
        "high",
        "new",
        u.id,
        u.id,
        due,
        fixed,
        fixed,
      ).lastInsertRowid,
  );
}
function ctx(u, query = {}) {
  return {
    db,
    token: u.token,
    user: sessionUser(db, u.token),
    query,
    settings: {},
    ip: "127.0.0.1",
  };
}
async function call(
  path,
  { u = owner, method = "GET", body, origin = base } = {},
) {
  const res = await fetch(base + path, {
    method,
    headers: {
      origin,
      "x-requested-with": "fetch",
      "content-type": "application/json",
      ...(u ? { cookie: u.cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json() };
}
async function direct(service, u) {
  let result;
  const c = ctx(u);
  c.res = {
    writeHead() {},
    end(v) {
      result = JSON.parse(v);
    },
  };
  await service.getRates(c);
  return result;
}
before(async () => {
  const seed = JSON.parse(readFileSync("data/seed.json"));
  app = createApp({
    dbFile: ":memory:",
    seed: { ...seed, users: [] },
    adminPassword: "Synthetic-Workspace-Password42",
    baseUrl: "http://127.0.0.1:0",
  });
  db = app.db;
  [branch, otherBranch] = db
    .prepare("SELECT id FROM branches ORDER BY id LIMIT 2")
    .all()
    .map((r) => r.id);
  [dept, otherDept] = db
    .prepare(
      "SELECT id FROM departments WHERE branch_id IS NULL ORDER BY id LIMIT 2",
    )
    .all()
    .map((r) => r.id);
  owner = actor();
  const a = await app.listen(0);
  base = "http://127.0.0.1:" + a.port;
});
after(async () => {
  await app.close();
});

test("workspace daily metrics use Amman boundaries and unique CRM clients, not repeated new requests", () => {
  const u = actor(),
    c = customer("2026-11-01T21:00:00.000Z");
  request({ u, client: c, created: "2026-11-01T21:00:00Z" });
  request({ u, client: c, status: "quoted" });
  request({ u, client: customer("2026-11-01T20:59:59.999Z") });
  request({ u, client: customer("2026-11-02T21:00:00Z") });
  const d = workspaceData(ctx(u, { workspaceTab: "new" }), { now: fixed });
  assert.equal(d.today, "2026-11-02");
  assert.equal(d.metrics.newCustomers, 1);
  assert.equal(d.work.total, 1);
  assert.equal(d.work.items[0].customerId, c);
  assert.equal(d.metrics.waitingQuotes, 1);
});
test("workspace KPI drilldown matches today followups and overdue tasks independently from the whole work queue", () => {
  const u = actor(),
    r = request({ u });
  follow(r, "2026-11-01T20:00:00Z");
  follow(r, "2026-11-02T17:00:00Z");
  follow(r, "2026-11-02T21:00:00Z");
  task(u, "2026-11-02T11:59:59Z");
  task(u, "2026-11-02T18:00:00Z");
  const d = workspaceData(ctx(u), { now: fixed });
  assert.equal(d.metrics.todayFollowUps, 1);
  assert.equal(d.metrics.overdueTasks, 1);
  assert.equal(d.work.counts.followups, 2);
  assert.equal(d.work.counts.tasks, 2);
  assert.equal(
    workspaceData(
      ctx(u, { workspaceTab: "followups", workspaceDue: "today" }),
      { now: fixed },
    ).work.total,
    1,
  );
  assert.equal(
    workspaceData(ctx(u, { workspaceTab: "tasks", workspaceDue: "overdue" }), {
      now: fixed,
    }).work.total,
    1,
  );
});
test("workspace applies active branch/department ownership to rows, counters and activity, including delegated context", () => {
  const u = actor(),
    own = request({ u });
  request({ u, unit: otherBranch });
  request({ u, department: otherDept });
  db.prepare(
    "INSERT INTO request_events(request_id,kind,message,created_at) VALUES(?,?,?,?)",
  ).run(own, "note", "اختبار مرئي", fixed);
  const outside = request({ u: actor({ unit: otherBranch }) });
  db.prepare(
    "INSERT INTO request_events(request_id,kind,message,created_at) VALUES(?,?,?,?)",
  ).run(outside, "note", "PRIVATE_OUTSIDE_SENTINEL", fixed);
  const d = workspaceData(ctx(u), { now: fixed });
  assert.equal(d.metrics.newCustomers, 1);
  assert.equal(d.work.counts.new, 1);
  assert.ok(!JSON.stringify(d).includes("PRIVATE_OUTSIDE_SENTINEL"));
  const member = Number(
    db
      .prepare(
        "INSERT INTO staff_memberships(user_id,role_key,branch_id,department_id,active,is_primary,created_at,updated_at) VALUES(?,?,?,?,1,0,?,?)",
      )
      .run(u.id, u.key, otherBranch, dept, fixed, fixed).lastInsertRowid,
  );
  const token = createSession(db, u.id, "127.0.0.1", "synthetic", {
    mfaVerified: true,
    membershipId: member,
  }).token;
  const delegated = { ...u, token };
  const alt = workspaceData(ctx(delegated), { now: fixed });
  assert.equal(alt.metrics.newCustomers, 1);
  assert.ok(alt.work.items.every((i) => i.requestId !== own));
});
test("workspace respects source permissions and never leaks linked request data to a task-only role", () => {
  const none = actor({ perms: ["overview:read"] }),
    d = workspaceData(ctx(none), { now: fixed });
  assert.ok(Object.values(d.metrics).every((v) => v === null));
  assert.equal(d.work.total, 0);
  assert.equal(d.activity.total, 0);
  assert.equal(d.intake, null);
  const u = actor({ perms: ["overview:read", "tasks:read"] }),
    linked = request({ u });
  task(u, "2026-11-02T10:00:00Z", linked);
  task(u, "2026-11-02T10:00:00Z");
  const t = workspaceData(ctx(u), { now: fixed });
  assert.equal(t.work.total, 1);
  assert.equal(t.work.items[0].phone, null);
  assert.equal(t.work.items[0].requestId, null);
});
test("workspace work and activity pages are bounded, stable and reject malformed pagination and filters", () => {
  const u = actor();
  for (let i = 0; i < 7; i++) {
    const id = request({ u, status: "quoted" });
    db.prepare(
      "INSERT INTO request_events(request_id,kind,message,created_at) VALUES(?,?,?,?)",
    ).run(id, "note", "نشاط اختبار", fixed);
  }
  const one = workspaceData(ctx(u, { workspaceTab: "quotes" }), { now: fixed }),
    two = workspaceData(
      ctx(u, {
        workspaceTab: "quotes",
        workspacePage: 2,
        workspaceActivityPage: 2,
      }),
      { now: fixed },
    );
  assert.equal(one.work.items.length, 4);
  assert.equal(two.work.items.length, 3);
  assert.equal(one.work.pages, 2);
  assert.equal(one.activity.items.length, 4);
  assert.equal(two.activity.items.length, 3);
  assert.ok(
    !one.work.items.some((i) =>
      two.work.items.some((j) => i.rowKey === j.rowKey),
    ),
  );
  for (const query of [
    { workspaceTab: "bad" },
    { workspaceDue: "bad" },
    { workspacePage: 1.5 },
    { workspaceActivityPage: -1 },
  ])
    assert.throws(
      () => workspaceData(ctx(u, query), { now: fixed }),
      (e) => e.status === 400,
    );
});
test("workspace upcoming bookings require issued current snapshots, actual dates and a currently confirmed request", () => {
  const u = actor(),
    r = request({ u, status: "confirmed" });
  const make = (kind, date, status = "issued") => {
    const id = randomBytes(8).toString("hex"),
      data = {
        data:
          kind === "flight"
            ? { flight: { segments: [{ departAt: date }] } }
            : { hotel: { checkIn: date } },
      },
      json = JSON.stringify(data);
    db.prepare(
      "INSERT INTO voucher_bookings(id,request_id,kind,created_by,created_at) VALUES(?,?,?,?,?)",
    ).run(id, r, kind, u.id, fixed);
    db.prepare(
      "INSERT INTO employee_vouchers(id,reference,kind,booking_id,status,revision,current_version,created_by,created_at,updated_at) VALUES(?,?,?,?,?,1,0,?,?,?)",
    ).run(id, "V-" + id, kind, id, status, u.id, fixed, fixed);
    db.prepare(
      "INSERT INTO voucher_versions(voucher_id,version,snapshot_json,sha256,issued_by,issued_at) VALUES(?,1,?,?,?,?)",
    ).run(
      id,
      json,
      createHash("sha256").update(json).digest("hex"),
      u.id,
      fixed,
    );
    db.prepare("UPDATE employee_vouchers SET current_version=1 WHERE id=?").run(
      id,
    );
  };
  make("flight", "2026-11-03T12:00:00+03:00");
  make("hotel", "2026-11-02");
  make("flight", "2026-11-02T10:00:00Z");
  make("hotel", "2026-11-04", "cancelled");
  make("hotel", "");
  const d = workspaceData(ctx(u, { workspaceTab: "bookings" }), { now: fixed });
  assert.equal(d.metrics.upcomingBookings, 2);
  assert.equal(d.work.total, 2);
  db.prepare("UPDATE requests SET status='cancelled' WHERE id=?").run(r);
  assert.equal(
    workspaceData(ctx(u), { now: fixed }).metrics.upcomingBookings,
    0,
  );
});
test("workspace reuses the overview contract and contains no fabricated rates when a provider is absent", async () => {
  const r = await call("/api/admin/overview");
  assert.equal(r.status, 200);
  for (const key of [
    "stats",
    "recent",
    "needsAction",
    "statuses",
    "types",
    "user",
    "workspace",
  ])
    assert.ok(key in r.data, key);
  const fx = await call("/api/admin/exchange-rates");
  assert.equal(fx.status, 200);
  assert.equal(fx.data.providerConfigured, false);
  assert.deepEqual(fx.data.selected, [
    "USD",
    "EUR",
    "GBP",
    "SAR",
    "AED",
    "TRY",
  ]);
  assert.ok(
    fx.data.items.every((i) => i.value === null && i.state === "unavailable"),
  );
});
test("workspace legacy overview fields also withhold CRM data without the source capability", async () => {
  const u = actor({ perms: ["overview:read"] }),
    r = request({ u });
  db.prepare("UPDATE requests SET summary=? WHERE id=?").run(
    "UNREADABLE_CRM_SENTINEL",
    r,
  );
  const result = await call("/api/admin/overview", { u });
  assert.equal(result.status, 200);
  assert.equal(result.data.stats, null);
  assert.deepEqual(result.data.recent, []);
  assert.deepEqual(result.data.needsAction, []);
  assert.ok(!JSON.stringify(result.data).includes("UNREADABLE_CRM_SENTINEL"));
});
test("workspace intake cannot rename an existing customer outside the current request scope", async () => {
  const u = actor({ scope: "branch" }),
    outside = customer();
  request({ u, client: outside, unit: otherBranch });
  const original = db
    .prepare("SELECT name,phone FROM customers WHERE id=?")
    .get(outside);
  const body = {
    type: "consult",
    topic: "general",
    name: "اسم يجب ألا يكتب",
    phone: original.phone,
    consent: true,
    message: "طلب استشارة مصطنع",
    branchId: branch,
    departmentId: dept,
  };
  const denied = await call("/api/admin/requests", { u, method: "POST", body });
  assert.equal(denied.status, 409);
  assert.equal(
    db.prepare("SELECT name FROM customers WHERE id=?").get(outside).name,
    original.name,
  );
  assert.equal(
    db
      .prepare("SELECT COUNT(*) n FROM requests WHERE customer_id=?")
      .get(outside).n,
    1,
  );
  request({ u, client: outside, unit: branch });
  assert.equal(
    (await call("/api/admin/requests", { u, method: "POST", body })).status,
    201,
  );
});
test("exchange management requires organization scope, explicit capability, MFA, password gate and CSRF", async () => {
  for (const u of [
    null,
    actor({ perms: ["overview:read"] }),
    actor({ scope: "branch" }),
    actor({ scope: "organization", mfa: false }),
    actor({ scope: "organization", mustChange: 1 }),
  ])
    assert.equal(
      (
        await call("/api/admin/exchange-rates", {
          u,
          method: "PATCH",
          body: {},
        })
      ).status,
      u ? 403 : 401,
    );
  const u = actor({ scope: "organization" });
  assert.equal(
    (
      await call("/api/admin/exchange-rates", {
        u,
        method: "PATCH",
        body: {},
        origin: "https://not-laurette.invalid",
      })
    ).status,
    403,
  );
});
test("exchange manual rates persist with source/time/expiry and separate audit history; stale revisions never overwrite", async () => {
  const u = actor({ scope: "organization" }),
    now = Date.now();
  const body = {
    revision: 0,
    selected: ["USD", "EUR"],
    overrides: [
      {
        code: "USD",
        value: 0.72,
        source: "مصدر اختبار يدوي",
        asOf: new Date(now).toISOString(),
        validUntil: new Date(now + 3600000).toISOString(),
      },
    ],
    reason: "اعتماد يدوي مصطنع",
  };
  assert.equal(
    (await call("/api/admin/exchange-rates", { u, method: "PATCH", body }))
      .status,
    200,
  );
  const read = await call("/api/admin/exchange-rates", { u });
  const usd = read.data.items.find((i) => i.code === "USD");
  assert.equal(usd.value, 0.72);
  assert.equal(usd.state, "manual");
  assert.equal(usd.changePercent, null);
  assert.equal(read.data.revision, 1);
  assert.equal(
    (await call("/api/admin/exchange-rates", { u, method: "PATCH", body }))
      .status,
    409,
  );
  const logs = db
    .prepare(
      "SELECT meta FROM audit_log WHERE action='exchange.manual' AND entity_id='USD'",
    )
    .all();
  assert.equal(logs.length, 1);
  assert.equal(JSON.parse(logs[0].meta).after.value, 0.72);
  const other = await call("/api/admin/exchange-rates", {
    u: actor({ perms: ["overview:read"] }),
  });
  assert.equal(other.data.manualOverrides, undefined);
  assert.equal(other.data.items.find((i) => i.code === "USD").state, "manual");
});
test("exchange rejects invented provider direction, invalid amounts, future timestamps and stale data labeled as fresh", async () => {
  let clock = Date.now(),
    value = {
      base: "USD",
      quote: "JOD_PER_UNIT",
      asOf: new Date(clock).toISOString(),
      rates: { EUR: 1 },
    };
  const service = createExchangeRateService({
    db,
    provider: { name: "Synthetic provider", fetchRates: async () => value },
    clock: () => clock,
  });
  const u = actor({ scope: "organization" });
  let r = await direct(service, u);
  assert.equal(r.refreshFailed, true);
  assert.equal(r.items.find((i) => i.code === "EUR").value, null);
  clock += 300001;
  value = {
    base: "JOD",
    quote: "JOD_PER_UNIT",
    asOf: new Date(clock + 9999999).toISOString(),
    rates: { EUR: 1 },
  };
  r = await direct(service, u);
  assert.equal(r.refreshFailed, true);
  clock += 300001;
  value = {
    base: "JOD",
    quote: "JOD_PER_UNIT",
    asOf: new Date(clock).toISOString(),
    rates: { EUR: -1 },
  };
  assert.equal((await direct(service, u)).refreshFailed, true);
});
test("exchange provider cache, single-flight refresh, trends and failure fallback retain provenance", async () => {
  let clock = Date.now(),
    calls = 0,
    fail = false,
    rate = 0.8;
  const provider = {
    name: "Synthetic API",
    fetchRates: async () => {
      calls++;
      await new Promise((r) => setTimeout(r, 5));
      if (fail) throw Error("PRIVATE_PROVIDER_SECRET");
      return {
        base: "JOD",
        quote: "JOD_PER_UNIT",
        asOf: new Date(clock).toISOString(),
        rates: { EUR: rate },
      };
    },
  };
  const service = createExchangeRateService({
      db,
      provider,
      clock: () => clock,
    }),
    u = actor({ scope: "organization" });
  const [a, b] = await Promise.all([direct(service, u), direct(service, u)]);
  assert.equal(calls, 1);
  assert.equal(a.items.find((i) => i.code === "EUR").state, "api");
  assert.equal(b.items.find((i) => i.code === "EUR").value, 0.8);
  clock += 300001;
  rate = 0.88;
  const next = await direct(service, u);
  assert.equal(calls, 2);
  assert.ok(
    Math.abs(next.items.find((i) => i.code === "EUR").changePercent - 10) <
      0.00001,
  );
  clock += 300001;
  fail = true;
  const fallback = await direct(service, u);
  assert.equal(fallback.refreshFailed, true);
  assert.equal(fallback.items.find((i) => i.code === "EUR").state, "stale");
  assert.equal(fallback.items.find((i) => i.code === "EUR").value, 0.88);
  assert.ok(!JSON.stringify(fallback).includes("PRIVATE_PROVIDER_SECRET"));
});
test("exchange timeout stays bounded, aborts the provider and still returns a labeled last-good value", async () => {
  let aborted = false;
  const service = createExchangeRateService({
      db,
      provider: {
        name: "Synthetic blocked",
        fetchRates: ({ signal }) =>
          new Promise(() =>
            signal.addEventListener("abort", () => (aborted = true)),
          ),
      },
      timeoutMs: 20,
    }),
    u = actor({ scope: "organization" });
  const r = await direct(service, u);
  assert.equal(aborted, true);
  assert.equal(r.refreshFailed, true);
  assert.equal(r.items.find((i) => i.code === "EUR").state, "stale");
});
test("exchange manual validation and audit failures preserve the previous revision atomically", async () => {
  const u = actor({ scope: "organization" }),
    read = await call("/api/admin/exchange-rates", { u }),
    baseBody = {
      revision: read.data.revision,
      selected: ["USD"],
      overrides: [],
      reason: "اختبار حماية الإعداد",
    };
  for (const overrides of [
    [{ code: "BAD", value: 1 }],
    [{ code: "USD", value: 0 }],
    [{ code: "USD", value: 1, source: "x", asOf: fixed, validUntil: fixed }],
    [
      {
        code: "USD",
        value: 1,
        source: "مصدر",
        asOf: new Date().toISOString(),
        validUntil: new Date(Date.now() + 9 * 86400000).toISOString(),
      },
    ],
  ])
    assert.equal(
      (
        await call("/api/admin/exchange-rates", {
          u,
          method: "PATCH",
          body: { ...baseBody, overrides },
        })
      ).status,
      422,
    );
  db.exec(
    "CREATE TEMP TRIGGER fail_exchange_audit BEFORE INSERT ON main.audit_log WHEN NEW.action='exchange.update' BEGIN SELECT RAISE(ABORT,'synthetic failure'); END",
  );
  assert.equal(
    (
      await call("/api/admin/exchange-rates", {
        u,
        method: "PATCH",
        body: baseBody,
      })
    ).status,
    500,
  );
  db.exec("DROP TRIGGER fail_exchange_audit");
  assert.equal(
    (await call("/api/admin/exchange-rates", { u })).data.revision,
    baseBody.revision,
  );
});
test("exchange provider wait rechecks live authorization and never returns after a session is revoked", async () => {
  let release, started;
  const ready = new Promise((r) => (started = r));
  const u = actor({ scope: "organization" }),
    service = createExchangeRateService({
      db,
      provider: {
        name: "Synthetic delayed",
        fetchRates: () => {
          started();
          return new Promise((r) => (release = r));
        },
      },
    });
  const pending = direct(service, u);
  await ready;
  db.prepare("DELETE FROM sessions WHERE user_id=?").run(u.id);
  release({
    base: "JOD",
    quote: "JOD_PER_UNIT",
    asOf: new Date().toISOString(),
    rates: { GBP: 0.9 },
  });
  await assert.rejects(pending, (e) => e.status === 401);
});
