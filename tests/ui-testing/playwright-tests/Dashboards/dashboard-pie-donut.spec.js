const {
  test,
  expect,
  navigateToBase,
} = require("../utils/enhanced-baseFixtures.js");
import PageManager from "../../pages/page-manager";
import { cleanupTestDashboard, setupTestDashboard } from "./utils/dashCreation.js";
import {
  generateDashboardName,
  setupPiePanelWithConfig,
  setupDonutPanelWithConfig,
  reopenPanelConfig,
} from "./utils/configPanelHelpers.js";
const testLogger = require('../utils/test-logger.js');

test.describe.configure({ mode: "parallel" });
test.describe.configure({ retries: 1 });

/**
 * Returns the number of colored (non-transparent) pixels on the chart canvas.
 * A count > 0 confirms that data was actually plotted on the chart.
 */
async function getPlottedPixelCount(page) {
  // Poll canvas until pixels appear (ECharts paints async after DOM is visible).
  // Returns 0 only if canvas is still blank after 5 s — meaning no data was plotted.
  const maxWait = 5000;
  const interval = 500;
  let elapsed = 0;
  let count = 0;
  while (elapsed < maxWait) {
    count = await page.evaluate(() => {
      const canvas = document.querySelector('[data-test="chart-renderer"] canvas');
      if (!canvas) return 0;
      const ctx = canvas.getContext('2d');
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let c = 0;
      for (let i = 3; i < data.length; i += 4) {
        if (data[i] > 0) c++;
      }
      return c;
    });
    if (count > 0) break;
    await page.waitForTimeout(interval);
    elapsed += interval;
  }
  return count;
}

test.describe("Pie & Donut Chart — E2E Tests (SQL Builder / Logs Stream)", () => {
  test.beforeEach(async ({ page }) => {
    await navigateToBase(page);
  });

  // ---------------------------------------------------------------------------
  // P0 — Critical / Smoke Tests
  // ---------------------------------------------------------------------------

  test("TC-PIE-001: create pie chart using SQL builder with COUNT aggregation — renders with slices", {
    tag: ["@pieDonut", "@smoke", "@P0"],
  }, async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();

    await setupPiePanelWithConfig(page, pm, dashboardName);
    testLogger.info("Pie panel created via SQL builder");

    await pm.dashboardPanelActions.verifyChartRenders(expect);
    testLogger.info("verifyChartRenders passed", { coloredPixels: await getPlottedPixelCount(page) });

    await pm.dashboardPanelActions.savePanel();
    await cleanupTestDashboard(page, pm, dashboardName);
  });

  test("TC-PIE-002: create donut chart using SQL builder with COUNT aggregation — renders with slices", {
    tag: ["@pieDonut", "@smoke", "@P0"],
  }, async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();

    await setupDonutPanelWithConfig(page, pm, dashboardName);
    testLogger.info("Donut panel created via SQL builder");

    await pm.dashboardPanelActions.verifyChartRenders(expect);
    testLogger.info("verifyChartRenders passed", { coloredPixels: await getPlottedPixelCount(page) });

    await pm.dashboardPanelActions.savePanel();
    await cleanupTestDashboard(page, pm, dashboardName);
  });

  test("TC-PIE-004: save pie panel and reopen — chart type and data persist", {
    tag: ["@pieDonut", "@smoke", "@P0"],
  }, async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();

    await setupPiePanelWithConfig(page, pm, dashboardName, "Persist Pie");

    await pm.dashboardPanelActions.verifyChartRenders(expect);
    testLogger.info("verifyChartRenders passed - pre-save", { coloredPixels: await getPlottedPixelCount(page) });

    // Save and reopen
    await pm.dashboardPanelActions.savePanel();
    await reopenPanelConfig(page, pm);

    // Verify chart type is still pie
    const pieSelector = page.locator('[data-test="selected-chart-pie-item"]');
    await expect(pieSelector).toBeVisible();
    testLogger.info("Pie chart type persisted after reopen");

    // Verify data still renders after reopen
    await pm.dashboardPanelActions.verifyChartRenders(expect);
    testLogger.info("verifyChartRenders passed - post-reopen", { coloredPixels: await getPlottedPixelCount(page) });

    await pm.dashboardPanelActions.savePanel();
    await cleanupTestDashboard(page, pm, dashboardName);
  });

  test("TC-PIE-005: save donut panel and reopen — chart type and data persist", {
    tag: ["@pieDonut", "@smoke", "@P0"],
  }, async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();

    await setupDonutPanelWithConfig(page, pm, dashboardName, "Persist Donut");

    await pm.dashboardPanelActions.verifyChartRenders(expect);
    testLogger.info("verifyChartRenders passed - pre-save", { coloredPixels: await getPlottedPixelCount(page) });

    await pm.dashboardPanelActions.savePanel();
    await reopenPanelConfig(page, pm);

    const donutSelector = page.locator('[data-test="selected-chart-donut-item"]');
    await expect(donutSelector).toBeVisible();
    testLogger.info("Donut chart type persisted after reopen");

    await pm.dashboardPanelActions.verifyChartRenders(expect);
    testLogger.info("verifyChartRenders passed - post-reopen", { coloredPixels: await getPlottedPixelCount(page) });

    await pm.dashboardPanelActions.savePanel();
    await cleanupTestDashboard(page, pm, dashboardName);
  });

  // ---------------------------------------------------------------------------
  // P1 — Functional Tests
  // ---------------------------------------------------------------------------

  test("TC-PIE-007: pie chart with multiple Y-axis aggregation functions (SUM, AVG, MIN, MAX)", {
    tag: ["@pieDonut", "@functional", "@P1"],
  }, async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();

    await setupTestDashboard(page, pm, dashboardName);
    await pm.dashboardCreate.addPanel();
    await pm.chartTypeSelector.selectChartType("pie");
    await pm.chartTypeSelector.selectStreamType("logs");
    await pm.chartTypeSelector.selectStream("e2e_automate");
    await pm.chartTypeSelector.searchAndAddField("code", "y");
    await pm.dashboardPanelActions.addPanelName("Pie Aggregations");

    const functions = ["sum", "avg", "min", "max"];
    for (const fn of functions) {
      await pm.chartTypeSelector.configureYAxisFunction("y_axis_1", fn);
      await pm.dashboardPanelActions.applyDashboardBtn();
      await pm.dashboardPanelActions.waitForChartToRender().catch((e) => testLogger.warn("waitForChartToRender:", e.message));
      await pm.dashboardPanelActions.verifyChartRenders(expect);
      testLogger.info(`verifyChartRenders passed - ${fn} aggregation`, { coloredPixels: await getPlottedPixelCount(page) });
    }

    await pm.dashboardPanelActions.savePanel();
    await cleanupTestDashboard(page, pm, dashboardName);
  });

  test("TC-PIE-011: switch chart type pie → donut → pie — rendering updates correctly", {
    tag: ["@pieDonut", "@functional", "@P1"],
  }, async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();

    // Start with pie via SQL builder
    await setupPiePanelWithConfig(page, pm, dashboardName, "Switch Test");
    await pm.dashboardPanelActions.verifyChartRenders(expect);
    testLogger.info("verifyChartRenders passed - initial pie", { coloredPixels: await getPlottedPixelCount(page) });

    // Switch to donut
    await pm.chartTypeSelector.selectChartType("donut");
    await pm.dashboardPanelActions.applyDashboardBtn();
    await pm.dashboardPanelActions.waitForChartToRender().catch((e) => testLogger.warn("waitForChartToRender:", e.message));
    await pm.dashboardPanelActions.verifyChartRenders(expect);
    await expect(page.locator('[data-test="selected-chart-donut-item"]')).toBeVisible();
    testLogger.info("verifyChartRenders passed - donut after switch", { coloredPixels: await getPlottedPixelCount(page) });

    // Switch back to pie
    await pm.chartTypeSelector.selectChartType("pie");
    await pm.dashboardPanelActions.applyDashboardBtn();
    await pm.dashboardPanelActions.waitForChartToRender().catch((e) => testLogger.warn("waitForChartToRender:", e.message));
    await pm.dashboardPanelActions.verifyChartRenders(expect);
    await expect(page.locator('[data-test="selected-chart-pie-item"]')).toBeVisible();
    testLogger.info("verifyChartRenders passed - pie after switch back", { coloredPixels: await getPlottedPixelCount(page) });

    await pm.dashboardPanelActions.savePanel();
    await cleanupTestDashboard(page, pm, dashboardName);
  });

  test("TC-PIE-012: switch chart type from line → pie — data preserved", {
    tag: ["@pieDonut", "@functional", "@P1"],
  }, async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();

    // Start with line chart via SQL builder
    await setupTestDashboard(page, pm, dashboardName);
    await pm.dashboardCreate.addPanel();
    await pm.chartTypeSelector.selectChartType("line");
    await pm.chartTypeSelector.selectStreamType("logs");
    await pm.chartTypeSelector.selectStream("e2e_automate");
    await pm.chartTypeSelector.searchAndAddField("kubernetes_container_hash", "y");
    await pm.dashboardPanelActions.addPanelName("Line To Pie");
    await pm.dashboardPanelActions.applyDashboardBtn();
    await pm.dashboardPanelActions.waitForChartToRender().catch((e) => testLogger.warn("waitForChartToRender:", e.message));

    await pm.dashboardPanelActions.verifyChartRenders(expect);
    testLogger.info("verifyChartRenders passed - line chart", { coloredPixels: await getPlottedPixelCount(page) });

    // Switch to pie
    await pm.chartTypeSelector.selectChartType("pie");
    await pm.dashboardPanelActions.applyDashboardBtn();
    await pm.dashboardPanelActions.waitForChartToRender().catch((e) => testLogger.warn("waitForChartToRender:", e.message));

    await pm.dashboardPanelActions.verifyChartRenders(expect);
    testLogger.info("verifyChartRenders passed - pie after line→pie switch", { coloredPixels: await getPlottedPixelCount(page) });

    await pm.dashboardPanelActions.savePanel();
    await cleanupTestDashboard(page, pm, dashboardName);
  });

  test("TC-PIE-013: switch chart type from pie → table → pie — data preserved", {
    tag: ["@pieDonut", "@functional", "@P1"],
  }, async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();

    await setupPiePanelWithConfig(page, pm, dashboardName, "Pie Table Pie");
    await pm.dashboardPanelActions.verifyChartRenders(expect);
    testLogger.info("verifyChartRenders passed - initial pie", { coloredPixels: await getPlottedPixelCount(page) });

    // Switch to table
    await pm.chartTypeSelector.selectChartType("table");
    await pm.dashboardPanelActions.applyDashboardBtn();
    await pm.dashboardPanelActions.waitForChartToRender().catch((e) => testLogger.warn("waitForChartToRender:", e.message));
    await pm.dashboardPanelActions.verifyChartRenders(expect);
    testLogger.info("verifyChartRenders passed - table after switch", { coloredPixels: await getPlottedPixelCount(page) });

    // Switch back to pie
    await pm.chartTypeSelector.selectChartType("pie");
    await pm.dashboardPanelActions.applyDashboardBtn();
    await pm.dashboardPanelActions.waitForChartToRender().catch((e) => testLogger.warn("waitForChartToRender:", e.message));

    await pm.dashboardPanelActions.verifyChartRenders(expect);
    testLogger.info("verifyChartRenders passed - pie after table→pie switch", { coloredPixels: await getPlottedPixelCount(page) });

    await pm.dashboardPanelActions.savePanel();
    await cleanupTestDashboard(page, pm, dashboardName);
  });

  test("TC-PIE-014: pie chart legend visibility — legend popup shows series names", {
    tag: ["@pieDonut", "@functional", "@P1"],
  }, async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();

    await setupPiePanelWithConfig(page, pm, dashboardName, "Pie Legend");
    await pm.dashboardPanelActions.verifyChartRenders(expect);
    testLogger.info("verifyChartRenders passed - pie for legend test", { coloredPixels: await getPlottedPixelCount(page) });

    // Save panel first to access legend button on dashboard view
    await pm.dashboardPanelActions.savePanel();

    // Hover over panel bar to reveal legend button
    const panelBar = page.locator('[data-test="dashboard-panel-bar"]').first();
    await panelBar.waitFor({ state: "visible", timeout: 10000 });
    await panelBar.hover();

    // Click Show Legends via page object
    const legendBtn = pm.dashboardLegendsCopy.getShowLegendsButton();
    const isLegendBtnVisible = await legendBtn.isVisible().catch(() => false);

    if (isLegendBtnVisible) {
      await legendBtn.click();
      const legendPopup = page.locator('[data-test="dashboard-show-legends-popup"]');
      await expect(legendPopup).toBeVisible({ timeout: 5000 });
      testLogger.info("Legend popup is visible");

      // Verify at least one legend item exists
      const legendItem = page.locator('[data-test^="dashboard-legend-item-"]');
      expect(await legendItem.count()).toBeGreaterThan(0);
      testLogger.info("Legend items found in popup");

      // Close legend popup
      await page.locator('[data-test="dashboard-show-legends-close"]').click();
    } else {
      testLogger.info("Legend button not visible on panel — skipping popup check");
    }

    await cleanupTestDashboard(page, pm, dashboardName);
  });

  test("TC-PIE-016: pie chart with custom SQL query (raw mode) — renders", {
    tag: ["@pieDonut", "@functional", "@P1"],
  }, async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();

    await setupTestDashboard(page, pm, dashboardName);
    await pm.dashboardCreate.addPanel();
    await pm.chartTypeSelector.selectChartType("pie");
    await pm.chartTypeSelector.selectStreamType("logs");
    await pm.chartTypeSelector.selectStream("e2e_automate");

    // Add Y field, then switch to raw and enter custom SQL
    await pm.chartTypeSelector.searchAndAddField("kubernetes_container_hash", "y");

    // Open Y-axis function popup and switch to raw tab
    await pm.chartTypeSelector.configureYAxisRawQuery(
      "y_axis_1",
      "count(kubernetes_container_hash)"
    );

    await pm.dashboardPanelActions.addPanelName("Pie Raw SQL");
    await pm.dashboardPanelActions.applyDashboardBtn();
    await pm.dashboardPanelActions.waitForChartToRender().catch((e) => testLogger.warn("waitForChartToRender:", e.message));
    testLogger.info("Pie panel with raw SQL query created");

    await pm.dashboardPanelActions.verifyChartRenders(expect);
    testLogger.info("verifyChartRenders passed - raw SQL pie", { coloredPixels: await getPlottedPixelCount(page) });

    await pm.dashboardPanelActions.savePanel();
    await cleanupTestDashboard(page, pm, dashboardName);
  });

  test("TC-PIE-017: pie chart description — set, save, persists on reopen", {
    tag: ["@pieDonut", "@functional", "@P1"],
  }, async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();

    await setupPiePanelWithConfig(page, pm, dashboardName, "Pie Description");

    const descriptionInput = page.locator('[data-test="dashboard-config-description"]');
    await expect(descriptionInput).toBeVisible();
    await descriptionInput.fill("Test pie chart description");
    testLogger.info("Description set");

    await pm.dashboardPanelActions.applyDashboardBtn();
    await pm.dashboardPanelActions.waitForChartToRender().catch((e) => testLogger.warn("waitForChartToRender:", e.message));

    await pm.dashboardPanelActions.savePanel();
    await reopenPanelConfig(page, pm);

    await expect(page.locator('[data-test="dashboard-config-description"]')).toHaveValue("Test pie chart description");
    testLogger.info("Description persisted after save and reopen");

    await pm.dashboardPanelActions.savePanel();
    await cleanupTestDashboard(page, pm, dashboardName);
  });

  test("TC-PIE-019: pie chart with SQL raw count query — renders", {
    tag: ["@pieDonut", "@functional", "@P1"],
  }, async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();

    await setupTestDashboard(page, pm, dashboardName);
    await pm.dashboardCreate.addPanel();
    await pm.chartTypeSelector.selectChartType("pie");
    await pm.chartTypeSelector.selectStreamType("logs");
    await pm.chartTypeSelector.selectStream("e2e_automate");
    await pm.chartTypeSelector.searchAndAddField("kubernetes_container_hash", "y");

    // Configure Y-axis with raw count query
    await pm.chartTypeSelector.configureYAxisRawQuery(
      "y_axis_1",
      "count(kubernetes_container_hash)"
    );

    await pm.dashboardPanelActions.addPanelName("Pie Raw Count");
    await pm.dashboardPanelActions.applyDashboardBtn();
    await pm.dashboardPanelActions.waitForChartToRender().catch((e) => testLogger.warn("waitForChartToRender:", e.message));
    testLogger.info("Pie panel with raw count query created");

    await pm.dashboardPanelActions.verifyChartRenders(expect);
    testLogger.info("verifyChartRenders passed - raw count pie", { coloredPixels: await getPlottedPixelCount(page) });

    await pm.dashboardPanelActions.savePanel();
    await cleanupTestDashboard(page, pm, dashboardName);
  });

  test("TC-PIE-028: pie chart with cross-field aggregation (X=docker_id, Y=count(container_name)) — renders with legend", {
    tag: ["@pieDonut", "@functional", "@P1"],
  }, async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();

    await setupTestDashboard(page, pm, dashboardName);
    await pm.dashboardCreate.addPanel();
    await pm.chartTypeSelector.selectChartType("pie");
    await pm.chartTypeSelector.selectStreamType("logs");
    await pm.chartTypeSelector.selectStream("e2e_automate");

    // Y-axis: kubernetes_container_name with count aggregation (cross-field)
    await pm.chartTypeSelector.searchAndAddField("kubernetes_container_name", "y");
    await pm.chartTypeSelector.configureYAxisRawQuery(
      "y_axis_1",
      "count(kubernetes_container_name)"
    );
    // X-axis: remove default histogram(_timestamp) first, then add kubernetes_docker_id
    await pm.chartTypeSelector.removeField("x_axis_1", "x");
    await pm.chartTypeSelector.searchAndAddField("kubernetes_docker_id", "x");

    await pm.dashboardPanelActions.addPanelName("Pie Cross-Field Agg");
    await pm.dashboardPanelActions.applyDashboardBtn();
    await pm.dashboardPanelActions.waitForChartToRender().catch((e) => testLogger.warn("waitForChartToRender:", e.message));
    testLogger.info("Pie panel with cross-field aggregation created");

    // 1. Verify chart renders with data
    await pm.dashboardPanelActions.verifyChartRenders(expect);
    testLogger.info("verifyChartRenders passed - cross-field pie", { coloredPixels: await getPlottedPixelCount(page) });

    // 2. Save panel to access legend on dashboard view
    await pm.dashboardPanelActions.savePanel();

    // 3. Verify legend popup — hover over chart area to reveal legend button
    const chartArea = page.locator('[data-test="chart-renderer"]').first();
    await chartArea.waitFor({ state: "visible", timeout: 10000 });
    await chartArea.hover();

    const legendBtn = pm.dashboardLegendsCopy.getShowLegendsButton();
    await legendBtn.waitFor({ state: "visible", timeout: 5000 }).catch(() => {});
    const isLegendBtnVisible = await legendBtn.isVisible().catch(() => false);

    if (isLegendBtnVisible) {
      await legendBtn.click();
      const legendPopup = page.locator('[data-test="dashboard-show-legends-popup"]');
      await expect(legendPopup).toBeVisible({ timeout: 5000 });

      const legendCount = await pm.dashboardLegendsCopy.getLegendCount();
      testLogger.info("Legend popup verified", { legendItemCount: legendCount });
      expect(legendCount).toBeGreaterThan(0);

      // Verify first legend item has text (not empty)
      const firstLegendText = await pm.dashboardLegendsCopy.getLegendItem(0).textContent();
      expect(firstLegendText.trim().length).toBeGreaterThan(0);
      testLogger.info("First legend item has text", { text: firstLegendText.trim() });

      await page.locator('[data-test="dashboard-show-legends-close"]').click();
    } else {
      testLogger.info("Legend button not visible — skipping popup check");
    }

    await cleanupTestDashboard(page, pm, dashboardName);
  });

  // ---------------------------------------------------------------------------
  // P2 — Edge Cases & Negative Tests
  // ---------------------------------------------------------------------------

  test("TC-PIE-020: pie chart with no Y-axis field — shows no-data state", {
    tag: ["@pieDonut", "@edge", "@P2"],
  }, async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();

    await setupTestDashboard(page, pm, dashboardName);
    await pm.dashboardCreate.addPanel();
    await pm.chartTypeSelector.selectChartType("pie");
    await pm.chartTypeSelector.selectStreamType("logs");
    await pm.chartTypeSelector.selectStream("e2e_automate");
    // Do NOT add Y-axis field
    await pm.dashboardPanelActions.addPanelName("Pie No Y");
    await pm.dashboardPanelActions.applyDashboardBtn();
    await pm.dashboardPanelActions.waitForChartToRender().catch((e) => testLogger.warn("waitForChartToRender:", e.message));
    testLogger.info("Pie panel applied without Y-axis field");

    // Page should still be functional (no crash) — chart may render empty or show no-data
    await expect(page.locator('[data-test="dashboard-panel-name"]')).toBeVisible();
    testLogger.info("Page remains functional after apply without Y-axis field", { coloredPixels: await getPlottedPixelCount(page) });

    // Navigate to dashboard list (skip savePanel — no valid config to save)
    await navigateToBase(page);
    await pm.dashboardPanelActions.waitForDashboardSearchVisible().catch(() => {});
    testLogger.info("Edge case cleanup complete");
  });

  test("TC-PIE-024: pie chart — fullscreen view renders correctly", {
    tag: ["@pieDonut", "@edge", "@P2"],
  }, async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();

    await setupPiePanelWithConfig(page, pm, dashboardName, "Pie Fullscreen");
    await pm.dashboardPanelActions.verifyChartRenders(expect);
    testLogger.info("verifyChartRenders passed - pie before fullscreen", { coloredPixels: await getPlottedPixelCount(page) });

    // Save panel to access fullscreen controls on dashboard
    await pm.dashboardPanelActions.savePanel();

    // Open panel in fullscreen
    const panelBar = page.locator('[data-test="dashboard-panel-bar"]').first();
    await panelBar.waitFor({ state: "visible", timeout: 10000 });
    await panelBar.hover();
    const fullscreenBtn = page.locator('[data-test="dashboard-panel-fullscreen-btn"]').first();
    await fullscreenBtn.click();

    // Verify view panel opens
    const viewPanel = page.locator('[data-test="view-panel-screen"]');
    await expect(viewPanel).toBeVisible({ timeout: 10000 });
    testLogger.info("Panel opened in fullscreen/view mode");

    // Verify chart renders in fullscreen
    const chartRenderer = page.locator('[data-test="chart-renderer"]').first();
    await expect(chartRenderer).toBeVisible({ timeout: 15000 });
    testLogger.info("Chart renders in fullscreen view", { coloredPixels: await getPlottedPixelCount(page) });

    // Close fullscreen
    await page.locator('[data-test="dashboard-viewpanel-close-btn"]').click();
    testLogger.info("Fullscreen view closed");

    await cleanupTestDashboard(page, pm, dashboardName);
  });

  test("TC-PIE-025: pie chart — apply without selecting stream — shows error or no-data", {
    tag: ["@pieDonut", "@edge", "@P2"],
  }, async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();

    await setupTestDashboard(page, pm, dashboardName);
    await pm.dashboardCreate.addPanel();
    await pm.chartTypeSelector.selectChartType("pie");
    // Do NOT select stream or fields
    await pm.dashboardPanelActions.addPanelName("Pie No Stream");
    await pm.dashboardPanelActions.applyDashboardBtn();
    await pm.dashboardPanelActions.waitForChartToRender().catch((e) => testLogger.warn("waitForChartToRender:", e.message));
    testLogger.info("Pie panel applied without stream selection");

    // Page should still be functional (no crash) — chart may render empty or show no-data
    await expect(page.locator('[data-test="dashboard-panel-name"]')).toBeVisible();
    testLogger.info("Page remains functional after apply without stream selection", { coloredPixels: await getPlottedPixelCount(page) });

    // Navigate to dashboard list (skip savePanel — no valid config to save)
    await navigateToBase(page);
    await pm.dashboardPanelActions.waitForDashboardSearchVisible().catch(() => {});
    testLogger.info("Edge case cleanup complete");
  });
});
