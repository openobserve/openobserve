const {
  test,
  expect,
  navigateToBase,
} = require("../utils/enhanced-baseFixtures.js");
import PageManager from "../../pages/page-manager";
import { ingestion } from "./utils/dashIngestion.js";
import { cleanupTestDashboard, deleteDashboard, waitForDashboardPage } from "./utils/dashCreation.js";
import {
  generateDashboardName,
  setupBarPanelWithConfig,
  setupTablePanelWithConfig,
  setupDestinationDashboardWithTabs,
  reopenPanelConfig,
} from "./utils/configPanelHelpers.js";
import DashboardVariablesScoped from "../../pages/dashboardPages/dashboard-variables-scoped.js";
const { safeWaitForHidden, safeWaitForNetworkIdle } = require("../utils/wait-helpers.js");
const {
  SELECTORS,
  getVariableSelector,
  getEditVariableBtn,
} = require("../../pages/dashboardPages/dashboard-selectors.js");
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

// ═══════════════════════════════════════════════════════════════════════════════
// Same-Dashboard Drilldown — URL Clobbering Regression (PR #11134)
//
// These tests cover the exact regression fixed by PR #11134:
//   "fix: enhance drilldown handling to prevent URL clobbering during same
//   dashboard navigation"
//
// Bug: when a drilldown targeted the same dashboard, var-* URL params injected
// by the drilldown were immediately overwritten by updateUrlWithCurrentState()
// before the variables manager could process the new values.
//
// Fix: two guard flags (isDrilldownInProgress, isInternalUrlUpdate) and a new
// var-* watcher in ViewDashboard.vue prevent the clobber and update variables
// in-place without a full reload.
// ═══════════════════════════════════════════════════════════════════════════════

test.describe(
  "Same-Dashboard Drilldown — URL Clobbering Regression (PR #11134)",
  {
    tag: [
      "@dashboards",
      "@drilldown",
      "@urlSync",
      "@regression",
      "@P1",
    ],
  },
  () => {
    test.describe.configure({ mode: "serial" });

    test.beforeEach(async ({ page }) => {
      await navigateToBase(page);
      await ingestion(page);
    });

    // ─────────────────────────────────────────────────────────────────────────
    // Test 15: Same-dashboard drilldown with custom variable mapping
    // Verifies that a var-* value injected by a byDashboard drilldown (same dash)
    // is NOT overwritten by URL sync after the navigation settles.
    // ─────────────────────────────────────────────────────────────────────────
    test(
      "same-dashboard drilldown with custom variable: var-* param present in URL after click and not overwritten by URL sync",
      async ({ page }) => {
        testLogger.testStart(
          "same-dashboard drilldown: custom variable — no URL clobber"
        );

        const pm = new PageManager(page);
        const scopedVars = new DashboardVariablesScoped(page);
        const dashboardName = `Dashboard_SameDash_Custom_${Date.now()}`;
        const variableName = `sd_var_${Date.now()}`;
        const drilldownVarValue = "kube-system";

        // ── 1. Create dashboard ──────────────────────────────────────────────
        await pm.dashboardList.menuItem("dashboards-item");
        await waitForDashboardPage(page);
        await pm.dashboardCreate.waitForDashboardUIStable();
        await pm.dashboardCreate.createDashboard(dashboardName);
        await page
          .locator(SELECTORS.ADD_PANEL_BTN)
          .waitFor({ state: "visible" });

        // ── 2. Add global variable ───────────────────────────────────────────
        await pm.dashboardSetting.openSetting();
        await scopedVars.addScopedVariable(
          variableName,
          "logs",
          "e2e_automate",
          "kubernetes_namespace_name",
          { scope: "global" }
        );
        await page
          .locator(getEditVariableBtn(variableName))
          .waitFor({ state: "visible", timeout: 10000 });
        await safeWaitForNetworkIdle(page, { timeout: 3000 });
        await pm.dashboardSetting.closeSettingWindow();
        await safeWaitForHidden(page, ".q-dialog", { timeout: 5000 });
        await safeWaitForNetworkIdle(page, { timeout: 3000 });
        testLogger.info(`Variable '${variableName}' created`);

        // ── 3. Add table panel ───────────────────────────────────────────────
        await pm.dashboardCreate.addPanel();
        await pm.chartTypeSelector.selectChartType("table");
        await pm.chartTypeSelector.selectStreamType("logs");
        await pm.chartTypeSelector.selectStream("e2e_automate");
        await pm.chartTypeSelector.searchAndAddField(
          "kubernetes_container_hash",
          "y"
        );
        await pm.dashboardPanelActions.addPanelName("Source Panel");
        await pm.dashboardPanelActions.applyDashboardBtn();
        await pm.dashboardPanelActions.waitForChartToRender();

        // ── 4. Configure drilldown: same dashboard + custom variable mapping ─
        await pm.dashboardPanelConfigs.openConfigPanel();

        // Open drilldown popup
        const addBtn = page
          .locator('[data-test="dashboard-addpanel-config-drilldown-add-btn"]')
          .first();
        await addBtn.scrollIntoViewIfNeeded();
        await addBtn.click();
        const popup = page.locator('[data-test="dashboard-drilldown-popup"]');
        await popup.waitFor({ state: "visible", timeout: 10000 });

        // Fill drilldown name
        await page
          .locator('[data-test="dashboard-config-panel-drilldown-name"]')
          .fill("Same Dash Custom Var");

        // byDashboard is the default type — select folder → same dashboard → tab
        await page
          .locator('[data-test="dashboard-drilldown-folder-select"]')
          .waitFor({ state: "visible", timeout: 10000 });
        await page
          .locator('[data-test="dashboard-drilldown-folder-select"]')
          .click();
        await page
          .getByRole("option", { name: "default", exact: true })
          .click();

        await page
          .locator('[data-test="dashboard-drilldown-dashboard-select"]')
          .waitFor({ state: "visible", timeout: 10000 });
        await page
          .locator('[data-test="dashboard-drilldown-dashboard-select"]')
          .click();
        await page
          .getByRole("option", { name: dashboardName, exact: true })
          .click();

        await page
          .locator('[data-test="dashboard-drilldown-tab-select"]')
          .waitFor({ state: "visible", timeout: 10000 });
        await page
          .locator('[data-test="dashboard-drilldown-tab-select"]')
          .click();
        await page.getByRole("option").first().click();
        testLogger.info("Drilldown target: same dashboard selected");

        // Add variable mapping: variableName → drilldownVarValue (literal value)
        const addVarBtn = page.locator(
          '[data-test="dashboard-drilldown-add-variable"]'
        );
        await addVarBtn.waitFor({ state: "visible", timeout: 5000 });
        await addVarBtn.click();
        await page.waitForTimeout(300);

        // Fill variable name and value using CommonAutoComplete inputs inside popup.
        // In Quasar v2, data-test on <q-input> is applied to the native <input>
        // element via $attrs, so the selector targets the input directly.
        const autoCompleteInputs = popup.locator(
          '[data-test="common-auto-complete"]'
        );
        await autoCompleteInputs.first().waitFor({ state: "visible", timeout: 5000 });
        await autoCompleteInputs.first().scrollIntoViewIfNeeded();
        await autoCompleteInputs.first().fill(variableName);
        await autoCompleteInputs.last().fill(drilldownVarValue);
        testLogger.info(
          `Variable mapping: ${variableName} → ${drilldownVarValue}`
        );

        // Confirm and close popup
        await page
          .locator('[data-test="confirm-button"]')
          .waitFor({ state: "visible", timeout: 5000 });
        await page.locator('[data-test="confirm-button"]').click();
        await popup.waitFor({ state: "hidden", timeout: 10000 });

        // ── 5. Save panel ────────────────────────────────────────────────────
        await pm.dashboardPanelActions.applyDashboardBtn();
        await pm.dashboardPanelActions.waitForChartToRender();
        await pm.dashboardPanelActions.savePanel();
        testLogger.info("Panel saved — now on dashboard view");

        // ── 6. Wait for panel to render on view page ─────────────────────────
        await page
          .locator('[data-test="dashboard-panel-table"]')
          .first()
          .waitFor({ state: "attached", timeout: 20000 });
        await safeWaitForNetworkIdle(page, { timeout: 5000 });

        // ── 7. Trigger same-dashboard drilldown via table row click ───────────
        testLogger.info("Triggering same-dashboard drilldown from table row");
        const drilldownMenu =
          await pm.dashboardDrilldown.triggerDrilldownFromTable();
        await expect(drilldownMenu).toBeVisible({ timeout: 5000 });
        await expect(
          pm.dashboardDrilldown.drilldownMenuFirstItem
        ).toContainText("Same Dash Custom Var");

        await pm.dashboardDrilldown.drilldownMenuFirstItem.click();

        // Wait for URL to update (same dashboard — URL stays on /dashboards/view)
        await page.waitForURL(/\/dashboards\/view/, { timeout: 15000 });
        await safeWaitForNetworkIdle(page, { timeout: 3000 });

        // ── 8. Verify var-* param is in URL immediately after drilldown ───────
        const urlAfterDrilldown = page.url();
        testLogger.info(`URL after drilldown: ${urlAfterDrilldown}`);
        expect(urlAfterDrilldown).toContain(`var-${variableName}=`);
        testLogger.info(`✅ var-${variableName} present in URL after drilldown`);

        // ── 9. Regression guard: wait and verify URL is NOT clobbered ─────────
        // Before PR #11134 fix: updateUrlWithCurrentState() would overwrite var-*
        // with stale committed values, making the var-* param disappear or revert.
        await page.waitForTimeout(800);
        const urlAfterWait = page.url();
        testLogger.info(`URL after 800ms wait: ${urlAfterWait}`);
        expect(urlAfterWait).toContain(`var-${variableName}=`);
        testLogger.info(
          `✅ URL clobber guard passed — var-${variableName} persists 800ms after same-dashboard drilldown`
        );

        // ── Cleanup ───────────────────────────────────────────────────────────
        await pm.dashboardList.menuItem("dashboards-item");
        await deleteDashboard(page, dashboardName);
      }
    );

    // ─────────────────────────────────────────────────────────────────────────
    // Test 16: Same-dashboard drilldown with passAllVariables
    // When passAllVariables = true, the current variable value should be
    // carried through and persist in URL after same-dashboard navigation.
    // ─────────────────────────────────────────────────────────────────────────
    test(
      "same-dashboard drilldown with passAllVariables: current var-* value carried through URL and not overwritten",
      async ({ page }) => {
        testLogger.testStart(
          "same-dashboard drilldown: passAllVariables — var persists"
        );

        const pm = new PageManager(page);
        const scopedVars = new DashboardVariablesScoped(page);
        const dashboardName = `Dashboard_SameDash_PassAll_${Date.now()}`;
        const variableName = `pav_var_${Date.now()}`;

        // ── 1. Create dashboard ──────────────────────────────────────────────
        await pm.dashboardList.menuItem("dashboards-item");
        await waitForDashboardPage(page);
        await pm.dashboardCreate.waitForDashboardUIStable();
        await pm.dashboardCreate.createDashboard(dashboardName);
        await page
          .locator(SELECTORS.ADD_PANEL_BTN)
          .waitFor({ state: "visible" });

        // ── 2. Add global variable ───────────────────────────────────────────
        await pm.dashboardSetting.openSetting();
        await scopedVars.addScopedVariable(
          variableName,
          "logs",
          "e2e_automate",
          "kubernetes_namespace_name",
          { scope: "global" }
        );
        await page
          .locator(getEditVariableBtn(variableName))
          .waitFor({ state: "visible", timeout: 10000 });
        await safeWaitForNetworkIdle(page, { timeout: 3000 });
        await pm.dashboardSetting.closeSettingWindow();
        await safeWaitForHidden(page, ".q-dialog", { timeout: 5000 });
        await safeWaitForNetworkIdle(page, { timeout: 3000 });

        // ── 3. Add table panel with byDashboard drilldown, passAllVariables ──
        await pm.dashboardCreate.addPanel();
        await pm.chartTypeSelector.selectChartType("table");
        await pm.chartTypeSelector.selectStreamType("logs");
        await pm.chartTypeSelector.selectStream("e2e_automate");
        await pm.chartTypeSelector.searchAndAddField(
          "kubernetes_container_hash",
          "y"
        );
        await pm.dashboardPanelActions.addPanelName("PassAll Panel");
        await pm.dashboardPanelActions.applyDashboardBtn();
        await pm.dashboardPanelActions.waitForChartToRender();

        await pm.dashboardPanelConfigs.openConfigPanel();

        // Open drilldown popup
        const addBtn = page
          .locator('[data-test="dashboard-addpanel-config-drilldown-add-btn"]')
          .first();
        await addBtn.scrollIntoViewIfNeeded();
        await addBtn.click();
        const popup = page.locator('[data-test="dashboard-drilldown-popup"]');
        await popup.waitFor({ state: "visible", timeout: 10000 });

        await page
          .locator('[data-test="dashboard-config-panel-drilldown-name"]')
          .fill("PassAll Same Dash");

        // Target: same dashboard
        await page
          .locator('[data-test="dashboard-drilldown-folder-select"]')
          .waitFor({ state: "visible", timeout: 10000 });
        await page
          .locator('[data-test="dashboard-drilldown-folder-select"]')
          .click();
        await page
          .getByRole("option", { name: "default", exact: true })
          .click();

        await page
          .locator('[data-test="dashboard-drilldown-dashboard-select"]')
          .waitFor({ state: "visible", timeout: 10000 });
        await page
          .locator('[data-test="dashboard-drilldown-dashboard-select"]')
          .click();
        await page
          .getByRole("option", { name: dashboardName, exact: true })
          .click();

        await page
          .locator('[data-test="dashboard-drilldown-tab-select"]')
          .waitFor({ state: "visible", timeout: 10000 });
        await page
          .locator('[data-test="dashboard-drilldown-tab-select"]')
          .click();
        await page.getByRole("option").first().click();

        // Enable passAllVariables
        const passAllToggle = page.locator(
          '[data-test="dashboard-drilldown-pass-all-variables"]'
        );
        await passAllToggle.waitFor({ state: "visible", timeout: 5000 });
        await passAllToggle.click();
        testLogger.info("passAllVariables enabled");

        await page.locator('[data-test="confirm-button"]').click();
        await popup.waitFor({ state: "hidden", timeout: 10000 });

        await pm.dashboardPanelActions.applyDashboardBtn();
        await pm.dashboardPanelActions.waitForChartToRender();
        await pm.dashboardPanelActions.savePanel();
        testLogger.info("Panel with passAllVariables drilldown saved");

        // ── 4. On dashboard view: select a variable value ────────────────────
        await page
          .locator(getVariableSelector(variableName))
          .waitFor({ state: "visible", timeout: 10000 });
        const { selectedValue } = await scopedVars.changeVariableValue(
          variableName,
          { optionIndex: 0, returnSelectedValue: true }
        );
        testLogger.info(`Selected variable value: "${selectedValue}"`);
        await safeWaitForNetworkIdle(page, { timeout: 3000 });

        // Confirm var-* is in URL (normal variable sync)
        const urlBeforeDrilldown = page.url();
        expect(urlBeforeDrilldown).toContain(`var-${variableName}=`);
        testLogger.info("var-* confirmed in URL before drilldown");

        // ── 5. Trigger same-dashboard drilldown ──────────────────────────────
        const drilldownMenu =
          await pm.dashboardDrilldown.triggerDrilldownFromTable();
        await expect(drilldownMenu).toBeVisible({ timeout: 5000 });
        await expect(
          pm.dashboardDrilldown.drilldownMenuFirstItem
        ).toContainText("PassAll Same Dash");

        await pm.dashboardDrilldown.drilldownMenuFirstItem.click();
        await page.waitForURL(/\/dashboards\/view/, { timeout: 15000 });
        await safeWaitForNetworkIdle(page, { timeout: 3000 });

        // ── 6. Verify var-* param persists after passAllVariables drilldown ───
        const urlAfterDrilldown = page.url();
        testLogger.info(`URL after drilldown: ${urlAfterDrilldown}`);
        expect(urlAfterDrilldown).toContain(`var-${variableName}=`);

        // Regression guard: variable value should NOT be clobbered
        await page.waitForTimeout(800);
        const urlAfterWait = page.url();
        expect(urlAfterWait).toContain(`var-${variableName}=`);
        testLogger.info(
          `✅ passAllVariables: var-${variableName} persists 800ms after same-dashboard drilldown`
        );

        // ── Cleanup ───────────────────────────────────────────────────────────
        await pm.dashboardList.menuItem("dashboards-item");
        await deleteDashboard(page, dashboardName);
      }
    );

    // ─────────────────────────────────────────────────────────────────────────
    // Test 17: Same-dashboard drilldown targeting a different tab
    // Dashboard ID stays the same, but tab changes + var-* params are passed.
    // Verifies the var-* watcher handles tab-switch within same-dashboard case.
    // ─────────────────────────────────────────────────────────────────────────
    test(
      "same-dashboard drilldown to a different tab: tab changes + var-* params present and not clobbered",
      async ({ page }) => {
        testLogger.testStart(
          "same-dashboard drilldown: different tab — var-* and tab persist"
        );

        const pm = new PageManager(page);
        const scopedVars = new DashboardVariablesScoped(page);
        const dashboardName = `Dashboard_SameDash_Tab_${Date.now()}`;
        const variableName = `tab_var_${Date.now()}`;
        const secondTabName = "Analytics Tab";

        // ── 1. Create dashboard with a second tab and a global variable ───────
        await pm.dashboardList.menuItem("dashboards-item");
        await waitForDashboardPage(page);
        await pm.dashboardCreate.waitForDashboardUIStable();
        await pm.dashboardCreate.createDashboard(dashboardName);
        await page
          .locator(SELECTORS.ADD_PANEL_BTN)
          .waitFor({ state: "visible" });

        // Add global variable (open/close settings session)
        await pm.dashboardSetting.openSetting();
        await scopedVars.addScopedVariable(
          variableName,
          "logs",
          "e2e_automate",
          "kubernetes_namespace_name",
          { scope: "global" }
        );
        await page
          .locator(getEditVariableBtn(variableName))
          .waitFor({ state: "visible", timeout: 10000 });
        await safeWaitForNetworkIdle(page, { timeout: 3000 });
        await pm.dashboardSetting.closeSettingWindow();
        await safeWaitForHidden(page, ".q-dialog", { timeout: 5000 });
        await safeWaitForNetworkIdle(page, { timeout: 3000 });
        testLogger.info(`Variable '${variableName}' created`);

        // Add second tab in a fresh settings session.
        // Use closeSettingDashboard() (not closeSettingWindow()) because addTabAndWait
        // leaves the settings dialog open — this matches the pattern in setupDestinationDashboardWithTabs.
        await pm.dashboardSetting.openSetting();
        await pm.dashboardSetting.addTabAndWait(secondTabName);
        await pm.dashboardSetting.closeSettingDashboard();
        await safeWaitForHidden(page, ".q-dialog", { timeout: 5000 });
        await page.waitForTimeout(400); // allow Quasar fade-out animation to complete
        await safeWaitForNetworkIdle(page, { timeout: 3000 });
        testLogger.info(`Second tab '${secondTabName}' added`);

        // ── 2. Add table panel on Default tab with drilldown to same dashboard + second tab ──
        await pm.dashboardCreate.addPanel();
        await pm.chartTypeSelector.selectChartType("table");
        await pm.chartTypeSelector.selectStreamType("logs");
        await pm.chartTypeSelector.selectStream("e2e_automate");
        await pm.chartTypeSelector.searchAndAddField(
          "kubernetes_container_hash",
          "y"
        );
        await pm.dashboardPanelActions.addPanelName("Tab Panel");
        await pm.dashboardPanelActions.applyDashboardBtn();
        await pm.dashboardPanelActions.waitForChartToRender();

        await pm.dashboardPanelConfigs.openConfigPanel();

        // Open drilldown popup
        const addBtn = page
          .locator('[data-test="dashboard-addpanel-config-drilldown-add-btn"]')
          .first();
        await addBtn.scrollIntoViewIfNeeded();
        await addBtn.click();
        const popup = page.locator('[data-test="dashboard-drilldown-popup"]');
        await popup.waitFor({ state: "visible", timeout: 10000 });

        await page
          .locator('[data-test="dashboard-config-panel-drilldown-name"]')
          .fill("Same Dash Tab Drilldown");

        // Target: same dashboard, second tab
        await page
          .locator('[data-test="dashboard-drilldown-folder-select"]')
          .waitFor({ state: "visible", timeout: 10000 });
        await page
          .locator('[data-test="dashboard-drilldown-folder-select"]')
          .click();
        await page
          .getByRole("option", { name: "default", exact: true })
          .click();

        await page
          .locator('[data-test="dashboard-drilldown-dashboard-select"]')
          .waitFor({ state: "visible", timeout: 10000 });
        await page
          .locator('[data-test="dashboard-drilldown-dashboard-select"]')
          .click();
        await page
          .getByRole("option", { name: dashboardName, exact: true })
          .click();

        await page
          .locator('[data-test="dashboard-drilldown-tab-select"]')
          .waitFor({ state: "visible", timeout: 10000 });
        await page
          .locator('[data-test="dashboard-drilldown-tab-select"]')
          .click();
        await page
          .getByRole("option", { name: secondTabName, exact: true })
          .click();
        testLogger.info(`Drilldown target: same dashboard, tab "${secondTabName}"`);

        // Enable passAllVariables to carry var-* through the tab switch
        const passAllToggle = page.locator(
          '[data-test="dashboard-drilldown-pass-all-variables"]'
        );
        await passAllToggle.waitFor({ state: "visible", timeout: 5000 });
        await passAllToggle.click();

        await page.locator('[data-test="confirm-button"]').click();
        await popup.waitFor({ state: "hidden", timeout: 10000 });

        await pm.dashboardPanelActions.applyDashboardBtn();
        await pm.dashboardPanelActions.waitForChartToRender();
        await pm.dashboardPanelActions.savePanel();
        testLogger.info("Panel with tab-switch drilldown saved");

        // ── 3. On dashboard view: select a variable value ────────────────────
        await page
          .locator(getVariableSelector(variableName))
          .waitFor({ state: "visible", timeout: 10000 });
        const { selectedValue } = await scopedVars.changeVariableValue(
          variableName,
          { optionIndex: 0, returnSelectedValue: true }
        );
        testLogger.info(`Variable value selected: "${selectedValue}"`);
        await safeWaitForNetworkIdle(page, { timeout: 3000 });

        // Capture dashboard ID from URL (same dashboard should be maintained after drilldown)
        const urlBeforeDrilldown = page.url();
        const dashboardParam = new URL(urlBeforeDrilldown).searchParams.get("dashboard");
        testLogger.info(`Dashboard ID before drilldown: ${dashboardParam}`);

        // ── 4. Trigger same-dashboard tab-switch drilldown ───────────────────
        const drilldownMenu =
          await pm.dashboardDrilldown.triggerDrilldownFromTable();
        await expect(drilldownMenu).toBeVisible({ timeout: 5000 });
        await expect(
          pm.dashboardDrilldown.drilldownMenuFirstItem
        ).toContainText("Same Dash Tab Drilldown");

        await pm.dashboardDrilldown.drilldownMenuFirstItem.click();
        await page.waitForURL(/\/dashboards\/view/, { timeout: 15000 });
        await safeWaitForNetworkIdle(page, { timeout: 3000 });

        // ── 5. Verify URL: same dashboard ID, different tab, var-* present ───
        const urlAfterDrilldown = page.url();
        const urlParamsAfter = new URL(urlAfterDrilldown).searchParams;
        testLogger.info(`URL after tab-switch drilldown: ${urlAfterDrilldown}`);

        // Dashboard ID should be the same
        expect(urlParamsAfter.get("dashboard")).toBe(dashboardParam);
        testLogger.info("✅ Dashboard ID unchanged after same-dashboard drilldown");

        // var-* should be in URL
        expect(urlAfterDrilldown).toContain(`var-${variableName}=`);
        testLogger.info(`✅ var-${variableName} present in URL after tab-switch drilldown`);

        // Regression guard: wait and verify no clobber
        await page.waitForTimeout(800);
        const urlAfterWait = page.url();
        expect(urlAfterWait).toContain(`var-${variableName}=`);
        expect(new URL(urlAfterWait).searchParams.get("dashboard")).toBe(dashboardParam);
        testLogger.info(
          "✅ URL clobber guard passed — dashboard ID and var-* both persist after tab-switch drilldown"
        );

        // ── Cleanup ───────────────────────────────────────────────────────────
        await pm.dashboardList.menuItem("dashboards-item");
        await deleteDashboard(page, dashboardName);
      }
    );
  }
);
