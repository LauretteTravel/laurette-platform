import assert from "node:assert/strict";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve, relative, isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import { createApp } from "../server.js";
import { hashPassword } from "../lib/auth.js";
assert.equal(process.env.CI, "true");
assert.equal(process.platform, "linux");
const deps = process.env.VOUCHER_TEST_DEPS,
  out = process.env.VOUCHER_EVIDENCE;
for (const directory of [deps, out])
  assert.ok(
    directory &&
      isAbsolute(directory) &&
      !relative(
        resolve(process.env.RUNNER_TEMP),
        resolve(directory),
      ).startsWith(".."),
  );
mkdirSync(out, { recursive: true });
const { chromium } = await import(
  pathToFileURL(join(deps, "node_modules/playwright/index.mjs")).href
);
process.env.WHATSAPP_NOTIFICATIONS_ENABLED = "0";
for (const key of [
  "N8N_BOOKING_WEBHOOK_URL",
  "N8N_WEBHOOK_URL",
  "N8N_BOOKING_WEBHOOK_SECRET",
  "N8N_API_KEY",
  "N8N_WEBHOOK_KEY",
])
  delete process.env[key];
const seed = JSON.parse(readFileSync("data/seed.json", "utf8")),
  password = "Synthetic-Voucher-Browser42";
const app = createApp({
  dbFile: ":memory:",
  seed: { ...seed, users: [] },
  adminPassword: password,
  baseUrl: "http://127.0.0.1:0",
  sendVerificationEmail: async () => {},
});
const db = app.db,
  now = new Date().toISOString(),
  p = hashPassword(password),
  branch = db.prepare("SELECT id FROM branches LIMIT 1").get().id,
  department = db
    .prepare("SELECT id FROM departments WHERE branch_id IS NULL LIMIT 1")
    .get().id;
const grants = [
  "overview:read",
  "requests:read",
  "vouchers:read",
  "vouchers:write",
  "vouchers:issue",
  "vouchers:cancel",
  "vouchers:export",
];
db.prepare(
  "INSERT INTO role_definitions(role_key,name,base_role,data_scope,permissions,created_at,updated_at) VALUES('voucher_browser','Synthetic voucher operator','agent','assigned',?,?,?)",
).run(JSON.stringify(grants), now, now);
const user = Number(
  db
    .prepare(
      "INSERT INTO users(username,name,role,role_key,branch_id,department_id,password_hash,password_salt,created_at) VALUES('voucher-browser','Synthetic voucher operator','agent','voucher_browser',?,?,?,?,?)",
    )
    .run(branch, department, p.hash, p.salt, now).lastInsertRowid,
);
const requests = {};
for (const kind of ["flight", "hotel"])
  requests[kind] = Number(
    db
      .prepare(
        "INSERT INTO requests(reference,type,status,branch_id,department_id,assigned_to,payload,title,summary,created_at,updated_at) VALUES(?,?,'confirmed',?,?,?,'{}',?,'Synthetic fixture',?,?)",
      )
      .run(
        "SYN-BROWSER-" + kind,
        kind,
        branch,
        department,
        user,
        "Synthetic " + kind,
        now,
        now,
      ).lastInsertRowid,
  );
const address = await app.listen(0, "127.0.0.1"),
  base = `http://127.0.0.1:${address.port}`,
  browser = await chromium.launch({ headless: true });
const metrics = {
  pdf: [],
  desktop: false,
  mobile: false,
  longDocument: false,
  externalRequestsBlocked: true,
};
async function context(viewport) {
  const c = await browser.newContext({
    viewport,
    acceptDownloads: true,
    locale: "ar-JO",
    timezoneId: "Asia/Amman",
  });
  await c.route("**/*", (route) =>
    route
      .request()
      .url()
      .startsWith(base + "/")
      ? route.continue()
      : route.abort(),
  );
  return c;
}
async function login(page) {
  await page.goto(base + "/admin");
  await page
    .getByLabel("اسم المستخدم", { exact: true })
    .fill("voucher-browser");
  await page.getByLabel("كلمة المرور", { exact: true }).fill(password);
  await page.getByRole("button", { name: "دخول", exact: true }).click();
  await page
    .getByRole("button", { name: "القسائم المؤرشفة", exact: true })
    .click();
  await page
    .getByRole("button", { name: "قسيمة جديدة", exact: true })
    .waitFor();
}
async function fill(page, fields) {
  for (const [key, value] of Object.entries(fields))
    await page.locator(`[data-vl-path="${key}"]`).fill(String(value));
}
async function exportPdf(page, filename, { onePage = true } = {}) {
  const start = Date.now(),
    download = page.waitForEvent("download", { timeout: 20000 });
  await page.locator("#vdPdf").click();
  const file = await download;
  await file.saveAs(join(out, filename));
  const durationMs = Date.now() - start;
  assert.ok(durationMs < 15000, `PDF export exceeded 15s (${durationMs}ms)`);
  const bytes = readFileSync(join(out, filename));
  assert.equal(bytes.subarray(0, 5).toString(), "%PDF-");
  const info = execFileSync("pdfinfo", [join(out, filename)], {
      encoding: "utf8",
    }),
    pages = Number(info.match(/Pages:\s+(\d+)/)[1]);
  assert.match(info, /595\.28 x 841\.89 pts \(A4\)/);
  assert.ok(onePage ? pages === 1 : pages >= 2 && pages <= 6);
  execFileSync("pdftoppm", [
    "-scale-to",
    "1200",
    "-png",
    join(out, filename),
    join(out, filename.replace(".pdf", "")),
  ]);
  const metric = { filename, pages, bytes: bytes.length, durationMs };
  metrics.pdf.push(metric);
  writeFileSync(join(out, "metrics.json"), JSON.stringify(metrics, null, 2));
  console.log("PDF_EXPORT", JSON.stringify(metric));
}
try {
  const desktop = await context({ width: 1280, height: 900 }),
    page = await desktop.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await login(page);
  for (const kind of ["flight", "hotel"]) {
    await page
      .getByRole("button", { name: "قسيمة جديدة", exact: true })
      .click();
    await page.getByRole("button", { name: "بحث عن طلب", exact: true }).click();
    await page
      .getByRole("combobox", { name: "الطلب", exact: true })
      .selectOption(String(requests[kind]));
    await page
      .getByRole("combobox", { name: "نوع القسيمة", exact: true })
      .selectOption(kind);
    await page
      .getByLabel("سبب الإنشاء", { exact: true })
      .fill("Synthetic browser acceptance");
    await page
      .getByRole("button", { name: "إنشاء المسودة", exact: true })
      .click();
    await page
      .getByLabel(kind === "flight" ? "مرجع الحجز / PNR" : "مرجع حجز الفندق", {
        exact: true,
      })
      .waitFor();
    const common = {
      bookingReference: "SYN-" + kind,
      "people.0.name":
        kind === "flight"
          ? "مسافر مصطنع للاختبار"
          : "Synthetic Guest — ضيف مصطنع",
      notes: "Synthetic quality assurance only. No customer data.",
    };
    if (kind === "flight")
      await fill(page, {
        ...common,
        "people.0.ticketNumber": "1234567890123",
        "flight.airline": "Synthetic Airline",
        "flight.baggage": "23kg + 8kg",
        "flight.segments.0.from": "AMM — عمّان",
        "flight.segments.0.to": "IST — إسطنبول",
        "flight.segments.0.flightNumber": "SYN123",
        "flight.segments.0.departAt": "2027-04-01T12:30+03:00",
        "flight.segments.0.arriveAt": "2027-04-01T15:00+03:00",
      });
    else {
      await page.locator("[data-vl-path=language]").selectOption("en");
      await fill(page, {
        ...common,
        "hotel.name": "Synthetic Boutique Hotel",
        "hotel.address": "Istanbul — synthetic address",
        "hotel.checkIn": "2027-04-01",
        "hotel.checkOut": "2027-04-04",
        "hotel.roomType": "Single room",
        "hotel.mealPlan": "Breakfast",
        "hotel.cancellationPolicy": "Free cancellation before 28 March 2027.",
      });
    }
    await page
      .getByLabel("سبب العملية", { exact: true })
      .fill("Synthetic browser save");
    await page
      .getByRole("button", { name: "إصدار النسخة المحفوظة", exact: true })
      .click();
    await page
      .getByText("احفظ تعديلات النموذج أولًا قبل إصدار النسخة", { exact: true })
      .waitFor();
    await page
      .getByRole("button", { name: "حفظ المسودة", exact: true })
      .click();
    await page.waitForFunction(
      () => document.querySelector("[name=reason]")?.value === "",
    );
    await page
      .getByLabel("سبب العملية", { exact: true })
      .fill("Synthetic browser issue");
    await page
      .getByRole("button", { name: "إصدار النسخة المحفوظة", exact: true })
      .click();
    const link = page.getByRole("link", {
      name: "فتح المستند وPDF",
      exact: true,
    });
    await link.waitFor();
    const href = await link.getAttribute("href"),
      doc = await desktop.newPage();
    await doc.goto(base + href);
    await doc.screenshot({
      path: join(out, kind + "-document.png"),
      fullPage: true,
    });
    await exportPdf(doc, kind + ".pdf");
    await doc.close();
    await page.screenshot({
      path: join(out, kind + "-editor.png"),
      fullPage: true,
    });
    await page
      .getByRole("button", { name: "عودة للأرشيف", exact: true })
      .click();
  }
  assert.deepEqual(errors, []);
  metrics.desktop = true;
  console.log(
    "PASS desktop creation, saved-data issue, dirty guard and two actual A4 PDFs",
  );
  const mobile = await context({ width: 390, height: 844 }),
    phone = await mobile.newPage();
  await login(phone);
  await phone.getByRole("button", { name: /LRT-HTL-/ }).click();
  await phone.locator(".vl-editor").waitFor({ state: "visible" });
  const dimensions = await phone.evaluate(() => ({
    width: document.documentElement.clientWidth,
    content: document.documentElement.scrollWidth,
    columns: getComputedStyle(
      document.querySelector(".vl-editor"),
    ).gridTemplateColumns.split(" ").length,
  }));
  assert.equal(dimensions.width, 390);
  assert.ok(dimensions.content <= 391, JSON.stringify(dimensions));
  assert.equal(dimensions.columns, 1);
  await phone.screenshot({
    path: join(out, "mobile-editor.png"),
    fullPage: true,
  });
  metrics.mobile = true;
  console.log(
    "PASS mobile 390px form, one column and no horizontal page overflow",
  );
  const many = {
    language: "ar",
    bookingReference: "SYN-GROUP",
    people: Array.from({ length: 30 }, (_, i) => ({
      name: `ضيف مصطنع ${i + 1} — Synthetic guest`,
      ticketNumber: "",
    })),
    notes: "Synthetic long document only.",
    hotel: {
      name: "فندق مصطنع للمجموعة",
      address: "عنوان تجريبي",
      checkIn: "2027-04-01",
      checkOut: "2027-04-04",
      checkInTime: "14:00",
      checkOutTime: "12:00",
      roomType: "غرف مجموعة",
      mealPlan: "إفطار",
      guestCount: 30,
      cancellationPolicy: "سياسة تجريبية للمراجعة فقط.",
    },
  };
  let response = await desktop.request.post(base + "/api/admin/vouchers", {
    headers: { origin: base },
    data: {
      requestId: requests.hotel,
      kind: "hotel",
      data: many,
      reason: "Synthetic long document",
    },
  });
  assert.equal(response.status(), 201);
  const created = await response.json();
  response = await desktop.request.post(
    base + "/api/admin/vouchers/" + created.id + "/issue",
    {
      headers: { origin: base },
      data: { revision: 1, reason: "Synthetic group issue" },
    },
  );
  assert.equal(response.status(), 200);
  const group = await desktop.newPage();
  await group.goto(
    base + "/api/admin/vouchers/" + created.id + "/versions/1/document",
  );
  await exportPdf(group, "group.pdf", { onePage: false });
  metrics.longDocument = true;
  console.log("PASS 30-guest document exports multiple A4 pages");
  writeFileSync(join(out, "metrics.json"), JSON.stringify(metrics, null, 2));
  console.log("VOUCHER_BROWSER_ACCEPTANCE 3/3", JSON.stringify(metrics));
} finally {
  await browser.close();
  await app.close();
}
