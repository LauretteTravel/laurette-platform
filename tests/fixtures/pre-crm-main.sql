-- Schema only from c7b3eab; contains no production/customer data.
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
CREATE TABLE requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reference TEXT UNIQUE NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('flight','hotel','program','umrah','visa','consult')),
  status TEXT NOT NULL DEFAULT 'new',
  deal_status TEXT NOT NULL DEFAULT 'new',
  completed_at TEXT,
  first_response_at TEXT,
  customer_id INTEGER REFERENCES customers(id),
  assigned_to INTEGER REFERENCES users(id),
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
, client_id INTEGER REFERENCES clients(id) ON DELETE SET NULL);
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
);
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
CREATE TABLE webhook_deliveries (
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
CREATE INDEX idx_audit_created ON audit_log(created_at DESC);
CREATE INDEX idx_client_sessions_client ON client_sessions(client_id);
CREATE INDEX idx_clients_phone ON clients(phone_e164);
CREATE INDEX idx_events_request ON request_events(request_id, id);
CREATE INDEX idx_msg_session ON assistant_messages(session_id, id);
CREATE INDEX idx_programs_cat ON programs(category, status);
CREATE INDEX idx_programs_price ON programs(price_from);
CREATE INDEX idx_requests_client ON requests(client_id, created_at DESC);
CREATE INDEX idx_requests_created ON requests(created_at DESC);
CREATE INDEX idx_requests_customer ON requests(customer_id);
CREATE INDEX idx_requests_deal ON requests(deal_status, completed_at);
CREATE INDEX idx_requests_status ON requests(status);
CREATE INDEX idx_requests_type ON requests(type);
CREATE INDEX idx_tracking_created ON tracking_events(created_at DESC);
