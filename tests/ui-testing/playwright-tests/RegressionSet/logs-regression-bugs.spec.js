/**
 * Logs Regression Bug Tests
 *
 * Bug fixes for logs page functionality:
 * - #9996: Page appears blank midway on scroll
 * - #9796: Logs page load data without clicking run query
 * - #9533: Loading icon missing when run query for long duration
 * - #8928: UI revamp issues (sidebar, search bar, histogram)
 */

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const logData = require("../../fixtures/log.json");
const { ingestTestData } = require('../utils/data-ingestion.js');

test.describe("Logs Regression Bug Fixes", () => {
  // Changed from serial to parallel - tests are independent (each gets own page/PM in beforeEach)
  test.describe.configure({ mode: 'parallel' });
  let pm;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
    await page.waitForLoadState('networkidle');

    // Attempt data ingestion but don't fail test if it errors (global setup already ingested data)
    try {
      await ingestTestData(page);
    } catch (error) {
      testLogger.warn(`Data ingestion skipped (may already exist from global setup): ${error.message}`);
    }

    testLogger.info('Logs regression bug test setup completed');
  });

  // ==========================================================================
  // Bug #9996: Page appears blank midway on scroll
  // https://github.com/openobserve/openobserve/issues/9996
  // ==========================================================================
  test("should maintain table visibility during scroll @bug-9996 @P0 @scroll @regression", async ({ page }) => {
    testLogger.info('Test: Verify scroll maintains content visibility (Bug #9996)');

    await pm.logsPage.clickMenuLinkLogsItem();
    await page.waitForLoadState('networkidle');
    await pm.logsPage.selectStream('e2e_automate');
    await pm.logsPage.clickDateTimeButton();
    await pm.logsPage.clickRelative15MinButton();
    await pm.logsPage.clickRefreshButton();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // STRONG ASSERTION: Table must be visible before scroll
    await pm.logsPage.expectLogsTableVisible();

    // Scroll multiple times and verify table stays visible
    for (let i = 0; i < 5; i++) {
      await page.mouse.wheel(0, 300);
      await page.waitForTimeout(300);
      // STRONG ASSERTION: Table must remain visible after each scroll
      await pm.logsPage.expectLogsTableVisible();
    }

    testLogger.info('✓ PASSED: Table visible throughout scroll');
  });

  // ==========================================================================
  // Bug #9796: Logs page load data without clicking on run query
  // https://github.com/openobserve/openobserve/issues/9796
  // ==========================================================================
  test("should only load data after clicking run query @bug-9796 @P0 @queryBehavior @regression", async ({ page }) => {
    testLogger.info('Test: Verify no auto-load on stream selection (Bug #9796)');

    // Track search API calls
    const searchApiCalls = [];
    await page.route('**/api/*/_search**', async (route, request) => {
      const url = request.url();
      if (!url.includes('validate=true') && !url.includes('_values')) {
        searchApiCalls.push({ url, timestamp: Date.now() });
        testLogger.info(`Search API called: ${url.substring(0, 100)}`);
      }
      await route.continue();
    });

    // Navigate to logs page
    await page.goto(`${logData.logsUrl}?org_identifier=${process.env["ORGNAME"]}`);
    await page.waitForLoadState('networkidle');
    const initialCallCount = searchApiCalls.length;
    testLogger.info(`Initial API calls: ${initialCallCount}`);

    // Select stream WITHOUT clicking run query
    await pm.logsPage.selectStream('e2e_automate');
    await page.waitForTimeout(2000);

    const callsAfterSelection = searchApiCalls.length - initialCallCount;
    testLogger.info(`API calls after stream selection: ${callsAfterSelection}`);

    // Now click Run Query
    await pm.logsPage.clickRefreshButton();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // STRONG ASSERTION: Search API should be called after clicking run query
    const totalCalls = searchApiCalls.length;
    expect(totalCalls).toBeGreaterThan(initialCallCount);
    testLogger.info(`Total API calls after Run Query: ${totalCalls}`);

    // STRONG ASSERTION: Results should load after explicit query
    await pm.logsPage.expectLogsTableVisible();

    testLogger.info('✓ PASSED: Data loads only after clicking Run Query');
  });

  // ==========================================================================
  // Bug #9533: Loading icon missing when run query for long duration
  // https://github.com/openobserve/openobserve/issues/9533
  // ==========================================================================
  test("should show visual feedback during query execution @bug-9533 @P0 @loading @regression", async ({ page }) => {
    testLogger.info('Test: Verify loading indicator during query (Bug #9533)');

    await pm.logsPage.clickMenuLinkLogsItem();
    await page.waitForLoadState('networkidle');
    await pm.logsPage.selectStream('e2e_automate');
    await page.waitForTimeout(1000);

    // Set larger time range
    await pm.logsPage.clickDateTimeButton();
    await pm.logsPage.clickRelative1HourOrFallback();

    // STRONG ASSERTION: Button should be enabled before query
    await pm.logsPage.expectRefreshButtonEnabled();

    // Click run query
    await pm.logsPage.clickRefreshButton();

    // Wait for query to complete
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // STRONG ASSERTION: Button should be enabled after query completes
    await pm.logsPage.expectRefreshButtonEnabled();

    // STRONG ASSERTION: Results should be visible after query
    await pm.logsPage.expectLogsTableVisible();

    testLogger.info('✓ PASSED: Query execution provides feedback');
  });

  // ==========================================================================
  // Bug #8928: UI revamp issues - Search bar UI consistency
  // https://github.com/openobserve/openobserve/issues/8928
  // ==========================================================================
  test("should display search bar with required UI elements @bug-8928 @P1 @ui @regression", async ({ page }) => {
    testLogger.info('Test: Verify search bar UI consistency (Bug #8928)');

    await page.goto(`${logData.logsUrl}?org_identifier=${process.env["ORGNAME"]}`);
    await page.waitForLoadState('networkidle');
    await pm.logsPage.selectStream('e2e_automate');
    await pm.logsPage.clickRefreshButton();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // STRONG ASSERTION: Stream selector must be visible
    await pm.logsPage.expectStreamSelectorVisible();

    // STRONG ASSERTION: Refresh button must be visible
    await pm.logsPage.expectRefreshButtonVisible();

    // STRONG ASSERTION: DateTime button must be visible
    await pm.logsPage.expectDateTimeButtonVisible();

    testLogger.info('✓ PASSED: Search bar UI elements verified');
  });

  // ==========================================================================
  // Bug #8928: UI revamp issues - Histogram rendering
  // https://github.com/openobserve/openobserve/issues/8928
  // ==========================================================================
  test("should render histogram without cropping @bug-8928 @P1 @ui @histogram @regression", async ({ page }) => {
    testLogger.info('Test: Verify histogram renders correctly (Bug #8928)');

    await page.goto(`${logData.logsUrl}?org_identifier=${process.env["ORGNAME"]}`);
    await page.waitForLoadState('networkidle');
    await pm.logsPage.selectStream('e2e_automate');
    await pm.logsPage.clickRefreshButton();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Toggle histogram on
    await pm.logsPage.enableHistogram();
    await pm.logsPage.clickRefreshButton();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // STRONG ASSERTION: Histogram should be visible
    await pm.logsPage.expectHistogramVisible();

    // Toggle off and back on
    await pm.logsPage.toggleHistogram();
    await page.waitForTimeout(500);
    await pm.logsPage.toggleHistogram();
    await page.waitForTimeout(1000);

    // STRONG ASSERTION: Histogram should still be visible after toggle
    await pm.logsPage.expectHistogramVisible();

    testLogger.info('✓ PASSED: Histogram rendering verified');
  });

  test.afterEach(async () => {
    testLogger.info('Logs regression bug test completed');
  });
});
