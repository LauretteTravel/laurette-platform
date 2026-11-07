import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, copyFileSync, realpathSync } from "node:fs";
import { randomBytes, createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { createApp } from "../server.js";
import { createSession, hashPassword } from "../lib/auth.js";
import { openDb } from "../lib/db.js";
import { zonedFlightTime, voucherData } from "../lib/voucher-data.js";
import { rehearsePrivateCopy } from "../tools/rehearse-private-db.mjs";
const permissions = [
  "requests:read",
  "vouchers:read",
  "vouchers:write",
  "vouchers:issue",
  "vouchers:cancel",
  "vouchers:export",
];
let app, db, base, branch, otherBranch, department, owner, outsider, requestId;
const now = () => new Date().toISOString();
const flight = () => ({
  language: "ar",
  bookingReference: "SYNPNR",
  people: [{ name: "مسافر مصطنع للاختبار", ticketNumber: "1234567890123" }],
  notes: "بيانات مصطنعة فقط",
  flight: {
    airline: "شركة طيران مصطنعة",
    baggage: "23kg + 8kg",
    segments: [
      {
        from: "AMM — عمّان",
        to: "IST — إسطنبول",
        flightNumber: "SYN123",
        departAt: "2027-04-01T12:30+03:00",
        departZone: "Asia/Amman",
        arriveAt: "2027-04-01T15:00+03:00",
        arriveZone: "Europe/Istanbul",
      },
    ],
  },
});
const hotel = () => ({
  language: "en",
  bookingReference: "HOTEL-SYN-01",
  people: [{ name: "Synthetic Guest", ticketNumber: "" }],
  notes: "Synthetic only",
  hotel: {
    name: "Synthetic Hotel",
    address: "Test address",
    checkIn: "2027-04-01",
    checkOut: "2027-04-04",
    checkInTime: "14:00",
    checkOutTime: "12:00",
    roomType: "Single",
    mealPlan: "Breakfast",
    guestCount: 1,
    cancellationPolicy: "Free cancellation before 2027-03-28",
  },
});
function actor(
  scope = "assigned",
  {
    perms = permissions,
    unit = branch,
    dept = department,
    role = "agent",
    mustChange = 0,
    mfa = true,
  } = {},
) {
  const name = "v3-" + randomBytes(5).toString("hex"),
    p = hashPassword("Synthetic-Voucher-Password42");
  db.prepare(
    "INSERT INTO role_definitions(role_key,name,base_role,data_scope,permissions,created_at,updated_at) VALUES(?,?,?,?,?,?,?)",
  ).run(name, name, role, scope, JSON.stringify(perms), now(), now());
  const id = Number(
    db
      .prepare(
        "INSERT INTO users(username,name,role,role_key,branch_id,department_id,password_hash,password_salt,must_change,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
      )
      .run(
        name,
        "موظف قسائم مصطنع",
        role,
        name,
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
    roleKey: name,
    cookie:
      "lt_session=" +
      createSession(db, id, "127.0.0.1", "test", { mfaVerified: mfa }).token,
  };
}
function request(actor, { status = "confirmed", unit = branch } = {}) {
  return Number(
    db
      .prepare(
        "INSERT INTO requests(reference,type,status,branch_id,department_id,assigned_to,payload,title,summary,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
      )
      .run(
        "SYN-V3-" + randomBytes(6).toString("hex"),
        "flight",
        status,
        unit,
        department,
        actor.id,
        "{}",
        "طلب مصطنع للقسائم",
        "Synthetic request",
        now(),
        now(),
      ).lastInsertRowid,
  );
}
async function call(
  path,
  { user = owner, body, method = body ? "POST" : "GET", origin = base } = {},
) {
  const res = await fetch(base + path, {
    method,
    headers: {
      origin,
      "content-type": "application/json",
      ...(user ? { cookie: user.cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return {
    status: res.status,
    headers: res.headers,
    text,
    data: res.headers.get("content-type")?.includes("application/json")
      ? JSON.parse(text)
      : null,
  };
}
const path = (id) => "/api/admin/vouchers/" + id;
const detail = async (id, user = owner) =>
  (await call(path(id), { user })).data;
const make = async (
  kind = "flight",
  data = kind === "flight" ? flight() : hotel(),
  user = owner,
  id = requestId,
) =>
  call("/api/admin/vouchers", {
    user,
    body: { kind, data, requestId: id, reason: "إنشاء مصطنع للاختبار" },
  });
const command = async (id, action, user = owner, extra = {}) => {
  const row = await detail(id, user);
  return call(path(id) + "/" + action, {
    user,
    body: {
      revision: row.voucher.revision,
      reason: "سبب مصطنع موثق",
      ...extra,
    },
  });
};
const ledger = () =>
  JSON.stringify(
    Object.fromEntries(
      [
        "voucher_bookings",
        "employee_vouchers",
        "voucher_sequences",
        "voucher_versions",
        "voucher_events",
        "audit_log",
      ].map((t) => [t, db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all()]),
    ),
  );
before(async () => {
  const seed = JSON.parse(readFileSync("data/seed.json", "utf8"));
  app = createApp({
    dbFile: ":memory:",
    seed: { ...seed, users: [] },
    adminPassword: "Synthetic-Voucher-Password42",
    baseUrl: "http://127.0.0.1:0",
  });
  db = app.db;
  const units = db.prepare("SELECT id FROM branches ORDER BY id LIMIT 2").all();
  branch = units[0].id;
  otherBranch = units[1].id;
  department = db
    .prepare("SELECT id FROM departments WHERE branch_id IS NULL LIMIT 1")
    .get().id;
  owner = actor();
  outsider = actor("assigned", { unit: otherBranch });
  requestId = request(owner);
  const address = await app.listen(0, "127.0.0.1");
  base = `http://127.0.0.1:${address.port}`;
});
after(async () => {
  await app?.close();
});
beforeEach(() => app.limiter.reset());

test("3 flight and hotel drafts get independent unique human references, UUIDs and request-linked booking records", async () => {
  for (const kind of ["flight", "hotel"]) {
    const result = await make(kind);
    assert.equal(result.status, 201);
    assert.match(result.data.id, /^[a-f0-9-]{36}$/);
    assert.match(
      result.data.reference,
      new RegExp(
        `^LRT-${kind === "flight" ? "FLT" : "HTL"}-20[0-9]{2}-[0-9]{6}$`,
      ),
    );
    const result2 = await detail(result.data.id);
    assert.equal(result2.voucher.request_id, requestId);
    assert.equal(result2.voucher.status, "draft");
    assert.equal(result2.voucher.hasDraft, true);
    assert.equal(result2.versions.length, 0);
    assert.ok(
      db
        .prepare("SELECT id FROM voucher_bookings WHERE id=? AND request_id=?")
        .get(result2.voucher.booking_id, requestId),
    );
  }
  assert.equal(
    db.prepare("SELECT status FROM requests WHERE id=?").get(requestId).status,
    "confirmed",
  );
});
test("3 scope is re-evaluated for branch, department, owner and active request transfer without granting access", async () => {
  const id = (await make()).data.id;
  for (const user of [
    outsider,
    actor("branch", { unit: otherBranch }),
    actor("department", { dept: null }),
  ]) {
    assert.ok([401, 404].includes((await call(path(id), { user })).status));
    if (user !== outsider) continue;
    assert.equal((await call("/api/admin/vouchers", { user })).data.total, 0);
    assert.equal((await make("flight", flight(), user)).status, 404);
  }
  const otherOwner = actor();
  assert.equal((await call(path(id), { user: otherOwner })).status, 404);
  db.prepare("UPDATE requests SET assigned_to=?,branch_id=? WHERE id=?").run(
    outsider.id,
    otherBranch,
    requestId,
  );
  try {
    assert.equal((await call(path(id))).status, 404);
    assert.equal((await call(path(id), { user: outsider })).status, 200);
  } finally {
    db.prepare("UPDATE requests SET assigned_to=?,branch_id=? WHERE id=?").run(
      owner.id,
      branch,
      requestId,
    );
  }
});
test("3 voucher permissions are independent and require request access, MFA, must_change and CSRF", async () => {
  const id = (await make()).data.id,
    none = actor("organization", { perms: ["requests:read"] }),
    noRequest = actor("organization", {
      perms: permissions.filter((p) => p !== "requests:read"),
    }),
    reader = actor("organization", {
      perms: ["vouchers:read", "requests:read"],
    });
  for (const user of [
    none,
    noRequest,
    actor("organization", { mustChange: 1 }),
    actor("organization", { role: "admin", perms: ["*"], mfa: false }),
  ]) {
    const before = ledger();
    assert.equal((await call(path(id), { user })).status, 403);
    assert.equal(ledger(), before);
  }
  assert.equal((await call(path(id), { user: null })).status, 401);
  assert.equal((await make("flight", flight(), reader)).status, 403);
  assert.equal(
    (await call(path(id) + "/versions/1/document", { user: reader })).status,
    403,
  );
  assert.equal(
    (
      await call(path(id), {
        method: "PATCH",
        origin: "https://outside.invalid",
        body: { revision: 1, data: flight(), reason: "must reject" },
      })
    ).status,
    403,
  );
});
test("3 issuing requires complete data and a confirmed source request; retries and stale saves do not create extra versions", async () => {
  const unconfirmed = request(owner, { status: "new" }),
    id = (await make("flight", flight(), owner, unconfirmed)).data.id,
    before = ledger();
  assert.equal((await command(id, "issue")).status, 409);
  assert.equal(ledger(), before);
  assert.equal(
    db.prepare("SELECT status FROM requests WHERE id=?").get(unconfirmed)
      .status,
    "new",
  );
  const incomplete = (
    await make("flight", {
      language: "ar",
      people: [],
      flight: { segments: [] },
    })
  ).data.id;
  assert.equal((await command(incomplete, "issue")).status, 422);
  const valid = (await make()).data.id;
  assert.equal((await command(valid, "issue")).status, 200);
  const old = await detail(valid);
  assert.equal(
    (
      await call(path(valid) + "/issue", {
        body: { revision: 1, reason: "stale retry" },
      })
    ).status,
    409,
  );
  assert.equal((await detail(valid)).versions.length, 1);
  assert.equal(
    (
      await call(path(valid), {
        method: "PATCH",
        body: {
          revision: old.voucher.revision,
          data: flight(),
          reason: "direct edit",
        },
      })
    ).status,
    409,
  );
});
test("3 revision creates a new immutable snapshot, retains prior data and labels its protected document superseded", async () => {
  const id = (await make()).data.id;
  assert.equal((await command(id, "issue")).status, 200);
  const original = db
    .prepare("SELECT * FROM voucher_versions WHERE voucher_id=? AND version=1")
    .get(id);
  assert.equal((await command(id, "revisions")).status, 200);
  const draft = (await detail(id)).voucher,
    data = structuredClone(draft.data);
  data.notes = "مراجعة جديدة <script>not executable</script>";
  assert.equal(
    (
      await call(path(id), {
        method: "PATCH",
        body: { revision: draft.revision, data, reason: "تعديل مصطنع" },
      })
    ).status,
    200,
  );
  const before = ledger();
  assert.equal(
    (
      await call(path(id), {
        method: "PATCH",
        body: { revision: draft.revision, data, reason: "تعديل متزامن" },
      })
    ).status,
    409,
  );
  assert.equal(ledger(), before);
  assert.equal((await command(id, "issue")).status, 200);
  assert.deepEqual(
    db
      .prepare(
        "SELECT * FROM voucher_versions WHERE voucher_id=? AND version=1",
      )
      .get(id),
    original,
  );
  const doc = await call(path(id) + "/versions/1/document");
  assert.equal(doc.status, 200);
  assert.match(doc.text, /مستبدلة/);
  assert.match(doc.headers.get("cache-control"), /no-store/);
  assert.equal(doc.headers.get("x-frame-options"), "DENY");
  const latest = await call(path(id) + "/versions/2/document");
  assert.match(latest.text, /&lt;script&gt;not executable&lt;\/script&gt;/);
  assert.ok(!latest.text.includes("<script>not executable"));
});
test("3 cancellation and reopening a source request cannot leave a current confirmation on an archived document", async () => {
  const draftId = (await make()).data.id,
    unsent = (await detail(draftId)).voucher.data;
  assert.equal((await command(draftId, "cancel")).status, 200);
  assert.deepEqual((await detail(draftId)).voucher.data, unsent);
  const id = (await make()).data.id;
  await command(id, "issue");
  db.prepare("UPDATE requests SET status='reviewing' WHERE id=?").run(
    requestId,
  );
  try {
    const doc = await call(path(id) + "/versions/1/document");
    assert.match(doc.text, /الحجز قيد المراجعة/);
  } finally {
    db.prepare("UPDATE requests SET status='confirmed' WHERE id=?").run(
      requestId,
    );
  }
  assert.equal((await command(id, "cancel")).status, 200);
  assert.match(
    (await call(path(id) + "/versions/1/document")).text,
    /ملغاة — غير صالحة/,
  );
  assert.equal((await command(id, "issue")).status, 409);
  assert.equal((await command(id, "revisions")).status, 409);
  assert.equal((await detail(id)).versions.length, 1);
});
test("3 hotel nights are derived on the server; versions preserve guest and cancellation data in English", async () => {
  const data = hotel();
  data.hotel.nights = 999;
  const id = (await make("hotel", data)).data.id;
  assert.equal((await detail(id)).voucher.data.hotel.nights, 3);
  assert.equal((await command(id, "issue")).status, 200);
  const doc = await call(path(id) + "/versions/1/document");
  assert.match(doc.text, /<html lang="en"/);
  assert.match(doc.text, /Synthetic Guest/);
  assert.match(doc.text, /Cancellation policy/);
  assert.equal((await command(id, "revisions")).status, 200);
  const row = (await detail(id)).voucher;
  assert.equal(
    (
      await call(path(id), {
        method: "PATCH",
        body: {
          revision: row.revision,
          data: row.data,
          reason: "Hotel revision",
        },
      })
    ).status,
    200,
  );
  assert.equal((await command(id, "issue")).status, 200);
});
test("3 rejects invalid travel dates, offsets, backward routes, guest mismatches, unsupported types and excess fields", async () => {
  assert.throws(
    () => zonedFlightTime("2027-04-01T12:30+02:00", "Asia/Amman", true),
    (error) => error.status === 422,
  );
  assert.throws(() =>
    zonedFlightTime("2027-02-30T12:30+03:00", "Asia/Amman", true),
  );
  assert.equal(
    zonedFlightTime("2026-11-01T01:30-04:00", "America/New_York", true).zone,
    "America/New_York",
  );
  assert.equal(
    zonedFlightTime("2026-11-01T01:30-05:00", "America/New_York", true).zone,
    "America/New_York",
  );
  const backwards = flight();
  backwards.flight.segments[0].arriveAt = "2027-04-01T11:00+03:00";
  assert.equal((await make("flight", backwards)).status, 422);
  const overlap = flight();
  overlap.flight.segments.push({ ...overlap.flight.segments[0] });
  assert.equal((await make("flight", overlap)).status, 422);
  const mismatch = hotel();
  mismatch.hotel.guestCount = 2;
  assert.throws(() => voucherData("hotel", mismatch, { issuing: true }));
  const invalid = hotel();
  invalid.hotel.checkOut = "2027-03-31";
  assert.equal((await make("hotel", invalid)).status, 422);
  assert.equal((await make("umrah", flight())).status, 422);
  assert.equal(
    (await make("flight", { ...flight(), status: "confirmed" })).status,
    422,
  );
  assert.throws(() =>
    voucherData("flight", {
      ...flight(),
      people: Array(31).fill({ name: "Synthetic" }),
    }),
  );
});
test("3 archive searches retained passenger names, references, kind, draft revisions and Amman creation dates with pagination", async () => {
  const payerRequest = request(owner),
    payerName = "اسم عميل دافع مصطنع فريد";
  db.prepare("UPDATE requests SET payload=? WHERE id=?").run(
    JSON.stringify({ name: payerName }),
    payerRequest,
  );
  const payerVoucher = (await make("flight", flight(), owner, payerRequest))
    .data.id;
  assert.equal(
    (await call("/api/admin/vouchers?" + new URLSearchParams({ q: payerName })))
      .data.vouchers[0].id,
    payerVoucher,
  );
  db.prepare("UPDATE requests SET payload='legacy non-JSON' WHERE id=?").run(
    payerRequest,
  );
  assert.equal(
    (await call("/api/admin/vouchers?q=nonmatching-payer")).status,
    200,
  );
  const data = flight();
  data.people[0].name = "اسم مصطنع فريد للأرشيف";
  const result = await make("flight", data);
  await command(result.data.id, "issue");
  await command(result.data.id, "revisions");
  const found = await call(
    "/api/admin/vouchers?" +
      new URLSearchParams({
        q: data.people[0].name,
        status: "draft",
        kind: "flight",
      }),
  );
  assert.equal(found.data.total, 1);
  assert.equal(found.data.vouchers[0].id, result.data.id);
  for (let i = 0; i < 26; i++) assert.equal((await make()).status, 201);
  const first = await call("/api/admin/vouchers"),
    second = await call("/api/admin/vouchers?page=2");
  assert.equal(first.data.vouchers.length, 25);
  assert.ok(second.data.vouchers.length > 0);
  assert.notEqual(first.data.vouchers[0].id, second.data.vouchers[0].id);
  assert.equal((await call("/api/admin/vouchers?from=2027-02-30")).status, 422);
  assert.equal(
    (await call("/api/admin/vouchers?from=2030-01-02&to=2030-01-01")).status,
    422,
  );
  assert.equal(
    (await call("/api/admin/vouchers?from=2099-01-01")).data.total,
    0,
  );
});
test("3 permissions revoked while reading the request body cannot create a voucher", async () => {
  const user = actor(),
    id = request(user);
  const core = () => {
    const snapshot = JSON.parse(ledger());
    delete snapshot.audit_log;
    return JSON.stringify(snapshot);
  };
  const before = core();
  let intercepted = false;
  const intercept = () => {
    intercepted = true;
    db.prepare(
      "UPDATE role_definitions SET permissions=? WHERE role_key=?",
    ).run('["requests:read","vouchers:read"]', user.roleKey);
  };
  app.server.once("request", intercept);
  try {
    assert.equal((await make("flight", flight(), user, id)).status, 403);
    assert.equal(intercepted, true);
    assert.equal(core(), before);
  } finally {
    app.server.off("request", intercept);
  }
});
test("3 failed event storage rolls back booking, voucher, reference counter and audit atomically", async () => {
  const before = ledger();
  db.exec(
    "CREATE TRIGGER synthetic_voucher_failure BEFORE INSERT ON voucher_events BEGIN SELECT RAISE(ABORT,'Synthetic voucher failure');END;",
  );
  try {
    assert.equal((await make()).status, 500);
    assert.equal(ledger(), before);
  } finally {
    db.exec("DROP TRIGGER synthetic_voucher_failure");
  }
});
test("3 published snapshots, booking identities and event history cannot be updated or deleted", async () => {
  const id = (await make()).data.id;
  await command(id, "issue");
  const row = (await detail(id)).voucher;
  for (const sql of [
    "UPDATE voucher_versions SET snapshot_json='{}' WHERE voucher_id=?",
    "DELETE FROM voucher_versions WHERE voucher_id=?",
    "DELETE FROM voucher_events WHERE voucher_id=?",
    "UPDATE voucher_events SET reason='changed' WHERE voucher_id=?",
    "DELETE FROM employee_vouchers WHERE id=?",
  ])
    assert.throws(() => db.prepare(sql).run(id));
  assert.throws(() =>
    db
      .prepare("UPDATE voucher_bookings SET kind='hotel' WHERE id=?")
      .run(row.booking_id),
  );
  assert.equal(
    (await call(path(id) + "/versions/1/document", { user: outsider })).status,
    404,
  );
  assert.equal(
    (await call(path(id) + "/versions/1/document", { user: null })).status,
    401,
  );
});
test("3 migration5 backup retains all old values and checksums, restores exactly in isolation, then upgrades once", () => {
  const file =
    "data/phase1b-testing/vouchers-" + randomBytes(6).toString("hex") + ".db";
  let raw = new DatabaseSync(file);
  raw.exec(readFileSync("tests/fixtures/pre-identity-crm.sql", "utf8"));
  raw.close();
  let upgraded = openDb(file);
  assert.equal(upgraded.prepare("PRAGMA user_version").get().user_version, 9);
  const backup = upgraded.migrationBackups[5];
  raw = new DatabaseSync(backup, { readOnly: true });
  assert.equal(raw.prepare("PRAGMA user_version").get().user_version, 5);
  const oldLedger = raw
    .prepare("SELECT * FROM schema_migrations ORDER BY version")
    .all();
  assert.deepEqual(
    upgraded
      .prepare(
        "SELECT * FROM schema_migrations WHERE version<=5 ORDER BY version",
      )
      .all(),
    oldLedger,
  );
  for (const { name } of raw
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
    )
    .all()) {
    const columns = raw
      .prepare(`PRAGMA table_info("${name}")`)
      .all()
      .map((c) => '"' + c.name + '"')
      .join(",");
    const before = raw
        .prepare(`SELECT ${columns} FROM "${name}" ORDER BY rowid`)
        .all(),
      after = upgraded
        .prepare(`SELECT ${columns} FROM "${name}" ORDER BY rowid`)
        .all();
    assert.deepEqual(
      ["schema_migrations", "audit_log"].includes(name)
        ? after.slice(0, before.length)
        : after,
      before,
      name,
    );
  }
  raw.close();
  upgraded.close();
  const rehearsal = rehearsePrivateCopy({
    sourceFile: backup,
    privateRoot: realpathSync("data/phase1b-testing"),
  });
  assert.equal(rehearsal.sourceVersion, 5);
  assert.equal(rehearsal.candidateVersion, 9);
  assert.equal(rehearsal.migrationSnapshots, 4);
  assert.equal(rehearsal.isolatedRestoreExact, true);
  const restored = file + ".restored";
  copyFileSync(backup, restored);
  assert.equal(
    createHash("sha256").update(readFileSync(restored)).digest("hex"),
    createHash("sha256").update(readFileSync(backup)).digest("hex"),
  );
  upgraded = openDb(restored);
  assert.equal(upgraded.migrationBackups.length, 3);
  assert.equal(upgraded.prepare("PRAGMA foreign_key_check").all().length, 0);
  upgraded.close();
  upgraded = openDb(restored);
  assert.equal(upgraded.migrationBackups.length, 0);
  upgraded.close();
});
