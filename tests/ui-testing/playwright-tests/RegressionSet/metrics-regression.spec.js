/**
 * Metrics Regression Bugs Test Suite
 *
 * This suite contains regression tests for metrics-related bugs that have been fixed.
 * Each test verifies that a specific bug fix is working correctly.
 *
 * Tests run in PARALLEL for efficiency - setup/cleanup handled via hooks.
 */

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const logData = require('../../fixtures/log.json');
const { ensureMetricsIngested } = require('../utils/shared-metrics-setup.js');

test.describe("Metrics Regression Bugs", () => {
  test.describe.configure({ mode: 'parallel' });
  let pm;

  // Ensure metrics are ingested once for all tests
  test.beforeAll(async () => {
    await ensureMetricsIngested();
  });

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);

    // Navigate to metrics page
    await pm.metricsPage.gotoMetricsPage();
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(1000);

    testLogger.info('Metrics regression test setup completed');
  });

  test.afterEach(async () => {
    testLogger.info('Metrics regression test completed');
  });
});
