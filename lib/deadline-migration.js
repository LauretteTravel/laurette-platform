export const DEADLINE_SCHEMA = `
CREATE TABLE operations_alerts (
 id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER NOT NULL REFERENCES users(id),
 task_id INTEGER REFERENCES tasks(id),follow_up_id INTEGER REFERENCES request_follow_ups(id),
 cycle TEXT NOT NULL,kind TEXT NOT NULL CHECK(kind IN ('soon','overdue','escalated')),
 due_at TEXT NOT NULL,owner_id INTEGER NOT NULL REFERENCES users(id),created_at TEXT NOT NULL,read_at TEXT,
 CHECK((task_id IS NOT NULL AND follow_up_id IS NULL) OR (task_id IS NULL AND follow_up_id IS NOT NULL))
);
CREATE UNIQUE INDEX operations_alert_task ON operations_alerts(user_id,task_id,cycle,kind) WHERE task_id IS NOT NULL;
CREATE UNIQUE INDEX operations_alert_follow ON operations_alerts(user_id,follow_up_id,cycle,kind) WHERE follow_up_id IS NOT NULL;
CREATE INDEX operations_alert_recipient ON operations_alerts(user_id,read_at,id);
CREATE TRIGGER operations_alert_no_delete BEFORE DELETE ON operations_alerts BEGIN SELECT RAISE(ABORT,'Alert ledger is retained');END;
CREATE TRIGGER operations_alert_identity BEFORE UPDATE OF user_id,task_id,follow_up_id,cycle,kind,due_at,owner_id,created_at ON operations_alerts BEGIN SELECT RAISE(ABORT,'Alert identity is immutable');END;
`;
export function installDeadlines(db) {
  db.exec(DEADLINE_SCHEMA);
}
