# إعداد n8n وSMTP وربط Render — لوريت

هذا الدليل يكمّل الكود الموجود في `lib/webhooks.js`. الموقع يرسل حدث `booking.created` إلى n8n عند كل طلب جديد، وn8n يرسل بريدًا للفريق وردًا تلقائيًا للعميل عبر SMTP.

```
الموقع (Render) ──POST موقّع HMAC──▶ n8n Webhook ──▶ تحقق التوقيع ──▶ SMTP ──▶ فريق الحجز + العميل
        └── يسجّل كل محاولة في جدول webhook_deliveries (تظهر في /api/admin/webhooks)
```

---

## 1. ما تحتاجه قبل البدء

| العنصر | من يوفّره | ملاحظات |
|---|---|---|
| رابط Webhook من n8n (Production URL) | أنت | بعد إنشاء الـworkflow وتفعيله |
| سر مشترك (32 بايت عشوائي) | أنت | نولّده بأمر واحد، ونفس القيمة في المكانين |
| بيانات SMTP | مزوّد البريد أو مستضيف الموقع | الجدول أدناه |
| بريد فريق الحجز | أنت | `BOOKING_NOTIFY_TO` |
| بريد المرسل المعتمد | مزوّد SMTP | يجب أن يكون نطاقًا موثّقًا (SPF/DKIM) لئلا يذهب للسبام |

### بيانات SMTP المطلوبة (هي نفس الحقول في أي مزوّد)

| الحقل | مثال | ملاحظة |
|---|---|---|
| Host | `smtp.hostinger.com` / `smtp.gmail.com` | من لوحة المزوّد |
| Port | `465` (SSL) أو `587` (STARTTLS) | 465 مع `secure=true` |
| User | `bookings@laurettetravel.com` | غالبًا البريد كاملًا |
| Password | كلمة مرور التطبيق | Gmail يتطلب App Password لا كلمة الحساب |
| Secure | `true` لـ465 / `false` لـ587 | |
| From | `لوريت <bookings@laurettetravel.com>` | يجب أن يطابق النطاق الموثّق |

أمثلة سريعة:
- **Gmail Workspace:** `smtp.gmail.com`, 465, App Password, ويجب تفعيل 2FA أولًا.
- **Hostinger/cPanel:** `smtp.<domain>`, 465, بريد المنشأ نفسه.
- **Zoho:** `smtp.zoho.com`, 465.
- **Resend/SendGrid (SMTP relay):** يعطون Host/User/Pass خاصة، والمنفذ 587 عادة.

---

## 2. توليد السر المشترك

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

انسخ الناتج (64 حرفًا). هذا هو `N8N_BOOKING_WEBHOOK_SECRET` — نفس القيمة في Render وفي n8n. لا تضعه في الكود ولا في git.

---

## 3. إعداد n8n

1. **Import** الملف: `integrations/n8n/laurette-booking-workflow.json` (Workflows → Import from file).
2. افتح عقدة **إشعار الفريق** → Credential → **Create new SMTP** وأدخل بيانات الجدول أعلاه، واسم الاعتماد `Laurette SMTP`. كرّر نفس الاعتماد في عقدة **رد تلقائي للعميل** (اختر الاعتماد الموجود).
3. أضف متغيرات بيئة n8n (Settings → Variables أو بيئة الحاوية):
   - `N8N_BOOKING_WEBHOOK_SECRET` = السر من الخطوة 2
   - `BOOKING_NOTIFY_TO` = بريد فريق الحجز
   - `BOOKING_FROM` = بريد المرسل
4. افتح عقدة **استقبال طلب الحجز** → انسخ **Production URL** (شكله `https://n8n.example.com/webhook/laurette-booking`).
5. **فعّل الـworkflow** (Active). الويبهوك غير المفعّل يرجع 404.
6. جرّب يدويًا: Execute workflow → استخدم أمر الاختبار في القسم 6 (الطلب اليدوي بلا توقيع صحيح يجب أن يرجع 401، وهذا نجاح للتحقق).

> ملاحظة: إذا أعطى node «توقيع صالح؟» خطأ في الشرط، افتحه واختر Operator = **is true** واحفظ — بعض إصدارات n8n تخزّن الشرط المنطقي بصيغة مختلفة عند الاستيراد.

---

## 4. متغيرات Render

Settings → Environment → أضف:

| المتغير | القيمة | إلزامي |
|---|---|---|
| `N8N_BOOKING_WEBHOOK_URL` | `https://<n8n-host>/webhook/laurette-booking` | نعم للتشغيل |
| `N8N_BOOKING_WEBHOOK_SECRET` | السر (64 حرفًا) | نعم |
| `N8N_BOOKING_TIMEOUT_MS` | `6000` | اختياري |

بعد الحفظ يعيد Render النشر تلقائيًا. للتحقق:

```powershell
# يعرض configured + آخر 100 محاولة
curl.exe -s "https://<موقعك>/api/admin/webhooks" -H "Cookie: <جلسة مدير>"
```

> إن غاب أي من المتغيرين، يتخطى الموقع الإرسال بهدوء (`status: skipped`) ولا يتأثر إنشاء الطلب إطلاقًا.

---

## 5. كيف يعمل التوقيع (للمراجعة الأمنية)

```
signature = "sha256=" + HMAC_SHA256(secret, f"{timestamp}.{rawBody}")
```

- الهيدرات: `x-loret-event`, `x-loret-timestamp`, `x-loret-signature`, `x-loret-delivery`.
- `rawBody` هو JSON المضغوط بلا مسافات (نفس ما يرسله `JSON.stringify`).
- n8n يرفض أي توقيع غير مطابق، أو طابع زمني أقدم من 5 دقائق (يمنع إعادة الإرسال).
- المقارنة تتم بـ`timingSafeEqual`.

---

## 6. اختبار محلي شامل (من غير n8n)

**أ) خادم يستقبل الطلب:**

```powershell
node -e "require('http').createServer((q,s)=>{let b='';q.on('data',c=>b+=c);q.on('end',()=>{console.log('SIG',q.headers['x-loret-signature']);console.log(b);s.writeHead(200,{'content-type':'application/json'});s.end('{\"ok\":true}')})}).listen(4599,()=>console.log('listening 4599'))"
```

**ب) تشغيل الموقع مع المتغيرات:**

```powershell
$env:N8N_BOOKING_WEBHOOK_URL='http://127.0.0.1:4599/webhook/laurette-booking'
$env:N8N_BOOKING_WEBHOOK_SECRET='test-secret-please-rotate'
node server.js
```

**ج) إنشاء طلب حقيقي** (نموذج الاستشارة الأبسط):

```powershell
curl.exe -s -X POST http://127.0.0.1:3000/api/requests -H "Content-Type: application/json" -d "{\"type\":\"consult\",\"name\":\"اختبار\",\"phone\":\"0790000000\",\"consent\":true,\"notes\":\"اختبار ويبهوك\"}"
```

**د) تحقّق من السجل:**

```powershell
node -e "const {DatabaseSync}=require('node:sqlite');const d=new DatabaseSync('data/laurette.db');console.log(d.prepare('SELECT reference,status,response_code,error,duration_ms FROM webhook_deliveries ORDER BY id DESC LIMIT 3').all())"
```

---

## 7. استكشاف الأخطاء

| العَرَض | السبب المرجّح | الحل |
|---|---|---|
| `status: failed, HTTP 404` | الـworkflow غير مفعّل أو المسار مختلف | فعّل الـworkflow وتأكد من `/webhook/...` وليس `/webhook-test/...` |
| `HTTP 401` من n8n | السر مختلف أو جسم الطلب أُعيد تسلسله بشكل مختلف | وحّد `N8N_BOOKING_WEBHOOK_SECRET` في الطرفين |
| `timeout after 6000ms` | n8n بطيء/متوقف | ارفع `N8N_BOOKING_TIMEOUT_MS` أو أصلح الشبكة |
| بريد الفريق يصل والرد التلقائي لا | العميل لم يُدخل بريدًا | طبيعي — الشرط `لدى العميل بريد؟` |
| البريد يذهب للسبام | SPF/DKIM غير مضبوط أو From غير مطابق | اضبط سجلات النطاق واستخدم نفس بريد الاعتماد |
| لا توجد صفوف في `webhook_deliveries` | المتغيرات غير موجودة (skipped) أو لم يُنشأ طلب جديد | أعد النشر وتأكد من المتغيرين |

---

## 8. ما لم يتم التحقق منه (بصراحة)

- **لم أستورد الـworkflow على نسخة n8n حقيقية** ولا أرسلت بريدًا فعليًا: لا يوجد n8n/SMTP في هذه البيئة. الملف مكتوب حسب مخطط n8n المعتاد، والتحقق النهائي يحتاج تركيبًا عندك (دقيقة واحدة: Import → Credential → Active).
- تُحقّق من جانب الموقع بالكامل: التوقيع، الهيدرات، تسجيل المحاولات، وعدم تأثّر الطلب عند فشل الإرسال (اختبارات في `tests/webhook.test.js`).
- **Render**: أضف المتغيرين يدويًا؛ لا أستطيع الوصول إلى حسابك. ملاحظة: الخطة المجانية بلا قرص دائم، فـSQLite تُفقد عند كل نشر — استخدم خطة بها Disk (انظر `render.yaml`).

---

## 9. مزامنة الحالة مع الشيت (إصلاح تصعيد 24 ساعة)

**المشكلة:** التصعيد يقرأ عمود `Status` في الشيت، فلو أُغلق الطلب في لوحة الإدارة ولم يُغلق في الشيت، سيصعّده n8n خطأً.

**الحل المنفّذ:** الموقع يرسل ثلاثة أحداث إلى نفس الويبهوك:

| الحدث | متى | أهم الحقول |
|---|---|---|
| `booking.created` | إنشاء طلب | `reference, type, customer, details` |
| `booking.status_changed` | كل تغيير حالة من اللوحة | `from, to, toLabel, dealStatus, closed, quoteAmount, actor` |
| `booking.quoted` | تسجيل أو تعديل عرض سعر | `amount, currency, status` |

**القاعدة في الشيت:**
- ابحث عن الصف بالمفتاح `reference` (ثابت لا يتغير).
- اكتب `Status` = `toLabel`، وعمود `Closed` = `closed`.
- شرط تصعيد الـ24 ساعة: `Closed = FALSE` **و** `Status` ليست «مكتمل» ولا «ملغى».
- عند `closed = true` (confirmed/cancelled) أوقف أي تصعيد لهذا الصف.

**المرجعية:** قاعدة الموقع هي المصدر الرسمي. إن تعارض الشيت مع اللوحة فالصحيح هو اللوحة، ويُعاد ضبط الشيت بأول حدث قادم.

### ترويسة X-API-Key (إن استخدمت وسيطًا)

إن كان لديك وسيط Proxy يتحقق من مفتاح ثابت، أضف `N8N_API_KEY` في Render — سيُرسل الموقع `x-api-key` تلقائيًا **مع** توقيع HMAC. التوقيع يبقى الأساس، والمفتاح للتوافق مع الوسيط فقط.

> ملاحظة معمارية: الموقع نفسه خادم Node، لذا **لا حاجة** لوسيط Express منفصل — الإرسال يتم من الخادم مباشرة، بلا CORS وبلا تعريض أي مفتاح للمتصفح. كود الوسيط الذي أُرسل يمكن الاستغناء عنه بالكامل.
