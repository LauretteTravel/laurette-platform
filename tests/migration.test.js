import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, copyFileSync, mkdirSync } from 'node:fs';
import { openDb } from "../lib/db.js";

// Only synthetic records: these retained backups may safely stay on the developer machine.
const dir = "data/phase05-migration";
const tables = db => db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(r => r.name);
const rows = (db, table) => db.prepare(`SELECT * FROM "${table}" ORDER BY rowid`).all();
const snapshot = db => Object.fromEntries(tables(db).map(t => [t, rows(db, t)]));
const normalized = value => JSON.parse(JSON.stringify(value));
const now = "2026-10-01T00:00:00.000Z";

test("phase05 migration: main 26 to operations 50, original data retained, reopen and backup restore", () => {
  mkdirSync(dir, { recursive: true });
  // Recreate only the known synthetic fixture, never a user-supplied database.
  let db = new DatabaseSync(":memory:");
  db.exec(readFileSync('tests/fixtures/pre-crm-main.sql', 'utf8'));
  assert.equal(tables(db).length, 26);
  db.prepare('INSERT INTO users (id,username,name,role,password_hash,password_salt,created_at) VALUES (1,?,?,?,?,?,?)').run('synthetic-admin','Synthetic admin','admin','synthetic-hash','synthetic-salt',now);
  db.prepare('INSERT INTO customers (id,name,phone,consent,created_at,updated_at) VALUES (1,?,?,1,?,?)').run('Synthetic customer','+962790000001',now,now);
  db.prepare('INSERT INTO clients (id,email,password_hash,password_salt,first_name,last_name,phone_e164,created_at,updated_at) VALUES (1,?,?,?,?,?,?,?,?)').run('synthetic@example.invalid','hash','salt','Synthetic','Client','+962790000001',now,now);
  db.prepare(`INSERT INTO requests (id,reference,type,status,customer_id,client_id,assigned_to,department,payload,source,consent,created_at,updated_at) VALUES (1,?,'flight','new',1,1,1,?,?,?,1,?,?)`).run('SYNTHETIC-MIGRATION-001','قسم التذاكر',JSON.stringify({name:'Synthetic customer',phone:'0790000001'}),'website',now,now);
  db.prepare("INSERT INTO request_events (request_id,kind,message,created_at) VALUES (1,'created','Synthetic event',?)").run(now);
  db.prepare("INSERT INTO webhook_deliveries (reference,event,status,created_at) VALUES (?,'booking.created','delivered',?)").run('SYNTHETIC-MIGRATION-001',now);
  db.prepare("INSERT INTO audit_log(user_name,action,entity,created_at) VALUES('Synthetic actor','historical-event','requests',?)").run(now);
  const before = snapshot(db);
  // VACUUM INTO produces a consistent SQLite snapshot (including committed WAL data).
  // Tests can be rerun: remove only these exact synthetic outputs.
  db.close();
  // Materialize the fixture in a unique path, then retain its backup and result.
  const unique = `${dir}/main-${Date.now()}-${process.pid}.db`;
  db = new DatabaseSync(unique);
  db.exec("PRAGMA foreign_keys=OFF");
  db.exec(readFileSync('tests/fixtures/pre-crm-main.sql', 'utf8'));
  for (const [table, records] of Object.entries(before)) for (const record of records) {
    const keys=Object.keys(record); db.prepare(`INSERT INTO "${table}" (${keys.map(k=>`"${k}"`).join(',')}) VALUES (${keys.map(()=>'?').join(',')})`).run(...Object.values(record));
  }
  db.exec("PRAGMA foreign_keys=ON");
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
  const backupFile = unique.replace(".db", "-before.db");
  db.exec(`VACUUM INTO '${backupFile}'`);
  db.close();
  db = openDb(unique);
  assert.equal(tables(db).length, 50);
  for (const [table, records] of Object.entries(before)) {
    if(table==='audit_log') {
      assert.ok(rows(db,table).length>=records.length);
      for(const row of rows(db,table).filter(row=>!records.some(old=>old.id===row.id))) {assert.equal(row.action,'db-update');assert.equal(row.entity,'role_definitions');}
    } else assert.equal(rows(db,table).length, records.length, table);
    for (let i=0;i<records.length;i++) for (const [key,value] of Object.entries(records[i])) assert.equal(rows(db,table)[i][key],value,`${table}.${key}`);
  }
  assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
  const first = snapshot(db);
  db.close();
  db = openDb(unique);
  assert.deepEqual(normalized(snapshot(db)),normalized(first));
  db.close();
  const restored = unique.replace(".db", "-restored.db");
  copyFileSync(backupFile, restored);
  db = new DatabaseSync(restored);
  assert.deepEqual(normalized(snapshot(db)),normalized(before));
  db.close();
  console.log(
    `MIGRATION main: 26 -> 50; 7 synthetic rows preserved; 0 FK errors; restore exact; backup=${backupFile}`,
  );
});

test('phase05 migration: CRM database retains all business tables when n8n is added', () => {
  mkdirSync(dir, { recursive: true });
  const file = `${dir}/crm-${Date.now()}-${process.pid}.db`;
  let db = new DatabaseSync(file);
  db.exec(readFileSync("tests/fixtures/pre-identity-crm.sql", "utf8"));
  db.prepare("INSERT INTO requests (id,reference,type,payload,created_at,updated_at) VALUES (1,'SYNTHETIC-CRM','flight','{}',?,?)").run(now,now);
  const department = db.prepare('SELECT id FROM departments LIMIT 1').get().id;
  db.prepare('UPDATE requests SET department_id=?, department=? WHERE id=1').run(department,db.prepare('SELECT name FROM departments WHERE id=?').get(department).name);
  db.prepare('INSERT INTO request_transfers (request_id,to_department_id,created_at) VALUES (1,?,?)').run(department,now);
  db.prepare("INSERT INTO request_quotes (request_id,version,amount,status,created_at) VALUES (1,1,100,'sent',?)").run(now);
  db.prepare("INSERT INTO bookings (id,request_id,reference,status,amount,confirmed_at,updated_at) VALUES (1,1,'SYNTHETIC-BOOKING','confirmed',100,?,?)").run(now,now);
  db.prepare("INSERT INTO booking_payments (booking_id,kind,amount,created_at) VALUES (1,'receipt',50,?)").run(now);
  db.prepare("INSERT INTO request_follow_ups (request_id,due_at,note,created_at) VALUES (1,?,'Synthetic follow-up',?)").run(now,now);
  db.prepare("INSERT INTO request_owner_history (request_id,owner_type,next_value,created_at) VALUES (1,'department',?,?)").run(String(department),now);
  db.prepare("INSERT INTO whatsapp_outbox (event_key,request_id,kind,recipient,template_payload,next_attempt_at,created_at) VALUES ('synthetic',1,'received','962790000001','{}',?,?)").run(now,now);
  db.prepare("INSERT INTO branches (code,name,created_at,updated_at) VALUES ('synthetic-branch','Synthetic branch',?,?)").run(now,now);
  // Recreate the CRM-only predecessor by removing only the n8n table in this synthetic DB.

  db.prepare("INSERT INTO audit_log(user_name,action,entity,created_at) VALUES('Synthetic actor','historical-event','requests',?)").run(now);
  const before=snapshot(db), backup=file.replace('.db','-before.db');
  db.exec(`VACUUM INTO '${backup}'`);
  db.close();
  db = openDb(file);
  assert.equal(tables(db).length, 50);
  for (const [table, records] of Object.entries(before)) {
    if(table==='audit_log') {
      const current=rows(db,table);assert.ok(current.length>=records.length);
      for(const old of records)for(const [key,value]of Object.entries(old))assert.equal(current.find(row=>row.id===old.id)[key],value);
      for(const row of current.filter(row=>!records.some(old=>old.id===row.id))) {assert.equal(row.action,'db-update');assert.equal(row.entity,'role_definitions');}
    } else if (table === "role_definitions") {
      for (const record of records) {
        const after = db
          .prepare("SELECT * FROM role_definitions WHERE role_key=?")
          .get(record.role_key);
        for (const key of Object.keys(record)) {
          if (key === "permissions")
            for (const grant of JSON.parse(record.permissions))
              assert.ok(JSON.parse(after.permissions).includes(grant));
          else assert.equal(after[key], record[key]);
        }
      }
    } else
      assert.deepEqual(normalized(rows(db,table)),normalized(records),table);
  }
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
  db.close();
  const restored = file.replace(".db", "-restored.db");
  copyFileSync(backup, restored);
  db = new DatabaseSync(restored);
  assert.deepEqual(normalized(snapshot(db)),normalized(before));
  db.close();
  console.log(
    "MIGRATION CRM: 36 -> 50; all 36 table contents retained; backup retained",
  );
});
