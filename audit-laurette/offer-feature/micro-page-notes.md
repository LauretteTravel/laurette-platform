# ملاحظات صفحة العرض المستقلة /p/:slug — وكيل الواجهة (offer-micro)

**التاريخ:** 2026-11-14 · **ملفاتي حصراً:** `lib/views/offer-micro.js` (جديد) + إلحاق قسم بنهاية `public/assets/css/app.css` + هذا الملف. لم يُلمس أي ملف آخر، ولا git، ولا تشغيل سيرفر.

---

## 1) نتيجة فحص CSP المطلوبة (للزميل المسؤول عن lib/http.js) — أهم ما في هذا الملف

### 1.1 ما هو سليم ولا يحتاج تعديلاً
- `frame-src 'self'` (http.js:113,132): **يسمح** بإطار iframe من نفس الأصل — توجيه frame-src نفسه لا يمنع شيئاً لصفحتي.
- `object-src` غير معلن → يسقط إلى `default-src 'self'` (http.js:126): سماح لنفس الأصل؛ وعلى أي حال أستخدم `<iframe>` لا `<object>`.
- `style-src 'self' 'unsafe-inline'` (128): يسمح بـ`<style>` المضمّن في الصفحة ✓.
- `script-src 'self' 'nonce-…'` (111): استخدمت nonce الـctx للسكربت المضمّن ولـJSON-LD كما تفعل الصفحات الأخرى ✓.
- `connect-src 'self'` (112,131): يسمح بـfetch إلى /api/track-event و/api/public/offer-lead ✓.

### 1.2 ما سيمنع العارض المدمج فعلياً — يحتاج تعديلك (أنا لم أعدّل http.js/server.js التزاماً بالحدود)
1. **الترويسات تُطبَّق عالمياً على الملفات الثابتة أيضاً:** في `handle()` (server.js:388-391) تُضبط ترويسات `securityHeaders(nonce, secure, tracking)` **قبل** فرع الخدمة الثابتة (server.js:393-398)، أي أن استجابة `/media/offers/*.pdf` تحمل هي نفسها:
   - CSP `frame-ancestors 'none'` (http.js:133) — وهذا يتحكم بمن يُسمح له بضِمّ **المستند المُقفَّص نفسه**؛ 'none' يرفض حتى التضمين من نفس الأصل. المتصفحات الحديثة تفرضه على عارض PDF المدمج.
   - `x-frame-options: DENY` (http.js:141) — احتياطاً نفس المنع.
   - **النتيجة:** iframe داخل صفحتي سيُرفض رغم أن frame-src في صفحتي يسمح. الحل المقترح عندك: عند خدمة `/media/` (أو مسار كتالوج مخصص) أرسل `frame-ancestors 'self'` (والتخلي عن XFO DENY لهذه المسارات فقط) بدل ترويسات الصفحات العامة، دون مساس ببقية التوجيهات.
2. **MIME:** خريطة MIME في server.js:29-44 **بلا مدخلة `.pdf`** → أي PDF تحت /media/ يُخدم `application/octet-stream` مع `x-content-type-options: nosniff` (341,350) → المتصفح **ينزّل** الملف بدل عرضه داخل الإطار. أضف `'.pdf': 'application/pdf'`.

### 1.3 ما صممته ليكون جاهزاً قبل/بعد إصلاحك
- العارض المدمج يُعرض **فقط** لروابط نسبية بنفس الأصل (`isSameOriginPath`); للروابط الخارجية أُسقط الإطار وأكتفي بزر تحميل بـ`target=_blank rel=noopener` (لأن frame-src 'self' كان سيرفضهما معاً).
- زر «تحميل ملف البرنامج (PDF)» موجود دائماً في قسم الكتالوج وزر «تحميل الـPDF» في الشريط السفلي — حتى قبل إصلاحك يبقى التحميل يعمل ويكون العدم في العرض المدمج فقط.
- الإطار يحمَّل بكسولاً (data-src ينسخ إلى src عند أول فتح) لتخفيف الحمل.

## 2) قرارات تنفيذية (بأدلتها)

| القرار | السبب/الدليل |
|---|---|
| عدم تمرير البرنامج عبر `hydrateProgram` ثانية رغم صيغة التكليف `hydrateProgram(programBySlug(...))` | `programBySlug` يستدعي `hydrateProgram` داخلياً (domain.js:506-508)؛ التهيئة الثانية تمرر مصفوفات مفكوكة إلى `JSON.parse` فتفشل وتعود `[]` وتضيع hotels/itinerary. استخدمت الناتج مباشرة مع تعليق في رأس الملف. |
| `ASSET_V` استيراد من layout.js | تصدير فعلي (`export const ASSET_V` في layout.js:10) — يؤكد التحميل والبَصمة تتحدثان تلقائياً عند تعديل app.css (لاحظت القيمة اتغيرت في المحاكاة بعد الإلحاق). |
| أعمدة العرض الجديدة تُقرأ دفاعياً | poster_image/pdf_brochure_url/pricing_tiers_json/views_count ليست في SCHEMA بعد (db-map §1/§8) — تُقرأ بديل camelCase/snake_case وتفشل JSON بأمان إلى []، وتتبع views_count داخل try/catch كامل فيرسم الصفحة حتى قبل هجرة زميل db. |
| `p.pricingTiers` يدعم قديم `hotel|stars|room|price|notes` | `parseLine` محلي + قناة `pricing_tiers_json` JSON، كلاهما وفق المواصفة. |
| نص الموافقة المعتمد حرفياً | منسوخ من `consentField` في lib/views/forms.js:59 مع رابط /privacy. |
| التنويه السعري حرفياً | عبارة layout.js:127/footer: «الأسعار المنشورة «تبدأ من»...». |
| الحالات null | !p أو draft أو archived → null (404 عبر غلاف page). sold_out يظهر ببادج وبقاء الأزرار. |
| حل الرقم | الموظف users.phone → فرع settings.branches (02-7244112→96227244112) → settings.whatsapp؛ عرض محلي 0X وtel: محلي وwa.me دولي. تحقق المحاكاة أدناه. |
| بيانات النموذج | POST /api/public/offer-lead بالجسم {slug, ref, branch, tier, name, phone, email, notes, consent:true} وترويسة x-requested-with: fetch (متطلب حماية POST server.js:405-416). عند ok تستبدَل ببطاقة نجاح فيها المرجع وزر واتساب للمتابعة و/track?reference=. |
| تتبع الصفحة | UPDATE programs SET views_count+1 ثم INSERT tracking_events(event='offer_view', path='/p/:slug', meta={programId, ref, branch}) بـone/exec من lib/db.js وisoNow من util.js — كله داخل try/catch واحد لا يكسر العرض. |
| تتبع النقر | سكربت مضمّن واحد بـnonce: تفويض نقر على [data-lead] → fetch POST /api/track-event {event:'whatsapp_click', path, meta:{slug, tier}} fire-and-forget بلا preventDefault. |

## 3) تحقق فعلي (محاكاة module-load لا تشغيل سيرفر ولا اختبارات المشروع)

- `node --check lib/views/offer-micro.js` → **SYNTAX OK**.
- تجسيد بسيط بقاعدة وهمية تحقق من: مسار المستشار (الاسم، العرض المحلي 0790123456، wa.me/962790123456)، مسار الفرع فقط (فرع عمّان + 064600777/96264600777، إربد 027244112/96227244112)، الارتداد موظف بلا هاتف → هاتف فرعه، غياب ref/branch → لا شريط استشاري + الرقم العام، draft/archived → null، sold_out → بادج + SoldOut في JSON-LD + بقاء الأزرار، غياب الصور → بديل بألوان العلامة، غياب السعر → «السعر عند الطلب»، PDF خارجي → بلا iframe، بلا tiers → بطاقة واحدة بنص عام، بلا PDF → لا قسم كتالوج، فك tiers من JSON ومن السطر القديم وJSON تالف → []، سجلا التتبع (UPDATE/INSERT) بنص SQL وmeta الصحيح `{"programId":7,"ref":"1","branch":"irbid"}`.
- ملف محاكاة مؤقت استُخدم للحذف فوراً بعد الفحص (tmp-omp-smoke.mjs — لم يعد موجوداً).

## 4) مخاطر وما لا أعرفه (بأمانة)

- **lead-contract.md لم يُكتب بعد** (المجلد يضم db/web/admin/crm فقط) — التزمت بمواصفة التكليف حرفياً: استجابة متسامحة تقبل أي شكل `{ok, reference}`، وعند فشل الشبكة/النقطة تظهر حالة خطأ مع بقاء النموذج وزر واتساب بديل. إن جاء العقد بغير هذه الحقول يعدَّل استهلاك `data.reference` فقط.
- **/api/public/offer-lead غير موجود في server.js ولا POST_LIMITS بعد** (web-map §6) — إذا لن يطبَّق حد معدل عليها إلا بقرار زميل المسار؛ نمط جاهز: مثل /api/public/offers/:token/events (30/ساعة).
- **localizeHtml للإنجليزية** سيعالج صفحتي كما يعالج غيرها (استبدال dir/lang وترجمة ما يطابق الجدول) — لم أستثنِ شيئاً ولا أحتاج؛ النصوص الطويلة من القاعدة ستبقى عربية كسلوك صفحات البرامج المعلن في i18n.js:159-160.
- **قيمة users.phone الحالية في الإنتاج مجهولة** — القاعدة الفعلية فيها مستخدم واحد (admin فقط) وفق db-map §4؛ قواعد التطبيع مغطاة الأشكال الشائعة (0-leading 9-10 محارف، 962-leading، غياب الهاتف).
- لم أُشغّل السيرفر ولا قاعدة حقيقية (ممنوع) — سلوك CSS على متصفح حقيقي لم يُتحقق بصرياً؛ المتبقي استنتاج من قواعد الملف القائمة.

## 5) نقاط خارج نطاقي (اقتراحات فقط، لم ألمسها)

- إضافة `'.pdf': 'application/pdf'` وتعديل frame-ancestors للثابت (زميل http/server — انظر §1.2).
- حد معدل لـ/api/public/offer-lead وزمن POST_LIMITS (زميل server).
- إن أُضيف عمود poster_image للإدارة لاحقاً فRESOURCES.programs لا يدير image_url أصلاً (db-map §1 ملاحظة مصيرية) — تحتاج إضافته للحقول الإدارية.
