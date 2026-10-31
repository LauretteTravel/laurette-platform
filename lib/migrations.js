import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, chmodSync } from "node:fs";
import { dirname, basename, join } from "node:path";
import { DatabaseSync } from "node:sqlite";

export function verifyDatabase(db) {
  if (db.prepare("PRAGMA integrity_check").get().integrity_check !== "ok")
    throw new Error("Database integrity check failed");
  if (db.prepare("PRAGMA foreign_key_check").all().length)
    throw new Error("Database foreign key check failed");
}
export function backupDatabase(db, file, version) {
  const directory = join(dirname(file), "backups");
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const target = join(
    directory,
    `${basename(file)}.before-v${version}.${Date.now()}.${randomBytes(4).toString("hex")}.sqlite`,
  );
  db.prepare("VACUUM INTO ?").run(target);
  chmodSync(target, 0o600);
  const backup = new DatabaseSync(target, { readOnly: true });
  try {
    verifyDatabase(backup);
  } finally {
    backup.close();
  }
  return target;
}
/** Steps are immutable; a changed checksum or a newer database fails closed. */
export function migrateDatabase(db, file, steps) {
  const version = db.prepare("PRAGMA user_version").get().user_version;
  if (version > steps.length)
    throw new Error("Database schema is newer than this application");
  const ledger = Boolean(
    db
      .prepare(
        "SELECT 1 FROM sqlite_master WHERE name='schema_migrations' AND type='table'",
      )
      .get(),
  );
  if (version && !ledger) throw new Error("Migration ledger is missing");
  for (const step of steps.filter((s) => s.version <= version)) {
    const row = db
      .prepare("SELECT checksum FROM schema_migrations WHERE version=?")
      .get(step.version);
    if (!row || row.checksum !== step.checksum)
      throw new Error(`Migration checksum mismatch at version ${step.version}`);
  }
  if (version) {
    const row = db
      .prepare("SELECT schema_hash FROM schema_migrations WHERE version=?")
      .get(version);
    if (row.schema_hash !== schemaHash(db))
      throw new Error("Database schema drift detected");
  }
  verifyDatabase(db);
  const backups = [];
  for (const step of steps.filter((s) => s.version > version)) {
    const populated = Boolean(
      db
        .prepare(
          "SELECT 1 FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' LIMIT 1",
        )
        .get(),
    );
    if (populated && file !== ":memory:")
      backups.push(backupDatabase(db, file, step.version));
    db.exec("PRAGMA foreign_keys=OFF");
    try {
      db.exec("BEGIN IMMEDIATE");
      db.exec(
        "CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, checksum TEXT NOT NULL, applied_at TEXT NOT NULL, schema_hash TEXT NOT NULL)",
      );
      step.up(db);
      verifyDatabase(db);
      db.prepare("INSERT INTO schema_migrations VALUES (?,?,?,?,?)").run(
        step.version,
        step.name,
        step.checksum,
        new Date().toISOString(),
        schemaHash(db),
      );
      db.exec(`PRAGMA user_version=${step.version}`);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    } finally {
      db.exec("PRAGMA foreign_keys=ON");
    }
  }
  return backups;
}
function schemaHash(db) {
  return createHash("sha256")
    .update(
      JSON.stringify(
        db
          .prepare(
            "SELECT type,name,tbl_name,sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY type,name",
          )
          .all(),
      ),
    )
    .digest("hex");
}
export const checksum = (source) =>
  createHash("sha256").update(source).digest("hex");

export const IDENTITY_SCHEMA = `
CREATE TABLE employees (
 user_id INTEGER PRIMARY KEY REFERENCES users(id), employee_no TEXT UNIQUE NOT NULL,
 job_title TEXT NOT NULL DEFAULT '', manager_id INTEGER REFERENCES users(id), hire_date TEXT,
 email TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE staff_memberships (
 id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id),
 role_key TEXT REFERENCES role_definitions(role_key), branch_id INTEGER REFERENCES branches(id),
 department_id INTEGER REFERENCES departments(id), active INTEGER NOT NULL DEFAULT 1 CHECK(active IN(0,1)),
 is_primary INTEGER NOT NULL DEFAULT 0 CHECK(is_primary IN(0,1)), created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX memberships_primary ON staff_memberships(user_id) WHERE is_primary=1;
CREATE UNIQUE INDEX memberships_additional ON staff_memberships(user_id,branch_id,COALESCE(department_id,0)) WHERE is_primary=0;
CREATE INDEX memberships_user_active ON staff_memberships(user_id,active);
CREATE TABLE staff_login_attempts (key_hash TEXT PRIMARY KEY, first_at INTEGER NOT NULL, fails INTEGER NOT NULL);
CREATE TABLE staff_mfa (user_id INTEGER PRIMARY KEY REFERENCES users(id), secret_ciphertext TEXT NOT NULL,
 enabled INTEGER NOT NULL DEFAULT 0, last_step INTEGER NOT NULL DEFAULT -1, recovery_hashes TEXT NOT NULL DEFAULT '[]');
CREATE TABLE staff_mfa_challenges (token_hash TEXT PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id),
 expires_at INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0);
ALTER TABLE sessions ADD COLUMN active_membership_id INTEGER REFERENCES staff_memberships(id);
ALTER TABLE sessions ADD COLUMN mfa_verified_at TEXT;
ALTER TABLE audit_log ADD COLUMN before_json TEXT;
ALTER TABLE audit_log ADD COLUMN after_json TEXT;
ALTER TABLE audit_log ADD COLUMN reason TEXT;
INSERT INTO employees(user_id,employee_no,created_at,updated_at)
 SELECT id,printf('LRT-%06d',id),created_at,created_at FROM users;
INSERT INTO staff_memberships(user_id,role_key,branch_id,department_id,active,is_primary,created_at,updated_at)
 SELECT id,role_key,branch_id,department_id,active,1,created_at,created_at FROM users;
CREATE TRIGGER staff_user_created AFTER INSERT ON users BEGIN
 INSERT INTO employees(user_id,employee_no,created_at,updated_at) VALUES(NEW.id,printf('LRT-%06d',NEW.id),NEW.created_at,NEW.created_at);
 INSERT INTO staff_memberships(user_id,role_key,branch_id,department_id,active,is_primary,created_at,updated_at)
 VALUES(NEW.id,NEW.role_key,NEW.branch_id,NEW.department_id,NEW.active,1,NEW.created_at,NEW.created_at);
END;
CREATE TRIGGER staff_user_context AFTER UPDATE OF role_key,branch_id,department_id,active ON users
WHEN OLD.role_key IS NOT NEW.role_key OR OLD.branch_id IS NOT NEW.branch_id OR OLD.department_id IS NOT NEW.department_id OR OLD.active IS NOT NEW.active BEGIN
 UPDATE staff_memberships SET role_key=NEW.role_key,branch_id=NEW.branch_id,department_id=NEW.department_id,
 active=NEW.active,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE user_id=NEW.id AND is_primary=1;
 DELETE FROM sessions WHERE user_id=NEW.id;
 DELETE FROM staff_mfa_challenges WHERE user_id=NEW.id;
END;
CREATE TRIGGER staff_user_password AFTER UPDATE OF password_hash,password_salt ON users BEGIN
 DELETE FROM sessions WHERE user_id=NEW.id; DELETE FROM staff_mfa_challenges WHERE user_id=NEW.id;
END;
CREATE TRIGGER audit_no_update BEFORE UPDATE ON audit_log BEGIN SELECT RAISE(ABORT,'Audit entries are append-only');END;
CREATE TRIGGER audit_no_delete BEFORE DELETE ON audit_log BEGIN SELECT RAISE(ABORT,'Audit entries are append-only');END;
`;
export const grantExpansion = {
  "users:write": ["users:admin"],
  "requests:write": [
    "requests:assign",
    "requests:transfer",
    "requests:approve",
  ],
  "reports:read": ["reports:export"],
  "programs:write": ["programs:delete"],
  "content:write": ["content:delete"],
  "visa:write": ["visa:delete"],
  "kb:write": ["kb:delete"],
};
export const NEW_ROLES = [
  [
    "general_manager",
    "مدير عام",
    "manager",
    "organization",
    [
      "overview:read",
      "requests:read",
      "requests:write",
      "requests:assign",
      "requests:transfer",
      "requests:approve",
      "customers:read",
      "customers:write",
      "reports:read",
      "reports:export",
      "organization:read",
    ],
  ],
  [
    "finance",
    "محاسب",
    "agent",
    "organization",
    ["overview:read", "reports:read", "reports:export"],
  ],
  [
    "auditor",
    "مدقق",
    "agent",
    "organization",
    ["audit:read", "audit:export", "reports:read"],
  ],
  ["reports_viewer", "قارئ تقارير", "agent", "organization", ["reports:read"]],
];
export function installIdentity(db) {
  db.exec(IDENTITY_SCHEMA);
  // Preserve existing grants: new action codes split capabilities already granted by the old write/export actions.
  for (const row of db
    .prepare("SELECT role_key,permissions FROM role_definitions")
    .all()) {
    const grants = JSON.parse(row.permissions);
    const expanded = [
      ...new Set([
        ...grants,
        ...grants.flatMap((p) => grantExpansion[p] || []),
      ]),
    ];
    db.prepare(
      "UPDATE role_definitions SET permissions=? WHERE role_key=?",
    ).run(JSON.stringify(expanded), row.role_key);
  }
  const now = new Date().toISOString();
  for (const [key, name, base, scope, grants] of NEW_ROLES)
    db.prepare(
      "INSERT OR IGNORE INTO role_definitions VALUES (?,?,?,?,?,1,?,?)",
    ).run(key, name, base, scope, JSON.stringify(grants), now, now);
  // An allowlist prevents credential material, request payloads and client contact data entering database diffs.
  const fields = {
    users: [
      "id",
      "username",
      "name",
      "role",
      "role_key",
      "branch_id",
      "department_id",
      "active",
      "must_change",
    ],
    requests: [
      "id",
      "reference",
      "status",
      "deal_status",
      "assigned_to",
      "branch_id",
      "department_id",
      "sales_owner_id",
      "service_owner_id",
      "execution_owner_id",
      "quote_amount",
      "quote_currency",
    ],
    customers: ["id", "name", "preference", "country"],
    branches: ["id", "code", "name", "active"],
    departments: ["id", "name", "branch_id", "active"],
    role_definitions: [
      "role_key",
      "name",
      "base_role",
      "data_scope",
      "permissions",
      "active",
    ],
    employees: [
      "user_id",
      "employee_no",
      "job_title",
      "manager_id",
      "hire_date",
    ],
    staff_memberships: [
      "id",
      "user_id",
      "role_key",
      "branch_id",
      "department_id",
      "active",
      "is_primary",
    ],
  };
  for (const [table, columns] of Object.entries(fields))
    for (const [operation, old, next] of [
      ["INSERT", false, true],
      ["UPDATE", true, true],
      ["DELETE", true, false],
    ]) {
      const json = (alias) =>
        `json_object(${columns.flatMap((c) => [`'${c}'`, `${alias}.${c}`]).join(",")})`;
      const ref = next ? "NEW" : "OLD",
        id = columns[0];
      db.exec(`CREATE TRIGGER audit_${table}_${operation.toLowerCase()} AFTER ${operation} ON ${table} BEGIN
   INSERT INTO audit_log(user_id,user_name,action,entity,entity_id,before_json,after_json,reason,ip,created_at)
   VALUES(audit_actor_id(),audit_actor_name(),'db-${operation.toLowerCase()}','${table}',${ref}.${id},${old ? json("OLD") : "NULL"},${next ? json("NEW") : "NULL"},audit_reason(),audit_actor_ip(),strftime('%Y-%m-%dT%H:%M:%fZ','now')); END;`);
    }
}
