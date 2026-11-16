# خريطة طبقة البيانات — ميزة العروض على جدول programs

- **الوكيل:** مستكشف قراءة فقط (audit-laurette / offer-feature)
- **التاريخ:** 2026-11-14
- **الهدف:** تخطيط إضافة أعمدة لجدول `programs` (المطلوب: department, poster_image, pdf_brochure_url, pricing_tiers_json, itinerary_json, views_count — وslug موجود أصلاً) وربما `whatsapp_phone` للموظفين.
- **المنهجية:** قراءة `lib/db.js` و`lib/api.js` و`lib/domain.js` و`lib/util.js` و`server.js` (عبر PowerShell لأنه hardlink) و`lib/views/public.js` + استعلام **نسخة مؤقتة** من `data/laurette.db` في `%TEMP%\laurette-audit\laurette.db` للقراءة فقط (الأصل لم يُلمس؛ شمل نسخ `-wal` و`-shm`).
- **ملاحظة شجرة العمل:** توجد تعديلات غير ملتزمة (git status): `lib/db.js` و`lib/api.js` و`server.js` وغيرها معدّلة، وجداول `workspace_*` الستة الموجودة في القاعدة الفعلية هي من عمل workspace-v2 الجاري — ذُكرت للأمانة فقط ولا تدخل في نطاق الحكم.
- **رموز الثقة:** ✅ متحقق من الكود/القاعدة، 🔎 مستنتج، ❓ غير معروف.

---

## 0) ملخص تنفيذي

| الحقيقة | القيمة | المصدر |
|---|---|---|
| جدول programs | 34 عموداً في SCHEMA وفي القاعدة الفعلية تطابق تاماً؛ 75 صفاً | db.js:258-295 ✅ |
| slug | موجود: `slug TEXT UNIQUE NOT NULL` | db.js:260 ✅ |
| itinerary | **موجود أصلاً** كعمود JSON: `itinerary TEXT NOT NULL DEFAULT '[]'` | db.js:278 ✅ |
| programs_en | **غير موجود** (لا في SCHEMA ولا في القاعدة؛ grep بلا نتائج) | grep lib ✅ |
| الهجرة الإضافية | قائمة `[table, column, definition]` داخل `openDb` في db.js:563-601 | ✅ |
| أمان إعادة التشغيل | نعم — تحقق `PRAGMA table_info` قبل كل `ALTER TABLE ADD COLUMN` | db.js:599-600 ✅ |
| فقد بيانات عند الهجرة | لا — إضافة أعمدة فقط (ALter ADD COLUMN) على قاعدة موجودة | db.js:600 ✅ |
| users.phone | موجود (`phone TEXT`, سطر 19) | db.js:19 ✅ |
| users.branch_id | موجود (تضاف بالهجرة، سطر 565) | db.js:565 ✅ |
| branches.phone / slug | غير موجودين؛ المعرّف الوظيفي هو `code` | db.js:28-36 ✅ |
| poster/pdf كأعمدة | لا يوجد أي عمود poster أو pdf في أي جدول | grep ✅ |
| seed programs | من `data/seed.json` (version=6، programs@108)؛ **يُحذف ويعاد إدخاله** عند تغيّر الإصدار فقط | db.js:765-800 ✅ |

---

## 1) جدول programs كاملاً — lib/db.js:258-295 (اقتباس حرفي)

```sql
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
```

**التحقق من القاعدة الفعلية (PRAGMA table_info على النسخة المؤقتة):** 34 عموداً مطابقة حرفياً؛ الفهارس الفعلية: `sqlite_autoindex_programs_1` (بسبب UNIQUE slug)، `idx_programs_cat`، `idx_programs_price`. عدد الصفوف: **75**. عيّنة: `umrah-p1/p2/p3` (category=umrah, published, price_from=419/425/460, image_url موجود).

### لا يوجد programs_en
- ❌ لا يوجد `CREATE TABLE programs_en` في SCHEMA، ولا في القاعدة الفعلية (قائمة الجداول الفعلية 38 جدولاً)، وgrep على `programs_en|programsEn` في lib بلا نتائج. ✅
- **كيف تعمل الثنائية اللغوية إذن:** محتوى البرامج عربي في القاعدة في النسختين؛ صفحات `/en` تُولّد نفس HTML ثم تُعالَج عبر `localizeHtml` (server.js:94، وctx.lang من server.js:364-373) بترجمة نصوص الواجهة عبر `lib/i18n-en.json` و`/i18n/en.json` (server.js:245). أي عمود عنوان/وصف إنجليزي جديد سيكون نمطاً جديداً لا precedents له.

### كيف تقرأه الواجهة
- **عام (API):** `GET /api/programs` (server.js:190) → `listProgramsApi` (api.js:255-262) → `searchPrograms` (domain.js:463-488): `SELECT * FROM programs WHERE status IN ('published','sold_out')` + فلاتر category/price/days/route/mode وترتيب افتراضي `featured DESC, sort ASC, price_from ASC` → `hydrateProgram` (domain.js:490-504) يفك JSON للحقول (hotels, itinerary, includes, excludes, terms, flights, options, badges) → `publicProgram` (api.js:271-280) يُصيغ camelCase ويضيف `url: /programs/${slug}`.
- **تفاصيل:** `GET /api/programs/:slug` (server.js:191) → `getProgramApi` (api.js:264-269) → `programBySlug` (domain.js:506-508): `SELECT * FROM programs WHERE slug = ?`. والمسار العام `/programs/:slug` (server.js:112) → `programPage` (views/public.js:455-464).
- **صفحات:** `/programs` (server.js:109 → programsPage، views/public.js:375-386)، `/programs/print` (server.js:108 → programsPrintPage، views/public.js:831-842)، `/umrah` (views/public.js:620-627)، `/hotels` (views/public.js:760-767)، sitemap (server.js:260-266).
- **إداري:** server.js:207 يركّب CRUD عام لمورد `programs` → `RESOURCES.programs` (api.js:1078-1090): الحقول المسموحة slug/legacyId/category/level/title/summary/description/destination/country/days/nights/priceFrom/currency/status/featured/artKey/hotels/itinerary/includes/excludes/terms/flights/options/badges/meals/airline/departureDates/mode/route/sort؛ `json: ['hotels','itinerary','includes','excludes','terms','flights','options','badges']`؛ مطلوب title+category. **ملاحظة مصيرية: لا يوجد `imageUrl` في RESOURCES.programs** (بينما offers يتضمنها في api.js:1093-1102) — أي أن image_url للبرامج لا يُدار إدارياً حالياً ويُبذر من seed فقط. slug يتولد تلقائياً من العنوان عند غيابه (api.js:1196 داخل createResource: `slugify(body.title || ...)`).
- **حذف ناعم:** `deleteResource` (api.js:1246-1261): إذا كان البرنامج مرتبطاً بطلبات (فحص `payload LIKE '%"programSlug":"<slug>"%'`) يُؤرشف: `UPDATE programs SET status='archived'` بدل الحذف (api.js:1252-1258). 🔎 الربط بين الطلبات والبرامج نصي داخل payload لا بمفتاح خارجي.

---

## 2) آلية الهجرة الإضافية التراكمية — lib/db.js داخل openDb (السطر 520)

**الاسم:** لا اسم مستقل — حلقة inline داخل `openDb` (تسمية التكليف: القائمة التراكمية). **الموقع بالضبط:** القائمة db.js:563-598، جسم الحلقة 599-601، بعد هجرة rebuild الخاصة بـcruise (524-562) وقبل بذر الفروع/الأقسام (602+).

### الاقتباس الحرفي للقائمة والحلقة (db.js:563-601)

```js
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
    ['whatsapp_chat_imports', 'analysis_json', 'TEXT'],
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
```

### كيف تُطبق عند الإقلاع
- server.js:66-75 (`createApp`): `openDb(dbFile)` في سطر 69 (dbFile الافتراضي `data/laurette.db` سطر 67) قبل كل شيء، ثم `seedDatabase` في سطر 74. أي أن الهجرة تُنفذ على **كل إقلاع** للسيرفر.
- **آمنة لإعادة التشغيل؟ نعم ✅** — الشرط `if (!cols.some((c) => c.name === column))` يجعلها idempotent: العمود الموجود يُتخطى.
- **على قاعدة موجودة بلا فقد؟ نعم ✅** — `ALTER TABLE ADD COLUMN` إضافة بحتة، لا يمس الصفوف. القاعدة الفعلية تؤكد النتيجة: users فيها role_key/branch_id/department_id وrequests فيها client_id مضافة بهذه الآلية.
- **أسبقية مباشرة للمطلوب:** القائمة تضيف أصلاً `['programs','level','TEXT']` و`['programs','image_url','TEXT']` (db.js:568-569) — الأعمدة الجديدة تُلحق بنفس الصيغة.

### ما قبلها: هجرة requests/cruise (db.js:524-562) — ليست إضافية بحتة
إذا كان SQL جدول requests لا يحتوي `'cruise'` (فحص sqlite_master، سطر 525): تُبنى `requests_new` من SCHEMA، مع **نسخة احتياطية كاملة قبل أي خطوة** (`VACUUM INTO ?` إلى `data/backups/<db>.before-requests-cruise-migration.<ts>.<hex>.sqlite`، أسطر 529-537، تعليق "DB-2: restorable full-database snapshot")، ثم داخل معاملة `BEGIN IMMEDIATE` مع `PRAGMA foreign_keys=OFF`: نسخ كل الأعمدة المشتركة `INSERT INTO requests_new (...) SELECT ... FROM requests` (544-548)، إسقاط القديم وإعادة التسمية (549-550). تُنفذ مرة واحدة فقط (شرط الفحص يجعلها no-op لاحقاً).

### ما بعدها داخل openDb (سياق يجب ألا يُكسر)
بذر فرعي إربد/عمّان (603-607)، 9 أقسام افتراضية + اشتقاق أقسام من users/requests (608-627)، دمج aliases للأقسام القديمة (629-680)، backfill لـlead_origin وdepartment_id حسب النوع وreceived_branch_id (681-697)، 5 أدوار مدمجة role_definitions (698-709)، فهارس (710-714)، backfill لـdeal_status/completed_at (715-726).

---

## 3) الدوال المساعدة — lib/db.js:730-751 (اقتباس حرفي)

```js
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
```

⚠️ **تنبيه تسمية:** التكليف ذكر one/all/run؛ الأسماء الفعلية في الكود هي `one` / `q` (بديل all — تعيد كل الصفوف) / `exec` (بديل run). كما توجد `setting`/`setSetting` (754-762) لقراءة/كتابة جدول settings بـJSON.

**التوقيعات:** `q(db, sql, params=[]) → صفوف[]`، `one(db, sql, params=[]) → صف|null`، `exec(db, sql, params=[]) → نتيجة run (lastInsertRowid/changes)`، `transaction(db, fn) → نتيجة fn مع BEGIN/COMMIT/ROLLBACK`.

**الاستخدام في lib/api.js (نمط ctx.db):** ctx يُبنى في server.js:382-386 ويمرر db.
- قراءة قوائم: `q(ctx.db, 'SELECT ...')` — api.js:581 (tracking_events)، 597-604 (طلبات)، 340-342 (overview).
- صف واحد: `one(ctx.db, 'SELECT ... WHERE id = ?')` — api.js:1224 (updateResource)، 1253 (deleteResource)، 245 (تتبع بالمرجع).
- كتابة: `exec(ctx.db, 'INSERT INTO tracking_events ...')` — api.js:566؛ `exec(ctx.db, sql, params)` للتحديث المولّد — api.js:1237، 1258.
- في domain.js: `exec(db, INSERT INTO requests ...)` (370-376)، `one(db, 'SELECT ... slug = ?')` (domain.js:507)، `q(db, 'SELECT * FROM programs ...')` (486).
- في views: `q(db, ...)`/`one(db, ...)` مباشرة (views/public.js:102، 386، 459، 623، 836-837).

---

## 4) جدولا users وbranches

### users — db.js:13-26 (اقتباس حرفي)

```sql
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
```

- **الهاتف موجود ✅**: `phone TEXT` (سطر 19) — يُعبأ عند البذر من seed (db.js:865-866 يمرر `u.phone`). إذاً `whatsapp_phone` للموظفين **مغطى عملياً بـusers.phone** إلا إذا طُلب رقم واتساب مستقل عن الهاتف — عندها يُضاف بنمط القائمة (مثل `['users','whatsapp_phone','TEXT']`).
- **branch_id موجود ✅**: يضاف بالهجرة `['users','branch_id','INTEGER REFERENCES branches(id) ON DELETE SET NULL']` (db.js:565)، وكذلك `department_id` (566) و`role_key` (564). PRAGMA الفعلي: 15 عموداً (12 SCHEMA + الثلاثة).
- runtime: صف واحد (admin فقط).

### branches — db.js:28-36 (اقتباس حرفي)

```sql
CREATE TABLE IF NOT EXISTS branches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL UNIQUE,
  is_primary INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

- **لا يوجد عمود هاتف، ولا slug** — المعرّف الوظيفي/الشفهي هو `code` (irbid, amman) و`name` فريد (إربد، عمّان). runtime: 7 أعمدة، صفان: irbid (is_primary=1)، amman (is_primary=0) — يُبذران في كل إقلاع بـ`INSERT OR IGNORE` + تحديث is_primary (db.js:603-607).
- 🔎 لإضافة هاتف فرع لاحقاً: نمط القائمة يكفي (`['branches','phone','TEXT']`).

### departments (ذو صلة بعمود department المطلوب للبرامج) — db.js:38-53
`departments(id, name NOT NULL, branch_id→branches ON DELETE SET NULL, active, created_at, updated_at, UNIQUE(name, branch_id))` + فهرس فريد `idx_departments_scope_name(name, COALESCE(branch_id,0))` (سطر 47)، و`department_aliases(department_id, legacy_name UNIQUE, created_at)` (48-53). أقسام افتراضية 9 تُبذر كل إقلاع (608-621). 🔎 عمود `programs.department` النصي المطلوب سيوازي `requests.department` النصي (db.js:138) مع وجود `requests.department_id` (db.js:132) كبديل مرجعي — النمط المعمول به في هذا المشروع هو النسختان معاً.

---

## 5) جدول requests كاملاً + توليد الرقم المرجعي

### requests — db.js:120-154 (اقتباس حرفي للأعمدة)

```sql
CREATE TABLE IF NOT EXISTS requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reference TEXT UNIQUE NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('flight','hotel','program','umrah','visa','consult','cruise')),
  status TEXT NOT NULL DEFAULT 'new',
  deal_status TEXT NOT NULL DEFAULT 'new',
  completed_at TEXT,
  first_response_at TEXT,
  customer_id INTEGER REFERENCES customers(id),
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
```

- عمود إضافي بالهجرة: `client_id INTEGER REFERENCES clients(id) ON DELETE SET NULL` (db.js:574؛ مؤشر `idx_requests_client` سطر 710). PRAGMA الفعلي: 31 عموداً مطابقاً. runtime: **0 طلبات**.

### توليد الرقم المرجعي — lib/util.js:94-104 (اقتباس حرفي)

```js
export function reference(type) {
  const prefix = { flight: 'FL', hotel: 'HT', program: 'PG', umrah: 'UM', visa: 'VS', consult: 'CS', cruise: 'CR' }[type] || 'RQ';
  const buf = new Uint8Array(4);
  crypto.getRandomValues(buf);
  const body = [...buf].map((b) => b.toString(36).toUpperCase().padStart(2, '0')).join('').slice(0, 6);
  return `LT-${prefix}-${body}`;
}

export function referenceValid(value) {
  return /^LT-(FL|HT|PG|UM|VS|CS)-[A-Z0-9]{6}$/.test(String(value || ''));
}
```

الصيغة: `LT-<بادئة النوع>-<6 محارف base36>` (مثال: `LT-PG-XXXXXX`). 🔎 **ملاحظة محايدة:** `referenceValid` (util.js:103) لا يشمل بادئة `CR` (cruise) في النمط — رصد فقط، لا حكم.

### كود الإدراج — lib/domain.js:366-396 (داخل createRequest، اقتباس حرفي للجوهر)

```js
  let lastError;
  for (let attempt = 0; attempt < 4; attempt++) {
    const ref = reference(type);
    try {
      const res = exec(db, `INSERT INTO requests
        (reference, type, status, customer_id, client_id, branch_id, received_branch_id, assigned_to, service_owner_id,
         department, department_id, title, summary, payload, source, lead_origin, consent, created_at, updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [ref, type, 'new', customerId, meta.clientId || null, meta.branchId || null, meta.branchId || null,
        meta.assignedTo || null, meta.assignedTo || null, departmentName, departmentId, title, summary, JSON.stringify(payload),
        meta.source || 'website', meta.source || 'website', value.consent ? 1 : 0, now, now]);
      const id = Number(res.lastInsertRowid);
      if (meta.assignedTo) {
        exec(db, `INSERT INTO request_owner_history
          (request_id, owner_type, previous_value, next_value, changed_by, note, created_at)
          VALUES (?, 'assigned', NULL, ?, ?, 'إسناد عند الإنشاء', ?)`, [id, String(meta.assignedTo), meta.actorId, now]);
      }
      addEvent(db, id, {
        kind: 'created', actorId: meta.actorId || null,
        message: meta.internal ? 'سجّل الموظف الطلب' : 'تم إنشاء الطلب من الموقع',
        actorName: meta.actorName || (meta.internal ? 'موظف' : 'الموقع'),
        meta: { type, branchId: meta.branchId || null },
      });
      return { ok: true, id, reference: ref, summary, duplicate: false, value: Number(value.priceFromAtRequest) || 0 };
    } catch (err) {
      lastError = err;
      if (!String(err.message).includes('UNIQUE')) throw err;
    }
  }
  throw lastError;
```

- 🔎 إعادة المحاولة حتى 4 مرات عند تعارض UNIQUE (تصادم المرجع العشوائي). `addEvent` (domain.js:398+) يدرج في request_events (db.js:156-164: request_id, actor_id, actor_name, kind, message, meta, created_at).
- البادئات والقسم الافتراضي لكل نوع: REQUEST_TYPES (domain.js:4-12).
- القراءة بالمرجع: api.js:242-251 (`SELECT id, payload FROM requests WHERE reference = ?`) وdomain.js:411-413 (`publicStatus`).

---

## 6) جدول tracking_events — db.js:498-506 (اقتباس حرفي)

```sql
CREATE TABLE IF NOT EXISTS tracking_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event TEXT NOT NULL,
  type TEXT,
  path TEXT,
  meta TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tracking_created ON tracking_events(created_at DESC);
```

### مواضع الكتابة والقراءة
- **الكتابة (الموضع الوحيد):** `trackEvent` في lib/api.js:561-575 — نقطة نهاية عامة POST (event مقيد بـ`allowed = new Set(['lead', 'whatsapp_click', 'page_view', 'cta_click'])` سطر 563) ثم:

```js
  exec(ctx.db, 'INSERT INTO tracking_events (event, type, path, meta, created_at) VALUES (?,?,?,?,?)', [
    event,
    body.type ? String(body.type).slice(0, 30) : null,
    body.path ? String(body.path).slice(0, 200) : null,
    body.meta ? JSON.stringify(body.meta).slice(0, 1000) : null,
    isoNow(),
  ]);
```

- **القراءة:** `trackingEvents` (api.js:577-584) — تقرير إداري يتطلب `overview:read` وعلى مستوى الإدارة فقط: آخر 100 حدث + عدّ آخر 7 أيام.
- runtime: **0 صفوف** (الجدول فارغ في النسخة الحالية). 🔎 عمود `views_count` المقترح على programs لا يوازي tracking_events — هذه الأخيرة سجل أحداث وليست عدّاداً لكل كائن.

---

## 7) seedDatabase وسلوكه مع البيانات الموجودة — db.js:764-874

### الحارس (اقتباس حرفي، db.js:765-766)

```js
  const marker = one(db, "SELECT value FROM meta WHERE key = 'seed_version'");
  if (marker && marker.value === String(seed.version)) return { seeded: false, reason: 'already-seeded' };
```

### ماذا يحدث عند توقّع الإصدار؟
- **نفس الإصدار (الحالة الحالية: meta.seed_version='6' = seed.json version '6'):** يُرجع `{seeded:false, reason:'already-seeded'}` — **لا يلمس شيئاً إطلاقاً**؛ برامج الإدارة وكل البيانات تبقى كما هي عند إعادة الإقلاع. ✅
- **إصدار جديد من seed.json:** داخل `transaction(db, insertAll)` (سطر 872) يُحذف المحتوى المرجعي ويعاد إدخاله (اقتباس 771-783):

```js
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
```

ثم إعادة إدخال كل برنامج (785-800) بالأعمدة: `(slug, legacy_id, category, level, title, summary, description, destination, country, days, nights, price_from, currency, status, featured, art_key, image_url, hotels, itinerary, includes, excludes, terms, flights, options, badges, meals, airline, departure_dates, mode, route, sort, created_at, updated_at)` مع `p.imageUrl || null` و`p.artKey || 'haram'`. التعليق الحرفي سطر 770: `// Insert reference data without touching operational data (requests, customers, audit).`
- **users:** upsert لا حذف — `if (exists) continue;` (859-861)، إدراج بـphone (865-866).
- **meta:** يكتب `seed_version` و`seeded_at` (869-870).
- **الاستدعاء:** server.js:72-74 (`loadSeed(data/seed.json)` ثم `seedDatabase(db, seed, hashPassword, adminPassword)`).
- **seed.json:** `version: "6"` (سطر 2) و`"programs": [` تبدأ سطر 108.
- ⚠️ **خلاصة للمصمم:** أي تعديل إداري على البرامج سيضيع عند أول رفع لإصدار seed جديد (DELETE + إعادة إدخال). وأي أعمدة جديدة لـprograms يجب تعديل INSERT هذا (786-800) وإلا ستُترك بقيمها الافتراضية عند كل بذر مستقبلي.

---

## 8) أعمدة slug / poster / pdf / صور في بقية الجداول (جرد كامل من SCHEMA + grep)

| الجدول | الأعمدة ذات الصلة | الأسطر |
|---|---|---|
| programs | `slug UNIQUE NOT NULL`، `art_key`، `image_url` | 260، 275، 276 |
| offers | `slug UNIQUE`، `art_key`، `image_url`، `image_alt` | 299، 302، 303، 304 |
| destinations | `slug UNIQUE NOT NULL`، `parent_slug`، `map_url`، `art_key`، `image_url`، `name_en` | 340، 344، 348، 349، 350، 342 |
| articles | `slug UNIQUE NOT NULL` | 356 |
| trip_ideas | `slug UNIQUE NOT NULL`، `itinerary`، `image_url` | 454، 462، 464 |
| hotel_guides | `city_slug` | 432 |
| bookings | `reference TEXT NOT NULL UNIQUE` (لا صور) | 205-217 |
| booking_payments | `reference TEXT` عادي (لا فريد) | 219-230 |
| news / reviews / faq / visa_rules / kb_docs / airlines / settings / tracking_events / assistant_* | لا slug ولا صور | — |

- **poster:** ❌ لا يوجد أي عمود poster في أي جدول. «poster» يظهر فقط في: مفتاح settings `heroPosterUrl` (seed.json settings؛ ضمن القائمة المسموحة للإعدادات api.js:1576؛ استخدام views/public.js:113-114) ومكوّن عرض `offerPosterCard` للعروض (views/layout.js:294-318) الذي يعرض offers عبر image_url/art_key.
- **pdf:** ❌ لا يوجد أي عمود pdf في أي جدول (grep pdf في lib: فقط «طباعة / حفظ PDF» في views/public.js:871، 882 — كتالوج للطباعة من المتصفح).
- **جداول workspace_* الستة** (عمل غير ملتزم، موجودة في القاعدة الفعلية: workspace_notifications, workspace_notification_reads, workspace_offers, workspace_templates, workspace_vouchers, workspace_booking_details): grep على lib/workspace-db.js لـslug|pdf|poster|image بلا نتائج.

---

## 9) نقاط انتباه للتصميم (خارج نطاقي التنفيذي — اقتراحات فقط)

1. **itinerary موجود أصلاً** (db.js:278) بنمط `TEXT NOT NULL DEFAULT '[]'` — المطلوب «itinerary_json» قد يعني عموداً منفصلاً ببنية مختلفة (أسعار+أيام)؛ يجب تسمية صريحة لتجنب الالتباس مع الموجود.
2. نمط الأعمدة الجديدة المتسق مع المشروع: إلحاقها بقائمة db.js:563 (مثال: `['programs','poster_image','TEXT']`، `['programs','pdf_brochure_url','TEXT']`، `['programs','pricing_tiers_json',"TEXT NOT NULL DEFAULT '[]'"]`، `['programs','views_count','INTEGER NOT NULL DEFAULT 0']`) **مع** تحديث SCHEMA (258-293) لتغطية القواعد الجديدة، وRESOURCES.programs.fields (api.js:1080-1086) للإدارة، وINSERT seed (db.js:786-800)، وpublicProgram (api.js:271-280) للعرض العام.
3. RESOURCES.programs لا يدير image_url حالياً — إضافة poster_image تستلزم إضافتها للحقول الإدارية وإلا لن يُديرها أحد من اللوحة.
4. users.phone موجود — whatsapp_phone للموظفين غير ضروري إلا إذا أُريد رقماً مستقلاً.
5. views_count يحتاج نقطة نهاية تحديث آمنة من الإساءة (trackEvent الحالي يكتب في tracking_events فقط ولا يعدّل programs).
6. الربط الطلبات↔البرامج نصي عبر payload.programSlug (api.js:1255) — أي عمود department جديد سيوازي النمط النصي department/department_id في requests.

---

## 10) الحالات المجمعة حسب الثقة

- **متحقق ✅:** كل الاقتباسات أعلاه بأرقام أسطرها؛ تطابق SCHEMA مع القاعدة الفعلية عبر PRAGMA (نسخة %TEMP% فقط)؛ عدد الصفوف والفهارس؛ غياب programs_en وpdf وposter كأعمدة؛ سلوك seedDatabase بالكود؛ مسارات القراءة في api/server/views؛ حالة git (ملفات معدلة غير ملتزمة بينها db.js وapi.js وserver.js).
- **مستنتج 🔎:** دلالة الربط النصي payload↔programSlug؛ أن localizeHtml يترجم نصوص الواجهة دون محتوى القاعدة (مستنتج من server.js:94 وbuild i18n)؛ كفاية users.phone لغرض واتساب الموظفين.
- **غير معروف ❓:** محتوى seed.json الكامل لكل برنامج (75 برنامجاً لم تُفحص حقليةً واحدة واحدة — فحصت البنية والسطر البادئ فقط)؛ أي قيم حالية في users.phone؛ سلوك الإنتاج على Render (render.yaml hardlink لم يُفحص تفصيلاً — خارج النطاق).
