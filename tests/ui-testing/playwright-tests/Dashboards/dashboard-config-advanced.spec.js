const {
  test,
  expect,
  navigateToBase,
} = require("../utils/enhanced-baseFixtures.js");
import PageManager from "../../pages/page-manager";
import { ingestion } from "./utils/dashIngestion.js";
import { cleanupTestDashboard } from "./utils/dashCreation.js";
import {
  generateDashboardName,
  setupLinePanelWithConfig,
  setupBarPanelWithBreakdownAndConfig,
  setupPiePanelWithConfig,
  setupTablePanelWithConfig,
  setupMetricPanelWithConfig,
  reopenPanelConfig,
} from "./utils/configPanelHelpers.js";
import { verifyColorOnCanvas, applyAndWaitForRender } from "./utils/canvasHelpers.js";
const testLogger = require('../utils/test-logger.js');

test.describe.configure({ mode: "parallel" });
// No file-level `retries` override: it used to pin this file to 1 retry, which both
// added a retry locally (project default 0, hiding flakes during development) and
// *cut* CI's 3 retries down to 1. The project-level policy is the right one.

test.describe("ConfigPanel — Advanced Settings", () => {
  test.beforeEach(async ({ page }) => {
    await navigateToBase(page);
    await ingestion(page);
  });

  test("time shift: 0m ref present → add two rows → remove one → apply → chart renders", async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();

    await setupLinePanelWithConfig(page, pm, dashboardName);

    // Count added time shift rows by their remove buttons (0m ref row has no remove button)
    const removeButtons = pm.dashboardPanelConfigs.timeShiftRemoveButtons;
    await expect(removeButtons).toHaveCount(0);

    // Add two time shifts
    await pm.dashboardPanelConfigs.addTimeShift();
    await pm.dashboardPanelConfigs.addTimeShift();
    await expect(removeButtons).toHaveCount(2);

    // Remove first added shift
    await pm.dashboardPanelConfigs.removeTimeShift(0);
    await expect(removeButtons).toHaveCount(1);

    await pm.dashboardPanelActions.applyDashboardBtn();
    testLogger.info("Time shift added and removed, chart renders");
    await pm.dashboardPanelActions.waitForChartToRender();
    await pm.dashboardPanelActions.verifyChartHasData(expect);

    await pm.dashboardPanelActions.savePanel();
    testLogger.info("Verifying time shift count persists after save");
    await reopenPanelConfig(page, pm);
    await expect(pm.dashboardPanelConfigs.timeShiftRemoveButtons).toHaveCount(1);
    await pm.dashboardPanelActions.savePanel();
    await cleanupTestDashboard(page, pm, dashboardName);
  });

  test("trellis disabled when time shifts are active", async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();

    await setupBarPanelWithBreakdownAndConfig(page, pm, dashboardName);

    // Trellis is disabled by `isBreakdownFieldEmpty || hasTimeShifts`. Without
    // asserting it starts enabled, "disabled after adding a time shift" would also
    // pass if the breakdown field silently failed to attach — a green test for the
    // wrong reason. The panel has a breakdown, so it must be enabled here.
    await expect(pm.dashboardPanelConfigs.trellisTrigger).toBeEnabled();
    testLogger.info("Trellis enabled before time shift (breakdown present)");

    await pm.dashboardPanelConfigs.addTimeShift();

    await expect(pm.dashboardPanelConfigs.trellisTrigger).toBeDisabled();
    testLogger.info("Trellis disabled with time shifts active");

    await pm.dashboardPanelActions.savePanel();
    await cleanupTestDashboard(page, pm, dashboardName);
  });

  test("color by series: select first series → set custom color → save → color appears on chart canvas", async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();

    await setupBarPanelWithBreakdownAndConfig(page, pm, dashboardName);

    await expect(pm.dashboardPanelConfigs.colorBySeriesBtn).toBeVisible();

    // Open popup → select first available series → set custom color → save
    await pm.dashboardPanelConfigs.openColorBySeries();
    await expect(pm.dashboardPanelConfigs.colorBySeriesPopup).toBeVisible();

    // Don't blind-pick option 0. The kubernetes_host breakdown yields an "(empty)"
    // bucket for rows with no host, and that series draws next to nothing — colouring
    // it left only ~3 matching pixels and failed the canvas check intermittently.
    // Pick the first series that names a real host instead.
    const seriesLabels = await pm.dashboardPanelConfigs.getColorBySeriesOptionLabels(0);
    const targetSeries = seriesLabels.find((label) => label && label !== "(empty)");
    expect(
      targetSeries,
      `no non-empty series offered in the color-by-series dropdown: ${JSON.stringify(seriesLabels)}`
    ).toBeTruthy();

    const customColor = "#e63946";
    const selectedSeriesName = await pm.dashboardPanelConfigs.configureColorBySeries({ rowIndex: 0, matchText: targetSeries, color: customColor });
    // matchText is a substring match — confirm it resolved to the series we picked
    // and not a longer label that happens to contain it.
    expect(selectedSeriesName).toBe(targetSeries);
    testLogger.info("Color by series: series selected with custom color", { selectedSeriesName });

    await pm.dashboardPanelConfigs.saveColorBySeries();
    await expect(pm.dashboardPanelConfigs.colorBySeriesPopup).not.toBeVisible();
    testLogger.info("Color by series saved");

    // Apply, wait for API response + ECharts repaint before pixel scan
    await applyAndWaitForRender(page, pm);

    const colorResult = await verifyColorOnCanvas(page, { r: 230, g: 57, b: 70 });
    testLogger.info("Canvas color verification", { matchingPixels: colorResult.matchingPixels, colorFound: colorResult.colorFound });
    expect(
      colorResult.colorFound,
      `Expected ${customColor} on the chart canvas for series "${selectedSeriesName}", ` +
        `but only ${colorResult.matchingPixels} pixels matched across ${colorResult.canvasCount} canvases`
    ).toBe(true);

    await pm.dashboardPanelActions.savePanel();
    await cleanupTestDashboard(page, pm, dashboardName);
  });

  test("override config: select field + bytes unit → save → table renders; reopen verifies field persists", async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();

    await setupTablePanelWithConfig(page, pm, dashboardName);

    // Open popup, pick first column, select Bytes unit, save
    await pm.dashboardPanelConfigs.configureOverrideWithUnit({ unitName: "Bytes" });
    testLogger.info("Override config: field + Bytes unit saved");

    // Wait for the query to finish before asserting on the table: the pre-existing
    // table from the setup Apply is still on screen while the new one loads, so a
    // bare toBeVisible() would assert against the previous render.
    await pm.dashboardPanelActions.applyDashboardBtn();
    await pm.dashboardPanelActions.waitForChartToRender();
    await expect(pm.dashboardPanelActions.dashboardTable).toBeVisible();
    testLogger.info("Override config applied — table renders");

    // Verify override config persists after save
    await pm.dashboardPanelActions.savePanel();
    testLogger.info("Verifying override config persists after save");
    await reopenPanelConfig(page, pm);
    await pm.dashboardPanelConfigs.openOverrideConfig();
    // Verify the saved override persisted — the field row reappears and its
    // unit override (Bytes) round-tripped.
    await expect(pm.dashboardPanelConfigs.getOverrideFieldRow(0)).toBeVisible();
    await expect(pm.dashboardPanelConfigs.getOverrideUnitSelect()).toContainText("Bytes");
    await pm.dashboardPanelConfigs.closeOverrideConfig();

    await pm.dashboardPanelActions.savePanel();
    await cleanupTestDashboard(page, pm, dashboardName);
  });

  test("value mapping: fill value + display text + set color → apply → table renders; reopen verifies mapping persists", async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();

    await setupTablePanelWithConfig(page, pm, dashboardName);

    // Open popup, fill value + display text + initialize color, apply
    await pm.dashboardPanelConfigs.configureValueMapping({ value: "test_value", text: "Mapped!", setColor: true });
    testLogger.info("Value mapping: applied with value, display text, and color");

    await pm.dashboardPanelActions.applyDashboardBtn();
    await pm.dashboardPanelActions.waitForChartToRender();
    await expect(pm.dashboardPanelActions.dashboardTable).toBeVisible();
    testLogger.info("Value mapping applied — table renders");

    // Verify value mapping persists after save
    await pm.dashboardPanelActions.savePanel();
    testLogger.info("Verifying value mapping persists after save");
    await reopenPanelConfig(page, pm);
    const popup = await pm.dashboardPanelConfigs.openValueMappingPopup();
    await expect(pm.dashboardPanelConfigs.valueMappingRowField(popup, 0, "value")).toHaveValue("test_value");
    await expect(pm.dashboardPanelConfigs.valueMappingRowField(popup, 0, "text")).toHaveValue("Mapped!");
    testLogger.info("Value mapping persisted after save");
    await pm.dashboardPanelConfigs.closeValueMappingPopup();

    await pm.dashboardPanelActions.savePanel();
    await cleanupTestDashboard(page, pm, dashboardName);
  });

  test("background color: visible for metric → select Single Color → apply", async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();

    await setupMetricPanelWithConfig(page, pm, dashboardName);

    const bgColorDropdown = pm.dashboardPanelConfigs.bgColor;
    await expect(bgColorDropdown).toBeVisible();
    await pm.dashboardPanelConfigs.selectBGColor("Single Color");
    await pm.dashboardPanelActions.applyDashboardBtn();
    // Let the query settle before saving — savePanel racing an in-flight Apply is a
    // recurring source of intermittent save failures.
    await pm.dashboardPanelActions.waitForChartToRender();
    testLogger.info("Background color set to Single Color");

    await pm.dashboardPanelActions.savePanel();
    testLogger.info("Verifying background color Single Color persists after save");
    await reopenPanelConfig(page, pm);
    await expect(pm.dashboardPanelConfigs.bgColor).toContainText("Single Color");
    await pm.dashboardPanelActions.savePanel();
    await cleanupTestDashboard(page, pm, dashboardName);
  });

  test("top N: visible with breakdown → set 5 → apply → chart renders", async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();

    await setupBarPanelWithBreakdownAndConfig(page, pm, dashboardName);

    const topNInput = pm.dashboardPanelConfigs.topResults;
    await expect(topNInput).toBeVisible();
    await topNInput.locator('[data-test$="-field"]').fill("5");
    await pm.dashboardPanelActions.applyDashboardBtn();
    testLogger.info("Top N set to 5");
    await pm.dashboardPanelActions.waitForChartToRender();
    await pm.dashboardPanelActions.verifyChartHasData(expect);

    await pm.dashboardPanelActions.savePanel();
    testLogger.info("Verifying top N value persists after save");
    await reopenPanelConfig(page, pm);
    await expect(pm.dashboardPanelConfigs.topResults.locator('[data-test$="-field"]')).toHaveValue("5");
    await pm.dashboardPanelActions.savePanel();
    await cleanupTestDashboard(page, pm, dashboardName);
  });

  test("top N others: set top 5 → Others toggle appears → enable → apply → chart renders; disable → apply", async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();

    await setupBarPanelWithBreakdownAndConfig(page, pm, dashboardName);

    // Set top N to make the "Others" toggle appear
    const topNInput = pm.dashboardPanelConfigs.topResults;
    await expect(topNInput).toBeVisible();
    await topNInput.locator('[data-test$="-field"]').fill("5");

    // Others toggle should now be visible
    const othersToggle = pm.dashboardPanelConfigs.topResultsOthers;
    await expect(othersToggle).toBeVisible({ timeout: 5000 });
    testLogger.info("Top N Others toggle appeared after setting top_results");

    // Enable Others toggle
    await othersToggle.click();
    await pm.dashboardPanelActions.applyDashboardBtn();
    testLogger.info("Top N Others enabled");
    await pm.dashboardPanelActions.waitForChartToRender();
    await pm.dashboardPanelActions.verifyChartHasData(expect);

    // Disable Others toggle
    await othersToggle.click();
    await pm.dashboardPanelActions.applyDashboardBtn();
    testLogger.info("Top N Others disabled");
    await pm.dashboardPanelActions.waitForChartToRender();
    await pm.dashboardPanelActions.verifyChartHasData(expect);

    await pm.dashboardPanelActions.savePanel();
    await cleanupTestDashboard(page, pm, dashboardName);
  });

  test("chart alignment: visible → change alignment → apply → chart renders; reopen → alignment persists", async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();

    // shouldApplyChartAlign() gates this control on: pie/donut type AND show_legends
    // AND legends_position === "right" AND a plain/scroll/null legend type AND no
    // trellis layout. This test used to build a *bar* panel, so the control could
    // never appear and the "skip gracefully" branch fired every single run — the
    // test created a dashboard, asserted nothing, and deleted it again. A pie panel
    // with the legend moved to the right is the configuration that actually shows it.
    await setupPiePanelWithConfig(page, pm, dashboardName);
    await pm.dashboardPanelConfigs.legendPosition("Right");

    const alignDropdown = pm.dashboardPanelConfigs.chartAlign;
    await expect(alignDropdown).toBeVisible();
    // Default is Auto (chart_align === null)
    await expect(alignDropdown).toHaveAttribute("data-test-selected-value", "null");

    // OToggleGroup items are always visible — click the target option directly.
    await pm.dashboardPanelConfigs.selectChartAlign("Center");
    await expect(alignDropdown).toHaveAttribute("data-test-selected-value", "center");
    testLogger.info("Chart alignment set to: Center");

    await pm.dashboardPanelActions.applyDashboardBtn();
    await pm.dashboardPanelActions.waitForChartToRender();
    await pm.dashboardPanelActions.verifyChartHasData(expect);

    await pm.dashboardPanelActions.savePanel();
    testLogger.info("Verifying chart alignment persists after save");
    await reopenPanelConfig(page, pm);
    // Original assertion, kept as-is.
    await expect(pm.dashboardPanelConfigs.chartAlign).toBeVisible();
    // Additionally assert the *value* round-tripped — visibility alone would pass
    // with the alignment reset back to Auto.
    await expect(pm.dashboardPanelConfigs.chartAlign).toHaveAttribute(
      "data-test-selected-value",
      "center"
    );
    testLogger.info("Chart alignment persisted as Center");
    await pm.dashboardPanelActions.savePanel();
    await cleanupTestDashboard(page, pm, dashboardName);
  });

  test("sparkline: enable → apply → save → reopen → toggle persists ON", {
    tag: ['@dashboard', '@configPanel', '@sparkline', '@P0', '@all'],
  }, async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();

    await setupMetricPanelWithConfig(page, pm, dashboardName);

    // Sparkline is metric-only — enable it; sub-controls should appear
    await pm.dashboardPanelConfigs.enableSparkline();
    expect(await pm.dashboardPanelConfigs.isSparklineEnabled()).toBe(true);
    await expect(pm.dashboardPanelConfigs.sparklineType).toBeVisible();
    testLogger.info("Sparkline enabled — sub-controls visible");

    await pm.dashboardPanelActions.applyDashboardBtn();
    await pm.dashboardPanelActions.waitForChartToRender();

    await pm.dashboardPanelActions.savePanel();
    testLogger.info("Verifying sparkline toggle persists after save");
    await reopenPanelConfig(page, pm);
    await pm.dashboardPanelConfigs.expandAllConfigSections();
    expect(await pm.dashboardPanelConfigs.isSparklineEnabled()).toBe(true);

    await pm.dashboardPanelActions.savePanel();
    await cleanupTestDashboard(page, pm, dashboardName);
  });

  test("sparkline: type gates line-width/fill-opacity; Apply fires exactly 2 queries and renders the trend", {
    tag: ['@dashboard', '@configPanel', '@sparkline', '@P1', '@all'],
  }, async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();

    await setupMetricPanelWithConfig(page, pm, dashboardName);
    await pm.dashboardPanelConfigs.enableSparkline();

    const lineWidth = pm.dashboardPanelConfigs.sparklineLineWidthInput;
    const fillOpacity = pm.dashboardPanelConfigs.sparklineFillOpacity;

    // Default type is Auto (→ area): line width visible
    await expect(lineWidth).toBeVisible();

    // Bar: both line width and fill opacity hidden
    await pm.dashboardPanelConfigs.selectSparklineType("Bar");
    await expect(lineWidth).toBeHidden();
    await expect(fillOpacity).toBeHidden();
    testLogger.info("Bar type hides line width + fill opacity");

    // Area: both line width and fill opacity shown
    await pm.dashboardPanelConfigs.selectSparklineType("Area");
    await expect(lineWidth).toBeVisible();
    await expect(fillOpacity).toBeVisible();
    testLogger.info("Area type shows line width + fill opacity");

    // fetchSparklineHistogram (usePanelSQLExecutor.ts) is a fire-and-forget 2nd
    // fetch — the main query alone flips loading=false, so waitForChartToRender
    // (which polls the Apply button's disabled state) can resolve BEFORE the
    // histogram response arrives. Wait on the actual network event instead of
    // that UI proxy signal, or the count gets read too early.
    const allCalls = [];
    const searchCalls = [];
    const isDataQuery = (url) => /_search|query_range|prometheus\/api/.test(url);
    const onResponse = (res) => {
      const url = res.url();
      if (url.includes("/api/")) allCalls.push({ url, status: res.status() });
      if (isDataQuery(url)) searchCalls.push({ url, isHistogram: url.includes("is_ui_histogram") });
    };
    page.on("response", onResponse);

    // Wait for BOTH queries, not just the histogram. The two are independent
    // requests with no ordering guarantee, and waiting only on the histogram
    // unhooks the listener while the main metric query is still in flight —
    // the count is then read as 1 and the test fails intermittently.
    const isHistogram = (res) => isDataQuery(res.url()) && res.url().includes("is_ui_histogram");
    const mainQueryResponse = page
      .waitForResponse((res) => isDataQuery(res.url()) && !res.url().includes("is_ui_histogram"), { timeout: 20000 })
      .catch((e) => testLogger.warn("main query response wait:", e.message));
    const histogramResponse = page
      .waitForResponse(isHistogram, { timeout: 20000 })
      .catch((e) => testLogger.warn("histogram response wait:", e.message));

    await pm.dashboardPanelActions.applyDashboardBtn();
    await Promise.all([mainQueryResponse, histogramResponse]);
    // Let the panel finish settling so a spurious third query would still be caught
    // by the "exactly 2" assertion below rather than slipping in after the unhook.
    await pm.dashboardPanelActions.waitForChartToRender().catch(() => {});
    page.off("response", onResponse);

    testLogger.info("Network activity during Apply", { allCalls, searchCalls });
    expect(searchCalls.length, `captured /api/ calls: ${JSON.stringify(allCalls)}`).toBe(2);
    expect(searchCalls.some((c) => c.isHistogram)).toBe(true);
    testLogger.info("Apply fired exactly 2 data queries (metric value + sparkline histogram)");

    // Metric panels render as SVG; the sparkline trend draws at least one path.
    const chart = pm.dashboardPanelActions.getChartRendererCanvas();
    const errorMessage = pm.dashboardPanelConfigs.panelSchemaRendererError;
    await Promise.race([
      chart.waitFor({ state: "visible", timeout: 15000 }),
      errorMessage.waitFor({ state: "visible", timeout: 15000 }),
    ]).catch(() => {});
    const errText = await errorMessage.textContent().catch(() => null);
    expect(errText, "chart-renderer did not appear; panel error").toBeNull();
    await expect(chart).toBeVisible();
    await chart.locator("svg path").first().waitFor({ state: "attached", timeout: 10000 });
    expect(await chart.locator("svg path").count()).toBeGreaterThan(0);
    testLogger.info("Sparkline trend rendered on the metric SVG");

    await pm.dashboardPanelActions.savePanel();
    await cleanupTestDashboard(page, pm, dashboardName);
  });

  test("sparkline: pick series colour swatch + Background layout → apply → save → persists", {
    tag: ['@dashboard', '@configPanel', '@sparkline', '@P1', '@all'],
  }, async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();

    await setupMetricPanelWithConfig(page, pm, dashboardName);
    await pm.dashboardPanelConfigs.enableSparkline();

    // Pick the first series colour swatch — it becomes the active (pressed) swatch
    const swatch = await pm.dashboardPanelConfigs.pickSparklineColorSwatch(0);
    await expect(swatch).toHaveAttribute("aria-pressed", "true");

    // Switch layout to Background
    await pm.dashboardPanelConfigs.selectSparklineLayout("Background");
    await expect(pm.dashboardPanelConfigs.sparklineLayout).toContainText("Background");
    testLogger.info("Sparkline colour swatch + Background layout set");

    await pm.dashboardPanelActions.applyDashboardBtn();
    await pm.dashboardPanelActions.waitForChartToRender();
    await pm.dashboardPanelActions.savePanel();

    testLogger.info("Verifying sparkline layout persists after save");
    await reopenPanelConfig(page, pm);
    await pm.dashboardPanelConfigs.expandAllConfigSections();
    expect(await pm.dashboardPanelConfigs.isSparklineEnabled()).toBe(true);
    await expect(pm.dashboardPanelConfigs.sparklineLayout).toContainText("Background");

    await pm.dashboardPanelActions.savePanel();
    await cleanupTestDashboard(page, pm, dashboardName);
  });

  test("value mapping: add second row → delete it → one row remains → apply", {
    tag: ['@dashboard', '@configPanel', '@valueMapping', '@P1', '@all'],
  }, async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();

    await setupTablePanelWithConfig(page, pm, dashboardName);

    const popup = await pm.dashboardPanelConfigs.openValueMappingPopup();
    const rows = pm.dashboardPanelConfigs.valueMappingRows(popup);
    await rows.first().waitFor({ state: "visible", timeout: 10000 });

    // Dialog auto-adds one row on open
    await expect(rows).toHaveCount(1);
    await pm.dashboardPanelConfigs.fillValueMappingRow(popup, 0, { value: "ok", text: "OK" });

    // Add a second row, then delete it via the relocated per-row delete button
    await pm.dashboardPanelConfigs.addValueMappingRow(popup);
    await expect(rows).toHaveCount(2);
    await pm.dashboardPanelConfigs.deleteValueMappingRow(popup, 1);
    await expect(rows).toHaveCount(1);
    testLogger.info("Value mapping row added then removed");

    await pm.dashboardPanelConfigs.applyValueMappingPopup(popup);
    await expect(pm.dashboardPanelActions.dashboardTable).toBeVisible();
    testLogger.info("Value mapping applied — table renders");

    await pm.dashboardPanelActions.savePanel();
    await cleanupTestDashboard(page, pm, dashboardName);
  });

  test("value mapping: Between-range mapping reflects mapped text on the metric chart", {
    tag: ['@dashboard', '@configPanel', '@valueMapping', '@P1', '@all'],
  }, async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();

    // Value mapping is available for metric panels too — the mapped text replaces
    // the numeric value on the metric's SVG renderer.
    await setupMetricPanelWithConfig(page, pm, dashboardName);

    const popup = await pm.dashboardPanelConfigs.openValueMappingPopup();
    // "Between" range [0 .. huge] matches any positive metric value → deterministic text
    await pm.dashboardPanelConfigs.selectValueMappingType(popup, 0, "Between");
    await pm.dashboardPanelConfigs.fillValueMappingRange(popup, 0, {
      from: "0",
      to: "99999999999999",
      text: "MAPPED_OK",
    });
    await pm.dashboardPanelConfigs.applyValueMappingPopup(popup);
    testLogger.info("Between-range value mapping configured on metric panel");

    // networkidle is the wrong signal here — it resolves on *network* quiet, which
    // can land before ECharts has drawn the mapped text, and the panel's polling can
    // also keep it from ever going idle. The Apply button's own loading state is the
    // panel's actual "query finished" flag.
    await pm.dashboardPanelActions.applyDashboardBtn();
    await pm.dashboardPanelActions.waitForChartToRender();

    // The mapped text replaces the metric value on the SVG renderer
    const chart = pm.dashboardPanelActions.getChartRendererCanvas();
    await expect(chart).toBeVisible();
    await expect(chart).toContainText("MAPPED_OK");
    testLogger.info("Mapped text reflected in the metric chart");

    await pm.dashboardPanelActions.savePanel();
    await cleanupTestDashboard(page, pm, dashboardName);
  });
});
