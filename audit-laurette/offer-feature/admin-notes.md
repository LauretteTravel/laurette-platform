# ملاحظات وكلاء لوحة الإدارة — مجموعة مبيعات واتساب (offer-feature)

> الوكيل المسؤول: وكيل admin.js — الملف المعدَّل حصراً: `public/assets/js/admin.js` (من 1284 سطراً إلى **1345** سطراً، +61).
> التعديلات موجهة وإضافية فقط؛ لم يُحذف شيء ولم يُعد تنسيق أي قسم آخر. تعديلات workspace-v2 غير الملتزمة في الملف (مثل حقول الإعدادات التسويقية metaPixelId/heroVideoUrl وغيرها في 1256–1307) لم تُمَس.
> الفحص بعد التعديل: `node --check public/assets/js/admin.js` → **SYNTAX OK** (الملف ليس hardlink — تحقق بـ `fsutil hardlink list` أعاد مساراً واحداً فقط).

---

## 1) ما أُضيف بالضبط (أرقام أسطر النسخة الجديدة)

### أ. مساعد النسخ `copyText(text)` — الأسطر 60–78
- جديد كلياً، يقع مباشرة بعد `toast()` (44–58 قبل التعديل) وقبل قسم login.
- `navigator.clipboard.writeText` في try؛ عند الفشل fallback تلقائي: `textarea` مؤقتة (readonly، position:fixed، opacity:0) + `select()` + `document.execCommand('copy')` داخل try منفصل، ثم إزالة العنصر.
- يعيد `true/false`. عند النجاح `toast('تم النسخ إلى الحافظة')`، وعند الإخفاق `toast('فشل النسخ إلى الحافظة', 'bad')`.
- النمط المرجعي المُقلَّد: `public/assets/js/workspace.js:76–79` (قراءة فقط، لم يُعدل).

### ب. الحقول الخمسة الجديدة في `PROGRAM_FIELDS` — المصفوفة الآن 601–631 (الإضافات 626–630)
| المفتاح المرسل (camelCase) | التسمية | النوع | ملاحظات |
|---|---|---|---|
| `department` | «الإدارة المسؤولة» | نص حر | hint: نص حر — مثال: قسم السياحة الخارجية |
| `imageUrl` | «صورة البرنامج (رابط)» | نص + `datalist: true` → `list="mediaList"` | بنفس أسلوب `imageUrl` في CONTENT.offers |
| `posterImage` | «بوستر المبيعات (رابط)» | نص + `datalist: true` → `list="mediaList"` | يُلحق به صف رفع في وضع التعديل |
| `pdfBrochureUrl` | «ملف البرنامج PDF (رابط)» | نص | يُلحق به صف رفع في وضع التعديل |
| `pricingTiers` | «جدول الفنادق والأسعار» | `type: 'list'` مثل hotels (rows: 6) | hint يوثّق الصيغة «اسم الفندق \| النجوم \| نوع الغرفة \| السعر \| ملاحظات» + placeholder داخل `fieldControl` |

- إرسال القيم يجري عبر حلقة `PROGRAM_FIELDS` الموجودة في submit دون تغيير: `pricingTiers` يخرج **مصفوفة أسطر** (`split('\n').map(trim).filter(Boolean)`) والبقية نصوص `trim()` — مطابق لعقد PATCH.
- دعم placeholder أُضيف لفرع `list` في `fieldControl` فقط (السطر 695): `${field.placeholder ? ` placeholder="${esc(field.placeholder)}"` : ''}` — لا يؤثر على أي حقل قائم (لا أحد منها يعرّف placeholder).

### ج. باني نص الرد الجاهز — `programLink(p)` 633–635 و`pitchText(p)` 637–652
- `programLink(p)` = `` `${location.origin}/p/${p.slug}?ref=${state.user?.id ?? ''}` `` (مع دفاع `?.`/`??` دون تغيير سلوكي).
- `pitchText(p)` يبني النص حرفياً بالشكل المعتمد مع `\n` حقيقية (join بـ `'\n'`):
  ```
  أهلاً بك في شركة لوريت للسياحة والسفر والحج والعمرة 🌴
  إليك تفاصيل برنامج *{title}* ({days} أيام):
  ✨ السعر يبدأ من: *{priceFrom} دينار أردني*
  📄 لتصفح جدول الفنادق والأسعار وتحميل ملف البرنامج الكامل (PDF) مباشرة دون عناء:
  {link}
  أنا معك لأي استفسار أو لتثبيت الحجز!
  ```
- يعمل على صف GET /api/admin/programs الخام بأعمدة snake_case (`days`, `nights`, `price_from`, `currency`, `slug`, `title`).

### د. زرا البيع في `renderPrograms` — الدالة الآن 654–687
- خلية الأزرار (السطر 670): للبرامج ذات `status === 'published' || 'sold_out'` فقط، بعد زرَّي تعديل/حذف الموجودين (كودهما لم يتغير بايتاً)، زران بنفس الحجم `btn btn-ghost btn-sm`:
  - «رد واتساب جاهز» بـ `data-wa-pitch="${p.id}"`
  - «نسخ الرابط» بـ `data-copy-link="${p.id}"`
- الربط بنفس أسلوب `$$('[data-...]').forEach` الموجود (الأسطر 679–686، بعد ربط الحذف مباشرة): يجد الصف من `items` (المتغير المُغلق نفسه الذي يستخدمه `data-edit-program` — لا حاجة لخريطة id→row إضافية)، ثم `copyText(pitchText(p))` للأول و`copyText(programLink(p))` للثاني.

### هـ. مساعدات القيمة الأولية والرفع — قبل `openProgramForm` (699–731)
- `PROGRAM_FIELD_SNAKE` (700): خريطة camelCase→snake_case للحقول الجديدة (`posterImage→poster_image`, `pdfBrochureUrl→pdf_brochure_url`, `imageUrl→image_url`, `pricingTiers→pricing_tiers_json`). السبب: `listResource` يعيد `SELECT *` خاماً وأسماء الأعمدة snake_case، بينما الحقول القائمة متعددة المقاطع (priceFrom وغيرها) عندها فجوة تعبئة أولية سابقة موجودة في الكود الأصلي — لم ألمسها (خارج النطاق).
- `fieldInitial(field, row)` (702–717): `row[f.key] ?? row[snake]`؛ ولـ `pricingTiers` فقط: إن كانت القيمة سلسلة JSON تبدأ بـ `[` يُجرّب `JSON.parse` دفاعياً، وتُحوَّل عناصر الكائنات إلى أسطر `hotel | stars | room | price | notes` (بحذف ملاحظات فارغة)، والسلاسل تمر كما هي. إذا فشل التحليل يعرض النص الخام (سلوك مطابق لأسلوب hotels القائم).
- `PROGRAM_UPLOADS` (719–722): `posterImage` → `{kind:'poster', accept:'image/jpeg,image/png,image/webp'}` و`pdfBrochureUrl` → `{kind:'brochure', accept:'application/pdf'}`.
- `programUploadRow(key)` (724–731): صف صغير داخل نفس خلية الحقل: `input[type=file]` بـ `data-upload-file="poster|brochure"` والقبول أعلاه + زر «رفع من الجهاز» (`type="button"`، `data-upload="poster|brochure"`، `data-upload-field="{key}"`) + وصف صغير: في صف البوستر «يدخل القسم بيانات الفنادق والأسعار أولًا، ثم يرفع المصمم البوستر وملف PDF من نفس البطاقة.»، وفي صف الـPDF تذكير بالضغط على «حفظ» لتثبيت الرابط.

### و. داخل `openProgramForm` — الدالة الآن 733–802
- السطر 741: القيمة الأولية صارت `fieldControl(f, fieldInitial(f, p))` بدل `p[f.key]` (للحقول الجديدة فقط فرقاً ملموساً؛ الحقول القائمة سلوكها كما كان لأن مفاتيحها غير موجودة في الخريطة).
- السطر 743: صف الرفع يُحقن داخل خلية الحقل بشرط `program && PROGRAM_UPLOADS[f.key]` — **وضع التعديل فقط** كما هو مطلوب.
- كتلة الرفع 772–795 (بعد مستمع submit الموجود، بشرط `program`): عند نقر `[data-upload]` — إن لم يُختر ملف: `toast('اختر ملفًا من الجهاز أولًا', 'warn')`؛ وإلا يُعطَّل الزر (`disabled = true`)، يقرأ الملف `FileReader.readAsDataURL` عبر Promise، يستخرج base64 بعد الفاصلة، يرسل عبر `api()` الموجود: `POST /api/admin/programs/${program.id}/upload-brochure` بجسم `{kind, filename: file.name, base64}`. عند النجاح: يُحدَّث الحقل النصي المقابل (`#ff-${key}`) بـ `r.url` و`toast('تم رفع الملف بنجاح (X ك.ب)')` بالحجم (size/1024 مقرّباً عبر `num`)، وعند الفشل `toast(e.message, 'bad')` (رسائل الأخطاء العربية 413/415/404 تأتي من الخادم عبر غلاف `api()` الموجود). إعادة تفعيل الزر في `finally`.
- كتلة datalist 796–801: نسخة طبق الأصل من نمط openContentForm للعروض — `GET /api/admin/media` ثم `datalist#mediaList` يُلحق بـ `#programForm`، مع `.catch(() => {})` (الموظف بلا صلاحية `content:write` لا يرى الاقتراحات فقط، ولا يتعطل شيء).

## 2) افتراضات موثقة (قرارات تقديرية داخل حدود المطلوب)
1. **سعر مفقود في pitchText**: إن كان `price_from` null/''/undefined يُحذف سطر السعر كلياً بدل إظهار `* دينار أردني*` فارغة. الشكل الحرفي محفوظ للحالة الطبيعية.
2. **تنسيق السعر**: استُخدم `num(p.price_from)` (فواصل آلاف بنمط en-US) التزاماً بأسلوب الملف في عرض الأسعار (خلية السعر في الجدول).
3. **المدة من الليالي**: إن غاب `days` ووُجد `nights` يُكتب `({nights} ليالٍ)` داخل نفس الأقواس؛ وإن غابا معاً تُحذف الأقواس نهائياً.
4. **العملة**: أي قيمة غير `'د.أ'` حرفياً تُستبدل بـ«دينار أردني» في السطر (مطابق للمطلوب).
5. **القيمة الأولية لـ pricingTiers**: عقد الخادم يحدد ما يستقبله PATCH (مصفوفة أسطر) ولا يحدد شكل ما يعيده GET؛ المعالجة الدفاعية تغطي: مصفوفة سلاسل/كائنات، سلسلة JSON، نصاً متعدد الأسطر، وnull — بلا أي افتراض مُلزم على زميل الخادم.
6. **حجم toast الرفع**: يعرض كيلوبايتات مقربة من `r.size`؛ العقد يضمن وجود `size` (إن غاب يظهر 0).
7. `copyText` تُظهر توست «تم النسخ إلى الحافظة» من نفسها؛ الزران لا يضيفان توستاً إضافياً (تجنب التوست المزدوج).

## 3) ما لا يزال معلقاً على زميل الخادم (خارج ملفي)
- `POST /api/admin/programs/:id/upload-brochure` (عقد: `{kind:'poster'|'brochure', filename, base64}` → `{ok:true, url, size}`، أخطاء 413/415/404 برسائل عربية) — الواجهة ترسل بهذا الشكل حرفياً.
- إدخال `department/posterImage/pdfBrochureUrl/imageUrl/pricingTiers` في `RESOURCES.programs.fields` (+ ترحيل الأعمدة الجديدة) — دون ذلك ستُستثنى الحقول بصمت في coerce (سلوك المشروع المعروف) ولن تُخزن، لكن الواجهة لن تنكسر.
- الرابط العام `/p/{slug}?ref=` وصفحته وقراءة `ref` — مسؤولية ملفات العرض العامة.
- ملاحظة عرض للمسؤول عن الوسائط: خريطة MIME في server.js لا تضم `.pdf` (سيُقدَّم الملف octet-stream = تنزيل لا معاينة) — مقصودة غالباً لتحميل «ملف البرنامج الكامل»، تُذكر هنا للتوثيق فقط.

## 4) الفحص
- `node --check public/assets/js/admin.js` → **SYNTAX OK** (السطر 1345).
- لم تُشغَّل أي أمر git ولا السيرفر ولا الاختبارات. لم يُلمس أي ملف آخر.
