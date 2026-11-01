import { HttpError } from "./http.js";
const formatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Amman",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});
function parts(value) {
  return Object.fromEntries(
    formatter.formatToParts(new Date(value)).map((p) => [p.type, p.value]),
  );
}
export function ammanDay(value) {
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return null;
  const p = parts(ms);
  return `${p.year}-${p.month}-${p.day}`;
}
export function calendarDate(value) {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString().slice(0, 10) !== value
  )
    throw new HttpError(400, "تاريخ غير صالح؛ استخدم YYYY-MM-DD");
  return value;
}
export const shiftDay = (day, n) =>
  new Date(Date.parse(day + "T00:00:00Z") + n * 86400000)
    .toISOString()
    .slice(0, 10);
export function dayStart(day) {
  calendarDate(day);
  const target = Date.parse(day + "T00:00:00Z");
  let ms = target;
  for (let i = 0; i < 4; i++) {
    const p = parts(ms);
    ms +=
      target -
      Date.parse(
        `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}Z`,
      );
  }
  return new Date(ms).toISOString();
}
export function reportRange(query = {}, at = new Date().toISOString()) {
  const period = ["daily", "weekly", "monthly"].includes(query.period)
    ? query.period
    : "weekly";
  let { from, to } = query;
  if (Boolean(from) !== Boolean(to))
    throw new HttpError(400, "حدد تاريخ البداية والنهاية معًا");
  if (!from) {
    to = ammanDay(at);
    from =
      period === "daily"
        ? to
        : period === "weekly"
          ? shiftDay(to, -6)
          : to.slice(0, 7) + "-01";
  }
  calendarDate(from);
  calendarDate(to);
  if (from < "2000-01-01" || to > "2199-12-31")
    throw new HttpError(400, "نطاق التقرير بين 2000 و2199");
  const days = (Date.parse(to) - Date.parse(from)) / 86400000 + 1;
  if (days < 1 || days > 366)
    throw new HttpError(400, "النطاق من يوم إلى 366 يومًا");
  const start = dayStart(from),
    end = dayStart(shiftDay(to, 1));
  return {
    period,
    from,
    to,
    days,
    start,
    end,
    timeZone: "Asia/Amman",
    previous: {
      from: shiftDay(from, -days),
      to: shiftDay(from, -1),
      start: dayStart(shiftDay(from, -days)),
      end: start,
    },
  };
}
const registered = new WeakSet();
export function registerReportTime(db) {
  if (!registered.has(db)) {
    db.function("report_day", (value) => ammanDay(value));
    registered.add(db);
  }
}
