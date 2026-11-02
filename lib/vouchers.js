import { randomUUID, createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { one, q, exec, transaction, setting } from "./db.js";
import { can, sessionUser } from "./auth.js";
import { requestScope } from "./api.js";
import { HttpError, json, readJson } from "./http.js";
import { audit } from "./domain.js";
import { voucherData } from "./voucher-data.js";
import { voucherDocument } from "./voucher-document.js";

const FROM =
  "FROM employee_vouchers v JOIN voucher_bookings b ON b.id=v.booking_id JOIN requests r ON r.id=b.request_id";
const sha = (value) => createHash("sha256").update(value).digest("hex");
function refreshActor(ctx, action) {
  const user = sessionUser(ctx.db, ctx.token);
  if (!user) throw new HttpError(401, "انتهت الجلسة أثناء إرسال البيانات");
  if (
    user.mustChange ||
    (user.mfaRequired && !user.mfaVerified) ||
    !can(user, action)
  )
    throw new HttpError(403, "تغيرت صلاحيات الوصول أثناء إرسال البيانات");
  ctx.user = user;
}
function scope(ctx) {
  if (!can(ctx.user, "vouchers:read") || !can(ctx.user, "requests:read"))
    throw new HttpError(403, "تحتاج صلاحية القسائم وقراءة الطلبات");
  const s = requestScope(ctx.user);
  if (ctx.user.roleKey && ctx.user.dataScope === "assigned") {
    if (!ctx.user.branchId) return { sql: "0", params: [] };
    return {
      sql: `${s.sql} AND r.branch_id=? AND r.department_id IS ?`,
      params: [...s.params, ctx.user.branchId, ctx.user.departmentId],
    };
  }
  return { sql: s.sql || "1", params: s.params };
}
function linkedRequest(ctx, id) {
  const s = scope(ctx);
  const row = one(
    ctx.db,
    `SELECT r.* FROM requests r WHERE r.id=? AND ${s.sql}`,
    [Number(id), ...s.params],
  );
  if (!row) throw new HttpError(404, "الطلب غير موجود في نطاقك الحالي");
  return row;
}
function visible(ctx) {
  const s = scope(ctx),
    row = one(
      ctx.db,
      `SELECT v.*,b.request_id,r.reference AS request_reference,r.status AS request_status ${FROM} WHERE v.id=? AND ${s.sql}`,
      [String(ctx.params.id), ...s.params],
    );
  if (!row) throw new HttpError(404, "القسيمة غير موجودة");
  return row;
}
function reason(body) {
  if (
    typeof body.reason !== "string" ||
    body.reason.trim().length < 3 ||
    body.reason.length > 500
  )
    throw new HttpError(422, "سبب العملية مطلوب (3–500 حرف)");
  return body.reason.trim();
}
function revision(row, body) {
  if (!Number.isInteger(body.revision) || body.revision !== row.revision)
    throw new HttpError(
      409,
      "تغيرت القسيمة؛ أعد تحميل النسخة الحالية قبل المتابعة",
    );
}
function event(ctx, row, kind, why, now) {
  exec(
    ctx.db,
    "INSERT INTO voucher_events(voucher_id,actor_id,kind,reason,revision,created_at) VALUES(?,?,?,?,?,?)",
    [row.id, ctx.user.id, kind, why, row.revision, now],
  );
  audit(ctx.db, {
    user: ctx.user,
    action: "voucher." + kind,
    entity: "employee_voucher",
    entityId: row.id,
    meta: { revision: row.revision, version: row.current_version, reason: why },
    ip: ctx.ip,
  });
}
function snapshot(row) {
  if (!row || sha(row.snapshot_json) !== row.sha256)
    throw new HttpError(503, "تعذر التحقق من سلامة نسخة القسيمة");
  return JSON.parse(row.snapshot_json);
}
export function getVoucher(ctx) {
  const row = visible(ctx);
  const versions = q(
    ctx.db,
    "SELECT version,sha256,issued_by,issued_at FROM voucher_versions WHERE voucher_id=? ORDER BY version DESC",
    [row.id],
  );
  const published = row.current_version
    ? snapshot(
        one(
          ctx.db,
          "SELECT * FROM voucher_versions WHERE voucher_id=? AND version=?",
          [row.id, row.current_version],
        ),
      )
    : null;
  return json(ctx.res, 200, {
    ok: true,
    voucher: {
      ...row,
      draft_json: undefined,
      data: row.draft_json ? JSON.parse(row.draft_json) : published?.data,
      hasDraft: row.draft_json !== null,
    },
    versions,
    events: q(
      ctx.db,
      "SELECT e.id,e.kind,e.reason,e.revision,e.created_at,u.name AS actor FROM voucher_events e JOIN users u ON u.id=e.actor_id WHERE e.voucher_id=? ORDER BY e.id DESC LIMIT 100",
      [row.id],
    ),
  });
}
function dateBoundary(value) {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString().slice(0, 10) !== value
  )
    throw new HttpError(422, "تاريخ الأرشيف غير صالح");
  const target = Date.parse(value + "T00:00:00Z");
  let ms = target;
  for (let i = 0; i < 3; i++) {
    const p = Object.fromEntries(
      new Intl.DateTimeFormat("en-GB", {
        timeZone: "Asia/Amman",
        hourCycle: "h23",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      })
        .formatToParts(new Date(ms))
        .map((x) => [x.type, x.value]),
    );
    ms +=
      target -
      Date.UTC(
        Number(p.year),
        Number(p.month) - 1,
        Number(p.day),
        Number(p.hour),
        Number(p.minute),
        Number(p.second),
      );
  }
  return new Date(ms).toISOString();
}
export function listVouchers(ctx) {
  const query = new URLSearchParams(ctx.query);
  const s = scope(ctx),
    where = [s.sql],
    params = [...s.params],
    page = Number(query.get("page") || 1);
  if (!Number.isInteger(page) || page < 1 || page > 100000)
    throw new HttpError(422, "صفحة غير صالحة");
  for (const [key, allowed] of [
    ["kind", ["flight", "hotel"]],
    ["status", ["draft", "issued", "cancelled"]],
  ]) {
    const value = query.get(key);
    if (!value) continue;
    if (!allowed.includes(value))
      throw new HttpError(422, "مرشح الأرشيف غير صالح");
    if (key === "status" && value === "draft")
      where.push("v.draft_json IS NOT NULL AND v.status!='cancelled'");
    else {
      where.push(`v.${key}=?`);
      params.push(value);
    }
  }
  const from = query.get("from"),
    to = query.get("to");
  if (from) {
    where.push("v.created_at>=?");
    params.push(dateBoundary(from));
  }
  if (to) {
    dateBoundary(to);
    // Derive the next calendar date, then resolve its own timezone boundary.
    const next = new Date(Date.parse(to + "T00:00:00Z") + 86400000)
      .toISOString()
      .slice(0, 10);
    where.push("v.created_at<?");
    params.push(dateBoundary(next));
  }
  if (from && to && from > to)
    throw new HttpError(422, "فترة الأرشيف غير صالحة");
  const search = (query.get("q") || "").trim();
  if (search.length > 100) throw new HttpError(422, "نص البحث طويل");
  if (search) {
    where.push(
      `(v.reference LIKE ? OR r.reference LIKE ? OR EXISTS(SELECT 1 FROM json_each(CASE WHEN v.draft_json IS NOT NULL THEN json_extract(v.draft_json,'$.people') ELSE json_extract((SELECT snapshot_json FROM voucher_versions x WHERE x.voucher_id=v.id AND x.version=v.current_version),'$.data.people') END) person WHERE json_extract(person.value,'$.name') LIKE ?) OR EXISTS(SELECT 1 FROM customers c WHERE c.id=r.customer_id AND c.name LIKE ?) OR (CASE WHEN json_valid(r.payload) THEN json_extract(r.payload,'$.name') ELSE '' END) LIKE ?)`,
    );
    params.push(...Array(5).fill("%" + search + "%"));
  }
  const sql = where.join(" AND "),
    total = one(ctx.db, `SELECT COUNT(*) n ${FROM} WHERE ${sql}`, params).n;
  const vouchers = q(
    ctx.db,
    `SELECT v.id,v.reference,v.kind,v.status,v.revision,v.current_version,v.created_at,v.updated_at,(v.draft_json IS NOT NULL) AS has_draft,r.reference AS request_reference ${FROM} WHERE ${sql} ORDER BY v.created_at DESC,v.id LIMIT 25 OFFSET ?`,
    [...params, (page - 1) * 25],
  );
  return json(ctx.res, 200, {
    ok: true,
    vouchers,
    total,
    page,
    pages: Math.max(1, Math.ceil(total / 25)),
  });
}
export async function createVoucher(ctx) {
  const body = await readJson(ctx.req, 65536);
  refreshActor(ctx, "vouchers:write");
  const request = linkedRequest(ctx, body.requestId);
  if (request.status === "cancelled")
    throw new HttpError(409, "لا تنشئ قسيمة لطلب ملغى");
  const data = voucherData(body.kind, body.data),
    why = reason(body),
    now = new Date().toISOString();
  const result = transaction(
    ctx.db,
    () => {
      linkedRequest(ctx, request.id);
      const year = Number(
        new Intl.DateTimeFormat("en", {
          timeZone: "Asia/Amman",
          year: "numeric",
        }).format(new Date(now)),
      );
      exec(
        ctx.db,
        "INSERT INTO voucher_sequences(kind,year,last_number) VALUES(?,?,1) ON CONFLICT(kind,year) DO UPDATE SET last_number=last_number+1",
        [body.kind, year],
      );
      const sequence = one(
        ctx.db,
        "SELECT last_number FROM voucher_sequences WHERE kind=? AND year=?",
        [body.kind, year],
      ).last_number;
      const id = randomUUID(),
        booking = randomUUID(),
        reference = `LRT-${body.kind === "flight" ? "FLT" : "HTL"}-${year}-${String(sequence).padStart(6, "0")}`;
      exec(
        ctx.db,
        "INSERT INTO voucher_bookings(id,request_id,kind,created_by,created_at) VALUES(?,?,?,?,?)",
        [booking, request.id, body.kind, ctx.user.id, now],
      );
      exec(
        ctx.db,
        "INSERT INTO employee_vouchers(id,reference,kind,booking_id,status,draft_json,revision,created_by,created_at,updated_at) VALUES(?,?,?,?,'draft',?,1,?,?,?)",
        [
          id,
          reference,
          body.kind,
          booking,
          JSON.stringify(data),
          ctx.user.id,
          now,
          now,
        ],
      );
      event(ctx, { id, revision: 1, current_version: 0 }, "created", why, now);
      return { id, reference };
    },
    { immediate: true },
  );
  return json(ctx.res, 201, { ok: true, ...result });
}
export async function saveVoucher(ctx) {
  const body = await readJson(ctx.req, 65536);
  refreshActor(ctx, "vouchers:write");
  const old = visible(ctx);
  revision(old, body);
  if (old.status === "cancelled" || old.draft_json === null)
    throw new HttpError(409, "ابدأ مراجعة جديدة قبل تعديل القسيمة المنشورة");
  const data = voucherData(old.kind, body.data),
    why = reason(body),
    now = new Date().toISOString();
  transaction(
    ctx.db,
    () => {
      const row = visible(ctx);
      revision(row, body);
      exec(
        ctx.db,
        "UPDATE employee_vouchers SET draft_json=?,revision=revision+1,updated_at=? WHERE id=?",
        [JSON.stringify(data), now, row.id],
      );
      event(
        ctx,
        { ...row, revision: row.revision + 1 },
        "draft_saved",
        why,
        now,
      );
    },
    { immediate: true },
  );
  return json(ctx.res, 200, { ok: true });
}
export async function startRevision(ctx) {
  const body = await readJson(ctx.req, 4096);
  refreshActor(ctx, "vouchers:write");
  const why = reason(body),
    now = new Date().toISOString();
  transaction(
    ctx.db,
    () => {
      const row = visible(ctx);
      revision(row, body);
      if (row.status !== "issued" || row.draft_json !== null)
        throw new HttpError(409, "لا يمكن بدء مراجعة أخرى");
      if (row.current_version >= 50)
        throw new HttpError(422, "وصلت القسيمة إلى حد 50 نسخة؛ راجع المسؤول");
      const data = snapshot(
        one(
          ctx.db,
          "SELECT * FROM voucher_versions WHERE voucher_id=? AND version=?",
          [row.id, row.current_version],
        ),
      ).data;
      exec(
        ctx.db,
        "UPDATE employee_vouchers SET draft_json=?,revision=revision+1,updated_at=? WHERE id=?",
        [JSON.stringify(data), now, row.id],
      );
      event(
        ctx,
        { ...row, revision: row.revision + 1 },
        "revision_started",
        why,
        now,
      );
    },
    { immediate: true },
  );
  return json(ctx.res, 200, { ok: true });
}
function brandSnapshot(db) {
  const current = {
    brandShort: setting(db, "brandShort", "Laurette Travel"),
    whatsapp: setting(db, "whatsapp", ""),
    email: setting(db, "email", ""),
  };
  // Fixed owned asset, never an arbitrary URL or uploaded customer file.
  return {
    name: String(current.brandShort || "Laurette Travel").slice(0, 150),
    phone: String(current.whatsapp || "").slice(0, 80),
    email: String(current.email || "").slice(0, 254),
    logo:
      "data:image/png;base64," +
      readFileSync(
        new URL("../public/assets/img/laurette-logo.png", import.meta.url),
      ).toString("base64"),
  };
}
export async function issueVoucher(ctx) {
  const body = await readJson(ctx.req, 4096);
  refreshActor(ctx, "vouchers:issue");
  const why = reason(body),
    now = new Date().toISOString();
  transaction(
    ctx.db,
    () => {
      const row = visible(ctx);
      revision(row, body);
      if (
        row.status === "cancelled" ||
        row.draft_json === null ||
        row.current_version >= 50
      )
        throw new HttpError(409, "لا توجد مسودة قابلة للإصدار");
      if (row.request_status !== "confirmed")
        throw new HttpError(
          409,
          "يجب تأكيد الطلب من دورة الحجز أولًا؛ إصدار القسيمة لا يؤكد الطلب تلقائيًا",
        );
      const data = voucherData(row.kind, JSON.parse(row.draft_json), {
          issuing: true,
        }),
        version = row.current_version + 1;
      const saved = JSON.stringify({
        format: 1,
        kind: row.kind,
        reference: row.reference,
        bookingId: row.booking_id,
        requestReference: row.request_reference,
        issuedAt: now,
        version,
        confirmation: "confirmed",
        data,
        brand: brandSnapshot(ctx.db),
      });
      exec(
        ctx.db,
        "INSERT INTO voucher_versions(voucher_id,version,snapshot_json,sha256,issued_by,issued_at) VALUES(?,?,?,?,?,?)",
        [row.id, version, saved, sha(saved), ctx.user.id, now],
      );
      exec(
        ctx.db,
        "UPDATE employee_vouchers SET status='issued',draft_json=NULL,current_version=?,revision=revision+1,updated_at=? WHERE id=?",
        [version, now, row.id],
      );
      event(
        ctx,
        { ...row, current_version: version, revision: row.revision + 1 },
        "issued",
        why,
        now,
      );
    },
    { immediate: true },
  );
  return json(ctx.res, 200, { ok: true });
}
export async function cancelVoucher(ctx) {
  const body = await readJson(ctx.req, 4096);
  refreshActor(ctx, "vouchers:cancel");
  const why = reason(body),
    now = new Date().toISOString();
  transaction(
    ctx.db,
    () => {
      const row = visible(ctx);
      revision(row, body);
      if (row.status === "cancelled")
        throw new HttpError(409, "القسيمة ملغاة بالفعل");
      exec(
        ctx.db,
        "UPDATE employee_vouchers SET status='cancelled',revision=revision+1,updated_at=? WHERE id=?",
        [now, row.id],
      );
      event(ctx, { ...row, revision: row.revision + 1 }, "cancelled", why, now);
    },
    { immediate: true },
  );
  return json(ctx.res, 200, { ok: true });
}
export function getVersion(ctx) {
  const row = visible(ctx),
    version = Number(ctx.params.version);
  if (!Number.isInteger(version) || version < 1)
    throw new HttpError(404, "النسخة غير موجودة");
  const saved = one(
    ctx.db,
    "SELECT * FROM voucher_versions WHERE voucher_id=? AND version=?",
    [row.id, version],
  );
  if (!saved) throw new HttpError(404, "النسخة غير موجودة");
  const data = snapshot(saved);
  const state =
    row.status === "cancelled" || row.request_status === "cancelled"
      ? "cancelled"
      : version !== row.current_version
        ? "superseded"
        : row.request_status !== "confirmed"
          ? "review"
          : "confirmed";
  audit(ctx.db, {
    user: ctx.user,
    action: "voucher.document",
    entity: "employee_voucher",
    entityId: row.id,
    meta: { version, state },
    ip: ctx.ip,
  });
  const body = voucherDocument(data, state);
  ctx.res.writeHead(200, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "private, no-store",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    "x-frame-options": "DENY",
    "content-security-policy":
      "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src 'self'; frame-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  });
  ctx.res.end(body);
}
