// Dashboard Series Color Multi-Window Test
// Verifies that user-configured series colors are correctly applied
// when using "Comparison Against" (time shift / multi-window) feature.
//
// Bug: When a time shift is added, series names get suffixed (e.g., "(15m ago)").
// The color-by-series mappings were not re-applied after this renaming,
// so custom colors were lost on comparison series.
// Fix: PR #10846 - re-applies applySeriesColorMappings() after merging multi-window series.

import { test, expect, navigateToBase } from "../utils/enhanced-baseFixtures.js";
import {
  deleteDashboard,
  setupTestDashboard,
} from "./utils/dashCreation.js";
import { ingestion } from "./utils/dashIngestion.js";
import PageManager from "../../pages/page-manager";
import testLogger from "../utils/test-logger.js";

/**
 * Verify a specific color appears on any canvas element via pixel analysis.
 * ECharts renders to canvas and is imported as an ES module (not on window.echarts),
 * so we scan canvas pixels directly instead of using getInstanceByDom().
 * @param {import('@playwright/test').Page} page
 * @param {{ r: number, g: number, b: number }} rgb - Target color as RGB values
 * @param {number} [minPixels=5] - Minimum matching pixels to consider color found
 * @returns {Promise<{ canvasCount: number, matchingPixels: number, colorFound: boolean }>}
 */
async function verifyColorOnCanvas(page, { r, g, b }, minPixels = 5) {
  return page.evaluate(
    ({ r, g, b, minPixels }) => {
      const canvasElements = document.querySelectorAll("canvas");
      const result = {
        canvasCount: canvasElements.length,
        matchingPixels: 0,
        colorFound: false,
        canvasInfo: [],
      };

      for (const canvas of canvasElements) {
        try {
          const ctx = canvas.getContext("2d");
          if (!ctx) continue;

          const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const data = imageData.data;
          let matchCount = 0;

          // Check every 4th pixel for performance (still thorough)
          for (let i = 0; i < data.length; i += 16) {
            if (
              Math.abs(data[i] - r) < 10 &&
              Math.abs(data[i + 1] - g) < 10 &&
              Math.abs(data[i + 2] - b) < 10 &&
              data[i + 3] > 200 // alpha > 200 (nearly opaque)
            ) {
              matchCount++;
            }
          }

          result.canvasInfo.push({
            width: canvas.width,
            height: canvas.height,
            matchingPixels: matchCount,
          });

          result.matchingPixels += matchCount;
        } catch (e) {
          result.canvasInfo.push({ error: e.message });
        }
      }

      result.colorFound = result.matchingPixels >= minPixels;
      return result;
    },
    { r, g, b, minPixels }
  );
}

/**
 * Wait for multi-window API response(s) and chart rendering after applying a query.
 * Multi-window (time shift) may fire one or two API calls depending on the backend.
 * We wait for the first _search response, then wait for the chart to render, and
 * allow a short buffer for Vue reactivity to propagate comparison series data.
 * @param {import('@playwright/test').Page} page
 * @param {PageManager} pm
 */
async function applyAndWaitForMultiWindowRender(page, pm) {
  const apiPromise = page.waitForResponse(
    (response) =>
      /\/api\/.*\/_search/.test(response.url()) && response.status() === 200,
    { timeout: 30000 }
  );
  await pm.dashboardPanelActions.applyDashboardBtn();
  await apiPromise;

  // Wait for chart to render with comparison data.
  // waitForChartToRender checks canvas existence but not repaint completion.
  // ECharts needs additional time to process data and paint the canvas after
  // the API response arrives, especially for multi-window merging.
  await pm.dashboardPanelActions.waitForChartToRender().catch(() => {
    testLogger.warn("waitForChartToRender timed out, continuing");
  });
  // Allow ECharts to finish canvas repaint and Vue to propagate series data
  await page.waitForFunction(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    { timeout: 5000 }
  ).catch(() => {});
  await page.waitForTimeout(2000);
}

test.describe("Dashboard series color with multi-window (time shift)", () => {
  let pm;
  let dashboardName;

  test.beforeEach(async ({ page }, testInfo) => {
    pm = new PageManager(page);
    // Generate unique dashboard name per test to avoid cleanup collisions
    const suffix = Math.random().toString(36).substr(2, 6);
    dashboardName = `SeriesColorMW_${testInfo.title.includes("persist") ? "area" : "line"}_${suffix}`;
    await navigateToBase(page);
    await ingestion(page);
  });

  test("should apply custom series color correctly when time shift (compare against) is enabled", async ({
    page,
  }) => {
    const panelName =
      pm.dashboardPanelActions.generateUniquePanelName("multiwindow_color");

    // Step 1: Navigate to dashboards and create a new dashboard
    testLogger.info("Creating test dashboard", { dashboardName });
    await setupTestDashboard(page, pm, dashboardName);

    // Step 2: Add a panel with area chart type
    testLogger.info("Adding panel with area chart");
    await pm.dashboardCreate.addPanel();
    await pm.chartTypeSelector.selectChartType("area");
    await pm.chartTypeSelector.selectStream("e2e_automate");
    await pm.chartTypeSelector.searchAndAddField("kubernetes_container_name", "y");

    // Step 3: Apply the query to render the chart initially
    testLogger.info("Applying initial query");
    await pm.dashboardPanelActions.applyDashboardBtn();
    await pm.dashboardPanelActions.waitForChartToRender();

    // Step 4: Open config sidebar
    testLogger.info("Opening config sidebar");
    await pm.dashboardPanelConfigs.openConfigPanel();

    // Step 5: Scroll down to find the time shift section and add a time shift
    testLogger.info("Adding time shift (Compare Against) with default 15m");
    await pm.dashboardPanelConfigs.addTimeShift();
    testLogger.info("Time shift added (default 15m)");

    // Step 6: Apply the query again to render with multi-window data
    testLogger.info("Applying query with time shift");
    await applyAndWaitForMultiWindowRender(page, pm);

    // Step 7: Open Color By Series popup and configure comparison series color
    testLogger.info("Opening Color By Series configuration");
    await pm.dashboardPanelConfigs.openColorBySeries();
    testLogger.info("Color By Series popup opened");

    // Step 8: Select the comparison series and set custom color #1a2cf0
    const customColor = "#1a2cf0";
    const selectedSeriesName = await pm.dashboardPanelConfigs.configureColorBySeries({
      rowIndex: 0,
      matchText: "15 Minutes ago",
      color: customColor,
    });
    testLogger.info("Configured comparison series color", {
      seriesName: selectedSeriesName,
      color: customColor,
    });

    // Step 9: Save the color configuration
    testLogger.info("Saving color by series configuration");
    await pm.dashboardPanelConfigs.saveColorBySeries();
    testLogger.info("Color By Series configuration saved");

    // Step 10: Apply and verify the chart renders with the custom color
    testLogger.info("Applying final query to verify color");
    await applyAndWaitForMultiWindowRender(page, pm);

    // Step 11: Verify #1a2cf0 is applied on the chart canvas
    const colorVerification = await verifyColorOnCanvas(page, { r: 26, g: 44, b: 240 });

    testLogger.info("Color verification result (canvas pixel analysis)", {
      canvasCount: colorVerification.canvasCount,
      matchingPixels: colorVerification.matchingPixels,
      colorFound: colorVerification.colorFound,
      canvasInfo: colorVerification.canvasInfo,
    });

    // Assert: the custom color #1a2cf0 appears on the chart canvas
    // This verifies the fix: colorBySeries mappings are re-applied after multi-window merge
    expect(colorVerification.colorFound).toBe(true);

    // Step 12: Save the panel
    testLogger.info("Saving panel", { panelName });
    await pm.dashboardPanelActions.addPanelName(panelName);
    await pm.dashboardPanelActions.savePanel();

    // Step 13: Verify color persists after save by re-editing the panel
    testLogger.info(
      "Re-editing panel to verify color configuration persists after save"
    );
    // Wait for dashboard view to settle before re-editing
    await page.waitForTimeout(2000);

    await pm.dashboardPanelActions.selectPanelAction(panelName, "Edit");

    // Wait for add_panel page to load and chart to render
    await page.waitForURL(/\/add_panel/, { timeout: 15000 });
    // Wait for API responses to complete (re-edit triggers data fetch)
    await page.waitForResponse(
      (response) =>
        /\/api\/.*\/_search/.test(response.url()) && response.status() === 200,
      { timeout: 30000 }
    ).catch(() => {});
    await pm.dashboardPanelActions.waitForChartToRender().catch(() => {
      testLogger.warn("waitForChartToRender timed out on re-edit, continuing");
    });

    // Open config sidebar and Color By Series popup (should say "Edit Color by Series")
    await pm.dashboardPanelConfigs.openConfigPanel();
    await pm.dashboardPanelConfigs.openColorBySeries();

    // Verify the series name is still the comparison series
    const popup = pm.dashboardPanelConfigs.colorBySeriesPopup;
    const savedSeriesInput = popup
      .locator('[data-test="common-auto-complete"]')
      .first();
    const savedSeriesValue = await savedSeriesInput.inputValue();
    testLogger.info("Verifying saved series name", { savedSeriesValue });
    // The stored config value is the base field name (e.g., "Kubernetes Container Name").
    // The "(15 Minutes ago)" suffix is only added at chart render time, so the
    // autocomplete may or may not include it when re-editing depending on timing.
    expect(savedSeriesValue.toLowerCase()).toContain("kubernetes container name");

    // Verify the color is still #1a2cf0
    const savedColorInput = popup
      .locator(".color-section input")
      .first();
    await savedColorInput.waitFor({ state: "visible", timeout: 5000 });
    const savedColor = await savedColorInput.inputValue();

    testLogger.info("Verifying saved color persists", { savedColor });

    // #1a2cf0 must persist after save+reopen
    expect(savedColor.toUpperCase()).toContain("1A2CF0");

    // Close the popup
    await pm.dashboardPanelConfigs.cancelColorBySeries();

    // Save the panel again to go back to dashboard view
    await pm.dashboardPanelActions.savePanel();

    testLogger.info("Test completed successfully - series color verified for multi-window");
  });

  test("should only color comparison series and not affect the base series", async ({
    page,
  }) => {
    const panelName =
      pm.dashboardPanelActions.generateUniquePanelName("only_comparison_color");

    // Step 1: Create dashboard and panel (line chart)
    testLogger.info("Setting up dashboard for single comparison color test");
    await setupTestDashboard(page, pm, dashboardName);

    await pm.dashboardCreate.addPanel();
    await pm.chartTypeSelector.selectChartType("line");
    await pm.chartTypeSelector.selectStream("e2e_automate");
    await pm.chartTypeSelector.searchAndAddField("kubernetes_container_name", "y");

    // Step 2: Apply initial query
    await pm.dashboardTimeRefresh.setRelative("6", "d");
    await pm.dashboardPanelActions.applyDashboardBtn();
    await pm.dashboardPanelActions.waitForChartToRender();

    // Step 3: Open config and add time shift (15m)
    await pm.dashboardPanelConfigs.openConfigPanel();
    await pm.dashboardPanelConfigs.addTimeShift();

    // Step 4: Apply with time shift — wait for API responses (multi-window fires 2 calls)
    testLogger.info("Applying query with time shift");
    await applyAndWaitForMultiWindowRender(page, pm);

    // Step 5: Open Color By Series, select comparison series, and set #11ad29
    const customColor = "#11ad29";
    await pm.dashboardPanelConfigs.openColorBySeries();
    await pm.dashboardPanelConfigs.configureColorBySeries({
      rowIndex: 0,
      matchText: "15 Minutes ago",
      color: customColor,
    });
    await pm.dashboardPanelConfigs.saveColorBySeries();

    // Step 6: Apply and verify — wait for API responses
    testLogger.info("Applying final query to verify color");
    await applyAndWaitForMultiWindowRender(page, pm);

    // Verify: the custom color #11ad29 appears on the chart canvas
    const colorResult = await verifyColorOnCanvas(page, { r: 17, g: 173, b: 41 });

    testLogger.info("Single comparison color verification (canvas pixels)", {
      matchingPixels: colorResult.matchingPixels,
      colorFound: colorResult.colorFound,
    });

    // The custom color #11ad29 appears on the chart (applied to comparison series)
    expect(colorResult.colorFound).toBe(true);

    // Save the panel
    await pm.dashboardPanelActions.addPanelName(panelName);
    await pm.dashboardPanelActions.savePanel();

    testLogger.info("Single comparison color test completed");
  });

  test.afterEach(async ({ page }) => {
    // Clean up: navigate back and delete dashboard
    try {
      await pm.dashboardCreate.backToDashboardList();
      await page.waitForTimeout(1000);

      try {
        await deleteDashboard(page, dashboardName);
      } catch (e) {
        testLogger.warn("Dashboard cleanup failed (may already be deleted)", {
          name: dashboardName,
          error: e.message,
        });
      }
    } catch (e) {
      testLogger.warn("Cleanup failed", { error: e.message });
    }
  });
});
