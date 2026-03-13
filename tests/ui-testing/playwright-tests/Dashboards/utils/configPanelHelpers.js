/**
 * Shared helper functions for ConfigPanel E2E tests.
 * Each helper creates a dashboard + panel of the specified chart type
 * and (where indicated) opens the config sidebar, ready for assertions.
 */

import { setupTestDashboard } from "./dashCreation.js";
const testLogger = require('../../utils/test-logger.js');

// ---------------------------------------------------------------------------
// Name generator
// ---------------------------------------------------------------------------

/**
 * Re-opens an already-saved panel and opens the config sidebar.
 * Use this after savePanel() to verify that config values persisted.
 *
 * @param {import('@playwright/test').Page} page
 * @param {object} pm - PageManager instance
 */
export async function reopenPanelConfig(page, pm) {
  await page.locator('[data-test="dashboard-panel-bar"]').first().hover();
  await page.locator('[data-test*="dashboard-edit-panel"][data-test$="-dropdown"]').first().click();
  await page.locator('[data-test="dashboard-edit-panel"]').click();
  await pm.dashboardPanelConfigs.openConfigPanel();
}

export const generateDashboardName = () =>
  "Dashboard_" + Math.random().toString(36).slice(2, 11) + "_" + Date.now();

// ---------------------------------------------------------------------------
// Base panel builder — all other helpers delegate here
// ---------------------------------------------------------------------------

/**
 * Creates a dashboard, adds a panel, selects chart type + stream + y-field,
 * names the panel, then clicks Apply.
 * Does NOT open the config sidebar.
 *
 * @param {import('@playwright/test').Page} page
 * @param {object} pm - PageManager instance
 * @param {string} dashboardName
 * @param {object} options
 * @param {string} options.chartType  - e.g. "bar", "line", "table", "gauge"
 * @param {string} [options.panelName]
 * @param {string} [options.yField]
 * @param {string} [options.breakdownField] - optional breakdown ("b" axis) field
 */
async function buildPanel(page, pm, dashboardName, {
  chartType,
  panelName = "Test Panel",
  yField = "kubernetes_container_hash",
  breakdownField = null,
}) {
  await setupTestDashboard(page, pm, dashboardName);
  await pm.dashboardCreate.addPanel();
  await pm.chartTypeSelector.selectChartType(chartType);
  await pm.chartTypeSelector.selectStreamType("logs");
  await pm.chartTypeSelector.selectStream("e2e_automate");
  await pm.chartTypeSelector.searchAndAddField(yField, "y");
  if (breakdownField) {
    await pm.chartTypeSelector.searchAndAddField(breakdownField, "b");
  }
  await pm.dashboardPanelActions.addPanelName(panelName);
  await pm.dashboardPanelActions.applyDashboardBtn();
  testLogger.info("Panel built", { chartType, dashboardName, panelName });
}

// ---------------------------------------------------------------------------
// Public helpers
// ---------------------------------------------------------------------------

/**
 * Bar chart panel — config sidebar NOT opened.
 * Use when the test opens config panel itself (e.g. to test persistence).
 */
export async function setupBarPanel(page, pm, dashboardName, panelName = "Test Panel") {
  await buildPanel(page, pm, dashboardName, { chartType: "bar", panelName });
}

/**
 * Bar chart panel — config sidebar opened and ready.
 */
export async function setupBarPanelWithConfig(page, pm, dashboardName, panelName = "Test Panel") {
  await buildPanel(page, pm, dashboardName, { chartType: "bar", panelName });
  await pm.dashboardPanelConfigs.openConfigPanel();
  testLogger.info("Bar panel with config ready", { dashboardName, panelName });
}

/**
 * Bar chart panel WITH a breakdown field — config sidebar opened and ready.
 * Required for trellis, color-by-series, and top-N tests.
 */
export async function setupBarPanelWithBreakdownAndConfig(page, pm, dashboardName, panelName = "Test Panel") {
  await buildPanel(page, pm, dashboardName, {
    chartType: "bar",
    panelName,
    breakdownField: "kubernetes_host",
  });
  await pm.dashboardPanelConfigs.openConfigPanel();
  testLogger.info("Bar panel with breakdown and config ready", { dashboardName, panelName });
}

/**
 * Line chart panel — config sidebar opened and ready.
 */
export async function setupLinePanelWithConfig(page, pm, dashboardName, panelName = "Test Panel") {
  await buildPanel(page, pm, dashboardName, { chartType: "line", panelName });
  await pm.dashboardPanelConfigs.openConfigPanel();
  testLogger.info("Line panel with config ready", { dashboardName, panelName });
}

/**
 * Area chart panel — config sidebar opened and ready.
 */
export async function setupAreaPanelWithConfig(page, pm, dashboardName, panelName = "Test Panel") {
  await buildPanel(page, pm, dashboardName, { chartType: "area", panelName });
  await pm.dashboardPanelConfigs.openConfigPanel();
  testLogger.info("Area panel with config ready", { dashboardName, panelName });
}

/**
 * Table chart panel — config sidebar opened and ready.
 */
export async function setupTablePanelWithConfig(page, pm, dashboardName, panelName = "Test Panel") {
  await buildPanel(page, pm, dashboardName, { chartType: "table", panelName });
  await pm.dashboardPanelConfigs.openConfigPanel();
  testLogger.info("Table panel with config ready", { dashboardName, panelName });
}

/**
 * Gauge chart panel — config sidebar opened and ready.
 */
export async function setupGaugePanelWithConfig(page, pm, dashboardName, panelName = "Test Panel") {
  await buildPanel(page, pm, dashboardName, { chartType: "gauge", panelName });
  await pm.dashboardPanelConfigs.openConfigPanel();
  testLogger.info("Gauge panel with config ready", { dashboardName, panelName });
}

/**
 * GeoMap chart panel — config sidebar opened and ready.
 */
export async function setupGeomapPanelWithConfig(page, pm, dashboardName, panelName = "Test Panel") {
  await buildPanel(page, pm, dashboardName, { chartType: "geomap", panelName });
  await pm.dashboardPanelConfigs.openConfigPanel();
  testLogger.info("Geomap panel with config ready", { dashboardName, panelName });
}

/**
 * Maps chart panel — config sidebar opened and ready.
 */
export async function setupMapsPanelWithConfig(page, pm, dashboardName, panelName = "Test Panel") {
  await buildPanel(page, pm, dashboardName, { chartType: "maps", panelName });
  await pm.dashboardPanelConfigs.openConfigPanel();
  testLogger.info("Maps panel with config ready", { dashboardName, panelName });
}

/**
 * Metric chart panel — config sidebar opened and ready.
 */
export async function setupMetricPanelWithConfig(page, pm, dashboardName, panelName = "Test Panel") {
  await buildPanel(page, pm, dashboardName, { chartType: "metric", panelName });
  await pm.dashboardPanelConfigs.openConfigPanel();
  testLogger.info("Metric panel with config ready", { dashboardName, panelName });
}
