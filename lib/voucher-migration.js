export const VOUCHER_SCHEMA = `
CREATE TABLE voucher_bookings (
 id TEXT PRIMARY KEY, request_id INTEGER NOT NULL REFERENCES requests(id),
 kind TEXT NOT NULL CHECK(kind IN ('flight','hotel')),
 created_by INTEGER NOT NULL REFERENCES users(id),created_at TEXT NOT NULL
);
CREATE INDEX voucher_bookings_request ON voucher_bookings(request_id);
CREATE TABLE voucher_sequences (
 kind TEXT NOT NULL CHECK(kind IN ('flight','hotel')),year INTEGER NOT NULL,
 last_number INTEGER NOT NULL CHECK(last_number BETWEEN 1 AND 999999),PRIMARY KEY(kind,year)
);
CREATE TABLE employee_vouchers (
 id TEXT PRIMARY KEY,reference TEXT NOT NULL UNIQUE,kind TEXT NOT NULL CHECK(kind IN ('flight','hotel')),
 booking_id TEXT NOT NULL UNIQUE REFERENCES voucher_bookings(id),
 status TEXT NOT NULL CHECK(status IN ('draft','issued','cancelled')),
 draft_json TEXT CHECK(draft_json IS NULL OR (json_valid(draft_json) AND length(draft_json)<=65536)),
 revision INTEGER NOT NULL CHECK(revision>0),current_version INTEGER NOT NULL DEFAULT 0 CHECK(current_version>=0),
 created_by INTEGER NOT NULL REFERENCES users(id),created_at TEXT NOT NULL,updated_at TEXT NOT NULL
);
CREATE INDEX employee_vouchers_archive ON employee_vouchers(status,kind,created_at,id);
CREATE TABLE voucher_versions (
 voucher_id TEXT NOT NULL REFERENCES employee_vouchers(id),version INTEGER NOT NULL CHECK(version>0),
 snapshot_json TEXT NOT NULL CHECK(json_valid(snapshot_json) AND length(snapshot_json)<=524288),
 sha256 TEXT NOT NULL,issued_by INTEGER NOT NULL REFERENCES users(id),issued_at TEXT NOT NULL,
 PRIMARY KEY(voucher_id,version)
);
CREATE TABLE voucher_events (
 id INTEGER PRIMARY KEY AUTOINCREMENT,voucher_id TEXT NOT NULL REFERENCES employee_vouchers(id),
 actor_id INTEGER NOT NULL REFERENCES users(id),kind TEXT NOT NULL,reason TEXT NOT NULL,
 revision INTEGER NOT NULL,created_at TEXT NOT NULL
);
CREATE INDEX voucher_events_voucher ON voucher_events(voucher_id,id);
CREATE TRIGGER voucher_booking_immutable BEFORE UPDATE ON voucher_bookings BEGIN SELECT RAISE(ABORT,'Booking identity is immutable');END;
CREATE TRIGGER voucher_booking_retained BEFORE DELETE ON voucher_bookings BEGIN SELECT RAISE(ABORT,'Booking record is retained');END;
CREATE TRIGGER voucher_identity_immutable BEFORE UPDATE OF id,reference,kind,booking_id,created_by,created_at ON employee_vouchers BEGIN SELECT RAISE(ABORT,'Voucher identity is immutable');END;
CREATE TRIGGER voucher_retained BEFORE DELETE ON employee_vouchers BEGIN SELECT RAISE(ABORT,'Voucher is retained');END;
CREATE TRIGGER voucher_version_order BEFORE INSERT ON voucher_versions WHEN NEW.version!=(SELECT current_version+1 FROM employee_vouchers WHERE id=NEW.voucher_id) BEGIN SELECT RAISE(ABORT,'Voucher version sequence mismatch');END;
CREATE TRIGGER voucher_version_immutable BEFORE UPDATE ON voucher_versions BEGIN SELECT RAISE(ABORT,'Voucher version is immutable');END;
CREATE TRIGGER voucher_version_retained BEFORE DELETE ON voucher_versions BEGIN SELECT RAISE(ABORT,'Voucher version is retained');END;
CREATE TRIGGER voucher_event_immutable BEFORE UPDATE ON voucher_events BEGIN SELECT RAISE(ABORT,'Voucher history is append-only');END;
CREATE TRIGGER voucher_event_retained BEFORE DELETE ON voucher_events BEGIN SELECT RAISE(ABORT,'Voucher history is retained');END;
`;
export function installVouchers(db) {
  db.exec(VOUCHER_SCHEMA);
  // Deliberately no automatic role grants or changes to existing business data.
  for (const table of [
    "voucher_bookings",
    "employee_vouchers",
    "voucher_versions",
    "voucher_events",
  ]) {
    for (const operation of ["INSERT", "UPDATE", "DELETE"]) {
      const ref = operation === "DELETE" ? "OLD" : "NEW";
      const id =
        table === "voucher_versions"
          ? `${ref}.voucher_id||':'||${ref}.version`
          : `${ref}.id`;
      db.exec(`CREATE TRIGGER audit_${table}_${operation.toLowerCase()} AFTER ${operation} ON ${table} BEGIN
        INSERT INTO audit_log(user_id,user_name,action,entity,entity_id,reason,ip,created_at)
        VALUES(audit_actor_id(),audit_actor_name(),'db-${operation.toLowerCase()}','${table}',${id},audit_reason(),audit_actor_ip(),strftime('%Y-%m-%dT%H:%M:%fZ','now'));END;`);
    }
  }
}
