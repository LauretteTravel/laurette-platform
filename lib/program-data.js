import { HttpError } from "./http.js";
export const TEXT_FIELDS = [
  "title",
  "summary",
  "description",
  "destination",
  "country",
  "level",
  "art_key",
  "image_url",
  "meals",
  "airline",
  "departure_dates",
  "mode",
  "route",
];
export const LIST_FIELDS = [
  "hotels",
  "itinerary",
  "includes",
  "excludes",
  "terms",
  "flights",
  "options",
  "badges",
];
export const PUBLIC_FIELDS = [
  "slug",
  "category",
  ...TEXT_FIELDS,
  "days",
  "nights",
  "price_from",
  "currency",
  "featured",
  ...LIST_FIELDS,
  "sort",
];
export const REVIEW_CHECKS = [
  "source",
  "prices",
  "basis",
  "currencies",
  "dates",
  "conditions",
];
export const priceBasisLabel = (p) =>
  ({ person: "للفرد", room: "للغرفة", booking: "للحجز" })[p.price_basis] ||
  "للشخص";
const fail = (message) => {
  throw new HttpError(422, message);
};
export const ammanToday = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Amman",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
function date(v) {
  if (v == null || v === "") return "";
  if (
    typeof v !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(v) ||
    !Number.isFinite(Date.parse(v)) ||
    new Date(v).toISOString().slice(0, 10) !== v
  )
    fail("تاريخ غير صالح؛ استخدم YYYY-MM-DD");
  return v;
}
function text(v, max = 8000) {
  if (v == null) return "";
  if (typeof v !== "string" || v.length > max)
    fail("نص غير صالح أو أطول من الحد المسموح");
  return v.trim();
}
function amount(v) {
  if (
    typeof v !== "number" ||
    !Number.isFinite(v) ||
    v < 0 ||
    v > 10000000 ||
    Math.abs(v * 1000 - Math.round(v * 1000)) > 0.00001
  )
    fail("السعر يجب أن يكون رقمًا غير سالب حتى 3 منازل عشرية");
  return v;
}
export function legacyProgram(row) {
  const d = {};
  for (const k of PUBLIC_FIELDS) {
    d[k] = row[k];
    if (LIST_FIELDS.includes(k)) {
      try {
        d[k] = JSON.parse(row[k]);
      } catch {
        d[k] = [];
      }
    }
  }
  return {
    ...d,
    pricing: [],
    display_price: 0,
    valid_from: "",
    valid_until: "",
    travel_start: "",
    travel_end: "",
    public_status: row.status === "sold_out" ? "sold_out" : "published",
  };
}
export function programData(input, slug, { complete = false } = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input))
    fail("بيانات البرنامج مطلوبة");
  const d = { slug, category: text(input.category, 80) };
  for (const k of TEXT_FIELDS) d[k] = text(input[k]);
  if (!d.title || !d.category) fail("عنوان البرنامج وتصنيفه مطلوبان");
  for (const k of ["days", "nights", "sort"]) {
    const v = input[k] ?? (k === "sort" ? 100 : null);
    if (v !== null && (!Number.isInteger(v) || v < 0 || v > 10000))
      fail("عدد أيام أو ليال أو ترتيب غير صالح");
    d[k] = v;
  }
  d.featured = input.featured === true || input.featured === 1 ? 1 : 0;
  if (d.image_url && !/^\/media\/[a-zA-Z0-9/_ .-]+$/.test(d.image_url))
    fail("استخدم صورة من مكتبة الوسائط المحلية");
  for (const k of LIST_FIELDS) {
    const v = input[k] ?? [];
    if (!Array.isArray(v) || v.length > 60) fail("القوائم محدودة بـ60 عنصرًا");
    if (JSON.stringify(v).length > 20000) fail("قائمة طويلة جدًا");
    d[k] = JSON.parse(JSON.stringify(v));
  }
  for (const [k, rows] of Object.entries(d).filter(([k]) =>
    LIST_FIELDS.includes(k),
  ))
    for (const row of rows) {
      if (k === "hotels") {
        if (
          !row ||
          typeof row !== "object" ||
          Array.isArray(row) ||
          typeof row.name !== "string" ||
          !row.name ||
          !Number.isInteger(row.stars ?? 0) ||
          (row.stars ?? 0) < 0 ||
          (row.stars ?? 0) > 5
        )
          fail("فندق غير صالح؛ النجوم من 0 إلى 5");
      } else if (k === "options") {
        if (
          !row ||
          typeof row !== "object" ||
          typeof row.label !== "string" ||
          typeof row.price !== "number" ||
          !Number.isFinite(row.price)
        )
          fail("خيار قديم غير صالح");
      } else if (typeof row !== "string" || row.length > 8000)
        fail("بنود الرحلة والشروط يجب أن تكون نصوصًا");
    }
  if (!Array.isArray(input.pricing ?? []) || (input.pricing ?? []).length > 30)
    fail("حد خيارات التسعير 30");
  d.pricing = (input.pricing ?? []).map((p) => {
    if (!p || typeof p !== "object" || Array.isArray(p))
      fail("خيار سعر غير صالح");
    const r = {
      label: text(p.label, 150),
      sale: amount(p.sale),
      cost: p.cost == null ? null : amount(p.cost),
      currency: text(p.currency, 3),
      basis: p.basis,
      occupancy: p.occupancy,
    };
    if (
      !r.label ||
      !["JOD", "USD", "EUR", "SAR", "AED", "TRY", "EGP", "GBP"].includes(
        r.currency,
      ) ||
      !["person", "room", "booking"].includes(r.basis) ||
      !["single", "double", "triple", "quad", "na"].includes(r.occupancy)
    )
      fail("حدد وصف السعر والعملة وأساسه والإشغال بشكل صريح");
    return r;
  });
  d.display_price = input.display_price ?? 0;
  if (
    !Number.isInteger(d.display_price) ||
    d.display_price < 0 ||
    (d.pricing.length && d.display_price >= d.pricing.length)
  )
    fail("اختر صف سعر العرض");
  // Legacy unreviewed prices stay private until explicit, structured repricing at approval.
  d.price_from = input.price_from == null ? null : amount(input.price_from);
  d.currency = text(input.currency ?? "JOD", 12);
  for (const k of ["valid_from", "valid_until", "travel_start", "travel_end"])
    d[k] = date(input[k]);
  d.public_status = input.public_status ?? "published";
  if (!["published", "sold_out"].includes(d.public_status))
    fail("حالة العرض العامة غير صالحة");
  if (d.valid_from && d.valid_until && d.valid_from > d.valid_until)
    fail("بداية صلاحية السعر بعد نهايتها");
  if (d.travel_start && d.travel_end && d.travel_start > d.travel_end)
    fail("بداية السفر بعد نهايته");
  if (complete) {
    if (
      !d.destination ||
      !d.pricing.length ||
      !d.valid_from ||
      !d.valid_until ||
      !d.travel_start ||
      !d.travel_end ||
      !d.terms.length
    )
      fail(
        "للاعتماد: الوجهة والأسعار والشروط وصلاحية السعر وفترة السفر مطلوبة",
      );
    if (
      d.valid_until < ammanToday() ||
      d.travel_end < ammanToday() ||
      d.valid_until > d.travel_end
    )
      fail("العرض منتهي أو صلاحية السعر تتجاوز نهاية السفر");
  }
  return d;
}
export function publicValues(d) {
  const selected = d.pricing[d.display_price];
  const basis = { person: "للفرد", room: "للغرفة", booking: "للحجز" },
    occ = {
      single: "مفرد",
      double: "مزدوج",
      triple: "ثلاثي",
      quad: "رباعي",
      na: "غير منطبق",
    };
  const out = {
    ...d,
    price_from: selected.sale,
    currency: selected.currency,
    options: d.pricing.map((p) => ({
      label: `${p.label} — ${basis[p.basis]} / ${occ[p.occupancy]} (${p.currency})`,
      price: p.sale,
      currency: p.currency,
      basis: p.basis,
      occupancy: p.occupancy,
    })),
    terms: [
      ...d.terms,
      `صلاحية السعر: ${d.valid_from} – ${d.valid_until}؛ فترة السفر: ${d.travel_start} – ${d.travel_end}`,
      `السعر المعروض ${basis[selected.basis]} / ${occ[selected.occupancy]}`,
    ],
  };
  return Object.fromEntries(
    PUBLIC_FIELDS.map((k) => [
      k,
      LIST_FIELDS.includes(k) ? JSON.stringify(out[k]) : out[k],
    ]),
  );
}
