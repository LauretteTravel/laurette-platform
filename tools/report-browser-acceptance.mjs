import assert from "node:assert/strict";
import { openStaffSection } from '../tests/helpers/staff-browser-navigation.mjs';
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve, relative, isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import { createApp } from "../server.js";
import { createSession, hashPassword } from "../lib/auth.js";
import { reportRange } from "../lib/report-time.js";
assert.equal(process.env.CI, "true");
assert.equal(process.platform, "linux");
const deps = process.env.VOUCHER_TEST_DEPS,
  out = join(process.env.VOUCHER_EVIDENCE, "phase5");
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
const seed = JSON.parse(readFileSync("data/seed.json")),
  app = createApp({
    dbFile: ":memory:",
    seed: { ...seed, users: [] },
    adminPassword: "Synthetic-Report-Browser42",
    baseUrl: "http://127.0.0.1:0",
  }),
  db = app.db,
  now = new Date().toISOString(),
  range = reportRange({}, now),
  branch = db.prepare("SELECT id FROM branches LIMIT 1").get().id,
  department = db
    .prepare("SELECT id FROM departments WHERE branch_id IS NULL LIMIT 1")
    .get().id,
  pw = hashPassword("Synthetic-Report-Browser42");
function actor(key, permissions) {
  db.prepare(
    "INSERT INTO role_definitions(role_key,name,base_role,data_scope,permissions,created_at,updated_at) VALUES(?,?,?,?,?,?,?)",
  ).run(
    key,
    key,
    "agent",
    "organization",
    JSON.stringify(permissions),
    now,
    now,
  );
  const id = Number(
    db
      .prepare(
        "INSERT INTO users(username,name,role,role_key,branch_id,department_id,password_hash,password_salt,created_at) VALUES(?,?,?,?,?,?,?,?,?)",
      )
      .run(
        key,
        "مراجع تقارير مصطنع",
        "agent",
        key,
        branch,
        department,
        pw.hash,
        pw.salt,
        now,
      ).lastInsertRowid,
  );
  return {
    id,
    token: createSession(db, id, "127.0.0.1", "synthetic", {
      mfaVerified: true,
    }).token,
  };
}
const owner = actor("report-browser", [
    "overview:read",
    "reports:read",
    "reports:export",
    "reports:finance",
    "reports:targets",
    "requests:read",
    "customers:read",
    "tasks:read",
  ]),
  limited = actor("report-reader", [
    "overview:read",
    "reports:read",
    "requests:read",
  ]);
const at = new Date(Date.parse(range.start) + 3600000).toISOString(),
  prev = new Date(Date.parse(range.previous.start) + 3600000).toISOString();
for (let i = 0; i < 14; i++) {
  const created = i < 12 ? at : prev,
    won = i % 3 === 0,
    lost = i % 3 === 1,
    source = i < 8 ? "مصدر مصطنع أ" : "مصدر مصطنع ب";
  const request = Number(
    db
      .prepare(
        "INSERT INTO requests(reference,type,status,deal_status,assigned_to,branch_id,received_branch_id,department_id,payload,source,lead_origin,created_at,updated_at,first_response_at,completed_at,lost_reason) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      )
      .run(
        "SYN-REPORT-" + i,
        i % 2 ? "hotel" : "flight",
        won ? "confirmed" : lost ? "cancelled" : "new",
        won ? "won" : lost ? "lost" : "new",
        owner.id,
        branch,
        branch,
        department,
        "{}",
        source,
        source,
        created,
        created,
        new Date(Date.parse(created) + 900000).toISOString(),
        won || lost
          ? new Date(Date.parse(created) + 3600000).toISOString()
          : null,
        lost ? "سبب خسارة مصطنع" : null,
      ).lastInsertRowid,
  );
  if (won) {
    const booking = Number(
      db
        .prepare(
          "INSERT INTO bookings(request_id,reference,status,amount,cost_amount,currency,confirmed_by,confirmed_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)",
        )
        .run(
          request,
          "SYN-BK-" + i,
          "confirmed",
          100 + i * 10,
          i === 3 ? null : 60,
          i % 2 ? "USD" : "JOD",
          owner.id,
          created,
          created,
        ).lastInsertRowid,
    );
    db.prepare(
      "INSERT INTO booking_payments(booking_id,kind,amount,currency,recorded_by,created_at) VALUES(?,?,?,?,?,?)",
    ).run(booking, "receipt", 50, i % 2 ? "USD" : "JOD", owner.id, created);
  }
  if (i < 4)
    db.prepare(
      "INSERT INTO tasks(branch_id,department_id,request_id,title,priority,status,assigned_to,created_by,due_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
    ).run(
      branch,
      department,
      request,
      "مهمة تقرير مصطنعة",
      "normal",
      "new",
      owner.id,
      owner.id,
      created,
      created,
      created,
    );
}
const address = await app.listen(0, "127.0.0.1"),
  base = `http://127.0.0.1:${address.port}`,
  browser = await chromium.launch({ headless: true }),
  metrics = {
    desktop: false,
    filteredExports: false,
    targets: false,
    mobile: false,
    restrictedReader: false,
    externalNetworkBlocked: true,
    errors: [],
  };
async function context(viewport, who = owner) {
  const c = await browser.newContext({
    viewport,
    locale: "ar-JO",
    timezoneId: "Asia/Amman",
    acceptDownloads: true,
  });
  await c.route("**/*", (r) =>
    r
      .request()
      .url()
      .startsWith(base + "/")
      ? r.continue()
      : r.abort(),
  );
  await c.addCookies([{ name: "lt_session", value: who.token, url: base }]);
  return c;
}
async function reports(page) {
  page.on("pageerror", (e) => metrics.errors.push(e.message));
  await page.goto(base + "/admin");
  await openStaffSection(page,'reports');
  await page.locator("[data-rp-filters]").waitFor({ state: "visible" });
}
try {
  const desktop = await context({ width: 1440, height: 1000 }),
    page = await desktop.newPage();
  await reports(page);
  assert.equal(await page.locator("[data-drill=requests] b").innerText(), "12");
  assert.equal(await page.locator("[data-report-csv]").count(), 1);
  await page.screenshot({
    path: join(out, "dashboard-desktop.png"),
    fullPage: false,
  });
  metrics.desktop = true;
  await page.locator("[data-rp-filters] [name=source]").fill("مصدر مصطنع أ");
  await page
    .locator("[data-rp-filters] [name=employee]")
    .selectOption(String(owner.id));
  await page
    .locator("[data-rp-filters]")
    .getByRole("button", { name: "تطبيق", exact: true })
    .click();
  await page.waitForFunction(
    () =>
      document.querySelector("[data-drill=requests] b")?.textContent === "8",
  );
  assert.equal(await page.locator("[data-drill=requests] b").innerText(), "8");
  await page.locator("[data-drill=requests]").click();
  await page.locator("[data-detail-view] table").waitFor();
  assert.equal(await page.locator("[data-detail-view] tbody tr").count(), 8);
  const csvPromise = page.waitForEvent("download");
  await page.locator("[data-report-csv]").click();
  const csv = await csvPromise;
  await csv.saveAs(join(out, "filtered-report.csv"));
  const content = readFileSync(join(out, "filtered-report.csv"), "utf8");
  assert.ok(content.includes("مصدر مصطنع أ"));
  assert.ok(!content.includes("مصدر مصطنع ب"));
  const popupPromise = page.waitForEvent("popup");
  await page.locator("[data-report-pdf]").click();
  const doc = await popupPromise;
  await doc.locator("#rdPdf").waitFor();
  const html = await doc.locator("#rdSheet").innerText();
  assert.ok(html.includes("مصدر مصطنع أ"));
  assert.ok(!html.includes("مصدر مصطنع ب"));
  assert.ok(html.includes("هامش تقديري"));
  assert.ok(!html.includes("quote_amount"));
  const pdfPromise = doc.waitForEvent("download", { timeout: 60000 }),
    started = Date.now();
  await doc.locator("#rdPdf").click();
  const file = await pdfPromise;
  await file.saveAs(join(out, "report.pdf"));
  metrics.pdfMs = Date.now() - started;
  assert.ok(metrics.pdfMs < 30000);
  const info = execFileSync("pdfinfo", [join(out, "report.pdf")], {
    encoding: "utf8",
  });
  metrics.pdfPages = Number(info.match(/^Pages:\s+(\d+)/m)?.[1]);
  assert.ok(metrics.pdfPages >= 2 && metrics.pdfPages <= 30, info);
  assert.match(info, /595\.2\d\s+x\s+841\.8\d/);
  execFileSync(
    "pdftoppm",
    ["-scale-to", "1400", "-png", join(out, "report.pdf"), join(out, "report")],
    { timeout: 60000 },
  );
  metrics.pdfBytes = readFileSync(join(out, "report.pdf")).length;
  metrics.filteredExports = true;
  await page.locator("[data-reset]").click();
  await page.waitForFunction(
    () =>
      document.querySelector("[data-drill=requests] b")?.textContent === "12",
  );
  await page.getByText("إضافة هدف موثق", { exact: true }).click();
  const form = page.locator("[data-goal-form]");
  await form.locator("[name=branchId]").selectOption(String(branch));
  await form.locator("[name=departmentId]").selectOption(String(department));
  await form.locator("[name=employeeId]").selectOption(String(owner.id));
  await form.locator("[name=value]").fill("20");
  await form.locator("[name=reason]").fill("هدف مصطنع للمراجعة");
  await form.getByRole("button", { name: "حفظ الهدف", exact: true }).click();
  await page.locator("[data-goal-history]").first().waitFor();
  const g = db.prepare("SELECT * FROM report_targets").get();
  assert.equal(g.value, 20);
  assert.equal(g.created_by, owner.id);
  await page.locator("[data-goal-history]").first().click();
  await page.locator("[data-history-dialog]").waitFor({ state: "visible" });
  assert.ok(
    (await page.locator("[data-history-content]").innerText()).includes(
      "هدف مصطنع للمراجعة",
    ),
  );
  await page.locator("[data-close-history]").click();
  metrics.targets = true;
  const mobile = await context({ width: 390, height: 844 }),
    phone = await mobile.newPage();
  await reports(phone);
  const dims = await phone.evaluate(() => ({
    width: innerWidth,
    scroll: document.documentElement.scrollWidth,
    columns: getComputedStyle(
      document.querySelector(".rp-filters"),
    ).gridTemplateColumns.split(" ").length,
  }));
  assert.equal(dims.width, 390);
  assert.ok(dims.scroll <= 390, JSON.stringify(dims));
  assert.equal(dims.columns, 1);
  const employeeCell = await phone
    .locator('[data-group-key="employee"]')
    .first()
    .evaluate((el) => ({
      width: el.getBoundingClientRect().width,
      height: el.closest("td").getBoundingClientRect().height,
    }));
  assert.ok(
    employeeCell.width >= 100 && employeeCell.height < 110,
    JSON.stringify(employeeCell),
  );
  metrics.mobileEmployeeCell = employeeCell;
  await phone.screenshot({
    path: join(out, "dashboard-mobile.png"),
    fullPage: true,
  });
  metrics.mobile = true;
  metrics.mobileDimensions = dims;
  const reader = await context({ width: 1280, height: 900 }, limited),
    readonly = await reader.newPage();
  await reports(readonly);
  assert.equal(await readonly.locator("[data-report-csv]").count(), 0);
  assert.equal(await readonly.locator("[data-report-pdf]").count(), 0);
  assert.ok(
    (await readonly.locator(".rp").innerText()).includes(
      "تحتاج صلاحية التقارير المالية",
    ),
  );
  metrics.restrictedReader = true;
  assert.deepEqual(metrics.errors, []);
  writeFileSync(join(out, "metrics.json"), JSON.stringify(metrics, null, 2));
  console.log("REPORT_BROWSER_ACCEPTANCE 4/4", JSON.stringify(metrics));
} finally {
  await browser.close();
  await app.close();
}
