import fs from 'node:fs';

const read = (p) => fs.readFileSync(p, 'utf8');
const slice = (text, startMarker, endMarker) => {
  const a = text.indexOf(startMarker);
  if (a < 0) throw new Error(`start not found: ${startMarker.slice(0, 30)}`);
  const b = endMarker ? text.indexOf(endMarker, a + startMarker.length) : -1;
  return text.slice(a, b > a ? b : undefined).trimEnd();
};

const home = read('lib/views/public.js');
const css = read('public/assets/css/app.css');
const js = read('public/assets/js/app.js');

const heroHtml = slice(home, '  <section class="hero">', '  <div class="wrap hero-search-wrap">');
const heroCss = slice(css, '/* ==========================================================================\n   الواجهة الرئيسية: فيديو خلفي');
const soundJs = slice(js, '  /* ---------------- UI sounds', '  /* ---------------- misc ----------------');

const doc = `# الواجهة الرئيسية: فيديو + أشكال متحركة + مؤثرات صوتية

هذا الملف يجمع الكود الكامل الذي أُضيف إلى المنصة، مع تحديد مكان تغيير رابط الفيديو ومصادر الصور.

## 1) أين أضع رابط الفيديو؟

ثلاث طرق، بالترتيب الموصى به:

1. **من لوحة الإدارة** (بدون كود): \`/admin\` ← «الإعدادات» ← «رابط فيديو الواجهة (MP4)».
   الحقل يُحفظ في جدول \`settings\` تحت المفتاح \`heroVideoUrl\`، وصورة الغلاف تحت \`heroPosterUrl\`.
2. **عبر API**:
   \`\`\`bash
   curl -X PATCH /api/admin/settings -b cookies.txt \\
     -H "content-type: application/json" -H "x-requested-with: fetch" \\
     -d '{"heroVideoUrl":"/media/hero/hero-loop.mp4","heroPosterUrl":"/media/hero/hero-poster.jpg"}'
   \`\`\`
3. **في الكود** (القيمة الافتراضية عند الزرع): \`tools/build-seed.mjs\` ← مفتاح \`settings.heroVideoUrl\` و\`settings.heroPosterUrl\`.
   لرفع ملف جديد ضعه في \`public/media/hero/\` (يفضَّل MP4 H.264 بدون صوت، 720p، أقل من 3MB) ثم أشر إليه بالمسار.

> الصوت لا يحتاج ملفات: المؤثرات مُولَّدة لحظيًا عبر Web Audio API، ويمكن تعديل تردداتها من \`SoundKit\` في \`app.js\`.

## 2) كود HTML للواجهة

\`\`\`html
${heroHtml}
\`\`\`

> \`data-src\` و\`data-poster\` مقصودان: لا يبدأ المتصفح تنزيل الفيديو حتى تصله إشارة من الجافاسكربت (Lazy)، والصورة تظهر أولًا.
> عند ترك \`heroVideoUrl\` فارغًا لا يُطبع وسم الفيديو إطلاقًا وتبقى الصورة.

## 3) كود CSS الكامل

\`\`\`css
${heroCss}
\`\`\`

## 4) كود JavaScript الكامل (الصوت + زر الكتم + تحميل الفيديو الكسول)

\`\`\`js
${soundJs}
\`\`\`

## 5) إعدادات اللوحة المرتبطة

في \`public/assets/js/admin.js\` أُضيف حقلان إلى نموذج الإعدادات:

\`\`\`html
<div class="field"><label>رابط فيديو الواجهة (MP4)</label>
  <input data-key="heroVideoUrl" dir="ltr" placeholder="/media/hero/hero-loop.mp4">
  <span class="field-hint">اتركه فارغًا لإيقاف الفيديو واستخدام الصورة فقط.</span></div>
<div class="field"><label>صورة غلاف الواجهة (Poster)</label>
  <input data-key="heroPosterUrl" dir="ltr" placeholder="/media/hero/hero-poster.jpg"></div>
\`\`\`

## 6) ملاحظات أداء وتوافق

- الفيديو: \`preload="none"\` + \`muted\` + \`playsinline\` + \`loop\`، ويُحمَّل فقط عند ظهور الواجهة (IntersectionObserver مع احتياطي مؤقت).
- يُلغى تحميل الفيديو تلقائيًا عند \`prefers-reduced-motion\` أو \`save-data\` أو شبكة 2G، وتُستخدم الصورة.
- الفيديو يتوقف عند إخفاء التبويب أو خروجه من الشاشة، لتوفير البطارية.
- الصور: \`loading="lazy"\` + \`decoding="async"\` + \`width/height\`، ونسختان لكل صورة (1600px و800px).
- الصوت: لا يبدأ قبل أول تفاعل (سياسة المتصفحات)، بمستوى منخفض جدًا (0.018–0.03)، مع كتم محفوظ في \`localStorage\`.
- زر الكتم: \`aria-pressed\` + \`aria-label\` متغيّران، وموضعه ثابت أسفل يمين الشاشة.

## 7) ملفات الوسائط الحالية

| الملف | الاستخدام | الأبعاد |
|---|---|---|
| \`public/media/hero/hero-loop.mp4\` | فيديو الواجهة (5 مشاهد، 12.6 ثانية، صامت) | 1280×720 |
| \`public/media/hero/hero-poster.jpg\` | غلاف الفيديو وأول شاشة | 1920×1080 |
| \`dest-makkah.jpg\` / \`dest-madinah.jpg\` | بطاقات العمرة ووجهات السعودية | 1600×900 |
| \`dest-istanbul.jpg\` / \`dest-georgia.jpg\` / \`dest-egypt.jpg\` / \`dest-sharm.jpg\` | بطاقات البرامج والوجهات | 1600×900 |

> جميع الصور أُنتجت خصيصًا لهذه المنصة كوسائط بصرية توضيحية عالية الجودة، وليست صورًا فوتوغرافية أرشيفية من الشركة. يمكن استبدال كل ملف بصورة الشركة بنفس الاسم دون تغيير الكود.
`;

fs.writeFileSync('docs/hero-effects.md', doc, 'utf8');
console.log('written', doc.length, 'chars');
