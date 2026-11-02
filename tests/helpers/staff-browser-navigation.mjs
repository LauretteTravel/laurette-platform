// Exercise the real navigation on the workspace drawer/rail and legacy sections.
export async function openStaffSection(page, id) {
  await page.locator('#view[aria-busy="false"]').waitFor();
  const selector = `[data-section="${id}"]:not([data-workspace-filter])`;
  const menu = page.locator("[data-workspace-menu]");
  let target;
  if (await menu.isVisible()) {
    await menu.click();
    target = page.locator(".wx-mobile-nav").locator(selector).first();
  } else {
    target = page.locator(".admin-side").locator(selector).first();
  }
  const details = target.locator("xpath=ancestor::details[1]");
  if ((await details.count()) && (await details.getAttribute("open")) === null)
    await details.locator(":scope > summary").click();
  await target.click();
}
