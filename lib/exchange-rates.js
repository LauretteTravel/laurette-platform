import { can, sessionUser } from "./auth.js";
import { readJson, json, HttpError } from "./http.js";
import { transaction } from "./db.js";
import { audit } from "./domain.js";

export const CURRENCY_CODES = [
  "USD",
  "EUR",
  "GBP",
  "SAR",
  "AED",
  "TRY",
  "KWD",
  "QAR",
  "BHD",
  "OMR",
  "EGP",
  "CHF",
  "CAD",
  "AUD",
  "JPY",
  "CNY",
  "INR",
  "MYR",
  "THB",
  "IDR",
  "SGD",
  "KRW",
  "ZAR",
  "SEK",
  "NOK",
  "DKK",
  "PLN",
  "CZK",
  "HUF",
  "NZD",
];
const DEFAULTS = ["USD", "EUR", "GBP", "SAR", "AED", "TRY"],
  PREF = "workspace.exchange.preferences.v1",
  SNAP = "workspace.exchange.snapshot.v1";
const TTL = 300000;
const bad = (message) => {
  throw new HttpError(422, message);
};
function number(value) {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value > 0 &&
    value <= 1000000 &&
    Math.abs(value * 1e8 - Math.round(value * 1e8)) < 0.01
  );
}
function label(value) {
  return (
    typeof value === "string" &&
    value.trim().length >= 2 &&
    value.trim().length <= 100 &&
    !/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/u.test(value)
  );
}
function timestamp(value) {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T/.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}
function readMeta(db, key) {
  const row = db.prepare("SELECT value FROM meta WHERE key=?").get(key);
  if (!row) return null;
  try {
    return JSON.parse(row.value);
  } catch {
    throw new HttpError(503, "إعداد العملات غير صالح؛ راجع المسؤول");
  }
}
function saveMeta(db, key, value) {
  db.prepare(
    "INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
  ).run(key, JSON.stringify(value));
}
function preferences(db) {
  const p = readMeta(db, PREF) || {
    revision: 0,
    selected: DEFAULTS,
    overrides: {},
  };
  if (
    !Number.isSafeInteger(p.revision) ||
    p.revision < 0 ||
    !Array.isArray(p.selected) ||
    !p.selected.length ||
    p.selected.length > 12 ||
    p.selected.some((c) => !CURRENCY_CODES.includes(c)) ||
    new Set(p.selected).size !== p.selected.length ||
    !p.overrides ||
    Array.isArray(p.overrides) ||
    typeof p.overrides !== "object"
  )
    throw new HttpError(503, "إعداد العملات غير صالح؛ راجع المسؤول");
  for (const [code, r] of Object.entries(p.overrides))
    if (
      !CURRENCY_CODES.includes(code) ||
      !r ||
      !number(r.value) ||
      !label(r.source) ||
      !timestamp(r.asOf) ||
      !timestamp(r.validUntil)
    )
      throw new HttpError(503, "إعداد العملات غير صالح؛ راجع المسؤول");
  return p;
}
function snapshot(db) {
  const s = readMeta(db, SNAP);
  if (!s) return null;
  if (
    s.base !== "JOD" ||
    s.quote !== "JOD_PER_UNIT" ||
    !label(s.source) ||
    !timestamp(s.asOf) ||
    !timestamp(s.fetchedAt) ||
    !s.rates ||
    typeof s.rates !== "object" ||
    Array.isArray(s.rates) ||
    Object.entries(s.rates).some(
      ([k, v]) => !CURRENCY_CODES.includes(k) || !number(v),
    )
  )
    throw new HttpError(503, "نسخة أسعار الصرف غير صالحة؛ راجع المسؤول");
  return s;
}
function manage(ctx) {
  const u = sessionUser(ctx.db, ctx.token);
  ctx.user = u;
  if (!u) throw new HttpError(401, "يلزم تسجيل الدخول");
  if (
    u.mustChange ||
    !u.mfaVerified ||
    !can(u, "exchange:manage") ||
    (u.roleKey ? u.dataScope !== "organization" : u.role !== "admin")
  )
    throw new HttpError(
      403,
      "إدارة العملات تتطلب صلاحية المؤسسة والمصادقة الثنائية",
    );
}

/** Provider is trusted server code only; the HTTP API never accepts URLs or keys.
 * fetchRates({signal}) -> {base:'JOD',quote:'JOD_PER_UNIT',asOf:ISO,rates:{USD:number,...}}
 * Each value is JOD for ONE foreign unit. No accounting conversion is performed.
 */
export function createExchangeRateService({
  db,
  provider = null,
  clock = Date.now,
  timeoutMs = 5000,
}) {
  let pending = null,
    lastAttempt = 0,
    lastError = false;
  const configured = Boolean(
    provider &&
      label(provider.name) &&
      typeof provider.fetchRates === "function",
  );
  async function refresh() {
    if (!configured) return;
    if (pending) return pending;
    lastAttempt = clock();
    pending = (async () => {
      const controller = new AbortController();
      let timer;
      try {
        const data = await Promise.race([
          Promise.resolve().then(() =>
            provider.fetchRates({ signal: controller.signal }),
          ),
          new Promise((_, reject) => {
            timer = setTimeout(() => {
              controller.abort();
              reject(new Error("timeout"));
            }, timeoutMs);
          }),
        ]);
        const now = clock();
        if (
          !data ||
          data.base !== "JOD" ||
          data.quote !== "JOD_PER_UNIT" ||
          !timestamp(data.asOf) ||
          Date.parse(data.asOf) > now + 300000 ||
          Date.parse(data.asOf) < now - 7 * 86400000 ||
          !data.rates ||
          Array.isArray(data.rates) ||
          !Object.keys(data.rates).length ||
          Object.keys(data.rates).length > CURRENCY_CODES.length ||
          Object.entries(data.rates).some(
            ([k, v]) => !CURRENCY_CODES.includes(k) || !number(v),
          )
        )
          throw new Error("invalid-provider-data");
        const old = snapshot(db),
          changes = {};
        if (old?.source === provider.name)
          for (const [code, value] of Object.entries(data.rates))
            if (old.rates[code])
              changes[code] =
                ((value - old.rates[code]) / old.rates[code]) * 100;
        saveMeta(db, SNAP, {
          base: "JOD",
          quote: "JOD_PER_UNIT",
          source: provider.name.trim(),
          asOf: new Date(data.asOf).toISOString(),
          fetchedAt: new Date(now).toISOString(),
          rates: data.rates,
          changes,
        });
        lastError = false;
      } catch {
        lastError = true;
      } finally {
        clearTimeout(timer);
      }
    })().finally(() => {
      pending = null;
    });
    return pending;
  }
  function display() {
    const p = preferences(db),
      s = snapshot(db),
      now = clock();
    const items = CURRENCY_CODES.map((code) => {
      const manual = p.overrides[code],
        api = s?.rates[code];
      const manualFresh = manual && Date.parse(manual.validUntil) > now;
      const apiFresh = api && now - Date.parse(s.asOf) <= TTL && !lastError;
      if (manualFresh)
        return {
          code,
          value: manual.value,
          state: "manual",
          source: manual.source,
          asOf: manual.asOf,
          validUntil: manual.validUntil,
          changePercent: null,
          manual: true,
        };
      if (api)
        return {
          code,
          value: api,
          state: apiFresh ? (manual ? "fallback" : "api") : "stale",
          source: s.source,
          asOf: s.asOf,
          validUntil: new Date(Date.parse(s.asOf) + TTL).toISOString(),
          changePercent:
            !manual && Number.isFinite(s.changes?.[code])
              ? s.changes[code]
              : null,
          manual: false,
          manualExpired: Boolean(manual),
          cachedAfterFailure: lastError,
        };
      if (manual)
        return {
          code,
          value: manual.value,
          state: "stale",
          source: manual.source,
          asOf: manual.asOf,
          validUntil: manual.validUntil,
          changePercent: null,
          manual: true,
        };
      return {
        code,
        value: null,
        state: "unavailable",
        source: null,
        asOf: null,
        validUntil: null,
        changePercent: null,
        manual: false,
      };
    });
    return {
      ok: true,
      base: "JOD",
      quote: "JOD_PER_UNIT",
      providerConfigured: configured,
      refreshFailed: lastError,
      lastAttemptAt: lastAttempt ? new Date(lastAttempt).toISOString() : null,
      refreshSeconds: TTL / 1000,
      revision: p.revision,
      selected: p.selected,
      items,
      manualOverrides: p.overrides,
      note: "أسعار إرشادية فقط؛ لا تعدّل أسعار البيع أو دفاتر الحجوزات أو التقارير.",
    };
  }
  async function getRates(ctx) {
    if (configured && (pending || clock() - lastAttempt >= TTL))
      await refresh();
    // A read may await the provider. Revalidate the actual session before responding.
    ctx.user = sessionUser(ctx.db, ctx.token);
    if (!ctx.user) throw new HttpError(401, "يلزم تسجيل الدخول");
    if (
      ctx.user.mustChange ||
      (ctx.user.mfaRequired && !ctx.user.mfaVerified) ||
      !can(ctx.user, "overview:read")
    )
      throw new HttpError(403, "لا تملك صلاحية قراءة لوحة العمل");
    const data = display();
    if (
      !can(ctx.user, "exchange:manage") ||
      ctx.user.dataScope !== "organization"
    )
      delete data.manualOverrides;
    return json(ctx.res, 200, data);
  }
  async function updateRates(ctx) {
    const body = await readJson(ctx.req, 16384);
    manage(ctx);
    if (
      Object.keys(body).some(
        (k) => !["revision", "selected", "overrides", "reason"].includes(k),
      ) ||
      !Array.isArray(body.selected) ||
      body.selected.length < 1 ||
      body.selected.length > 12 ||
      new Set(body.selected).size !== body.selected.length ||
      body.selected.some((c) => !CURRENCY_CODES.includes(c)) ||
      !Array.isArray(body.overrides) ||
      body.overrides.length > CURRENCY_CODES.length ||
      new Set(body.overrides.map((r) => r?.code)).size !== body.overrides.length
    )
      bad("اختر1–12 عملة معروفة ومراجعة يدوية صحيحة");
    const reason = typeof body.reason === "string" ? body.reason.trim() : "";
    if (reason.length < 3 || reason.length > 500)
      bad("سبب التغيير مطلوب (3–500 حرف)");
    const changes = {};
    for (const row of body.overrides) {
      if (
        !row ||
        !CURRENCY_CODES.includes(row.code) ||
        Object.keys(row).some(
          (k) => !["code", "value", "source", "asOf", "validUntil"].includes(k),
        )
      )
        bad("تجاوز يدوي غير صالح");
      if (row.value === null) {
        changes[row.code] = null;
        continue;
      }
      if (
        !number(row.value) ||
        !label(row.source) ||
        !timestamp(row.asOf) ||
        !timestamp(row.validUntil) ||
        Date.parse(row.asOf) > clock() + 300000 ||
        Date.parse(row.asOf) < clock() - 30 * 86400000 ||
        Date.parse(row.validUntil) <= Date.parse(row.asOf) ||
        Date.parse(row.validUntil) > Date.parse(row.asOf) + 7 * 86400000
      )
        bad(
          "السعر اليدوي يحتاج مصدرًا ووقتًا وصلاحية حتى7أيام، بدقة8منازل كحد أقصى",
        );
      changes[row.code] = {
        value: row.value,
        source: row.source.trim(),
        asOf: new Date(row.asOf).toISOString(),
        validUntil: new Date(row.validUntil).toISOString(),
      };
    }
    transaction(db, () => {
      const old = preferences(db);
      if (body.revision !== old.revision)
        throw new HttpError(
          409,
          "تغيرت إعدادات العملات؛ أعد القراءة قبل الحفظ",
        );
      const overrides = { ...old.overrides };
      for (const [code, value] of Object.entries(changes)) {
        if (value === null) delete overrides[code];
        else overrides[code] = value;
      }
      saveMeta(db, PREF, {
        revision: old.revision + 1,
        selected: body.selected,
        overrides,
      });
      audit(db, {
        user: ctx.user,
        action: "exchange.update",
        entity: "exchange_preferences",
        entityId: "workspace",
        meta: {
          reason,
          before: { revision: old.revision, selected: old.selected },
          after: { revision: old.revision + 1, selected: body.selected },
          changedCodes: Object.keys(changes),
        },
        ip: ctx.ip,
      });
      for (const [code, value] of Object.entries(changes))
        audit(db, {
          user: ctx.user,
          action: "exchange.manual",
          entity: "exchange_rate",
          entityId: code,
          meta: {
            reason,
            code,
            before: old.overrides[code] || null,
            after: value,
          },
          ip: ctx.ip,
        });
    });
    return json(ctx.res, 200, display());
  }
  async function refreshRates(ctx) {
    manage(ctx);
    await refresh();
    manage(ctx);
    return json(ctx.res, 200, display());
  }
  return { getRates, updateRates, refreshRates };
}
