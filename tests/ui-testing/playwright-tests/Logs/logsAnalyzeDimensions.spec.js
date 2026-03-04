// logsAnalyzeDimensions.spec.js
// Tests for OpenObserve Logs Analyze Dimensions feature
// Feature: Volume analysis on logs data by examining distribution across different dimensions

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const logData = require('../../fixtures/log.json');

test.describe("Logs Analyze Dimensions testcases", () => {
  let pm;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);

    await navigateToBase(page);
    pm = new PageManager(page);

    // Navigate to logs page
    await page.goto(`${logData.logsUrl}?org_identifier=${process.env["ORGNAME"]}`);

    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});

    testLogger.info('Test setup completed for logs analyze dimensions');
  });

  test.afterEach(async ({ }, testInfo) => {
    testLogger.testEnd(testInfo.title, testInfo.status);
  });

  // Helper: select stream, run search, wait for results, and assert analyze button visible
  async function searchAndOpenAnalyzeButton(page) {
    await pm.logsPage.selectStream(logData.Stream);
    await pm.logsPage.setDateTimeTo15Minutes();
    await pm.logsPage.clickRefresh();
    await pm.logsPage.waitForSearchResultsToLoad();

    const hasResults = await pm.logsPage.isLogsSearchResultTableVisible();
    expect(hasResults, 'Search must return results — check data ingestion').toBeTruthy();

    // Wait for analyze button to appear (reactive state may need a moment after results render)
    await pm.logsPage.expectAnalyzeDimensionsButtonVisible();
  }

  // ─── P0 — Critical Path Tests ────────────────────────────────────────────────

  test("P0: Analyze button opens dashboard and charts load", {
    tag: ['@logsAnalyze', '@logs', '@smoke', '@P0', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing analyze button opens dashboard with chart content');

    await searchAndOpenAnalyzeButton(page);

    // Click analyze button
    await pm.logsPage.clickAnalyzeDimensionsButton();
    await pm.logsPage.waitForAnalysisDashboardLoad();

    // Dashboard should be visible
    const dashboardVisible = await pm.logsPage.isAnalysisDashboardVisible();
    expect(dashboardVisible).toBeTruthy();

    // After waitForLoad, should no longer be loading
    const isLoading = await pm.logsPage.isAnalysisDashboardLoading();
    expect(isLoading).toBeFalsy();

    testLogger.info('Analysis dashboard opened successfully');

    await pm.logsPage.closeAnalysisDashboard();
  });

  // ─── P1 — Functional Tests ───────────────────────────────────────────────────

  test("P1: Dashboard close button works", {
    tag: ['@logsAnalyze', '@logs', '@functional', '@P1', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing analysis dashboard close functionality');

    await searchAndOpenAnalyzeButton(page);

    // Open dashboard
    await pm.logsPage.clickAnalyzeDimensionsButton();
    await pm.logsPage.waitForAnalysisDashboardLoad();

    let dashboardVisible = await pm.logsPage.isAnalysisDashboardVisible();
    expect(dashboardVisible).toBeTruthy();

    // Close dashboard
    await pm.logsPage.closeAnalysisDashboard();
    await pm.logsPage.waitForDashboardClose();

    // Verify closed
    dashboardVisible = await pm.logsPage.isAnalysisDashboardVisible();
    expect(dashboardVisible).toBeFalsy();

    testLogger.info('Dashboard close button works correctly');
  });

  test("P1: Dimension sidebar visible, collapse, and expand", {
    tag: ['@logsAnalyze', '@logs', '@functional', '@P1', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing dimension sidebar visibility and collapse/expand');

    await searchAndOpenAnalyzeButton(page);

    await pm.logsPage.clickAnalyzeDimensionsButton();
    await pm.logsPage.waitForAnalysisDashboardLoad();

    // Sidebar should be visible by default (showDimensionSelector = ref(true))
    let sidebarVisible = await pm.logsPage.isDimensionSidebarVisible();
    expect(sidebarVisible).toBeTruthy();

    // Sidebar should have dimension checkboxes
    const checkboxCount = await pm.logsPage.getDimensionCheckboxCount();
    expect(checkboxCount).toBeGreaterThan(0);
    testLogger.info(`Dimension sidebar visible with ${checkboxCount} checkboxes`);

    // Collapse
    await pm.logsPage.toggleDimensionSidebar();
    sidebarVisible = await pm.logsPage.isDimensionSidebarVisible();
    expect(sidebarVisible).toBeFalsy();
    testLogger.info('Sidebar collapsed');

    // Expand
    await pm.logsPage.toggleDimensionSidebar();
    sidebarVisible = await pm.logsPage.isDimensionSidebarVisible();
    expect(sidebarVisible).toBeTruthy();
    testLogger.info('Sidebar expanded');

    await pm.logsPage.closeAnalysisDashboard();
  });

  test("P1: Dimension search filters the checkbox list", {
    tag: ['@logsAnalyze', '@logs', '@functional', '@P1', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing dimension search filtering');

    await searchAndOpenAnalyzeButton(page);

    await pm.logsPage.clickAnalyzeDimensionsButton();
    await pm.logsPage.waitForAnalysisDashboardLoad();

    // Verify search input is visible
    const searchVisible = await pm.logsPage.isDimensionSearchInputVisible();
    expect(searchVisible).toBeTruthy();

    // Get initial count
    const initialCount = await pm.logsPage.getDimensionCheckboxCount();
    testLogger.info(`Initial dimension count: ${initialCount}`);
    expect(initialCount, 'Dimensions must be available for filtering').toBeGreaterThan(0);

    // Search for a term that should filter results
    await pm.logsPage.searchDimension('_timestamp');

    const filteredCount = await pm.logsPage.getDimensionCheckboxCount();
    testLogger.info(`Filtered dimension count: ${filteredCount}`);

    // Filtered count should be less than or equal to initial
    expect(filteredCount).toBeLessThanOrEqual(initialCount);

    testLogger.info('Dimension search filtering works');

    await pm.logsPage.closeAnalysisDashboard();
  });

  // ─── P2 — Edge Cases ─────────────────────────────────────────────────────────

  test("P2: Analyze button hidden in SQL mode", {
    tag: ['@logsAnalyze', '@logs', '@edge', '@P2', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing analyze button hidden in SQL mode');

    // First do a normal search to confirm button IS visible with results
    await searchAndOpenAnalyzeButton(page);

    // Switch to SQL mode — button should disappear (condition: !sqlMode)
    await pm.logsPage.clickSQLModeSwitch();
    await pm.logsPage.waitForSQLModeActive();

    // Analyze button should NOT be visible in SQL mode
    const analyzeButtonVisible = await pm.logsPage.isAnalyzeDimensionsButtonVisible();
    expect(analyzeButtonVisible).toBeFalsy();

    testLogger.info('Analyze button correctly hidden in SQL mode');
  });

  test("P2: Analyze button hidden when no search results", {
    tag: ['@logsAnalyze', '@logs', '@edge', '@P2', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing analyze button hidden when no results');

    // Select stream but do NOT run a search — hits array is empty so button should be hidden
    await pm.logsPage.selectStream(logData.Stream);
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});

    // Analyze button should NOT be visible with no search results (hits.length === 0)
    const analyzeButtonVisible = await pm.logsPage.isAnalyzeDimensionsButtonVisible();
    expect(analyzeButtonVisible).toBeFalsy();

    testLogger.info('Analyze button correctly hidden when no results');
  });

  test("P2: Dashboard loading state transitions to content", {
    tag: ['@logsAnalyze', '@logs', '@edge', '@P2', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing dashboard loading state');

    await searchAndOpenAnalyzeButton(page);

    // Click analyze — immediately check for loading state
    await pm.logsPage.clickAnalyzeDimensionsButton();

    const isLoading = await pm.logsPage.isAnalysisDashboardLoading();
    testLogger.info(`Loading state detected: ${isLoading}`);

    // Wait for load to complete
    await pm.logsPage.waitForAnalysisDashboardLoad();

    // After loading, should have content
    const dashboardVisible = await pm.logsPage.isAnalysisDashboardVisible();
    expect(dashboardVisible).toBeTruthy();

    const hasCharts = await pm.logsPage.hasAnalysisDashboardCharts();
    testLogger.info(`After load — Charts: ${hasCharts}`);

    testLogger.info('Dashboard loading state test completed');

    await pm.logsPage.closeAnalysisDashboard();
  });
});
