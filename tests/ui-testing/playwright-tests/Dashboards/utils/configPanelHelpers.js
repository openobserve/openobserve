/**
 * Shared helper functions for ConfigPanel E2E tests.
 * Each helper creates a dashboard + panel of the specified chart type
 * and (where indicated) opens the config sidebar, ready for assertions.
 */

import { setupTestDashboard } from "./dashCreation.js";
import { ingestionForMaps } from "./dashIngestion.js";
import testLogger from '../../utils/test-logger.js';

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
  // savePanel() already waited for navigation away from add_panel.
  // Just wait for the panel bar to be rendered before hovering.
  const panelBar = page.locator('[data-test="dashboard-panel-bar"]').first();
  await panelBar.waitFor({ state: 'visible', timeout: 30000 });
  await panelBar.hover();
  await page.locator('[data-test*="dashboard-edit-panel"][data-test$="-dropdown"]').first().click();
  await page.locator('[data-test="dashboard-edit-panel"]').click();
  // Wait for the add_panel page to fully load before interacting with the config sidebar
  await page.waitForURL(/\/add_panel/, { timeout: 15000 });
  await page.locator('[data-test="dashboard-sidebar"]').waitFor({ state: "visible", timeout: 15000 });
  // Config panel may already be open (state preserved); only open if not already visible
  const isConfigOpen = await page.locator('[data-test="dashboard-config-description"]').isVisible();
  if (!isConfigOpen) {
    await pm.dashboardPanelConfigs.openConfigPanel();
  }
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
 * Table chart panel — config sidebar NOT opened.
 * Use when the test does not need config panel interaction.
 */
export async function setupTablePanel(page, pm, dashboardName, panelName = "Test Panel") {
  await buildPanel(page, pm, dashboardName, { chartType: "table", panelName });
  testLogger.info("Table panel ready", { dashboardName, panelName });
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
 * Pie chart panel (SQL builder) — config sidebar opened and ready.
 */
export async function setupPiePanelWithConfig(page, pm, dashboardName, panelName = "Test Panel") {
  await buildPanel(page, pm, dashboardName, { chartType: "pie", panelName });
  await pm.dashboardPanelConfigs.openConfigPanel();
  testLogger.info("Pie panel with config ready", { dashboardName, panelName });
}

/**
 * Donut chart panel (SQL builder) — config sidebar opened and ready.
 */
export async function setupDonutPanelWithConfig(page, pm, dashboardName, panelName = "Test Panel") {
  await buildPanel(page, pm, dashboardName, { chartType: "donut", panelName });
  await pm.dashboardPanelConfigs.openConfigPanel();
  testLogger.info("Donut panel with config ready", { dashboardName, panelName });
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
 * GeoMap chart panel — ingests geo data, builds panel with lat/lon fields, opens config sidebar.
 */
export async function setupGeomapPanelWithConfig(page, pm, dashboardName, panelName = "Test Panel") {
  await ingestionForMaps(page);
  await setupTestDashboard(page, pm, dashboardName);
  await pm.dashboardCreate.addPanel();
  await pm.chartTypeSelector.selectChartType("geomap");
  await pm.chartTypeSelector.selectStreamType("logs");
  await pm.chartTypeSelector.selectStream("geojson");
  await pm.chartTypeSelector.searchAndAddField("lat", "latitude");
  await pm.chartTypeSelector.searchAndAddField("lon", "longitude");
  await pm.dashboardPanelActions.addPanelName(panelName);
  await pm.dashboardPanelActions.applyDashboardBtn();
  await pm.dashboardPanelConfigs.openConfigPanel();
  testLogger.info("Geomap panel with config ready", { dashboardName, panelName });
}

/**
 * Maps chart panel — ingests geo data, builds panel with name+value fields, opens config sidebar.
 */
export async function setupMapsPanelWithConfig(page, pm, dashboardName, panelName = "Test Panel") {
  await ingestionForMaps(page);
  await setupTestDashboard(page, pm, dashboardName);
  await pm.dashboardCreate.addPanel();
  await pm.chartTypeSelector.selectChartType("maps");
  await pm.chartTypeSelector.selectStreamType("logs");
  await pm.chartTypeSelector.selectStream("geojson");
  await pm.chartTypeSelector.searchAndAddField("country", "x");
  await pm.chartTypeSelector.searchAndAddField("lat", "y");
  await pm.dashboardPanelActions.addPanelName(panelName);
  await pm.dashboardPanelActions.applyDashboardBtn();
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

// ---------------------------------------------------------------------------
// PromQL helpers
// ---------------------------------------------------------------------------

/**
 * Internal helper: creates a dashboard + panel in PromQL mode.
 * Switches stream type to metrics, enables PromQL mode, enters a custom query,
 * applies it, and waits for chart to render.
 * Caller must open config panel if needed.
 *
 * @param {import('@playwright/test').Page} page
 * @param {object} pm - PageManager instance
 * @param {string} dashboardName
 * @param {object} options
 * @param {string} options.chartType  - e.g. "line", "pie", "table"
 * @param {string} [options.panelName]
 * @param {string} [options.query]    - PromQL query string
 */
export async function buildPromQLPanel(page, pm, dashboardName, {
  chartType,
  panelName = "Test Panel",
  query = "zo_node_memory_usage",
}) {
  await setupTestDashboard(page, pm, dashboardName);
  await pm.dashboardCreate.addPanel();
  await pm.chartTypeSelector.selectChartType(chartType);
  await pm.chartTypeSelector.selectStreamType("metrics");

  // Switch to PromQL mode — button only visible after selecting metrics stream type
  const promqlBtn = page.locator('[data-test="dashboard-promql-query-type"]');
  await promqlBtn.waitFor({ state: "visible", timeout: 10000 });
  await promqlBtn.click();

  // Switch to Custom query mode to access Monaco editor
  const customBtn = page.locator('[data-test="dashboard-custom-query-type"]');
  await customBtn.waitFor({ state: "visible", timeout: 5000 });
  await customBtn.click();

  // Enter PromQL query in Monaco editor
  const queryEditor = page.locator('[data-test="dashboard-panel-query-editor"]');
  await queryEditor.waitFor({ state: "visible", timeout: 10000 });
  const monacoEditor = queryEditor.getByRole('code');
  await monacoEditor.click({ clickCount: 3 });
  await page.keyboard.press('Backspace');
  await page.keyboard.type(query, { delay: 50 });
  await page.keyboard.press('Escape'); // dismiss any autocomplete
  // Wait for Monaco debounce to sync editor content to Vue data model
  await page.waitForTimeout(3000);

  await pm.dashboardPanelActions.addPanelName(panelName);
  await pm.dashboardPanelActions.applyDashboardBtn();
  await pm.dashboardPanelActions.waitForChartToRender().catch((e) => testLogger.warn("waitForChartToRender:", e.message));
  testLogger.info("PromQL panel built", { chartType, dashboardName, panelName });
}

/**
 * PromQL line chart panel — config sidebar opened and ready.
 * Caller's test.beforeAll must call ensureMetricsIngested().
 */
export async function setupPromQLPanelWithConfig(page, pm, dashboardName, panelName = "Test Panel") {
  await buildPromQLPanel(page, pm, dashboardName, { chartType: "line", panelName });
  await pm.dashboardPanelConfigs.openConfigPanel();
  testLogger.info("PromQL line panel with config ready", { dashboardName, panelName });
}

/**
 * PromQL pie chart panel — config sidebar opened and ready.
 * Used for aggregation function tests (only visible on pie/donut/geomap/maps in PromQL mode).
 */
export async function setupPromQLPiePanelWithConfig(page, pm, dashboardName, panelName = "Test Panel") {
  await buildPromQLPanel(page, pm, dashboardName, { chartType: "pie", panelName });
  await pm.dashboardPanelConfigs.openConfigPanel();
  testLogger.info("PromQL pie panel with config ready", { dashboardName, panelName });
}

/**
 * PromQL donut chart panel — config sidebar opened and ready.
 * Used for aggregation function tests (only visible on pie/donut/geomap/maps in PromQL mode).
 */
export async function setupPromQLDonutPanelWithConfig(page, pm, dashboardName, panelName = "Test Panel") {
  await buildPromQLPanel(page, pm, dashboardName, { chartType: "donut", panelName });
  await pm.dashboardPanelConfigs.openConfigPanel();
  testLogger.info("PromQL donut panel with config ready", { dashboardName, panelName });
}

/**
 * PromQL table panel — config sidebar opened and ready.
 * Used for PromQL table mode, column visibility, sticky columns tests.
 */
export async function setupPromQLTablePanelWithConfig(page, pm, dashboardName, panelName = "Test Panel", query) {
  await buildPromQLPanel(page, pm, dashboardName, { chartType: "table", panelName, ...(query && { query }) });
  await pm.dashboardPanelConfigs.openConfigPanel();
  testLogger.info("PromQL table panel with config ready", { dashboardName, panelName });
}

/**
 * PromQL geomap panel — config sidebar opened and ready.
 * Used for testing PromQL-specific geo lat/lon/weight label config options.
 * Chart may not render (no geo data), but config sidebar shows geo label inputs.
 */
export async function setupPromQLGeomapPanelWithConfig(page, pm, dashboardName, panelName = "Test Panel") {
  await buildPromQLPanel(page, pm, dashboardName, { chartType: "geomap", panelName });
  await pm.dashboardPanelConfigs.openConfigPanel();
  testLogger.info("PromQL geomap panel with config ready", { dashboardName, panelName });
}

/**
 * PromQL maps panel — config sidebar opened and ready.
 * Used for testing PromQL-specific maps name label and map type config options.
 * Chart may not render (no geo data), but config sidebar shows maps config inputs.
 */
export async function setupPromQLMapsPanelWithConfig(page, pm, dashboardName, panelName = "Test Panel") {
  await buildPromQLPanel(page, pm, dashboardName, { chartType: "maps", panelName });
  await pm.dashboardPanelConfigs.openConfigPanel();
  testLogger.info("PromQL maps panel with config ready", { dashboardName, panelName });
}

/**
 * Creates a destination dashboard (bar panel) and adds a second tab named `secondTabName`.
 * Leaves the browser on the dashboard view page — caller should call backToDashboardList() next.
 *
 * @param {import('@playwright/test').Page} page
 * @param {object} pm - PageManager instance
 * @param {string} dashboardName - Name for the destination dashboard
 * @param {string} [secondTabName="Tab Two"] - Name for the second tab to add
 */
export async function setupDestinationDashboardWithTabs(page, pm, dashboardName, secondTabName = "Tab Two") {
  await setupBarPanelWithConfig(page, pm, dashboardName);
  await pm.dashboardPanelActions.savePanel();

  // Add a second tab via dashboard settings
  await pm.dashboardSetting.openSetting();
  await pm.dashboardSetting.addTabAndWait(secondTabName);
  await pm.dashboardSetting.closeSettingDashboard();

  testLogger.info("Destination dashboard ready with second tab", { dashboardName, secondTabName });
}
