/**
 * Dashboard Share Link Functional Tests
 *
 * Tests for PR #9878: fix: dashboard share url
 * Verifies that the share link correctly captures and preserves dashboard state
 * including time ranges, tabs, variables, and auto-refresh intervals.
 *
 * The fix ensures dashboardShareURL recomputes reactively when route changes
 * by adding a dependency on route.fullPath.
 */

const { test, expect, navigateToBase } = require("../utils/enhanced-baseFixtures.js");
const testLogger = require("../utils/test-logger.js");
const PageManager = require("../../pages/page-manager.js");
import { ingestion } from "./utils/dashIngestion.js";
import { waitForDashboardPage, deleteDashboard } from "./utils/dashCreation.js";

test.describe("Dashboard Share Link Functional Tests", { tag: ["@dashboardShareLink"] }, () => {
  test.describe.configure({ mode: "parallel" });

  const generateDashboardName = (prefix = "ShareLinkDash") =>
    `${prefix}_${Math.random().toString(36).slice(2, 9)}`;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    await ingestion(page);
    testLogger.info("Test setup completed");
  });

  // =====================================================
  // P0 - SMOKE TEST (Critical Path)
  // =====================================================

  test("P0: should verify basic share link creates short URL with absolute time params", {
    tag: ["@dashboardShareLink", "@smoke", "@P0"],
  }, async ({ page, context }) => {
    const pm = new PageManager(page);
    const randomDashboardName = generateDashboardName();

    testLogger.step("Navigate to dashboards and create a new dashboard");
    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);
    await pm.dashboardCreate.createDashboard(randomDashboardName);

    await page
      .locator('[data-test="dashboard-if-no-panel-add-panel-btn"]')
      .waitFor({ state: "visible" });

    testLogger.step("Click share button and intercept short URL API");
    const { shortUrl, originalUrl } = await pm.dashboardShareExport.shareDashboardAndCaptureUrl();

    await expect(page.getByText("Link copied successfully")).toBeVisible();

    testLogger.step("Verify original URL has absolute time params (from/to, not period)");
    const sharedUrl = new URL(originalUrl);
    expect(sharedUrl.searchParams.has("period")).toBeFalsy();
    expect(sharedUrl.searchParams.has("from")).toBeTruthy();
    expect(sharedUrl.searchParams.has("to")).toBeTruthy();
    testLogger.assertion("Share URL uses absolute time (from/to) instead of relative period");

    testLogger.step("Open short URL in new page and verify redirect preserves params");
    const newPage = await context.newPage();
    await newPage.goto(shortUrl, { waitUntil: "load" });
    await newPage.waitForSelector(
      '[data-test="dashboard-if-no-panel-add-panel-btn"]',
      { state: "visible", timeout: 15000 },
    );

    const newPageUrl = new URL(newPage.url());
    expect(newPageUrl.searchParams.has("period")).toBeFalsy();
    expect(newPageUrl.searchParams.has("from")).toBeTruthy();
    expect(newPageUrl.searchParams.has("to")).toBeTruthy();
    testLogger.assertion("Redirected page preserves absolute time params");

    await newPage.close();

    testLogger.step("Cleanup: delete dashboard");
    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, randomDashboardName);
    testLogger.info("Test completed successfully");
  });

  // =====================================================
  // P1 - FUNCTIONAL TESTS
  // =====================================================

  test("P1: should verify share link across multiple tabs preserves active tab", {
    tag: ["@dashboardShareLink", "@functional", "@P1"],
  }, async ({ page, context }) => {
    const pm = new PageManager(page);
    const randomDashboardName = generateDashboardName();
    const newTabName = pm.dashboardSetting.generateUniqueTabnewName("Tab2");

    testLogger.step("Create dashboard and add a second tab");
    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);
    await pm.dashboardCreate.createDashboard(randomDashboardName);

    await pm.dashboardSetting.openSetting();
    await page.locator('[data-test="dashboard-settings-tab-tab"]').click();
    await pm.dashboardSetting.addTabSetting(newTabName);
    await pm.dashboardSetting.saveTabSetting();

    await expect(page.getByText("Tab added successfully")).toBeVisible();
    await pm.dashboardSetting.closeSettingDashboard();

    testLogger.step("Switch to the new tab");
    const tabButton = page
      .locator(".q-tabs .q-tab")
      .filter({ hasText: newTabName });
    await tabButton.waitFor({ state: "visible", timeout: 15000 });
    await tabButton.click();
    await expect(tabButton).toHaveClass(/q-tab--active/);

    testLogger.step("Share dashboard and capture URL");
    const { shortUrl, originalUrl } = await pm.dashboardShareExport.shareDashboardAndCaptureUrl();
    await expect(page.getByText("Link copied successfully")).toBeVisible();

    testLogger.step("Verify tab param is in the shared URL");
    const sharedUrl = new URL(originalUrl);
    const tabId = sharedUrl.searchParams.get("tab");
    expect(tabId).toBeTruthy();
    expect(tabId).not.toBe(sharedUrl.searchParams.get("dashboard"));
    testLogger.assertion("Share URL includes tab parameter distinct from dashboard ID");

    testLogger.step("Open short URL in new page and verify correct tab is active");
    const newPage = await context.newPage();
    await newPage.goto(shortUrl, { waitUntil: "load" });
    await newPage.waitForSelector(".q-tabs .q-tab", {
      state: "visible",
      timeout: 15000,
    });

    const activeTabOnNewPage = newPage
      .locator(".q-tabs .q-tab--active")
      .filter({ hasText: newTabName });
    await expect(activeTabOnNewPage).toBeVisible({ timeout: 15000 });
    testLogger.assertion("Correct tab is active after short URL redirect");

    await newPage.close();

    testLogger.step("Cleanup: delete dashboard");
    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, randomDashboardName);
    testLogger.info("Test completed successfully");
  });

  test("P1: should verify share link includes dashboard variables", {
    tag: ["@dashboardShareLink", "@functional", "@P1"],
  }, async ({ page, context }) => {
    const pm = new PageManager(page);
    const randomDashboardName = generateDashboardName();
    const varName = `test_var_${Math.random().toString(36).slice(2, 7)}`;
    const varValue = "test_val";

    testLogger.step("Create dashboard and add a constant variable");
    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);
    await pm.dashboardCreate.createDashboard(randomDashboardName);

    await pm.dashboardSetting.openSetting();
    await pm.dashboardSetting.goToVariablesTab();
    await pm.dashboardSetting.selectConstantType("Constant", varName, varValue);

    await expect(
      page.locator('[data-test="dashboard-variable-name"]'),
    ).toHaveValue(varName);

    const constantValueInput = page.locator(
      '[data-test="dashboard-variable-constant-value"]',
    );
    await expect(constantValueInput).toHaveValue(varValue);
    await constantValueInput.press("Tab");

    await page.locator('[data-test="dashboard-variable-save-btn"]').click();

    await page
      .locator('[data-test="dashboard-variable-save-btn"]')
      .waitFor({ state: "hidden", timeout: 15000 });

    const variableRow = page.locator(
      `[data-test="dashboard-edit-variable-${varName}"]`,
    );
    await variableRow.waitFor({ state: "visible", timeout: 15000 });
    await expect(variableRow).toBeVisible();
    testLogger.assertion("Variable created and visible in settings list");

    testLogger.step("Close settings and wait for URL to include variable");
    await page
      .locator('[data-test="dashboard-settings-close-btn"]')
      .evaluate((el) => el.click());

    await page
      .locator('[data-test="dashboard-share-btn"]')
      .waitFor({ state: "visible" });

    await expect(page).toHaveURL(new RegExp(`var-${varName}=${varValue}`), {
      timeout: 15000,
    });

    testLogger.step("Share dashboard and verify variable is in URL");
    const { shortUrl, originalUrl } = await pm.dashboardShareExport.shareDashboardAndCaptureUrl();
    await expect(page.getByText("Link copied successfully")).toBeVisible();

    expect(originalUrl).toContain(`var-${varName}=${varValue}`);
    testLogger.assertion("Share URL includes variable param");

    testLogger.step("Open short URL and verify variable is preserved");
    const newPage = await context.newPage();
    await newPage.goto(shortUrl, { waitUntil: "load" });
    await newPage.waitForSelector(
      '[data-test="dashboard-if-no-panel-add-panel-btn"]',
      { state: "visible", timeout: 15000 },
    );

    await expect(newPage).toHaveURL(new RegExp(`var-${varName}=${varValue}`), {
      timeout: 15000,
    });
    testLogger.assertion("Variable preserved in redirected URL");

    await newPage.close();

    testLogger.step("Cleanup: delete dashboard");
    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, randomDashboardName);
    testLogger.info("Test completed successfully");
  });

  test("P1: should verify share link includes auto-refresh interval", {
    tag: ["@dashboardShareLink", "@functional", "@P1"],
  }, async ({ page, context }) => {
    const pm = new PageManager(page);
    const randomDashboardName = generateDashboardName();

    testLogger.step("Create dashboard and set auto-refresh to 5s");
    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);
    await pm.dashboardCreate.createDashboard(randomDashboardName);

    await page
      .locator('[data-test="logs-search-bar-refresh-interval-btn-dropdown"]')
      .click();
    await page.locator('[data-test="logs-search-bar-refresh-time-5"]').click();

    testLogger.step("Share dashboard and verify refresh param");
    const { shortUrl, originalUrl } = await pm.dashboardShareExport.shareDashboardAndCaptureUrl();
    await expect(page.getByText("Link copied successfully")).toBeVisible();

    const sharedUrl = new URL(originalUrl);
    expect(sharedUrl.searchParams.get("refresh")).toBe("5s");
    testLogger.assertion("Share URL includes refresh=5s param");

    testLogger.step("Open short URL and verify refresh is preserved");
    const newPage = await context.newPage();
    await newPage.goto(shortUrl, { waitUntil: "load" });
    await newPage.waitForSelector(
      '[data-test="dashboard-if-no-panel-add-panel-btn"]',
      { state: "visible", timeout: 15000 },
    );

    const newPageUrl = new URL(newPage.url());
    expect(newPageUrl.searchParams.get("refresh")).toBe("5s");
    testLogger.assertion("Refresh param preserved after redirect");

    await newPage.close();

    testLogger.step("Cleanup: delete dashboard");
    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, randomDashboardName);
    testLogger.info("Test completed successfully");
  });

  test("P1: should verify share link preserves absolute time range", {
    tag: ["@dashboardShareLink", "@functional", "@P1"],
  }, async ({ page, context }) => {
    const pm = new PageManager(page);
    const randomDashboardName = generateDashboardName();
    const fromTime = "1706745600000";
    const toTime = "1706749200000";

    testLogger.step("Create dashboard and set absolute time range via URL");
    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);
    await pm.dashboardCreate.createDashboard(randomDashboardName);

    const currentUrl = new URL(page.url());
    currentUrl.searchParams.delete("period");
    currentUrl.searchParams.set("from", fromTime);
    currentUrl.searchParams.set("to", toTime);
    await page.goto(currentUrl.toString());
    await page.waitForLoadState("networkidle");

    testLogger.step("Share dashboard and verify absolute time params");
    const { shortUrl, originalUrl } = await pm.dashboardShareExport.shareDashboardAndCaptureUrl();
    await expect(page.getByText("Link copied successfully")).toBeVisible();

    const sharedUrl = new URL(originalUrl);
    const receivedFrom = sharedUrl.searchParams.get("from");
    expect(receivedFrom).toContain(fromTime);
    const receivedTo = sharedUrl.searchParams.get("to");
    expect(receivedTo).toContain(toTime);
    testLogger.assertion("Share URL preserves absolute from/to timestamps");

    testLogger.step("Open short URL and verify time range is preserved");
    const newPage = await context.newPage();
    await newPage.goto(shortUrl, { waitUntil: "load" });
    await newPage.waitForSelector(
      '[data-test="dashboard-if-no-panel-add-panel-btn"]',
      { state: "visible", timeout: 15000 },
    );

    const newPageUrl = new URL(newPage.url());
    const newPageFrom = newPageUrl.searchParams.get("from");
    const newPageTo = newPageUrl.searchParams.get("to");
    expect(newPageFrom).toContain(fromTime);
    expect(newPageTo).toContain(toTime);
    testLogger.assertion("Absolute time range preserved after redirect");

    await newPage.close();

    testLogger.step("Cleanup: delete dashboard");
    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, randomDashboardName);
    testLogger.info("Test completed successfully");
  });
});
