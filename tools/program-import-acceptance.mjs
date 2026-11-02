import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createApp } from "../server.js";
import { createSession, hashPassword } from "../lib/auth.js";
import { syntheticPdf, docx } from "../tests/helpers/program-documents.mjs";
import { ammanToday, REVIEW_CHECKS } from "../lib/program-data.js";
assert.equal(process.env.CI, "true");
process.env.PROGRAM_SOURCE_UPLOADS_ENABLED = "1";
const seed = JSON.parse(readFileSync("data/seed.json")),
  app = createApp({
    dbFile: ":memory:",
    seed: { ...seed, users: [] },
    adminPassword: "Synthetic-Program-AV42",
    baseUrl: "http://127.0.0.1:0",
  });
try {
  const db = app.db,
    now = new Date().toISOString(),
    pw = hashPassword("Synthetic-Program-AV42"),
    branch = db.prepare("SELECT id FROM branches LIMIT 1").get().id;
  const user = Number(
    db
      .prepare(
        "INSERT INTO users(username,name,role,branch_id,password_hash,password_salt,created_at) VALUES('program-av','Synthetic program AV','admin',?,?,?,?)",
      )
      .run(branch, pw.hash, pw.salt, now).lastInsertRowid,
  );
  const cookie =
      "lt_session=" +
      createSession(db, user, "127.0.0.1", "synthetic", { mfaVerified: true })
        .token,
    address = await app.listen(0, "127.0.0.1"),
    base = `http://127.0.0.1:${address.port}`,
    root = "/api/admin/program-workspace";
  const call = async (path, body) => {
    const r = await fetch(base + path, {
      method: body ? "POST" : "GET",
      headers: { origin: base, cookie, "content-type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await r.text();
    return {
      status: r.status,
      text,
      data: r.headers.get("content-type")?.includes("json")
        ? JSON.parse(text)
        : null,
    };
  };
  const made = await call(root, {
    slug: "synthetic-av-source",
    data: { title: "برنامج مصطنع لفحص الاستيراد", category: "istanbul" },
    branchId: branch,
    departmentId: null,
    ownerId: user,
    reason: "اختبار فحص حقيقي",
  });
  assert.equal(made.status, 201, made.text);
  const path = root + "/" + made.data.id;
  const upload = async (filename, bytes) => {
    const w = (await call(path)).data.workspace;
    return call(path + "/sources", {
      revision: w.revision,
      filename,
      base64: bytes.toString("base64"),
      reason: "استيراد مصطنع مفحوص",
    });
  };
  const pdf = syntheticPdf();
  let r = await upload("synthetic.pdf", pdf);
  assert.equal(r.status, 201, r.text);
  assert.equal(r.data.extraction.status, "extracted", r.text);
  assert.match(r.data.extraction.text, /520 USD/);
  const sourceId = r.data.id;
  console.log(
    "PASS program PDF import scanned by real engine and extracted locally",
  );
  const document = docx({
    "word/document.xml":
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>سعر فرد رباعي مصطنع 180 JOD</w:t></w:r></w:p></w:body></w:document>',
  });
  r = await upload("synthetic.docx", document);
  assert.equal(r.status, 201, r.text);
  assert.equal(r.data.extraction.status, "extracted", r.text);
  assert.match(r.data.extraction.text, /180 JOD/);
  console.log(
    "PASS program DOCX import scanned by real engine with exact Arabic evidence",
  );
  let response = await fetch(base + path + "/sources/" + sourceId, {
    headers: { cookie },
  });
  assert.equal(response.status, 200);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), pdf);
  response = await fetch(base + path + "/sources/" + sourceId);
  assert.equal(response.status, 401);
  await response.text();
  console.log("PASS original retained exactly and anonymous downloads denied");
  r = await upload(
    "unreadable.pdf",
    Buffer.from("%PDF-1.4 this synthetic file cannot be extracted %%EOF"),
  );
  assert.equal(r.status, 201, r.text);
  assert.equal(r.data.extraction.status, "failed");
  assert.equal((await call(path)).data.sources.length, 3);
  const revision = (await call(path)).data.workspace.revision;
  const complete = {
    title: "برنامج مصطنع للمراجعة اليدوية",
    category: "istanbul",
    destination: "وجهة مصطنعة",
    terms: ["شروط مصطنعة"],
    pricing: [
      {
        label: "غرفة مصطنعة",
        sale: 520,
        cost: 430,
        currency: "USD",
        basis: "room",
        occupancy: "double",
      },
    ],
    valid_from: ammanToday(),
    valid_until: "2099-01-31",
    travel_start: "2099-02-01",
    travel_end: "2099-02-28",
  };
  const save = await fetch(base + path, {
    method: "PATCH",
    headers: { origin: base, cookie, "content-type": "application/json" },
    body: JSON.stringify({
      revision,
      data: complete,
      reason: "مراجعة أصل مصطنع بعد فشل الاستخراج",
    }),
  });
  assert.equal(save.status, 200);
  await save.text();
  const command = async (action, extra = {}) =>
    call(path + "/" + action, {
      revision: (await call(path)).data.workspace.revision,
      reason: "اعتماد مراجعة مصطنعة",
      ...extra,
    });
  assert.equal((await command("submit")).status, 200);
  const humanReview = {
    checks: Object.fromEntries(REVIEW_CHECKS.map((k) => [k, true])),
    reviewedSourceIds: (await call(path)).data.sources.map((s) => s.id),
  };
  assert.equal((await command("approve", humanReview)).status, 422);
  assert.equal(
    (await command("approve", { ...humanReview, manualExtraction: true }))
      .status,
    200,
  );
  assert.equal((await call(path)).data.published, null);
  console.log(
    "PASS failed extraction retains safe original with explicit review error",
  );
  const marker = Buffer.from(
    [
      "X5O!P%@AP[4",
      String.fromCharCode(92),
      "PZX54(P^)7CC)7}$",
      "EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*",
    ].join(""),
  );
  // EICAR requires a complete 68-byte file, not a string prefixed with PDF bytes.
  // Place that exact in-memory file in the supported DOCX ZIP container.
  assert.equal(marker.length, 68);
  const infected = docx({
    "word/document.xml":
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Synthetic scanner test only</w:t></w:r></w:p></w:body></w:document>',
    "scanner-test.txt": marker,
  });
  r = await upload("benign-av-test.docx", infected);
  assert.equal(r.status, 422, r.text);
  assert.equal((await call(path)).data.sources.length, 3);
  console.log(
    "PASS real engine rejects standard benign AV marker before retaining any source",
  );
  const original = process.env.ATTACHMENT_CLAMD_PORT;
  process.env.ATTACHMENT_CLAMD_PORT = "0";
  try {
    r = await upload("synthetic.pdf", pdf);
    assert.equal(r.status, 503, r.text);
  } finally {
    process.env.ATTACHMENT_CLAMD_PORT = original;
  }
  assert.equal((await call(path)).data.sources.length, 3);
  assert.equal((await call(path)).data.published, null);
  console.log(
    "PASS scanner outage fails closed and import never publishes a price",
  );
  console.log("PROGRAM_IMPORT_REAL_AV_ACCEPTANCE 6/6");
} finally {
  delete process.env.PROGRAM_SOURCE_UPLOADS_ENABLED;
  await app.close();
}
