import { opendir, lstat } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { can, sessionUser } from "./auth.js";
import { json, HttpError } from "./http.js";
import { deadlinePolicy } from "./deadlines.js";
import { webhookConfig } from "./webhooks.js";

// Metadata only. A backup file's presence does not prove its integrity or restorability.
export async function backupInventory(dbFile) {
  const result = { state: "unavailable", scannedEntries: 0, matchedFiles: 0,
    truncated: false, latestAt: null, latestBytes: null, restoreVerified: false,
    scheduledBackupVerified: false };
  if (!dbFile || dbFile === ":memory:") return result;
  let dir;
  try {
    const folder = join(dirname(dbFile), "backups");
    // Never follow a symlink to an unrelated backup directory.
    const stat = await lstat(folder);
    if (!stat.isDirectory() || stat.isSymbolicLink()) return result;
    dir = await opendir(folder);
    const prefix = basename(dbFile) + ".before-v";
    for await (const entry of dir) {
      if (result.scannedEntries >= 250) { result.truncated = true; break; }
      result.scannedEntries++;
      const tail = entry.name.slice(prefix.length);
      if (!entry.isFile() || !entry.name.startsWith(prefix) ||
          !/^\d+\.\d+\.[a-f0-9]{8}\.sqlite$/.test(tail)) continue;
      const file = await lstat(join(folder, entry.name));
      if (!file.isFile() || file.isSymbolicLink()) continue;
      result.matchedFiles++;
      const at = file.mtime.toISOString();
      if (!result.latestAt || at > result.latestAt) {
        result.latestAt = at; result.latestBytes = file.size;
      }
    }
    result.state = result.matchedFiles ? "present" : "missing";
  } catch {
    // No filesystem paths, errno details or private filenames leave the server.
    result.state = "unavailable";
  }
  return result;
}

export function workerAttempt(worker, at = Date.now()) {
  worker.lastAttemptAt = new Date(at).toISOString();
  worker.running = true;
}
export function workerFinished(worker, { ok, at = Date.now(), durationMs = 0 }) {
  worker.running = false;
  worker.lastDurationMs = Math.max(0, Math.round(durationMs));
  if (ok) worker.lastSuccessAt = new Date(at).toISOString();
  else worker.lastFailureAt = new Date(at).toISOString();
}
function queue(db, table, column) {
  // The sample is explicit; neither arbitrary SQL nor error/payload columns are exposed.
  const allowed = { webhook_deliveries: "status", whatsapp_outbox: "state", program_sources: "extraction" };
  if (allowed[table] !== column) throw new Error("Invalid health queue");
  const rows = table === "program_sources"
    ? db.prepare("SELECT json_extract(extraction_json,'$.status') AS state FROM (SELECT extraction_json FROM program_sources ORDER BY created_at DESC,id DESC LIMIT 1001)").all()
    : db.prepare(`SELECT ${column} AS state FROM ${table} ORDER BY id DESC LIMIT 1001`).all();
  const states = {};
  for (const row of rows.slice(0, 1000)) {
    const key = ["pending", "processing", "sent", "delivered", "failed", "cancelled",
      "received", "extracted", "reviewed", "rejected", "applied"].includes(row.state) ? row.state : "other";
    states[key] = (states[key] || 0) + 1;
  }
  return { states, sampled: Math.min(rows.length, 1000), limit: 1000, truncated: rows.length > 1000 };
}
export function requireHealthAccess(ctx) {
  const u = ctx.user;
  if (!u) throw new HttpError(401, "يلزم تسجيل الدخول");
  if (u.mustChange || (u.mfaRequired && !u.mfaVerified) || !u.mfaVerified ||
      !can(u, "system:health") || (u.roleKey ? u.dataScope !== "organization" : u.role !== "admin"))
    throw new HttpError(403, "صحة النظام تتطلب صلاحية إدارة المؤسسة والمصادقة الثنائية");
}
export function createSystemHealth({ dbFile, startedAt, workers, whatsappEnabled }) {
  let cached = null, pending = null;
  return async (ctx) => {
    requireHealthAccess(ctx);
    if (!cached || Date.now() - cached.at > 10000) {
      if (!pending) pending = (async () => {
        const backups = await backupInventory(dbFile);
        let policy;
        try { policy = { valid: true, enabled: deadlinePolicy(ctx.db).enabled }; }
        catch { policy = { valid: false, enabled: false }; }
        let deadline;
        try {
          const v = ctx.db.prepare("SELECT value FROM meta WHERE key='operations.deadline-health.v1'").get();
          const r = v ? JSON.parse(v.value) : null;
          deadline = r ? {
            at: Number.isFinite(Date.parse(r.at)) ? new Date(r.at).toISOString() : null,
            examined: Number.isSafeInteger(r.examined) && r.examined >= 0 ? r.examined : null,
            unroutable: Number.isSafeInteger(r.unroutable) && r.unroutable >= 0 ? r.unroutable : null,
          } : null;
        } catch { deadline = null; }
        cached = { at: Date.now(), data: {
          ok: true, generatedAt: new Date().toISOString(), cacheSeconds: 10,
          uptimeSeconds: Math.max(0, Math.floor((Date.now() - startedAt) / 1000)),
          database: {
            schemaVersion: ctx.db.prepare("PRAGMA user_version").get().user_version,
            recordedMigrations: ctx.db.prepare("SELECT COUNT(*) n FROM schema_migrations").get().n,
            lastMigrationAt: ctx.db.prepare("SELECT applied_at FROM schema_migrations ORDER BY version DESC LIMIT 1").get()?.applied_at || null,
            fullIntegrityChecked: false,
          },
          deadlines: { policy, lastRecordedCycle: deadline, worker: { ...workers.deadlines } },
          whatsapp: { enabled: whatsappEnabled, worker: { ...workers.whatsapp }, queue: queue(ctx.db, "whatsapp_outbox", "state") },
          n8n: { configured: webhookConfig().enabled, liveConnectionVerified: false, deliveryMode: "on-event", queue: queue(ctx.db, "webhook_deliveries", "status") },
          files: {
            taskUploadsEnabled: process.env.TASK_ATTACHMENT_UPLOADS_ENABLED === "1",
            programUploadsEnabled: process.env.PROGRAM_SOURCE_UPLOADS_ENABLED === "1",
            scannerLiveVerified: false,
            imports: queue(ctx.db, "program_sources", "extraction"),
            rejectedTaskUploadHistoryAvailable: false,
          }, backups,
        } };
      })().finally(() => { pending = null; });
      await pending;
    }
    // Authorization is checked again after filesystem I/O; no stale response on revoked sessions.
    ctx.user = sessionUser(ctx.db, ctx.token);
    requireHealthAccess(ctx);
    return json(ctx.res, 200, cached.data, { "cache-control": "no-store" });
  };
}
