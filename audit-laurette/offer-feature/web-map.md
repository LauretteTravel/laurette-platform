# خريطة طبقة الويب العامة — منصة لوريت (تحضير لصفحة العرض المستقلة /p/:slug)

**التاريخ:** 2026-11-14 · **النطاق:** طبقة الويب العامة فقط (server.js + lib/views + lib/i18n + lib/http + CSS العام + نقاط POST العامة + روابط wa.me) · **المنهجية:** قراءة وتحليل فقط، بلا أي تعديل أو تشغيل يكتب في المشروع. ملفات الجذر hardlinks (server.js) قُرئت عبر PowerShell `Get-Content` مع ترقيم الأسطر، والبقية عبر قارئ الملفات المعتاد. كل الأرقام أدناه من قراءة مباشرة للملفات الحالية (بما فيها التعديلات غير الملتزمة المذكورة في §8).

---

## 0) خلاصة تنفيذية

- التوجيه مركزي في `server.js` عبر `createRouter()` من lib/http.js، وكل الصفحات العامة تُسجَّل بغلاف واحد اسمه `page(fn)` (server.js:98-105) يطلب دالة العرض ويحول `null` إلى 404.
- **كلتا الوحدتين نشطتان**: public.js وpublic2.js مستوردتان معاً في server.js:15-16، والتوزيع بينهما حسب الصفحة. لا يوجد "بديل معطل" — public2.js هي الوحدة الأحدث لكن public.js تخدم الرئيسية والبرامج.
- HTML دائماً عربي RTL أولاً من `layout()` في lib/views/layout.js:161-231، والإنجليزية تُولَّد بمعالجة لاحقة `localizeHtml()` — **اللغة تُختار من بادئة المسار `/en` وليس من query ولا cookie**.
- لا يوجد أي مسار `/p/` ولا صفحة عرض مستقلة سابقة للعروض؛ `/offers` قائمة بوسترات مع نافذة `<dialog>`. **لكن يوجد عمل جاري غير ملتزم يضيف صفحة عرض عامة بطريقته: `/o/:token` في lib/workspace.js:139** (token-مبني، noindex، قشرة JS) — انظر §8.
- sticky bottom bar سابق موجود وجاهز للتقليد: `.mobile-cta` (app.css:1051-1075) يُمرَّر عبر خانة `mobileCta` في layout().
- أي CSS جديد يُضاف في نهاية public/assets/css/app.css — إضافة ملف CSS جديد لن يُخبِّئه تلقائياً ولا يُحمَّل لأن `ASSET_V` مبنية على قائمة ملفات ثابتة (layout.js:11).

---

## 1) server.js — التوجيه، الثوابت، البيئة، وقائمة المسارات العامة

### 1.1 نمط تسجيل المسارات واستدعاء معالجات العرض (اقتباس حرفي)

المسار يُبنى داخل `createApp()` (server.js:66) بعد إنشاء الراوتر (server.js:78) وتحميل مساحة العمل (79). الغلاف الموحد للصفحات:

```js
// server.js:91-96 — إرسال HTML مع الترجمة الإنجليزية اللاحقة
const sendHtml = (ctx, status, body, headers = {}) => html(
  ctx.res,
  status,
  ctx.lang === 'en' ? localizeHtml(body, { path: ctx.path, baseUrl, lang: 'en' }) : body,
  headers,
);

// server.js:98-105 — غلاف كل الصفحات العامة
const page = (fn, opts = {}) => (ctx) => {
  const body = fn(ctx, ctx.params?.slug);
  if (body === null) {
    const settings = getSettings(db);
    return sendHtml(ctx, 404, offlinePage({ settings, nonce: ctx.nonce, baseUrl }), { ...securityHeaders(ctx.nonce, ctx.secure, ctx.tracking) });
  }
  return sendHtml(ctx, 200, body, { ...securityHeaders(ctx.nonce, ctx.secure, ctx.tracking) });
};
```

التسجيل نفسه سطر لكل مسار، والمُعامل الثاني للدالة هو الـ slug عند وجود `:slug`:

```js
// server.js:107-112
router.get('/', page(homePage));
router.get('/programs/print', page(programsPrintPage));
router.get('/programs', page(programsPage));
router.get('/offers', page(offersPage));
router.get('/jordan', page(jordanPage));
router.get('/programs/:slug', page(programPage));
```

- **مما يعنيه ذلك لصفحة جديدة:** مسار جديد مثل `/p/:slug` يُضاف كسطر واحد `router.get('/p/:slug', page(offerPage));` في نفس المنطقة، والدالة تستقبل `(ctx, slug)` وتعيد **سلسلة HTML كاملة** (لا res) أو `null` ل404. تعريف `:param` في lib/http.js `compilePath` يحول `:slug` إلى `([^/]+)` ويملأ `ctx.params.slug` مع `decodeURIComponent` (lib/http.js:198-215).
- سياق الطلب `ctx` يُبنى في handle() (server.js:382-386) ويضم: `req, res, db, params, query, lang, path, user, token, clientUser, clientToken, nonce, baseUrl, secure, ip, settings, tracking`.

### 1.2 تحميل الملفات الثابتة

- يُخدم فقط ما تحت `/assets/` أو `/media/` لطلبات GET/HEAD (server.js:393-399) عبر `serveStatic` (server.js:313-357): يطبع المسار بـ `normalize` + `resolve` ويرفض الخروج من `PUBLIC_DIR` (server.js:314-316)، MIME من خريطة ثابتة (server.js:29-44)، دعم Range (326-344).
- سياسات التخزين (server.js:320-324): `woff2` سنة immutable؛ `html/js/css` بـ `no-cache`؛ البقية أسبوع. **لا يوجد أي مسار ثابت خارج /assets/ و/media/** — صور العروض تُخدم من `/media/offers/...` (api.js:1552) و generated art من `/art/:file` (server.js:232-243).
- `PUBLIC_DIR = join(HERE, 'public')` (server.js:26-27).

### 1.3 البيئة: PORT وDB_FILE وBASE_URL

```js
// server.js:66-68 — داخل createApp
const dbFile = options.dbFile || process.env.DB_FILE || join(HERE, 'data', 'laurette.db');
const baseUrl = (options.baseUrl || process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
```
```js
// server.js:527-530 — عند التشغيل المباشر (node server.js)
const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || (process.env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1');
const baseUrl = process.env.BASE_URL || process.env.RENDER_EXTERNAL_URL
  || (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : `http://${host}:${port}`);
```

### 1.4 قائمة كل مسارات GET العامة

صفحات عامة (كلها عبر `page(...)`، server.js:107-128):

| المسار | المعالج | الملف المعرّف |
|---|---|---|
| `/` | homePage | public.js:85 |
| `/programs/print` | programsPrintPage | public.js:831 |
| `/programs` | programsPage | public.js:374 |
| `/offers` | offersPage | public2.js:39 |
| `/jordan` | jordanPage | public2.js:106 |
| `/programs/:slug` | programPage | public.js:455 |
| `/umrah` | umrahPage | public.js:620 |
| `/flights` | flightsPage | public2.js:242 |
| `/hotels` | hotelsPage | public.js:760 |
| `/visa` | visaPage | public2.js:311 |
| `/consult` | consultPage | public2.js:390 |
| `/destinations` | destinationsPage | public2.js:442 |
| `/destinations/:slug` | destinationPage | public2.js:492 |
| `/guide` | guidePage | public2.js:558 |
| `/guide/:slug` | articlePage | public2.js:591 |
| `/faq` | faqPage | public2.js:637 |
| `/track` | trackPage | public2.js:675 |
| `/account` | customerAccountPage | account.js:31 |
| `/account/profile` | customerProfilePage | account.js:32 |
| `/about` | aboutPage | public2.js:704 |
| `/privacy` | privacyPage | public2.js:752 |
| `/news` | newsPage | public2.js:780 |

مسارات GET أخرى غير صفحات: `/admin` و`/admin/:rest*` (قشرة JS، server.js:131-136)، `/art/:file` (SVG مولّد، 232)، `/i18n/en.json` (245)، `/api/settings` (250 — إعدادات عامة فقط: brand/whatsapp/branches/email)، `/sitemap.xml` (259)، `/robots.txt` (284 — يمنع /admin و/track و/api/)، `/site.webmanifest` (289)، `/health` (308)، و`/api/programs` + `/api/programs/:slug` (190-191، JSON). من عمل workspace-v2 الجاري: `/workspace` و`/o/:token` (lib/workspace.js:138-139، انظر §8). 404 لأي شيء آخر = صفحة offlinePage (server.js:432-435).

دورة الطلب handle() (server.js:359-446): معالجة بادئة اللغة → توليد nonce ورؤوس أمان → ثوابت → تطبيع الشرطة المائلة (301) → فرع `/api/` → مطابقة GET → خطأ.

---

## 2) وحدات العرض العامة وهيكل HTML واللغات

### 2.1 أي وحدة مستوردة فعلاً؟ — **كلتاهما**

```js
// server.js:15-16
import { homePage, programsPage, programsPrintPage, programPage, umrahPage, hotelsPage, getSettings } from './lib/views/public.js';
import { flightsPage, visaPage, consultPage, destinationsPage, destinationPage, guidePage, articlePage, faqPage, trackPage, aboutPage, privacyPage, newsPage, offlinePage, offersPage, jordanPage } from './lib/views/public2.js';
// server.js:23-24
import { customerAccountPage, customerProfilePage } from './lib/views/account.js';
import { localizeHtml, dictionary } from './lib/i18n.js';
```

- **public.js تصدّر** (7): getSettings (:32)، homePage (:85)، programsPage (:374)، programPage (:455)، umrahPage (:620)، hotelsPage (:760)، programsPrintPage (:831).
- **public2.js تصدّر** (15): offersPage (:39)، jordanPage (:106)، flightsPage (:242)، visaPage (:311)، consultPage (:390)، destinationsPage (:442)، destinationPage (:492)، guidePage (:558)، articlePage (:591)، faqPage (:637)، trackPage (:675)، aboutPage (:704)، privacyPage (:752)، newsPage (:780)، offlinePage.
- كلا الملفين يعتمدان `layout()` من lib/views/layout.js، والدوال صفية (تنشئ نصاً وتعيد string) — لا async.

### 2.2 هيكل HTML (lib/views/layout.js:161-231)

توقيع الدالة (layout.js:161):

```js
export function layout({ settings, path, title, description, canonical, body, bodyClass = '', jsonLd = [], nonce = '', robots = 'index,follow', extraHead = '', offerData = null, mobileCta = '', ogImagePath = '' }) {
```

الهيكل الحرفي (مختصر من layout.js:170-231):

```html
<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#0B2A43">
<title>… | لوريت</title>
<meta name="description" …><meta name="robots" …>
<link rel="canonical" …> + hreflang ar/en/x-default
… og: و twitter: كاملة …
<link rel="preload" href="/assets/fonts/cairo-arabic.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/assets/fonts/cairo.css?v=1">
<link rel="stylesheet" href="/assets/css/app.css?v=${ASSET_V}">
<link rel="stylesheet" href="/assets/css/voucher.css?v=${ASSET_V}">
<link rel="icon" …><link rel="manifest" href="/site.webmanifest">
${extraHead}
${allLd}   ← JSON-LD (TravelAgency تُضاف تلقائياً إن لم توجد + ما تمرره في jsonLd)
${trackingHead(settings, nonce)}
</head>
<body class="${bodyClass}">
${header(settings, path)}<main id="main">${body}</main>${footer(settings)}
${mobileCta}${floating(settings)}${soundToggle()}${whatsappModal(settings)}${offerDialog(offerData)}
<div class="toast-stack" …></div>
<script src="/assets/js/app.js?v=${ASSET_V}" nonce="${nonce}" defer></script>
<script src="/assets/js/voucher-generator.js?v=${ASSET_V}" nonce="${nonce}" defer></script>
</body></html>
```

- `ASSET_V` (layout.js:11) بصمة mtime بترميز base36 **لقائمة ملفات ثابتة** (app.css وapp.js وadmin.js وaccount.js وphone-codes.json وvoucher* فقط). أي تعديل على app.css يغير ASSET_V تلقائياً لكل الموقع؛ **ملف CSS جديد لا يدخل القائمة فلن يُخبَّئ ولا يُحمل** إلا بتمريره عبر `extraHead` (بدون cache-bust تلقائي) أو بإضافته إلى تعبير ASSET_V.
- Scripts تحتاج `nonce` (CSP في lib/http.js securityHeaders: `script-src 'self' 'nonce-…'`، و`style-src 'self' 'unsafe-inline'` فيسمح بالأنماط المضمنة، و`img-src 'self' data: https:`).

### 2.3 آلية تعدد اللغات (lib/i18n.js) — **بادئة المسار، لا query ولا cookie**

- الاختيار في server.js:364-371: `pathname === '/en' || pathname.startsWith('/en/')` → `lang='en'` وتُقص البادئة؛ `/ar…` يعاد توجيهه 301 إلى المسار المجرد. العربية هي الافتراضي بلا بادئة. لا يوجد أي استخدام لكوكي أو `?lang=`.
- القوالب العربية فقط تُرسم على الخادم؛ الإنجليزية **معالجة لاحقة** عبر `localizeHtml(body, {path, baseUrl, lang:'en'})` (server.js:94) التي:
  - تستبدل `<html lang="ar" dir="rtl">` بـ `<html lang="en" dir="ltr">` (i18n.js:146).
  - تترجم العقد النصية والسمات (placeholder/aria-label/title/alt/data-wa-text) من جدول عبارات lib/i18n-en.json مع قواعد أنماط للنصوص المركّبة (i18n.js:13-104، translateString/patternTranslate).
  - تعيد كتابة الروابط الداخلية ببادئة `/en` عبر `localizeHref` (i18n.js:112-117) باستثناء `NON_LOCAL_PREFIXES = ['/api/', '/assets/', '/media/', '/art/', '/admin', '/health', '/sitemap', '/robots', '/site.webmanifest']` (i18n.js:25).
  - تحقن ملاحظة "المحتوى العربي" en-content-note **فقط** لمسارات محددة (i18n.js:161-164: `/programs/:slug`، offers، news، guide، destinations، visa، hotels، jordan، umrah) — صفحة `/p/…` الجديدة **لن** تحصل على هذه الملاحظة تلقائياً ولا تُستثنى من الترجمة.
  - تحقن سكربت `/assets/js/i18n-client.js` لسلاسل الواجهة في المتصفح (i18n.js:~216-219) وتبدل زر اللغة.
- JSON للـ API يُعرَّب بالإنجليزية عبر `t()` (i18n.js:250) داخل `localizePayload` في lib/http.js:71-87 عندما `res.lang === 'en'`.
- **أثرها على صفحة جديدة:** اكتب العربية في القالب مباشرة؛ سيعمل `/en/p/…` تلقائياً بترجمة ما يطابق الجدول، وستُسبق روابطها بـ `/en`. النصوص الطويلة من القاعدة (عنوان/ملخص العرض) ستبقى عربية كما في صفحات البرامج (سلوك مقصود موثق في تعليق i18n.js:159-160).

---

## 3) صفحة البرنامج الحالية /programs/:slug — النموذج المرجعي للتقليد

### 3.1 الدالة وموقعها

`programPage(ctx, slug)` في **lib/views/public.js:455-618**. تبدأ:

```js
// lib/views/public.js:455-467 (مقتطف)
export function programPage(ctx, slug) {
  const { db, settings } = ctx;
  const p = programBySlug(db, slug);
  if (!p || p.status === 'archived') return null;   // ← null = 404 offlinePage
  const related = q(db, `SELECT * FROM programs WHERE category = ? AND slug <> ? AND status IN ('published','sold_out') ORDER BY featured DESC, price_from ASC LIMIT 3`, [p.category, p.slug]).map(hydrateProgram);
  ...
  const waText = `السلام عليكم، أود الاستفسار عن برنامج: ${p.title}\n…`;
  const waHref = `https://wa.me/${String(settings.whatsapp).replace(/\D/g, '')}?text=${encodeURIComponent(waText)}`;
```

### 3.2 قراءة البرنامج من القاعدة

- `programBySlug(db, slug)` في **lib/domain.js:506-508**: `SELECT * FROM programs WHERE slug = ?` ثم `hydrateProgram`.
- `hydrateProgram` (lib/domain.js:488-504): يفك أعمدة JSON — `hotels, itinerary, includes, excludes, terms, flights, options, badges` — إلى مصفوفات (فشل JSON ⇒ `[]`).
- جدول `programs` (lib/db.js، أعمدة مستخدمة في العرض): title، slug، summary، category (umrah/cruise/sharm/istanbul)، days/nights، price_from، currency، status (`published`/`sold_out`/`archived` — انظر STATUSES في public.js:8 وخدمة sitemap server.js:261)، destination، mode، route، level، airline، meals، departure_dates، image_url، art_key، featured.
- حالة `sold_out` تُعرض للعميل بشارة "نفدت المقاعد" مع إبقاء الطلب متاحاً (public.js:489 و506).

### 3.3 بنية الصفحة (للتقليد في /p/:slug)

1. `page-head` (public.js:468-482): breadcrumbs([{الرئيسية},{البرامج السياحية},{العنوان}]) + h1 + ملخص + شارات (المدة/الوجهة/نفدت).
2. `section-tight` > `wrap` > `split` (شبكة عمودين: محتوى 1.55fr + جانب 1fr، app.css:364):
   - **عمود المحتوى** `stack`: `.gallery` (3 صور) → `panel` تفاصيل البرنامج (`fact-list` بالمدة/نوع/مسار/مستوى/طيران/وجبات/مواعيد/الحالة) → `panel` الإقامة (جدول فنادق) → `panel` خط السير (`timeline` يوم بيوم) → `panel` جدول الرحلات → `split-even grid` المشمول/غير المشمول → `panel` شروط الحجز (accordion details) → **`panel id="request"`** (public.js:540-543) بنموذج `programRequestForm(p, isUmrah ? 'umrah' : 'program')`.
   - **العمود الجانبي** `aside class="stack sticky-side"` (public.js:547، sticky عبر app.css:366): بطاقة السعر المنشور (`priceLabel` = «يبدأ من» + money) + جدول خيارات الغرف + تنويه "السعر المعتمد هو الصادر في العرض الرسمي" + زران: `اطلب عرض سعر` (anchor #request) و`استفسر عبر واتساب` (`data-wa data-wa-text=…`) → بطاقة مساعدة (tel ثابت +962791193888 + زر مساعد `data-open-chat`).
3. برامج مشابهة: `sectionHead` + `grid grid-3` من `programCard`.
4. الخاتمة `layout({…, bodyClass: 'has-mobile-cta', mobileCta: …, jsonLd: [Product + Offer (price_from/availability InStock|SoldOut), BreadcrumbList]})` (public.js:580-618). الـ mobileCta حرفياً (public.js:585-590): شريط سفلي فيه السعر + `اطلب عرض سعر` (#request) + زر واتساب `data-wa` + زر اتصال.

### 3.4 نموذج الطلب المرتبط

`programRequestForm` (lib/views/forms.js:240-283): `<form class="request-form" data-request-type="program|umrah" novalidate>` مع حقن مخفي `programSlug` و`optionLabel` (أرخص خيار)، خطوة 1 (الخيار/التاريخ/عدد المسافرين paxFields) وخطوة 2 (الاسم/الهاتف dir=ltr placeholder 0791234567/البريد/ملاحظات/`consentField()`/`whatsappUpdatesField()`/`submitBar`). الإرسال من app.js:183-215: `fetch('/api/requests', {method:'POST', headers:{'content-type':'application/json','x-requested-with':'fetch'}, body: JSON.stringify(data)})` ثم يستبدل النموذج ببطاقة نتيجة فيها الرقم المرجعي وزر "متابعة الطلب" وزر واتساب (app.js:167-181).

---

## 4) بناء روابط wa.me اليوم

**القاعدة الموحدة في كل المشروع:** `https://wa.me/` + الرقم الدولي بدون `+` أو أي غير رقمي (`String(x).replace(/\D/g,'')`) + `?text=` + `encodeURIComponent(نص عربي)`.

1. **المساعد الموحد** lib/views/layout.js:55-58 (اقتباس حرفي):
```js
export const WA = (settings, text = 'السلام عليكم، أرغب بالاستفسار عن خدمات لوريت') => {
  const num = String(settings?.whatsapp || '').replace(/\D/g, '');
  return `https://wa.me/${num}?text=${encodeURIComponent(text)}`;
};
```
2. **صفحة البرنامج** public.js:465-466: نص مخصص باسم البرنامج والمدة والسعر ثم نفس الصيغة؛ الزر في Aside لا يفتح wa.me مباشرة بل `data-wa data-wa-text="…"` (public.js:556) — راجع 4.3.
3. **أزرار التتبع بعد الطلب** lib/api.js:180-182 (اقتباس حرفي):
```js
whatsapp: ctx.settings.whatsapp
  ? `https://wa.me/${String(ctx.settings.whatsapp).replace(/\D/g, '')}?text=${encodeURIComponent(`السلام عليكم، لدي طلب رقم ${result.reference} وأرغب بمتابعته.`)}`
  : null,
```
4. أماكن أخرى بنفس الصيغة: public2.js:273 (الطيران)، assistant.js:62 (رد المساعد)، whatsapp.js:66 (trackUrl للرسائل الصادرة — ليس wa.me).

### 4.2 مصدر الأرقام

- `settings.whatsapp`: مفتاح في جدول settings يُقرأ JSON عبر `getSettings` (public.js:32-61؛ server.js:250-256 يعرضه في /api/settings العامة). القيمة الحالية **962791193888** (data/seed.json:6؛ ومطابقة للقاعدة وفق frontend-findings.json:15).
- `settings.contactGroups`: مصفوفة مجموعات `{ g: 'اسم المجموعة', items: [{ p: 'رقم دولي', n: 'تسمية' }] }` تُقرأ في نافذة واتساب layout.js:321-353: كل رقم يصير رابطاً `https://wa.me/${digits}` مع عرض محلي `0…` إذا بدأ بـ 962 (layout.js:328-335).
- `settings.branches[].phone` لأرقام الأرضية `tel:` (layout.js:347).

### 4.3 سلوك المتصفح (app.js)

- أي عنصر `[data-wa]` يفتح نافذة اختيار الفرع `openWa(text)` (app.js:568-594): يكتب نص المستخدم في `href` كل `[data-wa-number]`: `` a.href = `https://wa.me/${a.dataset.waNumber}?text=${encodeURIComponent(message)}` `` (app.js:572-573)، مع تتبع حدث `loret:whatsapp` (app.js:598-599). إن أردت رابط واتساب مباشراً بلا نافذة: استخدم وسم `<a href="${WA(settings, text)}" target="_blank" rel="noopener noreferrer">`.

---

## 5) حدود المعدل (lib/http.js + server.js)

### 5.1 الآلية

`RateLimiter` في **lib/http.js:237-257**: عدّاد في الذاكرة (Map) بمفتاح نصي، نافذة زمنية بالمللي ثانية، يعيد `{allowed, remaining, retryAfter}`. يُنشأ مرة واحدة لكل تطبيق (server.js:77 `const limiter = new RateLimiter();`) — إعادة تشغيل تصفّره، ولا يُشارك بين نُسخ متعددة.

### 5.2 التطبيق على المسارات العامة — مثال حرفي

الجداول (server.js:139-151):

```js
const POST_LIMITS = {
  '/api/requests': { max: 20, window: 3600_000 },
  '/api/track': { max: 30, window: 3600_000 },
  '/api/assistant': { max: 80, window: 3600_000 },
  '/api/recommend': { max: 60, window: 3600_000 },
  '/api/auth/login': { max: 12, window: 600_000 },
  '/api/track-event': { max: 300, window: 3600_000 },
  [WHATSAPP_BRIDGE_PATH]: { max: 60, window: 60_000 },
  '/api/client/auth/register': { max: 8, window: 3600_000 },
  '/api/client/auth/verify': { max: 10, window: 600_000 },
  '/api/client/auth/resend': { max: 5, window: 3600_000 },
  '/api/client/auth/login': { max: 12, window: 600_000 },
};
```

الغلاف (server.js:153-167، اقتباس الجزء ذي الصلة):

```js
const api = (handler, { auth = false, action = null, limit = null } = {}) => async (ctx) => {
  if (limit) {
    const rule = POST_LIMITS[limit];
    if (rule) {
      const hit = limiter.hit(`${limit}|${ctx.ip}`, rule.max, rule.window);
      if (!hit.allowed) {
        ctx.res.setHeader('retry-after', String(hit.retryAfter));
        return json(ctx.res, 429, { ok: false, message: 'عدد المحاولات كبير. حاول لاحقًا.' });
      }
    }
  }
  ...
```

الاستدعاء: `router.post('/api/requests', api(API.createRequestApi, { limit: '/api/requests' }));` (server.js:187).

### 5.3 ملاحظات مهمة

- **حدود المعدل على POST فقط؛ صفحات GET العامة بلا أي حد.**
- حماية منع العبور للـ POST تحت /api/ (server.js:405-416): تطلب `x-requested-with: fetch` أو أصلاً بنفس المضيف — لذا أي fetch جديد يجب أن يرسل الترويسة نفسها (كما يفعل app.js:201).
- عمل workspace-v2 الجاري يضيف حداً خاصاً منفصلاً لنقطة الأحداث العامة `/api/public/offers/:token/events`: 30 طلب/ساعة لكل `offerId|ip` في Map مستقلة (workspace.js:316-321) — نموذج إضافي جيد للنسخ إذا احتاجت /p/:slug نقطة تتبع عامة.

---

## 6) نقاط POST العامة (طلب عرض سعر)

### 6.1 POST /api/requests — نقطة العروض الأساسية

- **التسجيل:** server.js:187 → `API.createRequestApi` (lib/api.js:162-184).
- **المدخلات:** JSON بحجم ≤64KB عبر `readJson` (http.js:188-202؛ 415 إن لم يكن application/json، 400 إن كان تالفاً). `validateRequest` في lib/domain.js:92-166 تتحقق لكل نوع (الاسم، الهاتف `/^\+?[0-9]{8,15}$/` domain.js:64، consent إلزامي domain.js:115، حقول كل نوع flight/hotel/visa/consult…) وترجع `{ok:false, errors}` → 422.
- **التكرار:** `findRecentDuplicate` (domain.js:285-292) — نفس الهاتف+hash خلال 15 دقيقة يعيد المرجع نفسه مع `duplicate:true` و200 بدل 201 (api.js:183).
- **توليد الرقم المرجعي** — lib/util.js:94-100 (اقتباس حرفي):
```js
export function reference(type) {
  const prefix = { flight: 'FL', hotel: 'HT', program: 'PG', umrah: 'UM', visa: 'VS', consult: 'CS', cruise: 'CR' }[type] || 'RQ';
  const buf = new Uint8Array(4);
  crypto.getRandomValues(buf);
  const body = [...buf].map((b) => b.toString(36).toUpperCase().padStart(2, '0')).join('').slice(0, 6);
  return `LT-${prefix}-${body}`;
}
```
البادئات معرّفة أيضاً في `REQUEST_TYPES` (domain.js:4-11). الإدخال يجرَّب حتى 4 مرات عند تعارض UNIQUE (domain.js:367-393). التحقق من الشكل: `referenceValid` `/^LT-(FL|HT|PG|UM|VS|CS)-[A-Z0-9]{6}$/` (util.js:102-104). لاحظ أن regex لا يشمل `CR` رغم وجود النوع.
- **شكل الاستجابة** — lib/api.js:172-183 (اقتباس حرفي):
```js
return ok(res, {
  reference: result.reference,
  summary: result.summary || '',
  duplicate: !!result.duplicate,
  value: result.value || 0,
  type,
  typeLabel: REQUEST_TYPES[type].label,
  trackUrl: `/track?reference=${encodeURIComponent(result.reference)}`,
  whatsapp: ctx.settings.whatsapp ? `https://wa.me/…` : null,
}, result.duplicate ? 200 : 201);
```
- **حد المعدل:** 20 طلب/ساعة لكل IP (server.js:140). **أحداث التتبع:** بعد النجاح يرسل app.js حدث `loret:lead` (app.js:210-213) وقبل الإرسال `enqueueWhatsAppNotice` (api.js:169-171).

### 6.2 POST عامة أخرى ذات صلة

- `POST /api/track` (server.js:189 → api.js:239-253): reference + phone → حالة الطلب العامة (`publicStatus` domain.js:411+)؛ حد 30/ساعة.
- `POST /api/track-event` (server.js:194، api.js:561+): أحداث lead/whatsapp_click/page_view/cta_click، حد 300/ساعة.
- `POST /api/recommend` و`/api/assistant` (192-193): محرك الاقتراحات والمساعد.
- `POST /api/whatsapp/webhook` و`/api/save-chat` (184-186): قنوات، ليست واجهة موقع.
- المصادقة (169-178) و`/api/admin/…` وworkspace (محمية).
- **من العمل الجاري:** `POST /api/public/offers/:token/events` (workspace.js:316) — تتبع فتح/اهتمام/تعديل/طلب حجز لعرض CRM مشترك؛ عام بالتوكن.

---

## 7) بنية CSS وRTL والجوال

### 7.1 الملفات المحملة لصفحات الموقع العام

- `public/assets/fonts/cairo.css?v=1` + `public/assets/css/app.css?v=${ASSET_V}` + `public/assets/css/voucher.css?v=${ASSET_V}` (layout.js:209-211). لا يوجد ملف CSS لكل صفحة — كل الموقع العام في **app.css (1205 سطراً)**.
- ملفات أخرى موجودة لكنها لمناطق أخرى: `workspace.css` (العمل الجاري لصفحة /workspace)، `voucher-studio.css` (لوحة الإدارة)، خطوط. **لا تحملها صفحة عامة جديدة إلا يدوياً.**

### 7.2 نظام التصميم (أول 60 سطراً من app.css)

ترويسة الملف (app.css:1-5): "لوريت — design system — RTL first, logical properties so an LTR locale works without a rewrite. Brand: deep navy #0B2A43 · travel blue #17638F · gold #D9A34A".

- متغيرات (app.css:8-34): الألوان أعلاه + `--gold-2 #E8B96A`، `--sand #F7F4EE`، `--ok/--warn/--danger/--violet`، `--radius 18px`، `--radius-lg 26px`، ظلال، `--wrap 1180px`، `--header-h 68px`، خط Cairo.
- عناصر أساسية: `.wrap` حاوية 1180px (70)، `.skip-link` (72)، `.site-header` sticky (79-86)، أقسام بفواصل `/* ===== */`.

خريطة أقسام app.css (بأسطر): أساس ومتغيرات 1-64 → header 78 → split layouts + `.sticky-side` 363-366 → floating actions 420 → chat 432 → admin 487 → **responsive 548-627** → toasts 629 → عروض بالبوسترات + نافذة واتساب + معاينة العرض 656-779 → hero/الرئيسية 781-866 → CRM 868 → دليل الأردن 1002 → **MOBILE STICKY CTA 1051-1075** → trust/jordan 1077 → logo 1134 → كتالوج الطباعة 1149-نهاية.

### 7.3 RTL

- المنهج: **خصائص منطقية** في كل المكان (`inset-inline`, `margin-inline`, `padding-inline-start`, `border-block-end`) فلا حاجة لانعكاس يدوي، مع قسم تجاوزات صغير `html[dir="ltr"]` قرب النهاية (نحو app.css:1105-1127) للإنجليزية.
- الاتجاه يأتي من `<html dir="rtl">` في layout() ويستبدله localizeHtml إلى `ltr` للإنجليزية (i18n.js:146).

### 7.4 نقاط توقف الموبايل

- الرئيسية: `min-width:1241` (nav مضغوط) / `max-width:1240` (قائمة برغر) / `1100` / `980` / **`860`** (تحول العمودين إلى عمود؛ `.sticky-side { position: static; }` app.css:587؛ ظهور mobile-cta) / `760` / **`620`** (عمود واحد كامل؛ `wrap` بهامش 28px) / `520` / `420` / `380`.
- لصفحة جديدة: صمّم بعمودين ≥861px وعمود واحد ≤860px، مع دعم `prefers-reduced-motion` (app.css:620) وprint (624).

### 7.5 sticky bottom bar السابق — جاهز لإعادة الاستخدام

`/* ===================== MOBILE STICKY CTA ===================== */` (app.css:1051-1075):

```css
.mobile-cta { display: none; }
@media (max-width: 860px) {
  .mobile-cta {
    position: fixed; inset-inline: 0; bottom: 0; z-index: 70;
    display: flex; align-items: center; gap: 8px;
    padding: 10px 12px calc(10px + env(safe-area-inset-bottom));
    background: rgba(255, 255, 255, .97); backdrop-filter: blur(10px);
    border-top: 1px solid var(--line); box-shadow: 0 -10px 30px rgba(11, 42, 67, .12);
  }
  .mobile-cta-price { … margin-inline-end: auto; … }
  .has-mobile-cta { padding-bottom: 78px; }
  .has-mobile-cta .float-actions { bottom: 88px; }
  .has-mobile-cta .fab-wa { display: none; }
  .has-mobile-cta .chat-panel { bottom: 88px; }
}
@media (max-width: 380px) { .mobile-cta .btn { padding-inline: 9px; font-size: 12.5px; } … }
```

يُفعَّل بتمرير `mobileCta` إلى layout() + `bodyClass: 'has-mobile-cta'` (public.js:584-590) — أنماته تُخفي fab-wa وتدفع العناصر العائمة فوقه تلقائياً.

### 7.6 أين يُضاف CSS جديد

أضف قسماً جديداً **في نهاية public/assets/css/app.css** بعنوان بانر `/* ===== ... ===== */` وفق تقليد الملف — لأنه الملف الوحيد الذي يُحمل دائماً ويتغير `ASSET_V` تلقائياً عند تعديله. ملف CSS منفصل جديد يتطلب تعديل `ASSET_V` في layout.js:11 أو حقنه عبر `extraHead` بدون cache-bust (غير منصوح). زّد أسماء أصناف جديدة متمايزة (كما فُعل بـ `.mobile-cta` و`.poster-grid` و`.client-*`) لتجنب التعارض.

---

## 8) /p/ وصفحات العرض المستقلة — التأكيد وأثر العمل الجاري

- **لا يوجد مسار `/p/` إطلاقاً:** بحث نمطي `['"`]/p/` على كل الشجرة = صفر نتائج؛ وقائمة مسارات server.js (§1.4) لا تتضمنه؛ ولا يوجد `offerPage` أو `/offers/:slug` في أي مكان (روابط العروض كلها نحو `/offers` أو نافذة dialog).
- **لا صفحة عرض مستقلة سابقة:** `/offers` (public2.js:39-105) قائمة بوسترات تفتح `<dialog>` (offerDialog في layout.js:355-375؛ الفتح عبر `data-offer-open` app.js:643-646) — لا صفحات مفردة للعروض ولا canonical لكل عرض.
- **أثر عمل جاري (تعديلات غير ملتزمة — workspace-v2):** `git status` يظهر ملفات معدلة: `server.js`، `lib/views/public.js`، `lib/api.js`، `lib/db.js`، `public/assets/js/app.js`، `public/assets/js/account.js`، `render.yaml`، `docs/API.md`، وأخرى غير متتبعة: `lib/workspace.js`، `lib/workspace-db.js`، `lib/whatsapp-bridge.js`، `lib/whatsapp-chat-analytics.js`، `lib/sanitize-text-forai.js` (sanitize-text-for-ai.js)، `public/assets/css/workspace.css`، `public/assets/js/workspace.js`، `whatsapp-openwa/`، `tools/`، `docs/audit/`…
  - **الأهم:** داخل lib/workspace.js (غير ملتزم) مسار صفحة عامة لعرض CRM مشترك:
    ```js
    // lib/workspace.js:139-144
    router.get('/o/:token', (c) => {
      const o = one(db, 'SELECT token FROM workspace_offers WHERE token=? AND active=1',[c.params.token]);
      if (!o) throw new HttpError(404,'العرض غير متاح');
      html(c.res,200,shell(true),{...securityHeaders(c.nonce,c.secure),'cache-control':'no-store','referrer-policy':'no-referrer','x-robots-tag':'noindex, nofollow'});
    });
    ```
    بيانات العرض تُجلب من `/api/public/offers/:token` (workspace.js:310-315) كـ JSON (reference + content + sellingPrice + currency + اسم وهاتف المستشار + fallback من settings.whatsapp)، والأحداث عبر `/api/public/offers/:token/events` (316+). هذه صفحة **token-مبنية noindex بقشرة JS لمساحة العمل** — ليست `/p/:slug` ولا صفحة SEO مستقلة، لكنها أقرب سابقة مفاهيمية موجودة في الشجرة، وقاعدة `workspace_offers` منفصلة عن جدول العروض العام `offers`.
  - الفرق الجوهري لصفحة /p/:slug المقترحة: ستكون صفحة HTML مرسومة من الخادم قابلة للفهرسة تعتمد بيانات عامة (programs/offers)، بينما /o/:token خاصة بعميل محدد عبر توكن.

---

## 9) حقائق تعاقدية/محتوى يلتزم بها تصميم صفحة العرض (مصادر)

1. **الأسعار "تبدأ من"** ولا تُعرض نهائية: `priceLabel` (layout.js:248-251) + عبارة التذييل الثابتة: "الأسعار المنشورة «تبدأ من» وتتغير حسب الموسم والتوافر، والسعر المعتمد هو الصادر في عرض رسمي." (layout.js:127، footer-bottom) + نفس التنويه داخل offerDialog (layout.js:373) وaside البرنامج (public.js:553).
2. **الطلب ليس حجزاً مؤكداً**: "هذا طلب عرض سعر وليس حجزًا مؤكدًا" (public.js:542، app.js:180).
3. **sold_out** يظهر بشارة "نفدت المقاعد" مع إتاحة طلب بديل (public.js:476، 506؛ schema.org SoldOut في JSON-LD).
4. **الموافقة consent إلزامية** قبل إرسال أي طلب (forms.js:57-65، domain.js:115، app.js:141) + حقل اختياري لتحديثات واتساب يظهر فقط إذا كان جسر واتساب جاهزاً (forms.js:47-56).
5. العملة افتراضياً د.أ من settings.currency (public.js:36؛ money في util.js:19-24 تعرض "حسب الطلب" إن لم يوجد سعر).

---

## 10) حدود هذا الفحص (محقق/استنباطي/مجهول)

- **محقق من قراءة مباشرة:** كل الاقتباسات وأرقام الأسطر أعلاه من الملفات الحالية على القرص (بما فيها غير الملتزم).
- **استنباطي:** قيمة settings.whatsapp الحالية في قاعدة الإنتاج (مطابقة seed.json:6 وفق فحص سابق audit-laurette/frontend-findings.json:15 — لم أستعلم القاعدة في هذا الفحص لعدم الحاجة).
- **مجهول/لم يُفحص:** سلوك التشغيل الحي (لم يُشغَّل الخادم)، تفاصيل getProgramApi الكاملة (api.js:255+ — أُثبت وجود المسار فقط)، ومصير دمج عمل workspace-v2 القادم (قد يغير server.js وpublic.js).
- خارج النطاق (اقتراح فقط): فحص wt-os/ وwhatsapp-openwa/ وlegacy/ — ليست جزءاً من طبقة الويب العامة (لا يستوردها server.js).
