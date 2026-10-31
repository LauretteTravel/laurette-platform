-- Synthetic predecessor schema and reference data from main@5506707; no users, customers or requests.
CREATE TABLE airlines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  code TEXT,
  hub TEXT,
  note TEXT,
  sort INTEGER NOT NULL DEFAULT 100,
  published INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE articles (
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
CREATE TABLE assistant_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER REFERENCES assistant_sessions(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  intent TEXT,
  sources TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE assistant_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sid TEXT UNIQUE NOT NULL,
  consent INTEGER NOT NULL DEFAULT 0,
  phone TEXT,
  created_at TEXT NOT NULL,
  last_at TEXT NOT NULL
);
CREATE TABLE audit_log (
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
CREATE TABLE booking_payments (
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
CREATE TABLE bookings (
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
CREATE TABLE branches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL UNIQUE,
  is_primary INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE client_sessions (
  token_hash TEXT PRIMARY KEY,
  client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  ip TEXT,
  ua TEXT
);
CREATE TABLE clients (
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
CREATE TABLE customers (
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
CREATE TABLE department_aliases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  department_id INTEGER NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  legacy_name TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);
CREATE TABLE departments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  branch_id INTEGER REFERENCES branches(id) ON DELETE SET NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (name, branch_id)
);
CREATE TABLE destinations (
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
CREATE TABLE faq (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  category TEXT,
  sort INTEGER NOT NULL DEFAULT 100,
  published INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE hotel_guides (
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
CREATE TABLE kb_docs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  category TEXT,
  tags TEXT NOT NULL DEFAULT '[]',
  active INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL
);
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE news (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  body TEXT,
  airline TEXT,
  urgent INTEGER NOT NULL DEFAULT 0,
  published_at TEXT NOT NULL
);
CREATE TABLE offers (
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
CREATE TABLE programs (
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
CREATE TABLE request_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id INTEGER NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  actor_id INTEGER,
  actor_name TEXT,
  kind TEXT NOT NULL,
  message TEXT,
  meta TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE request_follow_ups (
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
CREATE TABLE request_owner_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id INTEGER NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  owner_type TEXT NOT NULL CHECK (owner_type IN ('assigned','sales','service','execution','department','branch')),
  previous_value TEXT,
  next_value TEXT,
  changed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  note TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE request_quotes (
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
CREATE TABLE request_transfers (
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
CREATE TABLE requests (
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
CREATE TABLE reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  branch TEXT,
  rating INTEGER NOT NULL DEFAULT 5,
  text TEXT NOT NULL,
  source TEXT DEFAULT 'Google',
  published_at TEXT,
  visible INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE role_definitions (
  role_key TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  base_role TEXT NOT NULL CHECK (base_role IN ('admin','manager','agent')),
  data_scope TEXT NOT NULL DEFAULT 'organization' CHECK (data_scope IN ('organization','branch','department','assigned')),
  permissions TEXT NOT NULL DEFAULT '[]',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  ip TEXT,
  ua TEXT
);
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT
);
CREATE TABLE tracking_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event TEXT NOT NULL,
  type TEXT,
  path TEXT,
  meta TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE trip_ideas (
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
CREATE TABLE users (
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
, role_key TEXT REFERENCES role_definitions(role_key) ON DELETE SET NULL, branch_id INTEGER REFERENCES branches(id) ON DELETE SET NULL, department_id INTEGER REFERENCES departments(id) ON DELETE SET NULL);
CREATE TABLE visa_rules (
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
CREATE TABLE whatsapp_outbox (
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
CREATE INDEX idx_audit_created ON audit_log(created_at DESC);
CREATE INDEX idx_booking_payments_booking ON booking_payments(booking_id, created_at);
CREATE INDEX idx_bookings_confirmed_at ON bookings(status, confirmed_at);
CREATE INDEX idx_client_sessions_client ON client_sessions(client_id);
CREATE INDEX idx_clients_phone ON clients(phone_e164);
CREATE UNIQUE INDEX idx_departments_scope_name ON departments(name, COALESCE(branch_id, 0));
CREATE INDEX idx_events_request ON request_events(request_id, id);
CREATE INDEX idx_msg_session ON assistant_messages(session_id, id);
CREATE INDEX idx_programs_cat ON programs(category, status);
CREATE INDEX idx_programs_price ON programs(price_from);
CREATE INDEX idx_request_follow_ups_due ON request_follow_ups(status, due_at, assigned_to);
CREATE UNIQUE INDEX idx_request_one_pending_transfer ON request_transfers(request_id) WHERE status = 'pending';
CREATE INDEX idx_request_owner_history ON request_owner_history(request_id, id);
CREATE INDEX idx_request_quotes_request ON request_quotes(request_id, version DESC);
CREATE INDEX idx_request_transfers_pending ON request_transfers(status, to_department_id, to_user_id);
CREATE INDEX idx_request_transfers_request ON request_transfers(request_id, id);
CREATE INDEX idx_requests_client ON requests(client_id, created_at DESC);
CREATE INDEX idx_requests_created ON requests(created_at DESC);
CREATE INDEX idx_requests_customer ON requests(customer_id);
CREATE INDEX idx_requests_deal ON requests(deal_status, completed_at);
CREATE INDEX idx_requests_intake_branch ON requests(received_branch_id, created_at DESC);
CREATE INDEX idx_requests_org ON requests(branch_id, department_id, created_at DESC);
CREATE INDEX idx_requests_status ON requests(status);
CREATE INDEX idx_requests_type ON requests(type);
CREATE INDEX idx_tracking_created ON tracking_events(created_at DESC);
CREATE INDEX idx_users_org ON users(branch_id, department_id, active);
CREATE INDEX idx_whatsapp_outbox_pending ON whatsapp_outbox(state, next_attempt_at);
INSERT INTO branches (id,code,name,is_primary,active,created_at,updated_at) VALUES (1,'irbid','إربد',1,1,'2026-10-31T02:59:04.635Z','2026-10-31T02:59:04.635Z');
INSERT INTO branches (id,code,name,is_primary,active,created_at,updated_at) VALUES (2,'amman','عمّان',0,1,'2026-10-31T02:59:04.635Z','2026-10-31T02:59:04.635Z');
INSERT INTO departments (id,name,branch_id,active,created_at,updated_at) VALUES (1,'قسم التذاكر',NULL,1,'2026-10-31T02:59:04.635Z','2026-10-31T02:59:04.635Z');
INSERT INTO departments (id,name,branch_id,active,created_at,updated_at) VALUES (2,'قسم التأشيرات',NULL,1,'2026-10-31T02:59:04.635Z','2026-10-31T02:59:04.635Z');
INSERT INTO departments (id,name,branch_id,active,created_at,updated_at) VALUES (3,'قسم الحج والعمرة',NULL,1,'2026-10-31T02:59:04.635Z','2026-10-31T02:59:04.635Z');
INSERT INTO departments (id,name,branch_id,active,created_at,updated_at) VALUES (4,'قسم الهوليداي والبرامج السياحية',NULL,1,'2026-10-31T02:59:04.635Z','2026-10-31T02:59:04.635Z');
INSERT INTO departments (id,name,branch_id,active,created_at,updated_at) VALUES (5,'قسم شرق آسيا',NULL,1,'2026-10-31T02:59:04.635Z','2026-10-31T02:59:04.635Z');
INSERT INTO departments (id,name,branch_id,active,created_at,updated_at) VALUES (6,'قسم رحلات الكروز',NULL,1,'2026-10-31T02:59:04.635Z','2026-10-31T02:59:04.635Z');
INSERT INTO departments (id,name,branch_id,active,created_at,updated_at) VALUES (7,'قسم الفعاليات والمؤتمرات والخدمات اللوجستية',NULL,1,'2026-10-31T02:59:04.635Z','2026-10-31T02:59:04.635Z');
INSERT INTO departments (id,name,branch_id,active,created_at,updated_at) VALUES (8,'قسم التسويق والمبيعات',NULL,1,'2026-10-31T02:59:04.635Z','2026-10-31T02:59:04.635Z');
INSERT INTO departments (id,name,branch_id,active,created_at,updated_at) VALUES (9,'قسم الشركات B2B',NULL,1,'2026-10-31T02:59:04.635Z','2026-10-31T02:59:04.635Z');
INSERT INTO role_definitions (role_key,name,base_role,data_scope,permissions,active,created_at,updated_at) VALUES ('admin','مدير النظام','admin','organization','["*"]',1,'2026-10-31T02:59:04.635Z','2026-10-31T02:59:04.635Z');
INSERT INTO role_definitions (role_key,name,base_role,data_scope,permissions,active,created_at,updated_at) VALUES ('branch_manager','مدير فرع','manager','branch','["overview:read","requests:read","requests:write","customers:read","customers:write","reports:read"]',1,'2026-10-31T02:59:04.635Z','2026-10-31T02:59:04.635Z');
INSERT INTO role_definitions (role_key,name,base_role,data_scope,permissions,active,created_at,updated_at) VALUES ('department_manager','مدير قسم','manager','department','["overview:read","requests:read","requests:write","customers:read","customers:write","reports:read"]',1,'2026-10-31T02:59:04.635Z','2026-10-31T02:59:04.635Z');
INSERT INTO role_definitions (role_key,name,base_role,data_scope,permissions,active,created_at,updated_at) VALUES ('sales_agent','موظف مبيعات','agent','assigned','["overview:read","requests:read","requests:write","customers:read","customers:write"]',1,'2026-10-31T02:59:04.635Z','2026-10-31T02:59:04.635Z');
INSERT INTO role_definitions (role_key,name,base_role,data_scope,permissions,active,created_at,updated_at) VALUES ('service_agent','موظف خدمة','agent','department','["overview:read","requests:read","requests:write","customers:read","customers:write"]',1,'2026-10-31T02:59:04.635Z','2026-10-31T02:59:04.635Z');
