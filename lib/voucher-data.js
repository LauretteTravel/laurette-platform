import { HttpError } from "./http.js";
const bad = (message) => {
  throw new HttpError(422, message);
};
function object(value, keys) {
  if (
    !value ||
    Array.isArray(value) ||
    typeof value !== "object" ||
    Object.keys(value).some((key) => !keys.includes(key))
  )
    bad("حقول القسيمة غير صالحة");
  return value;
}
function text(value, max, label, required = false) {
  if (value === undefined) value = "";
  if (typeof value !== "string") bad(label + " غير صالح");
  const result = value.normalize("NFC").replaceAll("\r\n", "\n").trim();
  if (
    result.length > max ||
    /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(
      result,
    ) ||
    (required && !result)
  )
    bad(label + " مطلوب أو يتجاوز الحد المسموح");
  return result;
}
function date(value, label) {
  const result = text(value, 10, label);
  if (!result) return "";
  if (
    !/^(20\d{2}|2100)-\d{2}-\d{2}$/.test(result) ||
    !Number.isFinite(Date.parse(result)) ||
    new Date(result).toISOString().slice(0, 10) !== result
  )
    bad(label + " غير صالح");
  return result;
}
function time(value, label) {
  const result = text(value, 5, label);
  if (result && !/^([01]\d|2[0-3]):[0-5]\d$/.test(result))
    bad(label + " غير صالح");
  return result;
}
export function zonedFlightTime(value, zone, required = false) {
  value = text(value, 25, "وقت الرحلة", required);
  zone = text(zone, 64, "المنطقة الزمنية", required);
  if (!value && !required) {
    if (zone)
      try {
        new Intl.DateTimeFormat("en", { timeZone: zone });
      } catch {
        bad("المنطقة الزمنية غير صالحة");
      }
    return { at: "", zone };
  }
  if (
    !/^(20\d{2}|2100)-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d(?:Z|[+-](?:0\d|1[0-4]):[0-5]\d)$/.test(
      value,
    )
  )
    bad("وقت الرحلة يجب أن يتضمن إزاحة UTC صحيحة، مثال 2027-04-01T12:30+03:00");
  date(value.slice(0, 10), "تاريخ الرحلة");
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) bad("وقت الرحلة غير صالح");
  let parts;
  try {
    parts = Object.fromEntries(
      new Intl.DateTimeFormat("en-GB", {
        timeZone: zone,
        hourCycle: "h23",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })
        .formatToParts(new Date(ms))
        .map((p) => [p.type, p.value]),
    );
  } catch {
    bad("المنطقة الزمنية غير صالحة");
  }
  if (
    `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}` !==
    value.slice(0, 16)
  )
    bad("إزاحة UTC لا تطابق المنطقة الزمنية في موعد الرحلة");
  return { at: value, zone };
}
export function voucherData(kind, input, { issuing = false } = {}) {
  const value = object(input, [
    "language",
    "bookingReference",
    "people",
    "notes",
    "flight",
    "hotel",
  ]);
  if (!["flight", "hotel"].includes(kind))
    bad("النوع المدعوم طيران أو فندق فقط");
  const language = value.language ?? "ar";
  if (!["ar", "en"].includes(language)) bad("اللغة غير صالحة");
  const people = value.people ?? [];
  if (
    !Array.isArray(people) ||
    people.length > 30 ||
    (issuing && !people.length)
  )
    bad("أضف من 1 إلى 30 مسافرًا عند الإصدار");
  const result = {
    language,
    bookingReference: text(value.bookingReference, 80, "مرجع الحجز", issuing),
    notes: text(value.notes, 2000, "الملاحظات"),
    people: people.map((p) => {
      object(p, ["name", "ticketNumber"]);
      return {
        name: text(p.name, 120, "الاسم كما في الجواز", issuing),
        ticketNumber: text(p.ticketNumber, 40, "رقم التذكرة"),
      };
    }),
  };
  if (kind === "flight") {
    if (value.hotel !== undefined)
      bad("لا تجمع قسيمة فندق وطيران في مستند واحد");
    const flight = object(value.flight ?? {}, [
        "airline",
        "baggage",
        "segments",
      ]),
      segments = flight.segments ?? [];
    if (
      !Array.isArray(segments) ||
      segments.length > 6 ||
      (issuing && !segments.length)
    )
      bad("أضف من 1 إلى 6 قطاعات طيران عند الإصدار");
    result.flight = {
      airline: text(flight.airline, 120, "شركة الطيران", issuing),
      baggage: text(flight.baggage, 500, "الأمتعة", issuing),
      segments: segments.map((segment) => {
        object(segment, [
          "from",
          "to",
          "flightNumber",
          "departAt",
          "departZone",
          "arriveAt",
          "arriveZone",
        ]);
        const depart = zonedFlightTime(
            segment.departAt,
            segment.departZone,
            issuing,
          ),
          arrive = zonedFlightTime(
            segment.arriveAt,
            segment.arriveZone,
            issuing,
          );
        if (
          depart.at &&
          arrive.at &&
          Date.parse(arrive.at) <= Date.parse(depart.at)
        )
          bad("الوصول يجب أن يكون بعد المغادرة حسب التوقيت الفعلي");
        return {
          from: text(segment.from, 100, "مطار المغادرة", issuing),
          to: text(segment.to, 100, "مطار الوصول", issuing),
          flightNumber: text(segment.flightNumber, 30, "رقم الرحلة", issuing),
          departAt: depart.at,
          departZone: depart.zone,
          arriveAt: arrive.at,
          arriveZone: arrive.zone,
        };
      }),
    };
    for (let i = 1; i < result.flight.segments.length; i++) {
      const previous = result.flight.segments[i - 1],
        current = result.flight.segments[i];
      if (
        previous.arriveAt &&
        current.departAt &&
        Date.parse(current.departAt) < Date.parse(previous.arriveAt)
      )
        bad("ترتيب قطاعات الرحلة يتعارض مع أوقات الوصول والمغادرة");
    }
  } else {
    if (value.flight !== undefined)
      bad("لا تجمع قسيمة فندق وطيران في مستند واحد");
    const hotel = object(value.hotel ?? {}, [
      "name",
      "address",
      "checkIn",
      "checkOut",
      "checkInTime",
      "checkOutTime",
      "roomType",
      "mealPlan",
      "guestCount",
      "cancellationPolicy",
      "nights",
    ]);
    const checkIn = date(hotel.checkIn, "تاريخ الدخول"),
      checkOut = date(hotel.checkOut, "تاريخ الخروج");
    const nights =
      checkIn && checkOut
        ? (Date.parse(checkOut) - Date.parse(checkIn)) / 86400000
        : 0;
    if (
      (checkIn && checkOut && (nights < 1 || nights > 365)) ||
      (issuing && !nights)
    )
      bad("تواريخ الإقامة يجب أن تحدد من 1 إلى 365 ليلة");
    const guests = hotel.guestCount ?? 1;
    if (
      !Number.isInteger(guests) ||
      guests < 1 ||
      guests > 30 ||
      (issuing && guests !== result.people.length)
    )
      bad("عدد الضيوف يجب أن يطابق الأسماء عند الإصدار (حتى 30)");
    if (issuing && (!hotel.checkInTime || !hotel.checkOutTime))
      bad("وقت الدخول والخروج مطلوبان");
    result.hotel = {
      name: text(hotel.name, 160, "اسم الفندق", issuing),
      address: text(hotel.address, 500, "عنوان الفندق", issuing),
      checkIn,
      checkOut,
      checkInTime: time(hotel.checkInTime, "وقت الدخول"),
      checkOutTime: time(hotel.checkOutTime, "وقت الخروج"),
      nights,
      roomType: text(hotel.roomType, 120, "نوع الغرفة", issuing),
      mealPlan: text(hotel.mealPlan, 120, "الوجبات", issuing),
      guestCount: guests,
      cancellationPolicy: text(
        hotel.cancellationPolicy,
        2000,
        "سياسة الإلغاء",
        issuing,
      ),
    };
  }
  return result;
}
