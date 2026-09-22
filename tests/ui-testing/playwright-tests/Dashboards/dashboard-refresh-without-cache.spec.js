/**
 * Dashboard Refresh Without Cache
 *
 * Verifies the two "Refresh Cache & Reload" entry points (dashboard-level and
 * panel-level) actually fire a `_search_stream` request whose URL carries
 * `clear_cache=true`, and that the standard Refresh path does NOT regress into
 * bypassing the cache. The flag flows `refreshData(true)` / `onRefreshPanel(true)`
 * -> `shouldRefreshWithoutCachePerPanel` -> `usePanelSQLExecutor` (clear_cache) ->
 * `useStreamingSearch` (&clear_cache=true), asserted exactly like the Logs analog
 * (logsRefreshCacheDropdown.spec.js) but against the dashboard `_search_stream` POST.
 */

const { test, expect, navigateToBase } = require("../utils/enhanced-baseFixtures.js");
const testLogger = require("../utils/test-logger.js");
import { ingestion } from "./utils/dashIngestion.js";
import PageManager from "../../pages/page-manager.js";
import { waitForDashboardPage, deleteDashboard, addSimplePanel } from "./utils/dashCreation.js";
import { trackPanelReload, waitForAllPanelsToLoad } from "../utils/variable-helpers.js";
const { safeWaitForNetworkIdle } = require("../utils/wait-helpers.js");

/**
 * Create a fresh dashboard with one single-query line panel (Panel1) over
 * `e2e_automate` / `kubernetes_pod_name`, and wait for it to finish loading.
 * A single-query panel is required: only then is `clear_cache` a URL param
 * (multi-query/time-shift panels carry `is_refresh_cache` in the request body).
 *
 * @param {import('@playwright/test').Page} page
 * @param {import('../../pages/page-manager.js')} pm
 * @param {string} suffix - unique per-test dashboard-name suffix
 * @returns {Promise<string>} the created dashboard name
 */
async function createLoadedDashboardWithPanel(page, pm, suffix) {
  const dashboardName = `Dashboard_NoCache_${suffix}_${Date.now()}`;

  await pm.dashboardList.menuItem("dashboards-item");
  await waitForDashboardPage(page);
  await pm.dashboardCreate.waitForDashboardUIStable();
  await pm.dashboardCreate.createDashboard(dashboardName);

  await pm.dashboardVariablesScoped.waitForAddPanelBtn();
  await addSimplePanel(pm, "Panel1");

  await pm.dashboardVariablesScoped.getAnyPanel(0).waitFor({ state: "visible", timeout: 15000 });
  await pm.dashboardVariablesScoped.waitForDashboardReady();
  await safeWaitForNetworkIdle(page, { timeout: 5000 });
  await waitForAllPanelsToLoad(page, 1);

  return dashboardName;
}

/**
 * Return to the dashboard list and delete the test dashboard.
 *
 * @param {import('@playwright/test').Page} page
 * @param {import('../../pages/page-manager.js')} pm
 * @param {string} dashboardName
 */
async function cleanupDashboard(page, pm, dashboardName) {
  await pm.dashboardCreate.backToDashboardList();
  await deleteDashboard(page, dashboardName);
}

test.describe("Dashboard Refresh Without Cache testcases", () => {
  test.describe.configure({ mode: "parallel" });
  let pm;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    await ingestion(page);
    pm = new PageManager(page);
    testLogger.info("Test setup completed");
  });

  test(
    "dashboard-wide Refresh Cache & Reload bypasses the cache (clear_cache=true)",
    { tag: ['@dashboard-refresh-without-cache', '@all', '@dashboards', '@P0'] },
    async ({ page }) => {
      testLogger.info("Creating dashboard with a single-query panel");
      const dashboardName = await createLoadedDashboardWithPanel(page, pm, "Global");

      await pm.dashboardVariablesScoped.openDashboardRefreshOptions();
      const item = pm.dashboardVariablesScoped.getRefreshWithoutCacheMenuItem();
      await expect(item, "Refresh Cache & Reload must be visible").toBeVisible();
      await expect(item).toBeEnabled();

      // Close before the helper reopens it — Reka UI dropdowns close on Escape.
      await page.keyboard.press("Escape");

      const requestUrl =
        await pm.dashboardVariablesScoped.clickRefreshWithoutCacheAndWaitForClearCache();
      expect(
        requestUrl.searchParams.get("clear_cache"),
        "dashboard-wide Refresh Cache & Reload must bypass the cache (clear_cache=true)"
      ).toBe("true");

      await waitForAllPanelsToLoad(page, 1);

      await cleanupDashboard(page, pm, dashboardName);
      testLogger.info("Test completed");
    }
  );

  test(
    "panel-level Refresh Cache & Reload bypasses the cache (clear_cache=true)",
    { tag: ['@dashboard-refresh-without-cache', '@all', '@dashboards', '@P0'] },
    async ({ page }) => {
      testLogger.info("Creating dashboard with a single-query panel");
      const dashboardName = await createLoadedDashboardWithPanel(page, pm, "Panel");

      const requestUrl =
        await pm.dashboardVariablesScoped.clickPanelRefreshWithoutCacheAndWaitForClearCache("Panel1");
      expect(
        requestUrl.searchParams.get("clear_cache"),
        "panel-level Refresh Cache & Reload must bypass the cache (clear_cache=true)"
      ).toBe("true");

      await waitForAllPanelsToLoad(page, 1);

      await cleanupDashboard(page, pm, dashboardName);
      testLogger.info("Test completed");
    }
  );

  test(
    "standard Refresh re-runs panels WITH cache (no clear_cache)",
    { tag: ['@dashboard-refresh-without-cache', '@all', '@dashboards', '@P1'] },
    async ({ page }) => {
      testLogger.info("Creating dashboard with a single-query panel");
      const dashboardName = await createLoadedDashboardWithPanel(page, pm, "Std");

      const requestUrl = await pm.dashboardVariablesScoped.clickDashboardRefreshAndWaitForSearch();
      expect(
        requestUrl.searchParams.get("clear_cache"),
        "standard Refresh must NOT bypass the cache (clear_cache absent)"
      ).toBeNull();

      await waitForAllPanelsToLoad(page, 1);

      await cleanupDashboard(page, pm, dashboardName);
      testLogger.info("Test completed");
    }
  );

  test(
    "panel-level cache refresh re-queries only the target panel",
    { tag: ['@dashboard-refresh-without-cache', '@all', '@dashboards', '@P1'] },
    async ({ page }) => {
      testLogger.info("Creating dashboard with Panel1, then adding Panel2");
      const dashboardName = await createLoadedDashboardWithPanel(page, pm, "Isolate");

      // Capture Panel1's id before adding Panel2, so the first panel container
      // unambiguously refers to Panel1.
      const panelContainer1 = pm.dashboardVariablesScoped.getFirstPanelContainer();
      await panelContainer1.waitFor({ state: "attached", timeout: 5000 });
      const panelId1 = await panelContainer1.getAttribute("data-test-panel-id");

      // Add Panel2 (bar chart over the same stream).
      await pm.dashboardCreate.addPanelToExistingDashboard();
      await pm.chartTypeSelector.selectChartType("bar");
      await pm.chartTypeSelector.selectStream("e2e_automate");
      await pm.chartTypeSelector.removeField("y_axis_1", "y");
      await pm.chartTypeSelector.searchAndAddField("kubernetes_pod_name", "y");
      await pm.dashboardPanelActions.addPanelName("Panel2");
      await pm.dashboardPanelActions.savePanel();

      await pm.dashboardVariablesScoped.getAnyPanel(1).waitFor({ state: "visible", timeout: 15000 });
      await waitForAllPanelsToLoad(page, 2);
      await safeWaitForNetworkIdle(page, { timeout: 5000 });

      const reloadTracker = trackPanelReload(
        page,
        panelId1,
        async () => {
          await pm.dashboardVariablesScoped.getPanelKebab("Panel1").click();
          const item = pm.dashboardVariablesScoped.getPanelRefreshWithoutCacheItem();
          await item.waitFor({ state: "visible", timeout: 10000 });
          await item.click();
        },
        15000
      );

      const result = await reloadTracker;
      expect(result.reloaded, "Panel1 must re-query after its cache reload").toBe(true);
      expect(
        result.queryCount,
        "panel-level cache refresh must re-query only the target panel"
      ).toBe(1);

      await cleanupDashboard(page, pm, dashboardName);
      testLogger.info("Test completed");
    }
  );
});
