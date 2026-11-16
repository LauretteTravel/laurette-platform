# عقد نقطة الطلب من صفحة العرض — POST /api/public/offer-lead

ملاحظات تعاقدية نهائية من الخلفية (ملفات: lib/api.js, lib/db.js, server.js) لزميل الواجهة (صفحة /p/:slug في lib/views/offer-micro.js).
التاريخ: 2026-11-14 — مهمة ترقية الخلفية لميزة العروض.

## 1) المسار والحدود

- `POST /api/public/offer-lead` — JSON ≤64KB، حد 20 طلبًا/ساعة لكل IP (`429` مع ترويسة `retry-after` عند التجاوز).
- مثل كل POST العامة: يلزم ترويسة `x-requested-with: fetch` أو Origin مطابق (حارس server.js على كل `/api/` غير GET) وإلا `403`.
- الاستجابة `201` عند الإنشاء، و`200` عند تكرار (نفس الهاتف + نفس hash الحمولة خلال 15 دقيقة → نفس `reference` و`duplicate: true`).
- لا مصادقة — عامة للزوار.

## 2) ما يرسله الواجهة فعليًا (المتحقق من validateRequest في lib/domain.js)

إلزامي (وإلا `422 { ok:false, message:'تحقق من الحقول المطلوبة', errors:{حقل:سبب عربي} }`):

| الحقل | القاعدة الفعلية |
|---|---|
| `slug` | نص؛ برنامج بحالة `published` أو `sold_out` — غير ذلك `404 «العرض غير متاح»` قبل أي تحقق |
| `name` | 2–80 محرفًا بعد تطبيع المسافات |
| `phone` | يُنظف (مسافات/شرطات/أقواس، `00`→`+`) ثم `/^\+?[0-9]{8,15}$/` (مثال: `0791234567` أو `+962791234567`) |
| `adults` | عدد صحيح 1–30 — **انتبه: إلزامي في validateRequest لنوعي program/umrah** حتى لو لم يسأل النموذج عنه؛ أرسل `adults` دائمًا (الحد الأدنى 1) |
| `consent` | `true` (أو `1`/`'on'`) — وإلا `422` على حقل `consent` «يلزم الموافقة على حفظ البيانات للتواصل معك» حتى لو كان الباقي سليمًا |

اختياري:

| الحقل | القاعدة الفعلية |
|---|---|
| `children` / `infants` | 0–20 / 0–10، افتراضي 0 عند الغياب |
| `email` | عند وجوده `/^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/` |
| `notes` | ≤1000 محرف |
| `tier` | نص الفئة المختارة من `pricingTiers` → يتحول إلى `optionLabel`. الخلفية تقص 200 لكن validateRequest يرفض `optionLabel` > 160 محرفًا — أبقِ الفئة ≤160 في الواجهة |
| `preferredDate` | `YYYY-MM-DD` صالح (يُسمح بتاريخ ماضٍ) |
| `roomType` | `single\|double\|triple\|quad\|custom` (متاح لنوعي program وumrah) |
| `whatsappUpdates` | `true` لتسجيل موافقة تحديثات واتساب (اعرض الحقل فقط عندما يكون جسر الواتساب جاهزًا — نفس سلوك forms.js) |
| `ref` | رقم `id` موظف نشط (`active=1`). قيمة غير صالحة/غير رقمية/موظف غير نشط → تُهمل بصمت: لا فشل، بلا إسناد، `advisorName: null` |
| `branch` | `irbid` أو `amman` (code الفرع). غير صالح → يُهمل بصمت، ويعود `branchId` إلى فرع الموظف المُسند إن وجد وإلا `null` |

## 3) الاستجابة الناجحة

```json
{ "ok": true, "reference": "LT-UM-XXXXXX", "summary": "…", "duplicate": false, "value": 419,
  "type": "umrah", "typeLabel": "طلب عمرة", "trackUrl": "/track?reference=…",
  "whatsapp": "https://wa.me/962791193888?text=…", "advisorName": "اسم الموظف أو null" }
```

- `type` مشتق من البرنامج نفسه: `category='umrah'` → `umrah` وإلا `program` (الواجهة لا تختاره).
- `value` من `price_from` للبرنامج وقت الطلب (0 إن كان السعر غير محدد).
- `whatsapp` يعتمد على `settings.whatsapp` وقد يكون `null`.

## 4) الأخطاء

| الحالة | السبب |
|---|---|
| `404` | `{ ok:false, message:'العرض غير متاح' }` — slug غير موجود أو draft/archived |
| `422` | فشل التحقق — نفس شكل `/api/requests` (خريطة `errors` بحقول عربية) |
| `429` | تجاوز 20 طلب/ساعة لكل IP |
| `403` | حارس CSRF (بدون `x-requested-with: fetch` أو Origin مطابق) |
| `400/415` | JSON تالف أو content-type غير `application/json` |

## 5) ما تفعله الخلفية داخليًا (للعلم)

- `source='offer-page'` و`lead_origin` بنفس القيمة؛ `priceFromAtRequest`/`currencyAtRequest` تُلزَم من البرنامج وقت الطلب ولا تُقبل من العميل.
- الإسناد عند `ref` صالح: `assigned_to` و`service_owner_id` = الموظف، سجل في `request_owner_history` بملاحظة «إسناد عند الإنشاء»، وحدث created باسم الموظف بدل «الموقع».
- الفرع: `branch_id` و`received_branch_id` من `body.branch` أو فرع الموظف المُسند؛ القسم الافتراضي من النوع (umrah → قسم الحج والعمرة، program → قسم الهوليداي والبرامج السياحية).
- إشعار واتساب الداخلي `enqueueWhatsAppNotice('received')` يُجدول كما في `/api/requests`.

## 6) قراءة الأسعار والصور في الصفحة

- `GET /api/programs` و`GET /api/programs/:slug` يعيدان الآن أيضًا: `department`، `posterImage` (`poster_image`)، `pdfBrochureUrl` (`pdf_brochure_url`)، و`pricingTiers` — مصفوفة `{ hotel, stars (int|null), room, price (float|null), notes }` مفكوكة بأمان (فشل JSON → `[]`).
- `priceFrom` يبقى «يبدأ من» ولا يُعرض سعرًا نهائيًا؛ صفحة `/p/:slug` تُقدَّم HTML من الخادم ولا تحتاج API للقراءة — الإرسال فقط إلى نقطة الـlead.

## 7) نقطة الرفع الإدارية (لزميل لوحة الإدارة)

- `POST /api/admin/programs/:id/upload-brochure` — جلسة إدارية بصلاحية `programs:write`.
- الجسم: `{ kind: 'poster'|'brochure', filename, base64 }` (JSON ≤16MB).
- الحدود بعد فك base64: بوستر ≤5MiB، بروشور ≤10MiB (`413`). الفحص بالبايتات السحرية: JPEG/PNG/WebP للبوستر و`%PDF-` للبروشور فقط (`415 «نوع الملف غير مدعوم»`)؛ base64 غير صالح → `400`.
- يُحفظ في `public/media/offers/<اسم-منظف>-poster|brochure-<طابع-base36>.<امتداد من الـmagic>` ويعيد `{ ok, kind, url: '/media/offers/<file>', size }` مع تحديث العمود المناسب و`updated_at` وتدقيق `audit_log`.

## 8) قرارات تفسيرية (شفافية)

1. اسم ملف الرفع النهائي = الاسم المُدخل بعد basename وتنظيف `[^a-zA-Z0-9._-]→-` وقصّه 60، ثم لاحقة `-poster-`/`-brochure-` + طابع base36 + امتداد مفروض من الـmagic. إذا جاء `filename` فارغًا يعوض بـslug البرنامج المنظف. (القراءة الأرجح لصيغة التكليف؛ يمكن تغييرها بقرار صريح.)
2. تمرر الخلفية أيضًا `ip` و`userAgent` إلى meta الطلب (نفس نمط `/api/requests`) لتخزينهما في payload للتتبع.
3. قيم `tier` بين 161–200 محرفًا ستُرفض بـ422 بسبب سقف validateRequest (160) — قرار الواجهة هو تقييد الإدخال ≤160.
4. لم يُلمس seed INSERT ولا أي ملف خارج نطاق الخلفية؛ تعديلات workspace-v2 السابقة بقيت كما هي.
