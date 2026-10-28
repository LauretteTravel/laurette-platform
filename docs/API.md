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
