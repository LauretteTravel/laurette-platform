export const TASK_SCHEMA = `
CREATE TABLE tasks (
 id INTEGER PRIMARY KEY AUTOINCREMENT, branch_id INTEGER NOT NULL REFERENCES branches(id),
 department_id INTEGER REFERENCES departments(id), request_id INTEGER REFERENCES requests(id),
 title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', priority TEXT NOT NULL CHECK(priority IN ('low','normal','high','urgent')),
 status TEXT NOT NULL DEFAULT 'new' CHECK(status IN ('new','in_progress','waiting','review','done','cancelled')),
 assigned_to INTEGER NOT NULL REFERENCES users(id), created_by INTEGER NOT NULL REFERENCES users(id),
 due_at TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX tasks_scope ON tasks(branch_id,department_id,status,due_at);
CREATE INDEX tasks_owner ON tasks(assigned_to,status,due_at);
CREATE TABLE task_members(task_id INTEGER NOT NULL REFERENCES tasks(id),user_id INTEGER NOT NULL REFERENCES users(id),PRIMARY KEY(task_id,user_id));
CREATE TABLE task_events(id INTEGER PRIMARY KEY AUTOINCREMENT,task_id INTEGER NOT NULL REFERENCES tasks(id),actor_id INTEGER REFERENCES users(id),kind TEXT NOT NULL,reason TEXT NOT NULL,before_json TEXT,after_json TEXT,created_at TEXT NOT NULL);
CREATE INDEX task_events_task ON task_events(task_id,id);
CREATE TABLE task_comments(id INTEGER PRIMARY KEY AUTOINCREMENT,task_id INTEGER NOT NULL REFERENCES tasks(id),user_id INTEGER NOT NULL REFERENCES users(id),body TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE TABLE task_checklist(id INTEGER PRIMARY KEY AUTOINCREMENT,task_id INTEGER NOT NULL REFERENCES tasks(id),title TEXT NOT NULL,done INTEGER NOT NULL DEFAULT 0 CHECK(done IN(0,1)),version INTEGER NOT NULL DEFAULT 1,updated_by INTEGER NOT NULL REFERENCES users(id),created_at TEXT NOT NULL);
CREATE TABLE staff_notifications(id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER NOT NULL REFERENCES users(id),task_id INTEGER NOT NULL REFERENCES tasks(id),event_id INTEGER NOT NULL REFERENCES task_events(id),kind TEXT NOT NULL,created_at TEXT NOT NULL,read_at TEXT,UNIQUE(user_id,event_id));
CREATE INDEX staff_notifications_recipient ON staff_notifications(user_id,read_at,id);
CREATE TRIGGER task_events_no_update BEFORE UPDATE ON task_events BEGIN SELECT RAISE(ABORT,'Task history is append-only'); END;
CREATE TRIGGER task_events_no_delete BEFORE DELETE ON task_events BEGIN SELECT RAISE(ABORT,'Task history is append-only'); END;
CREATE TRIGGER task_comments_no_update BEFORE UPDATE ON task_comments BEGIN SELECT RAISE(ABORT,'Task comments are append-only'); END;
CREATE TRIGGER task_comments_no_delete BEFORE DELETE ON task_comments BEGIN SELECT RAISE(ABORT,'Task comments are append-only'); END;
`;
// This migration is frozen once deployed, like migrations 1 and 2.
export function installTasks(db) {
  db.exec(TASK_SCHEMA);
  for (const row of db
    .prepare("SELECT role_key,permissions FROM role_definitions")
    .all()) {
    const grants = JSON.parse(row.permissions);
    const extra = [];
    if (grants.includes("requests:read")) extra.push("tasks:read");
    if (grants.includes("requests:write")) extra.push("tasks:write");
    if (grants.includes("requests:assign")) extra.push("tasks:assign");
    if (extra.length)
      db.prepare(
        "UPDATE role_definitions SET permissions=? WHERE role_key=?",
      ).run(JSON.stringify([...new Set([...grants, ...extra])]), row.role_key);
  }
  for (const [table, fields] of Object.entries({
    tasks: [
      "id",
      "branch_id",
      "department_id",
      "request_id",
      "priority",
      "status",
      "assigned_to",
      "created_by",
      "due_at",
      "version",
    ],
    task_members: ["task_id", "user_id"],
    task_checklist: ["id", "task_id", "done", "version", "updated_by"],
  })) {
    for (const operation of ["INSERT", "UPDATE", "DELETE"]) {
      const value = (alias) =>
        `json_object(${fields.flatMap((c) => ["'" + c + "'", alias + "." + c]).join(",")})`;
      const ref = operation === "DELETE" ? "OLD" : "NEW";
      db.exec(`CREATE TRIGGER audit_${table}_${operation.toLowerCase()} AFTER ${operation} ON ${table} BEGIN
        INSERT INTO audit_log(user_id,user_name,action,entity,entity_id,before_json,after_json,reason,ip,created_at)
        VALUES(audit_actor_id(),audit_actor_name(),'db-${operation.toLowerCase()}','${table}',${ref}.${fields[0]},${operation === "INSERT" ? "NULL" : value("OLD")},${operation === "DELETE" ? "NULL" : value("NEW")},audit_reason(),audit_actor_ip(),strftime('%Y-%m-%dT%H:%M:%fZ','now')); END;`);
    }
  }
}
