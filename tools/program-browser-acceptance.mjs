import assert from "node:assert/strict";
import { openStaffSection } from '../tests/helpers/staff-browser-navigation.mjs';
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve, relative, isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";
import { createApp } from "../server.js";
import { hashPassword, createSession } from "../lib/auth.js";
import { ammanToday } from "../lib/program-data.js";
assert.equal(process.env.CI, "true");
assert.equal(process.platform, "linux");
const deps = process.env.VOUCHER_TEST_DEPS,
  out = join(process.env.VOUCHER_EVIDENCE, "phase4");
for (const dir of [deps, out])
  assert.ok(
    isAbsolute(dir) &&
      !relative(resolve(process.env.RUNNER_TEMP), resolve(dir)).startsWith(
        "..",
      ),
  );
mkdirSync(out, { recursive: true });
const { chromium } = await import(
  pathToFileURL(join(deps, "node_modules/playwright/index.mjs")).href
);
for (const key of [
  "N8N_BOOKING_WEBHOOK_URL",
  "N8N_WEBHOOK_URL",
  "N8N_BOOKING_WEBHOOK_SECRET",
  "N8N_API_KEY",
  "N8N_WEBHOOK_KEY",
])
  delete process.env[key];
process.env.WHATSAPP_NOTIFICATIONS_ENABLED = "0";
delete process.env.PROGRAM_SOURCE_UPLOADS_ENABLED;
const seed = JSON.parse(readFileSync("data/seed.json")),
  app = createApp({
    dbFile: ":memory:",
    seed: { ...seed, users: [] },
    adminPassword: "Synthetic-Program-Browser42",
    baseUrl: "http://127.0.0.1:0",
  });
const db = app.db,
  now = new Date().toISOString(),
  pw = hashPassword("Synthetic-Program-Browser42"),
  branch = db.prepare("SELECT id FROM branches LIMIT 1").get().id;
const grants = [
  "overview:read",
  "programs:read",
  "programs:write",
  "programs:approve",
  "programs:publish",
  "programs:sources",
  "programs:categories",
];
db.prepare(
  "INSERT INTO role_definitions(role_key,name,base_role,data_scope,permissions,created_at,updated_at) VALUES('program_browser','Synthetic program reviewer','agent','organization',?,?,?)",
).run(JSON.stringify(grants), now, now);
const user = Number(
  db
    .prepare(
      "INSERT INTO users(username,name,role,role_key,branch_id,password_hash,password_salt,created_at) VALUES('program-browser','موظف مراجعة مصطنع','agent','program_browser',?,?,?,?)",
    )
    .run(branch, pw.hash, pw.salt, now).lastInsertRowid,
);
// A synthetic MFA-verified session isolates product acceptance from the separately tested MFA enrollment flow.
const token = createSession(db, user, "127.0.0.1", "synthetic", {
  mfaVerified: true,
}).token;
const address = await app.listen(0, "127.0.0.1"),
  base = `http://127.0.0.1:${address.port}`,
  browser = await chromium.launch({ headless: true });
const metrics = {
  desktop: false,
  review: false,
  mobile: false,
  externalNetworkBlocked: true,
  pageErrors: [],
};
async function context(viewport) {
  const c = await browser.newContext({
    viewport,
    locale: "ar-JO",
    timezoneId: "Asia/Amman",
  });
  await c.route("**/*", (r) =>
    r
      .request()
      .url()
      .startsWith(base + "/")
      ? r.continue()
      : r.abort(),
  );
  await c.addCookies([{ name: "lt_session", value: token, url: base }]);
  return c;
}
try {
  const desktop = await context({ width: 1440, height: 1000 }),
    page = await desktop.newPage();
  page.on("pageerror", (e) => metrics.pageErrors.push(e.message));
  page.on("dialog", (d) => d.accept());
  await page.goto(base + "/admin");
  await openStaffSection(page,'programs');
  await page.locator("[data-new]").click();
  await page
    .locator("[data-field=title]")
    .fill("برنامج مصطنع للمراجعة — إسطنبول");
  await page.locator("[data-slug]").fill("synthetic-program-browser");
  await page.locator("[data-field=category]").selectOption("istanbul");
  await page
    .locator("[data-field=destination]")
    .fill("إسطنبول — بيانات مصطنعة");
  await page.locator("[data-field=days]").fill("4");
  await page.locator("[data-field=nights]").fill("3");
  await page
    .locator("[data-field=summary]")
    .fill("عرض مصطنع لا يمثل سعرًا حقيقيًا");
  await page.locator("[data-add-price]").click();
  const row = page.locator("[data-price]").first();
  await row.locator("[data-price-key=label]").fill("غرفة مزدوجة — مصطنع");
  await row.locator("[data-price-key=sale]").fill("520");
  await row.locator("[data-price-key=cost]").fill("430");
  await row.locator("[data-price-key=currency]").selectOption("USD");
  await row.locator("[data-price-key=basis]").selectOption("room");
  await row.locator("[data-price-key=occupancy]").selectOption("double");
  for (const [k, v] of Object.entries({
    valid_from: ammanToday(),
    valid_until: "2099-01-31",
    travel_start: "2099-02-01",
    travel_end: "2099-02-28",
  }))
    await page.locator(`[data-field=${k}]`).fill(v);
  await page
    .locator("[data-list=terms]")
    .fill("هذا مصدر مصطنع للاختبار فقط\nالاعتماد البشري مطلوب");
  await page.locator("[data-list=includes]").fill("إقامة مصطنعة");
  await page.locator("[data-reason]").fill("إنشاء مصطنع للاختبار");
  await page.locator("[data-save]").click();
  await page
    .getByRole("heading", {
      name: "برنامج مصطنع للمراجعة — إسطنبول",
      exact: true,
    })
    .waitFor();
  await page.locator("[data-command=submit]").waitFor();
  assert.equal(
    db
      .prepare(
        "SELECT COUNT(*) n FROM programs WHERE slug='synthetic-program-browser'",
      )
      .get().n,
    0,
  );
  const w = db
    .prepare(
      "SELECT * FROM program_workspaces WHERE slug='synthetic-program-browser'",
    )
    .get();
  assert.ok(w);
  await page.locator("[data-reason]").fill("مصدر مصطنع للمراجعة");
  await page.locator("[data-source-name]").fill("عرض مورد مصطنع");
  await page
    .locator("[data-source-text]")
    .fill(
      "غرفة مزدوجة 520 USD للغرفة\nصالح حتى 2099-01-31\nهذه أسعار مصطنعة فقط",
    );
  await page.locator("[data-source-text-save]").click();
  await page.getByText("عرض مورد مصطنع", { exact: true }).waitFor();
  await page.locator("[data-reason]").fill("إرسال مصدر مصطنع للمراجعة");
  await page.locator("[data-command=submit]").click();
  await page.locator("[data-command=approve]").waitFor();
  // Unsaved edits disable approval; save necessarily returns the workspace to draft.
  await page.locator("[data-field=summary]").fill("عرض مصطنع بعد تدقيق المصدر");
  assert.equal(await page.locator("[data-command=approve]").isDisabled(), true);
  await page.locator("[data-reason]").fill("تعديل يستلزم إعادة المراجعة");
  await page.locator("[data-save]").click();
  await page.locator("[data-command=submit]").waitFor();
  assert.equal(await page.locator("[data-command=approve]").count(), 0);
  await page.locator("[data-reason]").fill("إعادة إرسال بعد حفظ التعديل");
  await page.locator("[data-command=submit]").click();
  await page.locator("[data-command=approve]").waitFor();
  await page
    .locator("[data-check]")
    .evaluateAll((elements) => elements.forEach((e) => e.scrollIntoView()));
  for (const box of await page.locator("[data-check]").all()) await box.check();
  for (const box of await page.locator("[data-source-review]").all())
    await box.check();
  await page.locator("[data-reason]").fill("اعتماد بشري مصطنع للنسخة");
  await page.screenshot({
    path: join(out, "review-desktop.png"),
    fullPage: true,
  });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: join(out, "review-overview.png"),
    fullPage: false,
  });
  await page.locator("[data-command=approve]").click();
  await page.locator("[data-command=publish]").waitFor();
  assert.equal(
    db
      .prepare(
        "SELECT COUNT(*) n FROM programs WHERE slug='synthetic-program-browser'",
      )
      .get().n,
    0,
  );
  metrics.review = true;
  await page.locator("[data-reason]").fill("نشر مصطنع داخل اختبار معزول");
  await page.locator("[data-command=publish]").click();
  await page.getByText("منشور", { exact: true }).waitFor();
  const publicPage = await desktop.newPage();
  await publicPage.goto(base + "/programs/synthetic-program-browser");
  assert.ok((await publicPage.locator("body").innerText()).includes("للغرفة"));
  assert.ok((await publicPage.locator("body").innerText()).includes("USD"));
  assert.equal(
    db
      .prepare("SELECT COUNT(*) n FROM program_versions WHERE workspace_id=?")
      .get(w.id).n,
    1,
  );
  await publicPage.screenshot({
    path: join(out, "public-program.png"),
    fullPage: true,
  });
  metrics.desktop = true;
  const mobile = await context({ width: 390, height: 844 }),
    phone = await mobile.newPage();
  phone.on("pageerror", (e) => metrics.pageErrors.push(e.message));
  await phone.goto(base + "/admin");
  await openStaffSection(phone,'programs');
  await phone.locator(`[data-open="${w.id}"]`).click();
  await phone.locator("[data-editor]").waitFor({ state: "visible" });
  const dimensions = await phone.evaluate(() => ({
    width: innerWidth,
    scroll: document.documentElement.scrollWidth,
    columns: getComputedStyle(
      document.querySelector(".pw-grid"),
    ).gridTemplateColumns.split(" ").length,
  }));
  assert.equal(dimensions.width, 390);
  assert.ok(dimensions.scroll <= 390, JSON.stringify(dimensions));
  assert.equal(dimensions.columns, 1);
  await phone.screenshot({
    path: join(out, "editor-mobile.png"),
    fullPage: true,
  });
  metrics.mobile = true;
  metrics.mobileDimensions = dimensions;
  await page.locator("[data-back]").click();
  await page.locator(`[data-open="${w.id}"]`).waitFor();
  await page.screenshot({
    path: join(out, "archive-desktop.png"),
    fullPage: true,
  });
  assert.deepEqual(metrics.pageErrors, []);
  writeFileSync(join(out, "metrics.json"), JSON.stringify(metrics, null, 2));
  console.log("PROGRAM_BROWSER_ACCEPTANCE 3/3", JSON.stringify(metrics));
} finally {
  await browser.close();
  await app.close();
}
