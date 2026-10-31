export const ATTACHMENT_SCHEMA = `
CREATE TABLE task_attachments (
 id INTEGER PRIMARY KEY AUTOINCREMENT,task_id INTEGER NOT NULL REFERENCES tasks(id),
 filename TEXT NOT NULL,mime TEXT NOT NULL,bytes INTEGER NOT NULL CHECK(bytes>0 AND bytes<=5242880),
 sha256 TEXT NOT NULL,content BLOB NOT NULL,uploaded_by INTEGER NOT NULL REFERENCES users(id),
 scanned_at TEXT NOT NULL,created_at TEXT NOT NULL,UNIQUE(task_id,sha256)
);
CREATE INDEX task_attachments_task ON task_attachments(task_id,id);
CREATE TRIGGER task_attachments_no_update BEFORE UPDATE ON task_attachments BEGIN SELECT RAISE(ABORT,'Attachments are immutable');END;
CREATE TRIGGER task_attachments_no_delete BEFORE DELETE ON task_attachments BEGIN SELECT RAISE(ABORT,'Attachments are retained');END;
`;
export function installAttachments(db) {
  db.exec(ATTACHMENT_SCHEMA);
}
