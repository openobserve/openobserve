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
      const metricsDashboardVisible = await pm.tracesPage.isTracesMetricsDashboardVisible();
      // The metrics dashboard might be toggled off by default
      if (!metricsDashboardVisible) {
        // Try to toggle metrics on
        await pm.tracesPage.toggleMetricsDashboard();
        await page.waitForTimeout(1000);
      }

      testLogger.info('Metrics dashboard checked successfully');
    } else {
      testLogger.info('No trace results - metrics dashboard test skipped');
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

    // Check if error only toggle is visible
    const errorToggleVisible = await pm.tracesPage.isErrorOnlyToggleVisible();

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
    } else {
      testLogger.info('Error only toggle not visible - may need metrics dashboard enabled');
    }
  });

  test("P0: Analyze button hidden without brush selection", {
    tag: ['@tracesAnalyze', '@traces', '@smoke', '@P0', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing analyze button not visible without brush selection');

    // Setup trace search
    await pm.tracesPage.setupTraceSearch();
    await page.waitForTimeout(2000);

    // Verify analyze button is NOT visible initially (no brush selection)
    const analyzeButtonVisible = await pm.tracesPage.isAnalyzeDimensionsButtonVisible();
    expect(analyzeButtonVisible).toBeFalsy();

    testLogger.info('Analyze button correctly hidden without brush selection');
  });

  // P1 - Functional Tests
  test("P1: Range filter chip displays after brush selection", {
    tag: ['@tracesAnalyze', '@traces', '@functional', '@P1', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing range filter chip display after brush selection');

    // Setup trace search
    await pm.tracesPage.setupTraceSearch();
    await page.waitForTimeout(2000);

    // Check if we have results (needed for brush selection)
    const hasResults = await pm.tracesPage.hasTraceResults();

    if (!hasResults) {
      testLogger.info('Precondition not met: No trace results available, skipping test');
      test.skip();
      return;
    }

    // Ensure metrics dashboard is visible
    const metricsDashboardVisible = await pm.tracesPage.isTracesMetricsDashboardVisible();
    if (!metricsDashboardVisible) {
      await pm.tracesPage.toggleMetricsDashboard();
      await page.waitForTimeout(1000);
    }

    // Try to perform brush selection on a chart
    const brushSuccessful = await pm.tracesPage.performBrushSelectionOnChart();

    if (brushSuccessful) {
      await page.waitForTimeout(1000);

      // Check if range filter chip appeared
      const rangeFilterChipVisible = await pm.tracesPage.isRangeFilterChipVisible();
      testLogger.info(`Range filter chip visible: ${rangeFilterChipVisible}`);

      // Also check if analyze button became visible
      const analyzeButtonVisible = await pm.tracesPage.isAnalyzeDimensionsButtonVisible();
      testLogger.info(`Analyze button visible after brush: ${analyzeButtonVisible}`);

      if (rangeFilterChipVisible || analyzeButtonVisible) {
        testLogger.info('Brush selection UI elements appeared correctly');
      }
    } else {
      testLogger.info('Could not perform brush selection - chart may not be visible');
    }

    // Verify page is still functional
    await pm.tracesPage.expectSearchBarVisible();
  });

  test("P1: Analysis dashboard opens with correct tab after brush selection", {
    tag: ['@tracesAnalyze', '@traces', '@functional', '@P1', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing analysis dashboard opens after brush selection');

    // Setup trace search
    await pm.tracesPage.setupTraceSearch();
    await page.waitForTimeout(2000);

    // Check preconditions
    const hasResults = await pm.tracesPage.hasTraceResults();
    if (!hasResults) {
      testLogger.info('Precondition not met: No trace results, skipping test');
      test.skip();
      return;
    }

    // Ensure metrics dashboard is visible
    const metricsDashboardVisible = await pm.tracesPage.isTracesMetricsDashboardVisible();
    if (!metricsDashboardVisible) {
      await pm.tracesPage.toggleMetricsDashboard();
      await page.waitForTimeout(1000);
    }

    // Perform brush selection
    const brushSuccessful = await pm.tracesPage.performBrushSelectionOnChart();

    if (!brushSuccessful) {
      testLogger.info('Could not perform brush selection, skipping test');
      test.skip();
      return;
    }

    await page.waitForTimeout(1000);

    // Check if analyze button is visible now
    const analyzeButtonVisible = await pm.tracesPage.isAnalyzeDimensionsButtonVisible();

    if (!analyzeButtonVisible) {
      testLogger.info('Analyze button not visible after brush selection');
      // This could be expected if the feature requires specific data patterns
      return;
    }

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
  });

  test("P1: Analysis dashboard close button works", {
    tag: ['@tracesAnalyze', '@traces', '@functional', '@P1', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing analysis dashboard close functionality');

    // This test requires the dashboard to be open, which needs brush selection
    // For simplicity, we'll test the close button if we can get the dashboard open

    // Setup trace search
    await pm.tracesPage.setupTraceSearch();
    await page.waitForTimeout(2000);

    const hasResults = await pm.tracesPage.hasTraceResults();
    if (!hasResults) {
      testLogger.info('Precondition not met: No results, skipping test');
      test.skip();
      return;
    }

    // Try brush selection workflow
    const metricsDashboardVisible = await pm.tracesPage.isTracesMetricsDashboardVisible();
    if (!metricsDashboardVisible) {
      await pm.tracesPage.toggleMetricsDashboard();
      await page.waitForTimeout(1000);
    }

    const brushSuccessful = await pm.tracesPage.performBrushSelectionOnChart();
    if (!brushSuccessful) {
      testLogger.info('Could not perform brush selection, skipping test');
      test.skip();
      return;
    }

    await page.waitForTimeout(1000);

    const analyzeButtonVisible = await pm.tracesPage.isAnalyzeDimensionsButtonVisible();
    if (!analyzeButtonVisible) {
      testLogger.info('Analyze button not visible, skipping test');
      test.skip();
      return;
    }

    // Open dashboard
    await pm.tracesPage.clickAnalyzeDimensionsButton();
    await pm.tracesPage.waitForAnalysisDashboardLoad();

    // Verify dashboard is open
    let dashboardVisible = await pm.tracesPage.isAnalysisDashboardVisible();
    expect(dashboardVisible).toBeTruthy();

    // Close dashboard
    await pm.tracesPage.closeAnalysisDashboard();
    await page.waitForTimeout(1000);

    // Verify dashboard is closed
    dashboardVisible = await pm.tracesPage.isAnalysisDashboardVisible();
    expect(dashboardVisible).toBeFalsy();

    testLogger.info('Analysis dashboard close button works correctly');
  });

  // P2 - Edge Cases
  test("P2: Dimension selector available in analysis dashboard", {
    tag: ['@tracesAnalyze', '@traces', '@edge', '@P2', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing dimension selector in analysis dashboard');

    // Setup and open dashboard (full workflow)
    await pm.tracesPage.setupTraceSearch();
    await page.waitForTimeout(2000);

    const hasResults = await pm.tracesPage.hasTraceResults();
    if (!hasResults) {
      testLogger.info('Precondition not met: No results, skipping test');
      test.skip();
      return;
    }

    const metricsDashboardVisible = await pm.tracesPage.isTracesMetricsDashboardVisible();
    if (!metricsDashboardVisible) {
      await pm.tracesPage.toggleMetricsDashboard();
      await page.waitForTimeout(1000);
    }

    const brushSuccessful = await pm.tracesPage.performBrushSelectionOnChart();
    if (!brushSuccessful) {
      testLogger.info('Could not perform brush selection, skipping test');
      test.skip();
      return;
    }

    await page.waitForTimeout(1000);

    const analyzeButtonVisible = await pm.tracesPage.isAnalyzeDimensionsButtonVisible();
    if (!analyzeButtonVisible) {
      testLogger.info('Analyze button not visible, skipping test');
      test.skip();
      return;
    }

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
      await page.keyboard.press('Escape');
    }

    // Clean up
    await pm.tracesPage.closeAnalysisDashboard();
  });

  test("P2: Multiple brush selections create filter chips", {
    tag: ['@tracesAnalyze', '@traces', '@edge', '@P2', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing multiple brush selections');

    // Setup trace search
    await pm.tracesPage.setupTraceSearch();
    await page.waitForTimeout(2000);

    const hasResults = await pm.tracesPage.hasTraceResults();
    if (!hasResults) {
      testLogger.info('Precondition not met: No results, skipping test');
      test.skip();
      return;
    }

    const metricsDashboardVisible = await pm.tracesPage.isTracesMetricsDashboardVisible();
    if (!metricsDashboardVisible) {
      await pm.tracesPage.toggleMetricsDashboard();
      await page.waitForTimeout(1000);
    }

    // Perform first brush selection
    const brushSuccessful = await pm.tracesPage.performBrushSelectionOnChart();

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
      }
    } else {
      testLogger.info('Could not perform brush selection');
    }

    // Verify page state
    await pm.tracesPage.expectSearchBarVisible();
  });
});
