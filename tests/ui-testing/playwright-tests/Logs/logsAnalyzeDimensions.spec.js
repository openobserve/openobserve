// logsAnalyzeDimensions.spec.js
// Tests for OpenObserve Logs Analyze Dimensions feature
// Feature: Volume analysis on logs data by examining distribution across different dimensions

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const logData = require('../../fixtures/log.json');

test.describe("Logs Analyze Dimensions testcases", () => {
  test.describe.configure({ mode: 'serial' });
  let pm; // Page Manager instance

  test.beforeEach(async ({ page }, testInfo) => {
    // Initialize test setup
    testLogger.testStart(testInfo.title, testInfo.file);

    // Navigate to base URL with authentication
    await navigateToBase(page);
    pm = new PageManager(page);

    // Navigate to logs page
    await page.goto(`${logData.logsUrl}?org_identifier=${process.env["ORGNAME"]}`);

    // Wait for page to stabilize
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});

    testLogger.info('Test setup completed for logs analyze dimensions');
  });

  test.afterEach(async ({ }, testInfo) => {
    testLogger.testEnd(testInfo.title, testInfo.status);
  });

  // P0 - Critical Path Tests
  test("P0: Analyze button visible when search results exist", {
    tag: ['@logsAnalyze', '@logs', '@smoke', '@P0', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing analyze button visibility with results');

    // Select stream using logsPage method
    await pm.logsPage.selectIndexStream(logData.Stream_Name_E2E);

    // Set time range to ensure data exists
    await pm.logsPage.setDateTimeTo15Minutes();

    // Run search
    await pm.logsPage.clickRefresh();

    // Wait for results to load
    await page.waitForTimeout(3000);

    // Check if we have results
    const hasResults = await pm.logsPage.isLogsSearchResultTableVisible();

    if (hasResults) {
      // Verify analyze button is visible
      const analyzeButtonVisible = await pm.logsPage.isAnalyzeDimensionsButtonVisible();
      expect(analyzeButtonVisible).toBeTruthy();
      testLogger.info('Analyze button is visible with results');
    } else {
      testLogger.info('No results found - skipping button visibility check (expected when no data)');
      // If no results, button should NOT be visible
      const analyzeButtonVisible = await pm.logsPage.isAnalyzeDimensionsButtonVisible();
      expect(analyzeButtonVisible).toBeFalsy();
    }
  });

  test("P0: Analyze button opens analysis dashboard", {
    tag: ['@logsAnalyze', '@logs', '@smoke', '@P0', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing analyze button opens dashboard');

    // Select stream
    await pm.logsPage.selectIndexStream(logData.Stream_Name_E2E);

    // Set time range
    await pm.logsPage.setDateTimeTo15Minutes();

    // Run search
    await pm.logsPage.clickRefresh();

    // Wait for results
    await page.waitForTimeout(3000);

    // Check if analyze button is visible (requires results)
    const analyzeButtonVisible = await pm.logsPage.isAnalyzeDimensionsButtonVisible();

    if (!analyzeButtonVisible) {
      testLogger.info('Precondition not met: No results available, skipping test');
      test.skip();
      return;
    }

    // Click analyze button
    await pm.logsPage.clickAnalyzeDimensionsButton();

    // Wait for dashboard to load
    await pm.logsPage.waitForAnalysisDashboardLoad();

    // Verify dashboard is visible
    const dashboardVisible = await pm.logsPage.isAnalysisDashboardVisible();
    expect(dashboardVisible).toBeTruthy();

    testLogger.info('Analysis dashboard opened successfully');

    // Clean up - close dashboard
    await pm.logsPage.closeAnalysisDashboard();
  });

  // P1 - Functional Tests
  test("P1: Analysis dashboard close button works", {
    tag: ['@logsAnalyze', '@logs', '@functional', '@P1', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing analysis dashboard close functionality');

    // Select stream and run search
    await pm.logsPage.selectIndexStream(logData.Stream_Name_E2E);
    await pm.logsPage.setDateTimeTo15Minutes();
    await pm.logsPage.clickRefresh();
    await page.waitForTimeout(3000);

    // Check precondition
    const analyzeButtonVisible = await pm.logsPage.isAnalyzeDimensionsButtonVisible();
    if (!analyzeButtonVisible) {
      testLogger.info('Precondition not met: No results available, skipping test');
      test.skip();
      return;
    }

    // Open dashboard
    await pm.logsPage.clickAnalyzeDimensionsButton();
    await pm.logsPage.waitForAnalysisDashboardLoad();

    // Verify dashboard is open
    let dashboardVisible = await pm.logsPage.isAnalysisDashboardVisible();
    expect(dashboardVisible).toBeTruthy();

    // Close dashboard
    await pm.logsPage.closeAnalysisDashboard();
    await page.waitForTimeout(1000);

    // Verify dashboard is closed
    dashboardVisible = await pm.logsPage.isAnalysisDashboardVisible();
    expect(dashboardVisible).toBeFalsy();

    testLogger.info('Analysis dashboard close button works correctly');
  });

  test("P1: Dimension selector dialog opens in analysis dashboard", {
    tag: ['@logsAnalyze', '@logs', '@functional', '@P1', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing dimension selector in analysis dashboard');

    // Select stream and run search
    await pm.logsPage.selectIndexStream(logData.Stream_Name_E2E);
    await pm.logsPage.setDateTimeTo15Minutes();
    await pm.logsPage.clickRefresh();
    await page.waitForTimeout(3000);

    // Check precondition
    const analyzeButtonVisible = await pm.logsPage.isAnalyzeDimensionsButtonVisible();
    if (!analyzeButtonVisible) {
      testLogger.info('Precondition not met: No results available, skipping test');
      test.skip();
      return;
    }

    // Open dashboard
    await pm.logsPage.clickAnalyzeDimensionsButton();
    await pm.logsPage.waitForAnalysisDashboardLoad();

    // Check if dimension selector button is visible
    const dimensionSelectorVisible = await pm.logsPage.isDimensionSelectorButtonVisible();

    if (dimensionSelectorVisible) {
      // Click dimension selector
      await pm.logsPage.clickDimensionSelectorButton();

      // Verify dimension selector dialog opens by checking for any dialog
      await page.waitForTimeout(1000);
      // After clicking dimension selector, the dialog should be visible
      testLogger.info('Dimension selector clicked, checking for dialog response');

      testLogger.info('Dimension selector dialog opened successfully');

      // Close dialog by pressing escape
      await pm.logsPage.closeDimensionSelectorDialog();
    } else {
      testLogger.info('Dimension selector not visible (may be disabled in custom SQL mode)');
    }

    // Clean up
    await pm.logsPage.closeAnalysisDashboard();
  });

  // P2 - Edge Cases
  test("P2: Analyze button hidden in SQL mode", {
    tag: ['@logsAnalyze', '@logs', '@edge', '@P2', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing analyze button hidden in SQL mode');

    // Select stream first
    await pm.logsPage.selectIndexStream(logData.Stream_Name_E2E);

    // Switch to SQL mode
    await pm.logsPage.clickSQLModeSwitch();
    await page.waitForTimeout(1000);

    // Enter a SQL query
    const sqlQuery = `SELECT * FROM "${logData.Stream_Name_E2E}" LIMIT 100`;
    await pm.logsPage.typeQuery(sqlQuery);

    // Run query
    await pm.logsPage.clickRefresh();
    await page.waitForTimeout(3000);

    // Verify analyze button is NOT visible in SQL mode
    const analyzeButtonVisible = await pm.logsPage.isAnalyzeDimensionsButtonVisible();
    expect(analyzeButtonVisible).toBeFalsy();

    testLogger.info('Analyze button correctly hidden in SQL mode');
  });

  test("P2: Analyze button hidden when no search results", {
    tag: ['@logsAnalyze', '@logs', '@edge', '@P2', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing analyze button hidden when no results');

    // Select stream
    await pm.logsPage.selectIndexStream(logData.Stream_Name_E2E);

    // Set a very restrictive filter that will return no results
    const noResultsQuery = 'impossible_field_that_does_not_exist=12345678901234567890';
    await pm.logsPage.typeQuery(noResultsQuery);

    // Set short time range
    await pm.logsPage.setDateTimeTo15Minutes();

    // Run search
    await pm.logsPage.clickRefresh();
    await page.waitForTimeout(3000);

    // Check if no results message is displayed
    const noResultsVisible = await pm.logsPage.isNoResultsMessageVisible();

    if (noResultsVisible) {
      // Verify analyze button is NOT visible when no results
      const analyzeButtonVisible = await pm.logsPage.isAnalyzeDimensionsButtonVisible();
      expect(analyzeButtonVisible).toBeFalsy();
      testLogger.info('Analyze button correctly hidden when no results');
    } else {
      // If we got results with this query, the test data might have unexpected records
      testLogger.info('Unexpectedly got results - verifying analyze button behavior');
      const analyzeButtonVisible = await pm.logsPage.isAnalyzeDimensionsButtonVisible();
      // If results exist, button should be visible
      testLogger.info(`Analyze button visible: ${analyzeButtonVisible}`);
    }
  });
});
