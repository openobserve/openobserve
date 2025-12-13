const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const logData = require('../../fixtures/log.json');

test.describe("Histogram Analyze Button testcases", () => {
  test.describe.configure({ mode: 'serial' }); // Run serially to avoid conflicts
  let pm;

  // Configure the stream name to use for testing
  const TEST_STREAM = process.env.TEST_STREAM || 'default';

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);

    // Navigate to base URL with authentication
    await navigateToBase(page);
    pm = new PageManager(page);

    // Navigate to logs page
    await page.goto(
      `${logData.logsUrl}?org_identifier=${process.env["ORGNAME"]}`
    );
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(2000);

    // Select a stream - required for histogram to appear
    await pm.logsPage.selectStream(TEST_STREAM);
    await page.waitForTimeout(1000);

    // Run initial search to load data and histogram
    await pm.logsPage.clickRefresh();
    await page.waitForTimeout(2000);

    testLogger.info('Histogram analyze test setup completed');
  });

  test("Verify analyze button is visible when histogram is enabled", {
    tag: ['@histogram', '@analyze', '@all', '@logs']
  }, async ({ page }) => {
    testLogger.info('Testing analyze button visibility with histogram enabled');

    // Ensure histogram is on
    const isHistogramOn = await pm.logsPage.isHistogramOn();
    if (!isHistogramOn) {
      await pm.logsPage.toggleHistogram();
      await page.waitForTimeout(500);
    }

    // Run a search to load data
    await pm.logsPage.clickRefresh();
    await page.waitForTimeout(2000);

    // Verify analyze button is visible
    await pm.logsPage.expectAnalyzeButtonVisible();

    testLogger.info('Analyze button visibility test completed');
  });

  test("Verify analyze button opens volume analysis dashboard", {
    tag: ['@histogram', '@analyze', '@all', '@logs']
  }, async ({ page }) => {
    testLogger.info('Testing analyze button opens dashboard');

    // Ensure histogram is on
    const isHistogramOn = await pm.logsPage.isHistogramOn();
    if (!isHistogramOn) {
      await pm.logsPage.toggleHistogram();
      await page.waitForTimeout(500);
    }

    // Run a search to load data
    await pm.logsPage.clickRefresh();
    await page.waitForTimeout(2000);

    // Click analyze button
    await pm.logsPage.clickAnalyzeButton();

    // Verify analysis dashboard is visible
    await pm.logsPage.expectAnalysisDashboardVisible();

    testLogger.info('Analyze button opens dashboard test completed');
  });

  test("Verify analysis dashboard can be closed", {
    tag: ['@histogram', '@analyze', '@all', '@logs']
  }, async ({ page }) => {
    testLogger.info('Testing analysis dashboard close functionality');

    // Ensure histogram is on
    const isHistogramOn = await pm.logsPage.isHistogramOn();
    if (!isHistogramOn) {
      await pm.logsPage.toggleHistogram();
      await page.waitForTimeout(500);
    }

    // Run a search to load data
    await pm.logsPage.clickRefresh();
    await page.waitForTimeout(2000);

    // Open analysis dashboard
    await pm.logsPage.clickAnalyzeButton();
    await pm.logsPage.expectAnalysisDashboardVisible();

    // Close analysis dashboard
    await pm.logsPage.closeAnalysisDashboard();
    await pm.logsPage.expectAnalysisDashboardClosed();

    testLogger.info('Analysis dashboard close test completed');
  });

  test("Verify analyze button not visible when histogram is disabled", {
    tag: ['@histogram', '@analyze', '@all', '@logs']
  }, async ({ page }) => {
    testLogger.info('Testing analyze button visibility with histogram disabled');

    // Ensure histogram is off
    const isHistogramOn = await pm.logsPage.isHistogramOn();
    if (isHistogramOn) {
      await pm.logsPage.toggleHistogram();
      await page.waitForTimeout(500);
    }

    // Run a search
    await pm.logsPage.clickRefresh();
    await page.waitForTimeout(2000);

    // Verify analyze button is not visible when histogram is off
    await pm.logsPage.expectAnalyzeButtonNotVisible();

    testLogger.info('Analyze button not visible with histogram disabled test completed');
  });

  test("Verify analyze button visibility toggles with histogram", {
    tag: ['@histogram', '@analyze', '@all', '@logs']
  }, async ({ page }) => {
    testLogger.info('Testing analyze button visibility toggle with histogram');

    // Start with histogram on
    const isHistogramOn = await pm.logsPage.isHistogramOn();
    if (!isHistogramOn) {
      await pm.logsPage.toggleHistogram();
      await page.waitForTimeout(500);
    }

    // Run a search to load data
    await pm.logsPage.clickRefresh();
    await page.waitForTimeout(2000);

    // Verify button is visible
    await pm.logsPage.expectAnalyzeButtonVisible();

    // Toggle histogram off
    await pm.logsPage.toggleHistogram();
    await page.waitForTimeout(500);

    // Verify button is not visible
    await pm.logsPage.expectAnalyzeButtonNotVisible();

    // Toggle histogram back on
    await pm.logsPage.toggleHistogram();
    await page.waitForTimeout(500);

    // Verify button is visible again
    await pm.logsPage.expectAnalyzeButtonVisible();

    testLogger.info('Analyze button visibility toggle test completed');
  });
});
