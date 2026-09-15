/**
 * Dashboard Relative Time Range Refresh
 * A dashboard with a relative global time range (default "Past 15 Minutes") must
 * re-resolve that range against the current clock on explicit refresh (manual or
 * auto-refresh), while a non-forced recompute must NOT spuriously re-query panels.
 */

const { test, expect, navigateToBase } = require("../utils/enhanced-baseFixtures.js");
import { ingestion } from "./utils/dashIngestion.js";
import PageManager from "../../pages/page-manager.js";
import { waitForDashboardPage, deleteDashboard, addSimplePanel } from "./utils/dashCreation.js";
import { trackPanelReload, waitForAllPanelsToLoad } from "../utils/variable-helpers.js";
const { safeWaitForNetworkIdle } = require("../utils/wait-helpers.js");
const testLogger = require("../utils/test-logger.js");

test.describe("Dashboard Relative Time Range Refresh testcases", () => {
  test.describe.configure({ mode: "parallel" });
  let pm;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
    await ingestion(page);
    testLogger.info("Test setup completed");
  });

  test("should re-resolve relative time window and re-query panels on manual refresh", { tag: ['@dashboard-relative-time-range', '@dashboards', '@all'] }, async ({ page }) => {
    const dashboardName = `Dashboard_RelTimeRefresh_${Date.now()}`;

    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);
    await pm.dashboardCreate.waitForDashboardUIStable();
    await pm.dashboardCreate.createDashboard(dashboardName);

    await pm.dashboardVariablesScoped.waitForAddPanelBtn();
    await addSimplePanel(pm, "Panel1");
    await pm.dashboardVariablesScoped.getAnyPanel(0).waitFor({ state: "visible", timeout: 15000 });
    await waitForAllPanelsToLoad(page, 1, 10000);

    // A freshly created dashboard defaults to a relative range; confirm the label
    // before refreshing so the refresh below is a pure re-resolve of "now".
    const labelBefore = await pm.dashboardTimeRefresh.getGlobalTimeLabel();
    expect(labelBefore).toContain("Past 15 Minutes");

    const result = await trackPanelReload(
      page,
      null,
      () => pm.dashboardTimeRefresh.refreshDashboard(),
      15000
    );

    expect(result.reloaded).toBe(true);
    expect(result.queryCount).toBeGreaterThanOrEqual(1);

    // A pure relative refresh advances the resolved window but keeps the period
    // string and the URL query param unchanged.
    expect(page.url()).toContain("period=15m");
    const labelAfter = await pm.dashboardTimeRefresh.getGlobalTimeLabel();
    expect(labelAfter).toContain("Past 15 Minutes");

    await waitForAllPanelsToLoad(page, 1, 10000);

    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, dashboardName);
  });

  test("should advance window and update URL period when relative period changes", { tag: ['@dashboard-relative-time-range', '@dashboards', '@all'] }, async ({ page }) => {
    const dashboardName = `Dashboard_RelTimePeriod_${Date.now()}`;

    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);
    await pm.dashboardCreate.waitForDashboardUIStable();
    await pm.dashboardCreate.createDashboard(dashboardName);

    await pm.dashboardVariablesScoped.waitForAddPanelBtn();
    await addSimplePanel(pm, "Panel1");
    await pm.dashboardVariablesScoped.getAnyPanel(0).waitFor({ state: "visible", timeout: 15000 });
    await waitForAllPanelsToLoad(page, 1, 10000);

    const result = await trackPanelReload(
      page,
      null,
      () => pm.dashboardPanelTime.changeGlobalTime("6-h"),
      15000
    );

    expect(result.reloaded).toBe(true);
    expect(result.queryCount).toBeGreaterThanOrEqual(1);

    // A real period change rewrites the URL to the new span and updates the label.
    expect(page.url()).toContain("period=6h");
    const label = await pm.dashboardTimeRefresh.getGlobalTimeLabel();
    expect(label).toContain("Past 6 Hours");

    await waitForAllPanelsToLoad(page, 1, 10000);

    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, dashboardName);
  });

  test("should re-query panels on auto-refresh interval tick for a relative range", { tag: ['@dashboard-relative-time-range', '@dashboards', '@all'] }, async ({ page }) => {
    const dashboardName = `Dashboard_RelTimeAuto_${Date.now()}`;

    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);
    await pm.dashboardCreate.waitForDashboardUIStable();
    await pm.dashboardCreate.createDashboard(dashboardName);

    await pm.dashboardVariablesScoped.waitForAddPanelBtn();
    await addSimplePanel(pm, "Panel1");
    await pm.dashboardVariablesScoped.getAnyPanel(0).waitFor({ state: "visible", timeout: 15000 });
    await waitForAllPanelsToLoad(page, 1, 10000);

    // Enable auto-refresh (5s floor) and let the interval tick fire refreshData(),
    // which advances a relative range exactly like the manual button.
    const result = await trackPanelReload(
      page,
      null,
      () => pm.dashboardTimeRefresh.enableAutoRefresh(5),
      15000
    );

    expect(result.reloaded).toBe(true);
    expect(result.queryCount).toBeGreaterThanOrEqual(1);
    expect(page.url()).toContain("period=15m");

    await pm.dashboardTimeRefresh.disableAutoRefresh();

    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, dashboardName);
  });

  test("should not spuriously refetch queries during a passive settle window", { tag: ['@dashboard-relative-time-range', '@dashboards', '@all', '@P2'] }, async ({ page }) => {
    const dashboardName = `Dashboard_RelTimeNoRefetch_${Date.now()}`;

    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);
    await pm.dashboardCreate.waitForDashboardUIStable();
    await pm.dashboardCreate.createDashboard(dashboardName);

    await pm.dashboardVariablesScoped.waitForAddPanelBtn();
    await addSimplePanel(pm, "Panel1");
    await pm.dashboardVariablesScoped.getAnyPanel(0).waitFor({ state: "visible", timeout: 15000 });
    await waitForAllPanelsToLoad(page, 1, 10000);

    // Drain the initial load's queries so only spurious re-queries would remain.
    await safeWaitForNetworkIdle(page, { timeout: 5000 });

    // With no user action the span-comparison fix must keep the relative range from
    // advancing and refiring queries, so a passive window sees zero new queries.
    const result = await trackPanelReload(page, null, async () => {}, 3000);

    expect(result.queryCount).toBe(0);

    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, dashboardName);
  });
});
