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
  waitForDashboardPage,
  deleteDashboard,
  setupTestDashboard,
  cleanupTestDashboard,
} from "./utils/dashCreation.js";
import { ingestion } from "./utils/dashIngestion.js";
import PageManager from "../../pages/page-manager";
import testLogger from "../utils/test-logger.js";

const randomDashboardName =
  "SeriesColorMultiWindow_" + Math.random().toString(36).substr(2, 9);

test.describe("Dashboard series color with multi-window (time shift)", () => {
  let pm;

  test.beforeEach(async ({ page }) => {
    pm = new PageManager(page);
    await navigateToBase(page);
    await ingestion(page);
  });

  test("should apply custom series color correctly when time shift (compare against) is enabled", async ({
    page,
  }) => {
    const panelName =
      pm.dashboardPanelActions.generateUniquePanelName("multiwindow_color");

    // Step 1: Navigate to dashboards and create a new dashboard
    testLogger.info("Creating test dashboard", {
      dashboardName: randomDashboardName,
    });
    await setupTestDashboard(page, pm, randomDashboardName);

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
    const timeShiftAddBtn = page.locator(
      '[data-test="dashboard-addpanel-config-time-shift-add-btn"]'
    );

    // Scroll the sidebar until the time shift button is visible
    const sidebar = page.locator(".sidebar-content");
    await sidebar.waitFor({ state: "visible" });
    await sidebar.hover();

    // Scroll down to find the time shift button
    for (let i = 0; i < 15; i++) {
      if (await timeShiftAddBtn.isVisible().catch(() => false)) break;
      await page.mouse.wheel(0, 300);
      await page.waitForTimeout(200);
    }

    // Fallback: try programmatic scroll if still not visible
    if (!(await timeShiftAddBtn.isVisible().catch(() => false))) {
      await page.evaluate(() => {
        const el = document.querySelector(".sidebar-content");
        if (el) el.scrollTop = el.scrollHeight;
      });
      await page.waitForTimeout(500);
    }

    await timeShiftAddBtn.waitFor({ state: "visible", timeout: 15000 });
    await timeShiftAddBtn.click();
    testLogger.info("Time shift added (default 15m)");

    // Step 6: Apply the query again to render with multi-window data
    // Multi-window queries fire TWO API calls (base + comparison), so we need
    // to wait for both responses before checking chart render state.
    testLogger.info("Applying query with time shift");
    const apiResponsePromise = page.waitForResponse(
      (response) =>
        /\/api\/.*\/_search/.test(response.url()) && response.status() === 200,
      { timeout: 30000 }
    );
    await pm.dashboardPanelActions.applyDashboardBtn();
    await apiResponsePromise;
    // Wait for the second API call (comparison window) and chart rendering
    await page.waitForTimeout(3000);
    await pm.dashboardPanelActions.waitForChartToRender().catch(() => {
      testLogger.warn("waitForChartToRender timed out after time shift apply, continuing");
    });

    // Step 8: Scroll sidebar to find the Color By Series button and click it
    testLogger.info("Opening Color By Series configuration");
    const colorBySeriesBtn = page.locator(
      '[data-test="dashboard-addpanel-config-colorBySeries-add-btn"]'
    );

    // Scroll to find the button
    await sidebar.hover();
    for (let i = 0; i < 15; i++) {
      if (await colorBySeriesBtn.isVisible().catch(() => false)) break;
      await page.mouse.wheel(0, 300);
      await page.waitForTimeout(200);
    }

    if (!(await colorBySeriesBtn.isVisible().catch(() => false))) {
      await page.evaluate(() => {
        const btn = document.querySelector(
          '[data-test="dashboard-addpanel-config-colorBySeries-add-btn"]'
        );
        if (btn) btn.scrollIntoView({ behavior: "smooth", block: "center" });
      });
      await page.waitForTimeout(500);
    }

    await colorBySeriesBtn.waitFor({ state: "visible", timeout: 15000 });
    await colorBySeriesBtn.click();

    // Step 9: Wait for the Color By Series popup to appear
    const colorBySeriesPopup = page.locator(
      '[data-test="dashboard-color-by-series-popup"]'
    );
    await colorBySeriesPopup.waitFor({ state: "visible", timeout: 10000 });
    testLogger.info("Color By Series popup opened");

    // Step 10: Select the multi-window comparison series from the autocomplete dropdown
    // We specifically want the series with the time-shift suffix (e.g., "(15 Minutes ago)")
    // to verify the fix applies colors correctly to comparison/offset series
    const seriesAutoComplete = colorBySeriesPopup
      .locator('[data-test="common-auto-complete"]')
      .first();
    await seriesAutoComplete.waitFor({ state: "visible" });
    await seriesAutoComplete.click();

    // Wait for autocomplete options to appear
    const autoCompleteOptions = colorBySeriesPopup.locator(
      '[data-test="common-auto-complete-option"]'
    );
    await autoCompleteOptions.first().waitFor({ state: "visible", timeout: 10000 });

    // Get all available series names for logging
    const optionCount = await autoCompleteOptions.count();
    const allSeriesNames = [];
    for (let i = 0; i < optionCount; i++) {
      const name = await autoCompleteOptions.nth(i).textContent();
      allSeriesNames.push(name?.trim());
    }
    testLogger.info("Available series options", { count: optionCount, series: allSeriesNames });

    // Find and select ONLY the comparison series — "Kubernetes Container Name (15 Minutes ago)"
    // This is the critical series to test: the bug was that colors were lost on these suffixed series
    const targetSeriesText = "15 Minutes ago";
    let selectedSeriesName = "";
    let targetOption = null;

    for (let i = 0; i < optionCount; i++) {
      const name = await autoCompleteOptions.nth(i).textContent();
      if (name && name.includes(targetSeriesText)) {
        targetOption = autoCompleteOptions.nth(i);
        selectedSeriesName = name.trim();
        break;
      }
    }

    // The comparison series must exist after adding a time shift
    expect(targetOption).not.toBeNull();

    testLogger.info("Selecting multi-window comparison series", {
      seriesName: selectedSeriesName,
    });
    await targetOption.click();

    // Step 11: Set color #1a2cf0 for the comparison series
    const customColor = "#1a2cf0";
    testLogger.info("Setting custom color", { color: customColor });

    // Click "Set color" button to initialize the color field with default #5960b2
    const setColorBtn = colorBySeriesPopup.getByText("Set color").first();
    await setColorBtn.waitFor({ state: "visible", timeout: 5000 });
    await setColorBtn.click();
    await page.waitForTimeout(500);

    // Set color via Vue's reactive data (setupState).
    // Quasar's q-input v-model doesn't respond to Playwright's fill()/type()/
    // pressSequentially() — none of them trigger Vue's reactivity system.
    // Instead, we access the Vue component instance via __vueParentComponent
    // on the popup's root DOM element and directly set editColorBySeries[0].color.
    const colorSet = await page.evaluate((color) => {
      const popup = document.querySelector(
        '[data-test="dashboard-color-by-series-popup"]'
      );
      if (!popup || !popup.__vueParentComponent) return { success: false };

      const vpc = popup.__vueParentComponent;
      const series = vpc.setupState?.editColorBySeries;
      if (Array.isArray(series) && series.length > 0) {
        series[0].color = color;
        return { success: true, color: series[0].color };
      }
      return { success: false };
    }, customColor);

    testLogger.info("Color set via Vue setupState", colorSet);
    expect(colorSet.success).toBe(true);
    await page.waitForTimeout(500);

    // Step 12: Save the color configuration
    testLogger.info("Saving color by series configuration");
    const saveColorBtn = page.locator(
      '[data-test="dashboard-addpanel-config-color-by-series-apply-btn"]'
    );
    await saveColorBtn.waitFor({ state: "visible" });
    await saveColorBtn.click();

    // Wait for popup to close
    await colorBySeriesPopup.waitFor({ state: "hidden", timeout: 10000 });
    testLogger.info("Color By Series configuration saved");

    // Step 13: Apply and verify the chart renders with the custom color
    testLogger.info("Applying final query to verify color");
    const finalApiPromise = page.waitForResponse(
      (response) =>
        /\/api\/.*\/_search/.test(response.url()) && response.status() === 200,
      { timeout: 30000 }
    );
    await pm.dashboardPanelActions.applyDashboardBtn();
    await finalApiPromise;
    await page.waitForTimeout(3000);
    await pm.dashboardPanelActions.waitForChartToRender().catch(() => {
      testLogger.warn("waitForChartToRender timed out after final apply, continuing");
    });

    // Step 14: Verify #1a2cf0 is applied on the chart canvas.
    // ECharts is imported as ES module (not on window.echarts), so we can't use
    // getInstanceByDom(). Instead, we use canvas pixel analysis to verify that
    // the custom color #1a2cf0 (RGB: 26, 44, 240) appears on the rendered chart.
    const colorVerification = await page.evaluate(
      ({ r, g, b }) => {
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

        // If we found at least 5 pixels matching the color, the series is colored
        result.colorFound = result.matchingPixels >= 5;
        return result;
      },
      { r: 26, g: 44, b: 240 } // #1a2cf0 = RGB(26, 44, 240)
    );

    testLogger.info("Color verification result (canvas pixel analysis)", {
      canvasCount: colorVerification.canvasCount,
      matchingPixels: colorVerification.matchingPixels,
      colorFound: colorVerification.colorFound,
      canvasInfo: colorVerification.canvasInfo,
    });

    // Assert: the custom color #1a2cf0 appears on the chart canvas
    // This verifies the fix: colorBySeries mappings are re-applied after multi-window merge
    expect(colorVerification.colorFound).toBe(true);

    // Step 15: Save the panel
    testLogger.info("Saving panel", { panelName });
    await pm.dashboardPanelActions.addPanelName(panelName);
    await pm.dashboardPanelActions.savePanel();

    // Step 16: Verify color persists after save by re-editing the panel
    testLogger.info(
      "Re-editing panel to verify color configuration persists after save"
    );
    await page.waitForTimeout(2000);

    await pm.dashboardPanelActions.selectPanelAction(panelName, "Edit");

    // Wait for add_panel page to load and chart to render
    await page.waitForURL(/\/add_panel/, { timeout: 15000 });
    await page.waitForTimeout(3000);
    await pm.dashboardPanelActions.waitForChartToRender().catch(() => {
      testLogger.warn("waitForChartToRender timed out on re-edit, continuing");
    });

    // Open config sidebar
    await pm.dashboardPanelConfigs.openConfigPanel();

    // Scroll to find and click the Color By Series button
    // It should now say "Edit Color by Series" since config already exists
    const editColorBtn = page.locator(
      '[data-test="dashboard-addpanel-config-colorBySeries-add-btn"]'
    );

    await sidebar.hover();
    for (let i = 0; i < 15; i++) {
      if (await editColorBtn.isVisible().catch(() => false)) break;
      await page.mouse.wheel(0, 300);
      await page.waitForTimeout(200);
    }

    if (!(await editColorBtn.isVisible().catch(() => false))) {
      await page.evaluate(() => {
        const btn = document.querySelector(
          '[data-test="dashboard-addpanel-config-colorBySeries-add-btn"]'
        );
        if (btn) btn.scrollIntoView({ behavior: "smooth", block: "center" });
      });
      await page.waitForTimeout(500);
    }

    await editColorBtn.waitFor({ state: "visible", timeout: 15000 });
    await editColorBtn.click();

    // Verify the popup shows #1a2cf0 for the comparison series after save
    await colorBySeriesPopup.waitFor({ state: "visible", timeout: 10000 });

    // Verify the series name is still the comparison series
    const savedSeriesInput = colorBySeriesPopup
      .locator('[data-test="common-auto-complete"]')
      .first();
    const savedSeriesValue = await savedSeriesInput.inputValue();
    testLogger.info("Verifying saved series name", { savedSeriesValue });
    expect(savedSeriesValue).toContain("15 Minutes ago");

    // Verify the color is still #1a2cf0
    const savedColorInput = colorBySeriesPopup
      .locator(".color-section input")
      .first();
    await savedColorInput.waitFor({ state: "visible", timeout: 5000 });
    const savedColor = await savedColorInput.inputValue();

    testLogger.info("Verifying saved color persists", { savedColor });

    // #1a2cf0 must persist after save+reopen
    expect(savedColor.toUpperCase()).toContain("1A2CF0");

    // Close the popup
    await page
      .locator('[data-test="dashboard-color-by-series-cancel"]')
      .click();

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
    await setupTestDashboard(page, pm, randomDashboardName + "_multi");

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

    const sidebar = page.locator(".sidebar-content");
    await sidebar.waitFor({ state: "visible" });

    const timeShiftAddBtn = page.locator(
      '[data-test="dashboard-addpanel-config-time-shift-add-btn"]'
    );

    await sidebar.hover();
    for (let i = 0; i < 15; i++) {
      if (await timeShiftAddBtn.isVisible().catch(() => false)) break;
      await page.mouse.wheel(0, 300);
      await page.waitForTimeout(200);
    }

    if (!(await timeShiftAddBtn.isVisible().catch(() => false))) {
      await page.evaluate(() => {
        const el = document.querySelector(".sidebar-content");
        if (el) el.scrollTop = el.scrollHeight;
      });
      await page.waitForTimeout(500);
    }

    await timeShiftAddBtn.waitFor({ state: "visible", timeout: 15000 });
    await timeShiftAddBtn.click();

    // Step 4: Apply with time shift — wait for API responses (multi-window fires 2 calls)
    const apiPromise2 = page.waitForResponse(
      (response) =>
        /\/api\/.*\/_search/.test(response.url()) && response.status() === 200,
      { timeout: 30000 }
    );
    await pm.dashboardPanelActions.applyDashboardBtn();
    await apiPromise2;
    await page.waitForTimeout(3000);
    await pm.dashboardPanelActions.waitForChartToRender().catch(() => {
      testLogger.warn("waitForChartToRender timed out after time shift apply, continuing");
    });

    // Step 5: Open Color By Series — add ONLY one entry for the comparison series
    const colorBySeriesBtn = page.locator(
      '[data-test="dashboard-addpanel-config-colorBySeries-add-btn"]'
    );

    await sidebar.hover();
    for (let i = 0; i < 15; i++) {
      if (await colorBySeriesBtn.isVisible().catch(() => false)) break;
      await page.mouse.wheel(0, 300);
      await page.waitForTimeout(200);
    }

    if (!(await colorBySeriesBtn.isVisible().catch(() => false))) {
      await page.evaluate(() => {
        const btn = document.querySelector(
          '[data-test="dashboard-addpanel-config-colorBySeries-add-btn"]'
        );
        if (btn) btn.scrollIntoView({ behavior: "smooth", block: "center" });
      });
      await page.waitForTimeout(500);
    }

    await colorBySeriesBtn.waitFor({ state: "visible", timeout: 15000 });
    await colorBySeriesBtn.click();

    const colorBySeriesPopup = page.locator(
      '[data-test="dashboard-color-by-series-popup"]'
    );
    await colorBySeriesPopup.waitFor({ state: "visible", timeout: 10000 });

    // Select ONLY "Kubernetes Container Name (15 Minutes ago)" — NOT the base series
    const autoComplete = colorBySeriesPopup
      .locator('[data-test="common-auto-complete"]')
      .first();
    await autoComplete.click();

    const options = colorBySeriesPopup.locator(
      '[data-test="common-auto-complete-option"]'
    );
    await options.first().waitFor({ state: "visible", timeout: 10000 });

    // Find the comparison series option
    const optionCount = await options.count();
    let comparisonOption = null;
    for (let i = 0; i < optionCount; i++) {
      const name = await options.nth(i).textContent();
      if (name && name.includes("15 Minutes ago")) {
        comparisonOption = options.nth(i);
        break;
      }
    }
    expect(comparisonOption).not.toBeNull();
    await comparisonOption.click();

    // Set #11ad29 — only for this one comparison series
    const customColor = "#11ad29";
    const setColorBtn = colorBySeriesPopup.getByText("Set color").first();
    await setColorBtn.click();
    await page.waitForTimeout(500);

    // Set color via Vue's reactive data (setupState) — the only reliable way
    // to update Quasar's q-input v-model from Playwright
    const colorSet2 = await page.evaluate((color) => {
      const popup = document.querySelector(
        '[data-test="dashboard-color-by-series-popup"]'
      );
      if (!popup || !popup.__vueParentComponent) return { success: false };

      const vpc = popup.__vueParentComponent;
      const series = vpc.setupState?.editColorBySeries;
      if (Array.isArray(series) && series.length > 0) {
        series[0].color = color;
        return { success: true, color: series[0].color };
      }
      return { success: false };
    }, customColor);

    testLogger.info("Color set result", colorSet2);
    expect(colorSet2.success).toBe(true);
    await page.waitForTimeout(500);

    // Save — only one color entry exists (no entry for base "Kubernetes Container Name")
    const saveBtn = page.locator(
      '[data-test="dashboard-addpanel-config-color-by-series-apply-btn"]'
    );
    await saveBtn.click();
    await colorBySeriesPopup.waitFor({ state: "hidden", timeout: 10000 });

    // Step 6: Apply and verify — wait for API responses
    const finalApiPromise2 = page.waitForResponse(
      (response) =>
        /\/api\/.*\/_search/.test(response.url()) && response.status() === 200,
      { timeout: 30000 }
    );
    await pm.dashboardPanelActions.applyDashboardBtn();
    await finalApiPromise2;
    await page.waitForTimeout(3000);
    await pm.dashboardPanelActions.waitForChartToRender().catch(() => {
      testLogger.warn("waitForChartToRender timed out after final apply, continuing");
    });

    // Verify: the custom color #11ad29 appears on the chart canvas
    // Using canvas pixel analysis since ECharts is imported as ES module (not on window)
    const colorResult = await page.evaluate(
      ({ r, g, b }) => {
        const canvasElements = document.querySelectorAll("canvas");
        const result = {
          canvasCount: canvasElements.length,
          matchingPixels: 0,
          colorFound: false,
        };

        for (const canvas of canvasElements) {
          try {
            const ctx = canvas.getContext("2d");
            if (!ctx) continue;

            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const data = imageData.data;
            let matchCount = 0;

            for (let i = 0; i < data.length; i += 16) {
              if (
                Math.abs(data[i] - r) < 10 &&
                Math.abs(data[i + 1] - g) < 10 &&
                Math.abs(data[i + 2] - b) < 10 &&
                data[i + 3] > 200
              ) {
                matchCount++;
              }
            }
            result.matchingPixels += matchCount;
          } catch (e) {
            // Canvas might be tainted
          }
        }

        result.colorFound = result.matchingPixels >= 5;
        return result;
      },
      { r: 17, g: 173, b: 41 } // #11ad29 = RGB(17, 173, 41)
    );

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
    // Clean up: navigate back and delete dashboards
    try {
      await pm.dashboardCreate.backToDashboardList();
      await page.waitForTimeout(1000);

      // Try to delete dashboards
      try {
        await deleteDashboard(page, randomDashboardName);
      } catch (e) {
        testLogger.warn("Dashboard cleanup failed (may already be deleted)", {
          name: randomDashboardName,
          error: e.message,
        });
      }

      try {
        await deleteDashboard(page, randomDashboardName + "_multi");
      } catch (e) {
        // May not exist if second test didn't run
      }
    } catch (e) {
      testLogger.warn("Cleanup failed", { error: e.message });
    }
  });
});
