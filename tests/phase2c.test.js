import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:net";
import { readFileSync, copyFileSync } from "node:fs";
import { randomBytes, createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { createApp } from "../server.js";
import { openDb } from "../lib/db.js";
import { createSession, hashPassword } from "../lib/auth.js";
import { detectAttachment } from "../lib/task-attachments.js";
let app,
  db,
  base,
  scanner,
  owner,
  other,
  taskId,
  mode = "clean",
  received,
  scanHook = null;
const priorPort = process.env.ATTACHMENT_CLAMD_PORT;
const pdf = Buffer.from("%PDF-1.7\nSynthetic document only\n%%EOF");
const wav = Buffer.concat([
  Buffer.from("RIFF"),
  Buffer.from([36, 0, 0, 0]),
  Buffer.from("WAVEfmt "),
  Buffer.alloc(32),
]);
function user(name, branch) {
  const h = hashPassword("Synthetic-Attachment-Password42"),
    now = new Date().toISOString();
  db.prepare(
    "INSERT INTO role_definitions(role_key,name,base_role,data_scope,permissions,created_at,updated_at) VALUES(?,?,?,?,?,?,?)",
  ).run(
    name,
    name,
    "agent",
    "assigned",
    '["tasks:read","tasks:write","requests:read"]',
    now,
    now,
  );
  const id = Number(
    db
      .prepare(
        "INSERT INTO users(username,name,role,role_key,branch_id,password_hash,password_salt,created_at) VALUES(?,?,?,?,?,?,?,?)",
      )
      .run(name, name, "agent", name, branch, h.hash, h.salt, now)
      .lastInsertRowid,
  );
  return {
    id,
    cookie: "lt_session=" + createSession(db, id, "127.0.0.1", "test").token,
  };
}
async function call(
  path,
  { user = owner, body, method = body ? "POST" : "GET", headers = {} } = {},
) {
  const res = await fetch(base + path, {
    method,
    headers: {
      origin: base,
      "content-type": "application/json",
      ...(user ? { cookie: user.cookie } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const bytes = Buffer.from(await res.arrayBuffer());
  return {
    status: res.status,
    headers: res.headers,
    bytes,
    data: res.headers.get("content-type")?.includes("application/json")
      ? JSON.parse(bytes)
      : null,
  };
}
const upload = (extra = {}, user = owner) =>
  call(`/api/admin/tasks/${taskId}/attachments`, {
    user,
    body: { filename: "ملف.pdf", base64: pdf.toString("base64"), ...extra },
  });
const count = () =>
  db.prepare("SELECT COUNT(*) n FROM task_attachments").get().n;
before(async () => {
  const seed = JSON.parse(readFileSync("data/seed.json", "utf8"));
  app = createApp({
    dbFile: ":memory:",
    seed: { ...seed, users: [] },
    adminPassword: "Synthetic-Attachment-Password42",
    baseUrl: "http://127.0.0.1:0",
  });
  db = app.db;
  const addr = await app.listen(0, "127.0.0.1");
  base = `http://127.0.0.1:${addr.port}`;
  const branches = db
    .prepare("SELECT id FROM branches ORDER BY id LIMIT 2")
    .all();
  owner = user("attachment-owner", branches[0].id);
  other = user("attachment-other", branches[1].id);
  const now = new Date().toISOString();
  taskId = Number(
    db
      .prepare(
        "INSERT INTO tasks(branch_id,title,priority,assigned_to,created_by,due_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)",
      )
      .run(
        branches[0].id,
        "Synthetic attachment task",
        "normal",
        owner.id,
        owner.id,
        now,
        now,
        now,
      ).lastInsertRowid,
  );
  scanner = createServer((socket) => {
    let buffer = Buffer.alloc(0),
      started = false,
      chunks = [];
    socket.on("error", () => {});
    socket.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      if (!started) {
        const command = Buffer.from("zINSTREAM\0");
        if (buffer.length < command.length) return;
        assert.deepEqual(buffer.subarray(0, command.length), command);
        buffer = buffer.subarray(command.length);
        started = true;
      }
      while (buffer.length >= 4) {
        const size = buffer.readUInt32BE(0);
        if (buffer.length < 4 + size) return;
        buffer = buffer.subarray(4);
        if (!size) {
          received = Buffer.concat(chunks);
          scanHook?.();
          socket.end(
            mode === "clean"
              ? "stream: OK\0"
              : mode === "infected"
                ? "stream: Synthetic-Test FOUND\0"
                : "stream: unavailable ERROR\0",
          );
          return;
        }
        chunks.push(buffer.subarray(0, size));
        buffer = buffer.subarray(size);
      }
    });
  });
  await new Promise((resolve) => scanner.listen(0, "127.0.0.1", resolve));
  process.env.ATTACHMENT_CLAMD_PORT = String(scanner.address().port);
});
after(async () => {
  await app?.close();
  await new Promise((resolve) => scanner.close(resolve));
  if (priorPort === undefined) delete process.env.ATTACHMENT_CLAMD_PORT;
  else process.env.ATTACHMENT_CLAMD_PORT = priorPort;
});
beforeEach(() => {
  mode = "clean";
  scanHook = null;
  app.limiter.reset();
});

test("2C scanned PDF uploads privately, deduplicates, and downloads exact bytes with secure headers", async () => {
  const result = await upload();
  assert.equal(result.status, 201);
  assert.deepEqual(received, pdf);
  const id = result.data.id,
    before = count();
  assert.equal((await upload()).data.id, id);
  assert.equal(count(), before);
  const list = (await call(`/api/admin/tasks/${taskId}/attachments`)).data;
  assert.ok(!("content" in list.attachments[0]));
  assert.equal(
    list.attachments[0].sha256,
    createHash("sha256").update(pdf).digest("hex"),
  );
  const downloaded = await call("/api/admin/task-attachments/" + id);
  assert.deepEqual(downloaded.bytes, pdf);
  assert.match(downloaded.headers.get("cache-control"), /no-store/);
  assert.equal(downloaded.headers.get("x-content-type-options"), "nosniff");
  assert.match(downloaded.headers.get("content-disposition"), /^attachment/);
  assert.match(
    (
      await call("/api/admin/task-attachments/" + id + "?preview=1")
    ).headers.get("content-disposition"),
    /^attachment/,
  );
  assert.equal(
    db
      .prepare(
        "SELECT COUNT(*) n FROM audit_log WHERE action='attachment.upload' AND entity_id=?",
      )
      .get(String(id)).n,
    1,
  );
});
test("2C audio supports authenticated playback and valid range and suffix requests", async () => {
  const result = await upload({
    filename: "voice.wav",
    base64: wav.toString("base64"),
  });
  assert.equal(result.status, 201);
  const path = "/api/admin/task-attachments/" + result.data.id + "?preview=1";
  const partial = await call(path, { headers: { range: "bytes=0-7" } });
  assert.equal(partial.status, 206);
  assert.deepEqual(partial.bytes, wav.subarray(0, 8));
  assert.match(partial.headers.get("content-disposition"), /^inline/);
  assert.deepEqual(
    (await call(path, { headers: { range: "bytes=-4" } })).bytes,
    wav.subarray(-4),
  );
  assert.equal(
    (await call(path, { headers: { range: "bytes=99999-" } })).status,
    416,
  );
});
test("2C attachment IDs, list, upload, playback and download remain scoped and require a session", async () => {
  const id = (await upload()).data.id,
    before = count();
  for (const user of [other, null]) {
    assert.equal(
      (await call("/api/admin/task-attachments/" + id, { user })).status,
      user ? 404 : 401,
    );
    assert.equal(
      (await call(`/api/admin/tasks/${taskId}/attachments`, { user })).status,
      user ? 404 : 401,
    );
    assert.equal((await upload({}, user)).status, user ? 404 : 401);
  }
  assert.equal(count(), before);
  assert.equal((await upload({}, owner)).status, 201);
});
test("2C scanner infection, outage and invalid response fail closed without data or events", async () => {
  const before = count(),
    events = db.prepare("SELECT COUNT(*) n FROM task_events").get().n;
  mode = "infected";
  assert.equal((await upload({ filename: "other.pdf" })).status, 422);
  mode = "error";
  assert.equal((await upload()).status, 503);
  const port = process.env.ATTACHMENT_CLAMD_PORT;
  process.env.ATTACHMENT_CLAMD_PORT = "0";
  try {
    assert.equal((await upload()).status, 503);
  } finally {
    process.env.ATTACHMENT_CLAMD_PORT = port;
  }
  assert.equal(count(), before);
  assert.equal(
    db.prepare("SELECT COUNT(*) n FROM task_events").get().n,
    events,
  );
});
test("2C type spoofing, active content, unsafe names, oversized payloads and CSRF are rejected", async () => {
  const before = count();
  for (const extra of [
    { filename: "x.html" },
    { filename: "../x.pdf" },
    { filename: "x\u202e.pdf" },
    { base64: "!!!!" },
    {
      filename: "x.pdf",
      base64: Buffer.from("<script>not a document</script>").toString("base64"),
    },
    {
      filename: "x.pdf",
      base64: Buffer.alloc(5 * 1024 * 1024 + 1).toString("base64"),
    },
  ])
    assert.equal((await upload(extra)).status, 422);
  assert.equal(
    (
      await call(`/api/admin/tasks/${taskId}/attachments`, {
        headers: { origin: "https://outside.invalid" },
        body: { filename: "x.pdf", base64: pdf.toString("base64") },
      })
    ).status,
    403,
  );
  assert.equal(count(), before);
  assert.throws(
    () => detectAttachment(Buffer.from('<svg onload="alert(1)"></svg>')),
    /الأنواع المدعومة/,
  );
});
test("2C access is checked again after scanning; a revoked session cannot persist the file", async () => {
  const before = count();
  scanHook = () =>
    db.prepare("UPDATE users SET active=0 WHERE id=?").run(owner.id);
  assert.equal((await upload()).status, 401);
  assert.equal(count(), before);
  db.prepare("UPDATE users SET active=1 WHERE id=?").run(owner.id);
  owner.cookie =
    "lt_session=" + createSession(db, owner.id, "127.0.0.1", "test").token;
});
test("2C immutable attachment storage detects corruption and rejects uploads to a closed task", async () => {
  const id = (await upload()).data.id;
  assert.throws(
    () =>
      db
        .prepare("UPDATE task_attachments SET filename=? WHERE id=?")
        .run("changed", id),
    /immutable/,
  );
  assert.throws(
    () => db.prepare("DELETE FROM task_attachments WHERE id=?").run(id),
    /retained/,
  );
  db.prepare("UPDATE tasks SET status='done' WHERE id=?").run(taskId);
  assert.equal((await upload()).status, 409);
  assert.equal((await call("/api/admin/task-attachments/" + id)).status, 200);
  db.prepare("UPDATE tasks SET status='new' WHERE id=?").run(taskId);
});
test("2C version3 snapshot restores exactly and blobs survive reopen with metadata and bytes together", () => {
  const file = `data/phase1b-testing/attachments-${randomBytes(6).toString("hex")}.db`;
  let raw = new DatabaseSync(file);
  raw.exec(readFileSync("tests/fixtures/pre-identity-crm.sql", "utf8"));
  raw.close();
  let d = openDb(file);
  assert.equal(d.prepare("PRAGMA user_version").get().user_version, 4);
  const prior = d.migrationBackups[3];
  d.close();
  const restore = file + ".v3";
  copyFileSync(prior, restore);
  raw = new DatabaseSync(restore, { readOnly: true });
  assert.equal(raw.prepare("PRAGMA user_version").get().user_version, 3);
  const ledger = raw
    .prepare("SELECT * FROM schema_migrations ORDER BY version")
    .all();
  raw.close();
  d = openDb(restore);
  assert.equal(d.migrationBackups.length, 1);
  assert.deepEqual(
    d
      .prepare(
        "SELECT * FROM schema_migrations WHERE version<4 ORDER BY version",
      )
      .all(),
    ledger,
  );
  assert.equal(d.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
  assert.equal(d.prepare("PRAGMA foreign_key_check").all().length, 0);
  d.close();
  const blobs = file + ".blobs";
  db.prepare("VACUUM INTO ?").run(blobs);
  const original = db
    .prepare("SELECT * FROM task_attachments ORDER BY id")
    .all();
  d = openDb(blobs);
  assert.deepEqual(
    d.prepare("SELECT * FROM task_attachments ORDER BY id").all(),
    original,
  );
  d.close();
});
