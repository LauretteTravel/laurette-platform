# تدقيق الأمان والصلاحيات وسجل التدقيق — المواصفة §17

- **التاريخ:** 2026-10-31
- **النطاق المفحوص:** `lib/auth.js`، `lib/http.js`، `server.js`، `lib/api.js`، مع `lib/db.js` و`lib/domain.js` و`lib/client-api.js` و`lib/whatsapp.js` و`lib/assistant.js` و`tests/api.test.js`.
- **الحالة المفحوصة:** شجرة العمل على الفرع `feature/laurette-crm` عند الالتزام `2a09e7c`؛ ملفات الأمان المدققة غير معدّلة محليًا (التعديلات المحلية غير المنشورة تخص ملفات العرض فقط: `lib/views/public.js`، `public/assets/js/account.js`، `public/assets/js/app.js`).
- **المنهجية:** قراءة كاملة للملفات + تتبع كل مسار + بروب node قصير على قاعدة مؤقتة `data/tmp-audit-probe.db` (أُنشئت ثم حُذفت مع سكربت البروب). أدلة البروب موسومة بـ«[بروب]». ملاحظة تنظيف: أثناء تنظيف ملفاتي المؤقتة حُذفت بالخطأ مخلفات بروب موازٍ (`tmp-audit-identity-probe.mjs`, `tmp-audit-identity.db`, و3 ملفات `.log`) — قابلة لإعادة التوليد بإعادة تشغيل سكربتها.

---

## الوضع الحالي

**طبقات التحكم الحالية:**

| الطبقة | الموقع | الوصف |
|---|---|---|
| المصادقة | `lib/auth.js:20-26` (`hashPassword` scrypt)، `auth.js:28-34` (`verifyPassword` بـ timingSafeEqual) | كلمات المرور scrypt (N=16384) بملح، مقارنة زمن-ثابت |
| الجلسات | `auth.js:36-48` | رمز عشوائي 32 بايت، يخزّن `sha256` للرمز فقط (`token_hash`)، صلاحية 8 ساعات (`SESSION_HOURS`, `auth.js:5`) |
| التفويض | `auth.js:88-92` (`can`) + `api.js:104-114` (`requireUser`) | `requireUser` = مصادقة + حجب `must_change` + فحص `can(user, action)` |
| النطاق | `api.js:116-131` (`requestScope`)، `api.js:133-144` (`userScope`) | أربعة نطاقات `organization/branch/department/assigned` مع سقوط آمن `1 = 0` عند غياب الفرع/القسم |
| CSRF | `server.js:399-406` | للطلبات غير GET/HEAD: `x-requested-with: fetch` أو أصل مُتصور «نفس الأصل»؛ الكوكي `SameSite=Strict` (`api.js:52`) |
| ترويسات الأمان | `http.js:110-168` (`securityHeaders`) | CSP بنونس لكل طلب، `frame-ancestors 'none'`، `nosniff`، HSTS عند https، `style-src 'unsafe-inline'` |
| تحديد المعدل | `http.js:237-256` (`RateLimiter`) + `server.js:138-149` (`POST_LIMITS`) | على المسارات العامة فقط (تسجيل دخول 12/10د، طلبات 20/س، track-event 300/س…) + قفل دخول 5 محاولات/10د (`auth.js:94-107`) |
| سجل التدقيق | `db.js:406-417` (المخطط) + `domain.js:552-556` (`audit()`) | جدول `audit_log(id, user_id, user_name, action, entity, entity_id, meta, ip, created_at)`، فهرس على created_at |

**البنية التنظيمية:** `role_definitions` (`db.js:54-62`) بـ `data_scope` مقيّد بـ CHECK لأربع قيم، والأدوار المدمجة خمسة (`db.js:671-677`): admin (organization، `['*']`)، branch_manager (branch)، department_manager (department)، sales_agent (assigned)، service_agent (department). الحسابات القديمة بلا `role_key` تعود إلى خريطة `PERMISSIONS` الثابتة (`auth.js:81-86`).

---

## (1) رموز الصلاحيات المستخدمة فعليًا مقابل النموذج المقترح

**الرموز الـ16 المستخدمة فعليًا** (مجمعة من `ROLE_PERMISSIONS` في `api.js:1270-1275`، استدعاءات `requireUser` في `api.js`، ووسائط `action` في `server.js:182-223`، وخريطة `auth.js:81-86`):

| الرمز | أين يُستخدم |
|---|---|
| `overview:read` | GET /api/admin/overview (server.js:190)، tracking-events (220)، assistant-log (223) |
| `requests:read` | listRequests/getRequest/listRequestTransfers (server.js:191,192,195) |
| `requests:write` | updateRequest، التحويلات إنشاء/رد، createInternalRequest (server.js:182,193,194,196) |
| `customers:read` / `customers:write` | server.js:197-199 |
| `programs:read` / `programs:write` | listResource (api.js:1181 عبر `readPermission`)، CRUD البرامج |
| `content:write` | offers/news/articles/faq/destinations/reviews + listMedia (server.js:217) |
| `visa:write` | resource `visa` (api.js:1153) |
| `kb:write` | resource `kb` (api.js:1158) |
| `audit:read` | GET /api/admin/audit (server.js:216) |
| `reports:read` | reports و reports.csv (server.js:218-219) |
| `users:write` | listUsers/createUser/updateUser (server.js:208-210) |
| `settings:write` | getSettings/updateSettings (server.js:221-222) |
| `organization:read` / `organization:write` | server.js:211-215 |
| `*` | محجوز لدور admin فقط (`auth.js:81`؛ يمنع منحه لأدوار مخصصة `api.js:1342,1370`) |

**المقارنة مع نموذج §3 (view/create/edit/assign/transfer/approve/export/delete):**

- النموذج الحالي **ثنائي (read/write) لكل مورد**؛ كل الأفعال الدقيقة المقترحة غائبة:
  - **assign / transfer / approve** → كلها تحت `requests:write` واحد (server.js:193-196). لا يوجد تمييز بين موظف يعدّل طلبًا ومدير يعتمد تحويلًا (فحص التحويل يعتمد على `data_scope` لا على صلاحية approve — `api.js:955-963`).
  - **export** → تصدير CSV محمي بـ `reports:read` لا بصلاحية export مستقلة (server.js:219؛ `api.js:532-557`) — أي أن كل من يقرأ التقارير يقدر يصدّرها.
  - **delete** → بنفس صلاحية الكتابة: `deleteResource` يطلب `spec.permission` نفسه الخاص بالتعديل (api.js:1245-1264)، بلا صلاحية delete منفصلة وبلا تأكيد ثانٍ.
  - **view/create/edit** ≈ read/write — مطابقة جزئية.
- **رموز قراءة ناقصة:** لا يوجد `users:read` (عرض الموظفين يتطلب `users:write` — api.js:1390) ولا `settings:read` (قراءة الإعدادات خلف `settings:write` — server.js:221).
- التعويض الجزئي الحالي هو `data_scope` (الأدوار المدمجة تعطي agents نفس صلاحيات المدير لكن بنطاق أضيق — `db.js:671-677`).
- **اختبار:** `tests/api.test.js:477-515` يغطي فصل نطاق department، و`:604-609` رفض agent على programs/users — لكن لا اختبار لأي تفريق أفعال (لا يوجد ما يُختبر).

---

## (2) مسارات API العامة بلا `requireUser(action)` أو بفحص ناقص

**أ. مسارات عامة عمدًا (محمية بما يلزم):**

| المسار | server.js | الحماية |
|---|---|---|
| POST /api/auth/login | 164 | rate limit + قفل 5/10د (`api.js:20-66`)، كوكي Strict |
| POST /api/auth/logout | 165 | بلا ضرورة |
| GET /api/auth/me | 166 | يعيد null لغير المصادق |
| POST /api/auth/change-password | 167 | `auth: true` + `requireUser(ctx, null)` (`api.js:86`) — يفحص كلمة المرور الحالية |
| client auth (register/verify/resend/login/logout/me) | 169-174 | rate limits، OTP بحد 5 محاولات (`client-api.js:73-77`) |
| GET /api/client/bookings | 175 | `requireClient` داخلية (`client-api.js:129-133`) — يرى طلباته فقط |
| GET/PATCH /api/client/profile | 176-177 | currentClient للقراءة، `requireClient` للتحديث (`client-api.js:184-187`) |
| GET/POST /api/whatsapp/webhook | 179-180 | GET: verify token بمقارنة زمن-ثابت (`whatsapp.js:190-199`)؛ POST: توقيع HMAC-SHA256 زمن-ثابت (`whatsapp.js:201-207`) |
| POST /api/requests | 181 | عام (استقبال موقع) — حد 20/س |
| POST /api/track | 183 | يتطلب تطابق المرجع + الهاتف |
| GET /api/programs(/:slug) | 184-185 | كتالوج منشور فقط |
| POST /api/recommend، /api/assistant، /api/track-event | 186-188 | rate limits |
| GET /api/settings | 244 | قائمة مفاتيح عامة بيضاء فقط (server.js:246-252) |
| /health, /sitemap.xml, /robots.txt, /site.webmanifest, /art/:file, /i18n/en.json | 226-302 | عامة بلا بيانات حساسة (health يكشف عدد البرامج وزمن التشغيل فقط) |

**ب. فجوات فحص (مرتبة بالخطورة):**

1. **غلاف `api()` لا يطبق `can()` إطلاقًا** — `server.js:148-159`: الوسيط `action` يُستخدم فقط لفحص «مسجّل دخول». الإنفاذ الفعلي طبقة واحدة داخل كل معالج عبر `requireUser`. والدليل أنه كافٍ اليوم (كل معالجات /api/admin تستدعي `requireUser` — تحقق شمولي: api.js:187,318,377,533,578,587,619,671,855,909,936,1018,1038,1050,1181,1189,1221,1249,1277,1291,1309,1330,1357,1390,1408,1451,1540,1551,1559,1568,1584) لكن أي معالج مستقبلي يُنسى فيه الفحص سيمر من الغلاف بصمت. حلقة الموارد (`server.js:201-206`) مسجلة بلا غلاف أصلاً وتعتمد حصريًا على الفحص الداخلي.
2. **POST /api/track-event: كتابة عامة بلا مصادقة** — `api.js:561-575`: أي زائر يدرج صفاً في `tracking_events` (حد 300/س/IP فقط). كتابة بنيتها التسويقية؛ مقبولة لكنها الكتابة الوحيدة بلا هوية إطلاقًا.
3. **ضعف في فحص CSRF** — `server.js:403`: `origin.endsWith(req.headers.host)` مقارنة لاحقة ساذجة. **[بروب]** طلب POST بـ `Host: laurette.com` و`Origin: https://notlaurette.com` (بلا x-requested-with) **تخطّى الفحص ونفّذ (204)** بدل 403. كذلك `!origin` تعامل غياب الأصل كأنه نفس الأصل. التعويض الفعلي اليوم هو `SameSite=Strict` للكوكي (لن يُرفق عبر سياق cross-site)، لذا الأثر العملي محدود — لكن طبقة الحماية الأولى مسالمة المخترقة.
4. **لا تحديد معدل على أي مسار /api/admin/*** — `POST_LIMITS` (`server.js:138-149`) لا يشملها. مصادقة، لكنها تسمح بمسح عنيف داخلي/إغراق بمعدل غير محدود من حساب واحد.
5. GET /api/admin/settings خلف `settings:write` بلا `settings:read` (server.js:221) — تقييد مفرط لا ثغرة.

---

## (3) عمليات الكتابة التي لا تكتب في audit_log

| # | العملية | الموقع | ملاحظة |
|---|---|---|---|
| 1 | إنشاء طلب من الموقع العام | `domain.js:309-395` عبر POST /api/requests (server.js:181) | يدرج requests + customers + request_events بلا سطر audit. **تناقض:** المسار الداخلي المكافئ يُوثق (`api.js:234` action=create-request) |
| 2 | مسار الطلب المكرر | `domain.js:317-336` | يعدّل `requests.payload` و`customers.whatsapp_opted_out` بلا audit ولا request_event |
| 3 | تتبع الأحداث | `api.js:561-575` (trackEvent) | INSERT tracking_events — عام بلا هوية |
| 4 | جلسات المساعد | `assistant.js:71-90` (logMessage/ensureSession) | له مخزنه الخاص ويُعرض للمديرية (api.js:1583) — مقبول لكنه خارج audit |
| 5 | بوابة العميل كاملة | `client-api.js:40-215` | تسجيل/تحقق OTP/دخول/خروج + **تحديث الملف الشخصي UPDATE clients** (`client-api.js:198`) — لا audit نهائيًا (تعديل بيانات عميل حقيقي بلا سجل) |
| 6 | واتساب | `whatsapp.js:49-77` (enqueue)، `:181-188` (receiveStatus)، processWhatsAppOutbox | كتابة تشغيلية على whatsapp_outbox |
| 7 | دورة الجلسات نفسها | `auth.js:36-48,70-72` (createSession/destroySession/purge) | يغطيها audit الدخول/الخروج جزئيًا فقط (api.js:53,65) |
| 8 | التهيئة الأولية | `db.js:838-839` (seedDatabase) | bootstrap قبل وجود مستخدمين — مقبول |

**الموثَّق فعلاً (لافت للإشادة):** login/logout (api.js:53,65)، change-password (99)، create/update-request (234,850)، نقل الطلبات وردودها (897,1007)، عملاء (1071)، CRUD المحتوى كاملاً بما فيه أرشفة البرامج المرتبطة (1210,1238,1259,1264)، فروع/أقسام/أدوار (1300,1321,1348,1385)، مستخدمون (1446,1532)، إعدادات (1579).

---

## فحص النطاق (requestScope/userScope) على كل استعلامات القوائم

**مطبَّق ومغطى:**

| الاستعلام | الدليل |
|---|---|
| listRequests | api.js:590-614 (scope + فلاتر) |
| getRequest / updateRequest | api.js:621-628، 674-676 (SELECT بالبنطاق — الإخفاق 404) |
| createRequestTransfer / respondRequestTransfer | api.js:858-860 (SELECT بالبنطاق)، 955-963 (canRespond بالنطاقات) |
| listRequestTransfers | api.js:908-933 (فلترة حسب النطاق على الوجهة) |
| overview | api.js:320-365 (كل الإحصاءات بالبنطاق) |
| reports / reportsCsv | api.js:381-412، 536-548 |
| listCustomers/getCustomer/updateCustomer | api.js:1021-1035، 1041-1049، 1053-1057 (EXISTS على طلبات النطاق) |
| listUsers / createUser / updateUser | api.js:1392، 1420-1436، 1454 (userScope) |
| trackingEvents / assistantLog / auditLog | api.js:577-585، 1583-1590، 1550-1556 (بوابة organization فقط) |
| dropdowns التقارير | api.js:486-497 (فروع/أقسام/وكلاء بالنطاق) |
| حواجز كتابة | createInternalRequest (200-206)، updateRequest (703-709)، createUser (1429-1433)، updateUser (1523-1524) |

**غير مطبَّق أو ناقص:**

1. **listResource** (`api.js:1178-1185`): `SELECT * FROM ${table} ... LIMIT 500` بلا أي scope — كل المحتوى للجميع. المحتوى لا يحمل بعدًا فرعيًا فالأثر محدود، لكن مستخدم بنطاق فرع يرى ويعدّل كل المحتوى المؤسسي إذا مُنح `content:write`.
2. **organization endpoint** (`api.js:1276-1289`): يعرض كل الفروع والأقسام وكل الأدوار مع صلاحياتها الكاملة لأي من يملك `organization:read` حتى لو كان نطاقه فرع/قسم — تسريب معلوماتي متوسط.
3. **listRequestTransfers يعرض الوارد فقط** (الوجهة): الطرف الذي أرسل التحويل لا يرى تحويلاته الصادرة المعلقة من هذه القائمة (api.js:911-921).
4. **respondRequestTransfer يسمح للمديرين القِدم** بلا role_key (`role='manager'`) بالرد على أي تحويل في أي فرع (`api.js:955-957`).
5. dropdowns في listUsers غير مفلترة (كل الفروع/الأقسام — api.js:1399-1403) وgetRequest يعيد كل الوكلاء/الفروع/الأقسام (api.js:646-651) — تسريب دليلي هامشي.

---

## هل يُبطل تعطيل المستخدم (active=0) الجلسة فورًا؟ — **نعم، مزدوج**

1. **فحص لكل طلب:** `sessionUser` يضم users ويفحص `active`؛ عند التعطيل أو الانتهاء يحذف الجلسة ويعيد null (`auth.js:45-48`). لا تخزين مؤقت للجلسات — **[بروب]** بعد PATCH {active:false} ردّ `/api/auth/me` فورًا `user: null`.
2. **حذف فوري عند الإجراء:** updateUser يحذف جلسات المستخدم عند `active=false` أو تغيير كلمة المرور (`api.js:1531`)؛ changePassword يحذف كل جلسات صاحبها (`api.js:98`)؛ تعطيل دور يحذف جلسات كل أصحابه (`api.js:1384`)؛ تغيير الدور يُطبق فورًا لأن sessionUser يعيد قراءة الصلاحيات من القاعدة كل طلب.
3. **دخول محجوب سلفًا** للمعطل: SELECT بشرط `active = 1` (`api.js:34-35`).
4. **حاجز must_change يعمل:** **[بروب]** مستخدم جديد بـ must_change=1 ردّ 403 على كل إجراء حتى غيّر كلمته (api.js:106-109).

**نقطة ضعف جانبية:** الإبطال يعتمد على الوصول لاحقًا؛ لا قناة إبطال فورية من خارج الطلب (مثل قائمة إبطال مركزية)، لكن بما أن كل طلب يفحص القاعدة، فالنتيجة العملية فورية.

---

## هل توجد قيود قبل/بعد في سجل التدقيق؟ — **لا**

- المخطط (`db.js:406-416`) يحمل عمود `meta` JSON واحدًا فقط (يقتطع عند 4000 حرف — `domain.js:555`). لا أعمدة old/new.
- عمليًا:
  - update-request: يكتب **أسماء الحقول المتغيرة فقط** (`api.js:850` — `meta: { changes }`)؛ القيم القديمة/الجديدة تجدها فقط في request_events كرسائل نصية.
  - update-customer / update-resource: يكتبان **القيم الجديدة فقط** (الجسم الوارد) — `api.js:1071,1238`.
  - update-user: لقطة جديدة بلا قديم (`api.js:1532-1536`).
  - update-settings: **المفاتيح فقط دون القيم** (`api.js:1579`) — تعديل أسعار/هوية/إعدادات تتبع غير قابل للاسترجاع من السجل.
- **اللادآنية (append-only) بالممارسة لا بالتصميم:** لا يوجد أي UPDATE/DELETE على audit_log في الكود (تحقق grep)، ولا مسار حذف في API — الموظف لا يستطيع المحو (يتوافق §17). لكن لا يوجد trigger على مستوى القاعدة يمنع العبث المباشر بالملف، ولا سياسة احتفاظ، والعرض بلا ترقيم أو فلترة (LIMIT 200 ثابت — `api.js:1554`).
- لا يخزن السجل user-agent ولا request_id ولا قبل/بعد — ويخزن اسم المستخدم وقت الفعل فقط (تاريخي).

---

## مخاطر أفق الفروع

1. **requestScope يقيد `branch_id` (الفرع المنفذ) فقط** (`api.js:116-131`): الفرع **يفقد رؤية** أي طلب استقبله (`received_branch_id` عنده) ثم حُوّل لفرع آخر، ولا يرى طلبات استُقبلت في فرعه وتُنفّذ في غيره — عمود `received_branch_id` موجود ومستخدم في التقارير (api.js:396) لكنه خارج النطاق.
2. **بعد التحويل بلا موظف مستهدف** يبقى `assigned_to` القديم (`api.js:969-973` — COALESCE)، فيرى موظف النطاق assigned الطلب في فرعه الجديد رغم خروجه من نطاقه العملي — وإن كان هذا هو الواقع الوظيفي حتى إعادة الإسناد.
3. **بيانات العميل عابرة للفروع:** ما إن يظهر للعميل طلب واحد في نطاقك حتى ترى ملفه الكامل (هاتف/بريد/ملاحظات فروع أخرى) وتستطيع تعديله (`api.js:1050-1071`) — التسريب الأفقي الأوسع فعليًا.
4. **تحويلات صادرة بلا قائمة متابعة** (انظر أعلاه) — مدير الفرع المرسل يكتشف التحويل من بطاقة الطلب فقط.

---

## ما يعمل ويُحتفظ به (يجب عدم كسره عند أي تطوير)

- scrypt + salt + timingSafeEqual للتحقق؛ تخزين hash الجلسة لا الرمز؛ انتهاء 8 ساعات.
- `SameSite=Strict` + كوكي HttpOnly (وSecure عند https) (`api.js:52`, `http.js:178-186`).
- CSP بنونس لكل استجابة، frame-ancestors none، HSTS شرطي، حدود حجم جسم الطلب (`http.js:171-180`, readJson يفحص content-type — `:182-198`).
- توقيع HMAC زمن-ثابت لويب هوك واتساب + إخفاق مغلق عند غياب `WHATSAPP_APP_SECRET` (`whatsapp.js:201-207`).
- قفل تسجيل الدخول 5/10د + حدود معدل على المسارات العامة الحساسة.
- سقوط آمن في النطاق (`1 = 0` عند غياب فرع/قسم النطاق) وحواجز كتابة تمنع إخراج الطلبات/الموظفين من نطاق الفاعل.
- منع منح `*` لأي دور مخصص، وحماية دور admin من التعديل (`api.js:1342,1362,1370`)، ومنع تعطيل النفس (`api.js:1460`).
- حجب كل الإجراءات خلف must_change، واختبارات صلاحيات موجودة (`tests/api.test.js:477-515, 604-609, 647-651`).

## مشاكل وتعارضات (بالخطورة)

| # | المشكلة | الدليل | الأثر |
|---|---|---|---|
| 1 | **updateUser ينهار 500 لكل مستخدم roleKey بنطاق غير organization** — استعلام الهدف بلا alias بينما userScope يضيف `u.branch_id = ?` | `api.js:1454-1455` مع `api.js:133-144`؛ **[بروب]**: `ERR_SQLITE_ERROR no such column: u.branch_id` → 500 | إتاحة: مدير فرع/قسم لا يستطيع تعديل أي موظف إطلاقًا؛ القائمة تعمل والتعديل لا |
| 2 | **فجوة تصعيد كامنة خلف الانهيار السابق**: فرع users:write يرسل PATCH {role:'admin'} بلا roleKey فيمر بلا أي فحص تفويض (فحص canDelegateProfile موجود فقط في فرع roleKey) | `api.js:1476-1480` (لا فحص نطاق/تفويض)، الحارس الوحيد `:1477` يمنع تخفيض النفس فقط | اليوم fail-closed بالصدفة (500 قبل الوصول). بمجرد إصلاح alias السطر 1455 يصبح **تصعيدًا كاملًا إلى legacy admin `*`** — إصلاح الثغرة 1 يجب أن يصحبه إغلاق هذه الفجوة في نفس التغيير |
| 3 | **organization:write يكفي لإعادة كتابة أي دور غير admin بكل الصلاحيات الـ16** (createRole/updateRole بلا فحص «لا تمنح ما لا تملك») | `api.js:1330-1355, 1357-1385` | دور هامشي بصلاحية واحدة يمكنه تذريع أدوار المديرين — إسكات فحص canDelegateProfile على مستوى الأدوار |
| 4 | لا before/after في audit_log؛ الإعدادات تُسجل بالمفاتيح فقط | `db.js:406-416`, `api.js:850,1071,1238,1532,1579` | قابلية تدقيق ضعيفة للتعديلات؛ §17 («سجلات تدقيق») مستوفاة شكلاً لا مضمونًا |
| 5 | CSRF: مقارنة لاحقة + قبول غياب Origin | `server.js:403-404`؛ **[بروب]** 204 بدل 403 | طبقة أولى مسالمة؛ تعويضها SameSite=Strict |
| 6 | نموذج read/write فقط مقابل §3 | هذا التقرير (1) | لا تفريق بين approve/transfer/export/delete |
| 7 | كتابات بلا audit (طلبات عامة، ملف العميل، واتساب، المساعد) | هذا التقرير (3) | فجوات تاريخية للبيانات الشخصية |
| 8 | أفق الفروع (received_branch، التحويلات الصادرة، العملاء العائمون) | هذا التقرير أعلاه | رؤية ناقصة/زائدة بين الفروع |
| 9 | لا rate limit على /api/admin/*، auditLog بلا ترقيم/فلترة/احتفاظ | `server.js:138-149`, `api.js:1554` | ثانوي |

## توصيات مرتبة بالأولوية

1. **إصلاح updateUser (أولوية قصوى، تغيير واحد):** alias الاستعلام — `SELECT * FROM users u WHERE u.id = ?` — مع **إغلاق فجوة التصعيد في نفس الالتزام**: في فرع `body.role` (`api.js:1476-1480`) إما حجبه على أصحاب `organization:write`/legacy admin فقط، أو تجاهل `body.role` كليًا لصالح roleKey فقط، وإضافة اختبار regression: «users:write بنطاق branch لا يستطيع منح role=admin».
2. **توسيع audit_log:** أعمدة `old_value`/`new_value` (JSON) + `request_id` + `user_agent`؛ كتابة قبل/بعد في update-request/update-settings/update-user/update-customer؛ trigger يمنع UPDATE/DELETE؛ صفحة عرض بترقيم وفلترة؛ سياسة احتفاظ معلنة.
3. **ترقية الصلاحيات إلى أفعال دقيقة** (§3): `requests:assign/transfer/approve`، `reports:export` (أو `*.export`)، `*.delete` منفصلة عن edit — مع ترحيل الأدوار المدمجة والاحتفاظ بـ data_scope كما هو.
4. **تشديد CSRF:** استبدال endsWith بمقارنة مضيف دقيقة (`new URL(origin).host === req.headers.host`) ورفض POST/PATCH/DELETE بلا Origin، مع إبقاء شرط x-requested-with.
5. **تحصين organization:write:** فحص «المنح ⊆ ممتلكات المانح» في createRole/updateRole.
6. **سد أفق الفروع:** إضافة `received_branch_id` إلى scope القراءة (أو رؤية قراءة فقط للطلبات الصادرة)، وقائمة تحويلات صادرة، وتقييد رؤية/تعديل ملاحظات العملاء العابرة للفروع.
7. **توثيق العمليات العامة:** سطر audit بإجراء `public-request` عند إنشاء طلب من الموقع، وتوثيق تحديث ملف العميل في سجل منفصل للبوابة.
8. **تحديد معدل خفيف على /api/admin/*** (مثلًا 300 طلب/دقيقة/IP) وحماية auditLog بترقيم وفلترة.

## خلاصة الثقة

- **مؤكد بالبروب:** إبطال الجلسة فورًا عند active=0؛ حاجز must_change؛ انهيار updateUser 500 للنطاقات؛ تجاوز CSRF باللاحقة.
- **مؤكد بالقراءة:** عدم تطبيق can() في الغلاف؛ غياب before/after؛ فجوة التصعيد المنطقية (مخفية خلف 500)؛ قوائم النطاق المذكورة.
- **لم يُفحص:** واجهة SPA (public/assets/js) كمصدر ثانٍ للإنفاذ — العبرة بالخادم وفق §3 فأُغتصر؛ و`wt-os/` و`whatsapp-openwa/` خارج النطاق.
