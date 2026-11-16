# خريطة طبقة CRM وواتساب — منصة لوريت
> مهمة قراءة فقط (audit-laurette / offer-feature). التاريخ: 2026-11-14.
> كل الأسطر مُتحقق منها بالقراءة المباشرة. القاعدة استُعلم عنها من نسخة مؤقتة للقراءة فقط (٪TEMP٪\laurette-audit\copy.db) عبر node:sqlite — الأصل لم يُلمس.
> حالة Git وقت الفحص: الملفات المعدلة غير الملتزمة: docs/API.md, lib/api.js, lib/db.js, lib/views/public.js, public/assets/js/account.js, app.js, render.yaml, server.js. غير المتبقّة (untracked): lib/whatsapp-bridge.js, lib/whatsapp-chat-analytics.js, lib/workspace.js, lib/workspace-db.js, lib/sanitize-text-for-ai.js, public/assets/js/workspace.js, public/assets/css/workspace.css, tools/whatsapp-crm-bridge/, whatsapp-openwa/, wt-os/, audit-laurette/. ملاحظة تصحيحية: lib/whatsapp.js **ملتزم** (ليس ضمن المعدلات) — غير الملتزمَين هما whatsapp-bridge.js وwhatsapp-chat-analytics.js فقط.

---

## 1) دورة إنشاء الطلبات من البداية

### 1.1 نقاط الـ API
| المسار | المعالج | ملاحظات |
|---|---|---|
| `POST /api/requests` | `createRequestApi` — lib/api.js:162 | عام (زوار الموقع). حد المعدل 20/ساعة (server.js:140). |
| `POST /api/admin/requests` | `createInternalRequest` — lib/api.js:203 | داخلي (موظف بصلاحية requests:write)، مصدر `source:'branch'` (api.js:216-221). |
| `GET /api/admin/requests` | `listRequests` — lib/api.js:591 | لوحة CRM. مرشحات: status/type/q/assigned=me/صفحة 25 (api.js:594-600). |
| `GET /api/admin/requests/:id` | `getRequest` — lib/api.js:628 | دروار الطلب في admin.js. |
| `PATCH /api/admin/requests/:id` | `updateRequest` | حالة/عرض/إسناد؛ عند تغيير الحالة يستدعي enqueueWhatsAppNotice 'status' (api.js:790)، وعند تسجيل عرض سعر يرسل نصاً حرّاً `تم تسجيل عرض سعر ${amount} د.أ` كـ status_value (api.js:834). |
| `POST /api/admin/requests/:id/transfers` | `createRequestTransfer` — api.js:854 | تحويل بين الأقسام. |

الربط في server.js:187-202.

### 1.2 المنطق الأساسي createRequest — lib/domain.js:309-405
1. تحقق validateRequest ثم إلزام consent (domain.js:310-313) — بدون موافقة يُرفض: «يلزم الموافقة على حفظ البيانات للتواصل معك».
2. **منع التكرار**: `payloadHash` (FNV-1a 32bit hex، domain.js:273-284) على القيم بدون whatsappUpdates + notes؛ `findRecentDuplicate` (domain.js:287-297) يطابق نفس phone + hash خلال **15 دقيقة** ضمن آخر 20 طلباً من النوع. عند تكرار: يعاد نفس reference وربما يفعّل whatsappUpdates على الطلب القديم (domain.js:320-339).
3. **برنامج/عمرة**: يبحث `programs WHERE slug = value.programSlug` (domain.js:331-334)؛ إن غاب البرنامج يفشل الطلب بحقل programSlug: «البرنامج غير موجود أو لم يعد متاحًا». يضيف للقيمة `programTitle` و`priceFromAtRequest` و`currencyAtRequest`.
4. upsertCustomer بالهاتف (فريد) (domain.js:299-306).
5. **payload JSON** (domain.js:348-351): `{ ...value, hash, userAgent: ≤180 حرفاً, ip }` — أي أن programSlug **مخزّن داخل payload** كما في الملاحظة الأصلية، مع programSlug/programTitle/priceFromAtRequest/currencyAtRequest/whatsappUpdates وكل حقول النموذج (name/phone/…).
6. الحل للقسم: REQUEST_TYPES[type].department مع توحيد «الفنادق/البرامج السياحية → قسم الهوليداي والبرامج السياحية» و«الحج والعمرة → قسم الحج والعمرة» (domain.js:352-359)؛ department_id من departments حيث name وbranch_id IS NULL.
7. **INSERT** (domain.js:369-377) بحالة `'new'` وأعمدة: reference, type, status, customer_id, client_id, branch_id=received_branch_id=meta.branchId, assigned_to=service_owner_id=meta.assignedTo, department, department_id, title, summary, payload, source=lead_origin=meta.source ('website' افتراضياً), consent.
8. عند meta.assignedTo: سجل في request_owner_history بنوع 'assigned' وملاحظة «إسناد عند الإنشاء» (domain.js:379-383).
9. حدث created في request_events (domain.js:385-390): «تم إنشاء الطلب من الموقع» أو «سجّل الموظف الطلب».
10. تعارض UNIQUE على reference يعاد المحاولة حتى 4 مرات بمرجع جديد (domain.js:366-377، 402-404).
11. المسار العام يستدعي `enqueueWhatsAppNotice(db, result.id, 'received', ctx.baseUrl)` بعد النجاح وعند التكرار مع notifyWhatsApp (api.js:169-171).
12. المسار الداخلي يضيف حدث intake «استقبل الطلب في {فرع} — {قسم}» وaudit 'create-request' (api.js:229-246).

### 1.3 صيغة الرقم المرجعي — lib/util.js:93-100
```js
export function reference(type) {
  const prefix = { flight:'FL', hotel:'HT', program:'PG', umrah:'UM', visa:'VS', consult:'CS', cruise:'CR' }[type] || 'RQ';
  const buf = new Uint8Array(4);
  crypto.getRandomValues(buf);
  const body = [...buf].map(b => b.toString(36).toUpperCase().padStart(2,'0')).join('').slice(0,6);
  return `LT-${prefix}-${body}`;   // مثال: LT-PG-7K2Q0A
}
```
النمط الرسمي `referenceValid` (util.js:102-103): `/^LT-(FL|HT|PG|UM|VS|CS)-[A-Z0-9]{6}$/` — **لا يشمل CR (cruise)** (فجوة تجميلية؛ الدالة غير مستوردة في أي مكان آخر وفق البحث). التتبع: `POST /track` (api.js:240-253) يطابق reference + phone بعد cleanPhone، ولا يعتمد referenceValid.

### 1.4 حالات الطلب — lib/domain.js:14-24 (STATUSES) و26-31 (DEAL_STAGES)
| الحالة | التسمية | الانتقالات المسموحة |
|---|---|---|
| new | جديد | reviewing, quoted, awaiting, in_progress, confirmed, cancelled |
| reviewing | قيد المراجعة | quoted, awaiting, in_progress, confirmed, cancelled |
| quoted | تم إرسال العرض | reviewing, awaiting, in_progress, confirmed, cancelled |
| awaiting | في انتظار إعادة الاتصال | reviewing, quoted, in_progress, confirmed, cancelled |
| in_progress | قيد المتابعة | reviewing, quoted, awaiting, confirmed, cancelled |
| confirmed | تم التأكيد | reviewing, quoted, awaiting, in_progress, cancelled |
| cancelled | ملغي | — (نهائي) |

مراحل الصفقة (deal_status، افتراضي 'new' — db.js:123): new/in_progress/won/lost بفحص syncDealStage وmarkFirstResponse في domain.js (استيراد api.js:7).

### 1.5 عرض لوحة CRM — public/assets/js/admin.js
- **نظرة عامة**: «طلبات تحتاج إجراءً» و«أحدث الطلبات» (admin.js:261-281) من GET /api/admin/overview (api.js:340-346).
- **قائمة الطلبات** renderRequests (admin.js:297-360): شريط مرشحات (type/status/بحث q بالمرجع أو الاسم أو الهاتف) ثم جدول 9 أعمدة: المرجع/النوع/العميل+الهاتف/الملخص/الحالة/الفرع·القسم/العرض/الموظف/التاريخ (admin.js:315-327). البيانات من listRequests (SQL joins customers/users/branches/departments — api.js:604-612) وتعيد أيضاً خرائط statuses/types/dealStages (api.js:617).
- **دروار الطلب** openRequest (admin.js:~399-500): يعرض payload كحقول بعناوين FIELD_LABELS (admin.js:~375-387؛ منها programSlug → «البرنامج») مع إخفاء hash/userAgent/ip؛ شارة الحالة والصفقة ومؤشرات (أُنشئ/أول استجابة/مدة الإنجاز)؛ تعديل التوزيع التنظيمي (فرع/قسم/lead_origin بقيم website,whatsapp,phone,email,branch,referral,other — admin.js:417)؛ مسؤوليات الصفقة (sales/service/execution)؛ تحديث الحالة من nextStatuses؛ الإسناد dAgent؛ العرض المالي؛ التحويلات؛ ملاحظة داخلية؛ سجل الأحداث؛ وزر «واتساب العميل» (admin.js:467، انظر §7).

---

## 2) أرقام الفروع الفعلية من القاعدة (نسخة قراءة فقط)

### 2.1 جدول branches — لا يوجد عمود هاتف
مخطط db.js:28-36: `id, code, name, is_primary, active, created_at, updated_at` — **لا عمود phone إطلاقاً** (مؤكد أيضاً بـ PRAGMA table_info على النسخة).
الصفوف الفعلية (2 صف):
| id | code | name (حرفياً) | is_primary | active |
|---|---|---|---|---|
| 1 | irbid | `إربد` | 1 | 1 |
| 2 | amman | `عمّان` | 0 | 1 |

### 2.2 الأرقام الحقيقية في جدول settings (JSON نصي)
- key `branches` (settings): **القيم الحرفية كما هي**:
  - `{"name":"فرع إربد","address":"شارع الحصن – بجانب البنك الأهلي","phone":"02-7244112","mapUrl":"https://www.google.com/maps/place/…irbid…"}` 
  - `{"name":"فرع عمّان","address":"الدوار السابع – مجمع المشير بلازا، الطابق الأول","phone":"06-4600777","mapUrl":"…amman…"}`
  - ← **تأكيد الادعاء**: إربد `02-7244112` وعمّان `06-4600777` حرفياً بالشرطة. وتطابق بذرة data/seed.json:60-68 (إربد سطر 62، عمّان سطر 68) وgoogleBranches (settings).
- key `contactGroups` (أرقام واتساب/جوال، دولية جاهزة):
  - «فرع عمّان»: 962791192888، 962789795888، 962782965441
  - «فرع إربد»: 962791193888، 962790915827
  - «الإدارة»: السيد مازن جادالله 962785301768، السيد عمر الروسان 962799507350
- key `whatsapp` = `"962791193888"` (القيمة مخزنة JSON-encoded بعلامتي اقتباس — المستهلكون إما JSON.parse كما في lib/workspace.js:312-313 أو strip الأرقام كما في api.js:181). لاحظ أن 962791193888 هو نفسه «الرقم الأول» لفرع إربد في contactGroups.

### 2.3 هل تصلح لـ wa.me مباشرة؟
- **أرقام contactGroups وwhatsapp**: نعم — دولية بدون + ومناسب لـ `https://wa.me/96279…` كما هو (هكذا تستخدمها الواجهة: layout.js:330-332).
- **أرقام branches (الأراضي)**: لا — `02-7244112` و`06-4600777` محلية. التحويل المطلوب: إسقاط الصفر الافتتاحي وإضافة 962:
  - `02-7244112` → `027244112` → **`96227244112`** → `https://wa.me/96227244112`
  - `06-4600777` → `064600777` → **`96264600777`** → `https://wa.me/96264600777`
  - ملاحظة عملية: هذان أرقام أراضٍ (خط ثابت)؛ واتساب الفعلي للفروع هو أرقام الجوال في contactGroups.
- تطبيع المرسل إليهم في whatsapp.js:23-36 (normalizeRecipient) يقبل +/00/0 ويضيف WHATSAPP_DEFAULT_COUNTRY_CODE (افتراضي 962) — سيعمل حتى على 027244112.
- طابعه المحلي الموحد في الواجهات: public/assets/js/workspace.js:76 `waLink` يحوّل `07XXXXXXXX` → `962` + باقي الأرقام.

### 2.4 تعرضها الواجهة العامة أين؟
- فوتر الفروع (tel: بنفس الصيغة المحلية) — lib/views/layout.js:82.
- مودال واتساب من contactGroups — whatsappModal (lib/views/layout.js:321-335): يستبعد مجموعة الإدارة (سطر 323)، يبني `wa.me/${intl}` ويعرض للنص شكلاً محلياً `0${intl.slice(3)}` (سطر 331).
- الإعدادات العامة تُمرر للقوالب من lib/views/public.js:47-49 (contactGroups/branches/googleBranches) ومن server.js:254 (whatsapp/branches/email).
- محرر الإعدادات في الأدمين يعرض حقل `whatsapp` بعنوان «رقم واتساب (دولي بدون +)» (admin.js:1183-1184).

---

## 3) جدول users = جدول الموظفين؟ نعم

- المخطط db.js:13-25: `id, username, name, role(admin|manager|agent), department, phone, password_hash, password_salt, must_change, active, last_login_at, created_at` + أعمدة مضافة لاحقاً بالترحيل (مؤكدة بـ PRAGMA): `role_key, branch_id, department_id`.
- المحتوى الفعلي: **مستخدم واحد فقط** — id=1, username=`laurette`, name=`مدير النظام`, role=admin, department=`الإدارة`, **phone=NULL**, active=1.
- **لا يوجد رقم واتساب لأي مستخدم اليوم** (phone فارغ). لا يوجد عمود whatsapp منفصل؛ عمود phone هو المرشح.
- أعمدة الإسناد المتاحة:
  - على users: `branch_id`, `department_id`, `role_key` (نطاق الفرع/القسم).
  - على requests: `assigned_to`, `sales_owner_id`, `service_owner_id`, `execution_owner_id` (db.js:127-135) + `request_owner_history` للسجل.
  - قائمة الموظفين للإسناد: lib/workspace.js:148 (SELECT id,name,branch_id,department_id FROM users WHERE active=1 …) وفي الأدمين data.agents من getRequest.
- **سلسلة «واتساب الموظف» الموجودة فعلاً**: صفحة العرض العامة `/o/{token}` تعيد `consultantPhone = users.phone (الموظف assigned_to) وإلا settings.whatsapp` (lib/workspace.js:311-314) و`consultantName = users.name` — أي أن عمود users.phone هو مصدر رقم موظف الحالة إن ملأ، والإيمكان البديل هو settings.
- **آلية `?ref=` للإسناد: لا وجود لها اليوم** — بحثت في lib/ وpublic/assets/js/ وtools/whatsapp-crm-bridge/ عن أي قراءة لمعامل ref في الـ query (URLSearchParams / query.ref / params.get) ولا نتائج. الإسناد الحالي كله عبر نماذج API (assignedTo) وليس عبر رابط. ما هو موجود فقط: `/track?reference=` وروابط العروض `/o/{token}`. (نقطة البدء للتصميم الجديد.)

---

## 4) ملفات واتساب الثلاثة (WIP/untracked كما هو — ما عدا whatsapp.js ملتزم)

### 4.1 lib/whatsapp.js (ملتزم في Git؛ إشعارات Cloud API الرسمية)
الصادرات: `whatsappNotificationsReady` (بوابة env: WHATSAPP_NOTIFICATIONS_ENABLED=1 + WHATSAPP_ACCESS_TOKEN + WHATSAPP_PHONE_NUMBER_ID + WHATSAPP_APP_SECRET + WHATSAPP_VERIFY_TOKEN + WHATSAPP_TEMPLATE_REQUEST_RECEIVED + WHATSAPP_TEMPLATE_REQUEST_STATUS — whatsapp.js:10-18)، `enqueueWhatsAppNotice` (:49-95)، `processWhatsAppOutbox` (:107-165)، `verifyWebhook` (:184-194)، `receiveWebhook` (:196-217). داخلي: normalizeRecipient (:23-36)، templateDetails (:38-45، لغة افتراضية 'ar')، retryDelay (15s×2^n بحد 6h، :97)، stopWord (:168)، disableCustomerWhatsApp (:173-181)، receiveStatus (:187-193).
الاستخدام من server.js: استيراد :20؛ عامل دوري كل دقيقة يشغّل processWhatsAppOutbox عند الجهوزية ويُترك unref (:81-88)؛ مسارات `GET/POST /api/whatsapp/webhook` (:184-185)؛ إيقاف المؤقت عند الإغلاق (:482).

### 4.2 lib/whatsapp-bridge.js (untracked — جسر إضافة المتصفح)
الصادرات: `saveChat` فقط. دورها: نقطة `POST /api/save-chat` (server.js:28,186؛ حد 60/دقيقة server.js:146) تستقبل من إضافة Chrome محادثة واتساب (جهة اتصال + حتى 10 رسائل، 4MB)، تتحقق من `WHATSAPP_BRIDGE_ENABLED==='true'` + Bearer EXTENSION_SECRET (bridge.js:29-37)، تطبع الرسائل (direction: incoming/outgoing/unknown، نص ≤64KB)، تحسب fingerprint SHA-256 للمنع المزدوج، تشغّل التحليل المحلي processIncomingChat، وتخزن في **whatsapp_chat_imports** (INSERT … ON CONFLICT(fingerprint) DO NOTHING مع backfill للتحليل القديم bridge.js:71-99). **لا تلمس whatsapp_outbox ولا requests ولا العروض.**
النصف العميلي: tools/whatsapp-crm-bridge/ (manifest.json, background.js, content.js, popup.*, settings.js) — إضافة متصفح (untracked).

### 4.3 lib/whatsapp-chat-analytics.js (untracked — تحليل محلي صافٍ)
الصادرات: `extractPhones(text)` (تطبيع أرقام عربية ٠-٩/۰-۹ وregex هواتف؛ يقبل `+E164` أو `962/0 + 7[789]XXXXXXXX`)، `detectIntent(text)` (BOOKING_INQUIRY/VISA_INQUIRY/PRICING_INQUIRY/GENERAL_SUPPORT بالكلمات المفتاحية العربية)، `processIncomingChat({name,phone,messages}, processedAt)` → `{clientName, primaryPhone, detectedIntent, messageCount, processedAt, status:'PENDING_REVIEW'}`. شبكة صفرية — no fetch/no env.

### 4.4 خطوط عدم التعارض مع ميزة العروض
- طبقة القوالب (whatsapp.js) مربوطة حصراً بدورة requests/customers: enqueueWhatsAppNotice يقرأ requests.payload.whatsappUpdates + customers.whatsapp_opted_out فقط.
- طبقة الجسر تقرأ/تكتب whatsapp_chat_imports فقط، وتُفعّل بـ env منفصلة.
- لا أحد من الثلاثة يكتب في offers/programs؛ أي كتابة جديدة لواتساب العروض يجب أن تستخدم event_key فريداً مختلفاً عن نمط `request:{id}:…` لتجنب التصادم مع UNIQUE(event_key).

---

## 5) جدول whatsapp_outbox — طابور الإرسال (نمط outbox كامل)

المخطط db.js:469-485 (مؤكد بـ PRAGMA على النسخة):
```sql
CREATE TABLE IF NOT EXISTS whatsapp_outbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_key TEXT UNIQUE NOT NULL,          -- request:{id}:received أو request:{id}:update:{uuid}
  request_id INTEGER NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('received','status')),
  status_value TEXT,                        -- الحالة عند kind='status'
  recipient TEXT NOT NULL,                  -- دولي مطبع normalizeRecipient
  template_payload TEXT NOT NULL,           -- JSON { parameters: [...] } للقالب
  state TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT NOT NULL,
  message_id TEXT,                          -- معرف Graph API بعد الإرسال
  last_error TEXT,
  created_at TEXT NOT NULL,
  sent_at TEXT
);
CREATE INDEX idx_whatsapp_outbox_pending ON whatsapp_outbox(state, next_attempt_at);
```
الحالات الدورة الكاملة: `pending → processing → sent | pending(إعادة) | failed`، و`cancelled` عند إلغاء الاشتراك، وتُحدّث لاحقاً من الويب هوك إلى `delivered/read/failed` حسب message_id.
- **من يكتب**: enqueueWhatsAppNotice (whatsapp.js:75-95، INSERT OR IGNORE) — المستدعون: api.js:170 (استلام طلب عام) وapi.js:790 (تغيير حالة) وapi.js:834 (تسجيل عرض سعر). الشروط: الجهوزية بـ env + payload.whatsappUpdates=true + العميل غير مالغ الاشتراك + رقم قابل للتطبيع.
- **من يستهلك**: processWhatsAppOutbox (whatsapp.js:107-165): استعادة processing→pending عند البدء (:99)، سحب 10 رسائل pending مستحقة، قفل صفّي بـ UPDATE … WHERE state='pending'، إرسال قالب Graph API (`https://graph.facebook.com/{v}/{PHONE_NUMBER_ID}/messages`، v26.0 افتراضياً، Bearer token، timeout 12s)، نجاح → state=sent + message_id + sent_at؛ فشل → محاولات ≤ 8 (MAX_ATTEMPTS) وإلا failed، بتراجع أُسّي.
- **معاملات القوالب** (:82-88): received = [الاسم، reference، 'تم استلام طلبك', trackUrl]؛ status = [reference، تسمية الحالة، trackUrl].
- البيانات الحالية في النسخة: **0 صفوف** (الطابور نظيف؛ الإشعارات معطلة بدون env).

---

## 6) مصدر الحقيقة لأرقام واتساب الفرع/الموظف

| الكيان | المصدر | الحرفية |
|---|---|---|
| رقم واتساب الرئيسي | settings key `whatsapp` (JSON-encoded) | `962791193888` |
| أرقام واتساب الفروع | settings key `contactGroups` (JSON) | عمّان: 962791192888 / 962789795888 / 962782965441 · إربد: 962791193888 / 962790915827 · الإدارة: 962785301768، 962799507350 |
| أرقام عرض الفروع (أراضٍ) | settings key `branches` (JSON) | إربد `02-7244112` · عمّان `06-4600777` (تأكيد الادعاء حرفياً) |
| بذرة نفس القيم | data/seed.json:6 (whatsapp) و:58-70 (branches) | مطابقة |
| رقم موظف (مستشار) | users.phone عبر lib/workspace.js:311-314 (`consultantPhone`) وإلا fallback settings.whatsapp | users.phone = NULL حالياً ⇒ عملياً الرقم الرئيسي |
| جدول branches | لا يحوي أي هاتف (§2.1) | — |

الخلاصة: **الحقيقة في القاعدة (جدول settings كنصوص JSON) وليست في الكود ولا في env**؛ الكود يقرأ فقط (server.js:254، public.js:47-49) والأدمين يعدّلها (admin.js:1183-1184). البذرة seed.json تملأ الإعدادات الفارغة عند التهيئة فقط (db.js:770: «Insert reference data without touching operational data»).

---

## 7) كيف تبني الواجهة رسائل واتساب الجاهزة اليوم

| الموضع | الرقم المستخدم | النص |
|---|---|---|
| بعد إرسال طلب من الموقع (خادم، api.js:180-182) | settings.whatsapp (digits) | `السلام عليكم، لدي طلب رقم ${reference} وأرغب بمتابعته.` |
| مودال واتساب العام (app.js:569-573 + layout.js:321-335) | أرقام contactGroups (data-wa-number) | افتراضي `السلام عليكم، أرغب بالاستفسار عن خدمات لوريت` أو data-wa-text من الزر |
| دروار الأدمين (admin.js:467) | **payload.phone كما هي بعد حذف غير الأرقام** | بدون نص (?text غائب) — انظر الفجوة أدناه |
| Workspace مشاركة عرض (public/assets/js/workspace.js:76-79) | هاتف العميل r.phone عبر waLink (07→962) | `مرحبًا {اسم} 👋\nعرض رحلتك «{عنوان}» من لوريت جاهز.\nالتفاصيل والفنادق والطيران والسعر عبر الرابط:\n{url}\nلأي تعديل، رد علينا عبر واتساب.\nLaurette Travel ✈️` (قابل للتحرير في textarea قبل الإرسال) |
| صفحة العرض العامة /o/{token} (workspace.js:88) | o.consultantPhone (users.phone أو fallback) | `مرحبًا، أود التواصل بشأن العرض ${o.reference}` |
| إشعارات القوالب (خادم→Graph، whatsapp.js:82-88) | payload.phone مطبع | معاملات قوالب Cloud API (see §5) |

الترميز: كل النصوص تمر عبر `encodeURIComponent` في بناء `?text=` (app.js:573، api.js:181، workspace.js:76)؛ الأسطر الجديدة `\n` داخل نص القالب تعمل بعد الترميز. الأرقام للعرض المحلي تُشتق عكسياً `0${intl.slice(3)}` (layout.js:331).

**فجوات ملاحظة (مصمم العروض يجب أن يعيها):**
1. admin.js:467 يبني `wa.me/${digits(payload.phone)}` بدون تحويل دولي — رقم محلي `07…` يعطي wa.me/07… معطوباً؛ طبّق قاعدة waLink أو normalizeRecipient.
2. لا آلية `?ref=` للإسناد اليوم (§3) — البداية من الصفر.
3. users.phone فارغ عملياً؛ أي CTA «تواصل مع مستشارك» سيرتد للرقم الرئيسي حتى تُملأ.
4. أرقام branches أراضٍ تحتاج تحويل 962 (§2.3)؛ واتساب الفروع الحقيقي في contactGroups.
5. إشعار «تسجيل عرض سعر» يمرر نصاً عربياً حرّاً في معامل القالب (api.js:834) — STATUSES[status]?.label سيرجع النص كما هو (تصرف مقصود لكنه يتجاوز خريطة الحالات).
6. settings القيم مخزنة JSON-encoded (بعلامات اقتباس) — كل مستهلك إما JSON.parse أو strip، ولا تقرأها نصاً خاماً.

## ما لم أجده (نتيجة صفرية مُعلنة)
- لا ?ref= ولا أي قراءة query لمعامل إسناد في lib/ وpublic/assets/js/ وtools/.
- لا صفوف في requests/customers/whatsapp_outbox/whatsapp_chat_imports في نسخة القاعدة (جداول تشغيلية فارغة؛ المستخدم الوحيد admin). كل القيم الحرفية أعلاه من settings وseed.json.
- referenceValid غير مستوردة في أي ملف (تعريف فقط، lib/util.js:102).
