import {ATTACHMENT_SCHEMA,installAttachments} from './attachment-migration.js';
import { TASK_SCHEMA, installTasks } from './task-migration.js';
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join } from "node:path";
import { isoNow } from "./util.js";
import { registerAuditFunctions } from "./audit-context.js";
import {
  migrateDatabase,
  checksum,
  IDENTITY_SCHEMA,
  NEW_ROLES,
  grantExpansion,
  installIdentity,
} from "./migrations.js";

const SCHEMA = `


CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','manager','agent')),
  department TEXT,
  phone TEXT,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  must_change INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  last_login_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS branches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL UNIQUE,
  is_primary INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS departments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  branch_id INTEGER REFERENCES branches(id) ON DELETE SET NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (name, branch_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_departments_scope_name ON departments(name, COALESCE(branch_id, 0));
CREATE TABLE IF NOT EXISTS department_aliases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  department_id INTEGER NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  legacy_name TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS role_definitions (
  role_key TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  base_role TEXT NOT NULL CHECK (base_role IN ('admin','manager','agent')),
  data_scope TEXT NOT NULL DEFAULT 'organization' CHECK (data_scope IN ('organization','branch','department','assigned')),
  permissions TEXT NOT NULL DEFAULT '[]',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  ip TEXT,
  ua TEXT
);

CREATE TABLE IF NOT EXISTS clients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL COLLATE NOCASE UNIQUE,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  phone_e164 TEXT NOT NULL,
  is_verified INTEGER NOT NULL DEFAULT 0 CHECK (is_verified IN (0,1)),
  otp_hash TEXT,
  otp_salt TEXT,
  otp_expires_at TEXT,
  otp_sent_at TEXT,
  otp_attempts INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_login_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_clients_phone ON clients(phone_e164);

CREATE TABLE IF NOT EXISTS client_sessions (
  token_hash TEXT PRIMARY KEY,
  client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  ip TEXT,
  ua TEXT
);
CREATE INDEX IF NOT EXISTS idx_client_sessions_client ON client_sessions(client_id);

CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  phone TEXT UNIQUE NOT NULL,
  email TEXT,
  country TEXT,
  preference TEXT,
  notes TEXT,
  consent INTEGER NOT NULL DEFAULT 0,
  whatsapp_opted_out INTEGER NOT NULL DEFAULT 0,
  whatsapp_opted_in_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reference TEXT UNIQUE NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('flight','hotel','program','umrah','visa','consult','cruise')),
  status TEXT NOT NULL DEFAULT 'new',
  deal_status TEXT NOT NULL DEFAULT 'new',
  completed_at TEXT,
  first_response_at TEXT,
  customer_id INTEGER REFERENCES customers(id),
  client_id INTEGER REFERENCES clients(id) ON DELETE SET NULL,
  assigned_to INTEGER REFERENCES users(id),
  branch_id INTEGER REFERENCES branches(id) ON DELETE SET NULL,
  received_branch_id INTEGER REFERENCES branches(id) ON DELETE SET NULL,
  department_id INTEGER REFERENCES departments(id) ON DELETE SET NULL,
  lead_origin TEXT,
  sales_owner_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  service_owner_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  execution_owner_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  lost_reason TEXT,
  department TEXT,
  title TEXT,
  summary TEXT,
  payload TEXT NOT NULL,
  quote_amount REAL,
  quote_currency TEXT DEFAULT 'د.أ',
  quote_note TEXT,
  source TEXT,
  consent INTEGER NOT NULL DEFAULT 0,
  duplicate_of INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_requests_status ON requests(status);
CREATE INDEX IF NOT EXISTS idx_requests_type ON requests(type);
CREATE INDEX IF NOT EXISTS idx_requests_created ON requests(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_requests_customer ON requests(customer_id);

CREATE TABLE IF NOT EXISTS request_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id INTEGER NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  actor_id INTEGER,
  actor_name TEXT,
  kind TEXT NOT NULL,
  message TEXT,
  meta TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_request ON request_events(request_id, id);

CREATE TABLE IF NOT EXISTS request_transfers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id INTEGER NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  from_branch_id INTEGER REFERENCES branches(id) ON DELETE SET NULL,
  to_branch_id INTEGER REFERENCES branches(id) ON DELETE SET NULL,
  from_department_id INTEGER REFERENCES departments(id) ON DELETE SET NULL,
  to_department_id INTEGER NOT NULL REFERENCES departments(id),
  from_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  to_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  requested_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','rejected','cancelled')),
  note TEXT,
  response_note TEXT,
  responded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  responded_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_request_transfers_pending ON request_transfers(status, to_department_id, to_user_id);
CREATE INDEX IF NOT EXISTS idx_request_transfers_request ON request_transfers(request_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_request_one_pending_transfer ON request_transfers(request_id) WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS request_quotes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id INTEGER NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  amount REAL NOT NULL CHECK (amount >= 0),
  cost_amount REAL CHECK (cost_amount IS NULL OR cost_amount >= 0),
  currency TEXT NOT NULL DEFAULT 'د.أ',
  note TEXT,
  status TEXT NOT NULL CHECK (status IN ('sent','accepted','rejected','expired')),
  valid_until TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  UNIQUE (request_id, version)
);
CREATE INDEX IF NOT EXISTS idx_request_quotes_request ON request_quotes(request_id, version DESC);

CREATE TABLE IF NOT EXISTS bookings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id INTEGER NOT NULL UNIQUE REFERENCES requests(id) ON DELETE CASCADE,
  reference TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('confirmed','cancelled')),
  amount REAL NOT NULL CHECK (amount >= 0),
  cost_amount REAL CHECK (cost_amount IS NULL OR cost_amount >= 0),
  currency TEXT NOT NULL DEFAULT 'د.أ',
  confirmed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  confirmed_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_bookings_confirmed_at ON bookings(status, confirmed_at);

CREATE TABLE IF NOT EXISTS booking_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id INTEGER NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('receipt','refund')),
  amount REAL NOT NULL CHECK (amount > 0),
  currency TEXT NOT NULL DEFAULT 'د.أ',
  reference TEXT,
  note TEXT,
  recorded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_booking_payments_booking ON booking_payments(booking_id, created_at);

CREATE TABLE IF NOT EXISTS request_follow_ups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id INTEGER NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  assigned_to INTEGER REFERENCES users(id) ON DELETE SET NULL,
  due_at TEXT NOT NULL,
  note TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','done','cancelled')),
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  completed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  completed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_request_follow_ups_due ON request_follow_ups(status, due_at, assigned_to);

CREATE TABLE IF NOT EXISTS request_owner_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id INTEGER NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  owner_type TEXT NOT NULL CHECK (owner_type IN ('assigned','sales','service','execution','department','branch')),
  previous_value TEXT,
  next_value TEXT,
  changed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  note TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_request_owner_history ON request_owner_history(request_id, id);

CREATE TABLE IF NOT EXISTS programs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT UNIQUE NOT NULL,
  legacy_id TEXT,
  category TEXT NOT NULL,
  level TEXT,
  title TEXT NOT NULL,
  summary TEXT,
  description TEXT,
  destination TEXT,
  country TEXT,
  days INTEGER,
  nights INTEGER,
  price_from REAL,
  currency TEXT NOT NULL DEFAULT 'د.أ',
  status TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('draft','published','sold_out','archived')),
  featured INTEGER NOT NULL DEFAULT 0,
  art_key TEXT,
  image_url TEXT,
  hotels TEXT NOT NULL DEFAULT '[]',
  itinerary TEXT NOT NULL DEFAULT '[]',
  includes TEXT NOT NULL DEFAULT '[]',
  excludes TEXT NOT NULL DEFAULT '[]',
  terms TEXT NOT NULL DEFAULT '[]',
  flights TEXT NOT NULL DEFAULT '[]',
  options TEXT NOT NULL DEFAULT '[]',
  badges TEXT NOT NULL DEFAULT '[]',
  meals TEXT,
  airline TEXT,
  departure_dates TEXT,
  mode TEXT,
  route TEXT,
  sort INTEGER NOT NULL DEFAULT 100,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_programs_cat ON programs(category, status);
CREATE INDEX IF NOT EXISTS idx_programs_price ON programs(price_from);

CREATE TABLE IF NOT EXISTS offers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT UNIQUE,
  title TEXT NOT NULL,
  body TEXT,
  art_key TEXT,
  image_url TEXT,
  image_alt TEXT,
  category TEXT,
  price_from REAL,
  currency TEXT DEFAULT 'د.أ',
  days INTEGER,
  nights INTEGER,
  includes TEXT NOT NULL DEFAULT '[]',
  valid_until TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  featured INTEGER NOT NULL DEFAULT 0,
  sort INTEGER NOT NULL DEFAULT 100,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS news (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  body TEXT,
  airline TEXT,
  urgent INTEGER NOT NULL DEFAULT 0,
  published_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  branch TEXT,
  rating INTEGER NOT NULL DEFAULT 5,
  text TEXT NOT NULL,
  source TEXT DEFAULT 'Google',
  published_at TEXT,
  visible INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS destinations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  name_en TEXT,
  kind TEXT NOT NULL DEFAULT 'city',
  parent_slug TEXT,
  summary TEXT,
  highlights TEXT NOT NULL DEFAULT '[]',
  best_time TEXT,
  map_url TEXT,
  art_key TEXT,
  image_url TEXT,
  sort INTEGER NOT NULL DEFAULT 100,
  published INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS articles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  excerpt TEXT,
  body TEXT NOT NULL,
  category TEXT,
  tags TEXT NOT NULL DEFAULT '[]',
  reading_minutes INTEGER DEFAULT 4,
  status TEXT NOT NULL DEFAULT 'published',
  published_at TEXT,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS faq (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  category TEXT,
  sort INTEGER NOT NULL DEFAULT 100,
  published INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS visa_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  destination TEXT NOT NULL,
  purpose TEXT,
  summary TEXT NOT NULL,
  docs TEXT NOT NULL DEFAULT '[]',
  notes TEXT NOT NULL DEFAULT '[]',
  source_name TEXT,
  source_url TEXT,
  last_verified TEXT,
  requires_verification INTEGER NOT NULL DEFAULT 1,
  published INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS kb_docs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  category TEXT,
  tags TEXT NOT NULL DEFAULT '[]',
  active INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  user_name TEXT,
  action TEXT NOT NULL,
  entity TEXT,
  entity_id TEXT,
  meta TEXT,
  ip TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at DESC);

CREATE TABLE IF NOT EXISTS assistant_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sid TEXT UNIQUE NOT NULL,
  consent INTEGER NOT NULL DEFAULT 0,
  phone TEXT,
  created_at TEXT NOT NULL,
  last_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS hotel_guides (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  city TEXT NOT NULL,
  city_slug TEXT,
  name TEXT NOT NULL,
  stars INTEGER,
  area TEXT,
  note TEXT,
  source TEXT,
  sort INTEGER NOT NULL DEFAULT 100,
  published INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS airlines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  code TEXT,
  hub TEXT,
  note TEXT,
  sort INTEGER NOT NULL DEFAULT 100,
  published INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS trip_ideas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  city TEXT,
  country TEXT,
  days INTEGER,
  nights INTEGER,
  best_time TEXT,
  summary TEXT,
  itinerary TEXT NOT NULL DEFAULT '[]',
  includes TEXT NOT NULL DEFAULT '[]',
  image_url TEXT,
  sort INTEGER NOT NULL DEFAULT 100,
  published INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS whatsapp_outbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_key TEXT UNIQUE NOT NULL,
  request_id INTEGER NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('received','status')),
  status_value TEXT,
  recipient TEXT NOT NULL,
  template_payload TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT NOT NULL,
  message_id TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  sent_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_whatsapp_outbox_pending ON whatsapp_outbox(state, next_attempt_at);

CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reference TEXT,
  event TEXT NOT NULL,
  url TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  response_code INTEGER,
  error TEXT,
  attempts INTEGER NOT NULL DEFAULT 1,
  duration_ms INTEGER,
  created_at TEXT NOT NULL,
  finished_at TEXT
);

CREATE TABLE IF NOT EXISTS tracking_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event TEXT NOT NULL,
  type TEXT,
  path TEXT,
  meta TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tracking_created ON tracking_events(created_at DESC);

CREATE TABLE IF NOT EXISTS assistant_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER REFERENCES assistant_sessions(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  intent TEXT,
  sources TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_msg_session ON assistant_messages(session_id, id);
`;

function applyLegacySchema(db) {
  db.exec(SCHEMA);
  const requestSchema = one(db, "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'requests'")?.sql || '';
  if (!requestSchema.includes("'cruise'")) {
    const newRequestSchema = SCHEMA.match(/CREATE TABLE IF NOT EXISTS requests \([\s\S]*?\n\);/)?.[0]
      ?.replace('CREATE TABLE IF NOT EXISTS requests', 'CREATE TABLE requests_new');
    if (!newRequestSchema) throw new Error('Unable to build the additive requests table migration');
    try {
      db.exec("DROP TABLE IF EXISTS requests_new");
      db.exec(newRequestSchema);
      const oldColumns = db.prepare('PRAGMA table_info(requests)').all().map((column) => column.name);
      const newColumns = db.prepare('PRAGMA table_info(requests_new)').all().map((column) => column.name);
      if(oldColumns.some(column=>!newColumns.includes(column)))throw new Error('Unsupported legacy request columns; manual migration required');
      const copyColumns = oldColumns.filter((column) => newColumns.includes(column));
      const names = copyColumns.map((column) => `"${column}"`).join(', ');
      db.exec(`INSERT INTO requests_new (${names}) SELECT ${names} FROM requests`);
      db.exec("DROP TABLE requests");
      db.exec("ALTER TABLE requests_new RENAME TO requests");
    } catch (error) {
      throw error;
    }
  }
  for (const [table, column, definition] of [
    ['users', 'role_key', 'TEXT REFERENCES role_definitions(role_key) ON DELETE SET NULL'],
    ['users', 'branch_id', 'INTEGER REFERENCES branches(id) ON DELETE SET NULL'],
    ['users', 'department_id', 'INTEGER REFERENCES departments(id) ON DELETE SET NULL'],
    ['branches', 'is_primary', 'INTEGER NOT NULL DEFAULT 0'],
    ['programs', 'level', 'TEXT'],
    ['programs', 'image_url', 'TEXT'],
    ['destinations', 'image_url', 'TEXT'],
    ['requests', 'deal_status', "TEXT NOT NULL DEFAULT 'new'"],
    ['requests', 'completed_at', 'TEXT'],
    ['requests', 'first_response_at', 'TEXT'],
    ['requests', 'client_id', 'INTEGER REFERENCES clients(id) ON DELETE SET NULL'],
    ['customers', 'whatsapp_opted_out', 'INTEGER NOT NULL DEFAULT 0'],
    ['customers', 'whatsapp_opted_in_at', 'TEXT'],
    ['requests', 'branch_id', 'INTEGER REFERENCES branches(id) ON DELETE SET NULL'],
    ['requests', 'received_branch_id', 'INTEGER REFERENCES branches(id) ON DELETE SET NULL'],
    ['requests', 'department_id', 'INTEGER REFERENCES departments(id) ON DELETE SET NULL'],
    ['requests', 'lost_reason', 'TEXT'],
    ['requests', 'lead_origin', 'TEXT'],
    ['requests', 'sales_owner_id', 'INTEGER REFERENCES users(id) ON DELETE SET NULL'],
    ['requests', 'service_owner_id', 'INTEGER REFERENCES users(id) ON DELETE SET NULL'],
    ['requests', 'execution_owner_id', 'INTEGER REFERENCES users(id) ON DELETE SET NULL'],
    ['request_transfers', 'from_branch_id', 'INTEGER REFERENCES branches(id) ON DELETE SET NULL'],
    ['request_transfers', 'to_branch_id', 'INTEGER REFERENCES branches(id) ON DELETE SET NULL'],

    ['offers', 'image_alt', 'TEXT'],
    ['offers', 'category', 'TEXT'],
    ['offers', 'price_from', 'REAL'],
    ['offers', 'currency', "TEXT DEFAULT 'د.أ'"],
    ['offers', 'days', 'INTEGER'],
    ['offers', 'nights', 'INTEGER'],
    ['offers', 'includes', "TEXT NOT NULL DEFAULT '[]'"],
    ['offers', 'featured', 'INTEGER NOT NULL DEFAULT 0'],
    ['offers', 'sort', 'INTEGER NOT NULL DEFAULT 100'],
  ]) {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all();
    if (!cols.some((c) => c.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
  const migrationNow = isoNow();
  for (const [code, name, primary] of [['irbid', 'إربد', 1], ['amman', 'عمّان', 0]]) {
    db.prepare(`INSERT OR IGNORE INTO branches (code, name, created_at, updated_at) VALUES (?,?,?,?)`)
      .run(code, name, migrationNow, migrationNow);
    db.prepare('UPDATE branches SET is_primary = ? WHERE code = ?').run(primary, code);
  }
  const defaultDepartments = [
    'قسم التذاكر',
    'قسم التأشيرات',
    'قسم الحج والعمرة',
    'قسم الهوليداي والبرامج السياحية',
    'قسم شرق آسيا',
    'قسم رحلات الكروز',
    'قسم الفعاليات والمؤتمرات والخدمات اللوجستية',
    'قسم التسويق والمبيعات',
    'قسم الشركات B2B',
  ];
  const saveDepartment = db.prepare('INSERT OR IGNORE INTO departments (name, created_at, updated_at) VALUES (?,?,?)');
  for (const name of defaultDepartments) saveDepartment.run(name, migrationNow, migrationNow);
  db.exec(`INSERT OR IGNORE INTO departments (name, created_at, updated_at)
    SELECT DISTINCT department, '${migrationNow}', '${migrationNow}'
      FROM users WHERE department IS NOT NULL AND trim(department) <> ''`);
  db.exec(`INSERT OR IGNORE INTO departments (name, created_at, updated_at)
    SELECT DISTINCT department, '${migrationNow}', '${migrationNow}'
      FROM requests WHERE department IS NOT NULL AND trim(department) <> ''`);
  const departmentAliases = new Map([
    ['قسم التذاكر', ['تذاكر الطيران', 'التذاكر', 'تذاكر']],
    ['قسم التأشيرات', ['التأشيرات', 'التأشيرة']],
    ['قسم الحج والعمرة', ['الحج والعمرة', 'العمرة', 'الحج']],
    ['قسم الهوليداي والبرامج السياحية', ['البرامج السياحية', 'الهوليداي', 'الفنادق', 'السياحة']],
    ['قسم شرق آسيا', ['شرق آسيا', 'اسيا']],
    ['قسم رحلات الكروز', ['رحلات الكروز', 'الكروز', 'كروز']],
    ['قسم الفعاليات والمؤتمرات والخدمات اللوجستية', ['الفعاليات', 'المؤتمرات', 'الخدمات اللوجستية']],
    ['قسم التسويق والمبيعات', ['التسويق والمبيعات', 'التسويق', 'المبيعات']],
    ['قسم الشركات B2B', ['الشركات B2B', 'الشركات', 'B2B']],
  ]);
  for (const [canonicalName, oldNames] of departmentAliases) {
    const canonicalId = db.prepare('SELECT id FROM departments WHERE name = ? AND branch_id IS NULL ORDER BY id LIMIT 1')
      .get(canonicalName)?.id;
    for (const oldName of oldNames) {
      const legacy = db.prepare('SELECT id FROM departments WHERE name = ? AND branch_id IS NULL ORDER BY id LIMIT 1')
        .get(oldName);
      if (!canonicalId || !legacy || legacy.id === canonicalId) continue;
      db.prepare('UPDATE requests SET department_id = ?, department = ?, updated_at = ? WHERE department_id = ?')
        .run(canonicalId, canonicalName, migrationNow, legacy.id);
      db.prepare('UPDATE users SET department_id = ?, department = ? WHERE department_id = ?')
        .run(canonicalId, canonicalName, legacy.id);
      db.prepare('UPDATE departments SET active = 0, updated_at = ? WHERE id = ?').run(migrationNow, legacy.id);
      db.prepare('INSERT OR IGNORE INTO department_aliases (department_id, legacy_name, created_at) VALUES (?,?,?)')
        .run(canonicalId, oldName, migrationNow);
    }
  }
  db.exec(`UPDATE requests SET department_id = (
      SELECT id FROM departments WHERE departments.name = requests.department AND departments.branch_id IS NULL LIMIT 1
    ) WHERE department_id IS NULL AND department IS NOT NULL`);
  db.exec(`UPDATE users SET department_id = (
      SELECT id FROM departments WHERE departments.name = users.department AND departments.branch_id IS NULL LIMIT 1
    ) WHERE department_id IS NULL AND department IS NOT NULL`);
  for (const [canonicalName, oldNames] of departmentAliases) {
    const canonicalId = db.prepare('SELECT id FROM departments WHERE name = ? AND branch_id IS NULL ORDER BY id LIMIT 1')
      .get(canonicalName)?.id;
    for (const oldName of oldNames) {
      const legacy = db.prepare('SELECT id FROM departments WHERE name = ? AND branch_id IS NULL ORDER BY id LIMIT 1')
        .get(oldName);
      if (!canonicalId || !legacy || legacy.id === canonicalId) continue;
      db.prepare('UPDATE requests SET department_id = ?, department = ?, updated_at = ? WHERE department_id = ?')
        .run(canonicalId, canonicalName, migrationNow, legacy.id);
      db.prepare('UPDATE users SET department_id = ?, department = ? WHERE department_id = ?')
        .run(canonicalId, canonicalName, legacy.id);
      db.prepare('UPDATE departments SET active = 0, updated_at = ? WHERE id = ?').run(migrationNow, legacy.id);
      db.prepare('INSERT OR IGNORE INTO department_aliases (department_id, legacy_name, created_at) VALUES (?,?,?)')
        .run(canonicalId, oldName, migrationNow);
    }
  }
  db.exec(`UPDATE requests SET lead_origin = source WHERE lead_origin IS NULL`);
  db.exec(`UPDATE requests SET department_id = (
      SELECT id FROM departments WHERE
        (requests.type = 'flight' AND name = 'قسم التذاكر')
        OR (requests.type = 'visa' AND name = 'قسم التأشيرات')
        OR (requests.type = 'umrah' AND name = 'قسم الحج والعمرة')
        OR (requests.type = 'cruise' AND name = 'قسم رحلات الكروز')
        OR (requests.type IN ('program','hotel') AND name = 'قسم الهوليداي والبرامج السياحية')
        OR (requests.type = 'consult' AND name = 'قسم التسويق والمبيعات')
      ORDER BY id LIMIT 1
    ), department = CASE
      WHEN type = 'flight' THEN 'قسم التذاكر'
      WHEN type = 'visa' THEN 'قسم التأشيرات'
      WHEN type = 'umrah' THEN 'قسم الحج والعمرة'
      WHEN type = 'cruise' THEN 'قسم رحلات الكروز'
      WHEN type IN ('program','hotel') THEN 'قسم الهوليداي والبرامج السياحية'
      WHEN type = 'consult' THEN 'قسم التسويق والمبيعات'
      ELSE department END
    WHERE department_id IS NULL AND (department IS NULL OR trim(department) = '')`);
  db.exec(`UPDATE requests SET received_branch_id = branch_id
    WHERE received_branch_id IS NULL
      AND NOT EXISTS (SELECT 1 FROM request_transfers t WHERE t.request_id = requests.id)`);
  const builtInRoles = [
    ['admin', 'مدير النظام', 'admin', 'organization', ['*']],
    ['branch_manager', 'مدير فرع', 'manager', 'branch', ['overview:read','requests:read','requests:write','customers:read','customers:write','reports:read']],
    ['department_manager', 'مدير قسم', 'manager', 'department', ['overview:read','requests:read','requests:write','customers:read','customers:write','reports:read']],
    ['sales_agent', 'موظف مبيعات', 'agent', 'assigned', ['overview:read','requests:read','requests:write','customers:read','customers:write']],
    ['service_agent', 'موظف خدمة', 'agent', 'department', ['overview:read','requests:read','requests:write','customers:read','customers:write']],
  ];
  const saveRole = db.prepare(`INSERT OR IGNORE INTO role_definitions
    (role_key, name, base_role, data_scope, permissions, created_at, updated_at) VALUES (?,?,?,?,?,?,?)`);
  for (const [key, name, baseRole, scope, permissions] of builtInRoles) {
    saveRole.run(key, name, baseRole, scope, JSON.stringify(permissions), migrationNow, migrationNow);
  }
  db.exec('CREATE INDEX IF NOT EXISTS idx_requests_client ON requests(client_id, created_at DESC)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_requests_deal ON requests(deal_status, completed_at)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_users_org ON users(branch_id, department_id, active)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_requests_org ON requests(branch_id, department_id, created_at DESC)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_requests_intake_branch ON requests(received_branch_id, created_at DESC)');
  // Backfill deal stages for requests created before the CRM extension.
  db.exec(`
    UPDATE requests
       SET deal_status = CASE status
             WHEN 'confirmed' THEN 'won'
             WHEN 'cancelled' THEN 'lost'
             ELSE 'in_progress' END,
           completed_at = CASE
             WHEN status IN ('confirmed','cancelled') THEN COALESCE(completed_at, updated_at)
             ELSE completed_at END
     WHERE status <> 'new' AND (deal_status IS NULL OR deal_status = 'new')
  `);
  return db;
}

export function openDb(file) {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  try {
    db.exec(
      "PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000",
    );
    registerAuditFunctions(db);
    db.migrationBackups = migrateDatabase(db, file, [
      {
        version: 1,
        name: "legacy CRM and n8n baseline",
        checksum: checksum(SCHEMA + applyLegacySchema.toString()),
        up: applyLegacySchema,
      },
      {
        version: 2,
        name: "staff identity, memberships, MFA and append-only audit",
        checksum: checksum(
          IDENTITY_SCHEMA +
            JSON.stringify(NEW_ROLES) +
            JSON.stringify(grantExpansion) +
            installIdentity.toString(),
        ),
        up: installIdentity,
      },
      { version:3, name:"staff tasks and internal notifications", checksum:checksum(TASK_SCHEMA + installTasks.toString()), up:installTasks },
      {version:4,name:"private scanned task attachments",checksum:checksum(ATTACHMENT_SCHEMA+installAttachments.toString()),up:installAttachments},
    ]);
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

export function q(db, sql, params = []) {
  return db.prepare(sql).all(...params);
}

export function one(db, sql, params = []) {
  return db.prepare(sql).get(...params) ?? null;
}

export function exec(db, sql, params = []) {
  return db.prepare(sql).run(...params);
}

export function transaction(db, fn, { immediate = false } = {}) {
  db.exec(immediate ? "BEGIN IMMEDIATE" : "BEGIN");
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export function setting(db, key, fallback = null) {
  const row = one(db, 'SELECT value FROM settings WHERE key = ?', [key]);
  if (!row) return fallback;
  try { return JSON.parse(row.value); } catch { return row.value; }
}

export function setSetting(db, key, value) {
  exec(db, 'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [key, JSON.stringify(value)]);
}

export function seedDatabase(db, seed, hashPassword, adminPassword = null) {
  const marker = one(db, "SELECT value FROM meta WHERE key = 'seed_version'");
  if (marker && marker.value === String(seed.version)) return { seeded: false, reason: 'already-seeded' };

  const now = isoNow();

  // Insert reference data without touching operational data (requests, customers, audit).
  const insertAll = () => {
    exec(db, 'DELETE FROM programs');
    exec(db, 'DELETE FROM offers');
    exec(db, 'DELETE FROM news');
    exec(db, 'DELETE FROM reviews');
    exec(db, 'DELETE FROM destinations');
    exec(db, 'DELETE FROM hotel_guides');
    exec(db, 'DELETE FROM airlines');
    exec(db, 'DELETE FROM trip_ideas');
    exec(db, 'DELETE FROM articles');
    exec(db, 'DELETE FROM faq');
    exec(db, 'DELETE FROM visa_rules');
    exec(db, 'DELETE FROM kb_docs');

    for (const p of seed.programs || []) {
      exec(db, `INSERT INTO programs
        (slug, legacy_id, category, level, title, summary, description, destination, country, days, nights, price_from, currency,
         status, featured, art_key, image_url, hotels, itinerary, includes, excludes, terms, flights, options, badges, meals, airline,
         departure_dates, mode, route, sort, created_at, updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [
        p.slug, p.legacyId || null, p.category, p.level || null, p.title, p.summary || null, p.description || null,
        p.destination || null, p.country || null, p.days || null, p.nights || null, p.priceFrom || null,
        p.currency || 'د.أ', p.status || 'published', p.featured ? 1 : 0, p.artKey || 'haram', p.imageUrl || null,
        JSON.stringify(p.hotels || []), JSON.stringify(p.itinerary || []), JSON.stringify(p.includes || []),
        JSON.stringify(p.excludes || []), JSON.stringify(p.terms || []), JSON.stringify(p.flights || []),
        JSON.stringify(p.options || []), JSON.stringify(p.badges || []), p.meals || null, p.airline || null,
        p.departureDates || null, p.mode || null, p.route || null, p.sort ?? 100, now, now,
      ]);
    }

    for (const o of seed.offers || []) {
      exec(db, `INSERT INTO offers
        (slug, title, body, art_key, image_url, image_alt, category, price_from, currency, days, nights, includes, valid_until, active, featured, sort, created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [
        o.slug || null, o.title, o.body || null, o.artKey || 'haram', o.imageUrl || null, o.imageAlt || null,
        o.category || null, o.priceFrom || null, o.currency || 'د.أ', o.days || null, o.nights || null,
        JSON.stringify(o.includes || []), o.validUntil || null, o.active === false ? 0 : 1, o.featured ? 1 : 0,
        o.sort ?? 100, o.createdAt || now,
      ]);
    }
    for (const n of seed.news || []) {
      exec(db, 'INSERT INTO news (title, body, airline, urgent, published_at) VALUES (?,?,?,?,?)',
        [n.title, n.body || null, n.airline || null, n.urgent ? 1 : 0, n.publishedAt || now.slice(0, 10)]);
    }
    for (const r of seed.reviews || []) {
      exec(db, 'INSERT INTO reviews (name, branch, rating, text, source, published_at, visible) VALUES (?,?,?,?,?,?,?)',
        [r.name, r.branch || null, r.rating || 5, r.text, r.source || 'Google', r.publishedAt || null, r.visible === false ? 0 : 1]);
    }
    for (const d of seed.destinations || []) {
      exec(db, 'INSERT INTO destinations (slug, name, name_en, kind, parent_slug, summary, highlights, best_time, map_url, art_key, image_url, sort, published) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
        [d.slug, d.name, d.nameEn || null, d.kind || 'city', d.parentSlug || null, d.summary || null,
          JSON.stringify(d.highlights || []), d.bestTime || null, d.mapUrl || null, d.artKey || 'haram', d.imageUrl || null, d.sort ?? 100, d.published === false ? 0 : 1]);
    }
    for (const h of seed.hotelGuides || []) {
      exec(db, 'INSERT INTO hotel_guides (city, city_slug, name, stars, area, note, source, sort, published) VALUES (?,?,?,?,?,?,?,?,?)',
        [h.city, h.citySlug || null, h.name, h.stars || null, h.area || null, h.note || null, h.source || null, h.sort ?? 100, h.published === false ? 0 : 1]);
    }
    for (const a of seed.airlineGuides || []) {
      exec(db, 'INSERT INTO airlines (name, code, hub, note, sort, published) VALUES (?,?,?,?,?,?)',
        [a.name, a.code || null, a.hub || null, a.note || null, a.sort ?? 100, a.published === false ? 0 : 1]);
    }
    for (const t of seed.tripIdeas || []) {
      exec(db, 'INSERT INTO trip_ideas (slug, title, city, country, days, nights, best_time, summary, itinerary, includes, image_url, sort, published) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
        [t.slug, t.title, t.city || null, t.country || null, t.days || null, t.nights || null, t.bestTime || null,
          t.summary || null, JSON.stringify(t.itinerary || []), JSON.stringify(t.includes || []), t.imageUrl || null, t.sort ?? 100, t.published === false ? 0 : 1]);
    }

    for (const a of seed.articles || []) {
      exec(db, 'INSERT INTO articles (slug, title, excerpt, body, category, tags, reading_minutes, status, published_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
        [a.slug, a.title, a.excerpt || null, a.body, a.category || 'دليل السفر', JSON.stringify(a.tags || []),
          a.readingMinutes || 4, a.status || 'published', a.publishedAt || now.slice(0, 10), a.updatedAt || now.slice(0, 10)]);
    }
    for (const f of seed.faq || []) {
      exec(db, 'INSERT INTO faq (question, answer, category, sort, published) VALUES (?,?,?,?,?)',
        [f.question, f.answer, f.category || 'general', f.sort ?? 100, f.published === false ? 0 : 1]);
    }
    for (const v of seed.visaRules || []) {
      exec(db, `INSERT INTO visa_rules (destination, purpose, summary, docs, notes, source_name, source_url, last_verified, requires_verification, published)
        VALUES (?,?,?,?,?,?,?,?,?,?)`,
        [v.destination, v.purpose || null, v.summary, JSON.stringify(v.docs || []), JSON.stringify(v.notes || []),
          v.sourceName || null, v.sourceUrl || null, v.lastVerified || null, v.requiresVerification === false ? 0 : 1, v.published === false ? 0 : 1]);
    }
    for (const k of seed.kbDocs || []) {
      exec(db, 'INSERT INTO kb_docs (title, body, category, tags, active, updated_at) VALUES (?,?,?,?,?,?)',
        [k.title, k.body, k.category || null, JSON.stringify(k.tags || []), k.active === false ? 0 : 1, now]);
    }
    for (const [key, value] of Object.entries(seed.settings || {})) setSetting(db, key, value);

    for (const u of seed.users || []) {
      const exists = one(db, 'SELECT id FROM users WHERE username = ?', [u.username]);
      if (exists) continue;
      const password = u.password || adminPassword;
      if (!password) throw new Error('Set ADMIN_PASSWORD (env) or provide data/admin-credentials.txt before initializing the admin account.');
      const { hash, salt } = hashPassword(password);
      exec(db, 'INSERT INTO users (username, name, role, department, phone, password_hash, password_salt, must_change, active, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
        [u.username, u.name, u.role, u.department || null, u.phone || null, hash, salt, u.mustChange ? 1 : 0, 1, now]);
    }

    exec(db, 'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', ['seed_version', String(seed.version)]);
    exec(db, 'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', ['seeded_at', now]);
  };
  transaction(db, insertAll);
  return { seeded: true };
}

export function loadSeed(file = join(process.cwd(), 'data', 'seed.json')) {
  if (!existsSync(file)) throw new Error(`Seed file missing: ${file}. Run: node tools/build-seed.mjs`);
  return JSON.parse(readFileSync(file, 'utf8'));
}
