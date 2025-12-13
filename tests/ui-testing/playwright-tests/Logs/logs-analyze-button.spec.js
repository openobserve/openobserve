/**
 * Logs Analyze Button Tests
 *
 * Feature: Volume Analysis button on Logs page
 * Source: web/src/plugins/logs/SearchResult.vue
 *
 * Visibility Condition (from source line 80):
 *   v-if="searchObj.data?.queryResults?.hits?.length > 0 && !searchObj.meta.sqlMode"
 *
 * Button is visible when:
 *   - Search results exist (hits.length > 0)
 *   - NOT in SQL mode
 *
 * VERIFIED SELECTORS:
 *   - Analyze button: [data-test="logs-analyze-dimensions-button"]
 *   - Close dashboard: [data-test="analysis-dashboard-close"]
 *   - Dimension selector: [data-test="dimension-selector-button"]
 */

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const logData = require('../../fixtures/log.json');

test.describe("Logs Analyze Button testcases", () => {
  test.describe.configure({ mode: 'serial' });
  let pm;

  const TEST_STREAM = process.env.TEST_STREAM || 'default';

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);

    // Navigate to logs page
    await page.goto(`${logData.logsUrl}?org_identifier=${process.env["ORGNAME"]}`);
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(2000);

    testLogger.info('Logs analyze button test setup completed');
  });

  // P0 - SMOKE TESTS

  test("P0: Analyze button visible with search results", {
    tag: ['@analyze', '@smoke', '@P0', '@logs']
  }, async ({ page }) => {
    testLogger.info('Testing: Analyze button appears when search has results');

    // Select stream
    await pm.logsPage.selectStream(TEST_STREAM);
    await page.waitForTimeout(1000);

    // Run search to get results
    await pm.logsPage.clickRefresh();
    await page.waitForTimeout(3000);

    // Verify analyze button is visible (has results, not in SQL mode)
    await pm.logsPage.expectAnalyzeButtonVisible();

    testLogger.info('P0 Test completed: Analyze button is visible');
  });

  test("P0: Clicking analyze opens dashboard", {
    tag: ['@analyze', '@smoke', '@P0', '@logs']
  }, async ({ page }) => {
    testLogger.info('Testing: Clicking analyze button opens analysis dashboard');

    // Select stream and search
    await pm.logsPage.selectStream(TEST_STREAM);
    await page.waitForTimeout(1000);
    await pm.logsPage.clickRefresh();
    await page.waitForTimeout(3000);

    // Click analyze button
    await pm.logsPage.clickAnalyzeButton();
    await page.waitForTimeout(1000);

    // Verify dashboard modal is open (close button is visible)
    await pm.logsPage.expectAnalysisDashboardVisible();

    testLogger.info('P0 Test completed: Dashboard opened successfully');
  });

  // P1 - FUNCTIONAL TESTS

  test("P1: Close analysis dashboard", {
    tag: ['@analyze', '@functional', '@P1', '@logs']
  }, async ({ page }) => {
    testLogger.info('Testing: Analysis dashboard can be closed');

    // Setup: select stream, search, open dashboard
    await pm.logsPage.selectStream(TEST_STREAM);
    await page.waitForTimeout(1000);
    await pm.logsPage.clickRefresh();
    await page.waitForTimeout(3000);
    await pm.logsPage.clickAnalyzeButton();
    await page.waitForTimeout(1000);
    await pm.logsPage.expectAnalysisDashboardVisible();

    // Close dashboard
    await pm.logsPage.closeAnalysisDashboard();
    await page.waitForTimeout(500);

    // Verify dashboard is closed
    await pm.logsPage.expectAnalysisDashboardClosed();

    testLogger.info('P1 Test completed: Dashboard closed successfully');
  });

  test("P1: Analyze button hidden in SQL mode", {
    tag: ['@analyze', '@functional', '@P1', '@logs']
  }, async ({ page }) => {
    testLogger.info('Testing: Analyze button hidden when SQL mode is active');

    // Select stream first
    await pm.logsPage.selectStream(TEST_STREAM);
    await page.waitForTimeout(1000);

    // Switch to SQL mode (use role selector to avoid duplicate element issue)
    await page.getByRole('switch', { name: 'SQL Mode' }).click();
    await page.waitForTimeout(500);

    // Run a SQL query
    await pm.logsPage.clickRefresh();
    await page.waitForTimeout(3000);

    // Verify analyze button is NOT visible in SQL mode
    await pm.logsPage.expectAnalyzeButtonNotVisible();

    testLogger.info('P1 Test completed: Analyze button hidden in SQL mode');
  });

  test("P1: Dimension selector button available in dashboard", {
    tag: ['@analyze', '@functional', '@P1', '@logs']
  }, async ({ page }) => {
    testLogger.info('Testing: Dimension selector is available in dashboard');

    // Setup: select stream, search, open dashboard
    await pm.logsPage.selectStream(TEST_STREAM);
    await page.waitForTimeout(1000);
    await pm.logsPage.clickRefresh();
    await page.waitForTimeout(3000);
    await pm.logsPage.clickAnalyzeButton();
    await page.waitForTimeout(1000);

    // Verify dimension selector button is visible
    await pm.logsPage.expectDimensionSelectorVisible();

    testLogger.info('P1 Test completed: Dimension selector is available');
  });

  // P2 - EDGE CASES

  test("P2: Switching from SQL to standard mode shows analyze button", {
    tag: ['@analyze', '@edge', '@P2', '@logs']
  }, async ({ page }) => {
    testLogger.info('Testing: Analyze button reappears when switching from SQL to standard mode');

    // Select stream
    await pm.logsPage.selectStream(TEST_STREAM);
    await page.waitForTimeout(1000);

    // Start in SQL mode (use role selector to avoid duplicate element issue)
    await page.getByRole('switch', { name: 'SQL Mode' }).click();
    await page.waitForTimeout(500);
    await pm.logsPage.clickRefresh();
    await page.waitForTimeout(3000);

    // Verify button NOT visible in SQL mode
    await pm.logsPage.expectAnalyzeButtonNotVisible();

    // Switch back to standard mode (use role selector to avoid duplicate element issue)
    await page.getByRole('switch', { name: 'SQL Mode' }).click();
    await page.waitForTimeout(500);
    await pm.logsPage.clickRefresh();
    await page.waitForTimeout(3000);

    // Verify button IS visible in standard mode
    await pm.logsPage.expectAnalyzeButtonVisible();

    testLogger.info('P2 Test completed: Button reappears after switching modes');
  });
});
