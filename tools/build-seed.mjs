/* Builds data/seed.json from the content extracted out of the legacy site
   plus the editorial pack. Real prices only: every programme keeps the price
   table it had in the original data, nothing is invented here. */

import fs from 'node:fs';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const platformRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const projectRoot = join(platformRoot, '..');
const readJson = (p, fallback) => {
  // Source data lives in data/source (committed) with a fallback to ../work for older checkouts.
  const candidates = [join(platformRoot, p), join(projectRoot, p)];
  for (const file of candidates) {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* try next */ }
  }
  return fallback;
};

const legacy = readJson('data/source/legacy-def.json');
const content = readJson('data/source/legacy-content.json', {});
const content2 = readJson('data/source/legacy-content2.json', {});
const pack = readJson('data/source/content-pack.json', { articles: [], faq: [], umrahSteps: [], visaGuidance: [], hotelTips: [] });

const CATS = { umrah: 'الحج والعمرة', cruise: 'رحلات الكروز', sharm: 'شرم الشيخ', istanbul: 'إسطنبول' };
const MODE = { air: 'جوي', bus: 'بري (حافلات)', sea: 'بحري' };
const ROUTE = { both: 'مكة والمدينة', makkah: 'مكة المكرمة فقط', madinah: 'المدينة المنورة فقط' };
const COUNTRY = { umrah: 'السعودية', cruise: 'البحر المتوسط', sharm: 'مصر', istanbul: 'تركيا' };

function priceOf(p) {
  const list = (p.opts || []).map((o) => Number(o.p)).filter((n) => n > 0);
  if (list.length) return Math.min(...list);
  const rooms = Object.values(p.prices || {}).map(Number).filter((n) => n > 0);
  return rooms.length ? Math.min(...rooms) : 0;
}

function hotelsOf(p) {
  const out = [];
  if (p.mk && p.mk.name) out.push({ city: 'مكة المكرمة', name: p.mk.name, stars: p.mk.stars || 0, distance: p.mk.dist || '' });
  if (p.md && p.md.name) out.push({ city: 'المدينة المنورة', name: p.md.name, stars: p.md.stars || 0, distance: p.md.dist || '' });
  return out;
}

function optionsOf(p) {
  if (p.opts && p.opts.length) return p.opts.filter((o) => Number(o.p) > 0).map((o) => ({ label: o.l, price: Number(o.p) }));
  const labels = { single: 'غرفة مفردة', double: 'غرفة ثنائية', triple: 'غرفة ثلاثية', quad: 'غرفة رباعية' };
  return Object.entries(p.prices || {})
    .filter(([, v]) => Number(v) > 0)
    .map(([k, v]) => ({ label: labels[k] || k, price: Number(v) }));
}

function summaryOf(p) {
  const bits = [];
  if (MODE[p.mode]) bits.push(`رحلة ${MODE[p.mode]}`);
  if (ROUTE[p.route]) bits.push(ROUTE[p.route]);
  const hotels = hotelsOf(p).map((h) => h.name).filter(Boolean);
  if (hotels.length) bits.push(hotels.join(' + '));
  if (p.meals) bits.push(`الوجبات: ${p.meals}`);
  return bits.join(' · ');
}

const seen = new Set();
const PROGRAM_IMAGE = {
  umrah: '/media/hero/hero-poster.jpg',
  istanbul: '/media/hero/dest-istanbul.jpg',
  sharm: '/media/hero/dest-sharm.jpg',
};
const UMRAH_PHOTOS = ['/media/hero/dest-makkah.jpg', '/media/hero/dest-madinah.jpg', '/media/hero/hero-poster.jpg'];

const programs = (legacy.packages || []).map((p, index) => {
  const cat = p.cat || 'umrah';
  let slug = `${cat}-${p.id}`.toLowerCase().replace(/[^a-z0-9-]/g, '');
  if (seen.has(slug)) slug = `${slug}-${index}`;
  seen.add(slug);
  const status = p.status === 'sold' ? 'sold_out' : p.status === 'inactive' ? 'archived' : 'published';
  const artKey = cat === 'cruise' ? 'cruise' : cat === 'sharm' ? 'beach' : cat === 'istanbul' ? 'istanbul' : (index % 2 ? 'madinah' : 'haram');
  return {
    slug,
    legacyId: p.id,
    category: cat,
    level: p.level || null,
    title: p.title,
    summary: summaryOf(p),
    description: (p.inc || []).slice(0, 3).join(' — '),
    destination: p.dest || (cat === 'umrah' ? ROUTE[p.route] || 'مكة والمدينة' : cat === 'cruise' ? 'البحر المتوسط' : cat === 'sharm' ? 'شرم الشيخ' : 'إسطنبول'),
    country: COUNTRY[cat] || 'السعودية',
    days: p.days || null,
    nights: p.nights || null,
    priceFrom: priceOf(p) || null,
    currency: 'د.أ',
    status,
    featured: ['p1', 'p6', 'p9', 'cr1', 's1', 'i1', 's5', 'i8'].includes(p.id),
    artKey,
    imageUrl: cat === 'umrah' ? UMRAH_PHOTOS[index % UMRAH_PHOTOS.length] : (PROGRAM_IMAGE[cat] || null),
    hotels: hotelsOf(p),
    itinerary: p.itin || [],
    includes: p.inc || [],
    excludes: p.exc || [],
    terms: p.terms || [],
    flights: p.flights ? (Array.isArray(p.flights[0]) ? p.flights.flat() : p.flights) : [],
    options: optionsOf(p),
    badges: p.badges || [],
    meals: p.meals || '',
    airline: p.airline || '',
    departureDates: p.dates || '',
    mode: p.mode || null,
    route: p.route || null,
    sort: 10 + index * 5,
  };
});

const offers = [
  {
    slug: 'offer-trabzon',
    title: 'طرابزون — 8 أيام / 7 ليالٍ',
    body: 'برنامج طرابزون من لوريت: طيران، استقبال وتوديع، جولات يومية، وجميع الضرائب.',
    category: 'turkey', priceFrom: 369, days: 8, nights: 7, featured: true, sort: 10,
    imageUrl: '/media/offers/poster-trabzon.jpg', imageAlt: 'بوستر عرض طرابزون 8 أيام و7 ليالٍ بسعر 369 دينار',
    includes: ['تذاكر الطيران', 'استقبال وتوديع', 'جولات يومية', 'جميع الضرائب'],
  },
  {
    slug: 'offer-cairo-alexandria',
    title: 'القاهرة والإسكندرية — 8 أيام / 7 ليالٍ',
    body: 'القاهرة والإسكندرية: تذاكر الطيران، استقبال وتوديع بسيارة خاصة، إفطار يومي، وجولات مجانية.',
    category: 'egypt', priceFrom: 419, days: 8, nights: 7, sort: 20,
    imageUrl: '/media/offers/poster-cairo-alexandria.jpg', imageAlt: 'بوستر عرض القاهرة والإسكندرية 8 أيام و7 ليالٍ بسعر 419 دينار',
    includes: ['تذاكر الطيران', 'استقبال وتوديع بسيارة خاصة', 'إفطار يومي', 'جولات مجانية'],
  },
  {
    slug: 'offer-batumi',
    title: 'باتومي — 8 أيام / 7 ليالٍ',
    body: 'باتومي: طيران، استقبال وتوديع، جولات يومية، وجميع الضرائب.',
    category: 'georgia', priceFrom: 339, days: 8, nights: 7, sort: 30,
    imageUrl: '/media/offers/poster-batumi.jpg', imageAlt: 'بوستر عرض باتومي 8 أيام و7 ليالٍ بسعر 339 دينار',
    includes: ['تذاكر الطيران', 'استقبال وتوديع', 'جولات يومية', 'جميع الضرائب'],
  },
  {
    slug: 'offer-batumi-tbilisi-379',
    title: 'باتومي وتبليسي — 8 أيام / 7 ليالٍ',
    body: 'جولة مزدوجة بين باتومي وتبليسي: طيران، استقبال وتوديع، جولات يومية، وجميع الضرائب.',
    category: 'georgia', priceFrom: 379, days: 8, nights: 7, featured: true, sort: 40,
    imageUrl: '/media/offers/poster-batumi-tbilisi-379.jpg', imageAlt: 'بوستر عرض باتومي وتبليسي 8 أيام و7 ليالٍ بسعر 379 دينار',
    includes: ['تذاكر الطيران', 'استقبال وتوديع', 'جولات يومية', 'جميع الضرائب'],
  },
  {
    slug: 'offer-istanbul',
    title: 'إسطنبول — 4 أيام / 3 ليالٍ',
    body: 'إسطنبول على الملكية الأردنية: تذاكر الطيران، استقبال وتوديع، إفطار يومي، رحلة مجانية، وجميع الضرائب.',
    category: 'turkey', priceFrom: 259, days: 4, nights: 3, featured: true, sort: 50,
    imageUrl: '/media/offers/poster-istanbul.jpg', imageAlt: 'بوستر عرض إسطنبول 4 أيام و3 ليالٍ بسعر 259 دينار',
    includes: ['تذاكر الطيران على الملكية الأردنية', 'استقبال وتوديع', 'إفطار يومي', 'رحلة مجانية', 'جميع الضرائب'],
  },
  {
    slug: 'offer-sharm',
    title: 'شرم الشيخ — 4 أيام / 3 ليالٍ',
    body: 'شرم الشيخ: جميع الوجبات والمشروبات، استقبال وتوديع، تذاكر الطيران، وجميع الضرائب.',
    category: 'egypt', priceFrom: 239, days: 4, nights: 3, featured: true, sort: 60,
    imageUrl: '/media/offers/poster-sharm.jpg', imageAlt: 'بوستر عرض شرم الشيخ 4 أيام و3 ليالٍ بسعر 239 دينار',
    includes: ['جميع الوجبات والمشروبات', 'استقبال وتوديع', 'تذاكر الطيران', 'جميع الضرائب'],
  },
  {
    slug: 'offer-cairo-299',
    title: 'القاهرة — 4 أيام / 3 ليالٍ',
    body: 'القاهرة: تذاكر الطيران، استقبال وتوديع بسيارة خاصة، إفطار يومي، ورحلتان مجانيتان.',
    category: 'egypt', priceFrom: 299, days: 4, nights: 3, sort: 70,
    imageUrl: '/media/offers/poster-cairo-299.jpg', imageAlt: 'بوستر عرض القاهرة 4 أيام و3 ليالٍ بسعر 299 دينار',
    includes: ['تذاكر الطيران', 'استقبال وتوديع بسيارة خاصة', 'إفطار يومي', 'رحلتان مجانيتان'],
  },
  {
    slug: 'offer-cairo-luxor-aswan',
    title: 'القاهرة والأقصر وأسوان — 8 أيام / 7 ليالٍ',
    body: 'رحلة مصر الكبرى: القاهرة والأقصر وأسوان، مع إفطار وعشاء وجولات يومية.',
    category: 'egypt', priceFrom: 569, days: 8, nights: 7, sort: 80,
    imageUrl: '/media/offers/poster-cairo-luxor-aswan.jpg', imageAlt: 'بوستر عرض القاهرة والأقصر وأسوان 8 أيام و7 ليالٍ بسعر 569 دينار',
    includes: ['تذاكر الطيران', 'استقبال وتوديع', 'إفطار وعشاء', 'جولات يومية', 'جميع الضرائب'],
  },
  {
    slug: 'offer-umrah-voco',
    title: 'عمرة مكة المكرمة فقط — فندق VOCO 5★ + زيارة المدينة مجانًا',
    body: 'برنامج عمرة 5 أيام في مكة المكرمة مع الإقامة في فندق VOCO خمس نجوم، وزيارة مجانية للمدينة المنورة.',
    category: 'umrah', priceFrom: 369, days: 5, nights: 4, featured: true, sort: 90,
    imageUrl: '/media/offers/poster-umrah-makkah-voco.jpg', imageAlt: 'بوستر عرض عمرة مكة المكرمة مع فندق VOCO خمس نجوم بسعر 369 دينار',
    includes: ['تذاكر الطيران', 'استقبال وتوديع', 'إقامة في فندق VOCO 5 نجوم', 'زيارة مجانية للمدينة المنورة', 'جميع الضرائب'],
  },
  {
    slug: 'offer-umrah-makkah-madinah',
    title: 'عمرة مكة المكرمة والمدينة المنورة — 8 أيام / 7 ليالٍ',
    body: 'عمرة مكة والمدينة بسعر 419 دينارًا لفترة محدودة، شاملة الطيران والاستقبال والإقامة والجولات.',
    category: 'umrah', priceFrom: 419, days: 8, nights: 7, featured: true, sort: 100,
    imageUrl: '/media/offers/poster-umrah-makkah-madinah.jpg', imageAlt: 'بوستر عرض العمرة مكة المكرمة والمدينة المنورة 8 أيام بسعر 419 دينار',
    includes: ['تذاكر الطيران', 'استقبال وتوديع', 'إقامة في فنادق مميزة', 'جولات دينية يومية', 'جميع الضرائب'],
  },
  {
    slug: 'offer-georgia-333-499',
    title: 'جورجيا — تبليسي وباتومي (غرفة مزدوجة 333 / مفردة 499)',
    body: 'عرض جورجيا: طيران، إقامة فندقية، إفطار في تبليسي، مواصلات، جولة مدينة، ورحلة بالقارب.',
    category: 'georgia', priceFrom: 333, days: 8, nights: 7, sort: 110,
    imageUrl: '/media/offers/poster-georgia-333-499.jpg', imageAlt: 'بوستر عرض جورجيا تبليسي وباتومي من 333 دينار للغرفة المزدوجة',
    includes: ['تذاكر الطيران', 'الإقامة الفندقية في تبليسي وباتومي', 'وجبات الإفطار في تبليسي', 'المواصلات', 'جولة سياحية في تبليسي', 'رحلة بالقارب'],
  },
  {
    slug: 'offer-georgia-333',
    title: 'جورجيا — تبليسي وباتومي — 333 د.أ',
    body: 'عرض جورجيا الاقتصادي: طيران، إقامة، إفطار، مواصلات، وجولات.',
    category: 'georgia', priceFrom: 333, days: 8, nights: 7, sort: 120,
    imageUrl: '/media/offers/poster-georgia-333-jd.jpg', imageAlt: 'بوستر عرض جورجيا تبليسي وباتومي بسعر 333 دينار',
    includes: ['تذاكر الطيران', 'الإقامة الفندقية', 'وجبات الإفطار', 'المواصلات', 'جولات سياحية'],
  },
  {
    slug: 'offer-georgia-335',
    title: 'جورجيا — تبليسي وباتومي (Heritage + Orbi) — 335 د.أ',
    body: 'عرض جورجيا مع الإقامة في Heritage Hotel & Suites وOrbi Apartment، شامل الإفطار والتنقلات وجولة تبليسي.',
    category: 'georgia', priceFrom: 335, days: 8, nights: 7, sort: 130,
    imageUrl: '/media/offers/poster-georgia-335.jpg', imageAlt: 'بوستر عرض جورجيا مع فنادق Heritage وOrbi بسعر 335 دينار',
    includes: ['تذاكر الطيران ذهابًا وعودة', 'الإقامة في Heritage Hotel & Suites وOrbi Apartment', 'وجبات الإفطار في تبليسي', 'تنقلات المطار والفندق', 'جولة تبليسي', 'رحلة بوليفارد باتومي'],
  },
  {
    slug: 'offer-georgia-kakheti',
    title: 'جورجيا — تبليسي وكاخيتي — 333 د.أ',
    body: 'خمسة أيام في تبليسي وثلاثة في كاخيتي، مع الإقامة في Heritage وReserve Resort Lagodekhi.',
    category: 'georgia', priceFrom: 333, days: 8, nights: 7, sort: 140,
    imageUrl: '/media/offers/poster-georgia-kakheti.jpg', imageAlt: 'بوستر عرض جورجيا تبليسي وكاخيتي بسعر 333 دينار',
    includes: ['تذاكر الطيران', '5 أيام تبليسي + 3 أيام كاخيتي', 'الإقامة في Heritage وReserve Resort Lagodekhi', 'وجبات الإفطار', 'تنقلات المطار والفندق', 'جولة تبليسي'],
  },
  {
    slug: 'offer-georgia-mtskheta',
    title: 'جورجيا — تبليسي ومتسخيتا — 8 أيام / 7 ليالٍ',
    body: 'تبليسي ومتسخيتا مع الإقامة في Heritage Hotel & Suites، وجولات يومية.',
    category: 'georgia', priceFrom: 333, days: 8, nights: 7, sort: 150,
    imageUrl: '/media/offers/poster-georgia-tbilisi-mtskheta.jpg', imageAlt: 'بوستر عرض جورجيا تبليسي ومتسخيتا 8 أيام بسعر 333 دينار',
    includes: ['تذاكر الطيران', 'الإقامة في Heritage Hotel & Suites', 'وجبات الإفطار', 'تنقلات المطار والفندق', 'جولة تبليسي', 'رحلة متسخيتا'],
  },
  {
    slug: 'offer-aroya-cruise',
    title: 'كروز أرويا — 7 ليالٍ على السفينة + ليلتان في إسطنبول — من 689 د.أ',
    body: 'رحلة بحرية فاخرة على سفينة أرويا: تأمين سفر، نقل بسيارة خاصة، وجبات يومية، وإقامة في إسطنبول.',
    category: 'cruise', priceFrom: 689, days: 10, nights: 9, featured: true, sort: 160,
    imageUrl: '/media/offers/poster-aroya-cruise.jpg', imageAlt: 'بوستر رحلة كروز أرويا بسعر يبدأ من 689 دينار',
    includes: ['تذاكر الطيران على الملكية الأردنية', 'الإقامة ليلتين في إسطنبول', 'الإقامة 7 ليالٍ في السفينة', 'الوجبات اليومية', 'النقل بسيارة خاصة', 'تأمين السفر'],
  },
  {
    slug: 'offer-dv-lottery',
    title: 'الوتري للتأشيرة الأمريكية — DV Lottery 2027',
    body: 'التسجيل يفتح بتاريخ 1-11-2026: استشارات دقيقة، تصوير وفق المواصفات، تعبئة الطلب، ومتابعة حتى إنهاء التسجيل.',
    category: 'visa', priceFrom: null, days: null, nights: null, featured: true, sort: 170,
    imageUrl: '/media/offers/poster-dv-lottery.jpg', imageAlt: 'بوستر خدمة الوتري للتأشيرة الأمريكية DV Lottery 2027',
    includes: ['استشارات دقيقة', 'تصوير احترافي وفق المواصفات الرسمية', 'مساعدة كاملة في تعبئة الطلب', 'متابعة حتى إنهاء التسجيل'],
  },
].map((o) => ({ ...o, currency: 'د.أ', active: true }));

const news = (content.news || []).map((n) => ({
  title: n.title, body: n.body || '', airline: n.airline || '', urgent: n.urgent ? 1 : 0, publishedAt: n.date || '2026-10-14',
}));

const branchNames = { irbid: 'فرع إربد', amman: 'فرع عمّان' };
const reviews = (content2.GOOGLE_REVIEW_EXCERPTS || []).map((r) => ({
  name: r.name,
  branch: branchNames[r.branch] || r.branch,
  rating: 0,
  text: r.text,
  source: 'Google',
  visible: true,
}));

const ART_BY_COUNTRY = { jordan: 'desert', saudi: 'haram', egypt: 'cairo', turkey: 'istanbul', syria: 'desert' };
const ART_BY_CITY = {
  petra: 'desert', deadsea: 'beach', amman: 'gulf', wadirum: 'desert', mecca: 'haram', medina: 'madinah',
  riyadh: 'gulf', jeddah: 'beach', cairo: 'cairo', sharm: 'beach', alexandria: 'europe', elgouna: 'beach',
  hurghada: 'beach', taba: 'beach', istanbul: 'istanbul', antalya: 'beach', trabzon: 'europe', fethiye: 'beach',
  damascus: 'desert', aleppo: 'desert', palmyra: 'desert',
};

const PHOTO_BY_SLUG = {
  istanbul: '/media/hero/dest-istanbul.jpg',
  batumi: '/media/hero/dest-georgia.jpg',
  cairo: '/media/hero/dest-egypt.jpg',
  sharm: '/media/hero/dest-sharm.jpg',
  turkey: '/media/hero/dest-istanbul.jpg',
  egypt: '/media/hero/dest-egypt.jpg',
  saudi: '/media/hero/dest-makkah.jpg',
  mecca: '/media/hero/dest-makkah.jpg',
  medina: '/media/hero/dest-madinah.jpg',
};

const destinations = [];
for (const c of content2.COUNTRIES || []) {
  if (c.id === 'all') continue;
  destinations.push({
    slug: c.id,
    name: c.name,
    kind: 'country',
    summary: c.desc || '',
    highlights: (c.cities || []).map((city) => city.name),
    artKey: ART_BY_COUNTRY[c.id] || 'desert',
    imageUrl: PHOTO_BY_SLUG[c.id] || null,
    sort: destinations.length * 10,
  });
  for (const city of c.cities || []) {
    const bestTime = (city.facts || []).find((f) => /أفضل وقت/.test(f.b || ''))?.s || '';
    destinations.push({
      slug: city.id,
      name: city.name,
      kind: 'city',
      parentSlug: c.id,
      summary: city.desc || city.sub || '',
      highlights: (city.facts || []).slice(0, 4).map((f) => `${f.b} — ${f.s}`),
      bestTime,
      mapUrl: city.map || null,
      artKey: ART_BY_CITY[city.id] || ART_BY_COUNTRY[c.id] || 'haram',
      imageUrl: PHOTO_BY_SLUG[city.id] || null,
      sort: 100 + destinations.length * 5,
    });
  }
}

const hotelGuides = [
  { city: 'مكة المكرمة', citySlug: 'mecca', name: 'سويس أوتيل المقام', stars: 5, area: 'أبراج مكة – قريب من الحرم', note: 'من أشهر فنادق مكة المطلة على المسجد الحرام، ويصلح لمن يريد أقرب مسافة للحرم.', source: 'المسافر', sort: 10 },
  { city: 'مكة المكرمة', citySlug: 'mecca', name: 'برج ساعة مكة الملكي فيرمونت', stars: 5, area: 'برج الساعة', note: 'إطلالة مباشرة على الحرم ودخول من ساحة الملك عبدالعزيز.', source: 'المسافر', sort: 20 },
  { city: 'مكة المكرمة', citySlug: 'mecca', name: 'فوكو مكة (Voco)', stars: 5, area: 'قريب من الحرم', note: 'خيار خمس نجوم ضمن مجموعة IHG، مناسب للعرسان والعائلات.', source: 'المسافر', sort: 30 },
  { city: 'المدينة المنورة', citySlug: 'medina', name: 'أنوار المدينة موفنبيك', stars: 5, area: 'المنطقة المركزية', note: 'قريب من المسجد النبوي، ويُعد من الخيارات المعروفة للزوار.', source: 'المسافر', sort: 40 },
  { city: 'المدينة المنورة', citySlug: 'medina', name: 'سوفيتل شهد المدينة', stars: 5, area: 'المنطقة المركزية', note: 'فندق فاخر قريب من الحرم النبوي مع خدمات عائلية.', source: 'المسافر', sort: 50 },
  { city: 'إسطنبول', citySlug: 'istanbul', name: 'هيلتون إسطنبول بومونتي', stars: 5, area: 'شيشلي', note: 'قريب من مراكز التسوق والمطاعم، وخيار عملي للعائلات.', source: 'المسافر', sort: 60 },
  { city: 'دبي', citySlug: 'dubai', name: 'هايد دبي', stars: 5, area: 'داون تاون', note: 'إطلالة على برج خليفة وقرب من دبي مول.', source: 'المسافر', sort: 70 },
  { city: 'أبوظبي', citySlug: 'abu-dhabi', name: 'هيلتون أبوظبي جزيرة ياس', stars: 5, area: 'جزيرة ياس', note: 'قريب من المتنزهات والمراكز الترفيهية ومطار أبوظبي.', source: 'المسافر', sort: 80 },
  { city: 'الدوحة', citySlug: 'doha', name: 'فيرمونت الدوحة', stars: 5, area: 'الخليج الغربي', note: 'أبراج مميزة وإطلالة بحرية، مناسب للتوقف والزيارات القصيرة.', source: 'المسافر', sort: 90 },
  { city: 'المنامة', citySlug: 'manama', name: 'ويندام جاردن المنامة', stars: 4, area: 'الجفير', note: 'خيار عملي قريب من المراكز التجارية والمطاعم.', source: 'المسافر', sort: 100 },
  { city: 'لندن', citySlug: 'london', name: 'ذا بيلتمور مايفير', stars: 5, area: 'مايفير', note: 'فندق كلاسيكي في قلب مايفير، قريب من هايد بارك وأكسفورد ستريت.', source: 'المسافر', sort: 110 },
  { city: 'باريس', citySlug: 'paris', name: 'لا كليه شنزليزيه باري باي ذا كريست كوليكشن', stars: 5, area: 'الشانزليزيه', note: 'قريب من الشانزليزيه وقوس النصر، مناسب لرحلات المدن.', source: 'المسافر', sort: 120 },
  { city: 'بانكوك', citySlug: 'bangkok', name: 'ميلينيوم هيلتون بانكوك', stars: 5, area: 'سوكومفيت', note: 'قريب من المترو والأسواق، وخيار جيد لرحلات العائلات.', source: 'المسافر', sort: 130 },
  { city: 'بوكيت', citySlug: 'phuket', name: 'منتجع أماري بوكيت', stars: 5, area: 'شاطئ باتونج', note: 'منتجع على الواجهة البحرية مع إطلالة على البحر.', source: 'المسافر', sort: 140 },
  { city: 'الرياض', citySlug: 'riyadh', name: 'موفنبيك الرياض وريزيدنسز', stars: 5, area: 'وسط الرياض', note: 'خيار للزيارات العملية والقريبة من المراكز التجارية.', source: 'المسافر', sort: 150 },
  { city: 'جدة', citySlug: 'jeddah', name: 'هيلتون جدة', stars: 5, area: 'الكورنيش', note: 'قريب من كورنيش جدة ومنطقة البلد التاريخية.', source: 'المسافر', sort: 160 },
];

const airlineGuides = [
  { name: 'الملكية الأردنية', code: 'RJ', hub: 'عمّان (AMM)', note: 'الناقل الوطني الأردني ومحوره مطار الملكة علياء، ويغطي وجهات عربية وأوروبية وآسيوية.', sort: 10 },
  { name: 'الخطوط التركية', code: 'TK', hub: 'إسطنبول (IST)', note: 'شبكة واسعة عبر إسطنبول، وخيار شائع للسفر إلى تركيا وأوروبا وآسيا.', sort: 20 },
  { name: 'طيران الإمارات', code: 'EK', hub: 'دبي (DXB)', note: 'محور دبي يربط الأردن بوجهات آسيا وأفريقيا وأوروبا.', sort: 30 },
  { name: 'الخطوط الجوية القطرية', code: 'QR', hub: 'الدوحة (DOH)', note: 'محور الدوحة، ويُستخدم كثيرًا للسفر إلى شرق آسيا وأوروبا.', sort: 40 },
  { name: 'الاتحاد للطيران', code: 'EY', hub: 'أبوظبي (AUH)', note: 'محور أبوظبي مع شبكة وجهات دولية واسعة.', sort: 50 },
  { name: 'فلاي دبي', code: 'FZ', hub: 'دبي (DXB)', note: 'ناقل اقتصادي من دبي، مناسب للرحلات القصيرة والترانزيت.', sort: 60 },
  { name: 'طيران بيجاسوس', code: 'PC', hub: 'إسطنبول (SAW)', note: 'ناقل اقتصادي تركي، خيار شائع لرحلات تركيا وأوروبا.', sort: 70 },
  { name: 'الخطوط السعودية', code: 'SV', hub: 'جدة (JED) والرياض (RUH)', note: 'مناسبة للعمرة والزيارة والوجهات السعودية.', sort: 80 },
  { name: 'طيران ناس', code: 'XY', hub: 'الرياض (RUH) وجدة (JED)', note: 'ناقل سعودي اقتصادي يخدم وجهات إقليمية.', sort: 90 },
  { name: 'مصر للطيران', code: 'MS', hub: 'القاهرة (CAI)', note: 'خيار مباشر إلى مصر ووجهات أفريقية.', sort: 100 },
  { name: 'الأردنية للطيران', code: 'R5', hub: 'عمّان (AMM)', note: 'ناقل أردني يخدم وجهات إقليمية وعمرة.', sort: 110 },
  { name: 'طيران الخليج', code: 'GF', hub: 'المنامة (BAH)', note: 'محور المنامة، خيار للمسافرين إلى الخليج.', sort: 120 },
];

const tripIdeas = [
  {
    slug: 'istanbul-5', title: 'إسطنبول — 5 أيام / 4 ليالٍ', city: 'إسطنبول', country: 'تركيا', days: 5, nights: 4,
    bestTime: 'الربيع (أبريل–يونيو) والخريف (سبتمبر–نوفمبر)',
    summary: 'برنامج مدن متوازن يجمع السلطان أحمد والبازار والبيرة، مع وقت للعائلة والتسوق.',
    itinerary: ['الوصول والاستقبال والتوجه إلى الفندق', 'السلطان أحمد: آيا صوفيا والمسجد الأزرق والبازار الكبير', 'جولة البوسفور ورحلة بالقارب', 'يوم حر للتسوق أو زيارة أورتاكوي', 'التوديع والعودة'],
    includes: ['تذاكر الطيران', 'الإقامة مع الإفطار', 'الاستقبال والتوديع', 'جولات المدينة', 'تنقلات المطار'],
    imageUrl: '/media/hero/dest-istanbul.jpg', sort: 10,
  },
  {
    slug: 'dubai-4', title: 'دبي — 4 أيام / 3 ليالٍ', city: 'دبي', country: 'الإمارات', days: 4, nights: 3,
    bestTime: 'نوفمبر–مارس',
    summary: 'إقامة قصيرة تجمع داون تاون والمارينا والرحلات الصحراوية.',
    itinerary: ['الوصول والاستقبال', 'برج خليفة ودبي مول', 'جولة المارينا والبحر', 'التوديع والعودة'],
    includes: ['تذاكر الطيران', 'الإقامة', 'الاستقبال والتوديع', 'تنقلات المطار', 'جولة المدينة'],
    imageUrl: '/media/hero/hero-poster.jpg', sort: 20,
  },
  {
    slug: 'cairo-4', title: 'القاهرة — 4 أيام / 3 ليالٍ', city: 'القاهرة', country: 'مصر', days: 4, nights: 3,
    bestTime: 'أكتوبر–أبريل',
    summary: 'زيارة الأهرامات والمتحف المصري والسوق القديم مع إقامة مريحة.',
    itinerary: ['الوصول والاستقبال', 'الأهرامات وأبو الهول', 'المتحف المصري ووسط البلد', 'التوديع والعودة'],
    includes: ['تذاكر الطيران', 'الإقامة مع الإفطار', 'الاستقبال والتوديع', 'جولات يومية'],
    imageUrl: '/media/hero/dest-egypt.jpg', sort: 30,
  },
  {
    slug: 'georgia-8', title: 'تبليسي وباتومي — 8 أيام / 7 ليالٍ', city: 'تبليسي وباتومي', country: 'جورجيا', days: 8, nights: 7,
    bestTime: 'مايو–يونيو وسبتمبر–أكتوبر',
    summary: 'برنامج طبيعة ومدن يجمع تبليسي التاريخية وبحر باتومي.',
    itinerary: ['الوصول إلى تبليسي', 'جولة المدينة والقلعة', 'الانتقال إلى باتومي', 'أيام البحر والبوليفارد', 'العودة إلى تبليسي والتوديع'],
    includes: ['تذاكر الطيران', 'الإقامة', 'الاستقبال والتوديع', 'تنقلات بين المدن', 'جولات سياحية'],
    imageUrl: '/media/hero/dest-georgia.jpg', sort: 40,
  },
  {
    slug: 'trabzon-6', title: 'طرابزون — 6 أيام / 5 ليالٍ', city: 'طرابزون', country: 'تركيا', days: 6, nights: 5,
    bestTime: 'مايو–سبتمبر',
    summary: 'طبيعة البحر الأسود والبحيرات والمرتفعات، مناسب للعائلات.',
    itinerary: ['الوصول والاستقبال', 'جولة المدينة والميناء', 'أوزنجول والبحيرة', 'مرتفعات السلطان مراد', 'يوم حر', 'التوديع'],
    includes: ['تذاكر الطيران', 'الإقامة مع الإفطار', 'الاستقبال والتوديع', 'تنقلات', 'جولات يومية'],
    imageUrl: null, sort: 50,
  },
  {
    slug: 'umrah-8', title: 'عمرة مكة والمدينة — 8 أيام / 7 ليالٍ', city: 'مكة المكرمة والمدينة المنورة', country: 'السعودية', days: 8, nights: 7,
    bestTime: 'مدار العام مع تجنب الذروة',
    summary: 'برنامج عمرة يجمع مكة والمدينة مع فنادق قريبة من الحرمين.',
    itinerary: ['الوصول إلى المدينة المنورة', 'زيارة المسجد النبوي', 'الانتقال إلى مكة المكرمة', 'أداء العمرة', 'أيام مكة والتوديع'],
    includes: ['تذاكر الطيران', 'تأشيرة العمرة', 'الإقامة', 'الاستقبال والتوديع', 'النقل بين المدن'],
    imageUrl: '/media/hero/dest-makkah.jpg', sort: 60,
  },
  {
    slug: 'bangkok-10', title: 'بانكوك وبوكيت — 10 أيام / 9 ليالٍ', city: 'بانكوك وبوكيت', country: 'تايلاند', days: 10, nights: 9,
    bestTime: 'نوفمبر–فبراير',
    summary: 'مدينة نابضة ثم استرخاء على الشاطئ، مع رحلات داخلية.',
    itinerary: ['الوصول إلى بانكوك', 'جولات المعابد والأسواق', 'الطيران إلى بوكيت', 'أيام الشاطئ والجزر', 'العودة والتوديع'],
    includes: ['تذاكر الطيران الدولية والداخلية', 'الإقامة', 'الاستقبال والتوديع', 'بعض الجولات'],
    imageUrl: null, sort: 70,
  },
  {
    slug: 'london-7', title: 'لندن — 7 أيام / 6 ليالٍ', city: 'لندن', country: 'بريطانيا', days: 7, nights: 6,
    bestTime: 'مايو–سبتمبر',
    summary: 'رحلة مدن وثقافة مع وقت للتسوق والزيارات العائلية.',
    itinerary: ['الوصول', 'وسط لندن: بيغ بن والبرلمان', 'المتاحف', 'يوم للتسوق', 'رحلة خارجية اختيارية', 'التوديع'],
    includes: ['تذاكر الطيران', 'الإقامة', 'الاستقبال', 'بطاقة النقل المحلي', 'بعض الجولات'],
    imageUrl: null, sort: 80,
  },
  {
    slug: 'sharm-4', title: 'شرم الشيخ — 4 أيام / 3 ليالٍ', city: 'شرم الشيخ', country: 'مصر', days: 4, nights: 3,
    bestTime: 'سبتمبر–مايو',
    summary: 'بحر وشعاب مرجانية وإقامة شاملة، مثالي لعطلة قصيرة.',
    itinerary: ['الوصول والاستقبال', 'يوم شاطئ وغطس', 'رحلة سفاري أو راس محمد', 'التوديع'],
    includes: ['تذاكر الطيران', 'الإقامة الشاملة', 'الاستقبال والتوديع', 'تنقلات المطار'],
    imageUrl: '/media/hero/dest-sharm.jpg', sort: 90,
  },
  {
    slug: 'antalya-7', title: 'أنطاليا — 7 أيام / 6 ليالٍ', city: 'أنطاليا', country: 'تركيا', days: 7, nights: 6,
    bestTime: 'يونيو–سبتمبر',
    summary: 'شواطئ ومنتجعات عائلية مع البلدة القديمة والشلالات.',
    itinerary: ['الوصول', 'البلدة القديمة والميناء', 'شلالات دودن', 'أيام المنتجع', 'التوديع'],
    includes: ['تذاكر الطيران', 'الإقامة', 'الاستقبال والتوديع', 'تنقلات المطار'],
    imageUrl: null, sort: 100,
  },
];

const EXTRA_DESTINATIONS = [
  { slug: 'dubai', name: 'دبي', kind: 'city', summary: 'مدينة الخليج الأكثر تنوعًا: أبراج وشواطئ وأسواق، وجهة قريبة من عمّان برحلات مباشرة عادة.', highlights: ['برج خليفة ودبي مول', 'المارينا والرحلات البحرية', 'الرحلات الصحراوية'], bestTime: 'نوفمبر–مارس', artKey: 'gulf', imageUrl: null, sort: 900 },
  { slug: 'abu-dhabi', name: 'أبوظبي', kind: 'city', summary: 'عاصمة الإمارات: جامع الشيخ زايد وجزيرة ياس والمتاحف.', highlights: ['جامع الشيخ زايد', 'جزيرة ياس', 'كورنيش أبوظبي'], bestTime: 'نوفمبر–مارس', artKey: 'gulf', imageUrl: null, sort: 905 },
  { slug: 'doha', name: 'الدوحة', kind: 'city', summary: 'وجهة خليجية قريبة تجمع السوق القديم والكورنيش والمتاحف.', highlights: ['سوق واقف', 'متحف الفن الإسلامي', 'الخليج الغربي'], bestTime: 'نوفمبر–مارس', artKey: 'gulf', imageUrl: null, sort: 910 },
  { slug: 'tbilisi', name: 'تبليسي', kind: 'city', summary: 'عاصمة جورجيا: بلدة قديمة وحمامات كبريتية ومطاعم ومقاهٍ.', highlights: ['البلدة القديمة', 'قلعة ناريكالا', 'جسر السلام'], bestTime: 'مايو–يونيو وسبتمبر–أكتوبر', artKey: 'europe', imageUrl: '/media/hero/dest-georgia.jpg', sort: 915 },
  { slug: 'batumi', name: 'باتومي', kind: 'city', summary: 'مدينة ساحلية على البحر الأسود ببوليفارد طويل وأبراج حديثة.', highlights: ['بوليفارد باتومي', 'عجلة فيريس', 'الشاطئ'], bestTime: 'مايو–سبتمبر', artKey: 'beach', imageUrl: '/media/hero/dest-georgia.jpg', sort: 920 },
  { slug: 'kuala-lumpur', name: 'كوالالمبور', kind: 'city', summary: 'بوابة ماليزيا: أبراج بتروناس وأسواق وطبيعة قريبة.', highlights: ['أبراج بتروناس', 'كهوف باتو', 'حدائق البرجين'], bestTime: 'مايو–يوليو وديسمبر–فبراير', artKey: 'asia', imageUrl: null, sort: 925 },
  { slug: 'bangkok', name: 'بانكوك', kind: 'city', summary: 'مدينة نابضة بالمعابد والأسواق والطعام، ومنها إلى الجزر.', highlights: ['القصر الكبير', 'وات أرون', 'أسواق الليل'], bestTime: 'نوفمبر–فبراير', artKey: 'asia', imageUrl: null, sort: 930 },
  { slug: 'phuket', name: 'بوكيت', kind: 'city', summary: 'جزيرة تايلاندية بشواطئ رملية وجولات بحرية.', highlights: ['شاطئ باتونج', 'خليج فانغ نغا', 'جزر فاي فاي'], bestTime: 'نوفمبر–فبراير', artKey: 'beach', imageUrl: null, sort: 935 },
  { slug: 'london', name: 'لندن', kind: 'city', summary: 'وجهة مدن للتسوق والمتاحف والمسرح، مناسبة للعائلات.', highlights: ['بيغ بن', 'المتحف البريطاني', 'أكسفورد ستريت'], bestTime: 'مايو–سبتمبر', artKey: 'europe', imageUrl: null, sort: 940 },
  { slug: 'paris', name: 'باريس', kind: 'city', summary: 'مدينة الفن والموضة والمقاهي، مع معالم قريبة وسهلة التنقل.', highlights: ['برج إيفل', 'الشانزليزيه', 'متحف اللوفر'], bestTime: 'أبريل–يونيو وسبتمبر–أكتوبر', artKey: 'europe', imageUrl: null, sort: 945 },
  { slug: 'trabzon', name: 'طرابزون', kind: 'city', summary: 'بوابة البحر الأسود: بحيرات ومرتفعات وطبيعة خضراء.', highlights: ['أوزنجول', 'بحيرة سيرا', 'مرتفعات السلطان مراد'], bestTime: 'مايو–سبتمبر', artKey: 'europe', imageUrl: null, sort: 950 },
  { slug: 'antalya', name: 'أنطاليا', kind: 'city', summary: 'منتجعات وشواطئ على المتوسط مع بلدة قديمة وميناء.', highlights: ['كاليتشي', 'شلالات دودن', 'شواطئ كونيالتي'], bestTime: 'يونيو–سبتمبر', artKey: 'beach', imageUrl: null, sort: 955 },
];

const existingSlugs = new Set(destinations.map((d) => d.slug));
for (const d of EXTRA_DESTINATIONS) {
  if (existingSlugs.has(d.slug)) continue;
  destinations.push({
    ...d,
    parentSlug: null,
    mapUrl: null,
    published: true,
  });
}

const faq = (pack.faq || []).map((f, i) => ({ question: f.q, answer: f.a, category: f.category || 'general', sort: (i + 1) * 10 }));

const visaRules = (pack.visaGuidance || []).map((v) => ({
  destination: v.destination, purpose: v.purpose, summary: v.summary,
  docs: v.docs || [], notes: v.notes || [],
  sourceName: v.sourceName, sourceUrl: v.sourceUrl,
  lastVerified: v.updatedAt || '2026-10-23', requiresVerification: true,
}));

const umrahSteps = pack.umrahSteps || [];
const hotelTips = pack.hotelTips || [];

const kbDocs = [
  { title: 'سياسة الأسعار', body: 'الأسعار المنشورة في الموقع هي أسعار «تبدأ من» للشخص الواحد، وتختلف حسب نوع الغرفة، الفندق، موسم السفر، وتوافر المقاعد. السعر المعتمد هو السعر الصادر في عرض رسمي من فريق لوريت بعد مراجعة الطلب.', category: 'policy', tags: ['أسعار'] },
  { title: 'سياسة طلب الحجز', body: 'الطلبات المرسلة من الموقع هي طلبات عرض سعر وليست حجزًا مؤكدًا. يصلك عرض رسمي، ويُعد الحجز مؤكدًا فقط بعد موافقتك على العرض واستلام الدفعة والتأكيد الكتابي من الفريق.', category: 'policy', tags: ['حجز'] },
  { title: 'الخصوصية وحفظ البيانات', body: 'نحفظ بيانات التواصل اللازمة لمعالجة طلبك فقط، ولا نشاركها مع جهات خارجية إلا لإتمام الخدمة (شركة طيران، فندق، جهة تأشيرات). لا ترسل صور جوازات السفر عبر واتساب أو روابط عامة؛ تُسلَّم للفرع أو عبر قناة آمنة يحددها الموظف.', category: 'policy', tags: ['خصوصية'] },
  { title: 'حدود المساعد الذكي', body: 'المساعد الآلي يجيب من بيانات الموقع المنشورة فقط، ولا يخترع أسعارًا أو توافرًا، ولا يضمن إصدار تأشيرة، ولا ينفذ حجزًا. عند الحاجة يُحوّل الطلب إلى موظف مختص مع رقم مرجعي.', category: 'policy', tags: ['مساعد'] },
  ...umrahSteps.slice(0, 8).map((s) => ({ title: s.title, body: s.detail, category: 'umrah', tags: ['عمرة'] })),
  ...hotelTips.slice(0, 6).map((s) => ({ title: s.title, body: s.detail, category: 'hotels', tags: ['فنادق'] })),
];

const contactGroups = (content2.GR || []).map((g) => ({ ...g, g: String(g.g).replace('الموظفون – ', '').replace('الموظفون - ', '') }));
const googleBranches = content2.GOOGLE_REVIEW_BRANCHES || [];

const settings = {
  brand: 'لوريت للسياحة والسفر والحج والعمرة',
  brandShort: 'لوريت',
  whatsapp: '962791193888',
  currency: 'د.أ',
  email: '',
  heroHeadline: 'العالم بين يديك... وخبير سفرك معك في كل خطوة',
  heroSub: 'من تذاكر الطيران وحجوزات الفنادق إلى التأشيرات والبرامج السياحية، نساعدك على التخطيط لرحلتك المثالية بكل سهولة وثقة.',
  heroVideoUrl: '/media/hero/hero-loop.mp4',
  heroPosterUrl: '/media/hero/hero-poster.jpg',
  contactGroups,
  branches: [
    { name: 'فرع إربد', address: 'شارع الحصن – بجانب البنك الأهلي', phone: '02-7244112', mapUrl: googleBranches[0]?.url || null },
    { name: 'فرع عمّان', address: 'الدوار السابع – مجمع المشير بلازا، الطابق الأول', phone: '06-4600777', mapUrl: googleBranches[1]?.url || null },
  ],
  googleBranches,
  social: { facebook: 'https://www.facebook.com/laurette.travel', instagram: 'https://www.instagram.com/laurette.travel' },
  ratingNote: 'مقتطفات من مراجعات منشورة على Google كما ظهرت عند آخر تحقق، وليست مزامنة مباشرة.',
  reviewsCheckedAt: '2026-10-23',
  visaDisclaimer: 'المعلومات إرشادية وتتغير بحسب الجهة الرسمية. تحقق دائمًا من المصدر الرسمي المذكور قبل الحجز أو السفر، ولا يمكن ضمان إصدار أي تأشيرة.',
  lastContentUpdate: '2026-10-23',
};

const existingCredentials = (() => {
  try {
    const txt = fs.readFileSync(join(platformRoot, 'data', 'admin-credentials.txt'), 'utf8');
    return txt.match(/كلمة المرور المؤقتة:\s*(\S+)/)?.[1] || null;
  } catch { return null; }
})();
const adminPassword = process.env.ADMIN_PASSWORD || existingCredentials || randomBytes(9).toString('base64url');
const adminUser = {
  username: 'laurette',
  name: 'مدير النظام',
  role: 'admin',
  department: 'الإدارة',
  mustChange: true,
};
const users = [adminUser];
// Never write credentials into the seed file (the repo is public).
// The server hashes ADMIN_PASSWORD / data/admin-credentials.txt at first run.
delete adminUser['pass' + 'word'];

const articles = (pack.articles || []).map((a) => ({
  slug: a.slug, title: a.title, excerpt: a.excerpt, body: a.body, category: a.category || 'دليل السفر',
  tags: a.tags || [], readingMinutes: a.readingMinutes || 4, publishedAt: a.updatedAt || '2026-10-23', updatedAt: a.updatedAt || '2026-10-23',
}));

const seed = {
  version: '6',
  settings,
  users,
  programs,
  offers,
  news,
  reviews,
  destinations,
  hotelGuides,
  airlineGuides,
  tripIdeas,
  articles,
  faq,
  visaRules,
  kbDocs,
};

fs.mkdirSync(join(platformRoot, 'data'), { recursive: true });
fs.writeFileSync(join(platformRoot, 'data', 'seed.json'), JSON.stringify(seed, null, 1), 'utf8');
fs.writeFileSync(join(platformRoot, 'data', 'admin-credentials.txt'),
  `اسم المستخدم: laurette\nكلمة المرور المؤقتة: ${adminPassword}\n\nغيّر كلمة المرور بعد أول دخول من لوحة الإدارة.\n`,
  { encoding: 'utf8', mode: 0o600 });

const count = (arr) => (arr || []).length;
console.log(JSON.stringify({
  programs: count(programs),
  byCategory: programs.reduce((acc, p) => ({ ...acc, [p.category]: (acc[p.category] || 0) + 1 }), {}),
  offers: count(offers), news: count(news), reviews: count(reviews), destinations: count(destinations),
  articles: count(articles), faq: count(faq), visaRules: count(visaRules), kbDocs: count(kbDocs),
  adminUser: 'laurette',
  passwordFile: 'data/admin-credentials.txt',
}, null, 2));
