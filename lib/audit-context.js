import { AsyncLocalStorage } from "node:async_hooks";
export const auditContext = new AsyncLocalStorage();
export function registerAuditFunctions(db) {
  db.function(
    "audit_actor_id",
    () => auditContext.getStore()?.user?.id ?? null,
  );
  db.function(
    "audit_actor_name",
    () => auditContext.getStore()?.user?.name ?? "system",
  );
  db.function("audit_actor_ip", () => auditContext.getStore()?.ip ?? null);
  db.function(
    "audit_reason",
    () => auditContext.getStore()?.reason ?? "تغيير خادمي موثق",
  );
}
