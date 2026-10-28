import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { isoNow } from './util.js';

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

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

export function openDb(file) {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(SCHEMA);
  for (const [table, column, definition] of [
    ['programs', 'level', 'TEXT'],
    ['programs', 'image_url', 'TEXT'],
    ['destinations', 'image_url', 'TEXT'],
    ['requests', 'deal_status', "TEXT NOT NULL DEFAULT 'new'"],
    ['requests', 'completed_at', 'TEXT'],
    ['requests', 'first_response_at', 'TEXT'],
    ['requests', 'client_id', 'INTEGER REFERENCES clients(id) ON DELETE SET NULL'],
    ['customers', 'whatsapp_opted_out', 'INTEGER NOT NULL DEFAULT 0'],
    ['customers', 'whatsapp_opted_in_at', 'TEXT'],
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
  db.exec('CREATE INDEX IF NOT EXISTS idx_requests_client ON requests(client_id, created_at DESC)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_requests_deal ON requests(deal_status, completed_at)');
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

export function q(db, sql, params = []) {
  return db.prepare(sql).all(...params);
}

export function one(db, sql, params = []) {
  return db.prepare(sql).get(...params) ?? null;
}

export function exec(db, sql, params = []) {
  return db.prepare(sql).run(...params);
}

export function transaction(db, fn) {
  db.exec('BEGIN');
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
