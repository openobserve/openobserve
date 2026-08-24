/**
 * Shared helper functions for ConfigPanel E2E tests.
 * Each helper creates a dashboard + panel of the specified chart type
 * and (where indicated) opens the config sidebar, ready for assertions.
 */

import { setupTestDashboard, deleteDashboard } from "./dashCreation.js";
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

  // Ask whether the sidebar is COLLAPSED, which is the app's own condition:
  // `panel-sidebar-header-collapsed` is rendered under v-if="!isOpen", and
  // openConfigPanel() clicks exactly that element to expand the sidebar.
  //
  // The previous probe used `dashboard-config-description` as the "already open"
  // signal, which cannot work: that field lives inside the General OCollapsible,
  // and every section starts collapsed on mount (no section sets defaultExpanded).
  // So an open sidebar with collapsed sections read as "closed", openConfigPanel()
  // then waited for a collapsed-header element that does not exist while the
  // sidebar is open, and the helper died on a selector timeout. The sidebar's own
  // open flag lives in the shared dashboardPanelData.layout store while
  // expandedSections is per-mount state, so the two genuinely can disagree.
  const isCollapsed = await pm.dashboardPanelConfigs.configBtn
    .isVisible()
    .catch(() => false);

  if (isCollapsed) {
    // openConfigPanel() expands the sidebar and then expands all sections.
    await pm.dashboardPanelConfigs.openConfigPanel();
  } else {
    // Already open — the sections still need expanding, since config controls are
    // inside collapsibles. expandAllConfigSections() is idempotent.
    await pm.dashboardPanelConfigs.expandAllConfigSections();
  }
}

/**
 * Cleanup for tests whose panel config can't be saved on this environment's backend
 * (some `override_config` variants aren't accepted by every deployed backend build —
 * an environment version-skew, not a product bug). Skips savePanel()/backToDashboardList()
 * (which assume a successful save) and instead navigates straight to the dashboards
 * list, discarding the unsaved add_panel edit, then deletes the test dashboard.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} dashboardName
 */
export async function discardAndCleanupTestDashboard(page, dashboardName) {
  // Defensive: accept a native "leave site / discard changes" dialog if the app ever
  // adds a beforeunload guard for unsaved panel edits. Not currently triggered (this
  // app doesn't gate navigation on unsaved changes), but costs nothing to guard against.
  page.once('dialog', (dialog) => dialog.accept());
  await page.goto(
    `${process.env["ZO_BASE_URL"]}/web/dashboards?org_identifier=${process.env["ORGNAME"]}`
  );
  await page.locator('[data-test="dashboard-search"]').waitFor({ state: "visible", timeout: 15000 });
  await deleteDashboard(page, dashboardName);
  testLogger.info('Discarded unsaved panel edit and cleaned up test dashboard', { dashboardName });
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
  // remove the auto-seeded default y-axis before adding this panel's measure
  await pm.chartTypeSelector.removeField("y_axis_1", "y");
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
  // Monaco renders a div with role="code" — locate via CSS attribute selector (not getByRole)
  const monacoEditor = queryEditor.locator('[role="code"]');
  await monacoEditor.click({ clickCount: 3 });
  await page.keyboard.press('Backspace');
  // Use insertText (paste-like) to avoid Monaco autocomplete interfering with
  // character-by-character typing, which can truncate/mangle the query
  await page.keyboard.insertText(query);
  await page.keyboard.press('Escape'); // dismiss any autocomplete
  // Wait for Monaco's textarea to reflect the typed query
  await page.waitForFunction(
    (expectedQuery) => {
      const textarea = document.querySelector('[data-test="dashboard-panel-query-editor"] textarea');
      return Boolean(textarea && textarea.value.includes(expectedQuery));
    },
    query,
    { timeout: 10000 }
  );
  // Monaco debounce is 500ms — the textarea updates instantly but the Vue data model
  // (queries[0].query) only updates after the debounce fires. Without this wait,
  // applyDashboardBtn is clicked before the debounce fires, causing runQuery→isValid
  // to see an empty query and show an error toast that later trips savePanel's race.
  await page.waitForTimeout(600);

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

export async function setupPromQLMetricPanelWithConfig(page, pm, dashboardName, panelName = "Test Panel") {
  await buildPromQLPanel(page, pm, dashboardName, {
    chartType: "metric",
    panelName,
    query: "sum(cpu_usage)",
  });
  await pm.dashboardPanelConfigs.openConfigPanel();
  testLogger.info("PromQL metric panel with config ready", { dashboardName, panelName });
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
  const opts = { chartType: "table", panelName };
  if (query) opts.query = query;
  await buildPromQLPanel(page, pm, dashboardName, opts);
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
 * Snapshot of what a panel actually put on screen, for assertion failure messages.
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<string>} one-line summary, safe to embed in an expect() message
 */
export async function describePanelRender(page) {
  const snapshot = await page
    .evaluate(() => {
      const el = document.querySelector('[data-test="chart-renderer"]');
      const applyBtn = document.querySelector('[data-test="dashboard-apply"]');
      // Apply is disabled (non-enterprise) or swapped for Cancel (enterprise)
      // for the whole query run, so this is the panel's own "still loading" flag.
      const cancelBtn = document.querySelector('[data-test="dashboard-cancel"]');
      return {
        chartRenderer: !!el,
        noData: !!document.querySelector('[data-test="no-data"]'),
        panelError:
          document.querySelector('[data-test="panel-schema-renderer-error-message"]')?.textContent?.trim() ?? null,
        stillLoading: !!cancelBtn || (!!applyBtn && applyBtn.disabled === true),
        applyPresent: !!applyBtn,
        // The copy overlay is driven by the metric series' own _metricText, so
        // it is a DOM-visible proxy for "the converter produced a real series".
        // Present + empty SVG => the series exists and ECharts failed to draw it.
        // Absent + empty SVG => no usable series was produced at all.
        metricOverlay: !!document.querySelector('[data-test="dashboard-metric-copy-overlay"]'),
        canvas: el ? el.querySelectorAll("canvas").length : 0,
        svg: el ? el.querySelectorAll("svg").length : 0,
        svgPaths: el ? el.querySelectorAll("svg path").length : 0,
        svgTexts: el ? el.querySelectorAll("svg text").length : 0,
        text: el ? (el.textContent ?? "").trim().slice(0, 120) : null,
      };
    })
    .catch((e) => ({ evaluateFailed: e.message }));
  return `panel render state: ${JSON.stringify(snapshot)}`;
}

/**
 * The text nodes the metric panel drew, with their resolved fill colours.
 *
 * The metric value is an ECharts `renderItem` text on the SVG renderer, so its
 * colour can land either as a `fill` attribute or as inline style depending on
 * the ECharts build — getComputedStyle normalises both to "rgb(r, g, b)".
 *
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<Array<{text: string, fill: string}>>}
 */
export async function getMetricTextFills(page) {
  return page.evaluate(() => {
    const root = document.querySelector('[data-test="chart-renderer"]');
    if (!root) return [];
    return Array.from(root.querySelectorAll("svg text")).map((el) => ({
      text: (el.textContent ?? "").trim(),
      fill: getComputedStyle(el).fill,
    }));
  });
}

/**
 * "#b91c1c" → "rgb(185, 28, 28)" — the form getComputedStyle reports, so the
 * swatch hex the test picked can be compared against what actually rendered.
 * @param {string} hex
 * @returns {string}
 */
export function hexToRgbString(hex) {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
}

/**
 * Collects browser console errors/warnings for the rest of the test.
 *
 * ChartRenderer swallows a failing `setOption` with a bare `console.error`, so a
 * chart that silently draws nothing leaves no trace in the DOM — only here.
 *
 * @param {import('@playwright/test').Page} page
 * @returns {{messages: string[], describe: () => string}}
 */
export function collectConsoleErrors(page) {
  const messages = [];
  // Keep enough of the text for a full stack: the frames after the first are
  // what identify which option array ECharts choked on, and a short slice cuts
  // them off exactly where they start being useful.
  const CAP = 1200;
  page.on("console", (msg) => {
    if (msg.type() === "error" || msg.type() === "warning") {
      messages.push(`[${msg.type()}] ${msg.text()}`.slice(0, CAP));
    }
  });
  page.on("pageerror", (err) => {
    messages.push(`[pageerror] ${err.message}\n${err.stack ?? ""}`.slice(0, CAP));
  });
  return {
    messages,
    describe: () => `console: ${JSON.stringify(messages.slice(-15))}`,
  };
}

/**
 * Waits until the panel has finished loading and settled on a final render.
 * The metric assertions are only meaningful once streaming has completed —
 * mid-stream the panel legitimately shows the previous chart or nothing at all.
 *
 * Returns whether it actually settled: a panel stuck loading forever is a real
 * failure mode here, and swallowing the timeout would hide it.
 *
 * @param {import('@playwright/test').Page} page
 * @param {object} pm - PageManager instance
 * @returns {Promise<boolean>} true if the panel finished loading in time
 */
export async function waitForPanelRenderSettled(page, pm) {
  // The Apply button is disabled (or swapped for Cancel) for the whole streaming
  // run, so it covers every chunk — unlike waiting on the first query response,
  // which returns while later chunks are still arriving.
  const settled = await pm.dashboardPanelActions
    .waitForChartToRender()
    .then(() => true)
    .catch((e) => {
      testLogger.warn("waitForChartToRender:", e.message);
      return false;
    });
  // One frame for the final setOption to reach the DOM.
  await page.waitForTimeout(300);
  return settled;
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
