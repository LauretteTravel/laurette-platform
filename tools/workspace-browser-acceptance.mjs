import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join, resolve, relative } from "node:path";
import { createRequire } from "node:module";
import { workspaceFixture } from "../tests/helpers/workspace-fixture.mjs";
const local = process.env.WORKSPACE_LOCAL_QUALITY === "1";
assert.ok(
  process.env.CI === "true" || local,
  "Synthetic browser tests run only in CI or explicit local-quality mode",
);
const deps = process.env.WORKSPACE_TEST_DEPS || process.env.VOUCHER_TEST_DEPS;
assert.ok(deps, "Isolated test dependencies required");
const out = local
  ? resolve("data/phase1b-testing/workspace-ui")
  : join(process.env.VOUCHER_EVIDENCE, "workspace");
assert.ok(
  !relative(
    local ? resolve("data/phase1b-testing") : resolve(process.env.RUNNER_TEMP),
    out,
  ).startsWith(".."),
);
mkdirSync(out, { recursive: true });
const require = createRequire(join(resolve(deps), "package.json")),
  { chromium } = require("playwright");
const axeSource = readFileSync(
  process.env.WORKSPACE_AXE_SOURCE || require.resolve("axe-core/axe.min.js"),
  "utf8",
);
const fixture = await workspaceFixture(),
  { app, db, base, owner, reader } = fixture;
const browser = await chromium.launch({
  headless: true,
  ...(local
    ? {
        executablePath:
          process.env.WORKSPACE_BROWSER_EXECUTABLE ||
          "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
      }
    : {}),
});
const metrics = {
  syntheticOnly: true,
  desktop: false,
  referenceSize: false,
  roles: false,
  navigation: false,
  search: false,
  quickActions: false,
  currencies: false,
  todayWork: false,
  activities: false,
  mobile: false,
  tablet: false,
  states: false,
  errors: [],
  externalNetworkBlocked: true,
};
metrics.accessibility = [];
async function scan(p, name) {
  await p.evaluate(axeSource);
  const result = await p.evaluate(async () =>
    axe.run(document, {
      runOnly: {
        type: "tag",
        values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"],
      },
    }),
  );
  metrics.accessibility.push({
    name,
    violations: result.violations.map((v) => ({
      id: v.id,
      nodes: v.nodes.map((n) => ({
        target: n.target,
        summary: n.failureSummary,
      })),
    })),
    passes: result.passes.length,
    incomplete: result.incomplete.map((v) => v.id),
  });
  assert.equal(
    result.violations.length,
    0,
    JSON.stringify(metrics.accessibility.at(-1)),
  );
}
async function context(viewport, { auth = true, reduce = false } = {}) {
  const c = await browser.newContext({
    viewport,
    locale: "ar-JO",
    timezoneId: "Asia/Amman",
    reducedMotion: reduce ? "reduce" : "no-preference",
  });
  await c.route("**/*", (r) =>
    r
      .request()
      .url()
      .startsWith(base + "/")
      ? r.continue()
      : r.abort(),
  );
  if (auth)
    await c.addCookies([{ name: "lt_session", value: owner.token, url: base }]);
  c.on("page", (p) => p.on("pageerror", (e) => metrics.errors.push(e.message)));
  return c;
}
async function ready(p) {
  await p.locator("[data-workspace-heading]").waitFor();
  await p
    .locator("[data-workspace-currencies] .wx-currency-item")
    .first()
    .waitFor();
  await p.waitForFunction(
    () =>
      document.querySelector("#view")?.getAttribute("aria-busy") === "false",
  );
  await p.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(
      [...document.querySelectorAll(".wx-workspace img")]
        .filter((i) => i.getBoundingClientRect().top < innerHeight)
        .map((i) => i.decode().catch(() => {})),
    );
  });
}
async function home(p) {
  await p.locator("[data-section=overview]").first().click();
  await ready(p);
}
async function close(p) {
  await p.keyboard.press("Escape");
  await p.locator("dialog[open]").waitFor({ state: "detached" });
}
try {
  const c = await context({ width: 1440, height: 900 }),
    p = await c.newPage();
  await p.goto(base + "/admin");
  await ready(p);
  const api = await (await p.request.get(base + "/api/admin/overview")).json();
  for (const [target, key] of [
    ["bookings", "upcomingBookings"],
    ["new", "newCustomers"],
    ["quotes", "waitingQuotes"],
    ["followups", "todayFollowUps"],
    ["tasks", "overdueTasks"],
  ])
    assert.equal(
      await p.locator(`[data-workspace-kpi=${target}] strong`).innerText(),
      String(api.workspace.metrics[key]),
    );
  assert.equal(await p.locator(".wx-work-row").count(), 4);
  assert.equal(
    await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    true,
  );
  metrics.layout = await p.evaluate(() => {
    const side = document.querySelector(".admin-side").getBoundingClientRect(),
      today = document.querySelector(".wx-today").getBoundingClientRect(),
      activity = document.querySelector(".wx-updates").getBoundingClientRect();
    return {
      sidebarWidth: side.width,
      sidebarRight: side.right,
      todayX: today.x,
      activityX: activity.x,
      pageWidth: document.documentElement.scrollWidth,
      viewportWidth: innerWidth,
    };
  });
  assert.equal(metrics.layout.sidebarRight, 1440);
  assert.ok(metrics.layout.todayX > metrics.layout.activityX);
  await p.screenshot({
    path: join(out, "workspace-desktop-1440.png"),
    fullPage: false,
  });
  metrics.desktop = true;
  await scan(p, "desktop");
  await p.keyboard.press("Control+k");
  assert.equal(
    await p
      .locator("#workspaceSearch")
      .evaluate((e) => document.activeElement === e),
    true,
  );
  await p.keyboard.press("Escape");
  await p.setViewportSize({ width: 1672, height: 941 });
  await p.screenshot({
    path: join(out, "workspace-reference-1672.png"),
    fullPage: false,
  });
  metrics.referenceSize = true;
  await p.setViewportSize({ width: 1440, height: 900 });
  await p.locator("[data-workspace-currency-more]").click();
  await p.locator(".wx-calculator").waitFor();
  await scan(p, "currency calculator");
  await p.locator(".wx-calculator [name=amount]").fill("100");
  assert.ok(
    (await p.locator(".wx-calculator output").innerText()).includes("71 JOD"),
  );
  assert.ok(
    (await p.locator(".wx-calculator output").innerText()).includes("يدوي"),
  );
  await p.screenshot({
    path: join(out, "workspace-currency-panel.png"),
    fullPage: false,
  });
  await p.locator("[data-wx-manage]").click();
  await p.locator("[data-wx-currency-form]").waitFor();
  const form = p.locator("[data-wx-currency-form]");
  await scan(p, "currency management");
  await form.locator("[name=value]").fill("0.73");
  await form.locator("[name=source]").fill("مصدر يدوي لاختبار الحفظ");
  const time = await p.evaluate(() => {
    const local = (d) =>
      new Date(d.getTime() - d.getTimezoneOffset() * 60000)
        .toISOString()
        .slice(0, 16);
    return {
      from: local(new Date()),
      to: local(new Date(Date.now() + 3600000)),
    };
  });
  await form.locator("[name=asOf]").fill(time.from);
  await form.locator("[name=validUntil]").fill(time.to);
  await form.locator("[name=reason]").fill("تعديل اختبار موثق");
  await form.locator("[type=submit]").click();
  await p.locator("dialog[open]").waitFor({ state: "detached" });
  assert.ok(
    (await p.locator("[data-workspace-currencies]").innerText()).includes(
      "0.730",
    ),
  );
  metrics.currencies = true;
  await p.locator("[data-workspace-tab=new]").click();
  await p.waitForFunction(
    () =>
      document
        .querySelector("[data-workspace-tab=new]")
        ?.getAttribute("aria-pressed") === "true",
  );
  assert.equal(await p.locator(".wx-work-row").count(), 4);
  await p.locator('[data-workspace-page="2"]').click();
  await p.waitForFunction(
    () => document.querySelectorAll(".wx-work-row").length === 2,
  );
  await p.locator("[data-workspace-kpi=followups]").click();
  await p.waitForFunction(
    () => document.querySelectorAll(".wx-work-row").length === 4,
  );
  metrics.todayWork = true;
  await p.locator("[data-workspace-all-activity]").click();
  await p.locator("dialog[open] [data-next]").waitFor();
  assert.equal(await p.locator("dialog[open] [data-work-activity]").count(), 4);
  await p.locator("dialog[open] [data-next]").click();
  await p.waitForFunction(
    () =>
      document.querySelectorAll("dialog[open] [data-work-activity]").length ===
      2,
  );
  await close(p);
  metrics.activities = true;
  await p.locator("#workspaceSearch").fill("عميل اختبار 2");
  await p.locator("[data-search-result]").first().waitFor();
  assert.ok(
    (await p.locator("#workspaceSearchResults").innerText()).includes(
      "عميل اختبار 2",
    ),
  );
  await p.locator("[data-search-result]").first().click();
  await p.locator("dialog[open]").waitFor();
  assert.ok(
    (await p.locator("dialog[open]").innerText()).includes("عميل اختبار 2"),
  );
  await close(p);
  metrics.search = true;
  await p.locator("[data-workspace-quick=customers]").click();
  await p.locator("#cSearch").waitFor();
  assert.equal(
    await p
      .locator("body")
      .evaluate((e) => e.classList.contains("workspace-mode")),
    false,
  );
  await home(p);
  metrics.navigation = true;
  await p.locator("[data-workspace-quick=new]").click();
  const customerForm = p.locator("[data-wx-customer]");
  await customerForm.waitFor();
  await customerForm.locator("[name=name]").fill("عميل إدخال مصطنع");
  await customerForm.locator("[name=phone]").fill("+962790001234");
  await customerForm
    .locator("[name=message]")
    .fill("استشارة سفر مصطنعة للتحقق من حفظ بيانات العميل فعليًا");
  await customerForm.locator("[name=consent]").check();
  await customerForm.locator("[type=submit]").click();
  await p.waitForFunction(() => !document.querySelector("[data-wx-customer]"));
  assert.equal(
    db
      .prepare("SELECT COUNT(*) n FROM customers WHERE phone=?")
      .get("+962790001234").n,
    1,
  );
  assert.equal(
    db.prepare("SELECT COUNT(*) n FROM requests WHERE type='consult'").get().n,
    1,
  );
  await p.locator("dialog[open]").waitFor();
  await close(p);
  metrics.quickActions = true;
  const mobile = await context({ width: 390, height: 844 }, { reduce: true }),
    mp = await mobile.newPage();
  await mp.goto(base + "/admin");
  await ready(mp);
  assert.equal(
    await mp.evaluate(() => document.documentElement.scrollWidth),
    390,
  );
  assert.ok(await mp.locator("[data-workspace-menu]").isVisible());
  await scan(mp, "mobile 390 reduced motion");
  await mp.screenshot({
    path: join(out, "workspace-mobile-390.png"),
    fullPage: true,
  });
  await mp.locator("[data-workspace-menu]").click();
  await mp.locator(".wx-mobile-nav").waitFor();
  await scan(mp, "mobile navigation drawer");
  await mp.locator(".wx-mobile-nav [data-section=requests]").first().click();
  await mp.locator("[data-request]").first().waitFor();
  assert.equal(await mp.locator("dialog[open]").count(), 0);
  metrics.mobile = true;
  await p.setViewportSize({ width: 1024, height: 900 });
  await p.screenshot({
    path: join(out, "workspace-tablet-1024.png"),
    fullPage: true,
  });
  assert.equal(
    await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    true,
  );
  await scan(p, "tablet 1024");
  await p.setViewportSize({ width: 800, height: 900 });
  assert.ok(await p.locator(".wx-updates").isVisible());
  assert.equal(
    await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    true,
  );
  await p.screenshot({
    path: join(out, "workspace-tablet-800.png"),
    fullPage: true,
  });
  await mp.setViewportSize({ width: 320, height: 740 });
  await home(mp);
  assert.equal(
    await mp.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    true,
  );
  metrics.tablet = true;
  const restricted = await context(
      { width: 1440, height: 900 },
      { auth: false },
    ),
    rp = await restricted.newPage();
  await rp.goto(base + "/admin");
  await rp.locator("#lu").fill(reader.key);
  await rp.locator("#lp").fill(fixture.password);
  await rp.locator("#loginForm [type=submit]").click();
  await ready(rp);
  assert.equal(await rp.locator("[data-section=users]").count(), 0);
  assert.equal(await rp.locator("[data-workspace-quick=new]").count(), 0);
  assert.ok((await rp.locator(".wx-empty").innerText()).includes("لا توجد"));
  await rp.locator("[data-workspace-currency-more]").click();
  assert.equal(await rp.locator("[data-wx-manage]").count(), 0);
  await close(rp);
  assert.equal(
    (
      await rp.request.patch(base + "/api/admin/exchange-rates", {
        headers: { origin: base, "x-requested-with": "fetch" },
        data: {},
      })
    ).status(),
    403,
  );
  metrics.roles = true;
  await rp.route("**/api/admin/overview*", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ ok: false, message: "خطأ اختبار مصطنع" }),
    }),
  );
  await rp.locator("[data-workspace-refresh]").click();
  await rp.locator("[data-workspace-retry]").waitFor();
  assert.ok(
    (await rp.locator(".wx-failure").innerText()).includes("خطأ اختبار"),
  );
  await rp.unroute("**/api/admin/overview*");
  await rp.locator("[data-workspace-retry]").click();
  await ready(rp);
  metrics.states = true;
  assert.deepEqual(metrics.errors, []);
  console.log("WORKSPACE_BROWSER_ACCEPTANCE 12/12", JSON.stringify(metrics));
} finally {
  writeFileSync(join(out, "metrics.json"), JSON.stringify(metrics, null, 2));
  await browser.close();
  await app.close();
}
