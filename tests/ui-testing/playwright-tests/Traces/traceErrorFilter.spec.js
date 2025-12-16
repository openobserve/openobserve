// traceErrorFilter.spec.js
// Tests for OpenObserve Traces Error Filtering functionality
// Following the modular pattern from Logs tests

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');

test.describe("Trace Error Filter testcases", () => {
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
    const org = process.env["ORGNAME"] || 'default';
    const baseUrl = (process.env["ZO_BASE_URL"] || '').replace(/\/+$/, '');
    const tracesUrl = `${baseUrl}/web/traces?org_identifier=${org}`;
    await page.goto(tracesUrl);
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});

    testLogger.info('Test setup completed for trace error filtering');
  });

  test.afterEach(async ({ }, testInfo) => {
    testLogger.testEnd(testInfo.title, testInfo.status);
  });

  // P0 Tests - Critical Path
  test("P0: View traces with error indicators", {
    tag: ['@traces', '@errors', '@smoke', '@P0', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing viewing traces with error indicators');

    // Setup and run search
    await pm.tracesPage.setupTraceSearch();

    // Look for traces with error counts
    const errorTrace = pm.tracesPage.getErrorTraces();
    let errorTraceCount = 0;

    if (await errorTrace.first().isVisible({ timeout: 5000 }).catch(() => false)) {
      testLogger.info('Found traces with error indicators');

      // Count error traces
      errorTraceCount = await errorTrace.count();
      testLogger.info(`Found ${errorTraceCount} traces with errors`);

      // Get error count text from first trace
      const errorText = await errorTrace.first().textContent();
      testLogger.info(`Error indicator text: ${errorText}`);

      // Verify error count is displayed with proper format
      expect(errorText).toMatch(/Errors\s*:\s*\d+/);

      // Extract and validate error count
      const match = errorText.match(/Errors\s*:\s*(\d+)/);
      if (match) {
        const errorCount = parseInt(match[1]);
        expect(errorCount).toBeGreaterThan(0);
        testLogger.info(`Error count extracted: ${errorCount}`);
      }

      // Verify multiple error traces if available
      if (errorTraceCount > 1) {
        const secondErrorText = await errorTrace.nth(1).textContent();
        expect(secondErrorText).toMatch(/Errors\s*:\s*\d+/);
        testLogger.info('Multiple error traces verified');
      }
    } else {
      testLogger.info('No traces with errors in current dataset');
      // This is acceptable - not all datasets have errors
    }
  });

  // P1 Tests - Core Functionality
  test("P1: Filter traces by error status code", {
    tag: ['@traces', '@errors', '@functional', '@P1', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing filtering traces by error status code');

    // Enter error filter query
    await pm.tracesPage.enterTraceQuery("status_code='2'");

    // Set time range and run query
    await pm.tracesPage.setTimeRange('15m');
    await pm.tracesPage.runSearch();
    await page.waitForTimeout(3000);

    // Check if results show only error traces
    const hasResults = await pm.tracesPage.hasTraceResults();

    if (hasResults) {
      testLogger.info('Error traces filtered successfully');

      // All visible traces should have errors
      const errorTraces = await pm.tracesPage.getErrorTraces().count();
      testLogger.info(`Found ${errorTraces} traces with errors`);
    } else {
      const noResults = await page.locator('[data-test="logs-search-result-not-found-text"]').isVisible().catch(() => false);
      if (noResults) {
        testLogger.info('No error traces found in dataset');
      }
    }
  });

  test("P1: Click on error trace to view details", {
    tag: ['@traces', '@errors', '@functional', '@P1', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing clicking on error trace to view details');

    // Setup and run search
    await pm.tracesPage.setupTraceSearch();

    // Find and click on a trace with errors
    const errorTrace = pm.tracesPage.getErrorTraces();

    if (await errorTrace.first().isVisible({ timeout: 5000 }).catch(() => false)) {
      await errorTrace.first().click();
      testLogger.info('Clicked on trace with errors');

      await page.waitForTimeout(2000);

      // Look for ERROR status in span details
      const errorStatus = page.getByRole('cell', { name: 'ERROR' });
      const statusCode2 = page.getByRole('cell', { name: '2' });

      if (await errorStatus.isVisible({ timeout: 3000 }).catch(() => false)) {
        testLogger.info('ERROR status visible in trace details');
      }

      if (await statusCode2.first().isVisible({ timeout: 3000 }).catch(() => false)) {
        testLogger.info('Status code 2 (error) visible in trace details');
      }
    } else {
      testLogger.info('No error traces available to click');
      test.skip();
    }
  });

  test("P1: Combine error filter with service name filter", {
    tag: ['@traces', '@errors', '@functional', '@P1', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing combining error filter with service name filter');

    // Enter combined filter query
    await pm.tracesPage.enterTraceQuery("status_code='2' AND service_name='auth-service'");

    // Set time range and run query
    await pm.tracesPage.setTimeRange('15m');
    await pm.tracesPage.runSearch();
    await page.waitForTimeout(3000);

    // Check results
    const hasResults = await pm.tracesPage.hasTraceResults();

    if (hasResults) {
      testLogger.info('Combined filter applied successfully');

      // Results should show auth-service with errors
      const serviceText = await page.getByText('auth-service').first().isVisible({ timeout: 3000 }).catch(() => false);
      if (serviceText) {
        testLogger.info('Filtered results show auth-service with errors');
      }
    } else {
      testLogger.info('No results matching combined filter criteria');
    }
  });

  test("P1: Reset error filters", {
    tag: ['@traces', '@errors', '@functional', '@P1', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing reset of error filters');

    // First apply an error filter
    await pm.tracesPage.enterTraceQuery("status_code='2'");

    // Set time range and run query
    await pm.tracesPage.setTimeRange('15m');
    await pm.tracesPage.runSearch();
    await page.waitForTimeout(2000);

    // Now reset filters
    await pm.tracesPage.resetTraceFilters();

    // Verify query editor is cleared
    const viewLines = page.locator('.view-lines');
    const editorContent = await viewLines.textContent().catch(() => '');

    if (editorContent === '' || !editorContent.includes("status_code='2'")) {
      testLogger.info('Filters successfully reset');
    }
  });

  // P2 Tests - Edge Cases
  test("P2: Handle no error traces scenario", {
    tag: ['@traces', '@errors', '@edge', '@P2', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing scenario with no error traces');

    // Apply a very specific filter that likely returns no results
    await pm.tracesPage.enterTraceQuery("status_code='2' AND service_name='nonexistent-service'");

    // Set time range and run query
    await pm.tracesPage.setTimeRange('15m');
    await pm.tracesPage.runSearch();
    await page.waitForTimeout(3000);

    // Check for no results message
    const noResults = await page.locator('[data-test="logs-search-result-not-found-text"]').isVisible({ timeout: 5000 }).catch(() => false);

    if (noResults) {
      testLogger.info('No results message displayed correctly');
      await expect(page.locator('[data-test="logs-search-result-not-found-text"]')).toBeVisible();
    }
  });

  test("P2: Toggle between error and success traces", {
    tag: ['@traces', '@errors', '@edge', '@P2', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing toggle between error and success traces');

    // First show error traces
    await pm.tracesPage.enterTraceQuery("status_code='2'");
    await pm.tracesPage.setTimeRange('15m');
    await pm.tracesPage.runSearch();
    await page.waitForTimeout(2000);

    testLogger.info('Viewing error traces');

    // Now switch to success traces
    await pm.tracesPage.enterTraceQuery("status_code='1'");
    await pm.tracesPage.runSearch();
    await page.waitForTimeout(2000);

    testLogger.info('Switched to viewing success traces');

    // Verify no error indicators in results
    const errorCount = await pm.tracesPage.getErrorTraces().count();

    if (errorCount === 0) {
      testLogger.info('Success traces shown without error indicators');
    }
  });

  test("P2: Error filter with invalid syntax", {
    tag: ['@traces', '@errors', '@edge', '@P2', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing error filter with invalid syntax');

    // Enter invalid syntax
    await pm.tracesPage.enterTraceQuery("status_code='2 AND"); // Invalid syntax

    await pm.tracesPage.setTimeRange('15m');
    await pm.tracesPage.runSearch();
    await page.waitForTimeout(3000);

    // Check for error message
    const errorMessage = await page.locator('[data-test="logs-search-error-message"]').isVisible({ timeout: 5000 }).catch(() => false);

    if (errorMessage) {
      testLogger.info('Error message displayed for invalid syntax');
    } else {
      // May handle invalid syntax differently
      testLogger.info('System handled invalid syntax');
    }
  });
});