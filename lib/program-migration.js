export const PROGRAM_SCHEMA = `
ALTER TABLE programs ADD COLUMN expires_on TEXT;
ALTER TABLE programs ADD COLUMN price_basis TEXT;
ALTER TABLE programs ADD COLUMN price_occupancy TEXT;
CREATE TABLE program_categories (key TEXT PRIMARY KEY,name TEXT NOT NULL,active INTEGER NOT NULL DEFAULT 1 CHECK(active IN(0,1)));
INSERT INTO program_categories(key,name) SELECT DISTINCT category,category FROM programs;
INSERT OR IGNORE INTO program_categories(key,name) VALUES ('umrah','عمرة'),('istanbul','تركيا'),('sharm','مصر'),('europe','أوروبا'),('asia','شرق آسيا'),('honeymoon','شهر عسل'),('cruise','رحلات بحرية'),('flights','عروض تذاكر'),('hotels','فنادق'),('visa','تأشيرات');
CREATE TABLE program_workspaces (
 id TEXT PRIMARY KEY,program_id INTEGER UNIQUE REFERENCES programs(id),slug TEXT NOT NULL UNIQUE,
 branch_id INTEGER REFERENCES branches(id),department_id INTEGER REFERENCES departments(id),owner_id INTEGER REFERENCES users(id),
 state TEXT NOT NULL CHECK(state IN('draft','review','approved','published','archived')),
 revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),draft_json TEXT CHECK(draft_json IS NULL OR (json_valid(draft_json) AND length(draft_json)<=131072)),
 baseline_json TEXT CHECK(baseline_json IS NULL OR json_valid(baseline_json)),approved_version INTEGER NOT NULL DEFAULT 0,
 created_by INTEGER REFERENCES users(id),created_at TEXT NOT NULL,updated_at TEXT NOT NULL
);
CREATE INDEX program_workspace_scope ON program_workspaces(branch_id,department_id,owner_id,state);
CREATE TABLE program_versions (
 workspace_id TEXT NOT NULL REFERENCES program_workspaces(id),version INTEGER NOT NULL,
 revision INTEGER NOT NULL,snapshot_json TEXT NOT NULL CHECK(json_valid(snapshot_json)),sha256 TEXT NOT NULL,
 approved_by INTEGER NOT NULL REFERENCES users(id),approved_at TEXT NOT NULL,PRIMARY KEY(workspace_id,version)
);
CREATE TABLE program_sources (
 id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL REFERENCES program_workspaces(id),filename TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN('pdf','docx','text')),sha256 TEXT NOT NULL,bytes INTEGER NOT NULL,content BLOB NOT NULL,
 extraction_json TEXT NOT NULL CHECK(json_valid(extraction_json)),uploaded_by INTEGER NOT NULL REFERENCES users(id),created_at TEXT NOT NULL,
 UNIQUE(workspace_id,sha256)
);
CREATE TABLE program_events (
 id INTEGER PRIMARY KEY AUTOINCREMENT,workspace_id TEXT NOT NULL REFERENCES program_workspaces(id),kind TEXT NOT NULL,
 revision INTEGER NOT NULL,version INTEGER NOT NULL DEFAULT 0,actor_id INTEGER NOT NULL REFERENCES users(id),reason TEXT NOT NULL,created_at TEXT NOT NULL
);
CREATE INDEX program_events_workspace ON program_events(workspace_id,id);
CREATE TRIGGER program_workspace_retained BEFORE DELETE ON program_workspaces BEGIN SELECT RAISE(ABORT,'Program workspace is retained'); END;
CREATE TRIGGER program_workspace_identity BEFORE UPDATE OF id,slug,created_by,created_at ON program_workspaces BEGIN SELECT RAISE(ABORT,'Program identity is immutable'); END;
CREATE TRIGGER program_version_immutable BEFORE UPDATE ON program_versions BEGIN SELECT RAISE(ABORT,'Program approval is immutable'); END;
CREATE TRIGGER program_version_retained BEFORE DELETE ON program_versions BEGIN SELECT RAISE(ABORT,'Program approval is retained'); END;
CREATE TRIGGER program_source_immutable BEFORE UPDATE ON program_sources BEGIN SELECT RAISE(ABORT,'Program source is immutable'); END;
CREATE TRIGGER program_source_retained BEFORE DELETE ON program_sources BEGIN SELECT RAISE(ABORT,'Program source is retained'); END;
CREATE TRIGGER program_event_immutable BEFORE UPDATE ON program_events BEGIN SELECT RAISE(ABORT,'Program history is append-only'); END;
CREATE TRIGGER program_event_retained BEFORE DELETE ON program_events BEGIN SELECT RAISE(ABORT,'Program history is retained'); END;
`;
export function installPrograms(db) {
  db.exec(PROGRAM_SCHEMA);
  // Freeze the complete legacy row for conflict detection; do not update its data or permissions.
  const insert = db.prepare(
    "INSERT INTO program_workspaces(id,program_id,slug,state,baseline_json,created_at,updated_at) VALUES(?,?,?, ?,?,?,?)",
  );
  for (const p of db.prepare("SELECT * FROM programs ORDER BY id").all())
    insert.run(
      "legacy-" + p.id,
      p.id,
      p.slug,
      p.status === "archived"
        ? "archived"
        : p.status === "draft"
          ? "draft"
          : "published",
      JSON.stringify(p),
      p.created_at,
      p.updated_at,
    );
  for (const table of [
    "program_categories",
    "program_workspaces",
    "program_versions",
    "program_sources",
    "program_events",
  ])
    for (const operation of ["INSERT", "UPDATE", "DELETE"]) {
      const ref = operation === "DELETE" ? "OLD" : "NEW";
      const id =
        table === "program_categories"
          ? `${ref}.key`
          : table === "program_versions"
            ? `${ref}.workspace_id||':'||${ref}.version`
            : `${ref}.id`;
      db.exec(
        `CREATE TRIGGER audit_${table}_${operation.toLowerCase()} AFTER ${operation} ON ${table} BEGIN INSERT INTO audit_log(user_id,user_name,action,entity,entity_id,reason,ip,created_at) VALUES(audit_actor_id(),audit_actor_name(),'db-${operation.toLowerCase()}','${table}',${id},audit_reason(),audit_actor_ip(),strftime('%Y-%m-%dT%H:%M:%fZ','now')); END;`,
      );
    }
}
