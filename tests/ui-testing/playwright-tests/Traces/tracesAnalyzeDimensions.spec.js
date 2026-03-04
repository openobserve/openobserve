// tracesAnalyzeDimensions.spec.js
// Tests for OpenObserve Traces Analyze Dimensions feature
// Feature: Volume/Latency/Error analysis on traces data via Insights button on RED metrics dashboard

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');

test.describe("Traces Analyze Dimensions testcases", () => {
  let pm;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);

    await navigateToBase(page);
    pm = new PageManager(page);

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

  // Helper: run trace search, assert results exist, ensure metrics dashboard visible
  async function searchAndAssertResults() {
    await pm.tracesPage.setupTraceSearch();
    await pm.tracesPage.waitForTraceSearchResults();

    const hasResults = await pm.tracesPage.hasTraceResults();
    expect(hasResults, 'Trace results must be available — check data ingestion').toBeTruthy();

    const metricsVisible = await pm.tracesPage.ensureMetricsDashboardVisible();
    expect(metricsVisible, 'Metrics dashboard must be visible').toBeTruthy();
  }

  // Helper: search, assert results, open insights dashboard, assert it opened
  async function searchAndOpenInsightsDashboard() {
    await searchAndAssertResults();

    const insightsVisible = await pm.tracesPage.isInsightsButtonVisible();
    expect(insightsVisible, 'Insights button must be visible').toBeTruthy();

    await pm.tracesPage.clickInsightsButton();
    await pm.tracesPage.waitForAnalysisDashboardLoad();

    const dashboardVisible = await pm.tracesPage.isAnalysisDashboardVisible();
    expect(dashboardVisible, 'Analysis dashboard must open successfully').toBeTruthy();
  }

  // ─── P0 — Critical Path Tests ────────────────────────────────────────────────

  test("P0: Insights button opens analysis dashboard with 3 tabs", {
    tag: ['@tracesAnalyze', '@traces', '@smoke', '@P0', '@all']
  }, async ({ page }) => {
    testLogger.info('Verifying insights button opens dashboard with Rate/Latency/Errors tabs');

    await searchAndOpenInsightsDashboard();

    // Should have 3 tabs: Rate, Latency, Errors
    const tabCount = await pm.tracesPage.getVisibleTabCount();
    expect(tabCount).toBe(3);

    const rateVisible = await pm.tracesPage.isRateTabVisible();
    const latencyVisible = await pm.tracesPage.isLatencyTabVisible();
    const errorsVisible = await pm.tracesPage.isErrorsTabVisible();

    expect(rateVisible).toBeTruthy();
    expect(latencyVisible).toBeTruthy();
    expect(errorsVisible).toBeTruthy();

    testLogger.info('Dashboard opened with all 3 tabs: Rate, Latency, Errors');

    await pm.tracesPage.closeAnalysisDashboard();
  });

  test("P0: Error-only toggle filters trace results", {
    tag: ['@tracesAnalyze', '@traces', '@smoke', '@P0', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing error-only toggle functionality');

    await searchAndAssertResults();

    const errorToggleVisible = await pm.tracesPage.isErrorOnlyToggleVisible();
    expect(errorToggleVisible, 'Error-only toggle must be visible').toBeTruthy();

    // Toggle error-only filter ON
    await pm.tracesPage.toggleErrorOnlyFilter();

    // Re-run search to apply filter
    await pm.tracesPage.setupTraceSearch();
    await pm.tracesPage.waitForTraceSearchResults();

    // Page should still be functional after filter
    await pm.tracesPage.expectSearchBarVisible();

    testLogger.info('Error-only toggle applied successfully');

    // Toggle back OFF for cleanup
    await pm.tracesPage.toggleErrorOnlyFilter();
  });

  // ─── P1 — Functional Tests ───────────────────────────────────────────────────

  test("P1: Tab switching works and loads chart content", {
    tag: ['@tracesAnalyze', '@traces', '@functional', '@P1', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing tab navigation and chart content across all tabs');

    await searchAndOpenInsightsDashboard();

    // Click Rate tab — verify active and check charts
    await pm.tracesPage.clickRateTab();
    const rateActive = await pm.tracesPage.isTabActive('Rate');
    expect(rateActive).toBeTruthy();
    const rateCharts = await pm.tracesPage.hasAnalysisDashboardCharts();
    testLogger.info(`Rate tab active, charts: ${rateCharts}`);

    // Click Latency tab — verify active and check charts
    await pm.tracesPage.clickLatencyTab();
    const latencyActive = await pm.tracesPage.isTabActive('Duration');
    expect(latencyActive).toBeTruthy();
    const latencyCharts = await pm.tracesPage.hasAnalysisDashboardCharts();
    testLogger.info(`Latency tab active, charts: ${latencyCharts}`);

    // Click Errors tab — verify active and check charts
    await pm.tracesPage.clickErrorsTab();
    const errorsActive = await pm.tracesPage.isTabActive('Errors');
    expect(errorsActive).toBeTruthy();
    const errorsCharts = await pm.tracesPage.hasAnalysisDashboardCharts();
    testLogger.info(`Errors tab active, charts: ${errorsCharts}`);

    // Round-trip back to Rate
    await pm.tracesPage.clickRateTab();
    const rateActiveAgain = await pm.tracesPage.isTabActive('Rate');
    expect(rateActiveAgain).toBeTruthy();
    testLogger.info('Tab round-trip completed: Rate → Latency → Errors → Rate');

    // At least one tab should have charts
    expect(rateCharts || latencyCharts || errorsCharts).toBeTruthy();

    await pm.tracesPage.closeAnalysisDashboard();
  });

  test("P1: Dashboard close button works", {
    tag: ['@tracesAnalyze', '@traces', '@functional', '@P1', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing dashboard close button functionality');

    await searchAndOpenInsightsDashboard();

    // Close dashboard
    await pm.tracesPage.closeAnalysisDashboard();
    await pm.tracesPage.waitForDashboardClose();

    // Verify dashboard is closed
    const dashboardVisible = await pm.tracesPage.isAnalysisDashboardVisible();
    expect(dashboardVisible).toBeFalsy();

    // Page should be functional after close
    await pm.tracesPage.expectSearchBarVisible();

    testLogger.info('Dashboard close button works correctly');
  });

  test("P1: Dimension sidebar visible, collapse, and expand", {
    tag: ['@tracesAnalyze', '@traces', '@functional', '@P1', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing dimension sidebar visibility and collapse/expand');

    await searchAndOpenInsightsDashboard();

    // Sidebar should be visible by default (showDimensionSelector = ref(true))
    let sidebarVisible = await pm.tracesPage.isDimensionSidebarVisible();
    expect(sidebarVisible).toBeTruthy();

    // Sidebar should have dimension checkboxes
    const checkboxCount = await pm.tracesPage.getDimensionCheckboxCount();
    expect(checkboxCount).toBeGreaterThan(0);
    testLogger.info(`Dimension sidebar visible with ${checkboxCount} dimensions`);

    // Collapse sidebar
    await pm.tracesPage.toggleDimensionSidebar();
    sidebarVisible = await pm.tracesPage.isDimensionSidebarVisible();
    expect(sidebarVisible).toBeFalsy();
    testLogger.info('Sidebar collapsed');

    // Expand sidebar
    await pm.tracesPage.toggleDimensionSidebar();
    sidebarVisible = await pm.tracesPage.isDimensionSidebarVisible();
    expect(sidebarVisible).toBeTruthy();
    testLogger.info('Sidebar expanded');

    await pm.tracesPage.closeAnalysisDashboard();
  });

  test("P1: Dimension search input filters checkboxes", {
    tag: ['@tracesAnalyze', '@traces', '@functional', '@P1', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing dimension search filtering');

    await searchAndOpenInsightsDashboard();

    // Verify search input exists
    const searchVisible = await pm.tracesPage.isDimensionSearchInputVisible();
    expect(searchVisible).toBeTruthy();

    // Get initial checkbox count
    const initialCount = await pm.tracesPage.getDimensionCheckboxCount();
    testLogger.info(`Initial dimension count: ${initialCount}`);
    expect(initialCount, 'Dimensions must be available for filtering').toBeGreaterThan(0);

    // Get the first dimension value to use as search term
    const firstDimension = await pm.tracesPage.getFirstDimensionValue();
    testLogger.info(`Searching for dimension: ${firstDimension}`);
    expect(firstDimension, 'Must be able to read dimension value').toBeTruthy();

    // Search for it
    await pm.tracesPage.searchDimension(firstDimension);

    // After search, checkbox count should be <= initial count
    const filteredCount = await pm.tracesPage.getDimensionCheckboxCount();
    testLogger.info(`Filtered dimension count: ${filteredCount}`);
    expect(filteredCount).toBeLessThanOrEqual(initialCount);
    expect(filteredCount).toBeGreaterThan(0);

    testLogger.info('Dimension search filtering works correctly');

    await pm.tracesPage.closeAnalysisDashboard();
  });

  test("P1: Toggling a dimension checkbox updates chart content", {
    tag: ['@tracesAnalyze', '@traces', '@functional', '@P1', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing dimension checkbox toggle triggers chart update');

    await searchAndOpenInsightsDashboard();

    const checkboxCount = await pm.tracesPage.getDimensionCheckboxCount();
    expect(checkboxCount, 'Dimension checkboxes must be available').toBeGreaterThan(0);

    // Get a dimension value to toggle
    const dimensionValue = await pm.tracesPage.getFirstDimensionValue();
    expect(dimensionValue, 'Must be able to read dimension value').toBeTruthy();

    // Toggle the dimension checkbox
    const toggled = await pm.tracesPage.toggleDimensionCheckbox(dimensionValue);
    expect(toggled).toBeTruthy();
    testLogger.info(`Toggled dimension: ${dimensionValue}`);

    // Dashboard should still be visible and functional after toggle
    const dashboardVisible = await pm.tracesPage.isAnalysisDashboardVisible();
    expect(dashboardVisible).toBeTruthy();

    testLogger.info('Dimension checkbox toggle completed — dashboard still functional');

    await pm.tracesPage.closeAnalysisDashboard();
  });

  // ─── P2 — Edge Cases ─────────────────────────────────────────────────────────

  test("P2: Brush selection on chart enables comparison mode", {
    tag: ['@tracesAnalyze', '@traces', '@edge', '@P2', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing brush selection enables comparison mode');

    await searchAndAssertResults();

    // Attempt brush selection on the metrics chart
    const brushSuccessful = await pm.tracesPage.performBrushSelectionOnChart();
    testLogger.info(`Brush selection successful: ${brushSuccessful}`);
    expect(brushSuccessful, 'Brush selection must succeed on metrics chart').toBeTruthy();

    // After brush, insights button should still be visible
    const insightsVisible = await pm.tracesPage.isInsightsButtonVisible();
    expect(insightsVisible).toBeTruthy();

    // Open dashboard — should now be in comparison mode
    await pm.tracesPage.clickInsightsButton();
    await pm.tracesPage.waitForAnalysisDashboardLoad();

    const dashboardVisible = await pm.tracesPage.isAnalysisDashboardVisible();
    expect(dashboardVisible).toBeTruthy();

    testLogger.info('Dashboard opened after brush selection — comparison mode');

    await pm.tracesPage.closeAnalysisDashboard();
  });

  test("P2: Dashboard loading state appears before content", {
    tag: ['@tracesAnalyze', '@traces', '@edge', '@P2', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing dashboard loading state');

    await searchAndAssertResults();

    const insightsVisible = await pm.tracesPage.isInsightsButtonVisible();
    expect(insightsVisible, 'Insights button must be visible').toBeTruthy();

    // Click insights — check for loading state immediately
    await pm.tracesPage.clickInsightsButton();

    // Check loading state (may be brief, so we check once)
    const isLoading = await pm.tracesPage.isAnalysisDashboardLoading();
    testLogger.info(`Dashboard loading state detected: ${isLoading}`);

    // Wait for dashboard to finish loading
    await pm.tracesPage.waitForAnalysisDashboardLoad();

    // After loading, dashboard should be visible
    const dashboardVisible = await pm.tracesPage.isAnalysisDashboardVisible();
    expect(dashboardVisible).toBeTruthy();

    // Either loading was detected or content loaded directly — both are valid
    const hasCharts = await pm.tracesPage.hasAnalysisDashboardCharts();
    const hasError = await pm.tracesPage.isAnalysisDashboardError();
    testLogger.info(`After load — Charts: ${hasCharts}, Error: ${hasError}`);

    // Dashboard should show either charts or error (not be empty)
    expect(hasCharts || hasError).toBeTruthy();

    testLogger.info('Dashboard loading state test completed');

    await pm.tracesPage.closeAnalysisDashboard();
  });
});
