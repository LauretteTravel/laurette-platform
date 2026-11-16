# مرجع الواجهات (API)

كل النهايات تُرجع JSON بترميز UTF-8، عدا صفحات الموقع (HTML). الشكل الموحد:

```json
{ "ok": true, "..." : "..." }
{ "ok": false, "message": "رسالة عربية", "errors": { "field": "السبب" } }
```

- `401` بلا جلسة، `403` بلا صلاحية أو أصل غير مطابق، `404` غير موجود، `422` فشل تحقق، `429` تجاوز حد.
- كتابة الطلبات تتطلب ترويسة `X-Requested-With: fetch` أو `Origin` مطابقًا (`BASE_URL`).
- جلسة الإدارة: كوكي `lt_session` (HttpOnly، SameSite=Strict، 8 ساعات).

## عامة

| الطريقة | المسار | المدخل | المخرج |
|---|---|---|---|
| `GET` | `/api/programs` | `category`, `q`, `maxPrice`, `minDays`, `maxDays`, `sort`, `limit` | `{ programs: [...] }` |
| `GET` | `/api/programs/:slug` | — | `{ program: {...} }` أو 404 |
| `POST` | `/api/requests` | `{ type, ... }` | `201 { reference, summary, trackUrl, whatsapp }` |
| `POST` | `/api/track` | `{ reference, phone }` | `{ request: { status, statusLabel, summary, quote, timeline } }` |
| `POST` | `/api/recommend` | `{ budget, pax, style, trip, month }` | `{ matches: [...] , note }` |
| `POST` | `/api/assistant` | `{ message, sessionId?, consent }` | `{ reply, intent, sources, suggestions, escalate, sessionId }` |
| `GET` | `/health` | — | `{ ok, uptimeSeconds, seeded, programs }` |

### أنواع الطلبات (`type`) وحقولها المطلوبة

| النوع | البادئة | الحقول الأساسية |
|---|---|---|
| `flight` | `LT-FL` | `tripType` (`return|oneway|multi`), `origin`, `destination`, `departDate`, `returnDate?`, `segments?[{from,to,date}]`, `adults`, `children`, `infants`, `cabin`, `baggage`, `name`, `phone`, `consent` |
| `hotel` | `LT-HT` | `country`, `city`, `checkIn`, `checkOut`, `rooms`, `adults`, `children`, `childAges[]`, `stars`, `mealPlan`, `name`, `phone`, `consent` |
| `program` | `LT-PG` | `programSlug`, `optionLabel?`, `adults`, `children`, `infants`, `preferredDate?`, `name`, `phone`, `consent` |
| `umrah` | `LT-UM` | نفس `program` + `roomType` (`single|double|triple|quad|custom`) |
| `visa` | `LT-VS` | `nationality`, `residence`, `destination`, `visaType`, `purpose`, `travelDate?`, `applicants`, `previousVisas?`, `name`, `phone`, `consent` |
| `consult` | `LT-CS` | `topic` (`trip|visa|flight|hotel|honeymoon|family|umrah|general`), `message`, `channel` (`whatsapp|phone|email`), `name`, `phone`, `consent` |

ملاحظات:
- `phone` يُطبَّع (إزالة المسافات والأقواس، `00` ← `+`) ويُخزَّن موحدًا.
- `consent` إلزامي `true` وإلا `422`.
- التكرار الحمولة نفسه من الرقم نفسه خلال 15 دقيقة يعيد `200` مع نفس `reference` و`duplicate: true`.
- حدود المعدل: 20 طلبًا/ساعة لكل IP، 30 تتبعًا/ساعة، 80 رسالة مساعد/ساعة.

### المساعد

```json
POST /api/assistant
{ "message": "بدي برنامج عمرة اقتصادي", "consent": true }

200
{
  "ok": true,
  "reply": "برامج العمرة المتاحة حاليًا ...",
  "intent": "umrah",
  "sources": [{ "label": "قسم الحج والعمرة", "url": "/umrah" }],
  "suggestions": ["عمرة اقتصادية", "عمرة VIP"],
  "escalate": false,
  "sessionId": "a1b2c3d4e5f6"
}
```

- `sessionId` يُنشأ فقط عند `consent: true`؛ بلا موافقة لا يُحفظ أي شيء في القاعدة.
- عند غياب معلومة موثوقة: `escalate: true` ونص يحوّل العميل إلى موظف.

### استيراد محادثات واتساب

لتفعيل الاستيراد يضبط مسؤول الخادم `WHATSAPP_BRIDGE_ENABLED=true` و`EXTENSION_SECRET`، ثم يُدخل قيمة المفتاح في إعدادات إضافة **WhatsApp to CRM Bridge**. ترسل الإضافة طلب `POST /api/save-chat` مع `Authorization: Bearer <token>` و`Content-Type: application/json`.

```json
{
  "source": "whatsapp-web",
  "contact": { "name": "عميل تجريبي", "phone": null },
  "messages": [
    { "id": null, "direction": "incoming", "text": "رسالة تجريبية", "label": null }
  ]
}
```

يتطلب الطلب اسمًا أو رقم هاتف، ومن رسالة واحدة إلى عشر رسائل. تُحفظ المحادثة في جدول `whatsapp_chat_imports` في SQLite. يعيد الحفظ الأول `201 { ok: true, id }`، ويعيد تكرار البيانات المطابقة `200 { ok: true, id, duplicate: true }`. يعيد الرمز غير الصحيح `403`. عند إيقاف الاستيراد أو غياب المفتاح، يعيد المسار `503`.

يتضمن رد النجاح `analysis`، وفيه اسم العميل ورقمه الأساسي إن توفر، والتصنيف المبني على كلمات رسائل العميل، وعدد الرسائل، ووقت التحليل، والحالة `PENDING_REVIEW`. يجري التحليل داخل الخادم ويُحفظ في `analysis_json` مع المحادثة. عند إعادة إرسال سجل قديم، يحسب الخادم تحليله إذا كان الحقل فارغًا.

## الإدارة (تتطلب جلسة)

| الطريقة | المسار | الصلاحية | الغرض |
|---|---|---|---|
| `POST` | `/api/auth/login` | عام | `{ username, password }` → `{ user }` + كوكي |
| `POST` | `/api/auth/logout` | جلسة | إبطال الجلسة |
| `GET` | `/api/auth/me` | عام | المستخدم الحالي أو `null` |
| `POST` | `/api/auth/change-password` | جلسة | `{ currentPassword, newPassword }` |
| `GET` | `/api/admin/overview` | `overview:read` | إحصاءات، أحدث الطلبات، ما يحتاج إجراءً |
| `GET` | `/api/admin/requests` | `requests:read` | `status`, `type`, `q`, `assigned=me`, `page` |
| `GET` | `/api/admin/requests/:id` | `requests:read` | تفاصيل + حمولة + أحداث + موظفون + الحالات التالية |
| `PATCH` | `/api/admin/requests/:id` | `requests:write` | `{ status?, assignedTo?, quoteAmount?, quoteNote?, note? }` |
| `GET` | `/api/admin/customers` | `customers:read` | `q` |
| `GET` | `/api/admin/customers/:id` | `customers:read` | ملف + طلباته |
| `PATCH` | `/api/admin/customers/:id` | `customers:write` | `{ name?, email?, notes?, preference?, country? }` |
| `GET/POST` | `/api/admin/{resource}` | حسب المورد | قائمة/إنشاء |
| `PATCH/DELETE` | `/api/admin/{resource}/:id` | حسب المورد | تعديل/حذف |
| `GET/POST` | `/api/admin/users` | `users:write` | الموظفون |
| `PATCH` | `/api/admin/users/:id` | `users:write` | `{ role?, department?, active?, password?, name? }` |
| `GET` | `/api/admin/audit` | `audit:read` | آخر 200 عملية |
| `GET/PATCH` | `/api/admin/settings` | `settings:write` | إعدادات الموقع |
| `GET` | `/api/admin/assistant-log` | `overview:read` | جلسات المساعد |

`resource` ∈ `programs | offers | news | articles | faq | visa | kb | destinations | reviews`.

### انتقالات الحالة

```
new → reviewing → quoted → awaiting → confirmed
  ↘ cancelled      ↘ cancelled   ↘ cancelled / quoting again
```
أي انتقال آخر يعيد `422` مع رسالة عربية. كل تغيير يكتب صفًا في `request_events`.

### أمثلة

```bash
# طلب تذكرة
curl -s localhost:3000/api/requests \
  -H 'content-type: application/json' -H 'x-requested-with: fetch' \
  -d '{"type":"flight","tripType":"oneway","origin":"عمّان (AMM)","destination":"إسطنبول (IST)",
       "departDate":"2026-11-20","adults":2,"children":0,"infants":0,"cabin":"economy",
       "name":"أحمد","phone":"0791234567","consent":true}'

# متابعة
curl -s localhost:3000/api/track \
  -H 'content-type: application/json' -H 'x-requested-with: fetch' \
  -d '{"reference":"LT-FL-XXXXXX","phone":"0791234567"}'

# دخول إداري
curl -s -c cookies.txt localhost:3000/api/auth/login \
  -H 'content-type: application/json' -H 'x-requested-with: fetch' \
  -d '{"username":"laurette","password":"..."}'

# تحديث حالة
curl -s -b cookies.txt -X PATCH localhost:3000/api/admin/requests/1 \
  -H 'content-type: application/json' -H 'x-requested-with: fetch' \
  -d '{"status":"reviewing","note":"تم التواصل"}'
```

## الصفحات المولّدة

`/sitemap.xml` (من القاعدة)، `/robots.txt`، `/site.webmanifest`، `/art/:key.svg?v=0..3` (رسوم أصلية قابلة للتخزين المؤقت).

## ميزة العروض على البرامج (2026-11)

### POST /api/public/offer-lead — عامة

طلب عرض سعر من صفحة العرض المستقلة `/p/:slug`. حد المعدل 20 طلبًا/ساعة لكل IP، وبحارس CSRF نفسه (ترويسة `X-Requested-With: fetch` أو Origin مطابق).

المدخل (JSON ≤64KB):

| الحقل | إلزامي | ملاحظات |
|---|---|---|
| `slug` | نعم | برنامج بحالة `published` أو `sold_out`، وإلا `404` «العرض غير متاح» |
| `name` / `phone` / `consent` | نعم | نفس قواعد `/api/requests` (الاسم 2–80، الهاتف `/^\+?[0-9]{8,15}$/` بعد التطبيع، `consent=true`) |
| `adults` | نعم | 1–30 — تحقق الطلبات يفرضه |
| `children` / `infants` | لا | 0–20 / 0–10 (افتراضي 0) |
| `tier` | لا | نص فئة السعر → `optionLabel` (يُقص 200؛ تحقق الطلب يقبل ≤160) |
| `preferredDate` / `roomType` | لا | `YYYY-MM-DD` (يُسمح بالماضي) / `single\|double\|triple\|quad\|custom` |
| `email` / `notes` | لا | بريد صالح / ملاحظات ≤1000 |
| `ref` | لا | id موظف `active=1` للإسناد؛ غير صالح يُهمل بصمت |
| `branch` | لا | `irbid` أو `amman`؛ غير صالح يُهمل بصمت |
| `whatsappUpdates` | لا | موافقة تحديثات واتساب |

الاستجابة `201` (أو `200` عند تكرار خلال 15 دقيقة):

```json
{ "ok": true, "reference": "LT-UM-XXXXXX", "summary": "…", "duplicate": false, "value": 419,
  "type": "umrah", "typeLabel": "طلب عمرة", "trackUrl": "/track?reference=…", "whatsapp": "https://wa.me/…", "advisorName": "…" }
```

- `type` مشتق من فئة البرنامج (`umrah` إذا `category='umrah'` وإلا `program`)، و`advisorName` اسم الموظف المُسند عند `ref` صالح وإلا `null`، و`value` من `price_from` للبرنامج وقت الطلب.
- داخليًا: `source='offer-page'`، إسناد عند الإنشاء مع سجل في `request_owner_history`، إشعار واتساب الداخلي كما في `/api/requests`.
- الأخطاء: `404` العرض غير متاح · `422` `{ ok:false, message, errors:{حقل:سبب} }` · `429` تجاوز الحد · `403` حارس CSRF · `400/415` JSON تالف.

### POST /api/inquiries — عامة

صندوق «اطلب فندق آخر / استفسر» في بطاقات البرامج ونافذة العروض وصفحة `/p/:slug`. حد المعدل 20 طلبًا/ساعة لكل IP، وبحارس CSRF نفسه (ترويسة `X-Requested-With: fetch` أو Origin مطابق). يُخزَّن في جدول `program_inquiries` (وليس `requests`) لأن الاستفسار لا يمرّ بدورة عرض السعر والتحويل بين الأقسام.

المدخل (JSON ≤16KB):

| الحقل | إلزامي | ملاحظات |
|---|---|---|
| `name` | نعم | 2–80 حرفًا |
| `phone` | نعم | يُقبل محليًا `0791234567` أو دوليًا `+962791234567`/`00962…`؛ يُخزَّن بصيغة `+962…` ويُرفض الأردني المبتور |
| `consent` | نعم | `true` — الواجهة تعرض مربّع الموافقة نفسه في كل نماذج الموقع |
| `inquiryType` | لا | `alternative_hotel` (افتراضي) \| `availability` \| `group_quote` |
| `slug` / `programId` | لا* | سياق البرنامج؛ إن وُجد صف منشور في `programs` فبياناته هي المرجع (العنوان/الفندق/المدة/السعر) |
| `title` / `category` / `duration` / `priceLabel` | لا | بديل لعروض `/offers` التي لا صف برنامج لها؛ تُنقّى وتُقص ولا تُستخدم إلا للعرض |
| `notes` | لا | الفندق المطلوب أو عدد الأشخاص والأطفال ≤600 حرف |
| `branch` | لا | `amman` \| `irbid`؛ يحدد رقم واتساب الفرع وإلا الرقم العام |

\* مطلوب `slug` أو `programId` أو `title`؛ وإلا `422` «العرض المحدد غير متاح».

الاستجابة `201` (أو `200` عند تكرار خلال 10 دقائق بنفس الهاتف والبرنامج والنوع):

```json
{ "ok": true, "reference": "LT-HI-XXXXXX", "duplicate": false, "inquiry": { "…": "…" },
  "whatsappUrl": "https://wa.me/962791192888?text=…", "whatsappText": "…" }
```

- `whatsappUrl` جاهز للفتح بضغطة واحدة بعد الإرسال (رسالة عربية منسّقة: البرنامج، الفندق الحالي، نوع الاستفسار، الفندق المطلوب، الاسم، الهاتف، الفرع، المرجع).
- `N8N_INQUIRY_WEBHOOK_URL` اختياري في `.env`: عند ضبطه يُرسَل `POST` غير متزامن (مهلة 5 ثوانٍ، لا يحجب الرد) بجسم `{ event, sentAt, inquiry, whatsappText, adminUrl }`.
- الأخطاء: `422` `{ ok:false, message, errors:{حقل:سبب} }` · `429` تجاوز الحد · `403` حارس CSRF · `400/415` JSON تالف.

### GET /api/admin/inquiries — إدارية

قائمة الاستفسارات + عدادات الحالات + بحث وتصفيح. الصلاحية `requests:read`.

- استعلام: `status` (`new` \| `contacted` \| `booked` \| `cancelled`) · `q` (اسم/هاتف/برنامج/ملاحظات/مرجع) · `page` · `limit` (≤100، افتراضي 25).
- الاستجابة: `{ ok, inquiries[], total, page, pages, counts:{new,contacted,booked,cancelled,total}, statuses, types }`.

### GET /api/admin/inquiries/count — إدارية

`{ ok, counts }` فقط — شارة القائمة الجانبية (عدد `new`). الصلاحية `requests:read`.

### PATCH /api/admin/inquiries/:id — إدارية

`{ "status": "contacted" }`. الانتقال بين الحالات الأربع حر (بلا آلة حالات) ويُسجَّل في `audit_log` باسم `update-inquiry`. الصلاحية `requests:write`. الأخطاء: `422` حالة غير معروفة أو استفسار غير موجود.

### POST /api/admin/programs/:id/upload-brochure — إدارية

رفع بوستر أو بروشور للبرنامج. صلاحية `programs:write`. المدخل (JSON ≤16MB): `{ kind: 'poster'|'brochure', filename: 'اسم الملف', base64: 'محتوى الملف' }`.

- الحدود بعد فك base64: بوستر ≤5MB وبروشور ≤10MB، وإلا `413`.
- الفحص بالبايتات السحرية لا بالامتداد: بوستر JPEG/PNG/WebP وبروشور `%PDF-` فقط، وإلا `415` «نوع الملف غير مدعوم». base64 غير صالح → `400`.
- الاسم يُنظَّف من أي مسار (basename ثم `[^a-zA-Z0-9._-]→-` و≤60) ويُحفظ في `public/media/offers/` باسم `<اسم-منظف>-poster|brochure-<طابع-base36>.jpg|png|webp|pdf`.

الاستجابة: `{ ok, kind, url: '/media/offers/<file>', size }` — و`url` يُكتب في `poster_image` أو `pdf_brochure_url` مع `updated_at`، وتُسجل العملية في `audit_log`.

### حقول programs الجديدة في PATCH /api/admin/programs/:id

| الحقل (camelCase) | العمود | القبول |
|---|---|---|
| `department` | `department` | نص |
| `posterImage` | `poster_image` | نص (يُضبط آليًا بنقطة الرفع) |
| `pdfBrochureUrl` | `pdf_brochure_url` | نص (يُضبط آليًا بنقطة الرفع) |
| `imageUrl` | `image_url` | نص — أصبحت قابلة للإدارة |
| `pricingTiers` | `pricing_tiers_json` | قائمة JSON أو أسطر `hotel\|stars\|room\|price\|notes` (الحقول بعد `hotel` اختيارية) بحد 30 عنصرًا وكل نص ≤200 حرف؛ تُخزَّن `[{ hotel, stars, room, price, notes }]` |

الحقول الجديدة تعود أيضًا في `GET /api/programs` و`GET /api/programs/:slug` (بما فيها `pricingTiers` مفكوكة). `viewsCount` عدّاد داخلي ولا يُقبل من الإدارة.
