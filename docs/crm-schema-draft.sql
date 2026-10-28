-- ============================================================
-- Laurette CRM — Phase 1 schema DRAFT (NOT EXECUTED)
-- Additive only: no table is dropped or renamed.
-- Target engine: SQLite (node:sqlite), same file as the live DB.
-- Review before applying. Always take a backup first:
--   copy data/laurette.db  data/laurette.db.bak-YYYYMMDD
--   copy data/laurette.db-wal data/laurette.db-wal.bak-YYYYMMDD
-- ============================================================

PRAGMA foreign_keys = ON;

-- ------------------------------------------------------------
-- 1. Organisation: branches, departments, employees
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS branches (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  code          TEXT NOT NULL UNIQUE,
  name_ar       TEXT NOT NULL,
  name_en       TEXT,
  is_head_office INTEGER NOT NULL DEFAULT 0 CHECK (is_head_office IN (0,1)),
  address       TEXT,
  phone         TEXT,
  active        INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS departments (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  code       TEXT NOT NULL UNIQUE,
  name_ar    TEXT NOT NULL,
  name_en    TEXT,
  kind       TEXT,
  active     INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS branch_departments (
  branch_id     INTEGER NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  department_id INTEGER NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  active        INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  PRIMARY KEY (branch_id, department_id)
);

CREATE TABLE IF NOT EXISTS employees (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE RESTRICT,
  employee_no   TEXT NOT NULL UNIQUE,
  branch_id     INTEGER NOT NULL REFERENCES branches(id),
  department_id INTEGER NOT NULL REFERENCES departments(id),
  job_title     TEXT,
  manager_id    INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  phone         TEXT,
  hire_date     TEXT,
  active        INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_employees_branch ON employees(branch_id, active);
CREATE INDEX IF NOT EXISTS idx_employees_dept   ON employees(department_id, active);
CREATE INDEX IF NOT EXISTS idx_employees_mgr    ON employees(manager_id);

-- ------------------------------------------------------------
-- 2. Roles, permissions, scoped grants
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS roles (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  code     TEXT NOT NULL UNIQUE,
  name_ar  TEXT NOT NULL,
  name_en  TEXT,
  is_system INTEGER NOT NULL DEFAULT 1 CHECK (is_system IN (0,1))
);

CREATE TABLE IF NOT EXISTS permissions (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  code    TEXT NOT NULL UNIQUE,
  module  TEXT NOT NULL,
  name_ar TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS role_permissions (
  role_id       INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id INTEGER NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE IF NOT EXISTS user_roles (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id    INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  scope_type TEXT NOT NULL DEFAULT 'self'
             CHECK (scope_type IN ('global','branch','department','self')),
  scope_id   INTEGER,
  granted_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK ((scope_type IN ('global','self') AND scope_id IS NULL)
      OR (scope_type IN ('branch','department') AND scope_id IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_user_roles
  ON user_roles(user_id, role_id, scope_type, IFNULL(scope_id, 0));

-- ------------------------------------------------------------
-- 3. Requests: extend the existing table (no column removed)
-- ------------------------------------------------------------
ALTER TABLE requests ADD COLUMN branch_id       INTEGER REFERENCES branches(id);
ALTER TABLE requests ADD COLUMN department_id   INTEGER REFERENCES departments(id);
ALTER TABLE requests ADD COLUMN owner_id        INTEGER REFERENCES users(id);
ALTER TABLE requests ADD COLUMN pending_owner_id INTEGER REFERENCES users(id);
ALTER TABLE requests ADD COLUMN priority        TEXT DEFAULT 'normal'
  CHECK (priority IN ('low','normal','high','urgent'));
ALTER TABLE requests ADD COLUMN due_at          TEXT;
ALTER TABLE requests ADD COLUMN received_at     TEXT;
ALTER TABLE requests ADD COLUMN source_code     TEXT;
ALTER TABLE requests ADD COLUMN customer_type   TEXT DEFAULT 'individual'
  CHECK (customer_type IN ('individual','company','agent'));
ALTER TABLE requests ADD COLUMN service_code    TEXT;
ALTER TABLE requests ADD COLUMN opportunity_stage TEXT DEFAULT 'new_lead';
ALTER TABLE requests ADD COLUMN execution_stage   TEXT DEFAULT 'not_started';
ALTER TABLE requests ADD COLUMN payment_status    TEXT DEFAULT 'unpaid'
  CHECK (payment_status IN ('unpaid','partial','paid','refunded'));
ALTER TABLE requests ADD COLUMN lost_reason_id  INTEGER;
ALTER TABLE requests ADD COLUMN closed_at       TEXT;
ALTER TABLE requests ADD COLUMN reopened_at     TEXT;
ALTER TABLE requests ADD COLUMN parent_request_id INTEGER REFERENCES requests(id);

CREATE INDEX IF NOT EXISTS idx_requests_branch_status ON requests(branch_id, status);
CREATE INDEX IF NOT EXISTS idx_requests_dept_updated  ON requests(department_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_requests_owner_due     ON requests(owner_id, due_at);
CREATE INDEX IF NOT EXISTS idx_requests_stage         ON requests(opportunity_stage, execution_stage);

-- ------------------------------------------------------------
-- 4. Assignment history and transfers
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS request_assignments (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id    INTEGER NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  user_id       INTEGER NOT NULL REFERENCES users(id),
  department_id INTEGER REFERENCES departments(id),
  assigned_by   INTEGER REFERENCES users(id),
  assigned_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ended_at      TEXT,
  is_current    INTEGER NOT NULL DEFAULT 1 CHECK (is_current IN (0,1))
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_assignments_current
  ON request_assignments(request_id) WHERE is_current = 1;
CREATE INDEX IF NOT EXISTS idx_assignments_user ON request_assignments(user_id, is_current);

CREATE TABLE IF NOT EXISTS request_transfers (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id        INTEGER NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  from_branch_id    INTEGER REFERENCES branches(id),
  from_department_id INTEGER REFERENCES departments(id),
  from_user_id      INTEGER REFERENCES users(id),
  to_branch_id      INTEGER REFERENCES branches(id),
  to_department_id  INTEGER REFERENCES departments(id),
  to_user_id        INTEGER REFERENCES users(id),
  reason            TEXT NOT NULL,
  note              TEXT,
  status            TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','accepted','rejected','returned')),
  decided_by        INTEGER REFERENCES users(id),
  decided_at        TEXT,
  rejection_reason  TEXT,
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_transfer_one_pending
  ON request_transfers(request_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_transfers_to   ON request_transfers(to_user_id, status);
CREATE INDEX IF NOT EXISTS idx_transfers_dept ON request_transfers(to_department_id, status);

-- ------------------------------------------------------------
-- 5. Parent/child requests, tasks, status history
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS request_subrequests (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  parent_request_id INTEGER NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  child_request_id  INTEGER NOT NULL UNIQUE REFERENCES requests(id) ON DELETE CASCADE,
  department_id     INTEGER REFERENCES departments(id),
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS request_tasks (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id    INTEGER NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  department_id INTEGER REFERENCES departments(id),
  title         TEXT NOT NULL,
  description   TEXT,
  assigned_to   INTEGER REFERENCES users(id),
  status        TEXT NOT NULL DEFAULT 'open'
                CHECK (status IN ('open','in_progress','done','blocked','cancelled')),
  due_at        TEXT,
  completed_at  TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_tasks_request ON request_tasks(request_id, status);
CREATE INDEX IF NOT EXISTS idx_tasks_owner   ON request_tasks(assigned_to, due_at);

CREATE TABLE IF NOT EXISTS request_status_history (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id INTEGER NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  layer      TEXT NOT NULL CHECK (layer IN ('opportunity','execution','payment')),
  from_value TEXT,
  to_value   TEXT NOT NULL,
  actor_id   INTEGER REFERENCES users(id),
  reason     TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_status_history ON request_status_history(request_id, created_at);

-- ------------------------------------------------------------
-- 6. Suppliers, quotations, payments
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS suppliers (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  code       TEXT UNIQUE,
  name       TEXT NOT NULL,
  type       TEXT,
  contact    TEXT,
  active     INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS quotations (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id  INTEGER NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  version     INTEGER NOT NULL DEFAULT 1,
  status      TEXT NOT NULL DEFAULT 'draft'
              CHECK (status IN ('draft','sent','accepted','rejected','expired')),
  currency    TEXT NOT NULL DEFAULT 'JOD',
  cost_total  REAL NOT NULL DEFAULT 0 CHECK (cost_total >= 0),
  sell_total  REAL NOT NULL DEFAULT 0 CHECK (sell_total >= 0),
  valid_until TEXT,
  note        TEXT,
  created_by  INTEGER REFERENCES users(id),
  sent_at     TEXT,
  decided_at  TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (request_id, version)
);
CREATE INDEX IF NOT EXISTS idx_quotations_status ON quotations(status, valid_until);

CREATE TABLE IF NOT EXISTS quotation_items (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  quotation_id INTEGER NOT NULL REFERENCES quotations(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL,
  supplier_id  INTEGER REFERENCES suppliers(id),
  description  TEXT,
  qty          REAL NOT NULL DEFAULT 1 CHECK (qty > 0),
  cost         REAL NOT NULL DEFAULT 0 CHECK (cost >= 0),
  price        REAL NOT NULL DEFAULT 0 CHECK (price >= 0),
  currency     TEXT NOT NULL DEFAULT 'JOD'
);

CREATE TABLE IF NOT EXISTS payments (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id   INTEGER NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  quotation_id INTEGER REFERENCES quotations(id),
  direction    TEXT NOT NULL CHECK (direction IN ('in','out')),
  method       TEXT,
  amount       REAL NOT NULL CHECK (amount > 0),
  currency     TEXT NOT NULL DEFAULT 'JOD',
  reference    TEXT,
  paid_at      TEXT,
  recorded_by  INTEGER REFERENCES users(id),
  approved_by  INTEGER REFERENCES users(id),
  note         TEXT,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_payments_request ON payments(request_id, created_at);

-- ------------------------------------------------------------
-- 7. Lost reasons, follow-ups, notifications
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lost_reasons (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  code     TEXT NOT NULL UNIQUE,
  label_ar TEXT NOT NULL,
  active   INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1))
);

CREATE TABLE IF NOT EXISTS follow_ups (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id INTEGER NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  owner_id   INTEGER REFERENCES users(id),
  due_at     TEXT NOT NULL,
  channel    TEXT,
  note       TEXT,
  done_at    TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_followups_due ON follow_ups(due_at, done_at);

CREATE TABLE IF NOT EXISTS notifications (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL,
  title      TEXT NOT NULL,
  body       TEXT,
  entity     TEXT,
  entity_id  INTEGER,
  read_at    TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, read_at);

-- ------------------------------------------------------------
-- 8. SLA and business hours
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sla_policies (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  department_id     INTEGER REFERENCES departments(id),
  priority          TEXT NOT NULL CHECK (priority IN ('low','normal','high','urgent')),
  first_response_min INTEGER NOT NULL DEFAULT 240,
  quotation_min     INTEGER NOT NULL DEFAULT 1440,
  follow_up_min     INTEGER NOT NULL DEFAULT 2880,
  resolve_min       INTEGER NOT NULL DEFAULT 10080,
  escalate_role_id  INTEGER REFERENCES roles(id),
  active            INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  UNIQUE (department_id, priority)
);

CREATE TABLE IF NOT EXISTS business_hours (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  branch_id  INTEGER NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  weekday    INTEGER NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  from_time  TEXT NOT NULL,
  to_time    TEXT NOT NULL,
  UNIQUE (branch_id, weekday)
);

-- ------------------------------------------------------------
-- 9. Immutable audit trail (new table; old audit_log stays)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_logs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  entity      TEXT NOT NULL,
  entity_id   INTEGER,
  action      TEXT NOT NULL,
  before_json TEXT,
  after_json  TEXT,
  reason      TEXT,
  actor_id    INTEGER REFERENCES users(id),
  actor_name  TEXT,
  ip          TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_logs(entity, entity_id, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_actor  ON audit_logs(actor_id, created_at);

CREATE TRIGGER IF NOT EXISTS trg_audit_no_update
BEFORE UPDATE ON audit_logs
BEGIN
  SELECT RAISE(ABORT, 'audit_logs is append-only');
END;

CREATE TRIGGER IF NOT EXISTS trg_audit_no_delete
BEFORE DELETE ON audit_logs
BEGIN
  SELECT RAISE(ABORT, 'audit_logs is append-only');
END;

-- ============================================================
-- 10. Reference seed (review the lists before running)
-- ============================================================
INSERT OR IGNORE INTO branches (code, name_ar, name_en, is_head_office, phone) VALUES
  ('IRB', 'فرع إربد', 'Irbid (Head Office)', 1, '02-7244112'),
  ('AMM', 'فرع عمّان', 'Amman Branch', 0, '06-4600777');

INSERT OR IGNORE INTO departments (code, name_ar, name_en) VALUES
  ('TKT', 'التذاكر', 'Ticketing'),
  ('VISA', 'التأشيرات', 'Visa'),
  ('UMR', 'الحج والعمرة', 'Hajj & Umrah'),
  ('HOL', 'العطلات والبرامج السياحية', 'Holiday'),
  ('ESA', 'شرق آسيا', 'East Asia'),
  ('CRS', 'رحلات الكروز', 'Cruise'),
  ('EVT', 'المؤتمرات والخدمات اللوجستية', 'Events & Logistics'),
  ('MKT', 'التسويق والمبيعات', 'Marketing & Sales'),
  ('B2B', 'الشركات والوكلاء', 'Corporate & B2B');

INSERT OR IGNORE INTO roles (code, name_ar, name_en) VALUES
  ('super_admin', 'مدير النظام', 'Super Admin'),
  ('general_manager', 'المدير العام', 'General Manager'),
  ('branch_manager', 'مدير الفرع', 'Branch Manager'),
  ('department_manager', 'مدير القسم', 'Department Manager'),
  ('team_leader', 'مشرف الفريق', 'Team Leader'),
  ('employee', 'موظف', 'Employee'),
  ('finance', 'المالية', 'Finance'),
  ('auditor', 'التدقيق', 'Auditor');

INSERT OR IGNORE INTO permissions (code, module, name_ar) VALUES
  ('users.manage','admin','إدارة المستخدمين'),
  ('roles.manage','admin','إدارة الأدوار'),
  ('branches.manage','admin','إدارة الفروع'),
  ('departments.manage','admin','إدارة الأقسام'),
  ('requests.read','requests','قراءة الطلبات'),
  ('requests.create','requests','إنشاء طلب'),
  ('requests.update','requests','تعديل الطلب'),
  ('requests.assign','requests','إسناد الطلب'),
  ('requests.transfer','requests','تحويل الطلب'),
  ('requests.accept_transfer','requests','قبول التحويل'),
  ('requests.change_opportunity','requests','تغيير مرحلة الفرصة'),
  ('requests.change_execution','requests','تغيير مرحلة التنفيذ'),
  ('requests.close_lost','requests','إغلاق كصفقة خاسرة'),
  ('requests.reopen','requests','إعادة فتح الطلب'),
  ('quotations.read','quotations','قراءة العروض'),
  ('quotations.write','quotations','إنشاء العروض'),
  ('quotations.read_cost','quotations','رؤية التكلفة والهامش'),
  ('quotations.approve','quotations','اعتماد العروض'),
  ('payments.read','payments','قراءة الدفعات'),
  ('payments.record','payments','تسجيل الدفعات'),
  ('payments.approve','payments','اعتماد الدفعات'),
  ('reports.read','reports','قراءة التقارير'),
  ('reports.export','reports','تصدير التقارير'),
  ('reports.profit','reports','تقارير الأرباح'),
  ('audit.read','audit','قراءة سجل التدقيق'),
  ('settings.manage','admin','إدارة الإعدادات');

INSERT OR IGNORE INTO lost_reasons (code, label_ar) VALUES
  ('price','السعر مرتفع'), ('competitor','العميل حجز لدى شركة أخرى'),
  ('unavailable','عدم توفر الخدمة'), ('late_reply','تأخر الرد'),
  ('unsuitable','عدم مناسبة البرنامج'), ('no_response','عدم استجابة العميل'),
  ('documents','عدم اكتمال المستندات'), ('other','سبب آخر');

-- role_permissions: intentionally minimal; complete the matrix in the admin UI.
INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p WHERE r.code = 'super_admin';

INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p
  ON p.code IN ('requests.read','requests.update','requests.assign','requests.transfer',
                'requests.accept_transfer','requests.change_opportunity','requests.change_execution',
                'requests.close_lost','requests.reopen','quotations.read','quotations.write',
                'quotations.approve','quotations.read_cost','payments.read','payments.approve',
                'reports.read','reports.export','reports.profit','audit.read','users.manage')
WHERE r.code = 'general_manager';
