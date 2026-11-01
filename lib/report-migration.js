export const REPORT_SCHEMA = `
CREATE INDEX report_requests_created ON requests(julianday(created_at),branch_id,department_id,assigned_to);
CREATE INDEX report_bookings_confirmed ON bookings(julianday(confirmed_at),request_id);
CREATE INDEX report_payments_created ON booking_payments(julianday(created_at),booking_id);
CREATE INDEX report_customers_created ON customers(julianday(created_at));
CREATE INDEX report_tasks_due ON tasks(julianday(due_at),branch_id,department_id,assigned_to);
CREATE TABLE report_targets (
 id INTEGER PRIMARY KEY AUTOINCREMENT,branch_id INTEGER NOT NULL REFERENCES branches(id),
 department_id INTEGER REFERENCES departments(id),employee_id INTEGER REFERENCES users(id),
 metric TEXT NOT NULL CHECK(metric IN('requests','confirmed_requests','net_receipts')),
 currency TEXT,from_day TEXT NOT NULL,to_day TEXT NOT NULL,value REAL NOT NULL CHECK(value>0),
 active INTEGER NOT NULL DEFAULT 1 CHECK(active IN(0,1)),revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),
 created_by INTEGER NOT NULL REFERENCES users(id),created_at TEXT NOT NULL,updated_at TEXT NOT NULL,
 CHECK((metric='net_receipts' AND currency IS NOT NULL) OR (metric!='net_receipts' AND currency IS NULL))
);
CREATE INDEX report_target_scope ON report_targets(branch_id,department_id,employee_id,from_day,to_day,active);
CREATE TABLE report_target_events (
 id INTEGER PRIMARY KEY AUTOINCREMENT,target_id INTEGER NOT NULL REFERENCES report_targets(id),
 actor_id INTEGER NOT NULL REFERENCES users(id),reason TEXT NOT NULL,before_json TEXT,after_json TEXT NOT NULL,
 revision INTEGER NOT NULL,created_at TEXT NOT NULL
);
CREATE TRIGGER report_target_retained BEFORE DELETE ON report_targets BEGIN SELECT RAISE(ABORT,'Reporting target is retained');END;
CREATE TRIGGER report_target_identity BEFORE UPDATE OF branch_id,department_id,employee_id,metric,currency,from_day,to_day,created_by,created_at ON report_targets BEGIN SELECT RAISE(ABORT,'Target scope and measurement are immutable; deactivate and create a replacement');END;
CREATE TRIGGER report_target_event_immutable BEFORE UPDATE ON report_target_events BEGIN SELECT RAISE(ABORT,'Target history is append-only');END;
CREATE TRIGGER report_target_event_retained BEFORE DELETE ON report_target_events BEGIN SELECT RAISE(ABORT,'Target history is retained');END;
`;
export function installReportTargets(db) {
  db.exec(REPORT_SCHEMA);
  for (const table of ["report_targets", "report_target_events"])
    for (const operation of ["INSERT", "UPDATE", "DELETE"]) {
      const ref = operation === "DELETE" ? "OLD" : "NEW";
      db.exec(
        `CREATE TRIGGER audit_${table}_${operation.toLowerCase()} AFTER ${operation} ON ${table} BEGIN INSERT INTO audit_log(user_id,user_name,action,entity,entity_id,reason,ip,created_at) VALUES(audit_actor_id(),audit_actor_name(),'db-${operation.toLowerCase()}','${table}',${ref}.id,audit_reason(),audit_actor_ip(),strftime('%Y-%m-%dT%H:%M:%fZ','now'));END;`,
      );
    }
}
