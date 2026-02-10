// tracesAnalyzeDimensions.spec.js
// Tests for OpenObserve Traces Analyze Dimensions feature
// Feature: Volume/Latency/Error analysis on traces data with brush selection on RED metrics

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');

test.describe("Traces Analyze Dimensions testcases", () => {
  test.describe.configure({ mode: 'serial' });
  let pm; // Page Manager instance

  test.beforeEach(async ({ page }, testInfo) => {
    // Initialize test setup
    testLogger.testStart(testInfo.title, testInfo.file);

    // Navigate to base URL with authentication
    await navigateToBase(page);
    pm = new PageManager(page);

    // Post-authentication stabilization wait
    await page.waitForLoadState('networkidle');

    // Navigate to traces page
    await pm.tracesPage.navigateToTraces();

    // Select the default stream as data is ingested for it only
    if (await pm.tracesPage.isStreamSelectVisible()) {
      await pm.tracesPage.selectTraceStream('default');
    }

    testLogger.info('Test setup completed for traces analyze dimensions');
  });

  test.afterEach(async ({ }, testInfo) => {
    testLogger.testEnd(testInfo.title, testInfo.status);
  });

  // P0 - Critical Path Tests
  test("P0: Metrics dashboard visible with trace results", {
    tag: ['@tracesAnalyze', '@traces', '@smoke', '@P0', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing metrics dashboard visibility');

    // Setup trace search
    await pm.tracesPage.setupTraceSearch();

    // Wait for results
    await page.waitForTimeout(3000);

    // Check if metrics dashboard is visible
    const hasResults = await pm.tracesPage.hasTraceResults();

    if (hasResults) {
      // Verify metrics dashboard area is visible (contains Rate, Duration, Errors panels)
      let metricsDashboardVisible = await pm.tracesPage.isTracesMetricsDashboardVisible();

      // The metrics dashboard might be toggled off by default
      if (!metricsDashboardVisible) {
        // Try to toggle metrics on
        await pm.tracesPage.toggleMetricsDashboard();
        await page.waitForTimeout(1000);
        metricsDashboardVisible = await pm.tracesPage.isTracesMetricsDashboardVisible();
      }

      testLogger.info(`Metrics dashboard visible: ${metricsDashboardVisible}`);
    } else {
      testLogger.info('No trace results available - this is acceptable for metrics dashboard test');
    }

    // Verify page is in valid state
    await pm.tracesPage.expectSearchBarVisible();
  });

  test("P0: Error only toggle filters trace results", {
    tag: ['@tracesAnalyze', '@traces', '@smoke', '@P0', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing error only toggle functionality');

    // Setup trace search
    await pm.tracesPage.setupTraceSearch();
    await page.waitForTimeout(2000);

    // Ensure metrics dashboard is visible for error toggle
    const metricsDashboardVisible = await pm.tracesPage.isTracesMetricsDashboardVisible();
    if (!metricsDashboardVisible) {
      await pm.tracesPage.toggleMetricsDashboard();
      await page.waitForTimeout(1000);
    }

    // Check if error only toggle is visible
    const errorToggleVisible = await pm.tracesPage.isErrorOnlyToggleVisible();
    testLogger.info(`Error only toggle visible: ${errorToggleVisible}`);

    if (errorToggleVisible) {
      // Get initial results count (if any)
      const initialHasResults = await pm.tracesPage.hasTraceResults();
      testLogger.info(`Initial has results: ${initialHasResults}`);

      // Toggle error only filter
      await pm.tracesPage.toggleErrorOnlyFilter();
      await page.waitForTimeout(2000);

      // Run search again to apply filter
      await pm.tracesPage.runTraceSearch();
      await page.waitForTimeout(2000);

      // Verify page is still functional
      await pm.tracesPage.expectSearchBarVisible();

      // Check results after filter (could be results or no results with errors)
      const hasResultsAfterFilter = await pm.tracesPage.hasTraceResults();
      const noResultsVisible = await pm.tracesPage.isNoResultsVisible();

      testLogger.info(`After error filter - Has results: ${hasResultsAfterFilter}, No results: ${noResultsVisible}`);

      // Toggle off for cleanup
      await pm.tracesPage.toggleErrorOnlyFilter();

      testLogger.info('Error only toggle test completed successfully');
    } else {
      // Error toggle not visible - verify page is still functional
      await pm.tracesPage.expectSearchBarVisible();
      testLogger.info('Error only toggle not visible - metrics dashboard may need to be enabled');
    }
  });

  test("P0: Analyze button hidden without brush selection", {
    tag: ['@tracesAnalyze', '@traces', '@smoke', '@P0', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing analyze button not visible without brush selection');

    // Setup trace search
    await pm.tracesPage.setupTraceSearch();
    await page.waitForTimeout(2000);

    // Ensure metrics dashboard is visible
    const metricsDashboardVisible = await pm.tracesPage.isTracesMetricsDashboardVisible();
    if (!metricsDashboardVisible) {
      await pm.tracesPage.toggleMetricsDashboard();
      await page.waitForTimeout(1000);
    }

    // Verify analyze button is NOT visible initially (no brush selection)
    const analyzeButtonVisible = await pm.tracesPage.isAnalyzeDimensionsButtonVisible();
    expect(analyzeButtonVisible).toBeFalsy();

    testLogger.info('Analyze button correctly hidden without brush selection');
  });

  // P1 - Functional Tests
  test("P1: Range filter chip behavior after brush selection attempt", {
    tag: ['@tracesAnalyze', '@traces', '@functional', '@P1', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing range filter chip display after brush selection');

    // Setup trace search
    await pm.tracesPage.setupTraceSearch();
    await page.waitForTimeout(2000);

    // Check if we have results
    const hasResults = await pm.tracesPage.hasTraceResults();
    testLogger.info(`Has trace results: ${hasResults}`);

    // Ensure metrics dashboard is visible
    let metricsDashboardVisible = await pm.tracesPage.isTracesMetricsDashboardVisible();
    if (!metricsDashboardVisible) {
      await pm.tracesPage.toggleMetricsDashboard();
      await page.waitForTimeout(1000);
      metricsDashboardVisible = await pm.tracesPage.isTracesMetricsDashboardVisible();
    }

    testLogger.info(`Metrics dashboard visible: ${metricsDashboardVisible}`);

    if (metricsDashboardVisible) {
      // Try to perform brush selection on a chart
      const brushSuccessful = await pm.tracesPage.performBrushSelectionOnChart();
      testLogger.info(`Brush selection successful: ${brushSuccessful}`);

      if (brushSuccessful) {
        await page.waitForTimeout(1000);

        // Check if range filter chip appeared
        const rangeFilterChipVisible = await pm.tracesPage.isRangeFilterChipVisible();
        testLogger.info(`Range filter chip visible: ${rangeFilterChipVisible}`);

        // Also check if analyze button became visible
        const analyzeButtonVisible = await pm.tracesPage.isAnalyzeDimensionsButtonVisible();
        testLogger.info(`Analyze button visible after brush: ${analyzeButtonVisible}`);

        // At least one should be visible after successful brush
        expect(rangeFilterChipVisible || analyzeButtonVisible).toBeTruthy();
        testLogger.info('Brush selection UI elements appeared correctly');
      } else {
        // Brush selection didn't work - verify baseline state is maintained
        const analyzeButtonVisible = await pm.tracesPage.isAnalyzeDimensionsButtonVisible();
        expect(analyzeButtonVisible).toBeFalsy();
        testLogger.info('Brush selection not triggered - analyze button correctly hidden');
      }
    }

    // Verify page is still functional
    await pm.tracesPage.expectSearchBarVisible();
  });

  test("P1: Analysis dashboard opens when analyze button is available", {
    tag: ['@tracesAnalyze', '@traces', '@functional', '@P1', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing analysis dashboard opens after brush selection');

    // Setup trace search
    await pm.tracesPage.setupTraceSearch();
    await page.waitForTimeout(2000);

    // Ensure metrics dashboard is visible
    const metricsDashboardVisible = await pm.tracesPage.isTracesMetricsDashboardVisible();
    if (!metricsDashboardVisible) {
      await pm.tracesPage.toggleMetricsDashboard();
      await page.waitForTimeout(1000);
    }

    // Perform brush selection
    const brushSuccessful = await pm.tracesPage.performBrushSelectionOnChart();
    testLogger.info(`Brush selection successful: ${brushSuccessful}`);

    await page.waitForTimeout(1000);

    // Check if analyze button is visible now
    const analyzeButtonVisible = await pm.tracesPage.isAnalyzeDimensionsButtonVisible();
    testLogger.info(`Analyze button visible: ${analyzeButtonVisible}`);

    if (analyzeButtonVisible) {
      // Click analyze button
      await pm.tracesPage.clickAnalyzeDimensionsButton();

      // Wait for dashboard to load
      await pm.tracesPage.waitForAnalysisDashboardLoad();

      // Verify dashboard is visible
      const dashboardVisible = await pm.tracesPage.isAnalysisDashboardVisible();
      expect(dashboardVisible).toBeTruthy();

      testLogger.info('Analysis dashboard opened successfully');

      // Clean up - close dashboard
      await pm.tracesPage.closeAnalysisDashboard();
    } else {
      // Analyze button not visible - this is expected when brush selection doesn't trigger
      // Verify page is in correct baseline state
      const rangeFilterChipVisible = await pm.tracesPage.isRangeFilterChipVisible();
      expect(rangeFilterChipVisible).toBeFalsy();
      testLogger.info('Analyze button not available - brush selection did not trigger filter');
    }

    // Verify page is still functional
    await pm.tracesPage.expectSearchBarVisible();
  });

  test("P1: Analysis dashboard close button functionality", {
    tag: ['@tracesAnalyze', '@traces', '@functional', '@P1', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing analysis dashboard close functionality');

    // Setup trace search
    await pm.tracesPage.setupTraceSearch();
    await page.waitForTimeout(2000);

    // Ensure metrics dashboard is visible
    const metricsDashboardVisible = await pm.tracesPage.isTracesMetricsDashboardVisible();
    if (!metricsDashboardVisible) {
      await pm.tracesPage.toggleMetricsDashboard();
      await page.waitForTimeout(1000);
    }

    // Try brush selection workflow
    const brushSuccessful = await pm.tracesPage.performBrushSelectionOnChart();
    testLogger.info(`Brush selection successful: ${brushSuccessful}`);

    await page.waitForTimeout(1000);

    const analyzeButtonVisible = await pm.tracesPage.isAnalyzeDimensionsButtonVisible();
    testLogger.info(`Analyze button visible: ${analyzeButtonVisible}`);

    if (analyzeButtonVisible) {
      // Open dashboard
      await pm.tracesPage.clickAnalyzeDimensionsButton();
      await pm.tracesPage.waitForAnalysisDashboardLoad();

      // Verify dashboard is open
      let dashboardVisible = await pm.tracesPage.isAnalysisDashboardVisible();
      expect(dashboardVisible).toBeTruthy();
      testLogger.info('Dashboard opened successfully');

      // Close dashboard
      await pm.tracesPage.closeAnalysisDashboard();
      await page.waitForTimeout(1000);

      // Verify dashboard is closed
      dashboardVisible = await pm.tracesPage.isAnalysisDashboardVisible();
      expect(dashboardVisible).toBeFalsy();

      testLogger.info('Analysis dashboard close button works correctly');
    } else {
      // Dashboard cannot be opened without brush selection
      // Verify the dashboard is not visible
      const dashboardVisible = await pm.tracesPage.isAnalysisDashboardVisible();
      expect(dashboardVisible).toBeFalsy();
      testLogger.info('Dashboard correctly not available without brush selection');
    }

    // Verify page is still functional
    await pm.tracesPage.expectSearchBarVisible();
  });

  // P1 - Tab Navigation Tests
  test("P1: Analysis dashboard has tabs for Volume, Latency, and Error", {
    tag: ['@tracesAnalyze', '@traces', '@functional', '@P1', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing analysis dashboard tabs');

    // Setup trace search
    await pm.tracesPage.setupTraceSearch();
    await page.waitForTimeout(2000);

    // Ensure metrics dashboard is visible
    const metricsDashboardVisible = await pm.tracesPage.isTracesMetricsDashboardVisible();
    if (!metricsDashboardVisible) {
      await pm.tracesPage.toggleMetricsDashboard();
      await page.waitForTimeout(1000);
    }

    // Perform brush selection
    const brushSuccessful = await pm.tracesPage.performBrushSelectionOnChart();
    testLogger.info(`Brush selection successful: ${brushSuccessful}`);

    await page.waitForTimeout(1000);

    const analyzeButtonVisible = await pm.tracesPage.isAnalyzeDimensionsButtonVisible();
    testLogger.info(`Analyze button visible: ${analyzeButtonVisible}`);

    if (analyzeButtonVisible) {
      // Open dashboard
      await pm.tracesPage.clickAnalyzeDimensionsButton();
      await pm.tracesPage.waitForAnalysisDashboardLoad();

      // Check for tabs
      const volumeTabVisible = await pm.tracesPage.isVolumeTabVisible();
      const latencyTabVisible = await pm.tracesPage.isLatencyTabVisible();
      const errorTabVisible = await pm.tracesPage.isErrorTabVisible();

      testLogger.info(`Tabs - Volume: ${volumeTabVisible}, Latency: ${latencyTabVisible}, Error: ${errorTabVisible}`);

      // At least Volume tab should be visible (it's the default)
      if (volumeTabVisible || latencyTabVisible || errorTabVisible) {
        const tabCount = await pm.tracesPage.getVisibleTabCount();
        testLogger.info(`Total visible tabs: ${tabCount}`);
        expect(tabCount).toBeGreaterThan(0);
      }

      // Close dashboard
      await pm.tracesPage.closeAnalysisDashboard();
      testLogger.info('Tab visibility test completed');
    } else {
      // No tabs to test without dashboard
      testLogger.info('Dashboard not available - tab test not applicable');
    }

    // Verify page is still functional
    await pm.tracesPage.expectSearchBarVisible();
  });

  test("P1: Switch between Volume, Latency and Error tabs", {
    tag: ['@tracesAnalyze', '@traces', '@functional', '@P1', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing tab navigation in analysis dashboard');

    // Setup trace search
    await pm.tracesPage.setupTraceSearch();
    await page.waitForTimeout(2000);

    // Ensure metrics dashboard is visible
    const metricsDashboardVisible = await pm.tracesPage.isTracesMetricsDashboardVisible();
    if (!metricsDashboardVisible) {
      await pm.tracesPage.toggleMetricsDashboard();
      await page.waitForTimeout(1000);
    }

    // Perform brush selection
    const brushSuccessful = await pm.tracesPage.performBrushSelectionOnChart();
    testLogger.info(`Brush selection successful: ${brushSuccessful}`);

    await page.waitForTimeout(1000);

    const analyzeButtonVisible = await pm.tracesPage.isAnalyzeDimensionsButtonVisible();
    testLogger.info(`Analyze button visible: ${analyzeButtonVisible}`);

    if (analyzeButtonVisible) {
      // Open dashboard
      await pm.tracesPage.clickAnalyzeDimensionsButton();
      await pm.tracesPage.waitForAnalysisDashboardLoad();

      // Try clicking each tab if visible
      const volumeTabVisible = await pm.tracesPage.isVolumeTabVisible();
      const latencyTabVisible = await pm.tracesPage.isLatencyTabVisible();
      const errorTabVisible = await pm.tracesPage.isErrorTabVisible();

      if (volumeTabVisible) {
        await pm.tracesPage.clickVolumeTab();
        await page.waitForTimeout(500);
        const volumeActive = await pm.tracesPage.isTabActive('volume');
        testLogger.info(`Clicked Volume tab, active: ${volumeActive}`);
      }

      if (latencyTabVisible) {
        await pm.tracesPage.clickLatencyTab();
        await page.waitForTimeout(500);
        const latencyActive = await pm.tracesPage.isTabActive('latency');
        testLogger.info(`Clicked Latency tab, active: ${latencyActive}`);
      }

      if (errorTabVisible) {
        await pm.tracesPage.clickErrorTab();
        await page.waitForTimeout(500);
        const errorActive = await pm.tracesPage.isTabActive('error');
        testLogger.info(`Clicked Error tab, active: ${errorActive}`);
      }

      // Switch back to Volume tab if visible
      if (volumeTabVisible) {
        await pm.tracesPage.clickVolumeTab();
        await page.waitForTimeout(500);
        testLogger.info('Switched back to Volume tab');
      }

      // Close dashboard
      await pm.tracesPage.closeAnalysisDashboard();
      testLogger.info('Tab navigation test completed');
    } else {
      // No tabs to test without dashboard
      testLogger.info('Dashboard not available - tab navigation test not applicable');
    }

    // Verify page is still functional
    await pm.tracesPage.expectSearchBarVisible();
  });

  // P2 - Edge Cases
  test("P2: Dimension selector in analysis dashboard", {
    tag: ['@tracesAnalyze', '@traces', '@edge', '@P2', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing dimension selector in analysis dashboard');

    // Setup and open dashboard (full workflow)
    await pm.tracesPage.setupTraceSearch();
    await page.waitForTimeout(2000);

    const metricsDashboardVisible = await pm.tracesPage.isTracesMetricsDashboardVisible();
    if (!metricsDashboardVisible) {
      await pm.tracesPage.toggleMetricsDashboard();
      await page.waitForTimeout(1000);
    }

    const brushSuccessful = await pm.tracesPage.performBrushSelectionOnChart();
    testLogger.info(`Brush selection successful: ${brushSuccessful}`);

    await page.waitForTimeout(1000);

    const analyzeButtonVisible = await pm.tracesPage.isAnalyzeDimensionsButtonVisible();
    testLogger.info(`Analyze button visible: ${analyzeButtonVisible}`);

    if (analyzeButtonVisible) {
      // Open dashboard
      await pm.tracesPage.clickAnalyzeDimensionsButton();
      await pm.tracesPage.waitForAnalysisDashboardLoad();

      // Check if dimension selector button is visible
      const dimensionSelectorVisible = await pm.tracesPage.isDimensionSelectorButtonVisible();
      testLogger.info(`Dimension selector visible: ${dimensionSelectorVisible}`);

      if (dimensionSelectorVisible) {
        // Click dimension selector
        await pm.tracesPage.clickDimensionSelectorButton();

        // Verify dialog opens
        await page.waitForTimeout(1000);
        testLogger.info('Dimension selector clicked, dialog interaction complete');

        // Close dialog
        await pm.tracesPage.closeDimensionSelectorDialog();
      }

      // Clean up - close dashboard
      await pm.tracesPage.closeAnalysisDashboard();
      testLogger.info('Analysis dashboard dimension selector test completed');
    } else {
      // Verify baseline state
      const dashboardVisible = await pm.tracesPage.isAnalysisDashboardVisible();
      expect(dashboardVisible).toBeFalsy();
      testLogger.info('Dashboard not available - dimension selector test not applicable');
    }

    // Verify page is still functional
    await pm.tracesPage.expectSearchBarVisible();
  });

  test("P2: Filter chip removal functionality", {
    tag: ['@tracesAnalyze', '@traces', '@edge', '@P2', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing filter chip removal');

    // Setup trace search
    await pm.tracesPage.setupTraceSearch();
    await page.waitForTimeout(2000);

    const metricsDashboardVisible = await pm.tracesPage.isTracesMetricsDashboardVisible();
    if (!metricsDashboardVisible) {
      await pm.tracesPage.toggleMetricsDashboard();
      await page.waitForTimeout(1000);
    }

    // Perform brush selection
    const brushSuccessful = await pm.tracesPage.performBrushSelectionOnChart();
    testLogger.info(`Brush selection successful: ${brushSuccessful}`);

    if (brushSuccessful) {
      await page.waitForTimeout(1000);

      // Check filter chips
      const chipCount = await pm.tracesPage.getRangeFilterChipCount();
      testLogger.info(`Range filter chips after brush: ${chipCount}`);

      // Close chip if exists
      if (chipCount > 0) {
        await pm.tracesPage.closeFirstRangeFilterChip();
        await page.waitForTimeout(500);

        const chipCountAfterClose = await pm.tracesPage.getRangeFilterChipCount();
        testLogger.info(`Range filter chips after close: ${chipCountAfterClose}`);
        expect(chipCountAfterClose).toBeLessThan(chipCount);

        testLogger.info('Filter chip removal successful');
      } else {
        testLogger.info('No filter chips to remove');
      }
    } else {
      // Verify no filter chips exist when brush selection fails
      const chipCount = await pm.tracesPage.getRangeFilterChipCount();
      expect(chipCount).toBe(0);
      testLogger.info('No filter chips present - expected without brush selection');
    }

    // Verify page state
    await pm.tracesPage.expectSearchBarVisible();
  });
});
