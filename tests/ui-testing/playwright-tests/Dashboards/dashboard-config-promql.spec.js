const {
  test,
  expect,
  navigateToBase,
} = require("../utils/enhanced-baseFixtures.js");
import PageManager from "../../pages/page-manager";
import { cleanupTestDashboard } from "./utils/dashCreation.js";
import {
  generateDashboardName,
  setupPromQLPanelWithConfig,
  setupPromQLPiePanelWithConfig,
  setupPromQLTablePanelWithConfig,
  reopenPanelConfig,
} from "./utils/configPanelHelpers.js";
const testLogger = require('../utils/test-logger.js');
const { ensureMetricsIngested } = require('../utils/shared-metrics-setup.js');

test.describe.configure({ mode: "parallel" });
test.describe.configure({ retries: 1 });

test.describe("ConfigPanel — PromQL Settings", () => {
  // Ensure metrics are ingested once before all tests run
  test.beforeAll(async () => {
    await ensureMetricsIngested();
  });

  test.beforeEach(async ({ page }) => {
    await navigateToBase(page);
  });

  test("step value: visible in PromQL mode → set to 5m → apply → chart renders; reopen → value persists", async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();

    await setupPromQLPanelWithConfig(page, pm, dashboardName);

    const stepValueInput = page.locator('[data-test="dashboard-config-step-value"]');
    await expect(stepValueInput).toBeVisible();

    // Clear and set step value to 5m
    await stepValueInput.click();
    await stepValueInput.fill("5m");
    await pm.dashboardPanelActions.applyDashboardBtn();
    testLogger.info("Step value set to 5m");
    await pm.dashboardPanelActions.waitForChartToRender().catch(() => {});

    // Save and verify persistence
    await pm.dashboardPanelActions.savePanel();
    testLogger.info("Verifying step value persists after save");
    await reopenPanelConfig(page, pm);
    await expect(page.locator('[data-test="dashboard-config-step-value"]')).toHaveValue("5m");
    await pm.dashboardPanelActions.savePanel();
    await cleanupTestDashboard(page, pm, dashboardName);
  });

  test("PromQL legend info: visible in PromQL mode → renders without errors", async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();

    await setupPromQLPanelWithConfig(page, pm, dashboardName);

    const legendInfo = page.locator('[data-test="dashboard-config-promql-legend-info"]');
    await expect(legendInfo).toBeVisible();
    testLogger.info("PromQL legend info icon is visible in PromQL mode");

    await pm.dashboardPanelActions.savePanel();
    await cleanupTestDashboard(page, pm, dashboardName);
  });

  test("aggregation function: visible for PromQL pie → change to Max → apply; change to Avg → apply → persists", async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();

    await setupPromQLPiePanelWithConfig(page, pm, dashboardName);

    const aggregationDropdown = page.locator('[data-test="dashboard-config-aggregation"]');
    await expect(aggregationDropdown).toBeVisible();

    // Change aggregation to Max — full option label is "Max (maximum value)"
    await aggregationDropdown.click();
    await page.getByRole("option", { name: /^Max/i }).first().click();
    await pm.dashboardPanelActions.applyDashboardBtn();
    testLogger.info("Aggregation set to Max");
    await pm.dashboardPanelActions.waitForChartToRender().catch(() => {});

    // Change aggregation to Avg — full option label is "Avg (average)"
    await aggregationDropdown.click();
    await page.getByRole("option", { name: /^Avg/i }).first().click();
    await pm.dashboardPanelActions.applyDashboardBtn();
    testLogger.info("Aggregation set to Avg");
    await pm.dashboardPanelActions.waitForChartToRender().catch(() => {});

    await pm.dashboardPanelActions.savePanel();
    testLogger.info("Verifying aggregation Avg persists after save");
    await reopenPanelConfig(page, pm);
    await expect(page.locator('[data-test="dashboard-config-aggregation"]')).toContainText("Avg");
    await pm.dashboardPanelActions.savePanel();
    await cleanupTestDashboard(page, pm, dashboardName);
  });

  test("PromQL table mode: visible for PromQL table → switch to Expanded Time series → apply; switch to Aggregate → apply → persists", async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();

    await setupPromQLTablePanelWithConfig(page, pm, dashboardName);

    const tableModeDropdown = page.locator('[data-test="dashboard-config-promql-table-mode"]');
    await pm.dashboardPanelConfigs.scrollSidebarToElement(tableModeDropdown);
    await expect(tableModeDropdown).toBeVisible();

    // Switch to "Expanded Time series"
    await tableModeDropdown.click();
    await page.getByRole("option", { name: "Expanded Time series" }).click();
    await pm.dashboardPanelActions.applyDashboardBtn();
    testLogger.info("PromQL table mode set to Expanded Time series");
    await pm.dashboardPanelActions.waitForChartToRender().catch(() => {});

    // Switch to "Aggregate"
    await tableModeDropdown.click();
    await page.getByRole("option", { name: "Aggregate" }).click();
    await pm.dashboardPanelActions.applyDashboardBtn();
    testLogger.info("PromQL table mode set to Aggregate");
    await pm.dashboardPanelActions.waitForChartToRender().catch(() => {});

    await pm.dashboardPanelActions.savePanel();
    testLogger.info("Verifying PromQL table mode 'Aggregate' persists after save");
    await reopenPanelConfig(page, pm);
    await pm.dashboardPanelConfigs.scrollSidebarToElement(
      page.locator('[data-test="dashboard-config-promql-table-mode"]')
    );
    await expect(page.locator('[data-test="dashboard-config-promql-table-mode"]')).toContainText("Aggregate");
    await pm.dashboardPanelActions.savePanel();
    await cleanupTestDashboard(page, pm, dashboardName);
  });

  test("sticky first column: PromQL table (Aggregate mode) → enable toggle → apply; reopen → toggle state persists", async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();

    await setupPromQLTablePanelWithConfig(page, pm, dashboardName);

    // Sticky first column only appears when promql_table_mode is 'all' or 'expanded_timeseries'
    // Switch to "Aggregate" mode first to reveal the sticky column controls
    const tableModeDropdown = page.locator('[data-test="dashboard-config-promql-table-mode"]');
    await pm.dashboardPanelConfigs.scrollSidebarToElement(tableModeDropdown);
    await tableModeDropdown.click();
    await page.getByRole("option", { name: "Aggregate" }).click();
    testLogger.info("Table mode set to Aggregate — sticky column controls now visible");

    const stickyFirstCol = page.locator('[data-test="dashboard-config-sticky-first-column"]');
    await pm.dashboardPanelConfigs.scrollSidebarToElement(stickyFirstCol);
    await expect(stickyFirstCol).toBeVisible();

    // Enable the toggle (click to turn on)
    await stickyFirstCol.click();
    await pm.dashboardPanelActions.applyDashboardBtn();
    testLogger.info("Sticky first column enabled");
    await pm.dashboardPanelActions.waitForChartToRender().catch(() => {});

    await pm.dashboardPanelActions.savePanel();
    testLogger.info("Verifying sticky first column toggle persists after save");
    await reopenPanelConfig(page, pm);
    const toggle = page.locator('[data-test="dashboard-config-sticky-first-column"]');
    await pm.dashboardPanelConfigs.scrollSidebarToElement(toggle);
    // q-toggle renders with role="checkbox" and aria-checked attribute
    const ariaChecked = await toggle.getAttribute("aria-checked");
    expect(ariaChecked).toBe("true");
    await pm.dashboardPanelActions.savePanel();
    await cleanupTestDashboard(page, pm, dashboardName);
  });
});
