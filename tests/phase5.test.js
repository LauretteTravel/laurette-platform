import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, copyFileSync, realpathSync } from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { createApp } from "../server.js";
import { hashPassword, createSession } from "../lib/auth.js";
import { openDb } from "../lib/db.js";
import { ammanDay, dayStart, reportRange } from "../lib/report-time.js";
import { csvCell } from "../lib/reports.js";
import { rehearsePrivateCopy } from "../tools/rehearse-private-db.mjs";
const root = "/api/admin/reports",
  range = "from=2026-10-31&to=2026-10-31",
  stamp = "2026-10-31T12:00:00.000Z",
  now = () => new Date().toISOString();
let app, db, base, branch, otherBranch, department, otherDepartment, owner;
let seq = 0;
const grants = [
  "reports:read",
  "reports:export",
  "reports:finance",
  "reports:targets",
  "requests:read",
  "customers:read",
  "tasks:read",
];
function actor({
  scope = "assigned",
  permissions = grants,
  unit = branch,
  dept = department,
  mfa = true,
  mustChange = 0,
} = {}) {
  const key = "s5-" + randomBytes(6).toString("hex"),
    p = hashPassword("Synthetic-Report-Password42");
  db.prepare(
    "INSERT INTO role_definitions(role_key,name,base_role,data_scope,permissions,created_at,updated_at) VALUES(?,?,?,?,?,?,?)",
  ).run(key, key, "agent", scope, JSON.stringify(permissions), now(), now());
  const id = Number(
    db
      .prepare(
        "INSERT INTO users(username,name,role,role_key,branch_id,department_id,password_hash,password_salt,must_change,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
      )
      .run(
        key,
        "موظف تقارير مصطنع",
        "agent",
        key,
        unit,
        dept,
        p.hash,
        p.salt,
        mustChange,
        now(),
      ).lastInsertRowid,
  );
  return {
    id,
    key,
    cookie:
      "lt_session=" +
      createSession(db, id, "127.0.0.1", "synthetic", { mfaVerified: mfa })
        .token,
    branch: unit,
    department: dept,
  };
}
function request({
  user = owner,
  source = "case-" + ++seq,
  created = stamp,
  stage = "new",
  assigned = user.id,
  unit = user.branch,
  dept = user.department,
  response = null,
  closed = null,
  lostReason = null,
  customer = null,
  quote = null,
} = {}) {
  const id = Number(
    db
      .prepare(
        "INSERT INTO requests(reference,type,status,deal_status,assigned_to,branch_id,received_branch_id,department_id,source,lead_origin,payload,created_at,updated_at,first_response_at,completed_at,lost_reason,customer_id,quote_amount,quote_currency) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      )
      .run(
        "SYN5-" + randomBytes(6).toString("hex"),
        "flight",
        stage === "won" ? "confirmed" : stage === "lost" ? "cancelled" : "new",
        stage,
        assigned,
        unit,
        unit,
        dept,
        source,
        source,
        "{}",
        created,
        created,
        response,
        closed,
        lostReason,
        customer,
        quote,
        "USD",
      ).lastInsertRowid,
  );
  return { id, source };
}
function booking(
  r,
  {
    amount = 100,
    cost = 60,
    currency = "JOD",
    at = stamp,
    status = "confirmed",
  } = {},
) {
  return Number(
    db
      .prepare(
        "INSERT INTO bookings(request_id,reference,status,amount,cost_amount,currency,confirmed_by,confirmed_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)",
      )
      .run(
        r.id,
        "SYN-B5-" + randomBytes(5).toString("hex"),
        status,
        amount,
        cost,
        currency,
        owner.id,
        at,
        at,
      ).lastInsertRowid,
  );
}
function payment(b, amount, currency = "JOD", kind = "receipt", at = stamp) {
  return Number(
    db
      .prepare(
        "INSERT INTO booking_payments(booking_id,kind,amount,currency,recorded_by,created_at) VALUES(?,?,?,?,?,?)",
      )
      .run(b, kind, amount, currency, owner.id, at).lastInsertRowid,
  );
}
async function call(
  path,
  { user = owner, body, method = body ? "POST" : "GET", origin = base } = {},
) {
  const r = await fetch(base + path, {
    method,
    signal: AbortSignal.timeout(20000),
    headers: {
      origin,
      "content-type": "application/json",
      connection: "close",
      ...(user ? { cookie: user.cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  return {
    status: r.status,
    text,
    data: r.headers.get("content-type")?.includes("json")
      ? JSON.parse(text)
      : null,
    headers: r.headers,
  };
}
const report = async (source, user = owner, extra = "") =>
  call(
    root +
      "?" +
      range +
      (source ? "&source=" + encodeURIComponent(source) : "") +
      extra,
    { user },
  );
const goalBody = (u, extra = {}) => ({
  branchId: u.branch,
  departmentId: u.department,
  employeeId: u.id,
  metric: "requests",
  from: "2026-10-31",
  to: "2026-10-31",
  value: 10,
  reason: "هدف مصطنع موثق",
  ...extra,
});
before(async () => {
  const seed = JSON.parse(readFileSync("data/seed.json"));
  app = createApp({
    dbFile: ":memory:",
    seed: { ...seed, users: [] },
    adminPassword: "Synthetic-Report-Password42",
    baseUrl: "http://127.0.0.1:0",
  });
  db = app.db;
  [branch, otherBranch] = db
    .prepare("SELECT id FROM branches ORDER BY id LIMIT 2")
    .all()
    .map((r) => r.id);
  [department, otherDepartment] = db
    .prepare(
      "SELECT id FROM departments WHERE branch_id IS NULL ORDER BY id LIMIT 2",
    )
    .all()
    .map((r) => r.id);
  owner = actor();
  const a = await app.listen(0, "127.0.0.1");
  base = `http://127.0.0.1:${a.port}`;
});
after(async () => await app.close());

test("5 Amman half-open ranges, leap days, equal previous periods and historical DST use calendar-correct boundaries", () => {
  assert.equal(dayStart("2026-10-31"), "2026-10-30T21:00:00.000Z");
  assert.equal(ammanDay("2026-10-30T21:00:00Z"), "2026-10-31");
  assert.equal(dayStart("2021-01-15"), "2021-01-14T22:00:00.000Z");
  assert.equal(dayStart("2021-10-29"), "2021-10-28T21:00:00.000Z");
  for (const day of ["2021-03-26", "2021-10-29", "2020-10-30", "2022-10-28"]) {
    const start = dayStart(day);
    assert.equal(ammanDay(start), day);
    assert.notEqual(
      ammanDay(new Date(Date.parse(start) - 1).toISOString()),
      day,
    );
  }
  const r = reportRange({ from: "2024-02-28", to: "2024-03-01" });
  assert.equal(r.days, 3);
  assert.equal(r.previous.from, "2024-02-25");
  assert.equal(r.previous.to, "2024-02-27");
  assert.equal(
    reportRange({ period: "daily" }, "2026-10-31T22:00:00Z").from,
    "2026-11-01",
  );
  for (const v of [
    { from: "2026-02-30", to: "2026-03-01" },
    { from: "2026-10-31" },
    { from: "2026-11-01", to: "2026-10-31" },
    { from: "2024-01-01", to: "2025-01-01" },
  ])
    assert.throws(
      () => reportRange(v),
      (e) => e.status === 400,
    );
});
test("5 cohort counts and comparisons include the local midnight edge exactly once, never quote-derived revenue", async () => {
  const source = "boundary-" + ++seq;
  request({
    source,
    created: "2026-10-30T21:00:00.000Z",
    stage: "won",
    response: "2026-10-30T22:00:00Z",
    closed: "2026-10-30T23:00:00Z",
    quote: 999999,
  });
  request({
    source,
    created: "2026-10-31T20:59:59.999Z",
    stage: "lost",
    lostReason: "سبب مصطنع",
  });
  request({ source, created: "2026-10-31T21:00:00Z" });
  request({ source, created: "2026-10-29T22:00:00Z" });
  const r = await report(source);
  assert.equal(r.status, 200, r.text);
  assert.equal(r.data.summary.total, 2);
  assert.equal(r.data.summary.won, 1);
  assert.equal(r.data.summary.lost, 1);
  assert.equal(r.data.summary.conversion, 50);
  assert.equal(r.data.summary.responseSamples, 1);
  assert.equal(r.data.summary.avgResponseMinutes, 60);
  assert.equal(r.data.summary.avgCompletionMinutes, 120);
  assert.equal(r.data.summary.revenue, null);
  assert.equal(r.data.previous.total, 1);
  assert.equal(r.data.comparison.total.change, 1);
  assert.equal(r.data.comparison.total.percent, 100);
  assert.equal(r.data.series[0].total, 2);
  assert.equal(r.data.lostReasons[0].reason, "سبب مصطنع");
  assert.equal(r.data.finance.currencies.length, 0);
  assert.equal(r.data.finance.realizedProfit, null);
});
test("5 repeated historical midnight includes its first hour in requests, bookings, payments and target actuals", async () => {
  const user = actor(),
    source = "repeated-midnight-" + ++seq,
    at = "2021-10-28T21:30:00Z",
    r = request({ user, source, created: at, stage: "won" }),
    b = booking(r, { at });
  payment(b, 50, "JOD", "receipt", at);
  const result = await call(
    root + "?from=2021-10-29&to=2021-10-29&source=" + source,
    { user },
  );
  assert.equal(result.status, 200, result.text);
  assert.equal(result.data.summary.total, 1);
  assert.equal(result.data.series[0].total, 1);
  const j = result.data.finance.currencies.find((c) => c.currency === "JOD");
  assert.equal(j.bookedAmount, 100);
  assert.equal(j.netReceipts, 50);
  const goal = await call("/api/admin/report-targets", {
    user,
    body: goalBody(user, {
      from: "2021-10-29",
      to: "2021-10-29",
      metric: "net_receipts",
      currency: "JOD",
      value: 100,
    }),
  });
  assert.equal(goal.status, 201, goal.text);
  const targets = await call(
    "/api/admin/report-targets?from=2021-10-29&to=2021-10-29",
    { user },
  );
  assert.equal(
    targets.data.items.find((g) => g.id === goal.data.id).actual,
    50,
  );
});

test("5 empty sets and invalid duration samples remain unavailable with explicit denominators", async () => {
  let r = await report("not-present");
  assert.equal(r.data.summary.total, 0);
  assert.equal(r.data.summary.conversion, null);
  assert.equal(r.data.summary.avgResponseMinutes, null);
  assert.equal(r.data.comparison.total.percent, null);
  const source = "invalid-time-" + ++seq;
  request({
    source,
    stage: "won",
    response: "2026-10-30T00:00:00Z",
    closed: "bad timestamp",
  });
  r = await report(source);
  assert.equal(r.data.summary.responseSamples, 0);
  assert.equal(r.data.summary.completionSamples, 0);
  assert.equal(r.data.summary.responseRate, 0);
  assert.equal(r.data.summary.avgCompletionMinutes, null);
  assert.equal(r.data.availability.trueFirstContact.available, false);
  assert.equal(r.data.availability.campaigns.available, false);
});
test("5 finance separates currencies and cash periods, prevents join multiplication and exposes incomplete costs and balances", async () => {
  const source = "money-" + ++seq,
    a = booking(request({ source }), { currency: "د.أ" }),
    b = booking(request({ source }), { amount: 200, cost: null }),
    c = booking(request({ source }), {
      amount: 500,
      cost: 300,
      currency: "USD",
    }),
    old = booking(request({ source, created: "2026-10-29T23:00:00Z" }), {
      amount: 90,
      cost: 50,
      at: "2026-10-30T04:00:00Z",
    });
  payment(a, 40);
  payment(a, 5, "JOD", "refund");
  payment(a, 20, "JD", "receipt", "2026-10-30T12:00:00Z");
  payment(c, 100, "USD");
  payment(c, 10, "EUR");
  payment(old, 15);
  const r = await report(source);
  assert.equal(r.status, 200, r.text);
  const j = r.data.finance.currencies.find((x) => x.currency === "JOD"),
    usd = r.data.finance.currencies.find((x) => x.currency === "USD"),
    eur = r.data.finance.currencies.find((x) => x.currency === "EUR");
  assert.equal(j.bookingCount, 2);
  assert.equal(j.bookedAmount, 300);
  assert.equal(j.costSamples, 1);
  assert.equal(j.knownCost, 60);
  assert.equal(j.cost, null);
  assert.equal(j.estimatedMargin, null);
  assert.equal(j.knownMargin, 40);
  assert.equal(j.receipts, 55);
  assert.equal(j.refunds, 5);
  assert.equal(j.netReceipts, 50);
  assert.equal(j.outstanding, 245);
  assert.equal(usd.bookedAmount, 500);
  assert.equal(usd.cost, 300);
  assert.equal(usd.estimatedMargin, 200);
  assert.equal(usd.unmatchedBookings, 1);
  assert.equal(usd.outstanding, null);
  assert.equal(eur.bookedAmount, null);
  assert.equal(eur.netReceipts, 10);
  assert.equal(r.data.finance.exchangeRates.converted, false);
  assert.equal(
    r.data.financialComparison.find((x) => x.currency === "JOD").bookedAmount
      .change,
    210,
  );
  const rows = await call(
    root + "/details?" + range + "&source=" + source + "&kind=bookings",
  );
  assert.equal(rows.data.total, 3);
  const cash = await call(
    root + "/details?" + range + "&source=" + source + "&kind=payments",
  );
  assert.equal(cash.data.total, 5);
});
test("5 legacy nonnumeric costs and payment amounts are unavailable rather than silently coerced to zero", async () => {
  const source = "invalid-money-" + ++seq,
    user = actor(),
    b = booking(request({ user, source }), { cost: "unknown" });
  payment(b, "unknown");
  const r = await report(source, user);
  assert.equal(r.status, 200, r.text);
  const j = r.data.finance.currencies.find((r) => r.currency === "JOD");
  assert.equal(j.bookedAmount, 100);
  assert.equal(j.costSamples, 0);
  assert.equal(j.cost, null);
  assert.equal(j.estimatedMargin, null);
  assert.equal(j.netReceipts, null);
  assert.equal(j.invalidPayments, 1);
  assert.equal(j.outstanding, null);
  const g = await call("/api/admin/report-targets", {
    user,
    body: goalBody(user, {
      metric: "net_receipts",
      currency: "JOD",
      value: 10,
    }),
  });
  assert.equal(g.status, 201);
  const list = await call("/api/admin/report-targets?" + range, { user });
  assert.equal(list.data.items.find((t) => t.id === g.data.id).actual, null);
});

test("5 customer count uses its own creation date and scoped linked requests without exposing customer records", async () => {
  const source = "customers-" + ++seq,
    u = actor(),
    v = actor({ unit: otherBranch });
  const customer = (user) =>
    Number(
      db
        .prepare(
          "INSERT INTO customers(name,phone,created_at,updated_at) VALUES(?,?,?,?)",
        )
        .run("عميل مصطنع", "SYN" + ++seq, "2026-10-30T22:00:00Z", stamp)
        .lastInsertRowid,
    );
  const c = customer(u);
  request({ user: u, source, customer: c, created: "2026-10-20T00:00:00Z" });
  request({ user: v, source, customer: customer(v) });
  const r = await report(source, u);
  assert.equal(r.data.customers.count, 1);
  assert.equal(r.data.summary.total, 0);
  assert.ok(!r.text.includes("عميل مصطنع"));
  const no = actor({ permissions: ["requests:read", "reports:read"] });
  assert.equal((await report(source, no)).data.customers.count, null);
});
test("5 task due cohorts use immutable completion evidence, unknown timestamps are not counted as on-time", async () => {
  const u = actor(),
    source = "tasks-" + ++seq,
    r = request({ user: u, source });
  const make = (status, done = false) => {
    const id = Number(
      db
        .prepare(
          "INSERT INTO tasks(branch_id,department_id,request_id,title,priority,status,assigned_to,created_by,due_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
        )
        .run(
          branch,
          department,
          r.id,
          "مهمة مصطنعة",
          "normal",
          status,
          u.id,
          u.id,
          "2026-10-31T12:00:00Z",
          "2026-10-20T00:00:00Z",
          stamp,
        ).lastInsertRowid,
    );
    if (done)
      db.prepare(
        "INSERT INTO task_events(task_id,actor_id,kind,reason,before_json,after_json,created_at) VALUES(?,?,?,?,?,?,?)",
      ).run(
        id,
        u.id,
        "updated",
        "إنجاز مصطنع",
        '{"status":"in_progress"}',
        '{"status":"done"}',
        "2026-10-31T10:00:00Z",
      );
    return id;
  };
  make("done", true);
  make("done");
  make("new");
  make("cancelled");
  const d = (await report(source, u)).data.tasks;
  assert.equal(d.summary.total, 4);
  assert.equal(d.summary.done, 2);
  assert.equal(d.summary.completionSamples, 1);
  assert.equal(d.summary.missingCompletion, 1);
  assert.equal(d.summary.onTimeRate, 100);
  assert.equal(d.summary.overdue, 1);
  assert.equal(
    (
      await call(root + "/details?" + range + "&kind=tasks&source=" + source, {
        user: u,
      })
    ).data.total,
    4,
  );
});
test("5 current scope and all filters are identical in aggregate, details, CSV and private PDF", async () => {
  const source = "scope-" + ++seq,
    u = actor(),
    peer = actor(),
    outside = actor({ unit: otherBranch });
  request({ user: u, source });
  request({ user: peer, source });
  request({ user: outside, source });
  assert.equal((await report(source, u)).data.summary.total, 1);
  assert.equal(
    (await report(source, u, "&branch=" + otherBranch)).data.summary.total,
    0,
  );
  const q =
    range +
    "&source=" +
    source +
    "&employee=" +
    u.id +
    "&branch=" +
    branch +
    "&department=" +
    department;
  const details = await call(root + "/details?" + q, { user: u });
  assert.equal(details.data.total, 1);
  assert.equal(details.data.items[0].assigned_to, u.id);
  const csv = await call("/api/admin/reports.csv?" + q, { user: u });
  assert.equal(csv.status, 200);
  assert.ok(!csv.text.includes(outside.key));
  const pdf = await call(root + "/document?" + q, { user: u });
  assert.equal(pdf.status, 200);
  assert.match(pdf.headers.get("cache-control"), /no-store/);
  assert.match(
    pdf.headers.get("content-security-policy"),
    /frame-ancestors 'none'/,
  );
  assert.match(pdf.text, /تقرير الأداء/);
  assert.ok(!pdf.text.includes(outside.key));
  const moved = db
    .prepare("SELECT id FROM requests WHERE assigned_to=? AND source=?")
    .get(u.id, source).id;
  db.prepare("UPDATE requests SET branch_id=? WHERE id=?").run(
    otherBranch,
    moved,
  );
  assert.equal((await report(source, u)).data.summary.total, 0);
  assert.equal((await call(root + "/details?" + q, { user: u })).data.total, 0);
  request({ user: u, source, unit: null, dept: null });
  const org = actor({ scope: "organization" });
  assert.equal(
    (await report(source, org, "&branch=unassigned")).data.summary.total,
    1,
  );
  assert.equal(
    (
      await call(
        root + "/details?" + range + "&source=" + source + "&branch=unassigned",
        { user: org },
      )
    ).data.total,
    1,
  );
});
test("5 delegated membership metadata, records and target ownership use the selected unit and revoke immediately", async () => {
  const u = actor(),
    source = "delegation-" + ++seq;
  db.prepare("UPDATE branches SET active=1 WHERE id=?").run(otherBranch);
  const membership = Number(
    db
      .prepare(
        "INSERT INTO staff_memberships(user_id,role_key,branch_id,department_id,active,is_primary,created_at,updated_at) VALUES(?,?,?,?,1,0,?,?)",
      )
      .run(u.id, u.key, otherBranch, otherDepartment, now(), now())
      .lastInsertRowid,
  );
  const delegated = {
    ...u,
    branch: otherBranch,
    department: otherDepartment,
    cookie:
      "lt_session=" +
      createSession(db, u.id, "127.0.0.1", "synthetic", {
        mfaVerified: true,
        membershipId: membership,
      }).token,
  };
  request({ user: u, source, unit: otherBranch, dept: otherDepartment });
  const r = await report(source, delegated);
  assert.equal(r.status, 200, r.text);
  assert.equal(r.data.summary.total, 1);
  assert.ok(r.data.agents.some((a) => a.id === u.id));
  assert.equal((await report(source, u)).data.summary.total, 0);
  const g = await call("/api/admin/report-targets", {
    user: delegated,
    body: goalBody(delegated),
  });
  assert.equal(g.status, 201, g.text);
  assert.equal(
    (
      await call("/api/admin/report-targets/" + g.data.id + "/events", {
        user: u,
      })
    ).status,
    404,
  );
  db.prepare("UPDATE staff_memberships SET active=0 WHERE id=?").run(
    membership,
  );
  assert.equal((await report(source, delegated)).status, 401);
});

test("5 report read, request read, finance, export, tasks and MFA/password gates are independent", async () => {
  assert.equal((await report(null, null)).status, 401);
  assert.equal(
    (await report(null, actor({ permissions: ["reports:read"] }))).status,
    403,
  );
  assert.equal(
    (await report(null, actor({ permissions: ["requests:read"] }))).status,
    403,
  );
  for (const user of [actor({ mustChange: 1 }), actor({ mfa: false })])
    assert.equal((await report(null, user)).status, 403);
  const u = actor({ permissions: ["reports:read", "requests:read"] });
  const r = await report(null, u);
  assert.equal(r.status, 200);
  assert.equal(r.data.finance.available, false);
  assert.equal(r.data.tasks.available, false);
  assert.equal(
    (await call("/api/admin/reports.csv?" + range, { user: u })).status,
    403,
  );
  assert.equal(
    (await call(root + "/document?" + range, { user: u })).status,
    403,
  );
  assert.equal(
    (await call(root + "/details?" + range + "&kind=payments", { user: u }))
      .data.available,
    false,
  );
});
test("5 CSV quotes unicode, commas and newlines and neutralizes formulas; detail exports use exact filters", async () => {
  assert.equal(csvCell('=HYPERLINK("x")'), '"\'=HYPERLINK(""x"")"');
  assert.equal(csvCell(" \t@SUM(1)"), `"' \t@SUM(1)"`);
  assert.equal(csvCell('عربي, "اسم"\nسطر'), '"عربي, ""اسم""\nسطر"');
  assert.equal(csvCell(-12), '"-12"');
  const source = '=SYNTHETIC,"SOURCE"\nقناة',
    r = request({ source });
  const csv = await call(
    "/api/admin/reports.csv?" + range + "&source=" + encodeURIComponent(source),
  );
  assert.equal(csv.status, 200);
  assert.match(csv.text, /'=SYNTHETIC,""SOURCE""/);
  const detail = await call(
    "/api/admin/reports.csv?" +
      range +
      "&source=" +
      encodeURIComponent(source) +
      "&section=details&kind=requests",
  );
  assert.equal(detail.status, 200);
  assert.match(detail.text, new RegExp("SYN5-"));
  const other = await call(
    "/api/admin/reports.csv?" + range + "&employee=99999999&section=details",
  );
  assert.ok(
    !other.text.includes(
      db.prepare("SELECT reference FROM requests WHERE id=?").get(r.id)
        .reference,
    ),
  );
});
test("5 goals bind exact scopes, period and metric; overlaps and stale writes fail while history stays immutable", async () => {
  const u = actor();
  request({ user: u });
  request({ user: u, stage: "won" });
  let r = await call("/api/admin/report-targets", {
    user: u,
    body: goalBody(u),
  });
  assert.equal(r.status, 201, r.text);
  const id = r.data.id;
  assert.equal(
    (await call("/api/admin/report-targets", { user: u, body: goalBody(u) }))
      .status,
    409,
  );
  let list = (await call("/api/admin/report-targets?" + range, { user: u }))
    .data;
  assert.equal(list.items.find((g) => g.id === id).actual, 2);
  assert.equal(list.items.find((g) => g.id === id).progress, 20);
  r = await call("/api/admin/report-targets/" + id, {
    user: u,
    method: "PATCH",
    body: { revision: 1, value: 4, reason: "تعديل هدف مصطنع" },
  });
  assert.equal(r.status, 200);
  assert.equal(
    (
      await call("/api/admin/report-targets/" + id, {
        user: u,
        method: "PATCH",
        body: { revision: 1, value: 3, reason: "تعديل قديم" },
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await call("/api/admin/report-targets/" + id, {
        user: u,
        method: "PATCH",
        body: { revision: 2, branchId: otherBranch, reason: "تغيير جهة" },
      })
    ).status,
    422,
  );
  const history = await call("/api/admin/report-targets/" + id + "/events", {
    user: u,
  });
  assert.equal(history.data.events.length, 2);
  assert.equal(JSON.parse(history.data.events[0].after_json).value, 4);
  assert.throws(() =>
    db.prepare("DELETE FROM report_targets WHERE id=?").run(id),
  );
  assert.throws(() =>
    db
      .prepare(
        "UPDATE report_target_events SET reason='changed' WHERE target_id=?",
      )
      .run(id),
  );
  assert.throws(() =>
    db
      .prepare("UPDATE report_targets SET branch_id=? WHERE id=?")
      .run(otherBranch, id),
  );
  const peer = actor();
  assert.equal(
    (await call("/api/admin/report-targets/" + id + "/events", { user: peer }))
      .status,
    404,
  );
  const hidden = await call(
    "/api/admin/report-targets?" + range + "&source=website",
    { user: u },
  );
  assert.equal(hidden.data.items.length, 0);
  assert.match(hidden.data.reason, /الكامل/);
});
test("5 goal cancellation and reactivation enforce overlap atomically; failed history storage rolls back target and audit", async () => {
  const u = actor(),
    r = await call("/api/admin/report-targets", { user: u, body: goalBody(u) }),
    id = r.data.id;
  assert.equal(
    (
      await call("/api/admin/report-targets/" + id, {
        user: u,
        method: "PATCH",
        body: { revision: 1, active: false, reason: "إيقاف هدف" },
      })
    ).status,
    200,
  );
  assert.equal(
    (await call("/api/admin/report-targets", { user: u, body: goalBody(u) }))
      .status,
    201,
  );
  assert.equal(
    (
      await call("/api/admin/report-targets/" + id, {
        user: u,
        method: "PATCH",
        body: { revision: 2, active: true, reason: "إعادة تفعيل" },
      })
    ).status,
    409,
  );
  const before = db.prepare("SELECT COUNT(*) n FROM report_targets").get().n;
  db.exec(
    "CREATE TEMP TRIGGER fail_report_event BEFORE INSERT ON report_target_events BEGIN SELECT RAISE(ABORT,'synthetic failure');END",
  );
  try {
    const failed = await call("/api/admin/report-targets", {
      user: u,
      body: goalBody(u, { metric: "confirmed_requests" }),
    });
    assert.equal(failed.status, 500);
    assert.equal(
      db.prepare("SELECT COUNT(*) n FROM report_targets").get().n,
      before,
    );
  } finally {
    db.exec("DROP TRIGGER fail_report_event");
  }
});
test("5 money targets never invent actual zero without payments and enforce finance/CSRF/mid-body revocation", async () => {
  const u = actor();
  let r = await call("/api/admin/report-targets", {
    user: u,
    body: goalBody(u, { metric: "net_receipts", currency: "JOD", value: 100 }),
  });
  assert.equal(r.status, 201, r.text);
  let list = (await call("/api/admin/report-targets?" + range, { user: u }))
    .data;
  assert.equal(list.items.find((g) => g.id === r.data.id).actual, null);
  const b = booking(request({ user: u }));
  payment(b, 50);
  list = (await call("/api/admin/report-targets?" + range, { user: u })).data;
  assert.equal(list.items.find((g) => g.id === r.data.id).actual, 50);
  assert.equal(
    (
      await call("/api/admin/report-targets", {
        user: u,
        origin: "https://evil.example",
        body: goalBody(u),
      })
    ).status,
    403,
  );
  app.server.once("request", () =>
    db
      .prepare("UPDATE role_definitions SET permissions=? WHERE role_key=?")
      .run('["requests:read","reports:read"]', u.key),
  );
  assert.equal(
    (await call("/api/admin/report-targets", { user: u, body: goalBody(u) }))
      .status,
    403,
  );
  list = (await call("/api/admin/report-targets?" + range, { user: u })).data;
  assert.equal(list.items.length, 0);
});
test("5 invalid filters and pages fail explicitly, and export retrieval is audited without writing business records", async () => {
  for (const query of [
    "employee=no",
    "branch=0",
    "type=unknown",
    "from=2026-02-30&to=2026-03-01",
  ])
    assert.equal((await call(root + "?" + query)).status, 400);
  assert.equal(
    (await call(root + "/details?" + range + "&page=1.5")).status,
    400,
  );
  assert.equal(
    (await call(root + "/details?" + range + "&kind=unknown")).status,
    400,
  );
  const b = db.prepare("SELECT COUNT(*) n FROM bookings").get().n,
    p = db.prepare("SELECT COUNT(*) n FROM booking_payments").get().n;
  await call(root + "/document?" + range);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM bookings").get().n, b);
  assert.equal(
    db.prepare("SELECT COUNT(*) n FROM booking_payments").get().n,
    p,
  );
  assert.ok(
    db
      .prepare("SELECT COUNT(*) n FROM audit_log WHERE action='report.export'")
      .get().n > 0,
  );
});
test("5 migration7 to8 keeps all historical cells and checksums, retains a verified backup and restores exactly", () => {
  const file =
    "data/phase1b-testing/reports-" + randomBytes(6).toString("hex") + ".db";
  let raw = new DatabaseSync(file);
  raw.exec(readFileSync("tests/fixtures/pre-identity-crm.sql", "utf8"));
  raw.close();
  let d = openDb(file);
  assert.equal(d.prepare("PRAGMA user_version").get().user_version, 9);
  const backup = d.migrationBackups[7];
  raw = new DatabaseSync(backup, { readOnly: true });
  assert.equal(raw.prepare("PRAGMA user_version").get().user_version, 7);
  for (const { name } of raw
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
    )
    .all()) {
    const cols = raw
      .prepare(`PRAGMA table_info("${name}")`)
      .all()
      .map((c) => '"' + c.name + '"')
      .join(",");
    const before = raw
        .prepare(`SELECT ${cols} FROM "${name}" ORDER BY rowid`)
        .all(),
      after = d.prepare(`SELECT ${cols} FROM "${name}" ORDER BY rowid`).all();
    assert.deepEqual(
      ["audit_log", "schema_migrations"].includes(name)
        ? after.slice(0, before.length)
        : after,
      before,
      name,
    );
  }
  raw.close();
  d.close();
  const hash = createHash("sha256").update(readFileSync(backup)).digest("hex"),
    r = rehearsePrivateCopy({
      sourceFile: backup,
      privateRoot: realpathSync("data/phase1b-testing"),
    });
  assert.equal(r.candidateVersion, 9);
  assert.equal(r.migrationSnapshots, 2);
  assert.equal(r.historicalValuesPreserved, true);
  assert.equal(r.isolatedRestoreExact, true);
  assert.equal(
    createHash("sha256").update(readFileSync(backup)).digest("hex"),
    hash,
  );
  copyFileSync(backup, file + ".restore");
  d = openDb(file + ".restore");
  assert.equal(d.migrationBackups.length, 1);
  d.close();
  d = openDb(file + ".restore");
  assert.equal(d.migrationBackups.length, 0);
  d.close();
});
