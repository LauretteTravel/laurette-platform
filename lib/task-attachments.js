import { createHash } from "node:crypto";
import { one, q, exec, transaction } from "./db.js";
import { readJson, json, HttpError } from "./http.js";
import { visibleTask } from "./task-access.js";
import { sessionUser, can } from "./auth.js";
import { scanAttachment } from "./attachment-scan.js";
import { audit } from "./domain.js";
const MAX = 5 * 1024 * 1024;
let inFlight = 0;
function uploadsEnabled() {
  return process.env.TASK_ATTACHMENT_UPLOADS_ENABLED === "1";
}
function requireUploadsEnabled() {
  if (!uploadsEnabled())
    throw new HttpError(503, "رفع المرفقات غير متاح حاليًا");
}
export function detectAttachment(b) {
  if (b.length < 12) throw new HttpError(422, "ملف غير صالح أو غير مدعوم");
  if (
    b.subarray(0, 5).toString() === "%PDF-" &&
    b.subarray(-1024).includes(Buffer.from("%%EOF"))
  )
    return ["application/pdf", "pdf"];
  if (
    b.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex")) &&
    b.length >= 33 &&
    b.subarray(12, 16).toString() === "IHDR"
  ) {
    const w = b.readUInt32BE(16),
      h = b.readUInt32BE(20);
    if (w > 0 && h > 0 && w * h <= 20000000) return ["image/png", "png"];
    throw new HttpError(422, "أبعاد الصورة أكبر من المسموح");
  }
  if (
    b[0] === 255 &&
    b[1] === 216 &&
    b[2] === 255 &&
    b[b.length - 2] === 255 &&
    b[b.length - 1] === 217
  ) {
    let offset = 2;
    while (offset + 8 < b.length) {
      if (b[offset++] !== 255) break;
      while (b[offset] === 255) offset++;
      const marker = b[offset++];
      if (marker === 0xda || marker === 0xd9 || offset + 2 > b.length) break;
      const length = b.readUInt16BE(offset);
      if (length < 2 || offset + length > b.length) break;
      if (
        [
          0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd,
          0xce, 0xcf,
        ].includes(marker)
      ) {
        if(length < 8) break;
        const h = b.readUInt16BE(offset + 3),
          w = b.readUInt16BE(offset + 5);
        if (length >= 8 && w > 0 && h > 0 && w * h <= 20000000)
          return ["image/jpeg", "jpg"];
        break;
      }
      offset += length;
    }
    throw new HttpError(422, "صورة JPEG غير صالحة أو تتجاوز حد الأبعاد");
  }

  if (
    b.subarray(0, 4).toString() === "RIFF" &&
    b.subarray(8, 12).toString() === "WAVE"
  )
    return ["audio/wav", "wav"];
  if (
    b.subarray(0, 4).toString() === "OggS" &&
    (b.includes(Buffer.from("OpusHead")) || b.includes(Buffer.from("vorbis")))
  )
    return ["audio/ogg", "ogg"];
  if (
    b.subarray(0, 3).toString() === "ID3" ||
    (b[0] === 255 && (b[1] & 0xe0) === 0xe0)
  )
    return ["audio/mpeg", "mp3"];
  throw new HttpError(
    422,
    "الأنواع المدعومة: PDF، PNG، JPEG، WAV، MP3، OGG. لا يُقبل تغيير الامتداد فقط",
  );
}
function writableTask(ctx, id) {
  const task = visibleTask(ctx, id);
  if (["done", "cancelled"].includes(task.status))
    throw new HttpError(409, "لا يمكن إرفاق ملفات بمهمة مغلقة");
  return task;
}
export function listAttachments(ctx) {
  visibleTask(ctx);
  return json(ctx.res, 200, {
    ok: true,
    maxBytes: MAX,
    uploadEnabled: uploadsEnabled(),
    attachments: q(
      ctx.db,
      "SELECT id,filename,mime,bytes,sha256,uploaded_by,scanned_at,created_at FROM task_attachments WHERE task_id=? ORDER BY id",
      [Number(ctx.params.id)],
    ),
  });
}
export async function uploadAttachment(ctx) {
  writableTask(ctx);
  requireUploadsEnabled();
  if (inFlight >= 2)
    throw new HttpError(429, "الفحص مشغول؛ أعد المحاولة بعد قليل");
  inFlight++;
  try {
    const body = await readJson(ctx.req, 7 * 1024 * 1024),
      filename = String(body.filename || "")
        .normalize("NFC")
        .trim();
    if (
      !filename ||
      filename.length > 160 ||
      /[\p{Cc}\p{Cf}\\/]/u.test(filename)
    )
      throw new HttpError(422, "اسم الملف غير صالح");
    if (
      typeof body.base64 !== "string" ||
      body.base64.length > Math.ceil(MAX / 3) * 4 ||
      body.base64.length % 4 !== 0 ||
      /[^A-Za-z0-9+/=]/.test(body.base64)
    )
      throw new HttpError(422, "حجم الملف أو ترميزه غير صالح");
    const bytes = Buffer.from(body.base64, "base64");
    if (bytes.toString("base64") !== body.base64)
      throw new HttpError(422, "ترميز الملف غير صالح");
    if (!bytes.length || bytes.length > MAX)
      throw new HttpError(422, "الحد الأقصى5ميغابايت");
    const [mime, ext] = detectAttachment(bytes),
      suffix = filename.split(".").pop().toLowerCase();
    if (
      !{
        pdf: ["pdf"],
        png: ["png"],
        jpg: ["jpg", "jpeg"],
        wav: ["wav"],
        mp3: ["mp3"],
        ogg: ["ogg", "opus"],
      }[ext].includes(suffix)
    )
      throw new HttpError(422, "امتداد الملف لا يطابق محتواه");
    await scanAttachment(bytes);
    // Revalidate authorization after the asynchronous scanner and before any write.
    const user = sessionUser(ctx.db, ctx.token);
    if (!user) throw new HttpError(401, "انتهت الجلسة أثناء الفحص");
    if (
      user.mustChange ||
      (user.mfaRequired && !user.mfaVerified) ||
      !can(user, "tasks:write")
    )
      throw new HttpError(403, "تغيرت صلاحيات الوصول أثناء الفحص");
    requireUploadsEnabled();
    const fresh = { ...ctx, user },
      task = writableTask(fresh, ctx.params.id),
      sha = createHash("sha256").update(bytes).digest("hex");
    const id = transaction(
      ctx.db,
      () => {
        writableTask(fresh, task.id);
        const prior = one(
          ctx.db,
          "SELECT id FROM task_attachments WHERE task_id=? AND sha256=?",
          [task.id, sha],
        );
        if (prior) return prior.id;
        const stats = one(
          ctx.db,
          "SELECT COUNT(*) n,COALESCE(SUM(bytes),0) total FROM task_attachments WHERE task_id=?",
          [task.id],
        );
        if (stats.n >= 20 || stats.total + bytes.length > 50 * 1024 * 1024)
          throw new HttpError(422, "حد المهمة20ملفًا و50ميغابايت");
        if (
          one(ctx.db, "SELECT COALESCE(SUM(bytes),0) n FROM task_attachments")
            .n +
            bytes.length >
          1024 * 1024 * 1024
        )
          throw new HttpError(
            507,
            "مساحة المرفقات المخصصة ممتلئة؛ راجع المسؤول",
          );
        const now = new Date().toISOString(),
          id = Number(
            exec(
              ctx.db,
              "INSERT INTO task_attachments(task_id,filename,mime,bytes,sha256,content,uploaded_by,scanned_at,created_at) VALUES(?,?,?,?,?,?,?,?,?)",
              [
                task.id,
                filename,
                mime,
                bytes.length,
                sha,
                bytes,
                user.id,
                now,
                now,
              ],
            ).lastInsertRowid,
          );
        const eventId = Number(
          exec(
            ctx.db,
            "INSERT INTO task_events(task_id,actor_id,kind,reason,created_at) VALUES(?,?,'attachment','إضافة مرفق مفحوص',?)",
            [task.id, user.id, now],
          ).lastInsertRowid,
        );
        for (const recipient of q(
          ctx.db,
          "SELECT assigned_to AS id FROM tasks WHERE id=? UNION SELECT created_by FROM tasks WHERE id=? UNION SELECT user_id FROM task_members WHERE task_id=?",
          [task.id, task.id, task.id],
        ))
          if (recipient.id !== user.id)
            exec(
              ctx.db,
              "INSERT INTO staff_notifications(user_id,task_id,event_id,kind,created_at) VALUES(?,?,?,'attachment',?)",
              [recipient.id, task.id, eventId, now],
            );
        audit(ctx.db, {
          user,
          action: "attachment.upload",
          entity: "task_attachment",
          entityId: id,
          meta: { taskId: task.id, mime, bytes: bytes.length, sha256: sha },
          ip: ctx.ip,
        });
        return id;
      },
      { immediate: true },
    );
    return json(ctx.res, 201, { ok: true, id });
  } finally {
    inFlight--;
  }
}
export function downloadAttachment(ctx) {
  const row = one(
    ctx.db,
    "SELECT id,task_id,filename,mime,bytes,sha256 FROM task_attachments WHERE id=?",
    [Number(ctx.params.id)],
  );
  if (!row) throw new HttpError(404, "الملف غير موجود");
  visibleTask(ctx, row.task_id);
  const content = Buffer.from(
    one(ctx.db, "SELECT content FROM task_attachments WHERE id=?", [row.id])
      .content,
  );
  if (
    content.length !== row.bytes ||
    createHash("sha256").update(content).digest("hex") !== row.sha256
  )
    throw new HttpError(503, "فشل التحقق من سلامة الملف");
  const inline =
    ctx.query.preview === "1" &&
    (row.mime.startsWith("audio/") || row.mime.startsWith("image/"));
  const headers = {
    "content-type": row.mime,
    "cache-control": "no-store, private",
    "x-content-type-options": "nosniff",
    "content-security-policy": "default-src 'none'; sandbox",
    "content-disposition": `${inline ? "inline" : "attachment"}; filename="attachment"; filename*=UTF-8''${encodeURIComponent(row.filename).replace(/['()*]/g, (c) => "%" + c.charCodeAt(0).toString(16))}`,
    "accept-ranges": "bytes",
    "cross-origin-resource-policy": "same-origin",
    "referrer-policy": "no-referrer",
  };
  let start = 0,
    end = content.length - 1,
    status = 200;
  if (ctx.req.headers.range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(ctx.req.headers.range);
    if (!match || (!match[1] && !match[2])) {
      ctx.res.writeHead(416, { "content-range": `bytes */${content.length}` });
      return ctx.res.end();
    }
    if (!match[1]) start = Math.max(0, content.length - Number(match[2]));
    else {
      start = Number(match[1]);
      if (match[2]) end = Math.min(end, Number(match[2]));
    }
    if (start > end || start >= content.length) {
      ctx.res.writeHead(416, { "content-range": `bytes */${content.length}` });
      return ctx.res.end();
    }
    status = 206;
    headers["content-range"] = `bytes ${start}-${end}/${content.length}`;
  }
  audit(ctx.db, {
    user: ctx.user,
    action: inline ? "attachment.preview" : "attachment.download",
    entity: "task_attachment",
    entityId: row.id,
    meta: { taskId: row.task_id },
    ip: ctx.ip,
  });
  const chunk = content.subarray(start, end + 1);
  ctx.res.writeHead(status, { ...headers, "content-length": chunk.length });
  ctx.res.end(chunk);
}
