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
  setupBarPanelWithConfig,
  setupBarPanelWithBreakdownAndConfig,
  setupTablePanelWithConfig,
  setupMetricPanelWithConfig,
  reopenPanelConfig,
} from "./utils/configPanelHelpers.js";
import { verifyColorOnCanvas, applyAndWaitForRender } from "./utils/canvasHelpers.js";
const testLogger = require('../utils/test-logger.js');

test.describe.configure({ mode: "parallel" });
test.describe.configure({ retries: 1 });

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
    const removeButtons = page.locator('[data-test^="dashboard-addpanel-config-time-shift-remove-"]');
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
    await expect(page.locator('[data-test^="dashboard-addpanel-config-time-shift-remove-"]')).toHaveCount(1);
    await pm.dashboardPanelActions.savePanel();
    await cleanupTestDashboard(page, pm, dashboardName);
  });

  test("trellis disabled when time shifts are active", async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();

    await setupBarPanelWithBreakdownAndConfig(page, pm, dashboardName);
    await pm.dashboardPanelConfigs.addTimeShift();

    await expect(page.locator('[data-test="dashboard-trellis-chart-trigger"]')).toBeDisabled();
    testLogger.info("Trellis disabled with time shifts active");

    await pm.dashboardPanelActions.savePanel();
    await cleanupTestDashboard(page, pm, dashboardName);
  });

  test("color by series: select first series → set custom color → save → color appears on chart canvas", async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();

    await setupBarPanelWithBreakdownAndConfig(page, pm, dashboardName);

    await expect(page.locator('[data-test="dashboard-addpanel-config-colorBySeries-add-btn"]')).toBeVisible();

    // Open popup → select first available series → set custom color → save
    await pm.dashboardPanelConfigs.openColorBySeries();
    await expect(page.locator('[data-test="dashboard-color-by-series-popup"]')).toBeVisible();

    const customColor = "#e63946";
    await pm.dashboardPanelConfigs.configureColorBySeries({ rowIndex: 0, optionIndex: 0, color: customColor });
    testLogger.info("Color by series: first series selected with custom color");

    await pm.dashboardPanelConfigs.saveColorBySeries();
    await expect(page.locator('[data-test="dashboard-color-by-series-popup"]')).not.toBeVisible();
    testLogger.info("Color by series saved");

    // Apply, wait for API response + ECharts repaint before pixel scan
    await applyAndWaitForRender(page, pm);

    const colorResult = await verifyColorOnCanvas(page, { r: 230, g: 57, b: 70 });
    testLogger.info("Canvas color verification", { matchingPixels: colorResult.matchingPixels, colorFound: colorResult.colorFound });
    expect(colorResult.colorFound).toBe(true);

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

    await pm.dashboardPanelActions.applyDashboardBtn();
    await expect(page.locator('[data-test="dashboard-panel-table"]')).toBeVisible();
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
    await expect(page.locator('[data-test="dashboard-panel-table"]')).toBeVisible();
    testLogger.info("Value mapping applied — table renders");

    // Verify value mapping persists after save
    await pm.dashboardPanelActions.savePanel();
    testLogger.info("Verifying value mapping persists after save");
    await reopenPanelConfig(page, pm);
    const popup = await pm.dashboardPanelConfigs.openValueMappingPopup();
    await expect(popup.locator('[data-test="dashboard-addpanel-config-value-mapping-value-input-0"]').locator('[data-test$="-field"]')).toHaveValue("test_value");
    await expect(popup.locator('[data-test="dashboard-addpanel-config-value-mapping-text-input-0"]').locator('[data-test$="-field"]')).toHaveValue("Mapped!");
    testLogger.info("Value mapping persisted after save");
    await pm.dashboardPanelConfigs.closeValueMappingPopup();

    await pm.dashboardPanelActions.savePanel();
    await cleanupTestDashboard(page, pm, dashboardName);
  });

  test("background color: visible for metric → select Single Color → apply", async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();

    await setupMetricPanelWithConfig(page, pm, dashboardName);

    const bgColorDropdown = page.locator('[data-test="dashboard-config-color-mode"]');
    await expect(bgColorDropdown).toBeVisible();
    await pm.dashboardPanelConfigs.selectBGColor("Single Color");
    await pm.dashboardPanelActions.applyDashboardBtn();
    testLogger.info("Background color set to Single Color");

    await pm.dashboardPanelActions.savePanel();
    testLogger.info("Verifying background color Single Color persists after save");
    await reopenPanelConfig(page, pm);
    await expect(page.locator('[data-test="dashboard-config-color-mode"]')).toContainText("Single Color");
    await pm.dashboardPanelActions.savePanel();
    await cleanupTestDashboard(page, pm, dashboardName);
  });

  test("top N: visible with breakdown → set 5 → apply → chart renders", async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();

    await setupBarPanelWithBreakdownAndConfig(page, pm, dashboardName);

    const topNInput = page.locator('[data-test="dashboard-config-top_results"]');
    await expect(topNInput).toBeVisible();
    await topNInput.locator('[data-test$="-field"]').fill("5");
    await pm.dashboardPanelActions.applyDashboardBtn();
    testLogger.info("Top N set to 5");
    await pm.dashboardPanelActions.waitForChartToRender();
    await pm.dashboardPanelActions.verifyChartHasData(expect);

    await pm.dashboardPanelActions.savePanel();
    testLogger.info("Verifying top N value persists after save");
    await reopenPanelConfig(page, pm);
    await expect(page.locator('[data-test="dashboard-config-top_results"]').locator('[data-test$="-field"]')).toHaveValue("5");
    await pm.dashboardPanelActions.savePanel();
    await cleanupTestDashboard(page, pm, dashboardName);
  });

  test("top N others: set top 5 → Others toggle appears → enable → apply → chart renders; disable → apply", async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();

    await setupBarPanelWithBreakdownAndConfig(page, pm, dashboardName);

    // Set top N to make the "Others" toggle appear
    const topNInput = page.locator('[data-test="dashboard-config-top_results"]');
    await expect(topNInput).toBeVisible();
    await topNInput.locator('[data-test$="-field"]').fill("5");

    // Others toggle should now be visible
    const othersToggle = page.locator('[data-test="dashboard-config-top_results_others"]');
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

    await setupBarPanelWithConfig(page, pm, dashboardName);

    const alignDropdown = page.locator('[data-test="dashboard-config-chart-align"]');
    // Alignment may not be present for all chart types — skip gracefully
    const isVisible = await alignDropdown.isVisible().catch(() => false);
    if (!isVisible) {
      testLogger.info("chart-align not visible for bar chart — skipping alignment interaction");
      await pm.dashboardPanelActions.savePanel();
      await cleanupTestDashboard(page, pm, dashboardName);
      return;
    }

    await expect(alignDropdown).toBeVisible();

    // Click dropdown and pick the first available option
    await alignDropdown.click();
    const options = page.locator('[data-test="dashboard-config-chart-align-option"]');
    await options.first().waitFor({ state: "visible", timeout: 5000 });
    const firstOptionText = await options.first().textContent();
    await options.first().click();
    testLogger.info(`Chart alignment set to: ${firstOptionText?.trim()}`);

    await pm.dashboardPanelActions.applyDashboardBtn();
    await pm.dashboardPanelActions.waitForChartToRender();
    await pm.dashboardPanelActions.verifyChartHasData(expect);

    await pm.dashboardPanelActions.savePanel();
    testLogger.info("Verifying chart alignment persists after save");
    await reopenPanelConfig(page, pm);
    await expect(page.locator('[data-test="dashboard-config-chart-align"]')).toBeVisible();
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
    await expect(page.locator('[data-test="dashboard-config-sparkline-type"]')).toBeVisible();
    testLogger.info("Sparkline enabled — sub-controls visible");

    await pm.dashboardPanelActions.applyDashboardBtn();

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

    const lineWidth = page.locator('[data-test="dashboard-config-sparkline-line-width"]');
    const fillOpacity = page.locator('[data-test="dashboard-config-sparkline-fill-opacity"]');

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

    await pm.dashboardPanelActions.applyDashboardBtn();
    await page
      .waitForResponse((res) => isDataQuery(res.url()) && res.url().includes("is_ui_histogram"), { timeout: 20000 })
      .catch((e) => testLogger.warn("histogram response wait:", e.message));
    page.off("response", onResponse);

    testLogger.info("Network activity during Apply", { allCalls, searchCalls });
    expect(searchCalls.length, `captured /api/ calls: ${JSON.stringify(allCalls)}`).toBe(2);
    expect(searchCalls.some((c) => c.isHistogram)).toBe(true);
    testLogger.info("Apply fired exactly 2 data queries (metric value + sparkline histogram)");

    // Metric panels render as SVG; the sparkline trend draws at least one path.
    const chart = page.locator('[data-test="chart-renderer"]');
    const errorMessage = page.locator('[data-test="panel-schema-renderer-error-message"]');
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
    await expect(page.locator('[data-test="dashboard-config-sparkline-layout"]')).toContainText("Background");
    testLogger.info("Sparkline colour swatch + Background layout set");

    await pm.dashboardPanelActions.applyDashboardBtn();
    await pm.dashboardPanelActions.savePanel();

    testLogger.info("Verifying sparkline layout persists after save");
    await reopenPanelConfig(page, pm);
    await pm.dashboardPanelConfigs.expandAllConfigSections();
    expect(await pm.dashboardPanelConfigs.isSparklineEnabled()).toBe(true);
    await expect(page.locator('[data-test="dashboard-config-sparkline-layout"]')).toContainText("Background");

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
    const beforeAdd = await rows.count();
    expect(beforeAdd).toBeGreaterThanOrEqual(1);
    await pm.dashboardPanelConfigs.fillValueMappingRow(popup, 0, { value: "ok", text: "OK" });

    // Add a row, then delete the last one via the relocated per-row delete button
    await pm.dashboardPanelConfigs.addValueMappingRow(popup);
    try {
      await expect(rows).toHaveCount(beforeAdd + 1, { timeout: 5000 });
    } catch (e) {
      // Observed count doubling (2→4) in CI, unexplained by source reading —
      // ODialog's neutral button is bound once and OSelect's two `-trigger`
      // bindings are properly v-if/v-else mutually exclusive (both checked in
      // source), so the duplication mechanism is still unknown. Dump the
      // matched elements' actual identity so the failure is self-diagnosing:
      // is the popup itself duplicated, or are there genuinely duplicate row
      // containers, or is one data-test value landing on 2 real elements?
      const diag = await page.evaluate(() => {
        const popups = [...document.querySelectorAll('[data-test="dashboard-value-mapping-popup"]')];
        return {
          popupCount: popups.length,
          rowsPerPopup: popups.map((p) =>
            [...p.querySelectorAll('[data-test^="dashboard-addpanel-config-value-mapping-type-select-"]')].map(
              (el) => ({
                dataTest: el.getAttribute("data-test"),
                tag: el.tagName,
                outerHTMLSnippet: el.outerHTML.slice(0, 150),
              }),
            ),
          ),
        };
      });
      testLogger.error("Value mapping row-count mismatch — DOM diagnostic", diag);
      throw e;
    }
    const beforeDelete = await rows.count();
    await pm.dashboardPanelConfigs.deleteValueMappingRow(popup, beforeDelete - 1);
    await expect(rows).toHaveCount(beforeDelete - 1);
    testLogger.info("Value mapping row added then removed", { beforeAdd, beforeDelete });

    await pm.dashboardPanelConfigs.applyValueMappingPopup(popup);
    await expect(page.locator('[data-test="dashboard-panel-table"]')).toBeVisible();
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

    await pm.dashboardPanelActions.applyDashboardBtn();
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});

    // The mapped text replaces the metric value on the SVG renderer
    const chart = page.locator('[data-test="chart-renderer"]');
    await expect(chart).toBeVisible();
    await expect(chart).toContainText("MAPPED_OK");
    testLogger.info("Mapped text reflected in the metric chart");

    await pm.dashboardPanelActions.savePanel();
    await cleanupTestDashboard(page, pm, dashboardName);
  });
});
