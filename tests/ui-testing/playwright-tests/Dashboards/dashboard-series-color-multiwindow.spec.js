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
import { verifyColorOnCanvas, applyAndWaitForRender } from "./utils/canvasHelpers.js";
import logsdata from "../../../test-data/logs_data.json";
const { getAuthHeaders, getOrgIdentifier } = require("../utils/cloud-auth.js");

// The comparison series label the 15m time shift produces. convertSQLData builds
// it as `${seriesName} (${periodAsStr})`, and dateTimeUtils renders a 15-minute
// offset as "15 Minutes ago".
const COMPARISON_SERIES_LABEL = "15 Minutes ago";

// Both tests query a 6-day window rather than the default panel range. The time
// shift only produces a comparison series when the *shifted* window also returns
// rows, and on the shared alpha deployment ingestion is skipped (SKIP_INGESTION),
// so e2e_automate holds older data and a short default window comes back empty.
// With no comparison series the color-by-series dropdown offers only the base
// series — which is exactly how this spec used to pass without ever exercising
// the multi-window fix it names.
const QUERY_RANGE = { value: "6", unit: "d" };

// Minutes into the past to stamp the seed batch. Must exceed the 15m shift.
const SEED_MINUTES_AGO = 30;

/**
 * Seed rows that are older than the time shift, so the comparison window is
 * populated regardless of how much history the target deployment happens to have.
 *
 * Verified locally: on a stream holding only just-ingested rows the dropdown
 * offers just ["Kubernetes Container Name"] — the exact CI failure — and with
 * this seed it also offers "Kubernetes Container Name (15 Minutes ago)".
 *
 * `_timestamp` is microseconds since epoch (same convention the Alerts specs use).
 * CI sets ZO_INGEST_ALLOWED_UPTO=5 (hours), so 30 minutes is well inside the
 * accepted back-dating window.
 */
async function seedAgedRows(streamName = "e2e_automate") {
  const baseMicros = (Date.now() - SEED_MINUTES_AGO * 60 * 1000) * 1000;
  // Reuse real records so every field the panel queries keeps its usual shape.
  const rows = logsdata.slice(0, 200).map((record, i) => ({
    ...record,
    _timestamp: baseMicros + i * 300000,
  }));

  const response = await fetch(
    `${process.env.INGESTION_URL}/api/${getOrgIdentifier()}/${streamName}/_json`,
    { method: "POST", headers: getAuthHeaders(), body: JSON.stringify(rows) }
  );
  if (!response.ok) {
    throw new Error(
      `seedAgedRows failed: HTTP ${response.status} ${(await response.text()).slice(0, 200)}`
    );
  }
  testLogger.info("Seeded aged rows for the comparison window", {
    streamName,
    minutesAgo: SEED_MINUTES_AGO,
  });
}

/**
 * Open the Color By Series popup and confirm the chart is actually offering the
 * time-shift comparison series. ECharts can finish its paint before Vue has
 * propagated the merged multi-window series into the config panel's options, so
 * re-apply and retry rather than reading a half-populated dropdown.
 *
 * @param {import('@playwright/test').Page} page
 * @param {PageManager} pm
 * @param {string} matchText - Label fragment the comparison series must contain
 * @returns {Promise<string[]>} The option labels offered for row 0
 */
async function openColorBySeriesWithComparison(page, pm, matchText) {
  const maxAttempts = 3;
  let labels = [];

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    await pm.dashboardPanelConfigs.openColorBySeries();
    labels = await pm.dashboardPanelConfigs.getColorBySeriesOptionLabels(0);

    if (labels.some((label) => label.includes(matchText))) {
      testLogger.info("Comparison series available in Color By Series", {
        attempt,
        labels,
      });
      return labels;
    }

    testLogger.warn("Comparison series not offered yet, re-applying", {
      attempt,
      labels,
    });
    await pm.dashboardPanelConfigs.cancelColorBySeries();
    if (attempt < maxAttempts) {
      await applyAndWaitForRender(page, pm);
    }
  }

  throw new Error(
    `Time shift comparison series "${matchText}" never appeared in the ` +
      `color-by-series options after ${maxAttempts} attempts. ` +
      `Last options: ${JSON.stringify(labels)}`
  );
}

test.describe("Dashboard series color with multi-window (time shift)", () => {
  let pm;
  let dashboardName;

  test.beforeEach(async ({ page }) => {
    pm = new PageManager(page);
    // Generate unique dashboard name per test to avoid cleanup collisions
    const suffix = Math.random().toString(36).slice(2, 8);
    dashboardName = `SeriesColorMW_${suffix}`;
    await navigateToBase(page);
    await ingestion(page);
    // The 15m comparison window only returns rows older than 15 minutes.
    await seedAgedRows();
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
    await pm.chartTypeSelector.removeField("y_axis_1", "y");
    await pm.chartTypeSelector.searchAndAddField("kubernetes_container_name", "y");

    // Step 3: Apply the query to render the chart initially
    testLogger.info("Applying initial query");
    await pm.dashboardTimeRefresh.setRelative(QUERY_RANGE.value, QUERY_RANGE.unit);
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
    await applyAndWaitForRender(page, pm);

    // Step 7: Open Color By Series popup, asserting the comparison series exists
    testLogger.info("Opening Color By Series configuration");
    await openColorBySeriesWithComparison(page, pm, COMPARISON_SERIES_LABEL);

    // Step 8: Select the comparison series and set custom color #1a2cf0
    const customColor = "#1a2cf0";
    const selectedSeriesName = await pm.dashboardPanelConfigs.configureColorBySeries({
      rowIndex: 0,
      matchText: COMPARISON_SERIES_LABEL,
      color: customColor,
    });
    testLogger.info("Configured comparison series color", {
      seriesName: selectedSeriesName,
      color: customColor,
    });

    // The color must land on the *comparison* series — that is the series the
    // multi-window rename used to strand without its mapping.
    expect(selectedSeriesName).toContain(COMPARISON_SERIES_LABEL);

    // Step 9: Save the color configuration
    testLogger.info("Saving color by series configuration");
    await pm.dashboardPanelConfigs.saveColorBySeries();
    testLogger.info("Color By Series configuration saved");

    // Step 10: Apply and verify the chart renders with the custom color
    testLogger.info("Applying final query to verify color");
    await applyAndWaitForRender(page, pm);

    // Step 11: Verify #1a2cf0 is applied on the chart canvas
    const colorVerification = await verifyColorOnCanvas(page, { r: 26, g: 44, b: 240 });

    testLogger.info("Color verification result (canvas pixel analysis)", {
      canvasCount: colorVerification.canvasCount,
      matchingPixels: colorVerification.matchingPixels,
      colorFound: colorVerification.colorFound,
    });

    // Assert: the custom color #1a2cf0 appears on the chart canvas
    // This verifies the fix: colorBySeries mappings are re-applied after multi-window merge
    expect(
      colorVerification.colorFound,
      `Expected ${customColor} on the chart canvas for series "${selectedSeriesName}", ` +
        `but only ${colorVerification.matchingPixels} pixels matched across ` +
        `${colorVerification.canvasCount} canvases`
    ).toBe(true);

    // Step 12: Save the panel
    testLogger.info("Saving panel", { panelName });
    await pm.dashboardPanelActions.addPanelName(panelName);
    await pm.dashboardPanelActions.savePanel();

    // Step 13: Verify color persists after save by re-editing the panel
    testLogger.info(
      "Re-editing panel to verify color configuration persists after save"
    );
    await page
      .waitForSelector('[data-test="dashboard-panel-container"]', { timeout: 15000 })
      .catch(() => {
        testLogger.warn("Panel container not visible after save, continuing");
      });

    // Register the search wait *before* triggering the edit — re-opening the panel
    // fires its data fetch immediately, and a listener attached afterwards misses
    // the response and burns its full timeout for nothing.
    const reEditSearch = page.waitForResponse(
      (response) =>
        /\/api\/.*\/_search/.test(response.url()) && response.status() === 200,
      { timeout: 30000 }
    );
    await pm.dashboardPanelActions.selectPanelAction(panelName, "Edit");

    await page.waitForURL(/\/(add|edit)_panel/, { timeout: 15000 });
    await reEditSearch.catch(() => {
      testLogger.warn("No search response observed on re-edit, continuing");
    });
    await pm.dashboardPanelActions.waitForChartToRender().catch(() => {
      testLogger.warn("waitForChartToRender timed out on re-edit, continuing");
    });

    // Open config sidebar and Color By Series popup (should say "Edit Color by Series")
    await pm.dashboardPanelConfigs.openConfigPanel();
    await pm.dashboardPanelConfigs.openColorBySeries();

    // Verify the series name is still the comparison series
    const savedSeriesValue = await pm.dashboardPanelConfigs.getColorBySeriesRowValue(0);
    testLogger.info("Verifying saved series name", { savedSeriesValue });
    // Original assertion, kept as-is: the stored value carries the base field name.
    expect(savedSeriesValue.toLowerCase()).toContain("kubernetes container name");
    // Additionally, it must be the comparison series — the saved value is
    // "Kubernetes Container Name (15 Minutes ago)", so this narrows the check
    // without weakening the one above.
    expect(savedSeriesValue).toContain(COMPARISON_SERIES_LABEL);

    // Verify the color is still #1a2cf0 — read from the OColor text input in row 0
    const savedColor = await pm.dashboardPanelConfigs.getColorBySeriesRowColor(0);
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
    await pm.chartTypeSelector.removeField("y_axis_1", "y");
    await pm.chartTypeSelector.searchAndAddField("kubernetes_container_name", "y");

    // Step 2: Apply initial query
    await pm.dashboardTimeRefresh.setRelative(QUERY_RANGE.value, QUERY_RANGE.unit);
    await pm.dashboardPanelActions.applyDashboardBtn();
    await pm.dashboardPanelActions.waitForChartToRender();

    // Step 3: Open config and add time shift (15m)
    await pm.dashboardPanelConfigs.openConfigPanel();
    await pm.dashboardPanelConfigs.addTimeShift();

    // Step 4: Apply with time shift
    testLogger.info("Applying query with time shift");
    await applyAndWaitForRender(page, pm);

    // Step 5: Open Color By Series, select comparison series, and set #11ad29
    const customColor = "#11ad29";
    const labels = await openColorBySeriesWithComparison(
      page,
      pm,
      COMPARISON_SERIES_LABEL
    );

    // The base series must still be on offer alongside the comparison one — the
    // rename adds a series, it does not replace the original.
    expect(
      labels.some((label) => !label.includes(COMPARISON_SERIES_LABEL))
    ).toBe(true);

    const selectedSeriesName = await pm.dashboardPanelConfigs.configureColorBySeries({
      rowIndex: 0,
      matchText: COMPARISON_SERIES_LABEL,
      color: customColor,
    });
    expect(selectedSeriesName).toContain(COMPARISON_SERIES_LABEL);
    await pm.dashboardPanelConfigs.saveColorBySeries();

    // Step 6: Apply and verify
    testLogger.info("Applying final query to verify color");
    await applyAndWaitForRender(page, pm);

    // Verify: the custom color #11ad29 appears on the chart canvas
    const colorResult = await verifyColorOnCanvas(page, { r: 17, g: 173, b: 41 });

    testLogger.info("Single comparison color verification (canvas pixels)", {
      matchingPixels: colorResult.matchingPixels,
      colorFound: colorResult.colorFound,
    });

    // The custom color #11ad29 appears on the chart (applied to comparison series)
    expect(
      colorResult.colorFound,
      `Expected ${customColor} on the chart canvas for series "${selectedSeriesName}", ` +
        `but only ${colorResult.matchingPixels} pixels matched`
    ).toBe(true);

    // Save the panel
    await pm.dashboardPanelActions.addPanelName(panelName);
    await pm.dashboardPanelActions.savePanel();

    testLogger.info("Single comparison color test completed");
  });

  test.afterEach(async ({ page }) => {
    // Clean up: navigate back and delete dashboard
    try {
      await pm.dashboardCreate.backToDashboardList();
      await page.waitForURL(/\/dashboards/, { timeout: 10000 }).catch(() => {});

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
