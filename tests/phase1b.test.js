import { audit } from "../lib/domain.js";
import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, mkdirSync, copyFileSync } from "node:fs";
import { randomBytes, createHmac } from "node:crypto";
import { openDb } from "../lib/db.js";
import { migrateDatabase, checksum } from "../lib/migrations.js";
import { createApp } from "../server.js";
import {
  createSession,
  hashPassword,
  tokenHash,
  validStaffPassword,
  loginFailed,
  loginBlocked,
} from "../lib/auth.js";
import { totp, base32 } from "../lib/staff-mfa.js";
import { staffLogin } from "./helpers/staff-auth.mjs";

let app, db, base, admin, branches, depts;
const seed = JSON.parse(readFileSync("data/seed.json", "utf8"));
const password = "Synthetic-Staff-Password42",
  hashed = hashPassword(password);
let next = 0;
const dir = "data/phase1b-testing";
mkdirSync(dir, { recursive: true });
const dbFile = () => `${dir}/${randomBytes(6).toString("hex")}.db`;
function fixture({
  role = "agent",
  roleKey = null,
  branch = branches[0],
  dept = depts[0],
  trusted = false,
} = {}) {
  const username = `identity_${++next}`;
  const id = Number(
    db
      .prepare(
        "INSERT INTO users(username,name,role,role_key,branch_id,department_id,password_hash,password_salt,created_at) VALUES(?,?,?,?,?,?,?,?,?)",
      )
      .run(
        username,
        username,
        role,
        roleKey,
        branch,
        dept,
        hashed.hash,
        hashed.salt,
        new Date().toISOString(),
      ).lastInsertRowid,
  );
  return {
    id,
    username,
    cookie:
      "lt_session=" +
      createSession(db, id, "127.0.0.1", "fixture", { mfaVerified: trusted })
        .token,
  };
}
async function api(path, { method = "GET", cookie, body } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: {
      origin: base,
      "content-type": "application/json",
      ...(cookie ? { cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return {
    status: res.status,
    data: await res.json(),
    cookie: (res.headers.get("set-cookie") || "").split(";")[0],
  };
}
const login = (user) =>
  api("/api/auth/login", {
    method: "POST",
    body: { username: user.username, password },
  });
before(async () => {
  app = createApp({
    dbFile: ":memory:",
    baseUrl: "http://127.0.0.1:0",
    seed: { ...seed, users: [] },
    adminPassword: password,
  });
  db = app.db;
  const addr = await app.listen(0, "127.0.0.1");
  base = `http://127.0.0.1:${addr.port}`;
  branches = db
    .prepare("SELECT id FROM branches ORDER BY id")
    .all()
    .map((r) => r.id);
  depts = db
    .prepare("SELECT id FROM departments WHERE branch_id IS NULL LIMIT 2")
    .all()
    .map((r) => r.id);
  admin = fixture({ role: "admin", trusted: true });
});
after(async () => {
  await app?.close();
});
// Isolate each scenario's IP rate window; durable account/MFA lockout rows remain intact.
beforeEach(() => app.limiter.reset());

test("1B migrations: WAL snapshot precedes upgrade; profiles backfill without replacing legacy identity; restore is exact", () => {
  const file = dbFile();
  let raw = new DatabaseSync(file);
  raw.exec("PRAGMA journal_mode=WAL");
  raw.exec(readFileSync("tests/fixtures/pre-identity-crm.sql", "utf8"));
  const main = readFileSync("tests/fixtures/pre-crm-main.sql", "utf8");
  raw.exec(main.match(/CREATE TABLE webhook_deliveries \([\s\S]*?\n\);/)[0]);
  raw
    .prepare(
      "INSERT INTO users (id,username,name,role,password_hash,password_salt,created_at) VALUES(1,'legacy','Legacy','admin','not-real','not-real','2026-10-01')",
    )
    .run();
  const original = { ...raw.prepare("SELECT * FROM users").get() };
  raw.close();
  let migrated = openDb(file);
  assert.equal(migrated.prepare("PRAGMA user_version").get().user_version, 4);
  assert.equal(migrated.migrationBackups.length, 4);
  const backups = [...migrated.migrationBackups];
  assert.deepEqual(
    { ...migrated.prepare("SELECT * FROM users").get() },
    original,
  );
  assert.equal(
    migrated.prepare("SELECT employee_no FROM employees WHERE user_id=1").get()
      .employee_no,
    "LRT-000001",
  );
  assert.equal(
    migrated
      .prepare(
        "SELECT count(*) n FROM staff_memberships WHERE user_id=1 AND is_primary=1",
      )
      .get().n,
    1,
  );
  migrated.close();
  const restored = file + ".restored";
  copyFileSync(backups[0], restored);
  raw = new DatabaseSync(restored);
  assert.equal(raw.prepare("PRAGMA user_version").get().user_version, 0);
  assert.deepEqual({ ...raw.prepare("SELECT * FROM users").get() }, original);
  raw.close();
  migrated = openDb(file);
  assert.equal(migrated.migrationBackups.length, 0);
  migrated.close();
});

test("1B runner: a failed migration rolls back the complete step and its version; checksums reject drift", () => {
  const file = dbFile();
  let raw = new DatabaseSync(file);
  const step = {
    version: 1,
    name: "test baseline",
    checksum: checksum("one"),
    up: (d) => d.exec("CREATE TABLE example(id INTEGER PRIMARY KEY)"),
  };
  migrateDatabase(raw, file, [step]);
  const failure = {
    version: 2,
    name: "broken",
    checksum: checksum("two"),
    up: (d) => {
      d.exec("INSERT INTO example VALUES(1);CREATE TABLE transient(id)");
      throw new Error("synthetic failure");
    },
  };
  assert.throws(
    () => migrateDatabase(raw, file, [step, failure]),
    /synthetic failure/,
  );
  assert.equal(raw.prepare("SELECT count(*) n FROM example").get().n, 0);
  assert.equal(
    raw
      .prepare("SELECT count(*) n FROM sqlite_master WHERE name='transient'")
      .get().n,
    0,
  );
  assert.equal(raw.prepare("PRAGMA user_version").get().user_version, 1);
  assert.throws(
    () => migrateDatabase(raw, file, [{ ...step, checksum: "tampered" }]),
    /checksum mismatch/,
  );
  raw.close();
});

test("1B startup rejects a newer version or externally changed schema without running a migration", () => {
  const file = dbFile();
  let d = openDb(file);
  d.exec("CREATE TABLE externally_added(id)");
  d.close();
  assert.throws(() => openDb(file), /schema drift/);
  const newer = dbFile();
  d = openDb(newer);
  d.exec("PRAGMA user_version=999");
  d.close();
  assert.throws(() => openDb(newer), /newer/);
});

test("1B TOTP implements independent RFC6238 vectors", () => {
  const secret = base32(Buffer.from("12345678901234567890"));
  assert.equal(totp(secret, 1), "287082");
  assert.equal(totp(secret, Math.floor(1111111109 / 30)), "081804");
  assert.equal(totp(secret, Math.floor(2000000000 / 30)), "279037");
});

test("1B staff passwords support Arabic phrases, enforce 12-128 characters and do not reject existing password hashes", async () => {
  assert.equal(validStaffPassword("عبارة مرور عربية طويلة وآمنة"), true);
  assert.equal(validStaffPassword("Short-42"), false);
  assert.equal(validStaffPassword("A ".repeat(129)), false);
  const short = await api("/api/admin/users", {
    method: "POST",
    cookie: admin.cookie,
    body: {
      username: "short_staff",
      name: "Short staff",
      password: "AgentPass12",
      role: "agent",
    },
  });
  assert.equal(short.status, 422);
  const phrase = "عبارة مرور عربية طويلة وآمنة";
  assert.equal(
    (
      await api("/api/admin/users", {
        method: "POST",
        cookie: admin.cookie,
        body: {
          username: "arabic_staff",
          name: "موظف تجريبي",
          password: phrase,
          role: "agent",
        },
      })
    ).status,
    201,
  );
  assert.equal(
    (
      await api("/api/auth/login", {
        method: "POST",
        body: { username: "arabic_staff", password: phrase },
      })
    ).status,
    200,
  );
});

test("1B mandatory MFA: admin enrollment, encrypted secret, one-time recovery and replay rejection", async () => {
  const user = fixture({ role: "admin" }),
    session = await login(user);
  assert.equal(session.status, 200);
  assert.equal(session.data.user.mfaRequired, true);
  assert.equal(
    (await api("/api/admin/users", { cookie: session.cookie })).status,
    403,
  );
  assert.equal(
    (
      await api("/api/auth/mfa/setup", {
        method: "POST",
        cookie: session.cookie,
        body: { password: "wrong" },
      })
    ).status,
    400,
  );
  const setup = await api("/api/auth/mfa/setup", {
    method: "POST",
    cookie: session.cookie,
    body: { password },
  });
  assert.equal(setup.status, 200);
  assert.ok(
    !db
      .prepare("SELECT secret_ciphertext FROM staff_mfa WHERE user_id=?")
      .get(user.id)
      .secret_ciphertext.includes(setup.data.secret),
  );
  const confirmed = await api("/api/auth/mfa/confirm", {
    method: "POST",
    cookie: session.cookie,
    body: { code: totp(setup.data.secret) },
  });
  assert.equal(confirmed.status, 200);
  assert.equal(confirmed.data.recoveryCodes.length, 10);
  assert.equal(
    (await api("/api/admin/users", { cookie: session.cookie })).status,
    200,
  );
  const codes = db
    .prepare("SELECT recovery_hashes FROM staff_mfa WHERE user_id=?")
    .get(user.id).recovery_hashes;
  assert.ok(!codes.includes(confirmed.data.recoveryCodes[0]));
  const pending = await login(user);
  assert.equal(pending.status, 202);
  assert.equal(pending.cookie, "");
  assert.equal(
    (
      await api("/api/auth/mfa/verify", {
        method: "POST",
        body: {
          challenge: pending.data.challenge,
          code: totp(setup.data.secret),
        },
      })
    ).status,
    401,
  );
  const verified = await api("/api/auth/mfa/verify", {
    method: "POST",
    body: {
      challenge: pending.data.challenge,
      code: confirmed.data.recoveryCodes[0],
    },
  });
  assert.equal(verified.status, 200);
  assert.ok(verified.cookie.startsWith("lt_session="));
  assert.equal(
    (
      await api("/api/auth/mfa/verify", {
        method: "POST",
        body: {
          challenge: pending.data.challenge,
          code: confirmed.data.recoveryCodes[1],
        },
      })
    ).status,
    401,
  );
  const nextChallenge = await login(user);
  assert.equal(
    (
      await api("/api/auth/mfa/verify", {
        method: "POST",
        body: {
          challenge: nextChallenge.data.challenge,
          code: confirmed.data.recoveryCodes[0],
        },
      })
    ).status,
    401,
  );
});

test("1B MFA setup fails closed without the encryption key, retaining public availability", async () => {
  const user = fixture({ role: "admin" }),
    session = await login(user),
    key = process.env.STAFF_MFA_ENCRYPTION_KEY;
  delete process.env.STAFF_MFA_ENCRYPTION_KEY;
  try {
    assert.equal(
      (
        await api("/api/auth/mfa/setup", {
          method: "POST",
          cookie: session.cookie,
          body: { password },
        })
      ).status,
      503,
    );
    assert.equal(
      (await api("/api/admin/users", { cookie: session.cookie })).status,
      403,
    );
    assert.equal((await fetch(base + "/health")).status, 200);
  } finally {
    process.env.STAFF_MFA_ENCRYPTION_KEY = key;
  }
});

test("1B authentication lockouts persist across database reopen", () => {
  const file = dbFile();
  let d = openDb(file);
  for (let i = 0; i < 5; i++) loginFailed("synthetic-ip|staff", d);
  assert.ok(loginBlocked("synthetic-ip|staff", d) > 0);
  d.close();
  d = openDb(file);
  assert.ok(loginBlocked("synthetic-ip|staff", d) > 0);
  assert.ok(
    !d
      .prepare("SELECT key_hash FROM staff_login_attempts")
      .get()
      .key_hash.includes("staff"),
  );
  d.close();
});

test("1B employee profile validates unique numbers and manager cycles and stores redacted before/after with actor and reason", async () => {
  const user = fixture(),
    manager = fixture();
  const result = await api(`/api/admin/users/${user.id}/profile`, {
    method: "PATCH",
    cookie: admin.cookie,
    body: {
      employee_no: "SYNTHETIC-123",
      job_title: "موظف حجوزات",
      manager_id: manager.id,
      hire_date: "2026-10-01",
      email: "staff@example.invalid",
      reason: "تحديث ملف تجريبي",
    },
  });
  assert.equal(result.status, 200);
  assert.equal(result.data.profile.job_title, "موظف حجوزات");
  assert.equal(
    (
      await api(`/api/admin/users/${manager.id}/profile`, {
        method: "PATCH",
        cookie: admin.cookie,
        body: { manager_id: user.id, reason: "علاقة دائرية مرفوضة" },
      })
    ).status,
    422,
  );
  assert.equal(
    (
      await api(`/api/admin/users/${manager.id}/profile`, {
        method: "PATCH",
        cookie: admin.cookie,
        body: { employee_no: "SYNTHETIC-123", reason: "رقم مكرر" },
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await api(`/api/admin/users/${user.id}/profile`, {
        method: "PATCH",
        cookie: admin.cookie,
        body: { hire_date: "2026-99-99", reason: "تاريخ غير صالح" },
      })
    ).status,
    422,
  );
  const entry = db
    .prepare(
      "SELECT * FROM audit_log WHERE entity='employees' AND entity_id=? AND action='db-update' ORDER BY id DESC LIMIT 1",
    )
    .get(String(user.id));
  assert.equal(entry.user_id, admin.id);
  assert.equal(entry.reason, "تحديث ملف تجريبي");
  assert.equal(JSON.parse(entry.after_json).job_title, "موظف حجوزات");
  assert.ok(!entry.after_json.includes("staff@example.invalid"));
  assert.throws(
    () =>
      db
        .prepare("UPDATE audit_log SET reason=? WHERE id=?")
        .run("tamper", entry.id),
    /append-only/,
  );
  assert.throws(
    () => db.prepare("DELETE FROM audit_log WHERE id=?").run(entry.id),
    /append-only/,
  );
});

test("1B scoped managers cannot edit profiles outside their branch", async () => {
  const manager = fixture({ roleKey: "branch_manager" }),
    outside = fixture({ branch: branches[1] });
  db.prepare(
    "UPDATE role_definitions SET permissions=json_insert(permissions,'$[#]','users:write') WHERE role_key='branch_manager'",
  ).run();
  const session = createSession(db, manager.id, "127.0.0.1", "fixture", {
    mfaVerified: true,
  });
  assert.equal(
    (
      await api(`/api/admin/users/${outside.id}/profile`, {
        method: "PATCH",
        cookie: "lt_session=" + session.token,
        body: { job_title: "not allowed", reason: "مرفوض خارج الفرع" },
      })
    ).status,
    404,
  );
});

test("1B memberships: explicit delegation, session rotation, scoped access and immediate revocation", async () => {
  const user = fixture({ roleKey: "service_agent" });
  const created = await api(`/api/admin/users/${user.id}/memberships`, {
    method: "POST",
    cookie: admin.cookie,
    body: {
      branchId: branches[1],
      departmentId: depts[1],
      roleKey: "service_agent",
      reason: "تغطية فرع آخر",
    },
  });
  assert.equal(created.status, 201);
  assert.equal(
    (await api("/api/auth/me", { cookie: user.cookie })).data.user,
    null,
  );
  const member = db
      .prepare(
        "SELECT * FROM staff_memberships WHERE user_id=? AND is_primary=0",
      )
      .get(user.id),
    current = await login(user);
  const switched = await api("/api/auth/context", {
    method: "POST",
    cookie: current.cookie,
    body: { membershipId: member.id },
  });
  assert.equal(switched.status, 200);
  assert.equal(
    (await api("/api/auth/me", { cookie: current.cookie })).data.user,
    null,
  );
  const me = (await api("/api/auth/me", { cookie: switched.cookie })).data.user;
  assert.equal(me.branchId, branches[1]);
  assert.equal(me.departmentId, depts[1]);
  for (const [branch, department, ref] of [
    [branches[0], depts[0], "PRIMARY-SYNTHETIC"],
    [branches[1], depts[1], "DELEGATED-SYNTHETIC"],
  ])
    db.prepare(
      "INSERT INTO requests(reference,type,branch_id,department_id,payload,created_at,updated_at) VALUES (?,'flight',?,?,'{}','2026-10-31','2026-10-31')",
    ).run(ref, branch, department);
  const list = await api("/api/admin/requests", { cookie: switched.cookie });
  assert.equal(list.status, 200);
  assert.ok(
    list.data.requests.some((r) => r.reference === "DELEGATED-SYNTHETIC"),
  );
  assert.ok(
    !list.data.requests.some((r) => r.reference === "PRIMARY-SYNTHETIC"),
  );
  const primary = await api("/api/auth/context", {
    method: "POST",
    cookie: switched.cookie,
    body: { membershipId: null },
  });
  assert.equal(primary.status, 200);
  assert.equal(
    (await api("/api/auth/me", { cookie: primary.cookie })).data.user.branchId,
    branches[0],
  );
  assert.equal(
    (
      await api(`/api/admin/users/${user.id}/memberships/${member.id}`, {
        method: "PATCH",
        cookie: admin.cookie,
        body: { active: false, reason: "انتهاء التغطية" },
      })
    ).status,
    200,
  );
  assert.equal(
    (await api("/api/auth/me", { cookie: primary.cookie })).data.user,
    null,
  );
  const fresh = await login(user);
  assert.equal(
    (
      await api("/api/auth/context", {
        method: "POST",
        cookie: fresh.cookie,
        body: { membershipId: member.id },
      })
    ).status,
    403,
  );
});

test("1B memberships reject privilege escalation, another user context and cross-branch delegation", async () => {
  const manager = fixture({ roleKey: "branch_manager", trusted: true }),
    target = fixture({ roleKey: "sales_agent" });
  assert.equal(
    (
      await api(`/api/admin/users/${target.id}/memberships`, {
        method: "POST",
        cookie: manager.cookie,
        body: {
          branchId: branches[1],
          departmentId: depts[0],
          roleKey: "service_agent",
          reason: "تجاوز نطاق",
        },
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await api(`/api/admin/users/${target.id}/memberships`, {
        method: "POST",
        cookie: admin.cookie,
        body: {
          branchId: branches[1],
          roleKey: "admin",
          reason: "دور عام مرفوض",
        },
      })
    ).status,
    403,
  );
  const other = db
    .prepare("SELECT id FROM staff_memberships WHERE user_id=?")
    .get(admin.id).id;
  assert.equal(
    (
      await api("/api/auth/context", {
        method: "POST",
        cookie: target.cookie,
        body: { membershipId: other },
      })
    ).status,
    403,
  );
});

test("1B branch/department deactivation guards activity and survives reopening", async () => {
  assert.equal(
    (
      await api(`/api/admin/branches/${branches[0]}`, {
        method: "PATCH",
        cookie: admin.cookie,
        body: { active: false, reason: "وجود موظفين" },
      })
    ).status,
    409,
  );
  const inserted = db
    .prepare(
      "INSERT INTO branches(code,name,created_at,updated_at) VALUES('identity-unused','Synthetic unused','2026-10-31','2026-10-31')",
    )
    .run();
  const id = Number(inserted.lastInsertRowid);
  assert.equal(
    (
      await api(`/api/admin/branches/${id}`, {
        method: "PATCH",
        cookie: admin.cookie,
        body: { active: false, reason: "تعطيل فرع خال" },
      })
    ).status,
    200,
  );
  assert.equal(
    db.prepare("SELECT active FROM branches WHERE id=?").get(id).active,
    0,
  );
});

test("1B audit export requires explicit capability and signs the exact payload", async () => {
  const previous = process.env.AUDIT_EXPORT_KEY;
  process.env.AUDIT_EXPORT_KEY = "synthetic-export-key";
  try {
    const user = fixture({ roleKey: "reports_viewer" });
    assert.equal(
      (await api("/api/admin/audit/export", { cookie: user.cookie })).status,
      403,
    );
    const result = await api("/api/admin/audit/export", {
      cookie: admin.cookie,
    });
    assert.equal(result.status, 200);
    assert.equal(
      createHmac("sha256", process.env.AUDIT_EXPORT_KEY)
        .update(result.data.document)
        .digest("hex"),
      result.data.signature,
    );
    assert.equal(JSON.parse(result.data.document).format, "laurette-audit-v1");
  } finally {
    if (previous === undefined) delete process.env.AUDIT_EXPORT_KEY;
    else process.env.AUDIT_EXPORT_KEY = previous;
  }
});

test("1B MFA failed-code lockout survives new challenges and password reset revokes pending authentication", async () => {
  const user = fixture({ role: "admin" }),
    session = await login(user);
  const setup = await api("/api/auth/mfa/setup", {
    method: "POST",
    cookie: session.cookie,
    body: { password },
  });
  const confirmed = await api("/api/auth/mfa/confirm", {
    method: "POST",
    cookie: session.cookie,
    body: { code: totp(setup.data.secret) },
  });
  assert.equal(confirmed.status, 200);
  for (let i = 0; i < 5; i++) {
    const pending = await login(user);
    assert.equal(pending.status, 202);
    assert.equal(
      (
        await api("/api/auth/mfa/verify", {
          method: "POST",
          body: { challenge: pending.data.challenge, code: "invalid" },
        })
      ).status,
      401,
    );
  }
  const pending = await login(user);
  assert.equal(
    (
      await api("/api/auth/mfa/verify", {
        method: "POST",
        body: {
          challenge: pending.data.challenge,
          code: confirmed.data.recoveryCodes[0],
        },
      })
    ).status,
    429,
  );
  const nextHash = hashPassword(password + "-reset");
  db.prepare("UPDATE users SET password_hash=?,password_salt=? WHERE id=?").run(
    nextHash.hash,
    nextHash.salt,
    user.id,
  );
  assert.equal(
    db
      .prepare("SELECT count(*) n FROM staff_mfa_challenges WHERE user_id=?")
      .get(user.id).n,
    0,
  );
  assert.equal(
    (await api("/api/auth/me", { cookie: session.cookie })).data.user,
    null,
  );
});
test("1B primary password policy does not invalidate an existing short hash on sign-in", async () => {
  const user = fixture();
  const old = hashPassword("Old-123");
  db.prepare("UPDATE users SET password_hash=?,password_salt=? WHERE id=?").run(
    old.hash,
    old.salt,
    user.id,
  );
  assert.equal(
    (
      await api("/api/auth/login", {
        method: "POST",
        body: { username: user.username, password: "Old-123" },
      })
    ).status,
    200,
  );
});
test("1B additional administrative membership cannot bypass MFA through context selection", async () => {
  db.prepare(
    "INSERT INTO role_definitions(role_key,name,base_role,data_scope,permissions,created_at,updated_at) VALUES('delegated-admin','Synthetic delegated admin','agent','branch','[\"users:write\",\"overview:read\"]','2026-10-31','2026-10-31')",
  ).run();
  const user = fixture({ roleKey: "service_agent" });
  assert.equal(
    (
      await api("/api/admin/users/" + user.id + "/memberships", {
        method: "POST",
        cookie: admin.cookie,
        body: {
          branchId: branches[1],
          departmentId: depts[1],
          roleKey: "delegated-admin",
          reason: "تفويض إداري تجريبي",
        },
      })
    ).status,
    201,
  );
  const fresh = await login(user),
    member = db
      .prepare(
        "SELECT id FROM staff_memberships WHERE user_id=? AND is_primary=0",
      )
      .get(user.id);
  const switched = await api("/api/auth/context", {
    method: "POST",
    cookie: fresh.cookie,
    body: { membershipId: member.id },
  });
  assert.equal(switched.status, 200);
  const me = await api("/api/auth/me", { cookie: switched.cookie });
  assert.equal(me.data.user.mfaRequired, true);
  assert.equal(me.data.user.mfaVerified, false);
  assert.equal(
    (await api("/api/admin/users", { cookie: switched.cookie })).status,
    403,
  );
});

test("1B organization deactivation persists; repeated startup does not rerun legacy backfills", () => {
  const file = dbFile();
  let d = openDb(file);
  d.prepare(
    "UPDATE branches SET active=0,is_primary=0 WHERE code='irbid'",
  ).run();
  d.close();
  d = openDb(file);
  const branch = d
    .prepare("SELECT active,is_primary FROM branches WHERE code='irbid'")
    .get();
  assert.equal(branch.active, 0);
  assert.equal(branch.is_primary, 0);
  assert.equal(d.migrationBackups.length, 0);
  d.close();
});
test("1B metadata audit redacts credentials and nested secrets without rewriting legacy records", () => {
  audit(db, {
    user: { id: admin.id, name: "Synthetic admin" },
    action: "synthetic-redaction",
    meta: {
      password: "never-log-this",
      nested: {
        token: "never-log-token",
        secret: "never-log-secret",
        payload: { phone: "private" },
      },
    },
  });
  const row = db
    .prepare("SELECT meta FROM audit_log WHERE action='synthetic-redaction'")
    .get();
  for (const raw of [
    "never-log-this",
    "never-log-token",
    "never-log-secret",
    "private",
  ])
    assert.ok(!row.meta.includes(raw));
});
test("1B disabled account cannot finish an already issued MFA challenge", async () => {
  const user = fixture({ role: "admin" }),
    session = await login(user),
    setup = await api("/api/auth/mfa/setup", {
      method: "POST",
      cookie: session.cookie,
      body: { password },
    }),
    confirmed = await api("/api/auth/mfa/confirm", {
      method: "POST",
      cookie: session.cookie,
      body: { code: totp(setup.data.secret) },
    });
  assert.equal(confirmed.status, 200);
  const challenge = await login(user);
  db.prepare("UPDATE users SET active=0 WHERE id=?").run(user.id);
  assert.equal(
    (
      await api("/api/auth/mfa/verify", {
        method: "POST",
        body: {
          challenge: challenge.data.challenge,
          code: confirmed.data.recoveryCodes[0],
        },
      })
    ).status,
    401,
  );
});

 test('1B shared department does not authorize listing, creating or relocating staff in another branch',async()=>{
  db.prepare(`INSERT INTO role_definitions(role_key,name,base_role,data_scope,permissions,created_at,updated_at) VALUES('dept-identity-manager','Synthetic department HR','agent','department','["users:write","overview:read"]','2026-10-31','2026-10-31')`).run();
  const manager=fixture({roleKey:'dept-identity-manager',trusted:true}),target=fixture({roleKey:'dept-identity-manager'}),outside=fixture({roleKey:'dept-identity-manager',branch:branches[1]});
  const listed=await api('/api/admin/users',{cookie:manager.cookie});assert.equal(listed.status,200);assert.ok(!listed.data.users.some(u=>u.id===outside.id));
  assert.equal((await api('/api/admin/users',{method:'POST',cookie:manager.cookie,body:{username:'forbidden_branch_user',name:'Synthetic',password,roleKey:'dept-identity-manager',branchId:branches[1],departmentId:depts[0]}})).status,403);
  assert.equal((await api('/api/admin/users/'+target.id,{method:'PATCH',cookie:manager.cookie,body:{branchId:branches[1]}})).status,403);
  assert.equal(db.prepare('SELECT branch_id FROM users WHERE id=?').get(target.id).branch_id,branches[0]);
 });

 test('1B legacy migration refuses unknown columns rather than discarding customer data',()=>{
  const file=dbFile();let raw=new DatabaseSync(file);raw.exec(readFileSync('tests/fixtures/pre-crm-main.sql','utf8'));raw.exec('ALTER TABLE requests ADD COLUMN custom_legacy_field TEXT');raw.close();assert.throws(()=>openDb(file),/Unsupported legacy request columns/);raw=new DatabaseSync(file);assert.ok(raw.prepare('PRAGMA table_info(requests)').all().some(c=>c.name==='custom_legacy_field'));assert.equal(raw.prepare('PRAGMA user_version').get().user_version,0);raw.close();
 });
