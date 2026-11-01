import { randomUUID, createHash } from "node:crypto";
import { one, q, exec, transaction } from "./db.js";
import { can, sessionUser } from "./auth.js";
import { HttpError, json, readJson } from "./http.js";
import { audit } from "./domain.js";
import { taskUnit } from "./task-access.js";
import {
  programData,
  legacyProgram,
  publicValues,
  REVIEW_CHECKS,
  ammanToday,
} from "./program-data.js";
import { sourceAnalysis, extractProgramSource } from "./program-extract.js";
import { scanAttachment } from "./attachment-scan.js";
const sha = (v) => createHash("sha256").update(v).digest("hex");
const now = () => new Date().toISOString();
let uploads = 0;
function scope(user) {
  if (!user.roleKey || user.dataScope === "organization")
    return { sql: "1", args: [] };
  if (
    !user.branchId ||
    !["branch", "department", "assigned"].includes(user.dataScope)
  )
    return { sql: "0", args: [] };
  let sql = "w.branch_id=?",
    args = [user.branchId];
  if (["department", "assigned"].includes(user.dataScope)) {
    sql += " AND w.department_id IS ?";
    args.push(user.departmentId);
  }
  if (user.dataScope === "assigned") {
    sql += " AND w.owner_id=?";
    args.push(user.id);
  }
  return { sql, args };
}
function visible(ctx) {
  if (!can(ctx.user, "programs:read"))
    throw new HttpError(403, "تحتاج صلاحية قراءة البرامج");
  const s = scope(ctx.user),
    r = one(
      ctx.db,
      `SELECT w.* FROM program_workspaces w WHERE w.id=? AND ${s.sql}`,
      [ctx.params.id, ...s.args],
    );
  if (!r) throw new HttpError(404, "البرنامج غير موجود في نطاقك");
  return r;
}
export function adoptProgramCatalog(db) {
  transaction(db, () => {
    for (const p of q(
      db,
      "SELECT * FROM programs WHERE id NOT IN(SELECT program_id FROM program_workspaces WHERE program_id IS NOT NULL)",
    ))
      exec(
        db,
        "INSERT INTO program_workspaces(id,program_id,slug,state,baseline_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?)",
        [
          "legacy-" + p.id,
          p.id,
          p.slug,
          p.status === "archived" ? "archived" : "published",
          JSON.stringify(p),
          p.created_at,
          p.updated_at,
        ],
      );
  });
}
function refresh(ctx, action) {
  const u = sessionUser(ctx.db, ctx.token);
  if (!u) throw new HttpError(401, "انتهت الجلسة");
  if (
    u.mustChange ||
    (u.mfaRequired && !u.mfaVerified) ||
    !can(u, action) ||
    !can(u, "programs:read")
  )
    throw new HttpError(403, "تغيرت صلاحيات الوصول");
  ctx.user = u;
}
function expected(row, b) {
  if (!Number.isInteger(b.revision) || row.revision !== b.revision)
    throw new HttpError(409, "تغير البرنامج؛ أعد تحميله قبل المتابعة");
}
function why(b) {
  if (
    typeof b.reason !== "string" ||
    b.reason.trim().length < 3 ||
    b.reason.length > 500
  )
    throw new HttpError(422, "سبب العملية مطلوب (3–500 حرف)");
  return b.reason.trim();
}
function data(ctx, r) {
  return r.draft_json
    ? JSON.parse(r.draft_json)
    : legacyProgram(
        one(ctx.db, "SELECT * FROM programs WHERE id=?", [r.program_id]),
      );
}
function category(ctx, key) {
  if (
    !one(ctx.db, "SELECT 1 FROM program_categories WHERE key=? AND active=1", [
      key,
    ])
  )
    throw new HttpError(422, "اختر تصنيفًا نشطًا");
}
function event(ctx, row, kind, reason, version = 0) {
  exec(
    ctx.db,
    "INSERT INTO program_events(workspace_id,kind,revision,version,actor_id,reason,created_at) VALUES(?,?,?,?,?,?,?)",
    [row.id, kind, row.revision, version, ctx.user.id, reason, now()],
  );
  audit(ctx.db, {
    user: ctx.user,
    action: "program." + kind,
    entity: "program_workspace",
    entityId: row.id,
    meta: { revision: row.revision, version, reason },
    ip: ctx.ip,
  });
}
function bump(ctx, r, state, reason, kind, extra = {}) {
  exec(
    ctx.db,
    "UPDATE program_workspaces SET state=?,revision=revision+1,updated_at=? WHERE id=?",
    [state, now(), r.id],
  );
  r = { ...r, state, revision: r.revision + 1, ...extra };
  event(ctx, r, kind, reason, r.approved_version);
  return r;
}
function unit(ctx, b, row) {
  const branch =
    b.branchId === undefined
      ? (row?.branch_id ?? ctx.user.branchId)
      : b.branchId;
  const department =
    b.departmentId === undefined
      ? (row?.department_id ?? ctx.user.departmentId ?? null)
      : b.departmentId;
  const owner =
    b.ownerId === undefined ? (row?.owner_id ?? ctx.user.id) : b.ownerId;
  taskUnit(ctx, branch, department);
  if (
    ctx.user.roleKey &&
    ctx.user.dataScope === "assigned" &&
    owner !== ctx.user.id
  )
    throw new HttpError(403, "تعيين مسؤول آخر خارج نطاقك");
  if (
    !Number.isInteger(owner) ||
    !one(
      ctx.db,
      `SELECT u.id FROM users u WHERE u.id=? AND u.active=1 AND ((u.branch_id=? AND u.department_id IS ?) OR EXISTS(SELECT 1 FROM staff_memberships m WHERE m.user_id=u.id AND m.active=1 AND m.branch_id=? AND m.department_id IS ?))`,
      [owner, branch, department, branch, department],
    )
  )
    throw new HttpError(
      422,
      "المسؤول يجب أن يكون موظفًا نشطًا في الفرع والقسم",
    );
  return { branch, department, owner };
}
function version(ctx, r) {
  const v = one(
    ctx.db,
    "SELECT * FROM program_versions WHERE workspace_id=? AND version=?",
    [r.id, r.approved_version],
  );
  if (!v || sha(v.snapshot_json) !== v.sha256)
    throw new HttpError(503, "تعذر التحقق من سلامة الاعتماد");
  return JSON.parse(v.snapshot_json);
}
export function listPrograms(ctx) {
  const s = scope(ctx.user),
    term = String(ctx.query.q || "")
      .trim()
      .slice(0, 100),
    state = String(ctx.query.state || ""),
    category = String(ctx.query.category || ""),
    page = Math.max(1, Math.min(10000, Number(ctx.query.page) || 1));
  const where = `${s.sql} AND (?='' OR w.slug LIKE ? OR COALESCE(json_extract(w.draft_json,'$.title'),p.title,'') LIKE ?) AND (?='' OR w.state=?) AND (?='' OR COALESCE(json_extract(w.draft_json,'$.category'),p.category)=?)`;
  const args = [
    ...s.args,
    term,
    "%" + term + "%",
    "%" + term + "%",
    state,
    state,
    category,
    category,
  ];
  const from =
    "FROM program_workspaces w LEFT JOIN programs p ON p.id=w.program_id";
  const items = q(
    ctx.db,
    `SELECT w.id,w.slug,w.program_id,w.state,w.revision,w.branch_id,w.department_id,w.owner_id,w.updated_at,COALESCE(json_extract(w.draft_json,'$.title'),p.title) AS title,json_extract(w.draft_json,'$.valid_until') AS valid_until ${from} WHERE ${where} ORDER BY w.updated_at DESC,w.id LIMIT 25 OFFSET ?`,
    [...args, (page - 1) * 25],
  );
  return json(ctx.res, 200, {
    ok: true,
    items: items.map((r) => ({
      ...r,
      expired: Boolean(r.valid_until && r.valid_until < ammanToday()),
    })),
    total: one(ctx.db, `SELECT COUNT(*) n ${from} WHERE ${where}`, args).n,
    page,
  });
}
export function metadata(ctx) {
  const s = scope(ctx.user),
    org = !ctx.user.roleKey || ctx.user.dataScope === "organization";
  return json(ctx.res, 200, {
    ok: true,
    categories: q(ctx.db, "SELECT * FROM program_categories ORDER BY name"),
    branches: q(
      ctx.db,
      "SELECT id,name FROM branches WHERE active=1" + (org ? "" : " AND id=?"),
      org ? [] : [ctx.user.branchId],
    ),
    departments: q(
      ctx.db,
      "SELECT id,name,branch_id FROM departments WHERE active=1" +
        (org ? "" : " AND (branch_id IS NULL OR branch_id=?)"),
      org ? [] : [ctx.user.branchId],
    ),
    owners: q(
      ctx.db,
      `SELECT DISTINCT u.id,u.name,u.branch_id,u.department_id FROM users u WHERE u.active=1${org ? "" : " AND (u.branch_id=? OR EXISTS(SELECT 1 FROM staff_memberships m WHERE m.user_id=u.id AND m.branch_id=? AND m.active=1))"}`,
      org ? [] : [ctx.user.branchId, ctx.user.branchId],
    ),
    current: {
      id: ctx.user.id,
      branchId: ctx.user.branchId,
      departmentId: ctx.user.departmentId,
    },
    uploadsEnabled: process.env.PROGRAM_SOURCE_UPLOADS_ENABLED === "1",
    checks: REVIEW_CHECKS,
  });
}
export function getProgram(ctx) {
  const r = visible(ctx),
    d = data(ctx, r);
  return json(ctx.res, 200, {
    ok: true,
    workspace: {
      ...r,
      draft_json: undefined,
      baseline_json: undefined,
      data: d,
      expired: Boolean(d.valid_until && d.valid_until < ammanToday()),
    },
    published: r.program_id
      ? one(ctx.db, "SELECT * FROM programs WHERE id=?", [r.program_id])
      : null,
    sources: q(
      ctx.db,
      "SELECT id,filename,kind,sha256,bytes,extraction_json,uploaded_by,created_at FROM program_sources WHERE workspace_id=? ORDER BY created_at,id",
      [r.id],
    ).map((s) => ({
      ...s,
      extraction_json: undefined,
      extraction: JSON.parse(s.extraction_json),
    })),
    versions: q(
      ctx.db,
      "SELECT version,revision,sha256,approved_by,approved_at FROM program_versions WHERE workspace_id=? ORDER BY version DESC",
      [r.id],
    ),
    events: q(
      ctx.db,
      "SELECT e.kind,e.reason,e.revision,e.version,e.created_at,u.name AS actor FROM program_events e JOIN users u ON u.id=e.actor_id WHERE e.workspace_id=? ORDER BY e.id DESC LIMIT 100",
      [r.id],
    ),
  });
}
export async function createProgram(ctx) {
  const b = await readJson(ctx.req, 150 * 1024);
  refresh(ctx, "programs:write");
  const reason = why(b),
    slug = String(b.slug || "");
  if (!/^[a-z0-9][a-z0-9-]{2,119}$/.test(slug) || slug === "print")
    throw new HttpError(
      422,
      "الرابط 3–120 حرفًا لاتينيًا صغيرًا أو رقمًا أو شرطة",
    );
  const d = programData(b.data, slug),
    u = unit(ctx, b);
  category(ctx, d.category);
  const id = randomUUID();
  transaction(ctx.db, () => {
    if (
      one(ctx.db, "SELECT 1 FROM program_workspaces WHERE slug=?", [slug]) ||
      one(ctx.db, "SELECT 1 FROM programs WHERE slug=?", [slug])
    )
      throw new HttpError(409, "الرابط مستخدم مسبقًا");
    exec(
      ctx.db,
      "INSERT INTO program_workspaces(id,slug,branch_id,department_id,owner_id,state,draft_json,created_by,created_at,updated_at) VALUES(?,?,?,?,?,'draft',?,?,?,?)",
      [
        id,
        slug,
        u.branch,
        u.department,
        u.owner,
        JSON.stringify(d),
        ctx.user.id,
        now(),
        now(),
      ],
    );
    event(ctx, { id, revision: 1 }, "created", reason);
  });
  return json(ctx.res, 201, { ok: true, id });
}
export async function saveProgram(ctx) {
  const b = await readJson(ctx.req, 150 * 1024);
  refresh(ctx, "programs:write");
  const reason = why(b);
  transaction(ctx.db, () => {
    const r = visible(ctx);
    expected(r, b);
    const d = programData(b.data, r.slug),
      u = unit(ctx, b, r);
    category(ctx, d.category);
    exec(
      ctx.db,
      "UPDATE program_workspaces SET draft_json=?,branch_id=?,department_id=?,owner_id=? WHERE id=?",
      [JSON.stringify(d), u.branch, u.department, u.owner, r.id],
    );
    bump(ctx, r, "draft", reason, "saved");
  });
  return getProgram(ctx);
}
async function change(ctx, action, fn) {
  const b = await readJson(ctx.req, 32 * 1024);
  refresh(ctx, action);
  const reason = why(b);
  transaction(ctx.db, () => {
    const r = visible(ctx);
    expected(r, b);
    fn(r, b, reason);
  });
  return getProgram(ctx);
}
export const submitProgram = (ctx) =>
  change(ctx, "programs:write", (r, b, reason) => {
    if (r.state !== "draft")
      throw new HttpError(409, "أرسل مسودة محفوظة للمراجعة");
    const d = programData(data(ctx, r), r.slug, { complete: true });
    category(ctx, d.category);
    unit(ctx, {}, r);
    bump(ctx, r, "review", reason, "submitted");
  });
export const approveProgram = (ctx) =>
  change(ctx, "programs:approve", (r, b, reason) => {
    if (r.state !== "review")
      throw new HttpError(409, "البرنامج ليس قيد المراجعة");
    const d = programData(data(ctx, r), r.slug, { complete: true });
    category(ctx, d.category);
    unit(ctx, {}, r);
    if (!REVIEW_CHECKS.every((k) => b.checks?.[k] === true))
      throw new HttpError(
        422,
        "راجع المصدر والأسعار والأساس والعملات والتواريخ والشروط صراحة",
      );
    const sources = q(
      ctx.db,
      "SELECT id,sha256,extraction_json FROM program_sources WHERE workspace_id=? ORDER BY id",
      [r.id],
    );
    if (
      !Array.isArray(b.reviewedSourceIds) ||
      JSON.stringify([...b.reviewedSourceIds].sort()) !==
        JSON.stringify(sources.map((s) => s.id).sort())
    )
      throw new HttpError(422, "راجع جميع المصادر الحالية قبل الاعتماد");
    if (
      sources.some((s) => JSON.parse(s.extraction_json).status === "failed") &&
      b.manualExtraction !== true
    )
      throw new HttpError(422, "أكد مراجعة الأصل يدويًا عند فشل الاستخراج");
    const n = one(
      ctx.db,
      "SELECT COALESCE(MAX(version),0)+1 n FROM program_versions WHERE workspace_id=?",
      [r.id],
    ).n;
    const snapshot = JSON.stringify({
      data: d,
      unit: {
        branchId: r.branch_id,
        departmentId: r.department_id,
        ownerId: r.owner_id,
      },
      checks: Object.fromEntries(
        REVIEW_CHECKS.map((key) => [key, b.checks[key]]),
      ),
      sources: sources.map((s) => ({ id: s.id, sha256: s.sha256 })),
      manualExtraction: b.manualExtraction === true,
      reason,
    });
    exec(ctx.db, "INSERT INTO program_versions VALUES(?,?,?,?,?,?,?)", [
      r.id,
      n,
      r.revision,
      snapshot,
      sha(snapshot),
      ctx.user.id,
      now(),
    ]);
    exec(
      ctx.db,
      "UPDATE program_workspaces SET approved_version=? WHERE id=?",
      [n, r.id],
    );
    bump(ctx, r, "approved", reason, "approved", { approved_version: n });
  });
export const publishProgram = (ctx) =>
  change(ctx, "programs:publish", (r, b, reason) => {
    if (r.state !== "approved")
      throw new HttpError(409, "يلزم اعتماد النسخة الحالية قبل النشر");
    const snap = version(ctx, r),
      d = programData(snap.data, r.slug, { complete: true });
    category(ctx, d.category);
    unit(ctx, {}, r);
    if (d.valid_from > ammanToday())
      throw new HttpError(422, "صلاحية السعر لم تبدأ بعد");
    const current = r.program_id
      ? one(ctx.db, "SELECT * FROM programs WHERE id=?", [r.program_id])
      : null;
    if (JSON.stringify(current) !== (r.baseline_json ?? "null"))
      throw new HttpError(
        409,
        "تغير العرض العام خارج المحرر؛ راجع التعارض قبل النشر",
      );
    const selected = d.pricing[d.display_price];
    const values = {
      ...publicValues(d),
      expires_on: d.valid_until,
      price_basis: selected.basis,
      price_occupancy: selected.occupancy,
      status: d.public_status,
      updated_at: now(),
    };
    let pid = r.program_id;
    if (pid) {
      exec(
        ctx.db,
        `UPDATE programs SET ${Object.keys(values)
          .map((k) => k + "=?")
          .join(",")} WHERE id=?`,
        [...Object.values(values), pid],
      );
    } else {
      values.created_at = now();
      pid = Number(
        exec(
          ctx.db,
          `INSERT INTO programs(${Object.keys(values).join(",")}) VALUES(${Object.keys(
            values,
          )
            .map(() => "?")
            .join(",")})`,
          Object.values(values),
        ).lastInsertRowid,
      );
    }
    exec(
      ctx.db,
      "UPDATE program_workspaces SET program_id=?,baseline_json=? WHERE id=?",
      [
        pid,
        JSON.stringify(one(ctx.db, "SELECT * FROM programs WHERE id=?", [pid])),
        r.id,
      ],
    );
    bump(ctx, r, "published", reason, "published");
  });
export const archiveProgram = (ctx) =>
  change(ctx, "programs:publish", (r, b, reason) => {
    if (r.program_id) {
      const p = one(ctx.db, "SELECT * FROM programs WHERE id=?", [
        r.program_id,
      ]);
      if (JSON.stringify(p) !== r.baseline_json)
        throw new HttpError(409, "تغير العرض العام خارج المحرر");
      exec(
        ctx.db,
        "UPDATE programs SET status='archived',updated_at=? WHERE id=?",
        [now(), r.program_id],
      );
      exec(ctx.db, "UPDATE program_workspaces SET baseline_json=? WHERE id=?", [
        JSON.stringify(
          one(ctx.db, "SELECT * FROM programs WHERE id=?", [r.program_id]),
        ),
        r.id,
      ]);
    }
    bump(ctx, r, "archived", reason, "archived");
  });
export function getVersion(ctx) {
  const r = visible(ctx),
    v = one(
      ctx.db,
      "SELECT * FROM program_versions WHERE workspace_id=? AND version=?",
      [r.id, Number(ctx.params.version)],
    );
  if (!v) throw new HttpError(404, "النسخة غير موجودة");
  if (sha(v.snapshot_json) !== v.sha256)
    throw new HttpError(503, "تعذر التحقق من النسخة");
  return json(ctx.res, 200, {
    ok: true,
    version: v.version,
    sha256: v.sha256,
    snapshot: JSON.parse(v.snapshot_json),
    approvedAt: v.approved_at,
    approvedBy: v.approved_by,
  });
}
export async function saveCategory(ctx) {
  const b = await readJson(ctx.req);
  refresh(ctx, "programs:categories");
  const reason = why(b);
  if (
    !/^[a-z0-9][a-z0-9-]{1,79}$/.test(b.key || "") ||
    typeof b.name !== "string" ||
    !b.name.trim() ||
    b.name.length > 100 ||
    typeof b.active !== "boolean"
  )
    throw new HttpError(422, "تصنيف غير صالح");
  transaction(ctx.db, () => {
    exec(
      ctx.db,
      "INSERT INTO program_categories VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET name=excluded.name,active=excluded.active",
      [b.key, b.name.trim(), b.active ? 1 : 0],
    );
    audit(ctx.db, {
      user: ctx.user,
      action: "program.category",
      entity: "program_category",
      entityId: b.key,
      meta: { reason },
      ip: ctx.ip,
    });
  });
  return metadata(ctx);
}
export async function addSource(ctx) {
  const b = await readJson(ctx.req, 7 * 1024 * 1024);
  refresh(ctx, "programs:sources");
  if (!can(ctx.user, "programs:write"))
    throw new HttpError(403, "تحتاج صلاحية تحرير البرنامج");
  const reason = why(b);
  let r = visible(ctx);
  expected(r, b);
  let content, kind, filename, extraction;
  if (b.kind === "text") {
    if (
      typeof b.text !== "string" ||
      b.text.length < 10 ||
      Buffer.byteLength(b.text) > 256 * 1024
    )
      throw new HttpError(422, "النص 10 أحرف إلى 256KiB");
    content = Buffer.from(b.text);
    kind = "text";
    filename = String(b.filename || "manual-source.txt").slice(0, 150);
    extraction = sourceAnalysis(b.text);
  } else {
    if (process.env.PROGRAM_SOURCE_UPLOADS_ENABLED !== "1")
      throw new HttpError(
        503,
        "رفع المصادر مغلق؛ يمكن إدخال النص يدويًا للمراجعة",
      );
    if (uploads >= 1) throw new HttpError(503, "الفحص مشغول؛ حاول لاحقًا");
    if (
      typeof b.base64 !== "string" ||
      !b.base64.length ||
      b.base64.length > 7 * 1024 * 1024 ||
      b.base64.length % 4 ||
      !/^[A-Za-z0-9+/]*={0,2}$/.test(b.base64)
    )
      throw new HttpError(422, "بيانات الملف غير صالحة");
    content = Buffer.from(b.base64, "base64");
    if (
      content.length > 5 * 1024 * 1024 ||
      content.length < 12 ||
      content.toString("base64") !== b.base64
    )
      throw new HttpError(422, "الملف أكبر من 5MiB أو غير صالح");
    filename = String(b.filename || "")
      .replace(/[\x00-\x1f\\/]/g, "_")
      .slice(0, 150);
    kind =
      content.subarray(0, 5).toString() === "%PDF-" &&
      content.subarray(-1024).includes(Buffer.from("%%EOF"))
        ? "pdf"
        : content.subarray(0, 4).equals(Buffer.from("504b0304", "hex"))
          ? "docx"
          : null;
    if (!kind || !filename.toLowerCase().endsWith("." + kind))
      throw new HttpError(422, "يُقبل PDF أو DOCX مطابق لمحتواه فقط");
    uploads++;
    try {
      await scanAttachment(content);
      extraction = await extractProgramSource(content, kind);
    } finally {
      uploads--;
    }
  }
  refresh(ctx, "programs:sources");
  if (!can(ctx.user, "programs:write"))
    throw new HttpError(403, "تغيرت صلاحية التحرير");
  let id = randomUUID();
  transaction(ctx.db, () => {
    r = visible(ctx);
    expected(r, b);
    const hash = sha(content),
      prior = one(
        ctx.db,
        "SELECT id FROM program_sources WHERE workspace_id=? AND sha256=?",
        [r.id, hash],
      );
    if (prior) {
      id = prior.id;
      return;
    }
    const size = one(
      ctx.db,
      "SELECT COUNT(*) n,COALESCE(SUM(bytes),0) total FROM program_sources WHERE workspace_id=?",
      [r.id],
    );
    if (size.n >= 20 || size.total + content.length > 25 * 1024 * 1024)
      throw new HttpError(422, "حد البرنامج 20 مصدرًا و25MiB");
    if (
      one(ctx.db, "SELECT COALESCE(SUM(bytes),0) total FROM program_sources")
        .total +
        content.length >
      100 * 1024 * 1024
    )
      throw new HttpError(507, "مساحة المصادر ممتلئة؛ راجع المسؤول");
    exec(ctx.db, "INSERT INTO program_sources VALUES(?,?,?,?,?,?,?,?,?,?)", [
      id,
      r.id,
      filename,
      kind,
      sha(content),
      content.length,
      content,
      JSON.stringify(extraction),
      ctx.user.id,
      now(),
    ]);
    // Materialize legacy data before moving its workspace into draft; public row remains intact.
    if (!r.draft_json)
      exec(ctx.db, "UPDATE program_workspaces SET draft_json=? WHERE id=?", [
        JSON.stringify(data(ctx, r)),
        r.id,
      ]);
    bump(ctx, r, "draft", reason, "source-added");
  });
  return json(ctx.res, 201, { ok: true, id, extraction });
}
export function downloadSource(ctx) {
  const r = visible(ctx),
    s = one(
      ctx.db,
      "SELECT * FROM program_sources WHERE workspace_id=? AND id=?",
      [r.id, ctx.params.sourceId],
    );
  if (!s) throw new HttpError(404, "المصدر غير موجود");
  if (sha(s.content) !== s.sha256)
    throw new HttpError(503, "فشل تحقق سلامة المصدر");
  audit(ctx.db, {
    user: ctx.user,
    action: "program.source-download",
    entity: "program_source",
    entityId: s.id,
    ip: ctx.ip,
  });
  ctx.res.writeHead(200, {
    "content-type": "application/octet-stream",
    "content-disposition": `attachment; filename="source.${s.kind === "text" ? "txt" : s.kind}"`,
    "cache-control": "private, no-store",
    "x-content-type-options": "nosniff",
    "content-security-policy": "sandbox; default-src 'none'",
    "content-length": s.bytes,
  });
  ctx.res.end(Buffer.from(s.content));
}
export function legacyWriteBlocked(ctx) {
  throw new HttpError(
    409,
    "تحرير البرامج أصبح عبر مساحة البرامج والإصدارات؛ يلزم حفظ ومراجعة واعتماد قبل النشر",
  );
}
