import { one, transaction } from './db.js';

// Versioned additive migration; only bookings' CHECK is widened. Preserve IDs,
// dependent payment rows, indexes and triggers using SQLite's table-copy recipe.
export function migrateWorkspace(db) {
  if (one(db, "SELECT value FROM meta WHERE key = 'workspace_schema'")?.value === '1') return;
  db.exec('PRAGMA foreign_keys = OFF');
  try {
    transaction(db, () => {
      const old = one(db, "SELECT sql FROM sqlite_master WHERE name = 'bookings'").sql;
      if (!old.includes("'pending'")) {
        const dependents = db.prepare("SELECT sql FROM sqlite_master WHERE tbl_name = 'bookings' AND type IN ('index','trigger') AND sql IS NOT NULL").all();
        db.exec(old.replace(/CREATE TABLE bookings/i, 'CREATE TABLE bookings_workspace_new').replace("('confirmed','cancelled')", "('pending','confirmed','cancelled')"));
        db.exec('INSERT INTO bookings_workspace_new SELECT * FROM bookings');
        db.exec('DROP TABLE bookings');
        db.exec('ALTER TABLE bookings_workspace_new RENAME TO bookings');
        for (const { sql } of dependents) db.exec(sql);
      }
      db.exec(`
        CREATE TABLE workspace_templates (
          id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, content TEXT NOT NULL,
          created_by INTEGER REFERENCES users(id), created_at TEXT NOT NULL
        );
        CREATE TABLE workspace_offers (
          id INTEGER PRIMARY KEY, request_id INTEGER NOT NULL REFERENCES requests(id),
          token TEXT NOT NULL UNIQUE, reference TEXT NOT NULL UNIQUE,
          content TEXT NOT NULL, selling_price REAL NOT NULL CHECK(selling_price >= 0),
          supplier_cost REAL CHECK(supplier_cost >= 0), currency TEXT NOT NULL,
          active INTEGER NOT NULL DEFAULT 1, created_by INTEGER REFERENCES users(id),
          created_at TEXT NOT NULL, updated_at TEXT NOT NULL
        );
        CREATE INDEX workspace_offers_request ON workspace_offers(request_id, id DESC);
        CREATE TABLE workspace_booking_details (
          booking_id INTEGER PRIMARY KEY REFERENCES bookings(id),
          offer_id INTEGER NOT NULL UNIQUE REFERENCES workspace_offers(id),
          snapshot TEXT NOT NULL, pnr TEXT NOT NULL DEFAULT '', supplier_reference TEXT NOT NULL DEFAULT '',
          hotel_confirmation TEXT NOT NULL DEFAULT '', internal_notes TEXT NOT NULL DEFAULT ''
        );
        CREATE INDEX workspace_booking_pnr ON workspace_booking_details(pnr);
        CREATE TABLE workspace_notifications (
          id INTEGER PRIMARY KEY, request_id INTEGER NOT NULL REFERENCES requests(id),
          kind TEXT NOT NULL, message TEXT NOT NULL, created_at TEXT NOT NULL
        );
        CREATE INDEX workspace_notifications_request ON workspace_notifications(request_id, id DESC);
        CREATE TABLE workspace_notification_reads (
          notification_id INTEGER REFERENCES workspace_notifications(id), user_id INTEGER REFERENCES users(id),
          PRIMARY KEY(notification_id,user_id)
        );
        CREATE TABLE workspace_vouchers (
          id INTEGER PRIMARY KEY, booking_id INTEGER NOT NULL REFERENCES bookings(id),
          kind TEXT NOT NULL CHECK(kind IN ('flight','hotel','package')), snapshot TEXT NOT NULL,
          created_by INTEGER REFERENCES users(id), created_at TEXT NOT NULL, UNIQUE(booking_id,kind)
        );
        CREATE INDEX workspace_request_owner ON requests(assigned_to, created_at DESC);
        CREATE INDEX workspace_request_scope ON requests(branch_id, department_id, created_at DESC);
        INSERT INTO meta(key,value) VALUES('workspace_schema','1');
      `);
      if (db.prepare('PRAGMA foreign_key_check').all().length) throw new Error('Workspace migration foreign key check failed');
    });
  } finally { db.exec('PRAGMA foreign_keys = ON'); }
}
