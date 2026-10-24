# الواجهة الرئيسية: فيديو + أشكال متحركة + مؤثرات صوتية

هذا الملف يجمع الكود الكامل الذي أُضيف إلى المنصة، مع تحديد مكان تغيير رابط الفيديو ومصادر الصور.

## 1) أين أضع رابط الفيديو؟

ثلاث طرق، بالترتيب الموصى به:

1. **من لوحة الإدارة** (بدون كود): `/admin` ← «الإعدادات» ← «رابط فيديو الواجهة (MP4)».
   الحقل يُحفظ في جدول `settings` تحت المفتاح `heroVideoUrl`، وصورة الغلاف تحت `heroPosterUrl`.
2. **عبر API**:
   ```bash
   curl -X PATCH /api/admin/settings -b cookies.txt \
     -H "content-type: application/json" -H "x-requested-with: fetch" \
     -d '{"heroVideoUrl":"/media/hero/hero-loop.mp4","heroPosterUrl":"/media/hero/hero-poster.jpg"}'
   ```
3. **في الكود** (القيمة الافتراضية عند الزرع): `tools/build-seed.mjs` ← مفتاح `settings.heroVideoUrl` و`settings.heroPosterUrl`.
   لرفع ملف جديد ضعه في `public/media/hero/` (يفضَّل MP4 H.264 بدون صوت، 720p، أقل من 3MB) ثم أشر إليه بالمسار.

> الصوت لا يحتاج ملفات: المؤثرات مُولَّدة لحظيًا عبر Web Audio API، ويمكن تعديل تردداتها من `SoundKit` في `app.js`.

## 2) كود HTML للواجهة

```html
  <section class="hero">
    <div class="hero-art">
      ${settings.heroVideoUrl ? `<video class="hero-video" id="heroVideo" muted loop playsinline preload="none" aria-hidden="true" data-src="${attr(settings.heroVideoUrl)}" data-poster="${attr(settings.heroPosterUrl || artUrl('hero', 1))}"></video>` : ''}
      <img class="hero-poster" src="${attr(settings.heroPosterUrl || artUrl('hero', 1))}" alt="مشهد توضيحي لمآذن وقباب في ساعة الغروب" width="1920" height="1080" fetchpriority="high" decoding="async">
    </div>
    <div class="hero-blobs" aria-hidden="true">
      <span class="blob blob-1"></span>
      <span class="blob blob-2"></span>
      <span class="blob blob-3"></span>
      <span class="hero-ring"></span>
      <span class="hero-spark hero-spark-1"></span>
      <span class="hero-spark hero-spark-2"></span>
    </div>
    <div class="wrap hero-inner">
      <div class="hero-copy">
        <span class="eyebrow">✦ ${esc(settings.brand)}</span>
        <h1>العالم بين يديك... <em>وخبير سفرك معك في كل خطوة</em></h1>
        <p class="hero-sub">${esc(settings.heroSub || 'من تذاكر الطيران وحجوزات الفنادق إلى التأشيرات والبرامج السياحية، نساعدك على التخطيط لرحلتك المثالية بكل سهولة وثقة.')}</p>
        <div class="btn-row">
          <a class="btn btn-gold btn-lg" href="#services">ابدأ التخطيط</a>
          <button class="btn btn-ghost btn-lg" type="button" data-wa data-wa-text="السلام عليكم، أرغب بالتواصل مع مستشار سفر من لوريت">${icon('whatsapp', 18)} تحدث مع مستشار</button>
        </div>
        <div class="hero-stats">
          <div class="hero-stat"><b>${counts.programs}</b><span>برنامج منشور</span></div>
          <div class="hero-stat"><b>${counts.destinations}</b><span>وجهة ومدينة</span></div>
          <div class="hero-stat"><b>2</b><span>فرعان: إربد وعمّان</span></div>
          <div class="hero-stat"><b>${counts.reviews}</b><span>مراجعة على Google</span></div>
        </div>
      </div>
    </div>
  </section>
```

> `data-src` و`data-poster` مقصودان: لا يبدأ المتصفح تنزيل الفيديو حتى تصله إشارة من الجافاسكربت (Lazy)، والصورة تظهر أولًا.
> عند ترك `heroVideoUrl` فارغًا لا يُطبع وسم الفيديو إطلاقًا وتبقى الصورة.

## 3) كود CSS الكامل

```css
/* ==========================================================================
   الواجهة الرئيسية: فيديو خلفي + أشكال متحركة + زر الصوت + تكبير الصور
   ========================================================================== */
.hero-video {
  position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; object-position: center;
  opacity: 0; transition: opacity 1s ease; z-index: 1;
}
.hero-video.is-ready { opacity: 1; }
.hero-poster { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; object-position: center; z-index: 0; }

.hero-blobs { position: absolute; inset: 0; z-index: 1; overflow: hidden; pointer-events: none; }
.blob {
  position: absolute; border-radius: 50%; filter: blur(56px); opacity: .5;
  mix-blend-mode: screen; will-change: transform;
}
.blob-1 {
  width: 420px; height: 420px; top: 6%; left: 4%;
  background: radial-gradient(circle, rgba(217, 163, 74, .6), transparent 70%);
  animation: blobFloat 22s ease-in-out infinite;
}
.blob-2 {
  width: 540px; height: 540px; bottom: -14%; left: 24%;
  background: radial-gradient(circle, rgba(23, 99, 143, .75), transparent 70%);
  animation: blobFloat 30s ease-in-out infinite reverse;
}
.blob-3 {
  width: 300px; height: 300px; top: 26%; left: 46%;
  background: radial-gradient(circle, rgba(232, 185, 106, .42), transparent 70%);
  animation: blobFloat 18s ease-in-out infinite;
}
.hero-ring {
  position: absolute; top: 12%; left: 58%; width: 180px; height: 180px; border-radius: 50%;
  border: 1px solid rgba(232, 185, 106, .35); box-shadow: 0 0 0 22px rgba(232, 185, 106, .04);
  animation: heroSpin 42s linear infinite;
}
.hero-ring::after {
  content: ""; position: absolute; top: -4px; left: 50%; width: 7px; height: 7px; border-radius: 50%;
  background: var(--gold-2); box-shadow: 0 0 14px rgba(232, 185, 106, .8);
}
.hero-spark {
  position: absolute; width: 10px; height: 10px; background: rgba(255, 255, 255, .55);
  transform: rotate(45deg); border-radius: 2px; animation: sparkPulse 6s ease-in-out infinite;
}
.hero-spark-1 { top: 24%; left: 36%; animation-delay: .8s; }
.hero-spark-2 { top: 58%; left: 12%; width: 7px; height: 7px; animation-delay: 2.4s; }

@keyframes blobFloat {
  0%, 100% { transform: translate3d(0, 0, 0) scale(1); }
  33% { transform: translate3d(42px, -28px, 0) scale(1.09); }
  66% { transform: translate3d(-30px, 22px, 0) scale(.95); }
}
@keyframes heroSpin { to { transform: rotate(360deg); } }
@keyframes sparkPulse { 0%, 100% { opacity: .18; transform: rotate(45deg) scale(.8); } 50% { opacity: .7; transform: rotate(45deg) scale(1.15); } }

/* زر كتم المؤثرات الصوتية */
.sound-toggle {
  position: fixed; right: 16px; bottom: 16px; z-index: 76; width: 44px; height: 44px; border-radius: 50%;
  border: 1px solid rgba(255, 255, 255, .2); background: rgba(11, 42, 67, .82); color: #fff;
  display: grid; place-items: center; cursor: pointer; backdrop-filter: blur(10px);
  box-shadow: 0 10px 24px rgba(8, 31, 49, .3); transition: transform .2s, background .2s, opacity .2s;
}
.sound-toggle:hover { transform: translateY(-2px); background: rgba(11, 42, 67, .95); }
.sound-toggle .ico-off { display: none; }
.sound-toggle[aria-pressed="false"] .ico-on { display: none; }
.sound-toggle[aria-pressed="false"] .ico-off { display: block; }
.sound-toggle[aria-pressed="false"] { opacity: .72; }

/* تكبير ناعم للصور */
.figure { overflow: hidden; }
.figure img { transition: transform .7s cubic-bezier(.2, .7, .2, 1); }
.figure:hover img, .figure:focus-within img { transform: scale(1.05); }
.gallery img { transition: transform .7s cubic-bezier(.2, .7, .2, 1); }
.gallery img:hover { transform: scale(1.045); }

@media (max-width: 860px) {
  .blob { filter: blur(44px); opacity: .42; }
  .blob-1 { width: 300px; height: 300px; }
  .blob-2 { width: 360px; height: 360px; }
  .blob-3 { display: none; }
  .hero-ring { width: 130px; height: 130px; left: 50%; }
}
@media (max-width: 620px) {
  .hero-blobs { opacity: .8; }
  .hero-spark { display: none; }
  .sound-toggle { width: 40px; height: 40px; right: 12px; bottom: 12px; }
}
```

## 4) كود JavaScript الكامل (الصوت + زر الكتم + تحميل الفيديو الكسول)

```js
  /* ---------------- UI sounds (Web Audio API, no audio files) ---------------- */
  const SoundKit = (() => {
    const KEY = 'loret_sound';
    let ctx = null;
    let master = null;
    let enabled = true;
    try { enabled = localStorage.getItem(KEY) !== 'off'; } catch { /* private mode */ }
    let lastHover = 0;

    function ensure() {
      if (!enabled) return null;
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      if (!ctx) {
        ctx = new AC();
        master = ctx.createGain();
        master.gain.value = 0.45;
        master.connect(ctx.destination);
      }
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      return ctx;
    }

    function tone({ freq = 880, to = 1180, dur = 0.07, gain = 0.03, type = 'sine', delay = 0 }) {
      const c = ensure();
      if (!c) return;
      const t0 = c.currentTime + delay;
      const osc = c.createOscillator();
      const g = c.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, t0);
      osc.frequency.exponentialRampToValueAtTime(Math.max(60, to), t0 + dur);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(gain, t0 + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(g);
      g.connect(master);
      osc.start(t0);
      osc.stop(t0 + dur + 0.02);
    }

    return {
      get enabled() { return enabled; },
      hover() {
        if (!enabled) return;
        const now = performance.now();
        if (now - lastHover < 90) return;
        lastHover = now;
        tone({ freq: 1040, to: 1320, dur: 0.055, gain: 0.018, type: 'sine' });
      },
      click() {
        if (!enabled) return;
        tone({ freq: 620, to: 780, dur: 0.06, gain: 0.03, type: 'triangle' });
        tone({ freq: 930, to: 1040, dur: 0.05, gain: 0.018, type: 'sine', delay: 0.045 });
      },
      toggle() {
        enabled = !enabled;
        try { localStorage.setItem(KEY, enabled ? 'on' : 'off'); } catch { /* ignore */ }
        if (enabled) {
          ensure();
          tone({ freq: 700, to: 980, dur: 0.09, gain: 0.028 });
        }
        return enabled;
      },
      prime() { if (enabled) ensure(); },
    };
  })();

  const soundBtn = $('#soundToggle');
  function syncSoundButton() {
    if (!soundBtn) return;
    soundBtn.setAttribute('aria-pressed', String(SoundKit.enabled));
    const label = SoundKit.enabled ? 'كتم المؤثرات الصوتية' : 'تفعيل المؤثرات الصوتية';
    soundBtn.setAttribute('aria-label', label);
    soundBtn.title = label;
  }
  syncSoundButton();
  soundBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    SoundKit.toggle();
    syncSoundButton();
  });

  // AudioContext needs one user gesture before it can start.
  document.addEventListener('pointerdown', () => SoundKit.prime(), { once: true });
  document.addEventListener('keydown', () => SoundKit.prime(), { once: true });

  const SOUND_TARGETS = 'a[href], button, [role="button"], .card-media, .poster-media, .service-tile, .chip, .figure';
  document.addEventListener('pointerover', (e) => {
    if (e.pointerType && e.pointerType !== 'mouse') return;
    const el = e.target.closest(SOUND_TARGETS);
    if (!el || el.disabled || el.id === 'soundToggle') return;
    SoundKit.hover();
  }, { passive: true });

  document.addEventListener('pointerdown', (e) => {
    const el = e.target.closest('a[href], button, [role="button"]');
    if (!el || el.disabled || el.id === 'soundToggle') return;
    SoundKit.click();
  }, { passive: true });

  /* ---------------- lazy hero video (poster first, video on demand) ---------------- */
  const heroVideo = $('#heroVideo');
  if (heroVideo) {
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const conn = navigator.connection || {};
    const saveData = conn.saveData === true || /(^|-)2g$/.test(conn.effectiveType || '');
    if (reduceMotion || saveData) {
      heroVideo.remove();
    } else {
      const startVideo = () => {
        if (!heroVideo.src) {
          heroVideo.poster = heroVideo.dataset.poster || '';
          heroVideo.src = heroVideo.dataset.src;
          heroVideo.load();
        }
        const playing = heroVideo.play();
        if (playing && playing.catch) playing.catch(() => {});
      };
      heroVideo.addEventListener('loadeddata', () => heroVideo.classList.add('is-ready'), { once: true });
      if ('IntersectionObserver' in window) {
        const io = new IntersectionObserver((entries) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting) startVideo();
            else heroVideo.pause();
          });
        }, { rootMargin: '240px 0px' });
        io.observe(heroVideo);
        // Fallback for environments where IO callbacks are throttled or unavailable.
        setTimeout(() => {
          const rect = heroVideo.getBoundingClientRect();
          if (rect.top < window.innerHeight + 320 && rect.bottom > -320) startVideo();
        }, 1200);
      } else {
        startVideo();
      }
      document.addEventListener('visibilitychange', () => {
        if (!heroVideo.src) return;
        if (document.hidden) heroVideo.pause();
        else heroVideo.play().catch(() => {});
      });
    }
  }
```

## 5) إعدادات اللوحة المرتبطة

في `public/assets/js/admin.js` أُضيف حقلان إلى نموذج الإعدادات:

```html
<div class="field"><label>رابط فيديو الواجهة (MP4)</label>
  <input data-key="heroVideoUrl" dir="ltr" placeholder="/media/hero/hero-loop.mp4">
  <span class="field-hint">اتركه فارغًا لإيقاف الفيديو واستخدام الصورة فقط.</span></div>
<div class="field"><label>صورة غلاف الواجهة (Poster)</label>
  <input data-key="heroPosterUrl" dir="ltr" placeholder="/media/hero/hero-poster.jpg"></div>
```

## 6) ملاحظات أداء وتوافق

- الفيديو: `preload="none"` + `muted` + `playsinline` + `loop`، ويُحمَّل فقط عند ظهور الواجهة (IntersectionObserver مع احتياطي مؤقت).
- يُلغى تحميل الفيديو تلقائيًا عند `prefers-reduced-motion` أو `save-data` أو شبكة 2G، وتُستخدم الصورة.
- الفيديو يتوقف عند إخفاء التبويب أو خروجه من الشاشة، لتوفير البطارية.
- الصور: `loading="lazy"` + `decoding="async"` + `width/height`، ونسختان لكل صورة (1600px و800px).
- الصوت: لا يبدأ قبل أول تفاعل (سياسة المتصفحات)، بمستوى منخفض جدًا (0.018–0.03)، مع كتم محفوظ في `localStorage`.
- زر الكتم: `aria-pressed` + `aria-label` متغيّران، وموضعه ثابت أسفل يمين الشاشة.

## 7) ملفات الوسائط الحالية

| الملف | الاستخدام | الأبعاد |
|---|---|---|
| `public/media/hero/hero-loop.mp4` | فيديو الواجهة (5 مشاهد، 12.6 ثانية، صامت) | 1280×720 |
| `public/media/hero/hero-poster.jpg` | غلاف الفيديو وأول شاشة | 1920×1080 |
| `dest-makkah.jpg` / `dest-madinah.jpg` | بطاقات العمرة ووجهات السعودية | 1600×900 |
| `dest-istanbul.jpg` / `dest-georgia.jpg` / `dest-egypt.jpg` / `dest-sharm.jpg` | بطاقات البرامج والوجهات | 1600×900 |

> جميع الصور أُنتجت خصيصًا لهذه المنصة كوسائط بصرية توضيحية عالية الجودة، وليست صورًا فوتوغرافية أرشيفية من الشركة. يمكن استبدال كل ملف بصورة الشركة بنفس الاسم دون تغيير الكود.
