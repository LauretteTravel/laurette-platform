import { one, q, exec } from './db.js';
import { normalizeArabic, tokens, overlapScore, isoNow, money } from './util.js';
import { hydrateProgram } from './domain.js';

const GREETING = /^(مرحبا|مرحباً|هلا|اهلا|أهلا|السلام|سلام|صباح|مساء|hello|hi|hey)/;
const HUMAN = ['موظف', 'انسان', 'بشري', 'شخص', 'واتساب', 'اتصل', 'رقم', 'مستشار', 'خبير', 'حجز مباشر', 'agent', 'human', 'whatsapp'];
const VISA = ['فيزا', 'تاشيره', 'تاشيرات', 'تأشيرة', 'تأشيرات', 'visa', 'تاشيره', 'اقامه', 'إقامة'];
const UMRAH = ['عمره', 'عمرة', 'معتمر', 'مناسك', 'الحرم', 'مكه', 'مكة', 'المدينه', 'المدينة', 'حج', 'umrah', 'hajj', 'makkah', 'madinah'];
const FLIGHT = ['طيران', 'تذكره', 'تذكرة', 'تذاكر', 'رحله', 'رحلة', 'مطار', 'طياره', 'طائرة', 'flight', 'ticket', 'airline'];
const HOTEL = ['فندق', 'فنادق', 'اقامه', 'إقامة', 'غرفه', 'غرفة', 'نوم', 'hotel', 'room', 'stay'];
const HONEYMOON = ['شهر عسل', 'عرس', 'زفاف', 'honeymoon', 'wedding'];
const FAMILY = ['عائله', 'عائلة', 'اطفال', 'أطفال', 'عيال', 'family', 'kids'];
const BUDGET = ['ميزانيه', 'ميزانية', 'دينار', 'دينار', 'سعر', 'اسعار', 'أسعار', 'كم', 'تكلفه', 'تكلفة', 'budget', 'price', 'cost'];
const TRIP = ['بدي اسافر', 'بدي أسافر', 'نفسي اسافر', 'ناوي اسافر', 'ناوي أسافر', 'اريد السفر', 'أريد السفر', 'نرغب بالسفر', 'رحله سياحيه', 'رحلة سياحية', 'تخطيط رحله', 'تخطيط رحلة', 'plan a trip', 'book a trip', 'travel package'];
const GUARANTEE = ['مضمون', 'مضمونه', 'ضمان', 'تضمن', 'تضمنون', 'ضامن', 'اكيد', 'مؤكد', 'guarantee', 'guaranteed', 'approval'];

const DESTINATIONS = [
  { keys: ['تركيا', 'اسطنبول', 'إسطنبول', 'انطاليا', 'طرابزون', 'تركيا', 'turkey', 'istanbul', 'antalya'], label: 'تركيا', categories: ['istanbul'] },
  { keys: ['مصر', 'شرم', 'الغردقه', 'الغردقة', 'القاهره', 'القاهرة', 'الجونه', 'الجونة', 'egypt', 'sharm', 'hurghada', 'cairo'], label: 'مصر', categories: ['sharm'] },
  { keys: ['السعوديه', 'السعودية', 'مكه', 'مكة', 'المدينه', 'المدينة', 'جده', 'جدة', 'saudi', 'makkah', 'madinah', 'jeddah'], label: 'السعودية', categories: ['umrah'] },
  { keys: ['كروز', 'سفينه', 'سفينة', 'بحريه', 'بحرية', 'cruise', 'ship'], label: 'رحلات الكروز', categories: ['cruise'] },
  { keys: ['اوروبا', 'أوروبا', 'باريس', 'مالديف', 'europe', 'paris', 'maldives'], label: 'أوروبا والمالديف', categories: ['europe', 'asia'] },
  { keys: ['الخليج', 'دبي', 'قطر', 'الكويت', 'gulf', 'dubai', 'qatar'], label: 'دول الخليج', categories: ['gulf'] },
  { keys: ['شرق اسيا', 'شرق آسيا', 'ماليزيا', 'اندونيسيا', 'إندونيسيا', 'asia', 'malaysia', 'indonesia'], label: 'شرق آسيا', categories: ['asia'] },
];

function hasAny(text, words) {
  return words.some((w) => text.includes(normalizeArabic(w)));
}

function extractBudget(text) {
  const m = text.match(/(\d{3,6})\s*(?:دينار|د\.?أ|jod|jd)/i) || text.match(/(?:ميزانيه|ميزانية|budget)[^\d]{0,12}(\d{3,6})/i);
  if (m) return Number(m[1]);
  const bare = text.match(/\b(\d{3,5})\b/);
  return bare ? Number(bare[1]) : 0;
}

function listPrograms(programs, limit = 3) {
  return programs.slice(0, limit).map((p) => {
    const hotels = (p.hotels || []).map((h) => h.name).filter(Boolean).slice(0, 2).join(' / ');
    const facts = [p.days ? `${p.days} أيام / ${p.nights} ليالٍ` : '', hotels ? `الإقامة: ${hotels}` : '', p.meals ? `الوجبات: ${p.meals}` : '']
      .filter(Boolean).join(' · ');
    return `• ${p.title}\n   ${facts}\n   يبدأ من ${money(p.price_from, p.currency)} للشخص`;
  }).join('\n');
}

function categoryPrograms(db, categories, limit = 12) {
  const marks = categories.map(() => '?').join(',');
  return q(db, `SELECT * FROM programs WHERE category IN (${marks}) AND status IN ('published','sold_out')
      ORDER BY featured DESC, price_from ASC LIMIT ?`, [...categories, limit]).map(hydrateProgram);
}

function contactBlock(db) {
  const groups = one(db, "SELECT value FROM settings WHERE key = 'contactGroups'");
  let parsed = [];
  try { parsed = groups ? JSON.parse(groups.value) : []; } catch { parsed = []; }
  const first = parsed[0]?.items?.[0]?.p;
  const wa = one(db, "SELECT value FROM settings WHERE key = 'whatsapp'");
  const waNum = wa ? JSON.parse(wa.value) : first;
  return {
    phone: first ? `0${String(first).slice(3)}` : '',
    whatsapp: waNum ? `https://wa.me/${String(waNum).replace(/\D/g, '')}` : '/consult',
  };
}

function policyLines(db) {
  const rows = q(db, "SELECT title, body FROM kb_docs WHERE active = 1 AND category = 'policy' ORDER BY id LIMIT 4");
  return rows.map((r) => `• ${r.title}: ${r.body}`);
}

export function logMessage(db, sessionId, role, content, intent = null, sources = null) {
  if (!sessionId) return;
  exec(db, 'INSERT INTO assistant_messages (session_id, role, content, intent, sources, created_at) VALUES (?,?,?,?,?,?)',
    [sessionId, role, String(content).slice(0, 4000), intent, sources ? JSON.stringify(sources).slice(0, 2000) : null, isoNow()]);
  exec(db, 'UPDATE assistant_sessions SET last_at = ? WHERE id = ?', [isoNow(), sessionId]);
}

export function ensureSession(db, sid, consent) {
  if (!sid) return null;
  let row = one(db, 'SELECT * FROM assistant_sessions WHERE sid = ?', [sid]);
  if (!row) {
    exec(db, 'INSERT INTO assistant_sessions (sid, consent, created_at, last_at) VALUES (?,?,?,?)', [sid, consent ? 1 : 0, isoNow(), isoNow()]);
    row = one(db, 'SELECT * FROM assistant_sessions WHERE sid = ?', [sid]);
  } else if (consent && !row.consent) {
    exec(db, 'UPDATE assistant_sessions SET consent = 1 WHERE id = ?', [row.id]);
    row.consent = 1;
  }
  return row;
}

export function answer(db, message, { sessionId = null, consent = false } = {}) {
  const raw = String(message || '').slice(0, 1000).trim();
  const text = normalizeArabic(raw);
  const queryTokens = tokens(raw);
  const sources = [];
  const suggestions = [];
  const contacts = contactBlock(db);

  if (!raw) {
    return { reply: 'أهلًا بك في لوريت. اكتب استفسارك وسأساعدك في البرامج والتأشيرات والطيران والفنادق.', intent: 'empty', sources, suggestions: ['برامج العمرة', 'عروض إسطنبول', 'متطلبات التأشيرة'] };
  }

  // 1) Explicit human handoff
  if (hasAny(text, HUMAN)) {
    return {
      reply: `بكل سرور، فريق لوريت جاهز لمساعدتك مباشرة.\n• واتساب: ${contacts.whatsapp}\n• الهاتف: ${contacts.phone || 'حسب أرقام الفروع'}\nويمكنك أيضًا إرسال استشارة من صفحة «اسأل خبير لوريت» ليصل طلبك إلى القسم المختص مع رقم مرجعي.`,
      intent: 'handoff',
      sources,
      suggestions: ['أرسل استشارة', 'برامج العمرة', 'عروض خاصة'],
    };
  }

  // 2) Guarantee / visa approval questions must never be promised
  if (hasAny(text, GUARANTEE) && hasAny(text, VISA)) {
    return {
      reply: 'لا يمكن لأي جهة ضمان إصدار التأشيرة؛ القرار النهائي يعود للجهة الرسمية في الدولة المقصودة.\nدورنا تجهيز الملف ومراجعته قبل التقديم وتقليل أسباب الرفض الشائعة، ويصلك عرض واضح بالمتطلبات والرسوم قبل أي التزام.',
      intent: 'visa-guarantee',
      sources: [{ label: 'مركز التأشيرات', url: '/visa' }],
      suggestions: ['متطلبات التأشيرة', 'طلب مراجعة تأشيرة'],
    };
  }

  // 3) Visa
  if (hasAny(text, VISA)) {
    const rules = q(db, 'SELECT * FROM visa_rules WHERE published = 1');
    const found = rules.find((r) => text.includes(normalizeArabic(r.destination)) || normalizeArabic(r.destination).split(' ').some((w) => w.length > 3 && text.includes(w)));
    if (found) {
      const arr = (v) => { try { const x = JSON.parse(v); return Array.isArray(x) ? x : []; } catch { return []; } };
      const docs = arr(found.docs);
      const notes = arr(found.notes);
      return {
        reply: `تأشيرة ${found.destination} — ${found.purpose || 'سياحة'}:\n${found.summary}\n\nالمستندات الأساسية:\n${docs.map((d) => `• ${d}`).join('\n') || '• تُحدد حسب الحالة، ويراجعها الموظف معك.'}\n${notes.length ? `\nملاحظات:\n${notes.map((n) => `• ${n}`).join('\n')}\n` : ''}\nآخر تحديث للمعلومات: ${found.last_verified || 'غير محدد'} — تُعتبر معلومات إرشادية ويجب تأكيدها من المصدر الرسمي: ${found.source_name || 'الجهة الرسمية'}\n\nلا نضمن الموافقة على التأشيرة، ونراجع ملفك قبل التقديم.`,
        intent: 'visa',
        sources: [{ label: found.source_name || 'المصدر الرسمي', url: found.source_url || '/visa' }, { label: 'مركز التأشيرات', url: '/visa' }],
        suggestions: ['طلب مراجعة تأشيرة', 'رسوم التأشيرة', 'تواصل مع موظف'],
      };
    }
    return {
      reply: 'مركز التأشيرات في لوريت يغطي السعودية (عمرة)، تركيا، مصر، شنغن، والولايات المتحدة.\nأخبرني بالوجهة وجنسيتك ونوع التأشيرة، أو أرسل طلب مراجعة ليصلك رد من القسم المختص مع رقم مرجعي.\nلن نؤكد أي متطلب دون التحقق من المصدر الرسمي وتاريخ التحديث.',
      intent: 'visa',
      sources: [{ label: 'مركز التأشيرات', url: '/visa' }],
      suggestions: ['تأشيرة السعودية', 'تأشيرة تركيا', 'طلب مراجعة تأشيرة'],
    };
  }

  // 4) Umrah / Hajj
  if (hasAny(text, UMRAH)) {
    const programs = categoryPrograms(db, ['umrah'], 40);
    const levels = [
      { label: 'اقتصادي', min: 0, max: 700 },
      { label: '4 نجوم', min: 700, max: 1000 },
      { label: 'VIP خمس نجوم', min: 1000, max: 1e9 },
    ];
    const vip = /vip|فاخر|خمس/i.test(raw);
    const cheap = /اقتصادي|رخيص|ارخص|أرخص/i.test(raw) || (extractBudget(raw) > 0 && extractBudget(raw) < 900);
    let chosen = programs;
    if (vip) chosen = programs.filter((p) => Number(p.price_from) >= 1000);
    else if (cheap) chosen = programs.filter((p) => Number(p.price_from) < 800);
    chosen = chosen.slice(0, 3);
    return {
      reply: `برامج العمرة المتاحة حاليًا (${programs.length} برنامجًا منشورًا):\n${listPrograms(chosen) || 'لا توجد برامج منشورة هذه اللحظة.'}\n\nالأسعار للشخص وتختلف حسب نوع الغرفة والفندق وتواريخ المغادرة، والسعر المعتمد هو ما يصلك في عرض السعر من فريق لوريت.\nهل تفضل برنامجًا اقتصاديًا أم خمس نجوم؟ وكم عدد المسافرين؟`,
      intent: 'umrah',
      sources: [{ label: 'قسم الحج والعمرة', url: '/umrah' }],
      suggestions: ['عمرة اقتصادية', 'عمرة VIP', 'مقارنة البرامج', 'طلب عمرة'],
    };
  }

  // 5) Honeymoon / family / destination / budget => recommendations
  const dest = DESTINATIONS.find((d) => hasAny(text, d.keys));
  const isHoneymoon = hasAny(text, HONEYMOON);
  const isFamily = hasAny(text, FAMILY);
  const budget = extractBudget(raw);
  const wantsTrip = !hasAny(text, FLIGHT) && !hasAny(text, HOTEL)
    && (hasAny(text, TRIP) || budget > 0 || isHoneymoon || isFamily || !!dest);

  if (wantsTrip) {
    let categories = dest ? dest.categories : ['umrah', 'istanbul', 'sharm', 'cruise'];
    if (isHoneymoon && !dest) categories = ['istanbul', 'cruise', 'sharm', 'europe'];
    if (isFamily && !dest) categories = ['sharm', 'istanbul', 'cruise'];
    let programs = categoryPrograms(db, categories, 40);
    if (budget > 0) {
      const perPerson = Math.round(budget / 2);
      const affordable = programs.filter((p) => Number(p.price_from) <= perPerson * 1.1);
      if (affordable.length) programs = affordable;
    }
    const picks = programs.slice(0, 3);
    const missing = [];
    if (!dest && !isHoneymoon && !isFamily) missing.push('الوجهة التي تفكر بها');
    if (!budget) missing.push('الميزانية التقريبية');
    if (isHoneymoon || isFamily) missing.push('عدد الأيام');

    return {
      reply: `أهلًا وسهلًا في لوريت 🌍\n${picks.length ? `هذه أقرب البرامج المنشورة لطلبك:\n${listPrograms(picks)}\n\n` : ''}${missing.length ? `لأضبط الترشيح بدقة أحتاج: ${missing.join(' · ')}.\n` : ''}الأسعار أعلاه «تبدأ من» للشخص حسب الغرفة والموسم، والسعر النهائي يصلك في عرض سعر رسمي من خبير لوريت.`,
      intent: isHoneymoon ? 'honeymoon' : isFamily ? 'family' : dest ? `destination:${dest.label}` : 'trip',
      sources: [
        { label: 'البرامج السياحية', url: `/programs?category=${encodeURIComponent(categories[0])}` },
        ...(dest ? [{ label: `برامج ${dest.label}`, url: `/destinations` }] : []),
      ],
      suggestions: ['طلب عرض سعر', 'مقارنة البرامج', 'تواصل مع خبير'],
    };
  }

  // 6) Flights
  if (hasAny(text, FLIGHT)) {
    return {
      reply: 'خدمة تذاكر الطيران في لوريت تعمل بنظام «طلب عرض سعر»: ترسل تفاصيل الرحلة، يراجعها مختص، ويصلك عرض بالسعر المتاح فعليًا من شركة الطيران.\nنحتاج: مطار المغادرة والوصول، التاريخ، عدد المسافرين، الدرجة، وأي تفضيل لشركة طيران.\n\nلا نعرض أسعارًا تقديرية غير مؤكدة، لأن سعر التذكرة يتغير حتى لحظة الإصدار.',
      intent: 'flight',
      sources: [{ label: 'طلب تذكرة طيران', url: '/flights' }],
      suggestions: ['طلب تذكرة', 'الأمتعة المسموحة', 'تعديل اسم التذكرة'],
    };
  }

  // 7) Hotels
  if (hasAny(text, HOTEL)) {
    const hotels = q(db, `SELECT * FROM programs WHERE category IN ('umrah','sharm','istanbul') AND status = 'published' ORDER BY featured DESC LIMIT 3`).map(hydrateProgram);
    const names = hotels.map((p) => (p.hotels || [])[0]?.name).filter(Boolean).slice(0, 4);
    return {
      reply: `نساعدك في طلب فندق داخل البرامج أو فندق مستقل.\n${names.length ? `من الفنادق المتاحة في برامجنا حاليًا: ${names.join(' · ')}.\n` : ''}أرسل المدينة وتواريخ الدخول والخروج وعدد الغرف والأشخاص، وسيراجع القسم التوفر والسعر ويصلك عرض رسمي.`,
      intent: 'hotel',
      sources: [{ label: 'طلب حجز فندق', url: '/hotels' }],
      suggestions: ['طلب فندق', 'فنادق قريبة من الحرم', 'تواصل مع خبير'],
    };
  }

  // 8) FAQ / knowledge base
  const faqRows = q(db, 'SELECT * FROM faq WHERE published = 1');
  let best = { score: 0, row: null };
  for (const row of faqRows) {
    const score = overlapScore(queryTokens, `${row.question} ${row.answer}`) + (queryTokens.length ? 0 : 0);
    if (score > best.score) best = { score, row };
  }
  if (best.row && best.score >= Math.max(2, Math.ceil(queryTokens.length * 0.34))) {
    return {
      reply: `${best.row.answer}\n\nهل تريد أن يتابع معك مختص من لوريت؟`,
      intent: 'faq',
      sources: [{ label: 'الأسئلة الشائعة', url: `/faq#q-${best.row.id}` }],
      suggestions: ['نعم، تواصل معي', 'طلب عرض سعر', 'أسئلة أخرى'],
    };
  }

  const kb = q(db, "SELECT * FROM kb_docs WHERE active = 1 AND category <> 'policy'");
  let kbBest = { score: 0, row: null };
  for (const row of kb) {
    const score = overlapScore(queryTokens, `${row.title} ${row.body}`);
    if (score > kbBest.score) kbBest = { score, row };
  }
  if (kbBest.row && kbBest.score >= 2) {
    return { reply: `${kbBest.row.body}\n\nالمصدر: ${kbBest.row.title}`, intent: 'kb', sources: [], suggestions: ['طلب عرض سعر', 'تواصل مع خبير'] };
  }

  if (GREETING.test(text)) {
    return {
      reply: 'أهلًا وسهلًا في لوريت للسياحة والسفر 🕋✈️\nأساعدك في: برامج العمرة والحج، عروض تركيا ومصر والكروز، تذاكر الطيران، الفنادق، ومتطلبات التأشيرات.\nعن ماذا تحب أن نسأل أولًا؟',
      intent: 'greeting',
      sources: [],
      suggestions: ['برامج العمرة', 'عروض إسطنبول', 'متطلبات التأشيرة', 'طلب عرض سعر'],
    };
  }

  return {
    reply: `لم أجد معلومة موثوقة في قاعدة معرفة لوريت تجيب عن هذا السؤال بدقة، ولن أخمّن أو أذكر سعرًا غير معتمد.\nيمكنك إرسال استشارة ليصل طلبك إلى القسم المختص مع رقم مرجعي، أو التواصل مباشرة عبر واتساب ${contacts.whatsapp}.`,
    intent: 'unknown',
    escalate: true,
    sources: [{ label: 'اسأل خبير لوريت', url: '/consult' }],
    suggestions: ['أرسل استشارة', 'تواصل عبر واتساب', 'برامج العمرة'],
  };
}

/* Optional LLM layer. Disabled unless LLM_API_URL + LLM_API_KEY are provided.
   The answer is rejected if it contains a price that is not in the retrieved context. */
export async function llmAnswer(db, message, contextText) {
  const url = process.env.LLM_API_URL;
  const key = process.env.LLM_API_KEY;
  if (!url || !key) return null;
  const system = [
    'أنت مساعد لوريت للسياحة والسفر. أجب بالعربية أو الإنجليزية حسب لغة العميل.',
    'استخدم فقط المعلومات الموجودة في السياق المرفق. لا تخترع أسعارًا أو عروضًا أو متطلبات تأشيرة.',
    'لا تضمن إصدار تأشيرة. لا تدّعِ تنفيذ حجز. عند نقص المعلومة اطلب تحويل العميل لموظف.',
    'اذكر السعر فقط إذا كان موجودًا نصًا في السياق، ووضّح أنه سعر «يبدأ من» ويحتاج تأكيدًا.',
  ].join(' ');
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: process.env.LLM_MODEL || 'gpt-4o-mini',
        temperature: 0.2,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: `السياق:\n${contextText}\n\nسؤال العميل: ${message}` },
        ],
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const data = await res.json();
    const text = data?.choices?.[0]?.message?.content?.trim();
    if (!text) return null;
    if (!groundedNumbers(text, contextText)) return null;
    return text;
  } catch {
    return null;
  }
}

export function groundedNumbers(answerText, contextText) {
  const pricePattern = /(\d[\d,]{2,})\s*(?:د\.?\s?أ|دينار|JOD|JD)/gi;
  const contextNumbers = new Set((String(contextText).match(/\d[\d,]*/g) || []).map((n) => n.replace(/,/g, '')));
  const mentioned = [...String(answerText).matchAll(pricePattern)].map((m) => m[1].replace(/,/g, ''));
  return mentioned.every((n) => contextNumbers.has(n));
}

export function contextText(db) {
  const programs = q(db, "SELECT title, category, days, nights, price_from, currency, destination, meals FROM programs WHERE status = 'published' ORDER BY price_from ASC").slice(0, 40);
  const visa = q(db, 'SELECT destination, purpose, summary, last_verified, source_name FROM visa_rules WHERE published = 1');
  const faq = q(db, 'SELECT question, answer FROM faq WHERE published = 1 LIMIT 30');
  const policies = policyLines(db).join('\n');
  return [
    ...programs.map((p) => `برنامج: ${p.title} | القسم: ${p.category} | ${p.days} أيام | يبدأ من ${p.price_from} ${p.currency} | ${p.destination || ''} | ${p.meals || ''}`),
    ...visa.map((v) => `تأشيرة ${v.destination} (${v.purpose || ''}): ${v.summary} | آخر تحديث ${v.last_verified} | المصدر ${v.source_name}`),
    ...faq.map((f) => `س: ${f.question}\nج: ${f.answer}`),
    policies,
  ].join('\n').slice(0, 12000);
}
