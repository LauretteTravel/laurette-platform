import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, createHash } from "node:crypto";
import { readFileSync, copyFileSync, realpathSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { syntheticPdf, docx } from "./helpers/program-documents.mjs";
import { createApp } from "../server.js";
import { hashPassword, createSession } from "../lib/auth.js";
import { openDb } from "../lib/db.js";
import { adoptProgramCatalog } from "../lib/programs.js";
import { programData, ammanToday } from "../lib/program-data.js";
import {
  sourceAnalysis,
  extractProgramSource,
} from "../lib/program-extract.js";
import { rehearsePrivateCopy } from "../tools/rehearse-private-db.mjs";
const basePath = "/api/admin/program-workspace",
  now = () => new Date().toISOString(),
  digest = (v) => createHash("sha256").update(v).digest("hex");
let app, db, base, branch, department, otherBranch, owner;
const permissions = [
  "programs:read",
  "programs:write",
  "programs:approve",
  "programs:publish",
  "programs:sources",
  "programs:categories",
];
function actor({
  scope = "assigned",
  perms = permissions,
  unit = branch,
  dept = department,
  mustChange = 0,
  mfa = true,
} = {}) {
  const name = "p4-" + randomBytes(6).toString("hex"),
    pw = hashPassword("Synthetic-Program-Password42");
  db.prepare(
    "INSERT INTO role_definitions(role_key,name,base_role,data_scope,permissions,created_at,updated_at) VALUES(?,?,?,?,?,?,?)",
  ).run(name, name, "agent", scope, JSON.stringify(perms), now(), now());
  const id = Number(
    db
      .prepare(
        "INSERT INTO users(username,name,role,role_key,branch_id,department_id,password_hash,password_salt,must_change,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
      )
      .run(
        name,
        "موظف برامج مصطنع",
        "agent",
        name,
        unit,
        dept,
        pw.hash,
        pw.salt,
        mustChange,
        now(),
      ).lastInsertRowid,
  );
  return {
    id,
    key: name,
    cookie:
      "lt_session=" +
      createSession(db, id, "127.0.0.1", "synthetic", { mfaVerified: mfa })
        .token,
  };
}
async function call(
  path,
  { user = owner, body, method = body ? "POST" : "GET", origin = base } = {},
) {
  const response = await fetch(base + path, {
    signal: AbortSignal.timeout(15000),
    method,
    headers: {
      origin,
      "content-type": "application/json",
      ...(user ? { cookie: user.cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  return {
    status: response.status,
    text,
    data: response.headers.get("content-type")?.includes("json")
      ? JSON.parse(text)
      : null,
    headers: response.headers,
  };
}
const path = (id) => basePath + "/" + id;
const detail = async (id, user = owner) =>
  (await call(path(id), { user })).data;
const fixture = () => ({
  title: "برنامج مصطنع — لا يمثل عرضًا فعليًا",
  category: "istanbul",
  destination: "وجهة مصطنعة",
  days: 4,
  nights: 3,
  terms: ["المراجعة البشرية شرط النشر"],
  includes: ["إقامة مصطنعة"],
  excludes: ["رسوم اختبار"],
  hotels: [
    { city: "مدينة مصطنعة", name: "فندق مصطنع", stars: 4, distance: "100m" },
  ],
  itinerary: ["الوصول", "جولة", "وقت حر", "العودة"],
  pricing: [
    {
      label: "غرفة مزدوجة",
      sale: 520,
      cost: 430,
      currency: "USD",
      basis: "room",
      occupancy: "double",
    },
    {
      label: "فرد رباعي",
      sale: 180,
      cost: 140,
      currency: "JOD",
      basis: "person",
      occupancy: "quad",
    },
  ],
  display_price: 0,
  valid_from: ammanToday(),
  valid_until: "2099-01-31",
  travel_start: "2099-02-01",
  travel_end: "2099-02-28",
  art_key: "istanbul",
});
async function make({ user = owner, data = fixture() } = {}) {
  const r = await call(basePath, {
    user,
    body: {
      slug: "synthetic-" + randomBytes(5).toString("hex"),
      data,
      branchId: branch,
      departmentId: department,
      ownerId: user.id,
      reason: "إنشاء برنامج مصطنع",
    },
  });
  assert.equal(r.status, 201, r.text);
  return r.data.id;
}
async function command(id, action, extra = {}, user = owner) {
  const r = await detail(id, user);
  return call(path(id) + "/" + action, {
    user,
    body: {
      revision: r.workspace.revision,
      reason: "عملية مراجعة مصطنعة",
      ...extra,
    },
  });
}
const approval = (sources) => ({
  checks: Object.fromEntries(
    ["source", "prices", "basis", "currencies", "dates", "conditions"].map(
      (k) => [k, true],
    ),
  ),
  reviewedSourceIds: sources || [],
});
async function publish(id) {
  assert.equal((await command(id, "submit")).status, 200);
  assert.equal((await command(id, "approve", approval())).status, 200);
  const r = await command(id, "publish");
  assert.equal(r.status, 200, r.text);
  return r.data;
}
before(async () => {
  const seed = JSON.parse(readFileSync("data/seed.json"));
  app = createApp({
    dbFile: ":memory:",
    seed: { ...seed, users: [] },
    adminPassword: "Synthetic-Program-Password42",
    baseUrl: "http://127.0.0.1:0",
  });
  db = app.db;
  [branch, otherBranch] = db
    .prepare("SELECT id FROM branches ORDER BY id LIMIT 2")
    .all()
    .map((r) => r.id);
  department = db
    .prepare("SELECT id FROM departments WHERE branch_id IS NULL LIMIT 1")
    .get().id;
  owner = actor();
  const address = await app.listen(0, "127.0.0.1");
  base = `http://127.0.0.1:${address.port}`;
});
after(async () => {
  delete process.env.PROGRAM_SOURCE_UPLOADS_ENABLED;
  await app?.close();
});

test("4 legacy catalogue stays intact and fresh seeds acquire private workspaces without automatic ownership grants", async () => {
  const count = db.prepare("SELECT COUNT(*) n FROM programs").get().n;
  assert.equal(
    db
      .prepare(
        "SELECT COUNT(*) n FROM program_workspaces WHERE program_id IS NOT NULL",
      )
      .get().n,
    count,
  );
  const org = actor({ scope: "organization" }),
    r = await call(basePath, { user: org });
  assert.ok(r.data.total >= count);
  const fractional = await call(basePath + "?page=1.5", { user: org });
  assert.equal(fractional.status, 200);
  assert.equal(fractional.data.page, 1);
  const legacy = db.prepare("SELECT * FROM programs LIMIT 1").get();
  assert.equal((await call(path("legacy-" + legacy.id))).status, 404);
  for (const [p, m] of [
    ["/api/admin/programs", "POST"],
    ["/api/admin/programs/" + legacy.id, "PATCH"],
    ["/api/admin/programs/" + legacy.id, "DELETE"],
  ])
    assert.ok(
      [403, 409].includes(
        (await call(p, { method: m, body: { title: "محاولة" } })).status,
      ),
    );
  assert.deepEqual(
    db.prepare("SELECT * FROM programs WHERE id=?").get(legacy.id),
    legacy,
  );
  const draftId = Number(
    db
      .prepare(
        "INSERT INTO programs(slug,title,category,status,created_at,updated_at) VALUES('synthetic-legacy-draft','مسودة قديمة مصطنعة','istanbul','draft',?,?)",
      )
      .run(now(), now()).lastInsertRowid,
  );
  adoptProgramCatalog(db);
  assert.equal(
    (await detail("legacy-" + draftId, org)).workspace.state,
    "draft",
  );
  assert.equal(
    (await call("/api/programs/synthetic-legacy-draft", { user: null })).status,
    404,
  );
  assert.equal(
    (await call("/programs/synthetic-legacy-draft", { user: null })).status,
    404,
  );
});
test("4 drafts and review never update the public row; explicit approval and publish atomically materialize only safe public fields", async () => {
  const count = db.prepare("SELECT COUNT(*) n FROM programs").get().n,
    id = await make();
  let r = await detail(id);
  assert.equal(r.workspace.state, "draft");
  assert.equal(r.published, null);
  assert.equal((await command(id, "publish")).status, 409);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM programs").get().n, count);
  const result = await publish(id),
    p = result.published;
  assert.equal(p.price_from, 520);
  assert.equal(p.currency, "USD");
  assert.equal(p.price_basis, "room");
  assert.equal(p.price_occupancy, "double");
  assert.equal(p.status, "published");
  const api = await call("/api/programs/" + p.slug, { user: null });
  assert.equal(api.data.program.priceBasis, "room");
  assert.equal(api.data.program.options[1].currency, "JOD");
  assert.ok(!api.text.includes('"cost"'));
  const page = await call("/programs/" + p.slug, { user: null });
  assert.equal(page.status, 200);
  assert.match(page.text, /للغرفة/);
  assert.match(page.text, /"priceCurrency":"USD"/);
  assert.ok(!page.text.includes("الأسعار للشخص الواحد"));
  const print = await call("/programs/print", { user: null });
  assert.equal(print.status, 200);
  assert.match(print.text, /للغرفة/);
  assert.equal((await command(id, "publish")).status, 409);
});
test("4 approval checklist and all source acknowledgements are mandatory; every edit invalidates approval while retaining immutable history", async () => {
  const id = await make();
  let r = await detail(id);
  const s = await call(path(id) + "/sources", {
    body: {
      revision: r.workspace.revision,
      kind: "text",
      text: "سعر الغرفة المزدوجة 520 USD — شروط مصطنعة فقط",
      reason: "مصدر نصي مصطنع",
    },
  });
  assert.equal(s.status, 201);
  assert.equal((await command(id, "submit")).status, 200);
  assert.equal((await command(id, "approve", {})).status, 422);
  assert.equal((await command(id, "approve", approval())).status, 422);
  assert.equal(
    (await command(id, "approve", approval([s.data.id]))).status,
    200,
  );
  r = await detail(id);
  const frozen = db
    .prepare("SELECT * FROM program_versions WHERE workspace_id=?")
    .get(id);
  r.workspace.data.pricing[0].sale = 600;
  assert.equal(
    (
      await call(path(id), {
        method: "PATCH",
        body: {
          data: r.workspace.data,
          revision: r.workspace.revision,
          reason: "تعديل يلغي الاعتماد",
        },
      })
    ).status,
    200,
  );
  assert.equal((await command(id, "publish")).status, 409);
  assert.equal((await detail(id)).workspace.state, "draft");
  assert.deepEqual(
    db.prepare("SELECT * FROM program_versions WHERE workspace_id=?").get(id),
    frozen,
  );
  for (const sql of [
    "UPDATE program_versions SET sha256='bad' WHERE workspace_id=?",
    "DELETE FROM program_versions WHERE workspace_id=?",
    "DELETE FROM program_sources WHERE workspace_id=?",
    "DELETE FROM program_events WHERE workspace_id=?",
    "DELETE FROM program_workspaces WHERE id=?",
  ])
    assert.throws(() => db.prepare(sql).run(id));
});
test("4 stale revisions, request-body privilege revocation and external public edits fail without partial publication", async () => {
  const id = await make(),
    r = await detail(id),
    body = {
      data: r.workspace.data,
      revision: r.workspace.revision,
      reason: "اختبار التعارض",
    };
  const answers = await Promise.all([
    call(path(id), { method: "PATCH", body }),
    call(path(id), { method: "PATCH", body }),
  ]);
  assert.deepEqual(answers.map((r) => r.status).sort(), [200, 409]);
  await publish(id);
  const p = (await detail(id)).published;
  let d = await detail(id);
  assert.equal(
    (
      await call(path(id), {
        method: "PATCH",
        body: {
          data: d.workspace.data,
          revision: d.workspace.revision,
          reason: "إصدار جديد مصطنع",
        },
      })
    ).status,
    200,
  );
  await command(id, "submit");
  await command(id, "approve", approval());
  db.prepare("UPDATE programs SET title=? WHERE id=?").run(
    "تغيير خارجي مصطنع",
    p.id,
  );
  const old = db.prepare("SELECT * FROM programs WHERE id=?").get(p.id);
  assert.equal((await command(id, "publish")).status, 409);
  assert.deepEqual(
    db.prepare("SELECT * FROM programs WHERE id=?").get(p.id),
    old,
  );
  const revoked = actor(),
    rid = await make({ user: revoked }),
    detailRow = await detail(rid, revoked);
  app.server.once("request", () =>
    db
      .prepare("UPDATE role_definitions SET permissions=? WHERE role_key=?")
      .run('["programs:read"]', revoked.key),
  );
  assert.equal(
    (
      await call(path(rid), {
        user: revoked,
        method: "PATCH",
        body: {
          data: detailRow.workspace.data,
          revision: detailRow.workspace.revision,
          reason: "اختبار سحب الصلاحية",
        },
      })
    ).status,
    403,
  );
  assert.equal(
    (await detail(rid, revoked)).workspace.revision,
    detailRow.workspace.revision,
  );
});
test("4 scopes follow branch, department, owner and active membership; source and approval history cannot bypass them", async () => {
  const id = await make(),
    outsider = actor({ unit: otherBranch }),
    peer = actor(),
    manager = actor({ scope: "branch" });
  for (const u of [outsider, peer]) {
    assert.equal((await call(path(id), { user: u })).status, 404);
    assert.equal(
      (await call(path(id) + "/versions/1", { user: u })).status,
      404,
    );
    assert.equal(
      (await call(path(id) + "/sources/missing", { user: u })).status,
      404,
    );
  }
  assert.equal((await call(path(id), { user: manager })).status, 200);
  const differentDept = actor({
    scope: "department",
    dept: db
      .prepare(
        "SELECT id FROM departments WHERE branch_id IS NULL AND id!=? LIMIT 1",
      )
      .get(department).id,
  });
  assert.equal((await call(path(id), { user: differentDept })).status, 404);
  const r = await detail(id);
  assert.equal(
    (
      await call(path(id), {
        method: "PATCH",
        body: {
          revision: r.workspace.revision,
          data: r.workspace.data,
          branchId: otherBranch,
          ownerId: outsider.id,
          reason: "محاولة نقل غير مصرح",
        },
      })
    ).status,
    403,
  );
  db.prepare("UPDATE users SET branch_id=? WHERE id=?").run(
    otherBranch,
    manager.id,
  );
  assert.equal((await call(path(id), { user: manager })).status, 401); // Updating primary identity revokes its previous session.
});
test("4 central authentication, must_change, MFA, independent publish permission and CSRF stay enforced", async () => {
  const id = await make();
  assert.equal((await call(path(id), { user: null })).status, 401);
  for (const user of [actor({ mustChange: 1 }), actor({ mfa: false })])
    assert.equal((await call(path(id), { user })).status, 403);
  const editor = actor({ perms: ["programs:read", "programs:write"] });
  const own = await make({ user: editor });
  assert.equal((await command(own, "publish", {}, editor)).status, 403);
  assert.equal((await command(own, "approve", approval(), editor)).status, 403);
  const row = await detail(id);
  assert.equal(
    (
      await call(path(id), {
        origin: "https://evil.example",
        method: "PATCH",
        body: {
          revision: row.workspace.revision,
          data: row.workspace.data,
          reason: "محاولة CSRF",
        },
      })
    ).status,
    403,
  );
  const unread = actor({ perms: ["programs:sources"] });
  assert.equal(
    (await call(path(id) + "/sources/missing", { user: unread })).status,
    403,
  );
});
test("4 date, currency, occupancy, price precision and typed lists reject ambiguous or invalid published data", () => {
  for (const edit of [
    (d) => (d.pricing[0].basis = ""),
    (d) => (d.pricing[0].occupancy = ""),
    (d) => (d.pricing[0].currency = "$"),
    (d) => (d.pricing[0].sale = -1),
    (d) => (d.pricing[0].sale = 0),
    (d) => (d.pricing[0].sale = 1.1234),
    (d) => (d.valid_until = "2027-02-30"),
    (d) => (d.travel_end = "2000-01-01"),
    (d) => (d.hotels = [{ name: "Hotel", stars: 99999999 }]),
    (d) => (d.terms = [null]),
    (d) => (d.display_price = 30),
    (d) => (d.valid_from = "2099-03-01"),
  ]) {
    const d = fixture();
    edit(d);
    assert.throws(
      () => programData(d, "synthetic-valid", { complete: true }),
      (e) => e.status === 422,
    );
  }
  assert.equal(
    programData(fixture(), "synthetic-valid", { complete: true }).pricing[1]
      .currency,
    "JOD",
  );
});
test("4 manual source analysis preserves exact evidence, flags uncertainty and never changes price fields", async () => {
  const text =
    "سعر الفرد الرباعي ١٨٠ JOD\nسعر الغرفة المزدوجة 520 USD\nصالح حتى 2099-01-31\nلا يشمل: رسوم مصطنعة";
  const a = sourceAnalysis(text);
  assert.equal(a.status, "extracted");
  assert.equal(a.candidates[0].confidence, "unverified");
  assert.equal(a.candidates[0].amounts[0], "180");
  assert.equal(a.candidates[1].basis, null);
  assert.equal(a.candidates[2].line, 3);
  const id = await make(),
    r = await detail(id),
    s = await call(path(id) + "/sources", {
      body: {
        revision: r.workspace.revision,
        kind: "text",
        filename: "مصدر مصطنع",
        text,
        reason: "مراجعة نص المصدر",
      },
    });
  assert.equal(s.status, 201);
  const result = await detail(id);
  assert.deepEqual(result.workspace.data.pricing, r.workspace.data.pricing);
  const download = await call(path(id) + "/sources/" + s.data.id);
  assert.equal(download.status, 200);
  assert.equal(download.text, text);
  assert.equal(
    download.headers.get("content-type"),
    "application/octet-stream",
  );
  assert.match(download.headers.get("cache-control"), /no-store/);
  const version = result.workspace.revision;
  assert.equal(
    (
      await call(path(id) + "/sources", {
        body: { revision: version, kind: "text", text, reason: "تكرار المصدر" },
      })
    ).status,
    201,
  );
  assert.equal((await detail(id)).workspace.revision, version);
  assert.equal(
    (await call(path(id) + "/sources/" + s.data.id, { user: null })).status,
    401,
  );
});
test("4 file upload gate is opt-in only; scanner outage and invalid types store no original or draft changes", async () => {
  const id = await make(),
    r = await detail(id),
    body = {
      revision: r.workspace.revision,
      filename: "synthetic.pdf",
      base64: syntheticPdf().toString("base64"),
      reason: "اختبار بوابة الرفع",
    };
  for (const value of [undefined, "true", "0"]) {
    if (value === undefined) delete process.env.PROGRAM_SOURCE_UPLOADS_ENABLED;
    else process.env.PROGRAM_SOURCE_UPLOADS_ENABLED = value;
    assert.equal((await call(path(id) + "/sources", { body })).status, 503);
  }
  process.env.PROGRAM_SOURCE_UPLOADS_ENABLED = "1";
  const old = process.env.ATTACHMENT_CLAMD_PORT;
  process.env.ATTACHMENT_CLAMD_PORT = "0";
  try {
    assert.equal((await call(path(id) + "/sources", { body })).status, 503);
    assert.equal(
      (
        await call(path(id) + "/sources", {
          body: { ...body, filename: "bad.docx" },
        })
      ).status,
      422,
    );
  } finally {
    if (old === undefined) delete process.env.ATTACHMENT_CLAMD_PORT;
    else process.env.ATTACHMENT_CLAMD_PORT = old;
    delete process.env.PROGRAM_SOURCE_UPLOADS_ENABLED;
  }
  assert.equal((await detail(id)).workspace.revision, r.workspace.revision);
  assert.equal(
    db
      .prepare("SELECT COUNT(*) n FROM program_sources WHERE workspace_id=?")
      .get(id).n,
    0,
  );
});
test("4 expiry hides stale prices from public pages, API, AI context and price filters without deleting the programme", async () => {
  const id = await make(),
    result = await publish(id),
    p = result.published;
  db.prepare("UPDATE programs SET expires_on='2000-01-01' WHERE id=?").run(
    p.id,
  );
  const response = await call("/api/programs/" + p.slug, { user: null });
  assert.equal(response.data.program.expired, true);
  assert.equal(response.data.program.priceFrom, null);
  assert.deepEqual(response.data.program.options, []);
  const page = await call("/programs/" + p.slug, { user: null });
  assert.equal(page.status, 200);
  assert.match(page.text, /انتهت صلاحية السعر/);
  assert.ok(!page.text.includes('"price":520'));
  const filtered = await call("/api/programs?minPrice=1&limit=500");
  assert.ok(!filtered.data.programs.some((r) => r.slug === p.slug));
});
test("4 archive retains the public record, source links and history; public detail no longer serves archived offers", async () => {
  const id = await make(),
    result = await publish(id),
    p = result.published;
  assert.equal((await command(id, "archive")).status, 200);
  assert.equal(
    db.prepare("SELECT status FROM programs WHERE id=?").get(p.id).status,
    "archived",
  );
  assert.equal((await call("/programs/" + p.slug, { user: null })).status, 404);
  assert.equal((await detail(id)).versions.length, 1);
});
test("4 categories are manageable without deleting historic categories or automatically adding Hajj", async () => {
  const before = db.prepare("SELECT * FROM programs ORDER BY id").all(),
    key = "synthetic-category";
  assert.equal(
    (
      await call(basePath + "/categories", {
        body: { key, name: "تصنيف مصطنع", active: true, reason: "إضافة تصنيف" },
      })
    ).status,
    200,
  );
  assert.equal(
    db.prepare("SELECT active FROM program_categories WHERE key=?").get(key)
      .active,
    1,
  );
  assert.equal(
    (
      await call(basePath + "/categories", {
        body: {
          key,
          name: "تصنيف موقوف",
          active: false,
          reason: "إيقاف تصنيف",
        },
      })
    ).status,
    200,
  );
  const d = fixture();
  d.category = key;
  assert.equal(
    (
      await call(basePath, {
        body: {
          slug: "disabled-category",
          data: d,
          branchId: branch,
          departmentId: department,
          ownerId: owner.id,
          reason: "اختبار تصنيف موقوف",
        },
      })
    ).status,
    422,
  );
  assert.deepEqual(
    db.prepare("SELECT * FROM programs ORDER BY id").all(),
    before,
  );
});
test("4 real PDF and DOCX extraction preserve text/table evidence; scanned, unsafe and bomb documents fail explicitly", async () => {
  const doc = docx({
    "word/document.xml": `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>سعر مصطنع فقط</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>غرفة مزدوجة</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>520 USD</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>`,
  });
  const a = await extractProgramSource(doc, "docx");
  assert.equal(a.status, "extracted", JSON.stringify(a));
  assert.match(a.text, /غرفة مزدوجة\t\|\t520 USD/);
  const pdf = await extractProgramSource(syntheticPdf(), "pdf");
  assert.equal(pdf.status, "extracted", JSON.stringify(pdf));
  assert.match(pdf.text, /520 USD/);
  assert.equal(
    (
      await extractProgramSource(
        Buffer.from("%PDF-1.4 invalid scanned %%EOF"),
        "pdf",
      )
    ).status,
    "failed",
  );
  for (const bytes of [
    docx({
      "word/document.xml":
        '<!DOCTYPE a [<!ENTITY x SYSTEM "file:///etc/passwd">]><a>&x;</a>',
    }),
    docx({ "../escape": "bad", "word/document.xml": "<bad/>" }),
    docx({ "word/document.xml": "x".repeat(200000) }),
    docx({ "word/document.xml": "<a/>", "word/vbaProject.bin": "unsafe" }),
    docx({
      "word/document.xml": "<a/>",
      "word/_rels/document.xml.rels":
        '<Relationships><Relationship TargetMode="External" Target="https://example.invalid/"/></Relationships>',
    }),
  ])
    assert.equal((await extractProgramSource(bytes, "docx")).status, "failed");
});
test("4 migration6 to7 retains every historical cell and frozen checksum, restores in isolation and creates a verified backup", () => {
  const file =
    "data/phase1b-testing/programs-" + randomBytes(6).toString("hex") + ".db";
  let raw = new DatabaseSync(file);
  raw.exec(readFileSync("tests/fixtures/pre-identity-crm.sql", "utf8"));
  raw.close();
  let upgraded = openDb(file);
  assert.equal(upgraded.prepare("PRAGMA user_version").get().user_version, 8);
  const backup = upgraded.migrationBackups[6];
  raw = new DatabaseSync(backup, { readOnly: true });
  assert.equal(raw.prepare("PRAGMA user_version").get().user_version, 6);
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
    const old = raw
        .prepare(`SELECT ${cols} FROM "${name}" ORDER BY rowid`)
        .all(),
      current = upgraded
        .prepare(`SELECT ${cols} FROM "${name}" ORDER BY rowid`)
        .all();
    assert.deepEqual(
      ["audit_log", "schema_migrations"].includes(name)
        ? current.slice(0, old.length)
        : current,
      old,
      name,
    );
  }
  raw.close();
  upgraded.close();
  const before = digest(readFileSync(backup)),
    result = rehearsePrivateCopy({
      sourceFile: backup,
      privateRoot: realpathSync("data/phase1b-testing"),
    });
  assert.equal(result.candidateVersion, 8);
  assert.equal(result.sourceVersion, 6);
  assert.equal(result.migrationSnapshots, 2);
  assert.equal(result.isolatedRestoreExact, true);
  assert.equal(result.historicalValuesPreserved, true);
  assert.equal(digest(readFileSync(backup)), before);
  copyFileSync(backup, file + ".restored");
  upgraded = openDb(file + ".restored");
  assert.equal(upgraded.migrationBackups.length, 2);
  upgraded.close();
  upgraded = openDb(file + ".restored");
  assert.equal(upgraded.migrationBackups.length, 0);
  upgraded.close();
});
