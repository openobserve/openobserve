const { test, expect, navigateToBase } = require("../utils/enhanced-baseFixtures.js");
const testLogger = require("../utils/test-logger.js");
const { isCloudEnvironment } = require("../../pages/cloudPages/cloud-env.js");

const DATA_TILE = '[data-test="menu-link-/streams-item"]';
const DATA_FLYOUT = '[data-test="nav-group-flyout-data"]';
const DATA_TOOLTIP = '[data-test="menu-link-/streams-tooltip"]';
const LOGS_TILE = '[data-test="menu-link-/logs-item"]';
const RAIL = '[data-test="navbar-main-nav"]';

test.describe("Cloud: trial-expired rail (AC-14)", () => {
  test.skip(!isCloudEnvironment(), "Cloud-only: the OSS backend never sends free_trial_expiry");
  test.describe.configure({ mode: "serial" });

  test("a muted group tile explains itself in its flyout, never in a tooltip", async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await page.setViewportSize({ width: 1440, height: 900 });
    await navigateToBase(page);

    const data = page.locator(DATA_TILE);
    await expect(data).toHaveAttribute("data-paywalled", "true");
    await data.hover();
    await expect(page.locator(DATA_FLYOUT)).toBeVisible();
    await expect(page.locator(DATA_FLYOUT).locator('[data-test="nav-group-flyout-data-trial-note"]')).toBeVisible();
    await expect(page.locator(DATA_TOOLTIP)).toHaveCount(0);
  });

  test("three blocked Logs clicks leave one toast with count 3 and the rail unmoved", async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await page.setViewportSize({ width: 1000, height: 600 });
    await navigateToBase(page);

    const logs = page.locator(LOGS_TILE);
    await expect(logs).toHaveAttribute("data-paywalled", "true");
    const before = await page.locator(RAIL).evaluate((el) => el.scrollTop);
    for (let i = 0; i < 3; i++) {
      await logs.click();
      await expect(page).toHaveURL(/plans/);
    }
    const toasts = page.locator('[data-test^="o-toast-"][data-test-variant="info"]');
    await expect(toasts).toHaveCount(1);
    await expect(toasts.first()).toContainText("Logs needs a plan");
    await expect(page.locator('[data-test="o-toast-count-3"]')).toBeVisible();
    expect(await page.locator(RAIL).evaluate((el) => el.scrollTop)).toBe(before);
  });
});
