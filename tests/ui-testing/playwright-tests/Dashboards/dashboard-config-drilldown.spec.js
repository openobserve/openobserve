const {
  test,
  expect,
  navigateToBase,
} = require("../utils/enhanced-baseFixtures.js");
import PageManager from "../../pages/page-manager";
import { ingestion } from "./utils/dashIngestion.js";
import { cleanupTestDashboard, deleteDashboard } from "./utils/dashCreation.js";
import {
  generateDashboardName,
  setupBarPanelWithConfig,
  setupTablePanelWithConfig,
  setupDestinationDashboardWithTabs,
  reopenPanelConfig,
} from "./utils/configPanelHelpers.js";
const testLogger = require('../utils/test-logger.js');

test.describe.configure({ mode: "parallel" });
test.describe.configure({ retries: 1 });

test.describe("ConfigPanel — Drilldown Configuration", () => {
  test.beforeEach(async ({ page }) => {
    await navigateToBase(page);
    await ingestion(page);
  });

  test("drilldown add: add button visible → popup opens → fill name → save → item appears in list", async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();

    await setupBarPanelWithConfig(page, pm, dashboardName);

    await pm.dashboardDrilldown.addDrilldownByLogs("Test Drilldown");

    const drilldownItem = pm.dashboardDrilldown.drilldownItemAt(0);
    await expect(drilldownItem).toBeVisible({ timeout: 5000 });
    await expect(drilldownItem).toContainText("Test Drilldown");
    testLogger.info("Drilldown item 'Test Drilldown' appears in list");

    await pm.dashboardPanelActions.applyDashboardBtn();
    await pm.dashboardPanelActions.waitForChartToRender();
    await pm.dashboardPanelActions.verifyChartHasData(expect);

    await pm.dashboardPanelActions.savePanel();
    await cleanupTestDashboard(page, pm, dashboardName);
  });

  test("drilldown remove: add drilldown → remove it → item disappears from list → apply → chart renders", async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();

    await setupBarPanelWithConfig(page, pm, dashboardName);

    await pm.dashboardDrilldown.addDrilldownByLogs("To Remove");

    const drilldownItem = pm.dashboardDrilldown.drilldownItemAt(0);
    await expect(drilldownItem).toBeVisible({ timeout: 5000 });
    testLogger.info("Drilldown 'To Remove' added — now removing");

    const removeBtn = pm.dashboardDrilldown.removeButtonAt(0);
    await removeBtn.waitFor({ state: "visible", timeout: 5000 });
    await removeBtn.click();

    await expect(drilldownItem).not.toBeVisible({ timeout: 5000 });
    testLogger.info("Drilldown removed — item no longer in list");

    await pm.dashboardPanelActions.applyDashboardBtn();
    await pm.dashboardPanelActions.waitForChartToRender();
    await pm.dashboardPanelActions.verifyChartHasData(expect);

    await pm.dashboardPanelActions.savePanel();
    await cleanupTestDashboard(page, pm, dashboardName);
  });

  test("drilldown persistence: add drilldown with name → save → reopen → name persists in list", async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();

    await setupBarPanelWithConfig(page, pm, dashboardName);

    await pm.dashboardDrilldown.addDrilldownByLogs("Persistent Drilldown");

    await expect(pm.dashboardDrilldown.drilldownItemAt(0)).toContainText("Persistent Drilldown");

    await pm.dashboardPanelActions.applyDashboardBtn();
    await pm.dashboardPanelActions.waitForChartToRender();
    await pm.dashboardPanelActions.verifyChartHasData(expect);

    await pm.dashboardPanelActions.savePanel();
    testLogger.info("Verifying drilldown persists after save");
    await reopenPanelConfig(page, pm);

    const savedItem = pm.dashboardDrilldown.drilldownItemAt(0);
    await savedItem.scrollIntoViewIfNeeded();
    await expect(savedItem).toContainText("Persistent Drilldown");
    testLogger.info("Drilldown 'Persistent Drilldown' persisted after save");

    await pm.dashboardPanelActions.savePanel();
    await cleanupTestDashboard(page, pm, dashboardName);
  });

  test("drilldown URL: add URL drilldown → error shown for invalid URL; valid URL saves → persists after reopen", async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();

    await setupBarPanelWithConfig(page, pm, dashboardName);

    // Open popup in URL mode to test validation before saving
    await pm.dashboardDrilldown.openURLPopup("URL Drilldown");

    // Invalid URL — no protocol → error message shown
    await pm.dashboardDrilldown.urlTextarea.fill("not-a-valid-url");
    await expect(pm.dashboardDrilldown.urlErrorMessage).toBeVisible({ timeout: 3000 });
    testLogger.info("Invalid URL shows error message");

    // Valid URL — error clears, Save becomes enabled
    await pm.dashboardDrilldown.urlTextarea.fill("https://openobserve.ai");
    await expect(pm.dashboardDrilldown.urlErrorMessage).not.toBeVisible({ timeout: 3000 });
    await expect(pm.dashboardDrilldown.confirmButton).toBeEnabled({ timeout: 3000 });
    await pm.dashboardDrilldown.confirmButton.click();
    await pm.dashboardDrilldown.popup.waitFor({ state: "hidden", timeout: 10000 });
    testLogger.info("URL drilldown saved with https://openobserve.ai");

    await expect(pm.dashboardDrilldown.drilldownItemAt(0)).toContainText("URL Drilldown");

    await pm.dashboardPanelActions.applyDashboardBtn();
    await pm.dashboardPanelActions.waitForChartToRender();
    await pm.dashboardPanelActions.verifyChartHasData(expect);

    await pm.dashboardPanelActions.savePanel();
    testLogger.info("Verifying URL drilldown persists after save");
    await reopenPanelConfig(page, pm);
    const savedItem = pm.dashboardDrilldown.drilldownItemAt(0);
    await savedItem.scrollIntoViewIfNeeded();
    await expect(savedItem).toContainText("URL Drilldown");
    testLogger.info("URL drilldown persisted after save");

    await pm.dashboardPanelActions.savePanel();
    await cleanupTestDashboard(page, pm, dashboardName);
  });

  test("drilldown byDashboard default tab: select folder → dashboard → default tab → save → persists after reopen", async ({ page }) => {
    const pm = new PageManager(page);
    const destinationDashName = generateDashboardName();
    const mainDashName = generateDashboardName();

    // Destination dashboard has only the Default tab
    await setupBarPanelWithConfig(page, pm, destinationDashName);
    await pm.dashboardPanelActions.savePanel();
    await pm.dashboardCreate.backToDashboardList();

    await setupBarPanelWithConfig(page, pm, mainDashName);

    await pm.dashboardDrilldown.addDrilldownByDashboard(
      "Dashboard Drilldown Default",
      "default",
      destinationDashName,
      "Default"
    );

    await expect(pm.dashboardDrilldown.drilldownItemAt(0)).toBeVisible({ timeout: 5000 });
    await expect(pm.dashboardDrilldown.drilldownItemAt(0)).toContainText("Dashboard Drilldown Default");
    testLogger.info("byDashboard drilldown (Default tab) appears in list");

    await pm.dashboardPanelActions.applyDashboardBtn();
    await pm.dashboardPanelActions.waitForChartToRender();
    await pm.dashboardPanelActions.verifyChartHasData(expect);

    await pm.dashboardPanelActions.savePanel();
    testLogger.info("Verifying byDashboard Default tab drilldown persists after save");
    await reopenPanelConfig(page, pm);
    const savedItem = pm.dashboardDrilldown.drilldownItemAt(0);
    await savedItem.scrollIntoViewIfNeeded();
    await expect(savedItem).toContainText("Dashboard Drilldown Default");
    testLogger.info("byDashboard Default tab drilldown persisted after save");

    await pm.dashboardPanelActions.savePanel();
    await cleanupTestDashboard(page, pm, mainDashName);
    await deleteDashboard(page, destinationDashName);
  });

  test("drilldown byDashboard second tab: select folder → dashboard → second tab → save → persists after reopen", async ({ page }) => {
    const pm = new PageManager(page);
    const destinationDashName = generateDashboardName();
    const mainDashName = generateDashboardName();

    // Create destination dashboard with a second tab "Tab Two"
    await setupDestinationDashboardWithTabs(page, pm, destinationDashName, "Tab Two");
    await pm.dashboardCreate.backToDashboardList();

    // Create main dashboard with config panel open
    await setupBarPanelWithConfig(page, pm, mainDashName);

    await pm.dashboardDrilldown.addDrilldownByDashboard(
      "Dashboard Drilldown",
      "default",
      destinationDashName,
      "Tab Two"
    );

    await expect(pm.dashboardDrilldown.drilldownItemAt(0)).toBeVisible({ timeout: 5000 });
    await expect(pm.dashboardDrilldown.drilldownItemAt(0)).toContainText("Dashboard Drilldown");
    testLogger.info("byDashboard drilldown appears in list");

    await pm.dashboardPanelActions.applyDashboardBtn();
    await pm.dashboardPanelActions.waitForChartToRender();
    await pm.dashboardPanelActions.verifyChartHasData(expect);

    await pm.dashboardPanelActions.savePanel();
    testLogger.info("Verifying byDashboard drilldown persists after save");
    await reopenPanelConfig(page, pm);
    const savedItem = pm.dashboardDrilldown.drilldownItemAt(0);
    await savedItem.scrollIntoViewIfNeeded();
    await expect(savedItem).toContainText("Dashboard Drilldown");
    testLogger.info("byDashboard drilldown persisted after save");

    await pm.dashboardPanelActions.savePanel();
    await cleanupTestDashboard(page, pm, mainDashName);
    await deleteDashboard(page, destinationDashName);
  });

  test("drilldown click same tab: click table row → popup appears with drilldown name → click item → navigates to logs", async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();

    await setupTablePanelWithConfig(page, pm, dashboardName);

    // Add a Logs drilldown (same tab, targetBlank=false by default)
    await pm.dashboardDrilldown.addDrilldownByLogs("Logs Drilldown");

    await expect(pm.dashboardDrilldown.drilldownItemAt(0)).toContainText("Logs Drilldown");

    await pm.dashboardPanelActions.applyDashboardBtn();
    await pm.dashboardPanelActions.waitForChartToRender();
    await pm.dashboardPanelActions.savePanel();
    // After savePanel we are on the dashboard VIEW page with the table rendered

    testLogger.info("Clicking table row to trigger drilldown popup");
    const drilldownMenu = await pm.dashboardDrilldown.triggerDrilldownFromTable();
    await expect(drilldownMenu).toBeVisible({ timeout: 5000 });
    testLogger.info("Drilldown popup visible after table row click");

    await expect(pm.dashboardDrilldown.drilldownMenuFirstItem).toContainText("Logs Drilldown");

    // Click menu item — same tab, current page navigates to logs
    await pm.dashboardDrilldown.drilldownMenuFirstItem.click();
    await page.waitForURL(/\/logs/, { timeout: 15000 });
    testLogger.info("Navigated to logs page — same-tab drilldown works");

    // Navigate back to dashboard list via side menu, then delete directly
    // (cleanupTestDashboard expects dashboard VIEW page; we're on logs)
    await pm.dashboardList.menuItem("dashboards-item");
    await deleteDashboard(page, dashboardName);
  });

  test("drilldown click new tab: URL drilldown with targetBlank → click table row → popup appears → click item → new tab opens", async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();

    await setupTablePanelWithConfig(page, pm, dashboardName);

    // Add URL drilldown with open-in-new-tab enabled
    await pm.dashboardDrilldown.addDrilldownByURL(
      "New Tab Drilldown",
      "https://openobserve.ai",
      { openInNewTab: true }
    );

    await pm.dashboardPanelActions.applyDashboardBtn();
    await pm.dashboardPanelActions.waitForChartToRender();
    await pm.dashboardPanelActions.savePanel();
    // After savePanel we are on the dashboard VIEW page with the table rendered

    testLogger.info("Clicking table row to trigger drilldown popup for new-tab test");
    const drilldownMenu = await pm.dashboardDrilldown.triggerDrilldownFromTable();
    await expect(drilldownMenu).toBeVisible({ timeout: 5000 });
    testLogger.info("Drilldown popup visible");

    // Set up new-tab listener BEFORE clicking the menu item
    const newPagePromise = page.context().waitForEvent("page", { timeout: 15000 });
    await pm.dashboardDrilldown.drilldownMenuFirstItem.click();

    // New tab should open with the target URL
    const newPage = await newPagePromise;
    await expect(newPage.url()).toContain("openobserve.ai");
    testLogger.info(`New tab opened: ${newPage.url()}`);
    newPage.close();

    // Navigate back to dashboard list via side menu, then delete directly
    await pm.dashboardList.menuItem("dashboards-item");
    await deleteDashboard(page, dashboardName);
  });

  test("drilldown click new tab - Logs: Logs drilldown with targetBlank → click table row → popup appears → click item → new tab opens with logs URL", async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();

    await setupTablePanelWithConfig(page, pm, dashboardName);

    await pm.dashboardDrilldown.addDrilldownByLogs("Logs New Tab Drilldown", { openInNewTab: true });

    await expect(pm.dashboardDrilldown.drilldownItemAt(0)).toContainText("Logs New Tab Drilldown");

    await pm.dashboardPanelActions.applyDashboardBtn();
    await pm.dashboardPanelActions.waitForChartToRender();
    await pm.dashboardPanelActions.savePanel();

    testLogger.info("Clicking table row to trigger drilldown popup for logs new-tab test");
    const drilldownMenu = await pm.dashboardDrilldown.triggerDrilldownFromTable();
    await expect(drilldownMenu).toBeVisible({ timeout: 5000 });

    // Set up new-tab listener BEFORE clicking the menu item
    const newPagePromise = page.context().waitForEvent("page", { timeout: 15000 });
    await pm.dashboardDrilldown.drilldownMenuFirstItem.click();

    const newPage = await newPagePromise;
    await newPage.waitForURL(/\/logs/, { timeout: 15000 });
    testLogger.info(`New tab opened: ${newPage.url()}`);
    await newPage.close();

    // Still on dashboard view — clean up normally
    await cleanupTestDashboard(page, pm, dashboardName);
  });

  test("drilldown click same tab - URL: URL drilldown without targetBlank → click table row → popup appears → click item → navigates to URL in same tab", async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();

    await setupTablePanelWithConfig(page, pm, dashboardName);

    await pm.dashboardDrilldown.addDrilldownByURL("URL Same Tab Drilldown", "https://openobserve.ai");

    await expect(pm.dashboardDrilldown.drilldownItemAt(0)).toContainText("URL Same Tab Drilldown");

    await pm.dashboardPanelActions.applyDashboardBtn();
    await pm.dashboardPanelActions.waitForChartToRender();
    await pm.dashboardPanelActions.savePanel();

    testLogger.info("Clicking table row to trigger drilldown popup for URL same-tab test");
    const drilldownMenu = await pm.dashboardDrilldown.triggerDrilldownFromTable();
    await expect(drilldownMenu).toBeVisible({ timeout: 5000 });

    await pm.dashboardDrilldown.drilldownMenuFirstItem.click();
    await page.waitForURL(/openobserve\.ai/, { timeout: 15000 });
    testLogger.info(`Navigated to external URL in same tab: ${page.url()}`);

    // Navigate back to the app, then to dashboard list for cleanup
    await navigateToBase(page);
    await pm.dashboardList.menuItem("dashboards-item");
    await deleteDashboard(page, dashboardName);
  });

  test("drilldown click same tab - byDashboard default tab: byDashboard drilldown (default tab) → click table row → popup appears → click item → navigates to destination dashboard in same tab", async ({ page }) => {
    const pm = new PageManager(page);
    const destinationDashName = generateDashboardName();
    const mainDashName = generateDashboardName();

    // Destination dashboard has only the Default tab
    await setupBarPanelWithConfig(page, pm, destinationDashName);
    await pm.dashboardPanelActions.savePanel();
    await pm.dashboardCreate.backToDashboardList();

    await setupTablePanelWithConfig(page, pm, mainDashName);

    await pm.dashboardDrilldown.addDrilldownByDashboard(
      "Dashboard Default Tab Same",
      "default",
      destinationDashName,
      "Default"
    );

    await expect(pm.dashboardDrilldown.drilldownItemAt(0)).toContainText("Dashboard Default Tab Same");

    await pm.dashboardPanelActions.applyDashboardBtn();
    await pm.dashboardPanelActions.waitForChartToRender();
    await pm.dashboardPanelActions.savePanel();

    testLogger.info("Clicking table row to trigger drilldown popup for byDashboard default-tab same-tab test");
    const drilldownMenu = await pm.dashboardDrilldown.triggerDrilldownFromTable();
    await expect(drilldownMenu).toBeVisible({ timeout: 5000 });

    await pm.dashboardDrilldown.drilldownMenuFirstItem.click();
    await page.waitForURL(/\/dashboards\/view/, { timeout: 15000 });
    testLogger.info(`Navigated to destination dashboard (Default tab) in same tab: ${page.url()}`);

    await pm.dashboardList.menuItem("dashboards-item");
    await deleteDashboard(page, mainDashName);
    await deleteDashboard(page, destinationDashName);
  });

  test("drilldown click same tab - byDashboard second tab: byDashboard drilldown (second tab) → click table row → popup appears → click item → navigates to destination dashboard in same tab", async ({ page }) => {
    const pm = new PageManager(page);
    const destinationDashName = generateDashboardName();
    const mainDashName = generateDashboardName();

    // Create destination dashboard with a second tab "Tab Two"
    await setupDestinationDashboardWithTabs(page, pm, destinationDashName, "Tab Two");
    await pm.dashboardCreate.backToDashboardList();

    // Create main dashboard with a TABLE panel + byDashboard drilldown targeting "Tab Two"
    await setupTablePanelWithConfig(page, pm, mainDashName);

    await pm.dashboardDrilldown.addDrilldownByDashboard(
      "Dashboard Same Tab Drilldown",
      "default",
      destinationDashName,
      "Tab Two"
    );

    await expect(pm.dashboardDrilldown.drilldownItemAt(0)).toContainText("Dashboard Same Tab Drilldown");

    await pm.dashboardPanelActions.applyDashboardBtn();
    await pm.dashboardPanelActions.waitForChartToRender();
    await pm.dashboardPanelActions.savePanel();

    testLogger.info("Clicking table row to trigger drilldown popup for byDashboard same-tab test");
    const drilldownMenu = await pm.dashboardDrilldown.triggerDrilldownFromTable();
    await expect(drilldownMenu).toBeVisible({ timeout: 5000 });

    await pm.dashboardDrilldown.drilldownMenuFirstItem.click();
    await page.waitForURL(/\/dashboards\/view/, { timeout: 15000 });
    testLogger.info(`Navigated to destination dashboard in same tab: ${page.url()}`);

    // Now on destination dashboard — go to list and delete both
    await pm.dashboardList.menuItem("dashboards-item");
    await deleteDashboard(page, mainDashName);
    await deleteDashboard(page, destinationDashName);
  });

  test("drilldown click new tab - byDashboard default tab: byDashboard drilldown (default tab) with targetBlank → click table row → popup appears → click item → new tab opens with destination dashboard", async ({ page }) => {
    const pm = new PageManager(page);
    const destinationDashName = generateDashboardName();
    const mainDashName = generateDashboardName();

    // Destination dashboard has only the Default tab
    await setupBarPanelWithConfig(page, pm, destinationDashName);
    await pm.dashboardPanelActions.savePanel();
    await pm.dashboardCreate.backToDashboardList();

    await setupTablePanelWithConfig(page, pm, mainDashName);

    await pm.dashboardDrilldown.addDrilldownByDashboard(
      "Dashboard Default Tab New",
      "default",
      destinationDashName,
      "Default",
      { openInNewTab: true }
    );

    await expect(pm.dashboardDrilldown.drilldownItemAt(0)).toContainText("Dashboard Default Tab New");

    await pm.dashboardPanelActions.applyDashboardBtn();
    await pm.dashboardPanelActions.waitForChartToRender();
    await pm.dashboardPanelActions.savePanel();

    testLogger.info("Clicking table row to trigger drilldown popup for byDashboard default-tab new-tab test");
    const drilldownMenu = await pm.dashboardDrilldown.triggerDrilldownFromTable();
    await expect(drilldownMenu).toBeVisible({ timeout: 5000 });

    const newPagePromise = page.context().waitForEvent("page", { timeout: 15000 });
    await pm.dashboardDrilldown.drilldownMenuFirstItem.click();

    const newPage = await newPagePromise;
    await newPage.waitForURL(/\/dashboards\/view/, { timeout: 15000 });
    testLogger.info(`New tab opened (Default tab): ${newPage.url()}`);
    await newPage.close();

    await cleanupTestDashboard(page, pm, mainDashName);
    await deleteDashboard(page, destinationDashName);
  });

  test("drilldown click new tab - byDashboard second tab: byDashboard drilldown (second tab) with targetBlank → click table row → popup appears → click item → new tab opens with destination dashboard", async ({ page }) => {
    const pm = new PageManager(page);
    const destinationDashName = generateDashboardName();
    const mainDashName = generateDashboardName();

    // Create destination dashboard with a second tab "Tab Two"
    await setupDestinationDashboardWithTabs(page, pm, destinationDashName, "Tab Two");
    await pm.dashboardCreate.backToDashboardList();

    // Create main dashboard with a TABLE panel + byDashboard drilldown targeting "Tab Two" (new tab)
    await setupTablePanelWithConfig(page, pm, mainDashName);

    await pm.dashboardDrilldown.addDrilldownByDashboard(
      "Dashboard New Tab Drilldown",
      "default",
      destinationDashName,
      "Tab Two",
      { openInNewTab: true }
    );

    await expect(pm.dashboardDrilldown.drilldownItemAt(0)).toContainText("Dashboard New Tab Drilldown");

    await pm.dashboardPanelActions.applyDashboardBtn();
    await pm.dashboardPanelActions.waitForChartToRender();
    await pm.dashboardPanelActions.savePanel();

    testLogger.info("Clicking table row to trigger drilldown popup for byDashboard new-tab test");
    const drilldownMenu = await pm.dashboardDrilldown.triggerDrilldownFromTable();
    await expect(drilldownMenu).toBeVisible({ timeout: 5000 });

    // Set up new-tab listener BEFORE clicking
    const newPagePromise = page.context().waitForEvent("page", { timeout: 15000 });
    await pm.dashboardDrilldown.drilldownMenuFirstItem.click();

    const newPage = await newPagePromise;
    await newPage.waitForURL(/\/dashboards\/view/, { timeout: 15000 });
    testLogger.info(`New tab opened: ${newPage.url()}`);
    await newPage.close();

    // Still on main dashboard view — clean up both dashboards
    await cleanupTestDashboard(page, pm, mainDashName);
    await deleteDashboard(page, destinationDashName);
  });
});
