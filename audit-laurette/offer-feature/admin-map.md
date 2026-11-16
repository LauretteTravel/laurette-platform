# خريطة طبقة الإدارة — أداة «مجموعة مبيعات واتساب» في لوحة تحكم لوريت

> تدقيق قراءة فقط. جميع الأرقام أدناه هي أرقام أسطر فعلية في نسخة الشجرة الحالية (توجد تعديلات غير ملتزمة لعمل workspace-v2 — لم تُمَس ولم يُحكم عليها).
> النطاق: تسجيل نقاط `/api/admin`، توقيعات الحماية والأذونات، حقول المستخدم من الجلسة، CRUD المعتمدة على spec لجدول `programs`، معالجة رفع الملفات، بنية `admin.js`، ملف العرض وCSS، ونمط الفحوص.

---

## 1) طبقة الخادم: بناء ctx والتوجيه

### 1.1 بناء ctx لكل طلب — server.js:359–397
`handle(req, res)` يبني كائن السياق الذي تستقبله كل نقطة نهاية:

```js
// server.js:378–390
const user = sessionUser(db, token);            // token من كوكي lt_session (COOKIE المعرفة في lib/api.js:17)
const clientUser = clientSessionUser(db, clientToken);
const settings = getSettings(db);
const ctx = {
  req, res, db, params: {}, query: Object.fromEntries(url.searchParams.entries()), lang, path: pathname,
  user, token, clientUser, clientToken, nonce, baseUrl, secure, ip: clientIp(req),
  settings, tracking,
};
```

الحقول المتاحة في `ctx`: `req, res, db, params, query, lang, path, user, token, clientUser, clientToken, nonce, baseUrl, secure, ip, settings, tracking`.

### 1.2 الموجّه العام — lib/http.js:206–238
`createRouter()` (تُستدعى في server.js:80) مع `get/post/patch/put/delete`. الأنماط تدعم `:param` (`[^/]+`) و`:rest*` (`.*`)، وتزيل `/` الزائدة نهاية المسار قبل المطابقة (lib/http.js:226). أرقام الأسطر: `compilePath` 199–205، `match` 226–236.

### 1.3 غلاف `api()` — server.js:141–167
```js
const api = (handler, { auth = false, action = null, limit = null } = {}) => async (ctx) => {
  if (limit) { /* RateLimiter من POST_LIMITS (server.js:141–152) */ }
  if (auth && !ctx.user) return json(ctx.res, 401, { ok: false, message: 'يلزم تسجيل الدخول' });
  if (action && !ctx.user) return json(ctx.res, 401, { ok: false, message: 'يلزم تسجيل الدخول' });
  return handler(ctx);
};
```
**مهم:** خيار `action` في التسجيل يفحص **وجود مستخدم فقط (401)**؛ فحص الصلاحية الفعلي (403) يتم داخل المعالج عبر `requireUser(ctx, '...')`. أي نقطة جديدة يجب أن تستدعي `requireUser` بنفسها.

### 1.4 حماية same-origin (بديل CSRF) — server.js:402–411
كل `/api/*` غير GET يتطلب `x-requested-with: 'fetch'` أو origin بنفس الموقع (استثناء جسر الإضافة بـ Bearer على `/api/save-chat`). غلاف `api()` في admin.js يرسل الترويسة دائماً.

### 1.5 جدول نقاط /api/admin (server.js:188–229)
| النقطة | الطريقة | المعالج | ملاحظة |
|---|---|---|---|
| `/api/admin/requests` | POST | `createInternalRequest` | `action: 'requests:write'` + حد معدل (188) |
| `/api/admin/overview` | GET | `overview` | `overview:read` (196) |
| `/api/admin/requests`, `/:id` | GET/PATCH | `listRequests/getRequest/updateRequest` | 197–199 |
| `/api/admin/requests/:id/transfers` + `/api/admin/transfers*` | POST/GET | `createRequestTransfer`… | 200–202 |
| `/api/admin/customers`, `/:id` | GET/PATCH | `listCustomers/getCustomer/updateCustomer` | 203–205 |
| **حلقة الموارد** `programs, offers, news, articles, faq, visa, kb, destinations, reviews` | GET/POST `/:resource` و PATCH/DELETE `/:resource/:id` | `listResource/createResource/updateResource/deleteResource` مع `resource` وسيطاً | **server.js:207–212** |
| `/api/admin/users` | GET/POST/PATCH | `listUsers/createUser/updateUser` | 214–216 |
| `/api/admin/organization` | GET | `organization` | 217 |
| `/api/admin/branches` / `departments` / `roles` | POST/PATCH | `createBranch/createDepartment/createRole/updateRole` | 218–221 |
| `/api/admin/audit` | GET | `auditLog` | 222 |
| `/api/admin/media` | GET | `listMedia` | 223 — قراءة فقط |
| `/api/admin/reports`, `reports.csv`, `tracking-events` | GET | `reports/reportsCsv/trackingEvents` | 224–226 |
| `/api/admin/settings` | GET/PATCH | `getSettings/updateSettings` | 227–228 |
| `/api/admin/assistant-log` | GET | `assistantLog` | 229 |

نقطة الدخول للوحة: `GET /admin` و`GET /admin/:rest*` تُرجع `adminShell(ctx)` (server.js:131–138، والدالة 493–527).

---

## 2) دوال الحماية والاستجابة في lib/api.js

### 2.1 ok / fail / COOKIE — lib/api.js:12–13, 17
```js
const ok = (res, data = {}, status = 200) => json(res, status, { ok: true, ...data });       // 12
const fail = (res, status, message, errors = null) => json(res, status, { ok: false, message, errors }); // 13
export const COOKIE = 'lt_session';                                                          // 17
```
`json()` في lib/http.js:85–96 يضع `content-type: application/json; charset=utf-8` و`cache-control: no-store`، ويترجم الرسائل للإنجليزية عبر `localizePayload` عند `res.lang === 'en'`.

### 2.2 requireUser — lib/api.js:104–119
```js
function requireUser(ctx, action) {
  if (!ctx.user) { fail(ctx.res, 401, 'يلزم تسجيل الدخول'); return null; }
  if (action && ctx.user.mustChange) { fail(ctx.res, 403, 'غيّر كلمة المرور المؤقتة للمتابعة'); return null; }
  if (action && !can(ctx.user, action)) { fail(ctx.res, 403, 'لا تملك صلاحية لهذا الإجراء'); return null; }
  return ctx.user;
}
```
النمط المعتمد في كل المعالجات: `const user = requireUser(ctx, 'x:y'); if (!user) return;`

### 2.3 can() — lib/auth.js:88–93 والأدوار الافتراضية 81–86
```js
export function can(user, action) {
  if (!user) return false;
  const perms = Array.isArray(user.permissions) ? user.permissions : (PERMISSIONS[user.role] || []);
  return perms.includes('*') || perms.includes(action);
}
```
```js
// lib/auth.js:81–86
const PERMISSIONS = {
  admin: ['*'],
  manager: ['requests:read','requests:write','customers:read','customers:write','programs:read','programs:write','content:write','visa:write','kb:write','audit:read','overview:read','reports:read'],
  agent: ['requests:read','requests:write','customers:read','customers:write','programs:read','overview:read','kb:write'],
};
```
ملاحظة: `manager/agent` الافتراضيون **لا يملكون** `users:write` و`settings:write` و`organization:*` و`reports:read` (المدير agent لا يرى التقارير؛ بينما manager الافتراضي يراها).

### 2.4 مساعدات النطاق — lib/api.js:120–165
- `requestScope(user, alias='r')` (120–134): يبني شرط SQL حسب `dataScope` — `organization` بلا قيد، `branch` → `branch_id = user.branchId`، `department` → `department_id`، `assigned` → المالك في أحد أعمدة `assigned_to/sales_owner_id/service_owner_id/execution_owner_id`. أي نطاق آخر/مستخدم بلا بيانات نطاق → `1 = 0`.
- `userScope(user, alias='u')` (135–145): نفس المنطق لجدول users (assigned → id = user.id).
- `canDelegateProfile(actor, profile)` (146–155): منع منح صلاحيات أوسع من صلاحيات المانح (ترتيب النطاق organization<branch<department<assigned + احتواء كامل للصلاحيات أو `'*'`).
- `scopeClause(scope, prefix=' AND ')` (156–158).

### 2.5 sessionUser — lib/auth.js:37–72 (بناء المستخدم من الجلسة)
```js
const row = one(db, `SELECT s.token_hash, s.expires_at, u.id, u.username, u.name, u.role, u.department, u.active,
    u.must_change, u.role_key, u.branch_id, u.department_id, r.name AS role_name, r.data_scope, r.permissions
    FROM sessions s JOIN users u ON u.id = s.user_id
    LEFT JOIN role_definitions r ON r.role_key = u.role_key AND r.active = 1
    WHERE s.token_hash = ?`, [tokenHash(token)]);
```
- انتهاء الصلاحية (8 ساعات، `SESSION_HOURS` سطر 5) أو `active = 0` → حذف الجلسة وإرجاع null (44–48).
- `permissions` تُفك JSON وتقبل فقط مصفوفة نصوص (50–60)؛ **دور مخصص (`role_key`) بلا صلاحيات فعالة → المستخدم null** (61).
- الكائن المرتجع (63–72):
```js
{ id, username, name, role, roleKey, roleName, department, departmentId, branchId,
  dataScope: row.data_scope || 'organization', permissions, mustChange }
```
**الحقول المتاحة من الجلسة: `id`, `roleKey`, `dataScope`, `permissions` (مصفوفة أو null), `branchId` (موجود فعلاً), و`departmentId`, `department`, `role`, `roleName`, `name`, `username`, `mustChange`.**

نفس الحقول تُعاد للواجهة من `login` (lib/api.js:50–68) و`me` (70–83). كوكي الجلسة: `Max-Age=8h, SameSite=Strict, HttpOnly, Secure(عند https)` (api.js:66). تخزين الجلسة هاش SHA-256 للتوكن في `sessions.token_hash` (auth.js:27–35).

---

## 3) ROLE_PERMISSIONS القائمة الكاملة — lib/api.js:1270–1274

```js
const ROLE_PERMISSIONS = [
  'overview:read', 'requests:read', 'requests:write', 'customers:read', 'customers:write',
  'programs:read', 'programs:write', 'content:write', 'visa:write', 'kb:write',
  'audit:read', 'reports:read', 'users:write', 'settings:write', 'organization:read', 'organization:write',
];
```
16 صلاحية. الاستخدام:
- `organization(ctx)` (api.js:1276–1289) يعيدها للواجهة مع `scopes: ['organization','branch','department','assigned']`.
- `createRole` (api.js:1329–1354) يرفض أي صلاحية خارج القائمة (سطر 1346–1348) ويرفض `'*'` للأدوار المخصصة (1349).
- **لإضافة صلاحية جديدة (مثل `sales-tool:read`): تضاف إلى `ROLE_PERMISSIONS` فقط**؛ الأدوار الجديدة تمنحها من شاشة الأدوار، ودور `admin` يملك `'*'` فيظهر تلقائياً. لاحظ: أسماء العرض العربية للأذونات موجودة في واجهة admin.js:930–937 (قاموس عرض فقط).

---

## 4) آلية CRUD المعتمدة على spec — lib/api.js:1077–1269

### 4.1 RESOURCES — 1077–1137
مواصفة `programs` (1078–1091):
```js
programs: {
  table: 'programs', permission: 'programs:write', readPermission: 'programs:read',
  fields: {
    slug: 'slug', legacyId: 'legacy_id', category: 'category', level: 'level', title: 'title', summary: 'summary',
    description: 'description', destination: 'destination', country: 'country', days: 'days', nights: 'nights',
    priceFrom: 'price_from', currency: 'currency', status: 'status', featured: 'featured', artKey: 'art_key',
    hotels: 'hotels', itinerary: 'itinerary', includes: 'includes', excludes: 'excludes', terms: 'terms',
    flights: 'flights', options: 'options', badges: 'badges', meals: 'meals', airline: 'airline',
    departureDates: 'departure_dates', mode: 'mode', route: 'route', sort: 'sort',
  },                                                                                                    // 1081–1086
  json: ['hotels','itinerary','includes','excludes','terms','flights','options','badges'],               // 1087
  required: ['title', 'category'],                                                                       // 1088
  types: { days: 'int', nights: 'int', priceFrom: 'float', featured: 'bool', sort: 'int' },              // 1089
},
```
الموارد الأخرى: `offers` (1092–1103، `content:write`)، `news` (1104–1107)، `articles` (1108–1111)، `faq` (1112–1115)، `visa` (1116–1119، `visa:write`)، `kb` (1120–1123، `kb:write`)، `destinations` (1124–1128)، `reviews` (1129–1133).

### 4.2 coerce — 1139–1177 (التحويل والتحقق)
```js
function coerce(spec, body) {
  const values = {}; const errors = {};
  for (const [key, column] of Object.entries(spec.fields)) {   // ← يمر على حقول الـspec فقط
    if (body[key] === undefined) continue;
    ... // int/float/bool: تحقق رقمي؛ json/list: سطر لكل عنصر، options/hotels لها محللات خاصة؛ نصوص: String(value).slice(0, 8000)
    values[column] = spec.json?.includes(key) ? JSON.stringify(value) : value;
  }
  return { values, errors };
}
```
**سلوك الحقول غير المعروفة: تُستثنى بصمت (لا تُرفض ولا تُخزن)** — لأن الحلقة تمر على مفاتيح `spec.fields` فقط وأي مفتاح آخر في الجسم يتجاهل. لا يوجد فحص «حقول غير معروفة» ولا خطأ 422 لها.

### 4.3 المعالجات الأربعة العامة
- `listResource` (1178–1185): `readPermission || permission`، ثم `SELECT * … ORDER BY id DESC LIMIT 500`.
- `createResource` (1186–1217): يقرأ JSON بحد **200KB** (`readJson(ctx.req, 200 * 1024)`)، يفحص `required` (422)، يوّلد slug تلقائياً من العنوان عند غيابه، يضيف `created_at/updated_at` لـ programs فقط، UNIQUE → 409 «المعرّف (slug) مستخدم مسبقًا»، ويسجل في `audit_log`.
- **`updateResource` (1218–1245) — نعم يوجد endpoint تحديث للبرامج حالياً: `PATCH /api/admin/programs/:id`** يُسجل عبر حلقة الموارد في server.js:207–212 (`router.patch('/api/admin/${resource}/:id', (ctx) => API.updateResource(ctx, resource))`). الواجهة تستدعيه من `openProgramForm` (admin.js:672). يبني `SET` من `coerce` فقط، يضيف `updated_at` لـ programs/articles/kb_docs، يرفض «لا يوجد تغيير» (400)، UNIQUE → 409.
- `deleteResource` (1246–1269): للبرامج المرتبطة بطلبات (بحث payload LIKE عن slug) يُأرشف بدل الحذف (`status='archived'`).

### 4.4 هل إضافة أعمدة جديدة تتطلب تعديل spec فقط؟
**لا — سطر واحد في الـspec لا يكفي وحده؛ يلزم أمران:**
1. **العمود في قاعدة البيانات**: `SCHEMA` في lib/db.js يُنفذ بـ `CREATE TABLE IF NOT EXISTS` (لا يعدل قاعدة موجودة). مخطط `programs` الحالي في lib/db.js:258–294 (يضم `image_url` في السطر ~280 بفضل الترحيل). الأعمدة تضاف عبر **قائمة الترحيل الإضافي** في openDb — lib/db.js:559–596:
```js
for (const [table, column, definition] of [
  ...
  ['programs', 'level', 'TEXT'],
  ['programs', 'image_url', 'TEXT'],
  ...
]) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some((c) => c.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}
```
2. **إدخال في `RESOURCES.<resource>.fields`** (+ `types` لو رقم/منطقي، + `json` لو قائمة) — بعدها يعمل POST/PATCH الجاهزان فوراً دون أي معالج جديد.

**تنبيه مهم (موجود فعلاً):** عمود `image_url` موجود في جدول programs وفي الرد العام `publicProgram` (lib/api.js:275: `imageUrl: p.image_url || null`) لكنه **غير موجود في `RESOURCES.programs.fields`** → لا يمكن ضبطه حالياً من اللوحة؛ إضافته سطر واحد في fields + حقل في `PROGRAM_FIELDS` بواجهة admin.js. أما عمود جديد كلياً (بوستر خاص/PDF) فيتطلب الترحيل الإضافي أعلاه + الإدخال في fields. لا يوجد endpoint تحديث برامج منفصل عن الآلية العامة — الاسم الداخلي `updateResource(ctx, 'programs')`.

---

## 5) معالجة رفع الملفات في المشروع

### 5.1 المشروع الجذري: لا يوجد أي رفع ملفات
- **لا محلل multipart إطلاقاً**: بحث `multipart|base64|Buffer.from|createWriteStream|busboy|formidable` في server.js وlib/ وtests/ → المشروع الجذري نظيف تماماً (`NO-WRITE-IN-LIB` عند فحص الكتابة في lib\*.js). `tools/*.mjs` تكتب ملفات بناء فقط (docs/seed/fonts) وليست وقت تشغيل.
- `readJson` (lib/http.js:192–204) يقبل **application/json فقط** وي رمي `415` لأي content-type آخر؛ `readBody` (184–190) يجمّع الطلب بحد افتراضي 64KB (ويستخدم 8KB للدخول، 32KB للطلبات، 200KB للموارد، 64KB للإعدادات).
- `listMedia` (lib/api.js:1544–1553): قراءة فقط لـ `public/media/offers` (jpg/png/webp المستثنى منها `-thumb.`) وتعيدها كمسارات `/media/offers/<file>`. صلاحية `content:write`.
- تقديم `public/media`: `serveStatic` (server.js:313–357) يخدم **GET/HEAD فقط** للمسارات التي تبدأ بـ `/assets/` أو `/media/` (server.js:394–397)، مع حماية path traversal (`file.startsWith(resolve(PUBLIC_DIR))`)، دعم Range، و`cache-control` (woff2 immutable، html/js/css no-cache، البقية أسبوع). خريطة MIME (server.js:19–33) **لا تضم `.pdf`** → أي PDF في public/media سيُقدَّم `application/octet-stream` (تنزيل لا عرض).
- الصور/البوسترات الحالية تُدار يدوياً داخل المستودع (public/media/{brand,hero,offers}) وتُختار في اللوحة عبر `<datalist id="mediaList">` يملؤه `/api/admin/media` (admin.js:815–822 داخل `openContentForm` عند tab offers) — أي «لصق رابط من مكتبة» لا رفع.

### 5.2 المرجع الجاهز داخل المستودع: تطبيق wt-os
يوجد سابقة كاملة للرفع عبر base64 في JSON (نفس النمط المقترح للبوستر/PDF):
- **wt-os/lib/programs.js `addSource` (≈562–685):** `readJson(ctx.req, 7 * 1024 * 1024)` ثم: تحقق صيغة base64 (`/^[A-Za-z0-9+/]*={0,2}$/`, الطول من مضاعفات 4، حد 7MiB)، فك التشفير وإعادة التحقق العكسي (`content.toString('base64') !== b.base64`)، حد فعلي 5MiB، تنظيف اسم الملف من محارف التحكم، **تحقق magic bytes**: `%PDF-` + `%%EOF` → pdf، `504b0304` → docx، ورفض أي آخر، مطابقة الامتداد، قفل تزامن `uploads`، فحص فيروسات `scanAttachment`، dedup بـ sha256، نصابات (20 مصدر/25MiB لكل برنامج، 100MiB كلي)، تخزين المحتوى **في قاعدة البيانات** (جدول program_sources) وتقديمه من الذاكرة (`ctx.res.end(Buffer.from(s.content))` ≈ سطر 701) لا من ملفات.
- **wt-os/lib/task-attachments.js (21–131):** نفس النمط للمرفقات (PDF/PNG/OGG) بفحوص magic bytes وحدود base64.
- **الواجهة:** wt-os/public/assets/js/admin.js:931 — `FileReader.readAsDataURL` ثم إرسال `{filename, base64}` إلى `POST /api/admin/tasks/:id/attachments`. نمط مماثل في wt-os/public/assets/js/program-workspace.js:417.
- الفحوص: wt-os/tests/phase2c.test.js (ملفات اصطناعية PDF/PNG/WAV، رفض base64 غير صالح، تجاوز الحجم).

**الخياران أمام أداة البيع الجديدة:** (أ) نمط wt-os: base64 في JSON + magic bytes + تخزين في قاعدة البيانات وتقديمها من نقطة API (آمن ولا يلمس القرص)؛ (ب) كتابة إلى `public/media/...` وقت التشغيل — **لا توجد سابقة له في المشروع** ويتطلب `writeFileSync` جديد وملاءمة خريطة MIME (إضافة `.pdf`) وحدود حجم؛ ملاحظة أن serveStatic يقدمه فوراً بلا صلاحيات.

---

## 6) public/assets/js/admin.js (1284 سطراً) — بنية الواجهة

### 6.1 أدوات عامة وحالة
- IIFE بـ `use strict` (2–3). مساعدات: `$`, `$$` (4–5)، `root = $('#adminRoot')` (6)، `esc` (7)، `num/dt/day` (8–10).
- **الحالة:** `const state = { user: null, section: 'overview', query: {}, overlay: null };` (13).
- **كائن المستخدم الحالي:** `state.user` — يُملأ من `POST /api/auth/login` (سطر 83: `state.user = data.user`) ومن `boot()` (سطر **1275**: `state.user = me.user` من `GET /api/auth/me`). **يضم `id` و`branchId` و`roleKey` و`dataScope` و`permissions` و`departmentId` و`department` و`roleName` و`mustChange`** (تطابق حقول `me` في api.js:78–82).
- `hasPermission(permission)` (14–22): يفحص `permissions` إن كانت مصفوفة (`'*'` أو الاسم)، وإلا يسقط على أدوار legacy لـ admin/manager/agent.

### 6.2 غلاف fetch — `api()` (24–42)
```js
async function api(path, options = {}) {
  const res = await fetch(path, {
    credentials: 'same-origin',                       // الكوكي تلقائياً
    headers: {
      ...(options.body ? { 'content-type': 'application/json' } : {}),
      'x-requested-with': 'fetch',                    // مطلوب لحارس same-origin في الخادم
      ...(options.headers || {}),
    }, ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) { const err = new Error(data.message || `خطأ ${res.status}`); err.status = res.status; err.data = data; throw err; }
  return data;
}
```

### 6.3 مساعد toast — `toast()` (44–58)
ينشئ `#toastStack` عند الحاجة (bottom-start RTL) ويضيف `.toast .toast-<kind>` مع أنواع `ok` (افتراضي) و`bad` و`warn`، إخفاء تلقائي بعد 3.8 ثانية. الأنماط: app.css:630–634. الاستخدام المتكرر: `toast(r.message || 'تم')` / `toast(e.message, 'bad')`.

### 6.4 لا يوجد مساعد نسخ للحافظة في admin.js
بحث `clipboard|copyText|execCommand` في admin.js → صفر نتائج. أنماط جاهزة في المستودع لإعادة الاستخدام:
- public/assets/js/app.js:267: `await navigator.clipboard.writeText(copy.dataset.copy);`
- public/assets/js/workspace.js:79: `await navigator.clipboard.writeText(url); toast('تم نسخ الرابط');` مع fallback `select()`.

### 6.5 الراوتر الداخلي والأقسام
- `SECTIONS` (94–110): 15 قسماً بـ `{id, label, icon, permission}`: overview، requests، voucher، reports، customers، **programs**، content، visa، kb، marketing، users، organization، settings، audit، assistant.
- `visibleSections()` (112–120): ترشيح بالصلاحيات (`'*'` أو الاسم) أو أدوار legacy.
- `renderShell()` (122–160): بناء الشريط الجانبي + `#view`، ربط `onNavClick` والخروج.
- `onNavClick` (210–217): يضبط `state.section` ويستدعي `loadSection()`.
- `loadSection()` (219–233): خريطة قسم→دالة عرض (`programs: renderPrograms`, `content: renderContent`, `visa/kb: () => renderResource(...)`, …). **إضافة قسم جديد لإداة البيع = إدخال في SECTIONS + إدخال في هذه الخريطة**.
- دوال العرض بالترتيب: renderVoucher (234)، renderOverview (245)، renderRequests (295)، openRequest (376)، renderCustomers (537)، openCustomer (556)، **renderPrograms (606)**، openProgramForm (643)، renderContent (757)، openContentForm (787)، renderResource (827)، openResourceForm (847)، renderUsers (872)، openUserForm (891)، renderOrganization (928)، renderReports (1059)، renderMarketing (1126)، renderSettings (1176)، renderAudit (1227)، renderAssistant (1235).
- drawer: `openDrawer(html)` (1245–1257)، `escClose` (1258)، `closeDrawer()` (1262–1270).
- `boot()` (1271–1281): `GET /api/auth/me` → `state.user` → `renderShell()`؛ مسار `/admin/voucher` يفتح قسم القسيمة مباشرة (1276).

### 6.6 عرض البرامج في لوحة الموظف — الموضع المطلوب للأزرار
**`renderPrograms()` (606–631)** تجلب `GET /api/admin/programs` وترسم **جدولاً** (`admin-table`) لا بطاقات، مع خلية أزرار لكل صف في **السطر 622**:
```js
<td class="btn-row"><button class="btn btn-ghost btn-sm" data-edit-program="${p.id}">تعديل</button><button class="btn btn-danger btn-sm" data-del-program="${p.id}">حذف</button></td>
```
والربط في 625–630 (`[data-new-program]`, `[data-edit-program]`, `[data-del-program]`). **لإضافة «نسخ رد جاهز / نسخ رابط» لكل برنامج: أزرار إضافية في خلية 622 + ربط بنمط `$$('[data-...]').forEach` في 625–630 + مساعد حافظة جديد (لا يوجد حالياً).**
- `PROGRAM_FIELDS` (579–604): حقول نموذج البرنامج (title, slug, category, level, status, summary, days, nights, priceFrom, artKey, destination, country, meals, airline, departureDates, hotels, options, itinerary, includes, excludes, terms, flights, badges, description) — **لا يضم imageUrl حالياً** رغم وجود العمود في القاعدة.
- `openProgramForm` (643–691): drawer + `fieldControl` (633–641 تدعم select/textarea/list/number و`datalist`)، حفظ عبر PATCH/POST `/api/admin/programs`.
- `renderContent/openContentForm` (757–826): tabs للمحتوى العام؛ offers يضيف datalist مكتبة البوسترات (815–822).

---

## 7) ملف العرض الإداري وCSS

- **لا توجد وحدة lib/views للإدارة.** هيكل لوحة الإدارة دالة `adminShell(ctx)` داخل server.js نفسه (493–527): صفحة HTML فارغة (`#adminRoot` + «جارٍ التحميل…») تحمّل:
  - CSS: `/assets/css/app.css`, `/assets/css/voucher.css`, `/assets/css/voucher-studio.css` (كلها بـ `?v=${ASSET_V}`) — أسطر 507–509.
  - JS: `/assets/js/admin.js`, `/assets/js/voucher-generator.js`, `/assets/js/voucher-studio.js` (بـ `nonce` و`defer`) — أسطر 517–519.
- `ASSET_V` (lib/views/layout.js:11): سلسلة mtimes لملفات الواجهة للكسر Cache — **إضافة CSS/JS جديد للوحة تتطلب إلحاقه بسلسلة ASSET_V** وإلا فلن يُحدَّث المخزن. lib/views/layout.js لا يحتوي شيئاً إدارياً آخر (فقط شريط الموقع العام الذي فيه رابط «دخول الموظفين» سطر 116).
- مواضع أنماط الإدارة في **public/assets/css/app.css**: shell والقائمة والجدول (488–524: `.admin-body/.admin-shell/.admin-side/.admin-nav/.admin-main/.admin-top/.toolbar/.admin-card/.admin-table`)، drawer وlogin (531–542)، toast (630–634). `.btn-row` وأزرار `.btn*` معرفة في نفس الملف (أقسام الأزرار العامة). voucher.css/voucher-studio.css تخدم أقسام القسيمة فقط.

---

## 8) نمط الفحوص — tests/api.test.js (875 سطراً)

- المشغّل: `node --test tests/api.test.js` (package.json scripts.test). قاعدة مؤقتة `data/test-<hex>.db` تُنشأ وتُمسح في `before/after` (أسطر 10، 50–70).
- **الإنشاء:** `createApp({ dbFile: DB, baseUrl: 'http://127.0.0.1:0', seed: testSeed, adminPassword: adminPass, sendVerificationEmail: async ({email, code}) => otpInbox.set(email, code) })` ثم `app.listen(0, '127.0.0.1')` (55–63). `adminUser = seed.users[0].username` و`adminPass = 'Test-Only-Admin-Password-42'` (14–15)، وtestSeed يزيل كلمات المرور من البذرة (16).
- **مساعد الطلب** `call()` (23–38): fetch مع `content-type: application/json` عند وجود body، **`x-requested-with: 'fetch'` لكل غير GET**، دعم `cookie/origin/headers`، و`redirect: 'manual'`.
- **مساعد الدخول** `login()` (41–44): `POST /api/auth/login` ثم `cookie = (res.headers.get('set-cookie') || '').split(';')[0]`.
- **جلسة المدير:** متغير `adminCookie` (20) يُملأ بكسول في أول اختبار يحتاجه: `if (!adminCookie) adminCookie = (await login(adminUser, adminPass)).cookie;` (210، 234، 263، 309، …). اختبار الجلسة الصريح (452–465): يؤكد `role: 'admin'`، `cookie` يطابق `/^lt_session=/`، `set-cookie` يحوي `HttpOnly` و`SameSite=Strict`، ثم `GET /api/auth/me` يرجع اسم المستخدم.
- نقاط نمطية جاهزة للنسخ: رفض بلا جلسة 401 (440–446)، إنشاء أدوار/أقسام مشروطة بالنطاق (467–520)، فحص تقارير وصلاحيات الموظف agent (263–275)، إعدادات وتتبع (295–312).
- **أي فحص لنقطة جديدة غير GET يمر عبر `call()` فيرسل ترويسة same-origin تلقائياً**؛ لا حاجة لأي إعداد إضافي.

---

## 9) خلاصة تصميمية جاهزة لأداة «مجموعة مبيعات واتساب»

1. **نقاط جديدة**: تسجيلها في server.js بمنطقة `/api/admin` بنمط `router.post('/api/admin/sales-kit/...', api(handler, { action: 'sales-tool:write' }))` + `requireUser(ctx, '...')` داخل المعالج (فحص الـaction في الغلاف 401 فقط).
2. **صلاحية جديدة**: أضفها إلى `ROLE_PERMISSIONS` (api.js:1270) وحدّث قاموس العرض في admin.js:930–937؛ دور admin يرثها بـ `'*'`.
3. **نصوص جاهزة/روابط**: إما مورد جديد في RESOURCES (يمنح CRUD كاملاً مجاناً عبر حلقة server.js:207–212) أو جدول مخصص؛ الأعمدة غير المعروفة تُستثنى بصمت، فإضافة حقل = ترحيل إضافي في lib/db.js:559–596 + إدخال في fields.
4. **رفع بوستر/PDF**: لا يوجد أي محلل multipart؛ النمط المتوقع هو base64 في JSON على نهج wt-os/lib/programs.js addSource (حدود + magic bytes `%PDF-`/`%%EOF` + dedup sha256) مع قراءة من `readJson(req, N*1024*1024)`. إن خُزنت في public/media فلا تنسَ: MIME بلا `.pdf` (server.js:19–33) وserveStatic يقدمها للعامة.
5. **أزرار لكل برنامج**: خلية الأزرار في admin.js:622 داخل `renderPrograms` (606)؛ state.user يوفر `id/branchId/dataScope/permissions` للتخصيص حسب الموظف.
6. **نسخ للحافظة**: غير موجود في admin.js — انقل نمط app.js:267 أو workspace.js:79 (`navigator.clipboard.writeText` + toast) كمساعد جديد بجانب `toast()`.
7. **اختبارات**: انسخ نمط `call/login/adminCookie` من tests/api.test.js (23–44، 452–465) — جلسة المدير `lt_session` httpOnly SameSite=Strict.
